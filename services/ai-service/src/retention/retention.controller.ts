import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { InternalKeyGuard } from '../internal-key.guard';
import { RetentionService } from './retention.service';

class RunRetentionDto {
  // Dry-run unless explicitly disabled — deleting is the opt-in.
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

@UseGuards(InternalKeyGuard)
@Controller('ai/retention')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  run(@Body() body: RunRetentionDto) {
    return this.retention.run(body.dryRun !== false);
  }

  @Get('last-run')
  lastRun() {
    return this.retention.lastRun();
  }

  @Get('config')
  config() {
    return this.retention.loadConfig();
  }
}
