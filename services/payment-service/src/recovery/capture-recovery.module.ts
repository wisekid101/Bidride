import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { CaptureRecoveryService } from './capture-recovery.service';
import { CaptureRecoveryScheduler } from './capture-recovery.scheduler';

/**
 * The Stripe client is provided rather than constructed inside the service so
 * tests can substitute a read-only double, and so it is obvious from the wiring
 * that recovery holds a Stripe handle at all. Same apiVersion as PaymentService.
 */
export const RECOVERY_STRIPE = 'RECOVERY_STRIPE';

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [
    PrismaService,
    {
      provide: RECOVERY_STRIPE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Stripe(config.getOrThrow('STRIPE_SECRET_KEY'), { apiVersion: '2024-04-10' }),
    },
    {
      provide: CaptureRecoveryService,
      inject: [PrismaService, RECOVERY_STRIPE],
      useFactory: (prisma: PrismaService, stripe: Stripe) =>
        new CaptureRecoveryService(prisma, stripe),
    },
    CaptureRecoveryScheduler,
  ],
  exports: [CaptureRecoveryService, CaptureRecoveryScheduler],
})
export class CaptureRecoveryModule {}
