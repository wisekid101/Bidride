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
import { sanitizeRouteDistanceMiles, haversineMiles } from '../trips/distance.util';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { DispatchService } from '../trips/dispatch.service';
import { detectAirportTripFromEndpoints } from '../trips/trips.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SubmitBidDto, CounterBidDto } from './bids.dto';
import { getCorrelationId } from '@bidride/observability';
import { tripMetrics } from '../observability/trip-metrics';
import {
  assertValidBidTransition,
  isBidTerminal,
  MAX_COUNTER_ROUNDS,
  BID_TTL_SECONDS,
  COUNTER_TTL_SECONDS,
  BID_FLOOR_RATE,
} from './bid-state-machine';

const EXPIRY_SWEEP_INTERVAL_MS = 30_000;

// ─── Expiry sweep lease ──────────────────────────────────────────────────────
// Every replica runs the sweep on the same 30s cadence, so without a lease they
// all process the same expired bids and duplicate the void, the notification and
// the telemetry. The lease is a plain Redis key holding a per-run token.
//
// TTL 25s against a 30s cadence: comfortably longer than any realistic sweep,
// short enough that a crashed owner's lease clears before the next tick, and
// non-overlapping so two consecutive ticks can never both hold it.
/**
 * Headers for an internal service call (PO-1B).
 *
 * `x-correlation-id` is the header @bidride/observability already reads first
 * in extractFromHeaders, so this introduces no new standard — the receiving
 * service's CorrelationMiddleware picks it up and one id spans both hops.
 * Omitted when there is no context rather than inventing one, so a background
 * caller does not fabricate a request id.
 */
function internalHeaders(): Record<string, string> {
  const correlationId = getCorrelationId();
  return {
    'Content-Type': 'application/json',
    ...(process.env.INTERNAL_SERVICE_KEY && { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }),
    ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
  };
}

const SWEEP_LOCK_KEY = 'bid:sweep:lock';
const SWEEP_LOCK_TTL_SECONDS = 25;

// Release must be atomic: a GET followed by a separate DEL can delete a lease
// that expired and was re-acquired by another replica between the two commands.
const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

// A bid may only expire out of these states, and its trip may only be cancelled
// from these. Anything else means another workflow legitimately won the race.
const EXPIRABLE_BID_STATUSES = [BidStatus.pending, BidStatus.countered];
const CANCELLABLE_TRIP_STATUSES = [TripStatus.searching];
const PLATFORM_FEE_RATE = 0.20;

/**
 * Capture-outcome audit event type written from trip-service (F3a).
 *
 * Mirrors payment-service's constant deliberately rather than importing across
 * a service boundary. trip-service only ever writes the UNKNOWN type: it never
 * talks to Stripe, so it is never in a position to say a capture definitively
 * failed.
 */
const CAPTURE_OUTCOME_UNKNOWN = 'payment_capture_outcome_unknown';

/**
 * Error codes that mean payment-service classified the failure and wrote its
 * own durable event. Seeing one of these, trip-service logs and stays quiet.
 */
const PAYMENT_SERVICE_RECORDED_CODES = new Set([
  'FARE_INTEGRITY_ERROR',
  'CAPTURE_FAILED',
  'CAPTURE_OUTCOME_UNKNOWN',
]);

/** Pull the machine-readable code out of an error response, tolerating anything. */
async function readErrorCode(res: Response): Promise<string | null> {
  try {
    const body = await res.json() as { code?: unknown };
    return typeof body?.code === 'string' ? body.code : null;
  } catch {
    return null; // HTML error page, empty body, truncated response
  }
}

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
    // One id per business authorization attempt, minted BEFORE anything else so
    // a retry of this same operation reuses it and Stripe returns the original
    // hold instead of creating a second live one. It cannot be bidId or tripId:
    // both are generated in the transaction further down, long after the hold
    // is placed. Never regenerated later in this workflow.
    const bidAttemptId = randomUUID();

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
    const isAirportTrip = detectAirportTripFromEndpoints(dto);

    // Create Stripe authorization hold for the full standard fare amount so any
    // accepted outcome (bid or counter up to standard fare) is covered.
    const paymentIntentId = await this.createStripeHold(
      bidAttemptId,
      rider.stripeCustomerId,
      dto.paymentMethodId,
      standardFare,
    );

    // Create trip + bid atomically in a transaction
    const { trip, bid } = await this.prisma.$transaction(async (tx) => {
      // Bid trips skip the pricing estimate, so persist a straight-line route
      // distance for the earnings floor (actualDistanceMiles stays null).
      const bidRouteDistance = sanitizeRouteDistanceMiles(
        this.haversineDistance(dto.pickupLat, dto.pickupLng, dto.dropoffLat, dto.dropoffLng),
      );
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
          ...(bidRouteDistance != null ? { routeDistanceMiles: bidRouteDistance } : {}),
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
    const nearbyDriverUserIds = await this.findNearbyDriverUserIds(
      dto.pickupLat,
      dto.pickupLng,
      isAirportTrip,
    );

    // Rank drivers via AI service (300ms hard timeout; fallback to geo order)
    const rankedResults = await this.rankDriversWithFallback(
      trip.id,
      nearbyDriverUserIds,
      dto.pickupLat,
      dto.pickupLng,
      isAirportTrip,
    );
    const targetDriverUserIds = rankedResults.map((r) => r.driverUserId);

    // Fire-and-forget dispatch simulation (logs decision; never blocks broadcast)
    void this.simulateDispatchAsync(trip.id, rankedResults).catch(() => {});

    await this.dispatch.broadcastBidRequest(
      trip, bid, standardFare, bidFloor, distanceMiles, durationMin, 'Verified', targetDriverUserIds,
    );

    this.logger.log(`Bid ${bid.id} submitted: $${dto.bidAmount} (standard $${standardFare})`);

    const winProbability = await this.fetchBidWinProbability({
      tripId: trip.id,
      userId: rider.userId,
      bidAmount: dto.bidAmount,
      aiFare: standardFare,
      lat: dto.pickupLat,
      lng: dto.pickupLng,
      isAirport: isAirportTrip,
      timeOfDay: now.getHours(),
      availableDriversInZone: nearbyDriverUserIds.length,
    });

    return {
      trip: { id: trip.id },
      bidId: bid.id,
      bidAmount: dto.bidAmount,
      standardFare,
      bidFloor,
      expiresAt,
      winProbability,
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

    await this.captureStripeHold(bidId, finalFare, bid.tripId, bid.riderId);
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
    this.recordRejectedBidOutcome(bid.tripId, bidId);

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

    await this.captureStripeHold(bidId, finalFare, bid.tripId, bid.riderId);
    await this.redis.setex(`trip:${bid.tripId}:state`, 7200, TripStatus.accepted);
    await this.dispatch.notifyDriverCounterAccepted(bid.tripId, bidId, bid.driver, finalFare);

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
    await this.dispatch.notifyDriverCounterDeclined(bid.tripId, bidId, bid.driver!.userId);
    this.recordRejectedBidOutcome(bid.tripId, bidId);

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
    this.recordRejectedBidOutcome(bid.tripId, bidId);
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

  /**
   * Acquire the sweep lease. Returns the owner token, or null when another
   * replica already holds it.
   */
  private async acquireSweepLock(): Promise<string | null> {
    const token = randomUUID();
    const acquired = await this.redis.set(
      SWEEP_LOCK_KEY, token, 'EX', SWEEP_LOCK_TTL_SECONDS, 'NX',
    );
    return acquired ? token : null;
  }

  /** Release the lease ONLY if we still own it (atomic compare-and-delete). */
  private async releaseSweepLock(token: string): Promise<void> {
    try {
      await this.redis.eval(RELEASE_LOCK_LUA, 1, SWEEP_LOCK_KEY, token);
    } catch (err) {
      // A failed release is safe: the 25s TTL reclaims the lease.
      this.logger.debug?.(`Sweep lock release failed (lease will expire): ${String(err)}`);
    }
  }

  async sweepExpiredBids(): Promise<void> {
    const lockToken = await this.acquireSweepLock();
    if (!lockToken) return; // another replica is sweeping this tick

    try {
      const expiredBids = await this.prisma.bid.findMany({
        where: {
          status: { in: EXPIRABLE_BID_STATUSES },
          expiresAt: { lte: new Date() },
        },
        include: { driver: { select: { id: true, userId: true } } },
      });

      for (const bid of expiredBids) {
        try {
          // The selected row is a snapshot; the bid may have been accepted,
          // declined or withdrawn since. Both writes are therefore conditional,
          // and every side effect below is gated on the bid transition having
          // actually happened.
          const expired = await this.prisma.$transaction(async (tx) => {
            const result = await tx.bid.updateMany({
              where: { id: bid.id, status: { in: EXPIRABLE_BID_STATUSES } },
              data: { status: BidStatus.expired, resolvedAt: new Date() },
            });
            if (result.count !== 1) return false; // another transition won

            await tx.tripEvent.create({
              data: {
                tripId: bid.tripId,
                eventType: 'bid_expired',
                metadata: { bidId: bid.id, expiredStatus: bid.status },
              },
            });

            // An expired bid must not leave its trip searching forever. This is
            // conditional too: if the trip already advanced, another workflow
            // legitimately owns it and we leave it alone — expected concurrency,
            // not an integrity fault, so it is not logged as one.
            await tx.trip.updateMany({
              where: { id: bid.tripId, status: { in: CANCELLABLE_TRIP_STATUSES } },
              data: {
                status: TripStatus.cancelled,
                cancelledAt: new Date(),
                cancelReason: 'bid_expired',
              },
            });

            return true;
          });

          // PO-1B: emitted AFTER the transaction resolves, so a rollback records
          // nothing. `transition_lost` is F2's silent skip made countable — the
          // sweep deliberately stays quiet in the logs (Founder Decision 1), but
          // the RATE of lost races is worth seeing.
          const previousStatus = bid.status === BidStatus.countered ? 'countered' : 'pending';
          tripMetrics.bidExpiryTotal.inc({
            outcome: expired ? 'expired' : 'transition_lost',
            previous_status: previousStatus,
          });

          if (!expired) continue; // silent skip — no void, no notify

          await this.voidStripeHold(bid.id);
          if (bid.status === BidStatus.countered) {
            await this.dispatch.notifyCounterExpired(bid.tripId, bid.id, bid.driver?.userId);
          } else {
            await this.dispatch.notifyBidExpired(bid.tripId, bid.id);
          }
          this.recordRejectedBidOutcome(bid.tripId, bid.id);
          this.logger.log(`Bid ${bid.id} expired (was ${bid.status})`);
        } catch (err) {
          this.logger.error(`Failed to expire bid ${bid.id}`, err);
        }
      }
    } finally {
      await this.releaseSweepLock(lockToken);
    }
  }

  // ─── Private: Payment Integration ────────────────────────────────────────

  private async fetchBidWinProbability(params: {
    tripId: string;
    userId: string;
    bidAmount: number;
    aiFare: number;
    lat: number;
    lng: number;
    isAirport: boolean;
    timeOfDay: number;
    availableDriversInZone: number;
  }): Promise<number> {
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:3012';
    const FALLBACK = 0.50;
    try {
      const res = await fetch(`${AI_SERVICE_URL}/ai/bid-win-probability`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.INTERNAL_SERVICE_KEY && { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }),
        },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(500),
      });
      if (!res.ok) return FALLBACK;
      const envelope = await res.json() as { data: { probability: number } };
      return parseFloat((envelope.data.probability ?? FALLBACK).toFixed(2));
    } catch {
      return FALLBACK;
    }
  }

  private recordRejectedBidOutcome(tripId: string, bidId: string): void {
    // Same default as every other AI hook: the fetch is fire-and-forget and
    // tolerates the service being down, so no early return when unset.
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:3012';
    void fetch(`${AI_SERVICE_URL}/ai/bid-outcome`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.INTERNAL_SERVICE_KEY && { 'x-internal-key': process.env.INTERNAL_SERVICE_KEY }),
      },
      body: JSON.stringify({ tripId, bidId, wasAccepted: false }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }

  private async createStripeHold(
    bidAttemptId: string,
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
      headers: internalHeaders(),
      // bidAttemptId makes the hold idempotent across retries of this attempt.
      body: JSON.stringify({
        bidAttemptId,
        stripeCustomerId,
        paymentMethodId,
        amountCents: Math.round(amount * 100),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new BadRequestException({ code: 'PAYMENT_HOLD_FAILED', message: `Payment hold failed: ${body}` });
    }

    const data = await res.json() as { paymentIntentId: string };
    return data.paymentIntentId;
  }

  private async captureStripeHold(
    bidId: string,
    finalFare: number,
    tripId: string,
    riderId: string,
  ): Promise<void> {
    const amountCents = Math.round(finalFare * 100);
    const piId = await this.redis.get(`bid:${bidId}:pi`);
    if (!piId) {
      // No handle means we cannot even tell whether a hold was placed and
      // later lost, so this is uncertainty, not a definitive "no money moved".
      this.logger.warn(`No payment intent found for bid ${bidId} — skipping capture`);
      await this.recordCaptureOutcome(tripId, CAPTURE_OUTCOME_UNKNOWN, {
        code: 'CAPTURE_HANDLE_MISSING',
        detail: 'no payment-intent handle in Redis for this bid — capture was never attempted',
        paymentIntentId: null,
        bidId,
        requestedAmountCents: amountCents,
      });
      return;
    }

    const url = `${process.env.PAYMENT_SERVICE_URL ?? 'http://localhost:3007'}/payments/internal/capture`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: internalHeaders(),
        // tripId/riderId let payment-service book this capture as the trip's
        // payment record — the capture IS the ride's charge for offer trips,
        // and receipts/refunds/analytics must be able to see it.
        body: JSON.stringify({
          paymentIntentId: piId,
          amountCents,
          tripId,
          riderId,
        }),
      });

      // fetch resolves for 4xx and 5xx, so a rejected capture used to be
      // indistinguishable from a successful one and was silently discarded.
      if (!res.ok) {
        const code = await readErrorCode(res);
        if (code && PAYMENT_SERVICE_RECORDED_CODES.has(code)) {
          // payment-service reached its own classifier and has already written
          // the durable event; a second one from here would double-count.
          this.logger.error(
            `Capture rejected for bid ${bidId} (trip ${tripId}): ${res.status} ${code} — recorded by payment-service`,
          );
        } else {
          // 5xx, a proxy error, an auth rejection: payment-service never got
          // far enough to classify, so the outcome is unknown and ours to log.
          await this.recordCaptureOutcome(tripId, CAPTURE_OUTCOME_UNKNOWN, {
            code: 'CAPTURE_OUTCOME_UNKNOWN',
            detail: `payment-service responded ${res.status}${code ? ` (${code})` : ''}`,
            paymentIntentId: piId,
            bidId,
            requestedAmountCents: amountCents,
          });
        }
      }
    } catch (e: unknown) {
      // The request may have reached payment-service and Stripe before the
      // connection dropped. Never call this a failure.
      this.logger.error(`Stripe capture failed for bid ${bidId}`, e);
      await this.recordCaptureOutcome(tripId, CAPTURE_OUTCOME_UNKNOWN, {
        code: 'CAPTURE_OUTCOME_UNKNOWN',
        detail: 'payment-service was unreachable or the connection dropped mid-request',
        paymentIntentId: piId,
        bidId,
        requestedAmountCents: amountCents,
      });
    }

    await this.redis.del(`bid:${bidId}:pi`);
  }

  /**
   * Persist a capture-outcome event from the trip-service side (F3a).
   *
   * Only used when payment-service could not record one itself — it was
   * unreachable, it failed before classifying, or no capture was attempted.
   * Best-effort: acceptance must not fail because an audit write did.
   */
  private async recordCaptureOutcome(
    tripId: string,
    eventType: typeof CAPTURE_OUTCOME_UNKNOWN,
    fields: {
      code: string;
      detail: string;
      paymentIntentId: string | null;
      bidId: string;
      requestedAmountCents: number;
    },
  ): Promise<void> {
    const metadata = {
      outcome: 'unknown',
      ...fields,
      attemptedAt: new Date().toISOString(),
      source: 'trip-service',
    };
    this.logger.error(`CAPTURE OUTCOME UNKNOWN trip=${tripId}: ${JSON.stringify(metadata)}`);
    try {
      await this.prisma.tripEvent.create({
        data: { tripId, eventType, metadata: metadata as object },
      });
    } catch (e) {
      this.logger.error(`Failed to persist ${eventType} for trip ${tripId}`, e as Error);
    }
  }

  private async voidStripeHold(bidId: string): Promise<void> {
    const piId = await this.redis.get(`bid:${bidId}:pi`);
    if (!piId) return;

    const url = `${process.env.PAYMENT_SERVICE_URL ?? 'http://localhost:3007'}/payments/internal/void`;
    await fetch(url, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({ paymentIntentId: piId }),
    }).catch((e: unknown) => this.logger.error(`Stripe void failed for bid ${bidId}`, e));

    await this.redis.del(`bid:${bidId}:pi`);
  }

  // ─── Private: Fetch Standard Fare ────────────────────────────────────────

  private async fetchStandardFare(dto: Pick<SubmitBidDto, 'pickupLat' | 'pickupLng' | 'dropoffLat' | 'dropoffLng' | 'pickupAddress' | 'dropoffAddress'>): Promise<number> {
    const url = `${process.env.PRICING_SERVICE_URL ?? 'http://localhost:3005'}/pricing/estimate`;
    const res = await fetch(url, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        dropoffLat: dto.dropoffLat,
        dropoffLng: dto.dropoffLng,
        rideType: 'bid',
        isAirportTrip: detectAirportTripFromEndpoints(dto),
      }),
    });

    if (!res.ok) throw new BadRequestException('Pricing service unavailable.');
    const data = await res.json() as { fare: number };
    return data.fare;
  }

  // ─── Private: Helpers ─────────────────────────────────────────────────────

  private async getActiveBid(bidId: string) {
    // The driver relation is included here so the counter-resolution paths can
    // address the driver by User.id (the notification channel key) without a
    // second query. Driver.id and User.id are NOT interchangeable.
    const bid = await this.prisma.bid.findUnique({
      where: { id: bidId },
      include: { driver: { select: { id: true, userId: true } } },
    });
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

    if (matched.length === 0) return matched;

    // A Redis location key alone is NOT eligibility — availability and
    // approval are authoritative in Postgres. This closes the hole where an
    // offline or suspended driver with a lingering location key (leaked
    // watcher, TTL not yet lapsed) would still receive offers. Applies to
    // geo-matched and EWR-queue-injected drivers alike.
    const eligible = await this.prisma.driver.findMany({
      where: { userId: { in: matched }, isAvailable: true, status: 'approved' },
      select: { userId: true },
    });
    const eligibleSet = new Set(eligible.map((d) => d.userId));
    return matched.filter((userId) => eligibleSet.has(userId));
  }

  private async rankDriversWithFallback(
    tripId: string,
    driverUserIds: string[],
    pickupLat: number,
    pickupLng: number,
    isAirportTrip: boolean,
  ): Promise<Array<{ driverUserId: string; score: number }>> {
    if (driverUserIds.length === 0) return [];

    const DEFAULT_DISTANCE = 3.0;
    const DEFAULT_ETA = 8;
    const distanceMap = new Map<string, { distanceMiles: number; etaMinutes: number }>();

    await Promise.all(
      driverUserIds.map(async (uid) => {
        const raw = await this.redis.get(`driver:${uid}:location`).catch(() => null);
        if (!raw) {
          distanceMap.set(uid, { distanceMiles: DEFAULT_DISTANCE, etaMinutes: DEFAULT_ETA });
          return;
        }
        try {
          const loc = JSON.parse(raw) as { lat: number; lng: number };
          const distanceMiles = this.haversineDistance(pickupLat, pickupLng, loc.lat, loc.lng);
          const etaMinutes = Math.max(2, Math.round(distanceMiles * 3));
          distanceMap.set(uid, { distanceMiles, etaMinutes });
        } catch {
          distanceMap.set(uid, { distanceMiles: DEFAULT_DISTANCE, etaMinutes: DEFAULT_ETA });
        }
      }),
    );

    const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:3012';
    try {
      const res = await fetch(`${AI_SERVICE_URL}/ai/driver-ranking`, {
        method: 'POST',
        headers: internalHeaders(),
        body: JSON.stringify({
          tripId,
          isAirportTrip,
          candidates: driverUserIds.map((id) => ({
            driverUserId: id,
            ...(distanceMap.get(id) ?? { distanceMiles: DEFAULT_DISTANCE, etaMinutes: DEFAULT_ETA }),
          })),
        }),
        signal: AbortSignal.timeout(300),
      });
      if (!res.ok) return driverUserIds.map((id) => ({ driverUserId: id, score: 50 }));
      const ranked = (await res.json()) as Array<{ driverUserId: string; score: number }>;
      return ranked.map((r) => ({ driverUserId: r.driverUserId, score: r.score ?? 50 }));
    } catch {
      return driverUserIds.map((id) => ({ driverUserId: id, score: 50 }));
    }
  }

  private async simulateDispatchAsync(tripId: string, rankedCandidates: Array<{ driverUserId: string; score: number }>): Promise<void> {
    const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:3012';
    await fetch(`${AI_SERVICE_URL}/ai/dispatch-simulate`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({
        tripId,
        candidates: rankedCandidates,
      }),
      signal: AbortSignal.timeout(2000),
    });
  }

  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    // Single great-circle implementation lives in distance.util (haversineMiles).
    // parseFloat(...toFixed(2)) preserves this method's original 2dp behavior.
    return parseFloat(haversineMiles(lat1, lng1, lat2, lng2).toFixed(2));
  }

  private isNightRide(date: Date): boolean {
    const h = date.getHours();
    return h >= 22 || h < 5;
  }
}
