import { Controller, Post, Get, Body } from '@nestjs/common';
import { BidOutcomeService, RecordOutcomeDto } from './bid-outcome.service';
import { ModelMetricsService } from './model-metrics.service';

@Controller('ai')
export class BidOutcomeController {
  constructor(
    private readonly bidOutcome: BidOutcomeService,
    private readonly metrics: ModelMetricsService,
  ) {}

  @Post('bid-outcome')
  async recordOutcome(@Body() dto: RecordOutcomeDto): Promise<{ ok: boolean }> {
    void this.bidOutcome.recordOutcome(dto);
    return { ok: true };
  }

  @Get('metrics')
  getMetrics() {
    return this.metrics.getMetrics();
  }
}
