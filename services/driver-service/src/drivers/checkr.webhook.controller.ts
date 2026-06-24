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
import { CheckrService, CheckrWebhookEvent } from './checkr.service';

// Public endpoint — reachable from the internet (Checkr IPs)
// Auth-guarded driver endpoints remain on /drivers/*
@Controller('webhooks')
export class CheckrWebhookController {
  constructor(private readonly checkr: CheckrService) {}

  @Post('checkr')
  @HttpCode(HttpStatus.OK)
  async handleCheckrWebhook(
    @Req() req: RawBodyRequest<{ rawBody?: Buffer }>,
    @Headers('x-checkr-signature') signature: string,
  ): Promise<{ received: boolean }> {
    if (!signature) {
      throw new BadRequestException('Missing x-checkr-signature header.');
    }

    const rawBody = req.rawBody;
    if (!rawBody?.length) {
      throw new BadRequestException('Missing request body.');
    }

    if (!this.checkr.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException('Invalid webhook signature.');
    }

    const event: CheckrWebhookEvent = JSON.parse(rawBody.toString('utf8'));
    await this.checkr.handleWebhookEvent(event);
    return { received: true };
  }
}
