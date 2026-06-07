import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PaymentMethodsService } from './payment-methods.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('riders/me/payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  listPaymentMethods(@Headers('x-user-id') userId: string) {
    return this.paymentMethodsService.listPaymentMethods(userId);
  }

  @Post('setup-intent')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  createSetupIntent(@Headers('x-user-id') userId: string) {
    return this.paymentMethodsService.createSetupIntent(userId);
  }

  @Delete(':paymentMethodId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  removePaymentMethod(
    @Headers('x-user-id') userId: string,
    @Param('paymentMethodId') paymentMethodId: string,
  ) {
    return this.paymentMethodsService.removePaymentMethod(userId, paymentMethodId);
  }
}
