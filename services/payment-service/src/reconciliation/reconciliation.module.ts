import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [ReconciliationService, PrismaService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
