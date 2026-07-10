import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { IsString, Min, IsInt, IsNumber, IsOptional } from 'class-validator';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PaymentService } from './payment.service';

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

  // Optional attribution: when present the capture is booked as the trip's
  // payment record (offer trips settle via capture, not charge-trip).
  @IsOptional()
  @IsString()
  tripId?: string;

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

// Internal controller — only reachable from within the VPC (not exposed via public ALB)
@Controller('payments/internal')
@UseGuards(ThrottlerGuard)
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
