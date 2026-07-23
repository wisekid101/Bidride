import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  Ip,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ZeroToleranceService } from './zero-tolerance.service';
import { AcceptZeroToleranceDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('drivers')
export class ZeroToleranceController {
  constructor(private readonly zeroTolerance: ZeroToleranceService) {}

  // Driver self-service: fetch the current policy to render + accept.
  @Get('me/zero-tolerance/policy')
  @UseGuards(JwtAuthGuard)
  getPolicy() {
    return this.zeroTolerance.getCurrentPolicy();
  }

  // Driver self-service: record acceptance. Idempotent per policy version.
  @Post('me/zero-tolerance/accept')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  accept(
    @Headers('x-user-id') userId: string,
    @Headers('x-app-version') appVersion: string,
    @Ip() ip: string,
    @Body() dto: AcceptZeroToleranceDto,
  ) {
    return this.zeroTolerance.accept(userId, dto, {
      appVersion: appVersion ?? null,
      ipAddress: ip ?? null,
    });
  }

  // Admin: immutable acceptance history for a driver.
  @Get('admin/:driverId/zero-tolerance')
  @UseGuards(JwtAuthGuard, AdminGuard)
  listAcceptances(@Param('driverId') driverId: string) {
    return this.zeroTolerance.listAcceptances(driverId);
  }
}
