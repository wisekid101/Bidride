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
import Stripe from 'stripe';
import { PayoutAllocationService } from '../payouts/payout-allocation.service';
import {
  PayoutSubmissionService,
  type StripeTransfersLike,
} from '../payouts/payout-submission.service';
import { PayoutOrchestratorService } from '../payouts/payout-orchestrator.service';
import { ReceiptService } from '../receipts/receipt.service';
import { ReceiptController } from '../receipts/receipt.controller';

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
  controllers: [PaymentsInternalController, StripeWebhookController, PayoutDriverController, ReceiptController],
  providers: [
    PaymentService,
    PrismaService,
    LedgerService,
    PaymentBookingService,
    WalletService,
    ReconciliationService,
    JwtAuthGuard,
    // ─── Durable payout pipeline (Payment Integrity) ────────────────────────
    // These existed with full unit + integration coverage but had no
    // production consumer; the instant-payout path now runs through them.
    PayoutAllocationService,
    {
      // PayoutSubmissionService takes Stripe as a structural dependency
      // (StripeTransfersLike is an interface, so Nest cannot resolve it by
      // type). Mirrors the factory pattern in capture-recovery.module.ts.
      provide: PayoutSubmissionService,
      useFactory: (
        prisma: PrismaService,
        ledger: LedgerService,
        config: ConfigService,
      ) =>
        new PayoutSubmissionService(
          prisma,
          ledger,
          new Stripe(config.getOrThrow('STRIPE_SECRET_KEY'), {
            apiVersion: '2024-04-10',
          }) as unknown as StripeTransfersLike,
          config,
        ),
      inject: [PrismaService, LedgerService, ConfigService],
    },
    PayoutOrchestratorService,
    // Rider receipts — read-only aggregation over Payment/Refund (no writes).
    ReceiptService,
  ],
  exports: [PaymentService],
})
export class PaymentsModule {}
