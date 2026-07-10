import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { TripStatus, RideType } from '@bidride/database/generated/client';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { DispatchService } from './dispatch.service';
import { EarningsFloorService } from './earnings-floor.service';
import { assertValidTransition, isNightRide, isTerminal } from './trip-state-machine';
import { CreateTripDto, EndTripDto, RateTripDto, RateRiderDto } from './dto';
import { REDIS_CLIENT } from '../redis/redis.module';

const PLATFORM_FEE_RATE = 0.20;
const NO_SHOW_WAIT_MINUTES = 5;
const DROPOFF_LOCK_RADIUS_MILES = 0.2;
const SURGE_COUNTER_TTL_SEC = 600; // 10-minute rolling window

// Standard-ride dispatch: how long a broadcast may go unanswered before the
// sweeper acts (driver card is 60s; +15s buffer), how many re-broadcasts are
// allowed, and how often the sweeper scans for stale searching trips.
const DISPATCH_WINDOW_MS = 75_000;
const MAX_REDISPATCHES = 2;
const DISPATCH_SWEEP_INTERVAL_MS = 15_000;
const NO_DRIVERS_REASON = 'no_drivers_available';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL ?? 'http://localhost:3007';

function getZoneKey(lat: number, lng: number): string {
  return `${Math.floor(lat / 0.018)}:${Math.floor(lng / 0.022)}`;
}

@Injectable()
export class TripsService implements OnModuleInit, OnModuleDestroy {
  private dispatchSweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: DispatchService,
    private readonly earningsFloor: EarningsFloorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    // DB-driven sweep — survives restarts and also cleans up any searching
    // trips orphaned before this service instance started.
    this.dispatchSweepTimer = setInterval(() => {
      this.sweepStaleSearchingTrips().catch((err) =>
        console.error('Dispatch sweep failed:', err),
      );
    }, DISPATCH_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.dispatchSweepTimer) clearInterval(this.dispatchSweepTimer);
  }

  async createTrip(userId: string, dto: CreateTripDto) {
    const rider = await this.resolveRider(userId);

    await this.assertNoActiveFraudHold(userId);

    // Fetch real trust score — used as a pricing feature. Default 500 for brand-new users only.
    const trustRecord = await this.prisma.trustScore.findUnique({
      where: { userId },
      select: { trustScore: true },
    });
    const riderTrustScore = trustRecord?.trustScore ?? 500;

    // Airport detection feeds both the trip record and the fare quote — the
    // pricing engine's airport premium only applies when this flag reaches it.
    const isAirportTrip = this.detectAirportTrip(dto.pickupAddress, dto.dropoffAddress);

    // Get AI fare from pricing service (internal HTTP call)
    const aiFare = await this.getPricingEstimate(dto, riderTrustScore, rider.totalTrips, isAirportTrip);
    const now = new Date();

    const trip = await this.prisma.trip.create({
      data: {
        riderId: rider.id,
        status: TripStatus.searching,
        rideType: dto.rideType ?? RideType.standard,
        pickupAddress: dto.pickupAddress,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        dropoffAddress: dto.dropoffAddress,
        dropoffLat: dto.dropoffLat,
        dropoffLng: dto.dropoffLng,
        aiFare,
        isNightRide: isNightRide(now),
        isAirportTrip,
        safetySession: {
          create: {
            isNightRide: isNightRide(now),
            isAirportTrip,
            checkInStatus: isNightRide(now) ? 'pending' : 'not_required',
          },
        },
      },
      include: { safetySession: true },
    });

    // Cache trip state for real-time access
    await this.redis.setex(`trip:${trip.id}:state`, 7200, TripStatus.searching);

    // Increment surge demand counter for pickup zone (fire-and-forget)
    const surgeKey = `surge:requests:${getZoneKey(dto.pickupLat, dto.pickupLng)}`;
    void this.redis.incr(surgeKey)
      .then(() => this.redis.expire(surgeKey, SURGE_COUNTER_TTL_SEC))
      .catch(() => {});

    // Begin dispatch (async — finds available drivers in zone)
    const dispatchDistanceMiles = this.haversineDistance(
      dto.pickupLat, dto.pickupLng,
      dto.dropoffLat, dto.dropoffLng,
    );
    const dispatchDurationMin = Math.round((dispatchDistanceMiles / 20) * 60);
    this.dispatch.broadcastRequest({
      ...trip,
      distanceMiles: dispatchDistanceMiles,
      durationMin: dispatchDurationMin,
      riderBadge: rider.currentBadge as string,
    }).catch(console.error);

    // Track dispatch attempts so the sweeper can re-broadcast or fail cleanly
    void this.redis.set(
      `trip:${trip.id}:dispatch`,
      JSON.stringify({ attempts: 0, lastDispatchAt: Date.now() }),
      'EX', 3600,
    ).catch(() => {});

    // Store planned route + compute safety score (fire-and-forget)
    void this.storeTripRouteSafety(
      trip.id,
      dto.pickupLat, dto.pickupLng,
      dto.dropoffLat, dto.dropoffLng,
      trip.isNightRide,
      trip.isAirportTrip,
    ).catch(() => {});

    return trip;
  }

  private async storeTripRouteSafety(
    tripId: string,
    pickupLat: number, pickupLng: number,
    dropoffLat: number, dropoffLng: number,
    isNightRide: boolean,
    isAirportTrip: boolean,
  ): Promise<void> {
    const SAFETY_URL = process.env.SAFETY_SERVICE_URL ?? 'http://localhost:3006';
    await fetch(`${SAFETY_URL}/internal/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.INTERNAL_SERVICE_KEY && { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }) },
      body: JSON.stringify({ tripId, pickupLat, pickupLng, dropoffLat, dropoffLng, isNightRide, isAirportTrip }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {}); // Graceful fallback — trip creation never blocked by this
  }

  async acceptTrip(tripId: string, userId: string) {
    const trip = await this.getActiveTrip(tripId);
    assertValidTransition(trip.status, TripStatus.accepted);

    const driver = await this.resolveDriver(userId);
    if (driver.status !== 'approved') {
      throw new ForbiddenException('Driver not approved.');
    }

    await this.assertNoActiveFraudHold(userId);

    // Atomic claim — prevent race condition with other drivers
    const claimed = await this.redis.set(
      `trip:${tripId}:claimed`,
      driver.id,
      'EX',
      30,
      'NX',
    );

    if (!claimed) {
      throw new BadRequestException({
        code: 'TRIP_ALREADY_CLAIMED',
        message: 'Trip already accepted by another driver.',
      });
    }

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        driverId: driver.id,
        status: TripStatus.accepted,
        acceptedAt: new Date(),
      },
    });

    await this.redis.setex(`trip:${tripId}:state`, 7200, TripStatus.accepted);

    // Fetch enriched driver info for rider notification
    const driverDetail = await this.prisma.driver.findUnique({
      where: { id: driver.id },
      include: {
        vehicles: { where: { isActive: true }, take: 1 },
        user: { select: { firstName: true, lastName: true, profilePhotoUrl: true } },
      },
    });

    const activeVehicle = driverDetail?.vehicles[0] ?? null;
    await this.dispatch.notifyRiderDriverAssigned(tripId, driver.id, {
      name: [driverDetail?.user?.firstName, driverDetail?.user?.lastName].filter(Boolean).join(' ') || 'Your Driver',
      badge: (driver.currentBadge as string) ?? 'Verified',
      vehicleMake: activeVehicle?.make,
      vehicleModel: activeVehicle?.model,
      vehicleColor: activeVehicle?.color,
      licensePlate: activeVehicle?.licensePlate,
      driverPhotoUrl: driverDetail?.user?.profilePhotoUrl ?? undefined,
    });

    return updated;
  }

  async markArrived(tripId: string, userId: string) {
    const trip = await this.getDriverTrip(tripId, userId);
    assertValidTransition(trip.status, TripStatus.driver_arrived);

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.driver_arrived },
    });

    await this.redis.setex(`trip:${tripId}:state`, 7200, TripStatus.driver_arrived);
    await this.dispatch.notifyRiderDriverArrived(tripId);

    return updated;
  }

  async startTrip(tripId: string, userId: string) {
    const trip = await this.getDriverTrip(tripId, userId);
    assertValidTransition(trip.status, TripStatus.in_progress);

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.in_progress, startedAt: new Date() },
    });

    await this.redis.setex(`trip:${tripId}:state`, 7200, TripStatus.in_progress);
    await this.dispatch.notifyRiderTripStarted(tripId);

    return updated;
  }

  async endTrip(tripId: string, userId: string, dto: EndTripDto) {
    const trip = await this.getDriverTrip(tripId, userId);
    assertValidTransition(trip.status, TripStatus.completed);

    // Enforce minimum proximity before allowing end
    const distanceToDropoff = this.haversineDistance(
      dto.currentLat, dto.currentLng,
      Number(trip.dropoffLat), Number(trip.dropoffLng),
    );

    if (distanceToDropoff > DROPOFF_LOCK_RADIUS_MILES) {
      throw new BadRequestException({
        code: 'TRIP_TOO_FAR_FROM_DROPOFF',
        message: `Must be within ${DROPOFF_LOCK_RADIUS_MILES} mile of dropoff to end trip.`,
      });
    }

    const completedAt = new Date();
    const actualDurationMin = trip.startedAt
      ? Math.round((completedAt.getTime() - trip.startedAt.getTime()) / 60000)
      : null;

    const finalFare = Number(trip.aiFare); // Use AI fare (bid resolves separately)
    const platformFee = finalFare * PLATFORM_FEE_RATE;
    const driverEarnings = finalFare - platformFee;

    // Enforce earnings floor (absorbs supplement from platform)
    const floorResult = await this.earningsFloor.enforce(trip, driverEarnings, actualDurationMin);

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        status: TripStatus.completed,
        completedAt,
        actualDurationMin,
        finalFare,
        platformFee,
        driverEarnings: floorResult.totalDriverEarnings,
        earningsFloorMet: floorResult.floorMet,
        earningsSupplement: floorResult.supplement,
      },
    });

    await this.redis.del(`trip:${tripId}:state`);
    await this.redis.del(`trip:${tripId}:claimed`);
    await this.dispatch.notifyTripCompleted(tripId, finalFare, floorResult);

    // Fire-and-forget: charge rider for completed trip (non-bid standard trip path)
    this.chargeRiderForTrip(tripId, trip.riderId, finalFare);

    // Fire-and-forget: credit driver wallet with take-home earnings
    this.creditDriverWalletForTrip(trip.driverId, tripId, floorResult.totalDriverEarnings);

    // Fire-and-forget: recalculate trust scores for both parties post-trip
    this.scheduleTrustRefresh(trip.riderId, trip.driverId);

    // Fire-and-forget: record bid outcome for AI training data pipeline
    this.recordBidOutcome(trip, finalFare, floorResult.totalDriverEarnings, platformFee);

    return updated;
  }

  async cancelTrip(tripId: string, userId: string, reason?: string) {
    const trip = await this.getActiveTrip(tripId);

    if (isTerminal(trip.status)) {
      throw new BadRequestException({
        code: 'TRIP_INVALID_STATE',
        message: 'Trip is already in a terminal state.',
      });
    }

    // Resolve rider id from userId for comparison
    const rider = await this.prisma.rider.findUnique({ where: { userId } });
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    const riderId = rider?.id;
    const driverId = driver?.id;

    // Only rider can cancel pre-acceptance; either party post-acceptance
    if (trip.status === TripStatus.searching && trip.riderId !== riderId) {
      throw new ForbiddenException('Only the rider can cancel before acceptance.');
    }

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.cancelled, cancelledAt: new Date(), cancelReason: reason },
    });

    await this.redis.del(`trip:${tripId}:state`);
    void this.dispatch.notifyDriverTripCancelled(tripId);
    return updated;
  }

  async rateDriver(tripId: string, userId: string, dto: RateTripDto) {
    const rider = await this.resolveRider(userId);
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.riderId !== rider.id) throw new NotFoundException('Trip not found.');
    if (trip.status !== TripStatus.completed) {
      throw new BadRequestException('Can only rate completed trips.');
    }
    if (trip.riderRatingDriver !== null) {
      throw new BadRequestException('Trip already rated.');
    }

    await this.prisma.trip.update({
      where: { id: tripId },
      data: { riderRatingDriver: dto.rating },
    });

    await this.prisma.rating.upsert({
      where: { tripId },
      create: {
        tripId,
        riderId: rider.id,
        riderToDriver: dto.rating,
        riderComment: dto.comment ?? null,
      },
      update: {
        riderToDriver: dto.rating,
        riderComment: dto.comment ?? null,
      },
    });

    // Recalculate driver's average rating across all rated completed trips
    if (trip.driverId) {
      const avg = await this.prisma.trip.aggregate({
        where: { driverId: trip.driverId, riderRatingDriver: { not: null } },
        _avg: { riderRatingDriver: true },
      });
      if (avg._avg.riderRatingDriver !== null) {
        await this.prisma.driver.update({
          where: { id: trip.driverId },
          data: { avgRating: avg._avg.riderRatingDriver },
        });
      }
    }

    // Fire-and-forget: recalculate driver trust after a new rating lands
    if (trip.driverId) {
      this.scheduleTrustRefresh(trip.riderId, trip.driverId);
    }

    // Fire-and-forget: notify driver they received a rating (no score, no comment)
    void this.dispatch.notifyDriverRatingReceived(tripId);

    return { success: true };
  }

  async rateRider(tripId: string, userId: string, dto: RateRiderDto) {
    const driver = await this.resolveDriver(userId);
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.driverId !== driver.id) throw new NotFoundException('Trip not found.');
    if (trip.status !== TripStatus.completed) {
      throw new BadRequestException('Can only rate completed trips.');
    }
    if (trip.driverRatingRider !== null) {
      throw new BadRequestException('Rider already rated.');
    }

    await this.prisma.trip.update({
      where: { id: tripId },
      data: { driverRatingRider: dto.rating },
    });

    await this.prisma.rating.upsert({
      where: { tripId },
      create: {
        tripId,
        riderId: trip.riderId,
        driverToRider: dto.rating,
        driverComment: dto.comment ?? null,
        riderFlagged: dto.flagRider ?? false,
      },
      update: {
        driverToRider: dto.rating,
        driverComment: dto.comment ?? null,
        riderFlagged: dto.flagRider ?? false,
      },
    });

    this.scheduleTrustRefresh(trip.riderId, trip.driverId);

    return { success: true };
  }

  async markNoShow(tripId: string, userId: string) {
    const trip = await this.getDriverTrip(tripId, userId);
    if (trip.status !== TripStatus.driver_arrived) {
      throw new BadRequestException('Driver must be marked arrived before no-show.');
    }

    const arrivedEvent = await this.prisma.tripEvent.findFirst({
      where: { tripId, eventType: 'driver_arrived' },
      orderBy: { createdAt: 'desc' },
    });

    if (!arrivedEvent) throw new BadRequestException('Arrival not recorded.');

    const minutesSinceArrival = (Date.now() - arrivedEvent.createdAt.getTime()) / 60000;
    if (minutesSinceArrival < NO_SHOW_WAIT_MINUTES) {
      throw new BadRequestException({
        code: 'NO_SHOW_TOO_EARLY',
        message: `Must wait ${NO_SHOW_WAIT_MINUTES} minutes after arrival before marking no-show.`,
      });
    }

    return this.prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.no_show, cancelledAt: new Date() },
    });
  }

  async listRiderTrips(userId: string, limit: number, offset: number) {
    const rider = await this.prisma.rider.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!rider) throw new NotFoundException('Rider not found.');

    const trips = await this.prisma.trip.findMany({
      where: { riderId: rider.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        pickupAddress: true,
        dropoffAddress: true,
        finalFare: true,
        status: true,
        completedAt: true,
      },
    });

    return {
      trips: trips.map(t => ({
        ...t,
        finalFare: t.finalFare ? Number(t.finalFare) : null,
        completedAt: t.completedAt?.toISOString() ?? null,
      })),
    };
  }

  async getTripById(tripId: string, userId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { rider: true, driver: true, vehicle: true, safetySession: true },
    });

    if (!trip) throw new NotFoundException('Trip not found.');

    const rider = await this.prisma.rider.findUnique({ where: { userId } });
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    const isRider = trip.riderId === rider?.id;
    const isDriver = trip.driverId === driver?.id;
    if (!isRider && !isDriver) throw new ForbiddenException('Access denied.');

    return trip;
  }

  // Cold-start rehydration: the single in-flight trip the caller participates
  // in (as rider or driver), shaped for the mobile apps. Read-only.
  async getActiveTripForUser(userId: string) {
    const [rider, driver] = await Promise.all([
      this.prisma.rider.findUnique({ where: { userId }, select: { id: true } }),
      this.prisma.driver.findUnique({ where: { userId }, select: { id: true } }),
    ]);
    if (!rider && !driver) return { trip: null };

    const trip = await this.prisma.trip.findFirst({
      where: {
        status: {
          in: [
            TripStatus.searching,
            TripStatus.accepted,
            TripStatus.driver_en_route,
            TripStatus.driver_arrived,
            TripStatus.in_progress,
          ],
        },
        OR: [
          ...(rider ? [{ riderId: rider.id }] : []),
          ...(driver ? [{ driverId: driver.id }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        rider: { select: { displayName: true } },
        driver: {
          include: {
            vehicles: { where: { isActive: true }, take: 1 },
            user: { select: { firstName: true, lastName: true, profilePhotoUrl: true } },
          },
        },
      },
    });
    if (!trip) return { trip: null };

    const vehicle = trip.driver?.vehicles[0] ?? null;
    return {
      trip: {
        id: trip.id,
        status: trip.status,
        role: driver && trip.driverId === driver.id ? 'driver' : 'rider',
        pickupAddress: trip.pickupAddress,
        dropoffAddress: trip.dropoffAddress,
        pickupLat: Number(trip.pickupLat),
        pickupLng: Number(trip.pickupLng),
        dropoffLat: Number(trip.dropoffLat),
        dropoffLng: Number(trip.dropoffLng),
        aiFare: Number(trip.aiFare),
        riderName: trip.rider?.displayName ?? 'Rider',
        driver: trip.driver
          ? {
              name:
                [trip.driver.user?.firstName, trip.driver.user?.lastName].filter(Boolean).join(' ') ||
                'Your Driver',
              badge: (trip.driver.currentBadge as string) ?? 'Verified',
              vehicleMake: vehicle?.make,
              vehicleModel: vehicle?.model,
              vehicleColor: vehicle?.color,
              licensePlate: vehicle?.licensePlate,
              photoUrl: trip.driver.user?.profilePhotoUrl ?? undefined,
            }
          : null,
      },
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async getActiveTrip(tripId: string) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found.');
    return trip;
  }

  private async getDriverTrip(tripId: string, userId: string) {
    const driver = await this.resolveDriver(userId);
    const trip = await this.getActiveTrip(tripId);
    if (trip.driverId !== driver.id) throw new ForbiddenException('Not your trip.');
    return trip;
  }

  private async resolveRider(userId: string) {
    const rider = await this.prisma.rider.findUnique({ where: { userId } });
    if (!rider) throw new NotFoundException('Rider not found.');
    return rider;
  }

  private async resolveDriver(userId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver not found.');
    return driver;
  }

  private async getPricingEstimate(
    dto: CreateTripDto,
    riderTrustScore: number,
    riderTotalTrips: number,
    isAirportTrip: boolean,
  ): Promise<number> {
    const PRICING_SERVICE_URL = process.env.PRICING_SERVICE_URL ?? 'http://localhost:3005';
    const response = await fetch(`${PRICING_SERVICE_URL}/pricing/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.INTERNAL_SERVICE_KEY && { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }) },
      body: JSON.stringify({
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        dropoffLat: dto.dropoffLat,
        dropoffLng: dto.dropoffLng,
        rideType: dto.rideType ?? 'standard',
        isAirportTrip,
        riderTrustScore,
        riderTotalTrips,
      }),
    });

    if (!response.ok) throw new BadRequestException('Pricing service unavailable.');
    const data = await response.json() as { fare: number };
    return data.fare;
  }

  private async assertNoActiveFraudHold(userId: string): Promise<void> {
    const hold = await this.prisma.fraudAlert.findFirst({
      where: { userId, holdReleasedAt: null },
      select: { id: true },
    });
    if (hold) {
      throw new ForbiddenException({
        code: 'ACCOUNT_UNDER_REVIEW',
        message: 'Your account is under safety review. Please contact support.',
      });
    }
  }

  private scheduleTrustRefresh(riderId: string, driverId: string | null): void {
    const TRUST_URL = process.env.TRUST_SERVICE_URL ?? 'http://localhost:3009';

    void (async () => {
      try {
        const rider = await this.prisma.rider.findUnique({
          where: { id: riderId },
          select: { userId: true },
        });
        if (rider?.userId) {
          await fetch(`${TRUST_URL}/internal/trust/recalculate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(process.env.INTERNAL_SERVICE_KEY && { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }) },
            body: JSON.stringify({ userId: rider.userId }),
          });
        }
      } catch {}
    })();

    if (driverId) {
      void (async () => {
        try {
          const driver = await this.prisma.driver.findUnique({
            where: { id: driverId },
            select: { userId: true },
          });
          if (driver?.userId) {
            await fetch(`${TRUST_URL}/internal/trust/recalculate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(process.env.INTERNAL_SERVICE_KEY && { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }) },
              body: JSON.stringify({ userId: driver.userId }),
            });
          }
        } catch {}
      })();
    }
  }

  private recordBidOutcome(
    trip: { id: string; bidId?: string | null; pickupLat: unknown; pickupLng: unknown; acceptedAt: Date | null; createdAt: Date },
    finalFare: number,
    driverEarnings: number,
    platformFee: number,
  ): void {
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL;
    if (!AI_SERVICE_URL) return;

    const pickupLat = Number(trip.pickupLat);
    const pickupLng = Number(trip.pickupLng);
    const zoneKey = !isNaN(pickupLat) && !isNaN(pickupLng)
      ? getZoneKey(pickupLat, pickupLng)
      : undefined;
    const timeToAcceptanceMs =
      trip.acceptedAt ? trip.acceptedAt.getTime() - trip.createdAt.getTime() : undefined;

    void fetch(`${AI_SERVICE_URL}/ai/bid-outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.INTERNAL_SERVICE_KEY && { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }) },
      body: JSON.stringify({
        tripId: trip.id,
        bidId: trip.bidId ?? undefined,
        zoneKey,
        wasAccepted: true,
        timeToAcceptanceMs,
        finalFare,
        finalAcceptedAmount: finalFare,
        driverEarnings,
        platformFee,
      }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }

  private detectAirportTrip(pickup: string, dropoff: string): boolean {
    const airportTerms = ['EWR', 'Newark Airport', 'Newark Liberty', 'Terminal A', 'Terminal B', 'Terminal C'];
    return airportTerms.some(
      (term) => pickup.includes(term) || dropoff.includes(term),
    );
  }

  // ─── Standard-ride redispatch / no-drivers timeout ───────────────────────

  private async sweepStaleSearchingTrips(): Promise<void> {
    const staleBefore = new Date(Date.now() - DISPATCH_WINDOW_MS);
    const staleTrips = await this.prisma.trip.findMany({
      where: { status: TripStatus.searching, createdAt: { lt: staleBefore } },
      include: { rider: { select: { currentBadge: true } } },
      take: 20,
    });

    for (const trip of staleTrips) {
      const metaRaw = await this.redis.get(`trip:${trip.id}:dispatch`);
      // No metadata (pre-feature orphan or Redis restart): fail rather than
      // re-broadcast a request of unknown age.
      const meta = metaRaw
        ? (JSON.parse(metaRaw) as { attempts: number; lastDispatchAt: number })
        : { attempts: MAX_REDISPATCHES, lastDispatchAt: 0 };

      if (Date.now() - meta.lastDispatchAt < DISPATCH_WINDOW_MS) continue;

      if (meta.attempts < MAX_REDISPATCHES) {
        await this.redispatchTrip(trip, meta.attempts + 1);
      } else {
        await this.failTripNoDrivers(trip.id);
      }
    }
  }

  private async redispatchTrip(
    trip: {
      id: string;
      pickupAddress: string;
      dropoffAddress: string;
      pickupLat: unknown;
      pickupLng: unknown;
      dropoffLat: unknown;
      dropoffLng: unknown;
      aiFare: unknown;
      rideType: string;
      isAirportTrip: boolean;
      rider: { currentBadge: string } | null;
    },
    attempt: number,
  ): Promise<void> {
    const distanceMiles = this.haversineDistance(
      Number(trip.pickupLat), Number(trip.pickupLng),
      Number(trip.dropoffLat), Number(trip.dropoffLng),
    );
    const durationMin = Math.round((distanceMiles / 20) * 60);

    await this.dispatch.broadcastRequest({
      ...trip,
      distanceMiles,
      durationMin,
      riderBadge: (trip.rider?.currentBadge as string) ?? 'verified',
    });

    await this.redis.set(
      `trip:${trip.id}:dispatch`,
      JSON.stringify({ attempts: attempt, lastDispatchAt: Date.now() }),
      'EX', 3600,
    );

    await this.dispatch.notifyRiderSearchingUpdate(trip.id, attempt);
  }

  private async failTripNoDrivers(tripId: string): Promise<void> {
    // Guard against a driver accepting between the sweep query and this write
    const { count } = await this.prisma.trip.updateMany({
      where: { id: tripId, status: TripStatus.searching },
      data: {
        status: TripStatus.cancelled,
        cancelledAt: new Date(),
        cancelReason: NO_DRIVERS_REASON,
      },
    });
    if (count === 0) return;

    await this.redis.del(`trip:${tripId}:state`, `trip:${tripId}:dispatch`);
    await this.dispatch.notifyRiderNoDrivers(tripId);
  }

  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3958.8; // Earth radius in miles
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private chargeRiderForTrip(tripId: string, riderId: string, amount: number): void {
    void (async () => {
      try {
        await fetch(`${PAYMENT_SERVICE_URL}/payments/internal/charge-trip`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.INTERNAL_SERVICE_KEY && { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }),
          },
          body: JSON.stringify({ tripId, riderId, amount }),
          signal: AbortSignal.timeout(10000),
        });
      } catch { /* fire-and-forget — trip completion is not gated on payment */ }
    })();
  }

  private creditDriverWalletForTrip(driverId: string | null, tripId: string, amount: number): void {
    if (!driverId || amount <= 0) return;
    void (async () => {
      try {
        await fetch(`${PAYMENT_SERVICE_URL}/payments/internal/credit-wallet`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.INTERNAL_SERVICE_KEY && { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }),
          },
          body: JSON.stringify({ driverId, tripId, amount }),
          signal: AbortSignal.timeout(5000),
        });
      } catch { /* fire-and-forget — wallet credit is eventually consistent */ }
    })();
  }
}
