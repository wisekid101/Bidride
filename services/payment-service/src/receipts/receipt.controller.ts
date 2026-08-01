import { Controller, Get, Headers, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReceiptService, RiderReceipt } from './receipt.service';

/**
 * Rider-facing receipt retrieval.
 *
 * Lives in payment-service because that service owns Payment, Refund and the
 * ledger — the authoritative financial evidence. Putting the aggregation here
 * keeps a single source of receipt truth rather than duplicating financial
 * logic into trip-service or rider-service.
 *
 * JwtAuthGuard verifies the rider's user token and sets x-user-id from the
 * token subject, so the identity used for the ownership check comes from the
 * verified JWT and never from a client-supplied header.
 */
@UseGuards(JwtAuthGuard)
@Controller('payments/trips')
export class ReceiptController {
  constructor(private readonly receipts: ReceiptService) {}

  /** GET /payments/trips/:tripId/receipt — read-only; performs no writes. */
  @Get(':tripId/receipt')
  async getReceipt(
    @Headers('x-user-id') userId: string,
    @Param('tripId') tripId: string,
  ): Promise<RiderReceipt> {
    return this.receipts.getRiderReceipt(userId, tripId);
  }
}
