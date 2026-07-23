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

    let event: CheckrWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      // Signature already verified, but the body is permanently un-parseable —
      // 400 (non-retryable) so Checkr doesn't loop forever on the same bad bytes.
      throw new BadRequestException('Malformed JSON payload.');
    }

    // A thrown ServiceUnavailableException (transient / in-flight / driver not
    // yet linked) propagates as 503 so Checkr redelivers; @HttpCode(OK) governs
    // only the success return below.
    await this.checkr.handleWebhookEvent(event);
    return { received: true };
  }
}
