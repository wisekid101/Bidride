import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { InternalKeyGuard } from '../internal-key.guard';
import { FounderService, parseBriefType } from './founder.service';
import { OpportunityAnalyzer } from './opportunity.analyzer';
import { DomainSwitchService } from '../domains/domain-switch.service';
import { OutcomeSnapshotService } from './outcome-snapshot.service';
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
    private readonly outcomes: OutcomeSnapshotService,
  ) {}

  @Get('briefs')
  async overview() {
    await this.switches.assertEnabled(FOUNDER_SWITCH, 'Founder Intelligence');
    return this.founder.overview();
  }

  @Get('briefs/:type')
  async latest(@Param('type') type: string) {
    // Pure read: returns { brief, generatedAt, stale, slaMinutes } and NEVER
    // generates. Missing briefs are represented honestly (brief: null).
    await this.switches.assertEnabled(FOUNDER_SWITCH, 'Founder Intelligence');
    return this.founder.latestWithFreshness(parseBriefType(type));
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

  // Outcome evidence snapshots — measurement only; the Founder scores.
  @Post('outcome-snapshots/run')
  @HttpCode(HttpStatus.OK)
  async runOutcomeSnapshots() {
    await this.switches.assertEnabled(FOUNDER_SWITCH, 'Founder Intelligence');
    return this.outcomes.snapshotDue();
  }

  @Post('outcome-snapshots/:id')
  @HttpCode(HttpStatus.OK)
  async snapshotOne(@Param('id', ParseUUIDPipe) id: string) {
    await this.switches.assertEnabled(FOUNDER_SWITCH, 'Founder Intelligence');
    return this.outcomes.snapshotOne(id);
  }
}
