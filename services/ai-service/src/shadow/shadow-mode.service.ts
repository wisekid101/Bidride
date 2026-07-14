import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Founder hard rule (AI Core Phase 2): while shadow mode is on, the AI
// service ALWAYS computes and logs its real recommendation but SERVES the
// neutral value the platform's own fallback would have produced — production
// behavior can never change because of the AI. Families flip live only when
// BOTH ai_shadow_mode is false AND the family switch is true.
//
// platform_config keys (Json values, read with a 30s in-memory cache):
//   ai_shadow_mode              default TRUE
//   ai_fare_enabled             default FALSE
//   ai_ranking_enabled          default FALSE
//   ai_win_probability_enabled  default FALSE
export type AiFamily = 'fare' | 'ranking' | 'win_probability';

const CACHE_TTL_MS = 30_000;

const FAMILY_KEYS: Record<AiFamily, string> = {
  fare: 'ai_fare_enabled',
  ranking: 'ai_ranking_enabled',
  win_probability: 'ai_win_probability_enabled',
};

@Injectable()
export class ShadowModeService {
  private readonly logger = new Logger(ShadowModeService.name);
  private cache: { values: Record<string, unknown>; fetchedAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** True when the family's recommendation may influence production. */
  async isLive(family: AiFamily): Promise<boolean> {
    const cfg = await this.read();
    const shadow = this.asBool(cfg['ai_shadow_mode'], true);
    const familyEnabled = this.asBool(cfg[FAMILY_KEYS[family]], false);
    return !shadow && familyEnabled;
  }

  /** Convenience for response payloads. */
  async isShadow(family: AiFamily): Promise<boolean> {
    return !(await this.isLive(family));
  }

  private async read(): Promise<Record<string, unknown>> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.values;
    }
    const keys = ['ai_shadow_mode', ...Object.values(FAMILY_KEYS)];
    try {
      const rows = await this.prisma.platformConfig.findMany({
        where: { key: { in: keys } },
      });
      const values: Record<string, unknown> = {};
      for (const row of rows) values[row.key] = row.value;
      this.cache = { values, fetchedAt: now };
      return values;
    } catch (e: unknown) {
      // Config unreachable → fail SAFE: shadow on, families off.
      this.logger.warn('platform_config read failed — enforcing shadow defaults');
      this.cache = { values: {}, fetchedAt: now };
      return {};
    }
  }

  private asBool(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
  }

  /** Test hook — drops the cache so config changes apply immediately. */
  resetCache(): void {
    this.cache = null;
  }
}
