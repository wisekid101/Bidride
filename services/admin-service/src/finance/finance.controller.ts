import { Controller, Get, Post, Query, Param } from '@nestjs/common';
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

  @Post('reconciliation/:id/resolve')
  async resolveReconciliation(
    @Param('id') id: string,
    @Query('adminId') adminId = 'unknown',
  ) {
    return this.finance.resolveReconciliation(id, adminId);
  }
}
