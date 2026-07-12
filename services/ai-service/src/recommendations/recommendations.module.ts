import { Module } from '@nestjs/common';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationLedgerService } from './recommendation-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { InternalKeyGuard } from '../internal-key.guard';

@Module({
  controllers: [RecommendationsController],
  providers: [RecommendationLedgerService, PrismaService, InternalKeyGuard],
  exports: [RecommendationLedgerService],
})
export class RecommendationsModule {}
