import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SafetyService } from './safety.service';

@Injectable()
export class RouteMonitorService implements OnModuleInit {
  private subscriber: Redis;

  constructor(
    private readonly safety: SafetyService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    this.subscriber = this.redis.duplicate();

    this.subscriber.subscribe('safety:location:update', (err) => {
      if (err) console.error('[RouteMonitor] Subscribe error:', err);
    });

    this.subscriber.on('message', (_channel: string, message: string) => {
      let data: { tripId: string; lat: number; lng: number };
      try {
        data = JSON.parse(message) as typeof data;
      } catch {
        return;
      }
      this.safety
        .checkRouteAnomaly(data.tripId, data.lat, data.lng)
        .catch((err) => console.error('[RouteMonitor] Anomaly check failed:', err));
    });
  }
}
