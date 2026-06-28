import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FraudService, ReviewAlertDto } from './fraud.service';
import { AdminSessionGuard } from '../auth/admin-session.guard';

@Controller('admin/fraud')
@UseGuards(AdminSessionGuard)
export class FraudController {
  constructor(private readonly fraud: FraudService) {}

  @Get()
  listAlerts(
    @Query('status') status: 'pending' | 'reviewed' = 'pending',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.fraud.listAlerts(
      status === 'reviewed' ? 'reviewed' : 'pending',
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Post(':id/mark-under-review')
  @HttpCode(HttpStatus.OK)
  markUnderReview(
    @Param('id') id: string,
    @Headers('x-user-id') adminId: string,
  ) {
    return this.fraud.markUnderReview(id, adminId);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  reviewAlert(
    @Param('id') id: string,
    @Body() dto: ReviewAlertDto,
    @Headers('x-user-id') adminId: string,
    @Headers('x-user-role') adminRole: string,
  ) {
    return this.fraud.reviewAlert(id, dto, adminId, adminRole);
  }
}
