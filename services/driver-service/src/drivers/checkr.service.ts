import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaClient, DriverStatus, BackgroundCheckStatus } from '@bidride/database';
import { Redis } from 'ioredis';

interface CheckrCandidateInput {
  legalFirstName: string;
  legalLastName: string;
  dateOfBirth: Date;
  homeZip: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface CheckrWebhookEvent {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      status: 'pending' | 'clear' | 'consider' | 'suspended' | 'canceled';
      candidate_id: string;
    };
  };
}

const CHECKR_API_BASE = 'https://api.checkr.com/v1';
// 7 calendar days covers the FCRA 5-business-day minimum waiting period
const FCRA_WAITING_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class CheckrService {
  private readonly logger = new Logger(CheckrService.name);
  private readonly prisma = new PrismaClient();
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379'),
    });
  }

  private get authHeader(): string {
    const key = process.env.CHECKR_API_KEY ?? '';
    return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
  }

  async createCandidate(input: CheckrCandidateInput): Promise<string> {
    const body: Record<string, unknown> = {
      first_name: input.legalFirstName,
      last_name: input.legalLastName,
      dob: input.dateOfBirth.toISOString().split('T')[0],
      zipcode: input.homeZip ?? '07102',
      work_locations: [{ country: 'US', state: 'NJ' }],
    };
    if (input.email) body.email = input.email;
    if (input.phone) body.phone = input.phone;

    const res = await fetch(`${CHECKR_API_BASE}/candidates`, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new BadRequestException(`Checkr candidate creation failed: ${text}`);
    }

    const data = await res.json() as { id: string };
    return data.id;
  }

  async createReport(candidateId: string): Promise<string> {
    const packageSlug = process.env.CHECKR_PACKAGE ?? 'driver_pro';

    const res = await fetch(`${CHECKR_API_BASE}/reports`, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package: packageSlug,
        candidate_id: candidateId,
        work_locations: [{ country: 'US', state: 'NJ' }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new BadRequestException(`Checkr report creation failed: ${text}`);
    }

    const data = await res.json() as { id: string };
    return data.id;
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const secret = process.env.CHECKR_WEBHOOK_SECRET ?? '';
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const expectedBuf = Buffer.from(expected);
    const sigBuf = Buffer.from(signature);
    if (expectedBuf.length !== sigBuf.length) return false;
    return timingSafeEqual(expectedBuf, sigBuf);
  }

  async handleWebhookEvent(event: CheckrWebhookEvent): Promise<void> {
    // Idempotency: skip if already processed within 24 hours
    const claimed = await this.redis.set(`checkr:event:${event.id}`, '1', 'EX', 86400, 'NX');
    if (!claimed) return;

    const { type, data } = event;
    if (type !== 'report.completed' && type !== 'report.updated') return;

    const report = data.object;
    const driver = await this.prisma.driver.findFirst({
      where: { backgroundCheckId: report.id },
      include: { user: { select: { email: true } } },
    });
    if (!driver) return;

    const { status } = report;

    if (status === 'clear') {
      const approveableStatuses: DriverStatus[] = [
        DriverStatus.pending,
        DriverStatus.under_review,
        DriverStatus.action_required,
      ];
      if (!approveableStatuses.includes(driver.status)) return;

      await this.prisma.driver.update({
        where: { id: driver.id },
        data: {
          backgroundCheckStatus: BackgroundCheckStatus.clear,
          backgroundCheckClearedAt: new Date(),
          status: DriverStatus.approved,
          onboardingStep: 'complete',
        },
      });
      await this.redis.publish(
        'driver:approved',
        JSON.stringify({
          driverId: driver.id,
          userId: driver.userId,
          notes: 'Background check cleared',
        }),
      );
    } else if (status === 'consider') {
      await this.prisma.driver.update({
        where: { id: driver.id },
        data: { backgroundCheckStatus: BackgroundCheckStatus.consider },
      });

      // FCRA pre-adverse action: notify driver and begin 5-business-day (7 calendar) waiting period
      await this.redis.setex(
        `bgc:adverse_waiting:${driver.id}`,
        FCRA_WAITING_TTL_SECONDS,
        new Date().toISOString(),
      );
      await this.redis.publish(
        'driver:bgc:pre_adverse_action',
        JSON.stringify({ driverId: driver.id, userId: driver.userId, reportId: report.id }),
      );
    } else if (status === 'suspended' || status === 'canceled') {
      // suspended = Checkr found disqualifying record; canceled = report failed to complete
      await this.prisma.driver.update({
        where: { id: driver.id },
        data: {
          backgroundCheckStatus: BackgroundCheckStatus.adverse_action,
          status: DriverStatus.suspended,
          isAvailable: false,
        },
      });
      await this.redis.del(`driver:location:${driver.id}`);
      await this.redis.zrem('drivers:geo', driver.id);
      await this.redis.publish(
        'driver:bgc:final_adverse_action',
        JSON.stringify({ driverId: driver.id, userId: driver.userId, reportId: report.id }),
      );
    }
  }
}
