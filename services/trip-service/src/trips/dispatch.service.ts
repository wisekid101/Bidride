import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';

const NOTIFICATION_SERVICE = process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:3008';

// Publishes real-time events to WebSocket gateway via Redis Pub/Sub
// Also sends FCM push notifications for events that may occur while app is backgrounded
@Injectable()
export class DispatchService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  async broadcastRequest(trip: {
    id: string;
    pickupLat: unknown;
    pickupLng: unknown;
    dropoffLat: unknown;
    dropoffLng: unknown;
    aiFare: unknown;
    rideType: string;
    isAirportTrip: boolean;
  }): Promise<void> {
    const payload = JSON.stringify({
      event: 'request:incoming',
      tripId: trip.id,
      pickupLat: trip.pickupLat,
      pickupLng: trip.pickupLng,
      dropoffLat: trip.dropoffLat,
      dropoffLng: trip.dropoffLng,
      aiFare: trip.aiFare,
      rideType: trip.rideType,
      isAirportTrip: trip.isAirportTrip,
    });

    // Published on 'dispatch' channel — WebSocket gateway consumes and fans out
    // to drivers in the pickup zone based on their subscribed location
    await this.redis.publish('dispatch:requests', payload);
  }

  async notifyRiderDriverAssigned(
    tripId: string,
    driverId: string,
    driverInfo: {
      name: string;
      badge: string;
      vehicleMake?: string;
      vehicleModel?: string;
      vehicleColor?: string;
      licensePlate?: string;
    },
  ): Promise<void> {
    await this.publish(`rider:trip:${tripId}`, {
      event: 'driver:assigned',
      tripId,
      driverId,
      driverName: driverInfo.name,
      driverBadge: driverInfo.badge,
      vehicleMake: driverInfo.vehicleMake,
      vehicleModel: driverInfo.vehicleModel,
      vehicleColor: driverInfo.vehicleColor,
      licensePlate: driverInfo.licensePlate,
    });

    // Push: rider's app may be backgrounded — notify them their driver is assigned
    const vehicleInfo = [driverInfo.vehicleMake, driverInfo.vehicleModel, driverInfo.vehicleColor]
      .filter(Boolean).join(' ');
    void this.pushToRiderByTrip(tripId, 'Driver on the way!',
      `${driverInfo.name} · ${vehicleInfo || 'Vehicle info TBD'}`,
      { type: 'DRIVER_ASSIGNED', tripId },
    );
  }

  async notifyRiderDriverArrived(tripId: string): Promise<void> {
    await this.publish(`rider:trip:${tripId}`, {
      event: 'driver:arrived',
      tripId,
      timestamp: new Date().toISOString(),
    });

    void this.pushToRiderByTrip(tripId, 'Your driver has arrived',
      'Please head to your pickup location.',
      { type: 'DRIVER_ARRIVED', tripId },
    );
  }

  async notifyRiderTripStarted(tripId: string): Promise<void> {
    await this.publish(`rider:trip:${tripId}`, {
      event: 'trip:started',
      tripId,
      timestamp: new Date().toISOString(),
    });
  }

  async notifyTripCompleted(
    tripId: string,
    finalFare: number,
    floorResult: { floorMet: boolean; supplement: number; totalDriverEarnings: number },
  ): Promise<void> {
    await this.publish(`rider:trip:${tripId}`, {
      event: 'trip:completed',
      tripId,
      finalFare,
    });

    void this.pushToRiderByTrip(tripId, 'Trip complete!',
      `Your fare: $${finalFare.toFixed(2)}. Thank you for riding with BidRide.`,
      { type: 'TRIP_COMPLETED', tripId, finalFare: String(finalFare) },
    );

    if (!floorResult.floorMet) {
      await this.publish(`driver:trip:${tripId}`, {
        event: 'earnings:floor_triggered',
        tripId,
        supplement: floorResult.supplement,
        totalEarnings: floorResult.totalDriverEarnings,
      });

      void this.pushToDriverByTrip(tripId, 'Earnings Floor Activated',
        `BidRide added $${floorResult.supplement.toFixed(2)} — your take-home: $${floorResult.totalDriverEarnings.toFixed(2)}`,
        { type: 'FLOOR_SUPPLEMENT', tripId },
      );
    }
  }

  // ─── Bid Broadcast Methods ────────────────────────────────────────────────

  async broadcastBidRequest(
    trip: {
      id: string;
      pickupLat: unknown;
      pickupLng: unknown;
      dropoffLat: unknown;
      dropoffLng: unknown;
      pickupAddress: string;
      dropoffAddress: string;
      isAirportTrip: boolean;
    },
    bid: { id: string; riderOffer: unknown },
    standardFare: number,
    bidFloor: number,
    distanceMiles: number,
    durationMin: number,
    riderBadge: 'Verified' | 'Trusted' | 'Business' | 'VIP',
    targetDriverUserIds: string[],
  ): Promise<void> {
    if (targetDriverUserIds.length === 0) return;

    const payload = {
      event: 'bid:incoming',
      bidId: bid.id,
      tripId: trip.id,
      pickupLat: trip.pickupLat,
      pickupLng: trip.pickupLng,
      dropoffLat: trip.dropoffLat,
      dropoffLng: trip.dropoffLng,
      pickupAddress: trip.pickupAddress,
      dropoffAddress: trip.dropoffAddress,
      bidAmount: bid.riderOffer,
      standardFare,
      bidFloor,
      distanceMiles,
      durationMin,
      isAirportTrip: trip.isAirportTrip,
      riderBadge,
    };

    // Publish to each matched driver individually — no global broadcast
    await Promise.all(
      targetDriverUserIds.map((userId) => this.publish(`user:${userId}:events`, payload)),
    );

    // Push to backgrounded drivers: look up their tokens
    void this.pushBidToDrivers(
      targetDriverUserIds,
      trip.pickupAddress,
      Number(bid.riderOffer),
      bid.id,
      trip.id,
    );

    // Log bid exposure for AI training data — fire-and-forget
    void this.prisma.driverBidExposure.createMany({
      data: targetDriverUserIds.map((driverUserId) => ({
        bidId: bid.id,
        tripId: trip.id,
        driverUserId,
      })),
    }).catch(() => {});
  }

  async notifyBidAcceptedByDriver(
    tripId: string,
    bidId: string,
    driver: { id: string },
    finalFare: number,
  ): Promise<void> {
    await this.publish(`rider:trip:${tripId}`, {
      event: 'bid:accepted',
      bidId,
      tripId,
      finalFare,
      driverId: driver.id,
    });

    void this.pushToRiderByTrip(tripId, 'Bid accepted!',
      `Your offer was accepted. Fare: $${finalFare.toFixed(2)}`,
      { type: 'BID_ACCEPTED', tripId, bidId },
    );
  }

  async notifyBidDeclinedByDriver(tripId: string, bidId: string): Promise<void> {
    await this.publish(`rider:trip:${tripId}`, {
      event: 'bid:declined',
      bidId,
      tripId,
      message: 'Driver declined your bid. You may resubmit or take the standard fare.',
    });
  }

  async notifyRiderBidCountered(
    tripId: string,
    bidId: string,
    driver: { id: string },
    counterAmount: number,
    expiresAt: Date,
  ): Promise<void> {
    await this.publish(`rider:trip:${tripId}`, {
      event: 'bid:countered',
      bidId,
      tripId,
      counterAmount,
      driverId: driver.id,
      expiresAt: expiresAt.toISOString(),
    });

    void this.pushToRiderByTrip(tripId, 'Counter offer received!',
      `Driver countered at $${counterAmount.toFixed(2)}. Expires soon!`,
      { type: 'BID_COUNTERED', tripId, bidId, counterAmount: String(counterAmount) },
    );
  }

  async notifyDriverCounterAccepted(
    tripId: string,
    bidId: string,
    driverId: string | null,
    finalFare: number,
  ): Promise<void> {
    if (!driverId) return;
    // Notify driver that rider accepted their counter
    await this.publish(`user:${driverId}:events`, {
      event: 'bid:counterAccepted',
      bidId,
      tripId,
      finalFare,
    });
    // Notify rider that the trip is now confirmed
    await this.publish(`rider:trip:${tripId}`, {
      event: 'trip:accepted',
      bidId,
      tripId,
      finalFare,
      driverId,
    });

    void this.pushToDriverByUserId(driverId, 'Rider accepted your counter!',
      `Trip confirmed at $${finalFare.toFixed(2)}. Head to pickup.`,
      { type: 'COUNTER_ACCEPTED', tripId, bidId },
    );
  }

  async notifyDriverCounterDeclined(
    tripId: string,
    bidId: string,
    driverId: string,
  ): Promise<void> {
    await this.publish(`user:${driverId}:events`, {
      event: 'bid:counterDeclined',
      bidId,
      tripId,
    });
  }

  async notifyCounterExpired(
    tripId: string,
    bidId: string,
    driverId?: string | null,
  ): Promise<void> {
    await this.publish(`rider:trip:${tripId}`, {
      event: 'bid:counterExpired',
      bidId,
      tripId,
      message: 'The counter offer expired. You may resubmit or take the standard fare.',
    });
    if (driverId) {
      await this.publish(`user:${driverId}:events`, {
        event: 'bid:counterExpired',
        bidId,
        tripId,
      });
    }
  }

  async notifyBidExpired(tripId: string, bidId: string): Promise<void> {
    await this.publish(`rider:trip:${tripId}`, {
      event: 'bid:expired',
      bidId,
      tripId,
      message: 'Your bid expired with no response. You may resubmit or take the standard fare.',
    });
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async publish(channel: string, data: object): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(data));
  }

  private async pushToRiderByTrip(
    tripId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    try {
      const trip = await this.prisma.trip.findUnique({
        where: { id: tripId },
        select: { rider: { select: { pushToken: true } } },
      });
      const token = trip?.rider?.pushToken;
      if (!token) return;
      await this.sendFcmPush(token, title, body, data);
    } catch { /* fire-and-forget — WebSocket is primary delivery */ }
  }

  private async pushToDriverByTrip(
    tripId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    try {
      const trip = await this.prisma.trip.findUnique({
        where: { id: tripId },
        select: { driver: { select: { pushToken: true } } },
      });
      const token = trip?.driver?.pushToken;
      if (!token) return;
      await this.sendFcmPush(token, title, body, data);
    } catch { /* fire-and-forget */ }
  }

  private async pushToDriverByUserId(
    driverUserId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    try {
      const driver = await this.prisma.driver.findUnique({
        where: { userId: driverUserId },
        select: { pushToken: true },
      });
      if (!driver?.pushToken) return;
      await this.sendFcmPush(driver.pushToken, title, body, data);
    } catch { /* fire-and-forget */ }
  }

  private async pushBidToDrivers(
    driverUserIds: string[],
    pickupAddress: string,
    bidAmount: number,
    bidId: string,
    tripId: string,
  ): Promise<void> {
    try {
      const drivers = await this.prisma.driver.findMany({
        where: { userId: { in: driverUserIds }, pushToken: { not: null } },
        select: { pushToken: true },
      });
      const tokens = drivers.map((d) => d.pushToken!).filter(Boolean);
      if (tokens.length === 0) return;
      const shortAddr = pickupAddress.split(',')[0];
      await this.sendFcmPushMultiple(tokens,
        'New bid request',
        `Pickup: ${shortAddr} · Offer: $${bidAmount.toFixed(2)}`,
        { type: 'BID_REQUEST', bidId, tripId },
      );
    } catch { /* fire-and-forget */ }
  }

  private async sendFcmPush(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    await fetch(`${NOTIFICATION_SERVICE}/internal/notifications/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, title, body, data }),
    });
  }

  private async sendFcmPushMultiple(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    await fetch(`${NOTIFICATION_SERVICE}/internal/notifications/push-multiple`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens, title, body, data }),
    });
  }
}
