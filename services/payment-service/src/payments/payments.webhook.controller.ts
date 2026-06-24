import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  RawBodyRequest,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentService } from './payment.service';

// Public endpoint — reachable from the internet (Stripe IPs)
// Internal endpoints (/payments/internal/*) remain VPC-only
@Controller('webhooks')
export class StripeWebhookController {
  constructor(private readonly payments: PaymentService) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<{ rawBody?: Buffer }>,
    @Headers('stripe-signature') sig: string,
  ): Promise<{ received: boolean }> {
    if (!sig) {
      throw new BadRequestException('Missing stripe-signature header.');
    }

    const rawBody = req.rawBody;
    if (!rawBody?.length) {
      throw new BadRequestException('Missing request body.');
    }

    let event: Stripe.Event;
    try {
      event = this.payments.constructWebhookEvent(rawBody, sig);
    } catch (err: unknown) {
      // Return 400 so Stripe retries — do not swallow the error silently
      throw new BadRequestException(
        `Webhook signature verification failed: ${(err as Error).message}`,
      );
    }

    await this.payments.handleWebhookEvent(event);
    return { received: true };
  }
}
