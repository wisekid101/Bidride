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

  private async publish(channel: string, data: object): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(data));
  }
}
