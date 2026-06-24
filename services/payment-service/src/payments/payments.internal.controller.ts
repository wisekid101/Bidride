import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { IsString, Min, IsInt } from 'class-validator';
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
}

class VoidHoldDto {
  @IsString()
  paymentIntentId: string;
}

// Internal controller — only reachable from within the VPC (not exposed via public ALB)
@Controller('payments/internal')
export class PaymentsInternalController {
  constructor(private readonly payments: PaymentService) {}

  @Post('authorize')
  @HttpCode(HttpStatus.CREATED)
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
    return this.payments.captureAuthorizationHold(dto.paymentIntentId, dto.amountCents);
  }

  @Post('void')
  @HttpCode(HttpStatus.OK)
  cancelHold(@Body() dto: VoidHoldDto) {
    return this.payments.voidAuthorizationHold(dto.paymentIntentId);
  }
}
