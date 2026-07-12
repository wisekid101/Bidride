import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { InternalKeyGuard } from '../internal-key.guard';
import { RecommendationLedgerService } from './recommendation-ledger.service';
import { RECOMMENDATION_STATUSES, RecommendationStatus, UniversalRecommendation } from './recommendation.types';

// Internal-only ledger API. The admin-service Founder proxy is the sole
// intended caller of the decision endpoints; domain generators call create.

class ListQueryDto {
  @IsOptional() @IsString() @MaxLength(50) domain?: string;
  @IsOptional() @IsIn(RECOMMENDATION_STATUSES as unknown as string[]) status?: RecommendationStatus;
  @IsOptional() @IsString() @MaxLength(30) constitutionTag?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}

class ActorDto {
  @IsString() @IsNotEmpty() @MaxLength(100) actor: string;
  @IsString() @IsNotEmpty() @MaxLength(50) actorRole: string;
}

class DecisionDto extends ActorDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) reason: string;
}

class OutcomeDto extends ActorDto {
  @IsNumber() @Min(0) @Max(1) score: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

@UseGuards(InternalKeyGuard)
@Controller('ai/recommendations')
export class RecommendationsController {
  constructor(private readonly ledger: RecommendationLedgerService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() rec: UniversalRecommendation) {
    return this.ledger.create(rec);
  }

  @Get()
  list(@Query() q: ListQueryDto) {
    return this.ledger.list({
      domain: q.domain,
      status: q.status,
      constitutionTag: q.constitutionTag,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      page: q.page,
      limit: q.limit,
    });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.ledger.get(id);
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.OK)
  view(@Param('id', ParseUUIDPipe) id: string, @Body() body: ActorDto) {
    return this.ledger.markViewed(id, body);
  }

  @Post(':id/adopt')
  @HttpCode(HttpStatus.OK)
  adopt(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto) {
    return this.ledger.adopt(id, body, body.reason);
  }

  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  dismiss(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto) {
    return this.ledger.dismiss(id, body, body.reason);
  }

  @Post(':id/outcome')
  @HttpCode(HttpStatus.OK)
  outcome(@Param('id', ParseUUIDPipe) id: string, @Body() body: OutcomeDto) {
    return this.ledger.scoreOutcome(id, body, body.score, body.notes);
  }

  @Post('expire-sweep')
  @HttpCode(HttpStatus.OK)
  expireSweep() {
    return this.ledger.expireSweep();
  }
}
