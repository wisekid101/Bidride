import {
  Controller,
  Post,
  Headers,
  NotFoundException,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentService } from '../payments/payment.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('payments/payout')
export class PayoutDriverController {
  constructor(
    private readonly payments: PaymentService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post('instant')
  async instant(@Headers('x-user-id') userId: string) {
    // EMERGENCY CONTAINMENT (payout integrity Commit 0): instant payout is
    // gated behind PAYOUTS_ENABLED, which defaults OFF. The current payout
    // path repays the same lifetime earnings each day (no paid-out exclusion +
    // per-UTC-day Stripe idempotency key), so it must stay disabled until the
    // durable allocation pipeline (Commit 3) is complete and separately
    // approved. Boolean true or the exact string 'true' enables it (repo
    // convention); every other value -- including 'false', '0', and undefined
    // -- leaves payouts disabled. When OFF we short-circuit before any driver
    // lookup, PaymentService call, Stripe call, or DB write.
    const flag = this.config.get('PAYOUTS_ENABLED');
    const payoutsEnabled = flag === true || flag === 'true';
    if (!payoutsEnabled) {
      throw new ServiceUnavailableException({
        code: 'payouts_temporarily_unavailable',
        message: 'Instant payouts are temporarily unavailable.',
      });
    }

    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!driver) throw new NotFoundException('Driver not found');
    return this.payments.instantPayout(driver.id);
  }

  @Post('connect')
  async connect(@Headers('x-user-id') userId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!driver) throw new NotFoundException('Driver not found');
    return this.payments.createConnectOnboardingLink(driver.id);
  }
}
