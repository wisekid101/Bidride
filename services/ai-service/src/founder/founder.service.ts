import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { MarketplaceHealthBrief } from './briefs/marketplace-health.brief';
import { MoneyMapBrief } from './briefs/money-map.brief';
import { AiPerformanceBrief } from './briefs/ai-performance.brief';
import { BriefType, FounderBrief } from './briefs/brief.types';
import { BRIEFS_SOURCE_VERSION } from './briefs/brief-helpers';

export const BRIEF_TYPES: BriefType[] = ['marketplace_health', 'money_map', 'ai_performance'];

@Injectable()
export class FounderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketplaceHealth: MarketplaceHealthBrief,
    private readonly moneyMap: MoneyMapBrief,
    private readonly aiPerformance: AiPerformanceBrief,
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

  /** Latest stored brief of a type; generates one if none exists (or refresh requested). */
  async latest(type: BriefType, refresh = false): Promise<FounderBrief> {
    if (!refresh) {
      const row = await this.prisma.aiBrief.findFirst({
        where: { briefType: type },
        orderBy: { generatedAt: 'desc' },
      });
      if (row) return row.payload as unknown as FounderBrief;
    }
    return this.generate(type);
  }

  /** Overview: the latest generation timestamp per brief type. */
  async overview(): Promise<Array<{ briefType: BriefType; generatedAt: string | null }>> {
    const out: Array<{ briefType: BriefType; generatedAt: string | null }> = [];
    for (const type of BRIEF_TYPES) {
      const row = await this.prisma.aiBrief.findFirst({
        where: { briefType: type },
        orderBy: { generatedAt: 'desc' },
        select: { generatedAt: true },
      });
      out.push({ briefType: type, generatedAt: row?.generatedAt.toISOString() ?? null });
    }
    return out;
  }

  private builder(type: BriefType) {
    switch (type) {
      case 'marketplace_health': return this.marketplaceHealth;
      case 'money_map': return this.moneyMap;
      case 'ai_performance': return this.aiPerformance;
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
