import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DriversService } from './drivers.service';
import {
  SubmitPersonalInfoDto,
  RequestBackgroundCheckDto,
  UpdateAvailabilityDto,
  ApproveDriverDto,
  DeclineDriverDto,
  SuspendDriverDto,
} from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  // Driver self-service endpoints

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getProfile(@Headers('x-user-id') userId: string) {
    return this.driversService.getProfile(userId);
  }

  @Post('me/personal-info')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  submitPersonalInfo(
    @Headers('x-user-id') userId: string,
    @Body() dto: SubmitPersonalInfoDto,
  ) {
    return this.driversService.submitPersonalInfo(userId, dto);
  }

  @Post('me/background-check')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  requestBackgroundCheck(
    @Headers('x-user-id') userId: string,
    @Body() dto: RequestBackgroundCheckDto,
  ) {
    return this.driversService.requestBackgroundCheck(userId, dto);
  }

  @Patch('me/availability')
  @UseGuards(JwtAuthGuard)
  updateAvailability(
    @Headers('x-user-id') userId: string,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.driversService.updateAvailability(userId, dto);
  }

  @Get('me/performance')
  @UseGuards(JwtAuthGuard)
  getPerformanceStats(@Headers('x-user-id') userId: string) {
    return this.driversService.getPerformanceStats(userId);
  }

  // Admin endpoints

  @Get('admin')
  @UseGuards(JwtAuthGuard, AdminGuard)
  listForAdmin(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.driversService.listForAdmin({
      search,
      status: status as any,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('admin/:driverId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getDriverDetail(@Param('driverId') driverId: string) {
    return this.driversService.getDriverDetailForAdmin(driverId);
  }

  @Post('admin/:driverId/approve')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(HttpStatus.OK)
  approveDriver(
    @Param('driverId') driverId: string,
    @Body() dto: ApproveDriverDto,
    @Headers('x-user-id') adminId: string,
  ) {
    return this.driversService.approveDriver(driverId, dto, adminId);
  }

  @Post('admin/:driverId/decline')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(HttpStatus.OK)
  declineDriver(
    @Param('driverId') driverId: string,
    @Body() dto: DeclineDriverDto,
    @Headers('x-user-id') adminId: string,
  ) {
    return this.driversService.declineDriver(driverId, dto, adminId);
  }

  @Post('admin/:driverId/suspend')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(HttpStatus.OK)
  suspendDriver(
    @Param('driverId') driverId: string,
    @Body() dto: SuspendDriverDto,
    @Headers('x-user-id') adminId: string,
  ) {
    return this.driversService.suspendDriver(driverId, dto, adminId);
  }
}
