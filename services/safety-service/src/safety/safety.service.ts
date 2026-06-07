import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as AWS from 'aws-sdk';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const SOS_COUNTDOWN_SECONDS = 5;
const SOS_SLA_SECONDS = 90;
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 5;
const CHECK_IN_RESPONSE_MINUTES = 5;

@Injectable()
export class SafetyService {
  private readonly s3: AWS.S3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.s3 = new AWS.S3({ region: config.get('AWS_REGION', 'us-east-1') });
  }

  // ─── SOS ──────────────────────────────────────────────────────────────────

  async initiateSos(tripId: string, userId: string, triggerSource: string, gpsLat: number, gpsLng: number) {
    const session = await this.prisma.safetySession.findUnique({ where: { tripId } });
    if (!session) throw new NotFoundException('Safety session not found.');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const sos = await this.prisma.sosEvent.create({
      data: {
        tripId,
        safetySessionId: session.id,
        initiatedByUserId: userId,
        initiatedByRole: user.role === 'rider' ? 'rider' : 'driver',
        triggerSource: triggerSource as any,
        gpsLat,
        gpsLng,
        status: 'active',
        slaDeadline: new Date(Date.now() + SOS_SLA_SECONDS * 1000),
      } as any,
    });

    // Store countdown key — cancelled if user taps "Cancel" within 5s
    await this.redis.setex(
      `sos:countdown:${sos.id}`,
      SOS_COUNTDOWN_SECONDS + 2,
      userId,
    );

    // Update session state
    await this.prisma.safetySession.update({
      where: { id: session.id },
      data: {
        currentState: 'sos_active',
        slaDeadline: new Date(Date.now() + SOS_SLA_SECONDS * 1000),
      },
    });

    // Alert admin queue immediately (not waiting for countdown confirmation)
    await this.redis.publish('safety:sos', JSON.stringify({
      event: 'safety:sos_new',
      sosId: sos.id,
      tripId,
      gpsLat,
      gpsLng,
      initiatedByRole: user.role,
    }));

    return {
      sosId: sos.id,
      countdownSeconds: SOS_COUNTDOWN_SECONDS,
      message: 'SOS countdown started. Tap cancel to abort.',
    };
  }

  async confirmSos(sosId: string, userId: string) {
    const sos = await this.prisma.sosEvent.findUnique({ where: { id: sosId } });
    if (!sos || sos.initiatedByUserId !== userId) throw new ForbiddenException('Not your SOS.');
    if (sos.status !== 'active') throw new BadRequestException('SOS already resolved or cancelled.');

    await this.prisma.sosEvent.update({
      where: { id: sosId },
      data: { activationConfirmedAt: new Date() },
    });

    // Trigger audio recording
    const recordingKey = `recordings/sos/${sosId}/${Date.now()}.ogg`;
    await this.prisma.safetyRecording.create({
      data: {
        tripId: sos.tripId,
        safetySessionId: sos.safetySessionId,
        storageBucket: this.config.getOrThrow('S3_RECORDINGS_BUCKET'),
        storageKey: recordingKey,
        encryptionKeyId: this.config.getOrThrow('KMS_RECORDINGS_KEY_ID'),
        retentionCategory: 'no_action_30d',
        deleteAfter: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        status: 'recording',
      },
    });

    // Notify trusted contacts
    await this.notifyTrustedContacts(sos.tripId);

    await this.redis.del(`sos:countdown:${sosId}`);

    return { confirmed: true, message: 'SOS active. Admin notified. Trusted contacts alerted.' };
  }

  async cancelSos(sosId: string, userId: string) {
    const sos = await this.prisma.sosEvent.findUnique({ where: { id: sosId } });
    if (!sos || sos.initiatedByUserId !== userId) throw new ForbiddenException('Not your SOS.');

    const countdownKey = `sos:countdown:${sosId}`;
    const hasCountdown = await this.redis.exists(countdownKey);

    if (!hasCountdown && sos.activationConfirmedAt) {
      throw new BadRequestException('SOS already confirmed. Contact support to resolve.');
    }

    await this.prisma.sosEvent.update({
      where: { id: sosId },
      data: { cancelledAt: new Date(), status: 'false_alarm' },
    });

    await this.prisma.safetySession.update({
      where: { id: sos.safetySessionId },
      data: { currentState: 'normal' },
    });

    await this.redis.del(countdownKey);

    return { cancelled: true };
  }

  // ─── Panic ────────────────────────────────────────────────────────────────

  async triggerPanic(tripId: string, userId: string, initiatedByRole: string, gpsLat: number, gpsLng: number) {
    const session = await this.prisma.safetySession.findUnique({ where: { tripId } });
    if (!session) throw new NotFoundException('Safety session not found.');

    const panic = await this.prisma.panicEvent.create({
      data: {
        tripId,
        safetySessionId: session.id,
        initiatedByRole,
        gpsLat,
        gpsLng,
      },
    });

    await this.prisma.safetySession.update({
      where: { id: session.id },
      data: { currentState: 'panic_active' },
    });

    // CRITICAL: Panic alerts admin with trip context ONLY — never includes rider identity
    // Admin rule: DO NOT CONTACT THE RIDER about a panic event
    await this.redis.publish('safety:panic', JSON.stringify({
      event: 'safety:panic_new',
      panicId: panic.id,
      tripId,
      initiatedByRole, // 'driver' or 'rider' — no name/identity
    }));

    // Silent for the initiator — no vibration, no visual change per spec
    return { triggered: true };
  }

  // ─── Safe Check-In ────────────────────────────────────────────────────────

  async requestCheckIn(tripId: string, riderId: string) {
    const session = await this.prisma.safetySession.findUnique({ where: { tripId } });
    if (!session) throw new NotFoundException('Safety session not found.');
    if (!session.isNightRide) return { skipped: true, reason: 'Not a night ride.' };

    const checkIn = await this.prisma.safeCheckIn.create({
      data: {
        tripId,
        riderId,
        safetySessionId: session.id,
        status: 'pending',
        dueAt: new Date(Date.now() + CHECK_IN_RESPONSE_MINUTES * 60 * 1000),
      },
    });

    // Push notification to rider
    await this.redis.publish('notifications', JSON.stringify({
      event: 'safety:check_in_due',
      riderId,
      tripId,
      checkInId: checkIn.id,
      dueAt: checkIn.dueAt,
    }));

    return { checkInId: checkIn.id, dueAt: checkIn.dueAt };
  }

  async respondCheckIn(checkInId: string, riderId: string, status: 'safe' | 'escalated') {
    const checkIn = await this.prisma.safeCheckIn.findUnique({ where: { id: checkInId } });
    if (!checkIn || checkIn.riderId !== riderId) throw new ForbiddenException();

    await this.prisma.safeCheckIn.update({
      where: { id: checkInId },
      data: { status, respondedAt: new Date() },
    });

    if (status === 'escalated') {
      await this.redis.publish('safety:sos', JSON.stringify({
        event: 'safety:check_in_escalated',
        checkInId,
        tripId: checkIn.tripId,
      }));
    }

    return { status };
  }

  // ─── Route Anomaly Detection ──────────────────────────────────────────────

  async checkRouteAnomaly(tripId: string, currentLat: number, currentLng: number): Promise<void> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { dropoffLat: true, dropoffLng: true, startedAt: true, estimatedDurationMin: true },
    });
    if (!trip || !trip.startedAt) return;

    const elapsedMin = (Date.now() - trip.startedAt.getTime()) / 60000;
    const expectedMin = trip.estimatedDurationMin ?? 30;

    // Placeholder: in production, compare against stored route polyline
    const timeDeviation = elapsedMin - expectedMin;

    if (timeDeviation > 15) {
      await this.redis.publish('safety:anomaly', JSON.stringify({
        event: 'safety:anomaly',
        tripId,
        type: 'time_overrun',
        elapsedMin,
        expectedMin,
      }));
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async notifyTrustedContacts(tripId: string): Promise<void> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { rider: { include: { trustedContacts: { where: { notifyOnSos: true } } } } },
    });

    if (!trip?.rider?.trustedContacts?.length) return;

    await this.redis.publish('notifications:trusted_contacts', JSON.stringify({
      event: 'sos:trusted_contact_alert',
      tripId,
      contacts: trip.rider.trustedContacts.map((c) => ({ phone: c.phone, name: c.name })),
    }));
  }
}
