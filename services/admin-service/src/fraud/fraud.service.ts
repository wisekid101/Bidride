import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaClient } from '@bidride/database';
import { IsEnum, IsString, MinLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';

export class ReviewAlertDto {
  @IsEnum(['clear', 'escalate'])
  decision: 'clear' | 'escalate';

  @IsString()
  @MinLength(1)
  notes: string;
}

// These roles may perform fraud review decisions
const FRAUD_REVIEW_ROLES = new Set([
  'founder',
  'super_admin',
  'operations_admin',
  'safety_admin',
  'fraud_admin',
]);

function formatTriggerReason(signals: Record<string, unknown>): string {
  const parts: string[] = [];
  const linkedAccounts = Number(signals.linkedAccounts ?? 0);
  const deviceFingerprints = Number(signals.deviceFingerprints ?? 0);
  const fraudFlagCount = Number(signals.fraudFlagCount ?? 0);
  const disputeCount = Number(signals.disputeCount ?? 0);
  const accountAgeDays = Number(signals.accountAgeDays ?? 999);
  const totalTrips = Number(signals.totalTrips ?? 999);

  if (linkedAccounts > 2) parts.push(`${linkedAccounts} linked accounts`);
  if (deviceFingerprints > 5) parts.push(`${deviceFingerprints} device fingerprints`);
  if (fraudFlagCount > 0) parts.push(`${fraudFlagCount} prior fraud flag(s)`);
  if (disputeCount > 3) parts.push(`${disputeCount} disputes`);
  if (accountAgeDays < 7 && totalTrips === 0) parts.push('new account with no trips');

  return parts.length > 0 ? parts.join(', ') : 'Multiple risk signals detected';
}

@Injectable()
export class FraudService {
  private prisma = new PrismaClient();

  constructor(private readonly audit: AuditService) {}

  async listAlerts(statusGroup: 'pending' | 'reviewed', page = 1, limit = 50) {
    const statuses =
      statusGroup === 'pending' ? ['pending', 'under_review'] : ['cleared', 'escalated'];

    const [alerts, total] = await this.prisma.$transaction([
      this.prisma.fraudAlert.findMany({
        where: { status: { in: statuses } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.fraudAlert.count({ where: { status: { in: statuses } } }),
    ]);

    const mapped = alerts.map((a) => ({
      id: a.id,
      userId: a.userId,
      userType: a.userRole as 'rider' | 'driver',
      userName: [a.user.firstName, a.user.lastName].filter(Boolean).join(' ') || 'Unknown User',
      fraudProbability: parseFloat(a.fraudProbability.toString()),
      triggerReason: formatTriggerReason(a.triggerSignals as Record<string, unknown>),
      tripId: a.tripId ?? undefined,
      createdAt: a.createdAt.toISOString(),
      status: a.status as 'pending' | 'under_review' | 'cleared' | 'escalated',
      holdActive: a.holdReleasedAt === null,
    }));

    return { alerts: mapped, total, page, pages: Math.ceil(total / limit) };
  }

  async markUnderReview(alertId: string, adminId: string): Promise<void> {
    const alert = await this.prisma.fraudAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundException('Fraud alert not found');

    if (alert.status === 'pending') {
      await this.prisma.fraudAlert.update({
        where: { id: alertId },
        data: { status: 'under_review' },
      });

      await this.audit.createLog({
        adminId,
        action: 'fraud.mark_under_review',
        targetType: 'fraud_alert',
        targetId: alertId,
        metadata: { previousStatus: 'pending' },
      });
    }
    // If already under_review or terminal — no-op
  }

  async reviewAlert(
    alertId: string,
    dto: ReviewAlertDto,
    adminId: string,
    adminRole: string,
  ): Promise<void> {
    if (!FRAUD_REVIEW_ROLES.has(adminRole)) {
      throw new ForbiddenException('Your role is not authorized to perform fraud reviews');
    }

    if (!dto.notes?.trim()) {
      throw new BadRequestException('Review notes are required');
    }

    const alert = await this.prisma.fraudAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundException('Fraud alert not found');

    if (!['pending', 'under_review'].includes(alert.status)) {
      throw new BadRequestException(
        `Alert is already in a terminal state: ${alert.status}. Cannot re-review.`,
      );
    }

    const now = new Date();
    await this.prisma.fraudAlert.update({
      where: { id: alertId },
      data: {
        status: dto.decision === 'clear' ? 'cleared' : 'escalated',
        decision: dto.decision,
        reviewNotes: dto.notes.trim(),
        reviewedById: adminId,
        reviewedAt: now,
        holdReleasedAt: dto.decision === 'clear' ? now : null,
      },
    });

    await this.audit.createLog({
      adminId,
      action: `fraud.${dto.decision}`,
      targetType: 'fraud_alert',
      targetId: alertId,
      metadata: {
        decision: dto.decision,
        userId: alert.userId,
        fraudProbability: parseFloat(alert.fraudProbability.toString()),
        holdReleased: dto.decision === 'clear',
      },
    });
  }
}
