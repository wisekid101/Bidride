import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [LedgerService, PrismaService],
  exports: [LedgerService],
})
export class LedgerModule {}
