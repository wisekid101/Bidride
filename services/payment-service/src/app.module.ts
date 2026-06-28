import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PaymentsModule } from './payments/payments.module';
import { LedgerModule } from './ledger/ledger.module';
import { WalletModule } from './wallet/wallet.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { PayoutBatchModule } from './payouts/payout-batch.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PaymentsModule,
    LedgerModule,
    WalletModule,
    ReconciliationModule,
    PayoutBatchModule,
  ],
})
export class AppModule {}
