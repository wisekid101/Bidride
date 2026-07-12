import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ─── Domain kill switches (governance v1.1 hierarchy, domain tier) ──────────
// Every domain manifest names a killSwitchKey; this service enforces it for
// the domains serving TODAY (founder briefs, opportunity). Read-only Founder
// surfaces default ENABLED when the key is absent — turning them off is the
// explicit action; production-influencing domains keep the Phase 2
// ShadowModeService (shadow-on/families-off defaults) unchanged.

const CACHE_TTL_MS = 30_000;

@Injectable()
export class DomainSwitchService {
  private readonly logger = new Logger(DomainSwitchService.name);
  private cache: { values: Map<string, unknown>; fetchedAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** True unless the kill switch is explicitly set to false. */
  async isEnabled(killSwitchKey: string): Promise<boolean> {
    const value = (await this.read()).get(killSwitchKey);
    return !(value === false || value === 'false');
  }

  /** Guard helper: 503 with a clear message when the domain is switched off. */
  async assertEnabled(killSwitchKey: string, domainLabel: string): Promise<void> {
    if (!(await this.isEnabled(killSwitchKey))) {
      throw new ServiceUnavailableException(`${domainLabel} is disabled via ${killSwitchKey}`);
    }
  }

  resetCache(): void {
    this.cache = null;
  }

  private async read(): Promise<Map<string, unknown>> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < CACHE_TTL_MS) return this.cache.values;
    const values = new Map<string, unknown>();
    try {
      const rows = await this.prisma.platformConfig.findMany({
        where: { key: { startsWith: 'ai_' } },
      });
      for (const row of rows) values.set(row.key, row.value);
    } catch {
      // Config unreachable: read-only Founder surfaces stay available (they
      // control nothing); the failure is logged for ops.
      this.logger.warn('platform_config read failed — domain switches defaulting to enabled (read-only surfaces)');
    }
    this.cache = { values, fetchedAt: now };
    return values;
  }
}
