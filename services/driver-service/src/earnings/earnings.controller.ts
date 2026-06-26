import { Controller, Get, Query, Headers, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { EarningsService } from './earnings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('driver/earnings')
export class EarningsController {
  constructor(private readonly earningsService: EarningsService) {}

  @Get('today')
  @UseGuards(JwtAuthGuard)
  getToday(@Headers('x-user-id') userId: string) {
    return this.earningsService.getToday(userId);
  }

  @Get('week')
  @UseGuards(JwtAuthGuard)
  getWeek(@Headers('x-user-id') userId: string) {
    return this.earningsService.getWeek(userId);
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  getHistory(
    @Headers('x-user-id') userId: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.earningsService.getHistory(userId, Math.min(limit, 100), offset);
  }
}
