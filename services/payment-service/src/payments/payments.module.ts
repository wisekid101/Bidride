import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PaymentService } from './payment.service';
import { PaymentsInternalController } from './payments.internal.controller';
import { StripeWebhookController } from './payments.webhook.controller';
import { PayoutDriverController } from '../payouts/payout.driver.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { LedgerService } from '../ledger/ledger.service';
import { WalletService } from '../wallet/wallet.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { PaymentBookingService } from './payment-booking.service';
import { CaptureRecoveryModule } from '../recovery/capture-recovery.module';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    CaptureRecoveryModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow('JWT_SECRET') }),
      inject: [ConfigService],
    }),
  ],
  controllers: [PaymentsInternalController, StripeWebhookController, PayoutDriverController],
  providers: [PaymentService, PrismaService, LedgerService, PaymentBookingService, WalletService, ReconciliationService, JwtAuthGuard],
  exports: [PaymentService],
})
export class PaymentsModule {}
