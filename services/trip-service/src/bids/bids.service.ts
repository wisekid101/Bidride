import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { BidStatus, TripStatus, RideType } from '@bidride/database/generated/client';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { DispatchService } from '../trips/dispatch.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SubmitBidDto, CounterBidDto } from './bids.dto';
import {
  assertValidBidTransition,
  isBidTerminal,
  MAX_COUNTER_ROUNDS,
  BID_TTL_SECONDS,
  COUNTER_TTL_SECONDS,
  BID_FLOOR_RATE,
} from './bid-state-machine';

const EXPIRY_SWEEP_INTERVAL_MS = 30_000;
const PLATFORM_FEE_RATE = 0.20;

@Injectable()
export class BidsService implements OnModuleInit {
  private readonly logger = new Logger(BidsService.name);
  private sweepInterval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: DispatchService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    this.sweepInterval = setInterval(
      () => { this.sweepExpiredBids().catch((e: unknown) => this.logger.error('Expiry sweep error', e)); },
      EXPIRY_SWEEP_INTERVAL_MS,
    );
  }

  // ─── Submit Bid (Rider) ───────────────────────────────────────────────────

  async submitBid(userId: string, dto: SubmitBidDto) {
    const rider = await this.resolveRider(userId);

    // Fetch standard fare from pricing-service
    const standardFare = await this.fetchStandardFare(dto);

    // Enforce bid floor and ceiling
    const bidFloor = parseFloat((standardFare * BID_FLOOR_RATE).toFixed(2));
    if (dto.bidAmount < bidFloor) {
      throw new BadRequestException({
        code: 'BID_BELOW_FLOOR',
        message: `Bid must be at least $${bidFloor.toFixed(2)} (${Math.round(BID_FLOOR_RATE * 100)}% of the standard fare).`,
      });
    }
    if (dto.bidAmount >= standardFare) {
      throw new BadRequestException({
        code: 'BID_AT_OR_ABOVE_STANDARD',
        message: 'Bid amount must be less than the standard fare. Use a standard ride instead.',
      });
    }

    const expiresAt = new Date(Date.now() + BID_TTL_SECONDS * 1000);
    const now = new Date();
    const isAirportTrip = this.detectAirportTrip(dto.pickupAddress, dto.dropoffAddress);

    // Create Stripe authorization hold for the full standard fare amount so any
    // accepted outcome (bid or counter up to standard fare) is covered.
    const paymentIntentId = await this.createStripeHold(
      rider.stripeCustomerId,
      dto.paymentMethodId,
      standardFare,
    );

    // Create trip + bid atomically in a transaction
    const { trip, bid } = await this.prisma.$transaction(async (tx) => {
      const t = await tx.trip.create({
        data: {
          riderId: rider.id,
          status: TripStatus.searching,
          rideType: RideType.standard,
          pickupAddress: dto.pickupAddress,
          pickupLat: dto.pickupLat,
          pickupLng: dto.pickupLng,
          dropoffAddress: dto.dropoffAddress,
          dropoffLat: dto.dropoffLat,
          dropoffLng: dto.dropoffLng,
          aiFare: standardFare,
          isAirportTrip,
          isNightRide: this.isNightRide(now),
          safetySession: {
            create: {
              isNightRide: this.isNightRide(now),
              isAirportTrip,
              checkInStatus: this.isNightRide(now) ? 'pending' : 'not_required',
            },
          },
        },
      });

      const b = await tx.bid.create({
        data: {
          tripId: t.id,
          riderId: rider.id,
          aiFare: standardFare,
          riderOffer: dto.bidAmount,
          status: BidStatus.pending,
          expiresAt,
        },
      });

      await tx.tripEvent.create({
        data: {
          tripId: t.id,
          eventType: 'bid_submitted',
          lat: dto.pickupLat,
          lng: dto.pickupLng,
          metadata: {
            bidId: b.id,
            bidAmount: dto.bidAmount,
            standardFare,
            bidFloor,
            paymentIntentId,
          },
        },
      });

      return { trip: t, bid: b };
    });

    // Store payment intent in Redis for capture/void later
    await this.redis.setex(
      `bid:${bid.id}:pi`,
      BID_TTL_SECONDS + 300,
      paymentIntentId,
    );
    // Cache trip state
    await this.redis.setex(`trip:${trip.id}:state`, 7200, TripStatus.searching);

    // Compute approximate trip distance and duration for the driver card
    const distanceMiles = this.haversineDistance(dto.pickupLat, dto.pickupLng, dto.dropoffLat, dto.dropoffLng);
    const durationMin = Math.max(3, Math.round(distanceMiles * 2.5));

    // Geo-filter: only broadcast to nearby online drivers
    const targetDriverUserIds = await this.findNearbyDriverUserIds(
      dto.pickupLat,
      dto.pickupLng,
      isAirportTrip,
    );

    await this.dispatch.broadcastBidRequest(
      trip, bid, standardFare, bidFloor, distanceMiles, durationMin, 'Verified', targetDriverUserIds,
    );

    this.logger.log(`Bid ${bid.id} submitted: $${dto.bidAmount} (standard $${standardFare})`);

    return {
      bidId: bid.id,
      tripId: trip.id,
      bidAmount: dto.bidAmount,
      standardFare,
      bidFloor,
      expiresAt,
    };
  }

  // ─── Driver: Accept Bid ───────────────────────────────────────────────────

  async driverAcceptBid(bidId: string, userId: string) {
    const driver = await this.resolveDriver(userId);
    const bid = await this.getActiveBid(bidId);

    if (bid.status !== BidStatus.pending) {
      throw new BadRequestException({ code: 'BID_NOT_PENDING', message: 'Bid is not in pending status.' });
    }

    // Atomic claim — only one driver can accept
    const claimed = await this.redis.set(
      `bid:${bidId}:claimed`,
      driver.id,
      'EX',
      60,
      'NX',
    );
    if (!claimed) {
      throw new BadRequestException({ code: 'BID_ALREADY_CLAIMED', message: 'Another driver already responded to this bid.' });
    }

    assertValidBidTransition(bid.status, BidStatus.accepted);
    const finalFare = Number(bid.riderOffer);
    const platformFee = parseFloat((finalFare * PLATFORM_FEE_RATE).toFixed(2));
    const driverEarnings = parseFloat((finalFare - platformFee).toFixed(2));

    await this.prisma.$transaction(async (tx) => {
      await tx.bid.update({
        where: { id: bidId },
        data: {
          driverId: driver.id,
          finalFare,
          status: BidStatus.accepted,
          resolvedAt: new Date(),
        },
      });

      await tx.trip.update({
        where: { id: bid.tripId },
        data: {
          driverId: driver.id,
          bidId,
          status: TripStatus.accepted,
          acceptedAt: new Date(),
          finalFare,
          platformFee,
          driverEarnings,
        },
      });

      await tx.tripEvent.create({
        data: {
          tripId: bid.tripId,
          eventType: 'bid_accepted_by_driver',
          metadata: { bidId, driverId: driver.id, finalFare },
        },
      });
    });

    await this.captureStripeHold(bidId, finalFare);
    await this.redis.setex(`trip:${bid.tripId}:state`, 7200, TripStatus.accepted);
    await this.dispatch.notifyBidAcceptedByDriver(bid.tripId, bidId, driver, finalFare);

    this.logger.log(`Bid ${bidId} accepted by driver ${driver.id} at $${finalFare}`);
    return { bidId, status: BidStatus.accepted, finalFare };
  }

  // ─── Driver: Decline Bid ─────────────────────────────────────────────────

  async driverDeclineBid(bidId: string, userId: string) {
    const driver = await this.resolveDriver(userId);
    const bid = await this.getActiveBid(bidId);

    if (bid.status !== BidStatus.pending) {
      throw new BadRequestException({ code: 'BID_NOT_PENDING', message: 'Bid is not in pending status.' });
    }

    // Atomic claim for decline too — prevents race where another driver is accepting
    const claimed = await this.redis.set(
      `bid:${bidId}:declined:${driver.id}`,
      '1',
      'EX',
      30,
      'NX',
    );
    if (!claimed) return { bidId, status: 'already_processed' };

    assertValidBidTransition(bid.status, BidStatus.declined);

    await this.prisma.$transaction(async (tx) => {
      await tx.bid.update({
        where: { id: bidId },
        data: { driverId: driver.id, status: BidStatus.declined, resolvedAt: new Date() },
      });
      await tx.tripEvent.create({
        data: {
          tripId: bid.tripId,
          eventType: 'bid_declined_by_driver',
          metadata: { bidId, driverId: driver.id },
        },
      });
    });

    await this.voidStripeHold(bidId);
    await this.dispatch.notifyBidDeclinedByDriver(bid.tripId, bidId);

    this.logger.log(`Bid ${bidId} declined by driver ${driver.id}`);
    return { bidId, status: BidStatus.declined };
  }

  // ─── Driver: Counter Bid ─────────────────────────────────────────────────

  async driverCounterBid(bidId: string, userId: string, dto: CounterBidDto) {
    const driver = await this.resolveDriver(userId);
    const bid = await this.getActiveBid(bidId);

    if (bid.status !== BidStatus.pending) {
      throw new BadRequestException({ code: 'BID_NOT_PENDING', message: 'Bid is not in pending status.' });
    }

    if (bid.counterRound >= MAX_COUNTER_ROUNDS) {
      throw new BadRequestException({
        code: 'BID_MAX_COUNTERS_REACHED',
        message: `Maximum of ${MAX_COUNTER_ROUNDS} counter rounds reached.`,
      });
    }

    if (dto.counterAmount <= Number(bid.riderOffer)) {
      throw new BadRequestException({
        code: 'COUNTER_TOO_LOW',
        message: 'Counter must be higher than the rider\'s bid.',
      });
    }

    if (dto.counterAmount >= Number(bid.aiFare)) {
      throw new BadRequestException({
        code: 'COUNTER_AT_OR_ABOVE_STANDARD',
        message: 'Counter cannot equal or exceed the standard fare.',
      });
    }

    // Atomic claim — one driver counters per bid
    const claimed = await this.redis.set(`bid:${bidId}:claimed`, driver.id, 'EX', COUNTER_TTL_SECONDS + 30, 'NX');
    if (!claimed) {
      throw new BadRequestException({ code: 'BID_ALREADY_CLAIMED', message: 'Another driver already responded to this bid.' });
    }

    assertValidBidTransition(bid.status, BidStatus.countered);
    const newExpiresAt = new Date(Date.now() + COUNTER_TTL_SECONDS * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.bid.update({
        where: { id: bidId },
        data: {
          driverId: driver.id,
          counterOffer: dto.counterAmount,
          counterRound: { increment: 1 },
          status: BidStatus.countered,
          expiresAt: newExpiresAt,
        },
      });

      await tx.tripEvent.create({
        data: {
          tripId: bid.tripId,
          eventType: 'bid_countered_by_driver',
          metadata: {
            bidId,
            driverId: driver.id,
            counterAmount: dto.counterAmount,
            counterRound: bid.counterRound + 1,
          },
        },
      });
    });

    await this.dispatch.notifyRiderBidCountered(
      bid.tripId,
      bidId,
      driver,
      dto.counterAmount,
      newExpiresAt,
    );

    this.logger.log(`Bid ${bidId} countered by driver ${driver.id}: $${dto.counterAmount} (round ${bid.counterRound + 1})`);

    return {
      bidId,
      status: BidStatus.countered,
      counterAmount: dto.counterAmount,
      counterRound: bid.counterRound + 1,
      expiresAt: newExpiresAt,
    };
  }

  // ─── Rider: Accept Counter ────────────────────────────────────────────────

  async riderAcceptCounter(bidId: string, userId: string) {
    const rider = await this.resolveRider(userId);
    const bid = await this.getActiveBid(bidId);

    if (bid.riderId !== rider.id) throw new ForbiddenException('Not your bid.');
    if (bid.status !== BidStatus.countered) {
      throw new BadRequestException({ code: 'BID_NOT_COUNTERED', message: 'No counter offer to accept.' });
    }
    if (!bid.driverId || !bid.counterOffer) {
      throw new BadRequestException({ code: 'BID_MISSING_COUNTER', message: 'Counter offer data is missing.' });
    }

    assertValidBidTransition(bid.status, BidStatus.accepted);
    const finalFare = Number(bid.counterOffer);
    const platformFee = parseFloat((finalFare * PLATFORM_FEE_RATE).toFixed(2));
    const driverEarnings = parseFloat((finalFare - platformFee).toFixed(2));

    await this.prisma.$transaction(async (tx) => {
      await tx.bid.update({
        where: { id: bidId },
        data: { finalFare, status: BidStatus.accepted, resolvedAt: new Date() },
      });

      await tx.trip.update({
        where: { id: bid.tripId },
        data: {
          driverId: bid.driverId!,
          bidId,
          status: TripStatus.accepted,
          acceptedAt: new Date(),
          finalFare,
          platformFee,
          driverEarnings,
        },
      });

      await tx.tripEvent.create({
        data: {
          tripId: bid.tripId,
          eventType: 'counter_accepted_by_rider',
          metadata: { bidId, finalFare, counterRound: bid.counterRound },
        },
      });
    });

    await this.captureStripeHold(bidId, finalFare);
    await this.redis.setex(`trip:${bid.tripId}:state`, 7200, TripStatus.accepted);
    await this.dispatch.notifyDriverCounterAccepted(bid.tripId, bidId, bid.driverId, finalFare);

    this.logger.log(`Counter on bid ${bidId} accepted by rider at $${finalFare}`);
    return { bidId, status: BidStatus.accepted, finalFare };
  }

  // ─── Rider: Decline Counter ───────────────────────────────────────────────

  async riderDeclineCounter(bidId: string, userId: string) {
    const rider = await this.resolveRider(userId);
    const bid = await this.getActiveBid(bidId);

    if (bid.riderId !== rider.id) throw new ForbiddenException('Not your bid.');
    if (bid.status !== BidStatus.countered) {
      throw new BadRequestException({ code: 'BID_NOT_COUNTERED', message: 'No counter offer to decline.' });
    }

    assertValidBidTransition(bid.status, BidStatus.declined);

    await this.prisma.$transaction(async (tx) => {
      await tx.bid.update({
        where: { id: bidId },
        data: { status: BidStatus.declined, resolvedAt: new Date() },
      });
      await tx.tripEvent.create({
        data: {
          tripId: bid.tripId,
          eventType: 'counter_declined_by_rider',
          metadata: { bidId, counterRound: bid.counterRound },
        },
      });
    });

    await this.voidStripeHold(bidId);
    await this.dispatch.notifyDriverCounterDeclined(bid.tripId, bidId, bid.driverId!);

    this.logger.log(`Counter on bid ${bidId} declined by rider`);
    return { bidId, status: BidStatus.declined };
  }

  // ─── Rider: Withdraw Bid ─────────────────────────────────────────────────

  async withdrawBid(bidId: string, userId: string) {
    const rider = await this.resolveRider(userId);
    const bid = await this.getActiveBid(bidId);

    if (bid.riderId !== rider.id) throw new ForbiddenException('Not your bid.');
    if (isBidTerminal(bid.status)) {
      throw new BadRequestException({ code: 'BID_ALREADY_RESOLVED', message: 'Bid is already resolved.' });
    }
    if (bid.status === BidStatus.countered) {
      throw new BadRequestException({
        code: 'BID_COUNTERED_CANNOT_WITHDRAW',
        message: 'Cannot withdraw a bid with a pending counter offer. Accept or decline the counter instead.',
      });
    }

    assertValidBidTransition(bid.status, BidStatus.withdrawn);

    await this.prisma.$transaction(async (tx) => {
      await tx.bid.update({
        where: { id: bidId },
        data: { status: BidStatus.withdrawn, resolvedAt: new Date() },
      });
      await tx.trip.update({
        where: { id: bid.tripId },
        data: { status: TripStatus.cancelled, cancelledAt: new Date(), cancelReason: 'bid_withdrawn' },
      });
      await tx.tripEvent.create({
        data: {
          tripId: bid.tripId,
          eventType: 'bid_withdrawn_by_rider',
          metadata: { bidId },
        },
      });
    });

    await this.voidStripeHold(bidId);
    this.logger.log(`Bid ${bidId} withdrawn by rider`);
    return { bidId, status: BidStatus.withdrawn };
  }

  // ─── Get Bid ──────────────────────────────────────────────────────────────

  async getBid(bidId: string, userId: string) {
    const bid = await this.prisma.bid.findUnique({ where: { id: bidId } });
    if (!bid) throw new NotFoundException('Bid not found.');

    const rider = await this.prisma.rider.findUnique({ where: { userId } });
    const driver = await this.prisma.driver.findUnique({ where: { userId } });

    const isRider = bid.riderId === rider?.id;
    const isDriver = bid.driverId === driver?.id;
    if (!isRider && !isDriver) throw new ForbiddenException('Access denied.');

    return bid;
  }

  // ─── Expiration Sweep (Background) ───────────────────────────────────────

  async sweepExpiredBids(): Promise<void> {
    const expiredBids = await this.prisma.bid.findMany({
      where: {
        status: { in: [BidStatus.pending, BidStatus.countered] },
        expiresAt: { lte: new Date() },
      },
    });

    for (const bid of expiredBids) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.bid.update({
            where: { id: bid.id },
            data: { status: BidStatus.expired, resolvedAt: new Date() },
          });
          await tx.tripEvent.create({
            data: {
              tripId: bid.tripId,
              eventType: 'bid_expired',
              metadata: { bidId: bid.id, expiredStatus: bid.status },
            },
          });
        });

        await this.voidStripeHold(bid.id);
        await this.dispatch.notifyBidExpired(bid.tripId, bid.id);
        this.logger.log(`Bid ${bid.id} expired`);
      } catch (err) {
        this.logger.error(`Failed to expire bid ${bid.id}`, err);
      }
    }
  }

  // ─── Private: Payment Integration ────────────────────────────────────────

  private async createStripeHold(
    stripeCustomerId: string | null,
    paymentMethodId: string,
    amount: number,
  ): Promise<string> {
    if (!stripeCustomerId) {
      throw new BadRequestException({ code: 'NO_PAYMENT_METHOD', message: 'No payment profile found. Add a payment method first.' });
    }

    const url = `${process.env.PAYMENT_SERVICE_URL ?? 'http://localhost:3007'}/payments/internal/authorize`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stripeCustomerId, paymentMethodId, amountCents: Math.round(amount * 100) }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new BadRequestException({ code: 'PAYMENT_HOLD_FAILED', message: `Payment hold failed: ${body}` });
    }

    const data = await res.json() as { paymentIntentId: string };
    return data.paymentIntentId;
  }

  private async captureStripeHold(bidId: string, finalFare: number): Promise<void> {
    const piId = await this.redis.get(`bid:${bidId}:pi`);
    if (!piId) {
      this.logger.warn(`No payment intent found for bid ${bidId} — skipping capture`);
      return;
    }

    const url = `${process.env.PAYMENT_SERVICE_URL ?? 'http://localhost:3007'}/payments/internal/capture`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentIntentId: piId, amountCents: Math.round(finalFare * 100) }),
    }).catch((e: unknown) => this.logger.error(`Stripe capture failed for bid ${bidId}`, e));

    await this.redis.del(`bid:${bidId}:pi`);
  }

  private async voidStripeHold(bidId: string): Promise<void> {
    const piId = await this.redis.get(`bid:${bidId}:pi`);
    if (!piId) return;

    const url = `${process.env.PAYMENT_SERVICE_URL ?? 'http://localhost:3007'}/payments/internal/void`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentIntentId: piId }),
    }).catch((e: unknown) => this.logger.error(`Stripe void failed for bid ${bidId}`, e));

    await this.redis.del(`bid:${bidId}:pi`);
  }

  // ─── Private: Fetch Standard Fare ────────────────────────────────────────

  private async fetchStandardFare(dto: Pick<SubmitBidDto, 'pickupLat' | 'pickupLng' | 'dropoffLat' | 'dropoffLng' | 'pickupAddress' | 'dropoffAddress'>): Promise<number> {
    const url = `${process.env.PRICING_SERVICE_URL ?? 'http://localhost:3005'}/pricing/estimate`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        dropoffLat: dto.dropoffLat,
        dropoffLng: dto.dropoffLng,
        rideType: 'bid',
        isAirportTrip: this.detectAirportTrip(dto.pickupAddress, dto.dropoffAddress),
      }),
    });

    if (!res.ok) throw new BadRequestException('Pricing service unavailable.');
    const data = await res.json() as { fare: number };
    return data.fare;
  }

  // ─── Private: Helpers ─────────────────────────────────────────────────────

  private async getActiveBid(bidId: string) {
    const bid = await this.prisma.bid.findUnique({ where: { id: bidId } });
    if (!bid) throw new NotFoundException('Bid not found.');
    if (isBidTerminal(bid.status)) {
      throw new BadRequestException({ code: 'BID_ALREADY_RESOLVED', message: `Bid is already ${bid.status}.` });
    }
    return bid;
  }

  private async resolveRider(userId: string) {
    const rider = await this.prisma.rider.findUnique({ where: { userId } });
    if (!rider) throw new NotFoundException('Rider profile not found.');
    return rider;
  }

  private async resolveDriver(userId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver profile not found.');
    if (driver.status !== 'approved') throw new ForbiddenException('Driver account is not approved.');
    return driver;
  }

  private async findNearbyDriverUserIds(
    pickupLat: number,
    pickupLng: number,
    isAirportTrip: boolean,
  ): Promise<string[]> {
    const PRIMARY_RADIUS_MI = 5;
    const EXTENDED_RADIUS_MI = 10;
    const PRIMARY_MIN_DRIVERS = 3;

    const locationKeys = await this.redis.keys('driver:*:location');

    const primary: string[] = [];
    const extended: string[] = [];

    for (const key of locationKeys) {
      const raw = await this.redis.get(key);
      if (!raw) continue;

      let loc: { lat: number; lng: number };
      try {
        loc = JSON.parse(raw) as { lat: number; lng: number };
      } catch {
        continue;
      }

      const userId = key.slice('driver:'.length, -':location'.length);
      const dist = this.haversineDistance(pickupLat, pickupLng, loc.lat, loc.lng);

      if (dist <= PRIMARY_RADIUS_MI) {
        primary.push(userId);
      } else if (dist <= EXTENDED_RADIUS_MI) {
        extended.push(userId);
      }
    }

    // Expand to 10-mile radius only when fewer than 3 drivers found within 5 miles
    const matched = primary.length >= PRIMARY_MIN_DRIVERS ? primary : [...primary, ...extended];

    // Airport trips: inject top EWR queue drivers regardless of current location
    if (isAirportTrip) {
      const queuedDriverIds = await this.redis.zrange('queue:ewr', 0, 4);
      if (queuedDriverIds.length > 0) {
        const queuedDrivers = await this.prisma.driver.findMany({
          where: { id: { in: queuedDriverIds } },
          select: { userId: true },
        });
        for (const { userId } of queuedDrivers) {
          if (!matched.includes(userId)) matched.push(userId);
        }
      }
    }

    return matched;
  }

  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3958.8;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
  }

  private detectAirportTrip(pickup: string, dropoff: string): boolean {
    const terms = ['EWR', 'Newark Airport', 'Newark Liberty', 'Terminal A', 'Terminal B', 'Terminal C'];
    return terms.some((t) => pickup.includes(t) || dropoff.includes(t));
  }

  private isNightRide(date: Date): boolean {
    const h = date.getHours();
    return h >= 22 || h < 5;
  }
}
