import { Controller, Get, Inject } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { REDIS_CLIENT } from './redis/redis.module';
import Redis from 'ioredis';

const SERVICE_NAME = 'auth-service';
const VERSION = process.env.npm_package_version ?? '1.0.0';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // Liveness: is the process alive?
  @Get('live')
  live() {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
  }

  // Readiness: can the service handle requests?
  @Get('ready')
  async ready() {
    const [db, redis] = await Promise.allSettled([
      this.checkDb(),
      this.checkRedis(),
    ]);

    const components = [
      db.status === 'fulfilled' ? db.value : { name: 'postgresql', status: 'unhealthy', required: true, details: String((db as any).reason) },
      redis.status === 'fulfilled' ? redis.value : { name: 'redis', status: 'unhealthy', required: true, details: String((redis as any).reason) },
    ];

    const isReady = components.every((c) => c.status !== 'unhealthy');
    return {
      status: isReady ? 'ready' : 'not_ready',
      service: SERVICE_NAME,
      version: VERSION,
      components,
      timestamp: new Date().toISOString(),
    };
  }

  // Full dependency health
  @Get()
  async check() {
    return this.ready();
  }

  private async checkDb() {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { name: 'postgresql', status: 'healthy', latencyMs: Date.now() - start, required: true };
    } catch (err) {
      return { name: 'postgresql', status: 'unhealthy', latencyMs: Date.now() - start, required: true, details: (err as Error).message };
    }
  }

  private async checkRedis() {
    const start = Date.now();
    try {
      const pong = await this.redis.ping();
      return { name: 'redis', status: pong === 'PONG' ? 'healthy' : 'degraded', latencyMs: Date.now() - start, required: true };
    } catch (err) {
      return { name: 'redis', status: 'unhealthy', latencyMs: Date.now() - start, required: true, details: (err as Error).message };
    }
  }
}
