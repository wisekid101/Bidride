import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PaymentService } from './payment.service';
import { PaymentsInternalController } from './payments.internal.controller';
import { StripeWebhookController } from './payments.webhook.controller';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { LedgerService } from '../ledger/ledger.service';
import { WalletService } from '../wallet/wallet.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({ secret: config.get('JWT_SECRET') }),
      inject: [ConfigService],
    }),
  ],
  controllers: [PaymentsInternalController, StripeWebhookController],
  providers: [PaymentService, PrismaService, LedgerService, WalletService, ReconciliationService],
  exports: [PaymentService],
})
export class PaymentsModule {}
