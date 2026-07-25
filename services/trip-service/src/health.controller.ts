import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

// S0-B3A: health/readiness must never be rate-limited (ALB + container probes).
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', service: process.env.npm_package_name ?? 'bidride-service', timestamp: new Date().toISOString() };
  }
}
