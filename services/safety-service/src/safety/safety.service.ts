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
import { RouteService, minDistanceToPolylineMiles } from './route.service';

const SOS_COUNTDOWN_SECONDS = 5;
const SOS_SLA_SECONDS = 90;
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 5;
const CHECK_IN_RESPONSE_MINUTES = 5;

const SPATIAL_DEVIATION_THRESHOLD_MILES = 0.5;
const SPATIAL_DEVIATION_SUSTAINED_MS = 2 * 60 * 1000; // 2 minutes

export interface TripSafetyScoreResult {
  riskLevel: 'low' | 'moderate' | 'high';
  score: number;
  factors: string[];
}

@Injectable()
export class SafetyService {
  private readonly s3: AWS.S3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly routeService: RouteService,
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

    await this.redis.setex(
      `sos:countdown:${sos.id}`,
      SOS_COUNTDOWN_SECONDS + 2,
      userId,
    );

    await this.prisma.safetySession.update({
      where: { id: session.id },
      data: {
        currentState: 'sos_active',
        slaDeadline: new Date(Date.now() + SOS_SLA_SECONDS * 1000),
      },
    });

    // SOS overrides AI and goes directly to admin
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
    await this.redis.publish('safety:panic', JSON.stringify({
      event: 'safety:panic_new',
      panicId: panic.id,
      tripId,
      initiatedByRole,
    }));

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

  // ─── Safety Risk Scoring ──────────────────────────────────────────────────

  async computeAndStoreSafetyScore(
    tripId: string,
    opts: {
      isNightRide: boolean;
      isAirportTrip: boolean;
      distanceMiles: number;
      driverUserId?: string;
      riderId?: string;
    },
  ): Promise<TripSafetyScoreResult> {
    const factors: string[] = [];
    let score = 0;

    if (opts.isNightRide) {
      score += 25;
      factors.push('night_ride');
    }

    if (opts.isAirportTrip) {
      score += 10;
      factors.push('airport_trip');
    }

    if (opts.distanceMiles > 20) {
      score += 20;
      factors.push('long_distance');
    } else if (opts.distanceMiles > 10) {
      score += 10;
      factors.push('medium_distance');
    }

    // Prior deviations (within 30 days, for this driver)
    let priorDeviations = 0;
    let priorSosEvents = 0;

    if (opts.driverUserId) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      // Find tripIds for this driver within 30 days, then count deviations
      const driverTrips = await this.prisma.trip.findMany({
        where: {
          driver: { userId: opts.driverUserId },
          createdAt: { gte: thirtyDaysAgo },
        },
        select: { id: true },
      }).catch(() => [] as { id: string }[]);

      const tripIds = driverTrips.map((t) => t.id);

      const [devCount, sosCount] = await Promise.all([
        tripIds.length > 0
          ? this.prisma.routeDeviationEvent.count({
              where: { type: 'spatial', tripId: { in: tripIds }, createdAt: { gte: thirtyDaysAgo } },
            }).catch(() => 0)
          : Promise.resolve(0),
        tripIds.length > 0
          ? this.prisma.sosEvent.count({ where: { tripId: { in: tripIds } } }).catch(() => 0)
          : Promise.resolve(0),
      ]);
      priorDeviations = devCount;
      priorSosEvents = sosCount;
    }

    if (priorDeviations > 2) {
      score += 25;
      factors.push('repeat_deviations');
    } else if (priorDeviations > 0) {
      score += 10;
      factors.push('prior_deviation');
    }

    if (priorSosEvents > 0) {
      score += 15;
      factors.push('prior_sos');
    }

    const riskLevel: TripSafetyScoreResult['riskLevel'] =
      score >= 50 ? 'high' : score >= 25 ? 'moderate' : 'low';

    // Store fire-and-forget
    void this.prisma.tripSafetyScore.upsert({
      where: { tripId },
      create: {
        tripId,
        riskLevel,
        score,
        factors,
        nightRide: opts.isNightRide,
        airportTrip: opts.isAirportTrip,
        distanceMiles: opts.distanceMiles,
        priorDeviations,
        priorSosEvents,
      },
      update: { riskLevel, score, factors },
    }).catch(() => {});

    return { riskLevel, score, factors };
  }

  // ─── Route Anomaly Detection ──────────────────────────────────────────────

  async checkRouteAnomaly(tripId: string, currentLat: number, currentLng: number): Promise<void> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        dropoffLat: true,
        dropoffLng: true,
        startedAt: true,
        estimatedDurationMin: true,
        routeDeviationCount: true,
      },
    });
    if (!trip || !trip.startedAt) return;

    const elapsedMin = (Date.now() - trip.startedAt.getTime()) / 60000;
    const expectedMin = trip.estimatedDurationMin ?? 30;

    // ── 1. Time overrun detection (unchanged) ────────────────────────────────
    const timeDeviation = elapsedMin - expectedMin;
    if (timeDeviation > 15) {
      await this.handleDeviation(tripId, {
        type: 'time_overrun',
        elapsedMin,
        expectedMin,
        currentLat,
        currentLng,
      });
    }

    // ── 2. Spatial deviation detection ──────────────────────────────────────
    const polyline = await this.routeService.getPolyline(tripId);
    if (polyline.length === 0) return; // No route stored — skip spatial check

    const deviationMiles = minDistanceToPolylineMiles(
      { lat: currentLat, lng: currentLng },
      polyline,
    );

    if (deviationMiles > SPATIAL_DEVIATION_THRESHOLD_MILES) {
      const offRouteKey = `trip:${tripId}:off_route_since`;
      const existingTs = await this.redis.get(offRouteKey);

      if (!existingTs) {
        // First observation off-route — start timer
        await this.redis.set(offRouteKey, String(Date.now()), 'EX', 600); // 10-min TTL
      } else {
        const offRouteDurationMs = Date.now() - parseInt(existingTs, 10);
        if (offRouteDurationMs >= SPATIAL_DEVIATION_SUSTAINED_MS) {
          // Sustained deviation — fire event and clear timer
          await this.redis.del(offRouteKey);
          await this.handleDeviation(tripId, {
            type: 'spatial',
            deviationMiles,
            elapsedMin,
            expectedMin,
            currentLat,
            currentLng,
          });
        }
      }
    } else {
      // Back on route — clear off-route timer
      await this.redis.del(`trip:${tripId}:off_route_since`);
    }
  }

  // ─── Deviation Handler + Escalation ──────────────────────────────────────

  private async handleDeviation(
    tripId: string,
    opts: {
      type: string;
      deviationMiles?: number;
      elapsedMin?: number;
      expectedMin?: number;
      currentLat: number;
      currentLng: number;
    },
  ): Promise<void> {
    // Increment deviation count on trip
    await this.prisma.trip.update({
      where: { id: tripId },
      data: { routeDeviationCount: { increment: 1 } },
    });

    // Look up risk level for this trip
    const safetyScore = await this.prisma.tripSafetyScore
      .findUnique({ where: { tripId }, select: { riskLevel: true } })
      .catch(() => null);
    const riskLevel = (safetyScore?.riskLevel ?? 'low') as 'low' | 'moderate' | 'high';

    // Determine escalation
    let escalated = false;
    let escalationType: string | undefined;

    if (riskLevel === 'high') {
      escalated = true;
      escalationType = 'admin_alert';
      await this.redis.publish('safety:anomaly', JSON.stringify({
        event: 'safety:high_risk_deviation',
        tripId,
        type: opts.type,
        riskLevel,
        deviationMiles: opts.deviationMiles,
        elapsedMin: opts.elapsedMin,
        expectedMin: opts.expectedMin,
        currentLat: opts.currentLat,
        currentLng: opts.currentLng,
        timestamp: new Date().toISOString(),
      }));
    } else if (riskLevel === 'moderate') {
      escalated = true;
      escalationType = 'check_in';
      // Request rider check-in (fire-and-forget — session may not be night ride)
      const session = await this.prisma.safetySession
        .findUnique({
          where: { tripId },
          select: { id: true, isNightRide: true, trip: { select: { riderId: true } } },
        })
        .catch(() => null);
      if (session) {
        void this.prisma.safeCheckIn.create({
          data: {
            tripId,
            riderId: session.trip?.riderId ?? '',
            safetySessionId: session.id,
            status: 'pending',
            dueAt: new Date(Date.now() + CHECK_IN_RESPONSE_MINUTES * 60 * 1000),
          },
        }).then(() =>
          this.redis.publish('notifications', JSON.stringify({
            event: 'safety:check_in_due',
            riderId: session.trip?.riderId,
            tripId,
            reason: 'route_deviation',
          })),
        ).catch(() => {});
      }
    } else {
      // Low risk: publish anomaly for observability only
      await this.redis.publish('safety:anomaly', JSON.stringify({
        event: 'safety:anomaly',
        tripId,
        type: opts.type,
        deviationMiles: opts.deviationMiles,
        elapsedMin: opts.elapsedMin,
        expectedMin: opts.expectedMin,
        timestamp: new Date().toISOString(),
      }));
    }

    // Store deviation event (fire-and-forget)
    void this.prisma.routeDeviationEvent.create({
      data: {
        tripId,
        type: opts.type,
        deviationMiles: opts.deviationMiles,
        elapsedMin: opts.elapsedMin,
        expectedMin: opts.expectedMin,
        riskLevel,
        escalated,
        escalationType,
        currentLat: opts.currentLat,
        currentLng: opts.currentLng,
      },
    }).catch(() => {});
  }

  // ─── Admin: deviation alerts ──────────────────────────────────────────────

  async getDeviationAlerts(limit = 50): Promise<object[]> {
    return this.prisma.routeDeviationEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        tripId: true,
        type: true,
        riskLevel: true,
        deviationMiles: true,
        elapsedMin: true,
        expectedMin: true,
        escalated: true,
        escalationType: true,
        resolvedAt: true,
        createdAt: true,
      },
    });
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async notifyTrustedContacts(tripId: string): Promise<void> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        rider: {
          include: {
            user: { select: { firstName: true, lastName: true } },
            trustedContacts: { where: { notifyOnSos: true } },
          },
        },
      },
    });

    if (!trip?.rider?.trustedContacts?.length) return;

    const riderName = [
      (trip.rider as any).user?.firstName,
      (trip.rider as any).user?.lastName,
    ].filter(Boolean).join(' ') || 'BidRide Rider';

    const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:3008';

    await fetch(`${NOTIFICATION_URL}/internal/notifications/sos-contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contacts: trip.rider.trustedContacts.map((c) => ({ phone: c.phone, name: c.name })),
        riderName,
        tripId,
      }),
    }).catch((err) => {
      console.error('[SafetyService] Failed to notify trusted contacts:', err?.message);
    });
  }
}
