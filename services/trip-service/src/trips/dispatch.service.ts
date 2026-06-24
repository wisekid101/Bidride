import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

// Publishes real-time events to WebSocket gateway via Redis Pub/Sub
@Injectable()
export class DispatchService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

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

  async notifyRiderDriverAssigned(tripId: string, driverId: string): Promise<void> {
    await this.publish(`rider:trip:${tripId}`, {
      event: 'driver:assigned',
      tripId,
      driverId,
    });
  }

  async notifyRiderDriverArrived(tripId: string): Promise<void> {
    await this.publish(`rider:trip:${tripId}`, {
      event: 'driver:arrived',
      tripId,
      timestamp: new Date().toISOString(),
    });
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

    if (!floorResult.floorMet) {
      await this.publish(`driver:trip:${tripId}`, {
        event: 'earnings:floor_triggered',
        tripId,
        supplement: floorResult.supplement,
        totalEarnings: floorResult.totalDriverEarnings,
      });
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
  }

  async notifyDriverCounterAccepted(
    tripId: string,
    bidId: string,
    driverId: string | null,
    finalFare: number,
  ): Promise<void> {
    if (!driverId) return;
    await this.publish(`user:${driverId}:events`, {
      event: 'bid:counter_accepted',
      bidId,
      tripId,
      finalFare,
    });
  }

  async notifyDriverCounterDeclined(
    tripId: string,
    bidId: string,
    driverId: string,
  ): Promise<void> {
    await this.publish(`user:${driverId}:events`, {
      event: 'bid:counter_declined',
      bidId,
      tripId,
    });
  }

  async notifyBidExpired(tripId: string, bidId: string): Promise<void> {
    await this.publish(`rider:trip:${tripId}`, {
      event: 'bid:expired',
      bidId,
      tripId,
      message: 'Your bid expired with no response. You may resubmit or take the standard fare.',
    });
  }

  private async publish(channel: string, data: object): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(data));
  }
}
