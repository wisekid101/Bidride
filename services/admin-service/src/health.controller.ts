import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { NoAdminSession } from './auth/public-route.decorator';

// S0-B3A: health/readiness must never be rate-limited (ALB + container probes).
@SkipThrottle()
// Container and ALB probes cannot carry an admin session.
@NoAdminSession()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', service: process.env.npm_package_name ?? 'bidride-service', timestamp: new Date().toISOString() };
  }
}
