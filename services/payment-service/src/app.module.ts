import { HealthController } from './health.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PaymentsModule } from './payments/payments.module';
import { LedgerModule } from './ledger/ledger.module';
import { WalletModule } from './wallet/wallet.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { PayoutBatchModule } from './payouts/payout-batch.module';

@Module({
  controllers: [HealthController],
  // S0-B3A: activate the already-configured ThrottlerModule globally. The Stripe
  // webhook controller is @SkipThrottle-exempt; payments/internal keeps its own
  // explicit @Throttle (its redundant controller-level ThrottlerGuard is removed).
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
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
