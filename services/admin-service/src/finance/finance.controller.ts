import { Body, Controller, Get, NotFoundException, Post, Query, Param } from '@nestjs/common';
import { FinanceService } from './finance.service';

@Controller('admin/finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('revenue')
  async getRevenue(
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const startDate = start ? new Date(start) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const endDate = end ? new Date(end) : new Date();
    return this.finance.getRevenueSummary(startDate, endDate);
  }

  @Get('payouts')
  async getPayouts(
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const startDate = start ? new Date(start) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const endDate = end ? new Date(end) : new Date();
    return this.finance.getDriverPayoutSummary(startDate, endDate);
  }

  @Get('liabilities')
  async getLiabilities() {
    return this.finance.getOutstandingLiabilities();
  }

  @Get('refunds')
  async getRefunds(
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const startDate = start ? new Date(start) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const endDate = end ? new Date(end) : new Date();
    return this.finance.getRefundTotals(startDate, endDate);
  }

  @Get('report/daily')
  async getDailyReport(@Query('date') date?: string) {
    const reportDate = date ? new Date(date) : new Date();
    return this.finance.getDailyReport(reportDate);
  }

  @Get('report/monthly')
  async getMonthlyReport(
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const now = new Date();
    return this.finance.getMonthlyReport(
      year ? parseInt(year, 10) : now.getFullYear(),
      month ? parseInt(month, 10) : now.getMonth() + 1,
    );
  }

  @Get('failed-payments')
  async getFailedPayments(@Query('limit') limit = '50') {
    return this.finance.getFailedPayments(Math.min(parseInt(limit, 10) || 50, 200));
  }

  @Get('failed-payouts')
  async getFailedPayouts(@Query('limit') limit = '50') {
    return this.finance.getFailedPayouts(Math.min(parseInt(limit, 10) || 50, 200));
  }

  @Get('reconciliation')
  async getReconciliation(@Query('limit') limit = '50') {
    return this.finance.getReconciliationMismatches(Math.min(parseInt(limit, 10) || 50, 200));
  }

  /**
   * Captures that did not land. Optional ?outcome=failed|unknown narrows to
   * definitive refusals or uncertain outcomes; omitted returns both.
   */
  @Get('capture-failures')
  async getCaptureFailures(
    @Query('limit') limit = '50',
    @Query('outcome') outcome?: string,
  ) {
    const filter = outcome === 'failed' || outcome === 'unknown' ? outcome : undefined;
    return this.finance.getCaptureFailures(Math.min(parseInt(limit, 10) || 50, 200), filter);
  }

  // ─── F3b-1: capture recovery worklist ────────────────────────────────────

  @Get('capture-recovery')
  async getCaptureRecovery(
    @Query('status') status?: string,
    @Query('resolution') resolution?: string,
    @Query('tripId') tripId?: string,
    @Query('paymentIntentId') paymentIntentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit = '50',
  ) {
    return this.finance.getCaptureRecovery({
      status, resolution, tripId, paymentIntentId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: Math.min(parseInt(limit, 10) || 50, 200),
    });
  }

  /** Worklist health. No alerting infrastructure yet — these are the numbers. */
  @Get('capture-recovery/metrics')
  async getCaptureRecoveryMetrics() {
    return this.finance.getCaptureRecoveryMetrics();
  }

  @Get('capture-recovery/:id')
  async getCaptureRecoveryItem(@Param('id') id: string) {
    const found = await this.finance.getCaptureRecoveryItem(id);
    if (!found) throw new NotFoundException(`No capture recovery item ${id}`);
    return found;
  }

  /** Re-ask Stripe now. Read-only at the far end — never issues a capture. */
  @Post('capture-recovery/:id/recheck')
  async recheckCaptureRecovery(@Param('id') id: string) {
    return this.finance.recheckCaptureRecovery(id);
  }

  /** Stop tracking an item. Cannot force a payment outcome. */
  @Post('capture-recovery/:id/close')
  async closeCaptureRecovery(
    @Param('id') id: string,
    @Query('adminId') adminId = 'unknown',
    @Body() body: { note?: string } = {},
  ) {
    return this.finance.closeCaptureRecovery(id, adminId, body?.note ?? '');
  }

  @Post('reconciliation/:id/resolve')
  async resolveReconciliation(
    @Param('id') id: string,
    @Query('adminId') adminId = 'unknown',
  ) {
    return this.finance.resolveReconciliation(id, adminId);
  }
}
