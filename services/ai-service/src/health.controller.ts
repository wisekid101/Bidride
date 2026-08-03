import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', service: process.env.npm_package_name ?? 'bidride-service', timestamp: new Date().toISOString() };
  }
}
