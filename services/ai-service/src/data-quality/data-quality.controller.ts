import { Controller, Post, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { InternalKeyGuard } from '../internal-key.guard';
import { DataQualityService } from './data-quality.service';

@UseGuards(InternalKeyGuard)
@Controller('ai/data-quality')
export class DataQualityController {
  constructor(private readonly dataQuality: DataQualityService) {}

  @Post('classify')
  @HttpCode(HttpStatus.OK)
  classify() {
    return this.dataQuality.classifyAll();
  }

  @Get('summary')
  summary() {
    return this.dataQuality.summary();
  }
}
