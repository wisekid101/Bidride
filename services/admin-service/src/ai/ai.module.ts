import { Module } from '@nestjs/common';
import { AiMetricsController } from './ai-metrics.controller';

@Module({
  controllers: [AiMetricsController],
})
export class AiModule {}
