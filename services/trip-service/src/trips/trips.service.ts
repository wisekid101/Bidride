import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { TripStatus, RideType } from '@bidride/database/generated/client';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { DispatchService } from './dispatch.service';
import { EarningsFloorService } from './earnings-floor.service';
import { assertValidTransition, isNightRide, isTerminal } from './trip-state-machine';
import { CreateTripDto, EndTripDto, RateTripDto } from './dto';
import { REDIS_CLIENT } from '../redis/redis.module';

const PLATFORM_FEE_RATE = 0.20;
const NO_SHOW_WAIT_MINUTES = 5;
const DROPOFF_LOCK_RADIUS_MILES = 0.2;
const SURGE_COUNTER_TTL_SEC = 600; // 10-minute rolling window

function getZoneKey(lat: number, lng: number): string {
  return `${Math.floor(lat / 0.018)}:${Math.floor(lng / 0.022)}`;
}

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: DispatchService,
    private readonly earningsFloor: EarningsFloorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async createTrip(userId: string, dto: CreateTripDto) {
    const rider = await this.resolveRider(userId);

    await this.assertNoActiveFraudHold(userId);

    // Fetch real trust score — used as a pricing feature. Default 500 for brand-new users only.
    const trustRecord = await this.prisma.trustScore.findUnique({
      where: { userId },
      select: { trustScore: true },
    });
    const riderTrustScore = trustRecord?.trustScore ?? 500;

    // Get AI fare from pricing service (internal HTTP call)
    const aiFare = await this.getPricingEstimate(dto, riderTrustScore, rider.totalTrips);
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
        isAirportTrip: this.detectAirportTrip(dto.pickupAddress, dto.dropoffAddress),
        safetySession: {
          create: {
            isNightRide: isNightRide(now),
            isAirportTrip: this.detectAirportTrip(dto.pickupAddress, dto.dropoffAddress),
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
    this.dispatch.broadcastRequest(trip).catch(console.error);

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
        user: { select: { firstName: true, lastName: true } },
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

    const updatedTrip = await this.prisma.trip.update({
      where: { id: tripId },
      data: { riderRatingDriver: dto.rating },
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

    return updatedTrip;
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
    trip: { id: string; pickupLat: unknown; pickupLng: unknown; acceptedAt: Date | null; createdAt: Date },
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

  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3958.8; // Earth radius in miles
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
