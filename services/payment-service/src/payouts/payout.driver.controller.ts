import {
  Controller,
  Post,
  Headers,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { PaymentService } from '../payments/payment.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('payments/payout')
export class PayoutDriverController {
  constructor(
    private readonly payments: PaymentService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('instant')
  async instant(@Headers('x-user-id') userId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!driver) throw new NotFoundException('Driver not found');
    return this.payments.instantPayout(driver.id);
  }
}
