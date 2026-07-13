import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { MarketplaceHealthBrief } from './briefs/marketplace-health.brief';
import { MoneyMapBrief } from './briefs/money-map.brief';
import { AiPerformanceBrief } from './briefs/ai-performance.brief';
import { FocusBrief } from './briefs/focus.brief';
import { BriefType, FounderBrief } from './briefs/brief.types';
import { BRIEFS_SOURCE_VERSION } from './briefs/brief-helpers';
import { slaMinutesFor } from '../scheduler/job-config';

export const BRIEF_TYPES: BriefType[] = ['marketplace_health', 'money_map', 'ai_performance', 'focus'];

@Injectable()
export class FounderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketplaceHealth: MarketplaceHealthBrief,
    private readonly moneyMap: MoneyMapBrief,
    private readonly aiPerformance: AiPerformanceBrief,
    private readonly focus: FocusBrief,
  ) {}

  async generate(type: BriefType): Promise<FounderBrief> {
    const brief = await this.builder(type).generate();
    await this.prisma.aiBrief.create({
      data: {
        briefType: brief.briefType,
        windowStart: new Date(brief.windowStart),
        windowEnd: new Date(brief.windowEnd),
        payload: brief as unknown as Prisma.InputJsonValue,
        sourceVersion: BRIEFS_SOURCE_VERSION,
      },
    });
    return brief;
  }

  /**
   * READ-ONLY latest brief + freshness. GET never generates — the scheduler
   * (or an explicit POST generate) is the only writer, so a scheduler or
   * Redis failure makes briefs visibly stale instead of silently regenerated.
   */
  async latestWithFreshness(type: BriefType, now = new Date()): Promise<{
    brief: FounderBrief | null;
    generatedAt: string | null;
    stale: boolean;
    slaMinutes: number;
  }> {
    const slaMinutes = await slaMinutesFor(this.prisma, type);
    const row = await this.prisma.aiBrief.findFirst({
      where: { briefType: type },
      orderBy: { generatedAt: 'desc' },
    });
    if (!row) return { brief: null, generatedAt: null, stale: true, slaMinutes };
    const ageMin = (now.getTime() - row.generatedAt.getTime()) / 60_000;
    return {
      brief: row.payload as unknown as FounderBrief,
      generatedAt: row.generatedAt.toISOString(),
      stale: ageMin > slaMinutes,
      slaMinutes,
    };
  }

  /** Overview: latest generation timestamp + staleness per brief type. */
  async overview(now = new Date()): Promise<Array<{ briefType: BriefType; generatedAt: string | null; stale: boolean; slaMinutes: number }>> {
    const out: Array<{ briefType: BriefType; generatedAt: string | null; stale: boolean; slaMinutes: number }> = [];
    for (const type of BRIEF_TYPES) {
      const { generatedAt, stale, slaMinutes } = await this.latestWithFreshness(type, now);
      out.push({ briefType: type, generatedAt, stale, slaMinutes });
    }
    return out;
  }

  private builder(type: BriefType) {
    switch (type) {
      case 'marketplace_health': return this.marketplaceHealth;
      case 'money_map': return this.moneyMap;
      case 'ai_performance': return this.aiPerformance;
      case 'focus': return this.focus;
      default: throw new BadRequestException(`Unknown brief type: ${type as string}`);
    }
  }
}

export function parseBriefType(raw: string): BriefType {
  if (!BRIEF_TYPES.includes(raw as BriefType)) {
    throw new NotFoundException(`Unknown brief type "${raw}" — valid: ${BRIEF_TYPES.join(', ')}`);
  }
  return raw as BriefType;
}
