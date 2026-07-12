import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InternalKeyGuard } from '../internal-key.guard';
import { FounderService, parseBriefType } from './founder.service';
import { OpportunityAnalyzer } from './opportunity.analyzer';
import { DomainSwitchService } from '../domains/domain-switch.service';
import { getDomain } from '../domains/domain-manifest';

// Internal-only. The admin-service Founder proxy is the sole intended caller.
// Everything here is READ + GENERATE: no endpoint changes any product state.
// Domain kill switches (manifest killSwitchKey) are enforced per request.

const FOUNDER_SWITCH = getDomain('founder')!.killSwitchKey;
const OPPORTUNITY_SWITCH = getDomain('opportunity')!.killSwitchKey;

@UseGuards(InternalKeyGuard)
@Controller('ai/founder')
export class FounderController {
  constructor(
    private readonly founder: FounderService,
    private readonly opportunity: OpportunityAnalyzer,
    private readonly switches: DomainSwitchService,
  ) {}

  @Get('briefs')
  async overview() {
    await this.switches.assertEnabled(FOUNDER_SWITCH, 'Founder Intelligence');
    return this.founder.overview();
  }

  @Get('briefs/:type')
  async latest(@Param('type') type: string, @Query('refresh') refresh?: string) {
    await this.switches.assertEnabled(FOUNDER_SWITCH, 'Founder Intelligence');
    return this.founder.latest(parseBriefType(type), refresh === 'true');
  }

  @Post('briefs/:type/generate')
  @HttpCode(HttpStatus.OK)
  async generate(@Param('type') type: string) {
    await this.switches.assertEnabled(FOUNDER_SWITCH, 'Founder Intelligence');
    return this.founder.generate(parseBriefType(type));
  }

  @Post('opportunity/generate')
  @HttpCode(HttpStatus.OK)
  async generateOpportunity() {
    await this.switches.assertEnabled(OPPORTUNITY_SWITCH, 'Opportunity Intelligence');
    return this.opportunity.generate();
  }
}
