import { Controller, Get, Query } from '@nestjs/common';
import { OperationsService } from './operations.service';

@Controller('admin/operations')
export class OperationsController {
  constructor(private readonly ops: OperationsService) {}

  @Get('health')
  checkServices() {
    return this.ops.checkServiceHealth();
  }

  @Get('metrics')
  getMetrics() {
    return this.ops.getSystemMetrics();
  }

  @Get('audit')
  getAuditLogs(@Query('limit') limit?: string) {
    return this.ops.getRecentAuditLogs(limit ? parseInt(limit, 10) : 50);
  }

  @Get('circuit-breakers')
  getCircuitBreakers() {
    return this.ops.getCircuitBreakerStatus();
  }
}
