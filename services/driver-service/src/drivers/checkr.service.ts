import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaClient, DriverStatus, BackgroundCheckStatus } from '@bidride/database';
import { Redis } from 'ioredis';
import { DriverActivationService } from './driver-activation.service';

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

// Two-phase webhook dedup. A short-TTL `processing` lease self-heals a crashed
// worker (it simply expires, freeing the event for redelivery); the long-TTL
// `done` marker suppresses duplicates for 24h once processing has succeeded.
// The `v2` namespace avoids colliding with any legacy `checkr:event:{id}` keys.
const DEDUP_KEY_PREFIX = 'checkr:event:v2:';
const PROCESSING_TTL_SECONDS = 120;
const DONE_TTL_SECONDS = 24 * 60 * 60;
// A report whose driver row isn't visible yet (replica lag / the webhook beat
// the backgroundCheckId write) is retried for a bounded number of deliveries,
// then abandoned with an operational alert so it can't retry-storm forever.
const UNKNOWN_DRIVER_MAX_ATTEMPTS = 5;
const UNKNOWN_DRIVER_COUNTER_TTL_SECONDS = 60 * 60;

@Injectable()
export class CheckrService {
  private readonly logger = new Logger(CheckrService.name);
  private readonly prisma = new PrismaClient();
  private readonly redis: Redis;

  constructor(private readonly activation: DriverActivationService) {
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
    const key = `${DEDUP_KEY_PREFIX}${event.id}`;

    // Two-phase idempotency. Claim a short-TTL `processing` lease FIRST; upgrade
    // it to a long-TTL `done` marker ONLY after processing succeeds. On any
    // failure the lease is deleted (and self-expires after the short TTL), so
    // Checkr's retry re-processes instead of being silently swallowed — every
    // per-branch write below is conditional, making re-processing idempotent.
    const claimed = await this.redis.set(key, 'processing', 'EX', PROCESSING_TTL_SECONDS, 'NX');
    if (!claimed) {
      const state = await this.redis.get(key);
      if (state === 'done') return; // already fully processed → ack (200)
      // `processing` (a delivery still in flight) or `null` (lease just expired):
      // ask Checkr to redeliver rather than acking an event that may still be
      // lost if the in-flight worker crashes.
      throw new ServiceUnavailableException('Webhook processing in progress; please retry.');
    }

    try {
      await this.processWebhookEvent(event);
      await this.redis.set(key, 'done', 'EX', DONE_TTL_SECONDS);
    } catch (err) {
      // Release our own lease so an immediate retry can re-claim; a hard crash
      // that skips this path self-heals when the short lease TTL expires.
      await this.redis.del(key).catch(() => undefined);
      throw err;
    }
  }

  private async processWebhookEvent(event: CheckrWebhookEvent): Promise<void> {
    const { type, data } = event;
    // Unsupported-but-valid event → genuine no-op; ack (200), don't retry.
    if (type !== 'report.completed' && type !== 'report.updated') return;

    const report = data.object;
    const driver = await this.prisma.driver.findFirst({
      where: { backgroundCheckId: report.id },
      include: { user: { select: { email: true } } },
    });
    if (!driver) {
      await this.handleUnknownDriver(event.id, report.id);
      return;
    }

    const { status } = report;

    if (status === 'clear') {
      const approveableStatuses: DriverStatus[] = [
        DriverStatus.pending,
        DriverStatus.under_review,
        DriverStatus.action_required,
      ];
      // Guard: only record a `clear` for a driver still in an activatable state,
      // so a late/duplicate clear can never overwrite a terminal-negative
      // decision (adverse_action) on a suspended/declined driver.
      if (!approveableStatuses.includes(driver.status)) return;

      // Record ONLY the background-check evidence. Activation is decided
      // exclusively by maybeActivate() (sole authority; atomic; publishes
      // driver:approved at most once).
      await this.prisma.driver.update({
        where: { id: driver.id },
        data: {
          backgroundCheckStatus: BackgroundCheckStatus.clear,
          backgroundCheckClearedAt: new Date(),
        },
      });
      await this.activation.maybeActivate(driver.id, { notes: 'Background check cleared' });
    } else if (status === 'consider') {
      // Conditional transition keyed on the SOURCE state: only a driver not
      // already in consider/adverse/disputed and not terminal-negative flips to
      // consider. This makes replays idempotent AND protects terminal states (a
      // late consider can't clobber a suspended driver's adverse_action). The
      // FCRA notice + waiting timer fire ONLY on the causing transition, so a
      // replay can never re-notify or reset the statutory clock.
      const { count } = await this.prisma.driver.updateMany({
        where: {
          id: driver.id,
          backgroundCheckStatus: {
            notIn: [
              BackgroundCheckStatus.consider,
              BackgroundCheckStatus.adverse_action,
              BackgroundCheckStatus.disputed,
            ],
          },
          status: { notIn: [DriverStatus.suspended, DriverStatus.declined] },
        },
        data: { backgroundCheckStatus: BackgroundCheckStatus.consider },
      });
      if (count === 1) {
        // FCRA pre-adverse: begin the 5-business-day (7 calendar) waiting period.
        await this.redis.setex(
          `bgc:adverse_waiting:${driver.id}`,
          FCRA_WAITING_TTL_SECONDS,
          new Date().toISOString(),
        );
        await this.redis.publish(
          'driver:bgc:pre_adverse_action',
          JSON.stringify({ driverId: driver.id, userId: driver.userId, reportId: report.id }),
        );
      }
    } else if (status === 'suspended' || status === 'canceled') {
      // suspended = disqualifying record; canceled = report failed. Conditional
      // transition keyed on the source status so a replay does not re-fire the
      // final adverse-action notice.
      const { count } = await this.prisma.driver.updateMany({
        where: { id: driver.id, status: { not: DriverStatus.suspended } },
        data: {
          backgroundCheckStatus: BackgroundCheckStatus.adverse_action,
          status: DriverStatus.suspended,
          isAvailable: false,
        },
      });
      // Idempotent removal from the dispatch pool (safe to repeat on a replay).
      await this.redis.del(`driver:${driver.userId}:location`);
      await this.redis.zrem('drivers:geo', driver.userId);
      if (count === 1) {
        await this.redis.publish(
          'driver:bgc:final_adverse_action',
          JSON.stringify({ driverId: driver.id, userId: driver.userId, reportId: report.id }),
        );
      }
    }
  }

  private async handleUnknownDriver(eventId: string, reportId: string): Promise<void> {
    const counterKey = `checkr:event:unknown:${eventId}`;
    const attempts = await this.redis.incr(counterKey);
    if (attempts === 1) {
      await this.redis.expire(counterKey, UNKNOWN_DRIVER_COUNTER_TTL_SECONDS);
    }
    if (attempts <= UNKNOWN_DRIVER_MAX_ATTEMPTS) {
      // Likely replica lag / the report beat the driver's backgroundCheckId
      // write — ask Checkr to retry within the bounded window.
      throw new ServiceUnavailableException('Driver not yet linked to background check; retry.');
    }
    // Past the bounded retry window: stop the retry storm and surface to ops.
    // The caller returns normally → the event is marked `done` (200).
    this.logger.error(
      `Checkr webhook: no driver for backgroundCheckId=${reportId} after ${attempts} attempts ` +
        `(event=${eventId}); abandoning to prevent a retry storm. OPERATIONAL ALERT.`,
    );
  }
}
