import {
  Controller,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ProxyService } from './proxy.service';

@Controller('proxy')
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(private readonly proxyService: ProxyService) {}

  // ─── Internal: session management ────────────────────────────────────────

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  createSession(
    @Body() body: { tripId: string; riderPhone: string; driverPhone: string },
  ) {
    return this.proxyService.createSession(body.tripId, body.riderPhone, body.driverPhone);
  }

  @Post('sessions/:tripId/close')
  @HttpCode(HttpStatus.OK)
  closeSession(@Param('tripId') tripId: string) {
    return this.proxyService.closeSession(tripId);
  }

  @Post('sessions/:tripId/schedule-expiry')
  @HttpCode(HttpStatus.OK)
  scheduleExpiry(
    @Param('tripId') tripId: string,
    @Body() body: { completedAt: string },
  ) {
    return this.proxyService.scheduleExpiry(tripId, new Date(body.completedAt));
  }

  @Post('sessions/:tripId/sms')
  @HttpCode(HttpStatus.OK)
  sendMaskedSms(
    @Param('tripId') tripId: string,
    @Body() body: { fromRole: 'rider' | 'driver'; message: string },
  ) {
    return this.proxyService.sendMaskedSms(tripId, body.fromRole, body.message);
  }

  @Post('sessions/:tripId/call')
  @HttpCode(HttpStatus.OK)
  initiateCall(
    @Param('tripId') tripId: string,
    @Body() body: { fromRole: 'rider' | 'driver' },
  ) {
    return this.proxyService.initiateCall(tripId, body.fromRole);
  }

  // ─── Twilio webhooks (public — Twilio calls these) ───────────────────────

  @Post('webhooks/sms')
  @HttpCode(HttpStatus.OK)
  async smsWebhook(@Body() body: Record<string, string>) {
    await this.proxyService.handleSmsWebhook(body);
    return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
  }

  @Post('webhooks/call')
  @HttpCode(HttpStatus.OK)
  async callWebhook(@Body() body: Record<string, string>) {
    await this.proxyService.handleCallWebhook(body);
    return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
  }

  @Post('webhooks/session-expired')
  @HttpCode(HttpStatus.OK)
  async sessionExpiredWebhook(@Body() body: Record<string, string>) {
    await this.proxyService.handleSessionExpiredWebhook(body);
    return { ok: true };
  }
}
