import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsString, IsOptional } from 'class-validator';
import { PlatformConfigService } from './platform-config.service';
import { AdminSessionGuard } from '../auth/admin-session.guard';

class UpdateConfigDto {
  value: unknown;

  @IsOptional()
  @IsString()
  founderSignature?: string;
}

@Controller('admin/config')
@UseGuards(AdminSessionGuard)
export class PlatformConfigController {
  constructor(private readonly platformConfigService: PlatformConfigService) {}

  @Get()
  getAll() {
    return this.platformConfigService.getAll();
  }

  @Get(':key')
  get(@Param('key') key: string) {
    return this.platformConfigService.get(key);
  }

  @Put(':key')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('key') key: string,
    @Body() dto: UpdateConfigDto,
    @Headers('x-user-role') adminRole: string,
  ) {
    return this.platformConfigService.update(key, dto.value, adminRole, dto.founderSignature);
  }
}
