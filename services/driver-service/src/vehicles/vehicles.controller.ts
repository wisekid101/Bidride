import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsString, IsOptional } from 'class-validator';
import { VehiclesService, AddVehicleDto } from './vehicles.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

class InspectionResultDto {
  @IsString()
  @IsOptional()
  reason?: string;
}

@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  addVehicle(
    @Headers('x-user-id') userId: string,
    @Body() dto: AddVehicleDto,
  ) {
    return this.vehiclesService.addVehicle(userId, dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  listVehicles(@Headers('x-user-id') userId: string) {
    return this.vehiclesService.listVehicles(userId);
  }

  @Patch(':vehicleId/active')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  setActiveVehicle(
    @Headers('x-user-id') userId: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    return this.vehiclesService.setActiveVehicle(userId, vehicleId);
  }

  @Post('admin/:vehicleId/approve-inspection')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(HttpStatus.OK)
  approveInspection(
    @Param('vehicleId') vehicleId: string,
    @Headers('x-user-id') adminId: string,
  ) {
    return this.vehiclesService.approveInspection(vehicleId, adminId);
  }

  @Post('admin/:vehicleId/fail-inspection')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(HttpStatus.OK)
  failInspection(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: InspectionResultDto,
    @Headers('x-user-id') adminId: string,
  ) {
    return this.vehiclesService.failInspection(vehicleId, dto.reason ?? '', adminId);
  }
}
