import { Module } from '@nestjs/common';
import { BidWinProbabilityEngine } from './bid-win-probability.engine';
import { BidOutcomeService } from './bid-outcome.service';
import { ModelMetricsService } from './model-metrics.service';
import { BidOutcomeController } from './bid-outcome.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [BidOutcomeController],
  providers: [BidWinProbabilityEngine, BidOutcomeService, ModelMetricsService, PrismaService],
  exports: [BidWinProbabilityEngine],
})
export class BidPredictionModule {}
