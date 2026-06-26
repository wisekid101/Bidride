import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PayoutBatchService } from './payout-batch.service';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletModule } from '../wallet/wallet.module';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [ConfigModule, LedgerModule, WalletModule],
  providers: [PayoutBatchService, PrismaService],
  exports: [PayoutBatchService],
})
export class PayoutBatchModule {}
