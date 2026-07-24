import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { TrustService } from './trust.service';
import { InternalKeyGuard } from './internal-key.guard';

class RecalculateDto {
  @IsString()
  @IsNotEmpty()
  userId: string;
}

@Controller('internal/trust')
@UseGuards(InternalKeyGuard)
export class TrustController {
  constructor(private readonly trust: TrustService) {}

  @Post('recalculate')
  @HttpCode(HttpStatus.OK)
  async recalculate(@Body() dto: RecalculateDto) {
    await this.trust.recalculateForUser(dto.userId);
    return { recalculated: true };
  }
}
