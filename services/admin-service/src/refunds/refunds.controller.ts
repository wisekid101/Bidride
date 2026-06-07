import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RefundsService, IssueRefundDto } from './refunds.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('admin/refunds')
@UseGuards(JwtAuthGuard, AdminGuard)
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Get()
  listRefunds(
    @Query('tripId') tripId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.refundsService.listRefunds(
      tripId,
      page ? parseInt(page) : undefined,
      limit ? parseInt(limit) : undefined,
    );
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  issueRefund(
    @Body() dto: IssueRefundDto,
    @Headers('x-user-id') adminId: string,
    @Headers('x-user-role') adminRole: string,
  ) {
    return this.refundsService.issueRefund(dto, adminId, adminRole);
  }
}
