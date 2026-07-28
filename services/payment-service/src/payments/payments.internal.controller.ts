import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { PaymentService } from './payment.service';
import { InternalKeyGuard } from './internal-key.guard';

class AuthorizeHoldDto {
  @IsString()
  stripeCustomerId: string;

  @IsString()
  paymentMethodId: string;

  @IsInt()
  @Min(100)
  amountCents: number;
}

class CaptureHoldDto {
  @IsString()
  paymentIntentId: string;

  @IsInt()
  @Min(100)
  amountCents: number;

  // REQUIRED: the capture amount is validated against this trip's canonical
  // finalFare before Stripe is called. There is deliberately no unvalidated
  // fallback path — offer trips settle via capture, not charge-trip.
  @IsString()
  @IsNotEmpty()
  tripId: string;

  @IsOptional()
  @IsString()
  riderId?: string;
}

class VoidHoldDto {
  @IsString()
  paymentIntentId: string;
}

class ChargeTripDto {
  @IsString()
  tripId: string;

  @IsString()
  riderId: string;

  @IsNumber()
  @Min(0)
  amount: number;
}

class CreditWalletDto {
  @IsString()
  driverId: string;

  @IsString()
  tripId: string;

  @IsNumber()
  @Min(0)
  amount: number;
}

// Internal controller. Authenticated by InternalKeyGuard (fail-closed in
// production) so it is safe even though the ALB currently forwards /payments/*
// (ALB path separation is a separate, later infra batch — defense in depth).
@Controller('payments/internal')
// S0-B3A: ThrottlerGuard now runs globally (APP_GUARD); removed here to avoid a
// second execution. The per-route @Throttle(20/60s) and InternalKeyGuard are unchanged.
@UseGuards(InternalKeyGuard)
export class PaymentsInternalController {
  constructor(private readonly payments: PaymentService) {}

  @Post('authorize')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  authorize(@Body() dto: AuthorizeHoldDto) {
    if (!dto.stripeCustomerId || !dto.paymentMethodId) {
      throw new BadRequestException('stripeCustomerId and paymentMethodId are required.');
    }
    return this.payments.createAuthorizationHold(
      dto.stripeCustomerId,
      dto.paymentMethodId,
      dto.amountCents,
    );
  }

  @Post('capture')
  @HttpCode(HttpStatus.OK)
  capture(@Body() dto: CaptureHoldDto) {
    return this.payments.captureAuthorizationHold(
      dto.paymentIntentId,
      dto.amountCents,
      dto.tripId,
      dto.riderId,
    );
  }

  @Post('void')
  @HttpCode(HttpStatus.OK)
  cancelHold(@Body() dto: VoidHoldDto) {
    return this.payments.voidAuthorizationHold(dto.paymentIntentId);
  }

  @Post('charge-trip')
  @HttpCode(HttpStatus.OK)
  chargeTrip(@Body() dto: ChargeTripDto) {
    return this.payments.chargeTripByDefault(dto.tripId, dto.riderId, dto.amount);
  }

  @Post('credit-wallet')
  @HttpCode(HttpStatus.OK)
  creditWallet(@Body() dto: CreditWalletDto) {
    return this.payments.creditDriverWallet(dto.driverId, dto.tripId, dto.amount);
  }
}
