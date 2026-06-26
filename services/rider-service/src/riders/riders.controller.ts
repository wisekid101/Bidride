import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Query,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { RidersService, UpdateProfileDto, SetHomeAddressDto } from './riders.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

class SetPushTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

@Controller('riders')
export class RidersController {
  constructor(private readonly ridersService: RidersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getProfile(@Headers('x-user-id') userId: string) {
    return this.ridersService.getProfile(userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateProfile(
    @Headers('x-user-id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.ridersService.updateProfile(userId, dto);
  }

  @Patch('me/push-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  setPushToken(@Headers('x-user-id') userId: string, @Body() dto: SetPushTokenDto) {
    return this.ridersService.setPushToken(userId, dto.token);
  }

  @Post('me/addresses')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  saveAddress(
    @Headers('x-user-id') userId: string,
    @Body() dto: SetHomeAddressDto,
  ) {
    return this.ridersService.saveAddress(userId, dto);
  }

  @Get('me/trips')
  @UseGuards(JwtAuthGuard)
  getTripHistory(
    @Headers('x-user-id') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ridersService.getTripHistory(
      userId,
      page ? parseInt(page) : undefined,
      limit ? parseInt(limit) : undefined,
    );
  }

  @Get('me/rewards')
  @UseGuards(JwtAuthGuard)
  getRewardPoints(@Headers('x-user-id') userId: string) {
    return this.ridersService.getRewardPoints(userId);
  }
}
