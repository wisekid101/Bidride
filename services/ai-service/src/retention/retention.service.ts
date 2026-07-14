import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';

// ─── AI Data Retention Enforcement (Phase 3.1, governance v1.1 §retention) ───
// Deletes ONLY from the allowlisted AI tables below. Canonical financial,
// trip, payment, safety, and legal records are NEVER touched — the allowlist
// is the enforcement, not a convention. Configurable via platform_config,
// dry-run by default from the endpoint, batched, per-table failure isolation,
// and an audit summary persisted after every run.

export interface RetentionConfig {
  aiPricingLogsDays: number;
  aiInferenceLogsDays: number;
  bidOutcomesDays: number;
  aiRecommendationsDays: number;
  aiBriefsDays: number;
  batchSize: number;
  scheduleEnabled: boolean;
}

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  aiPricingLogsDays: 365,
  aiInferenceLogsDays: 365,
  bidOutcomesDays: 365,
  aiRecommendationsDays: 365,
  aiBriefsDays: 365,
  batchSize: 1000,
  scheduleEnabled: true,
};

export interface TableRunResult {
  table: string;
  cutoff: string;
  eligible: number;
  deleted: number;
  batches: number;
  error?: string;
}

export interface RetentionRunSummary {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  config: RetentionConfig;
  tables: TableRunResult[];
}

const CONFIG_KEY = 'ai_retention_config';
const LAST_RUN_KEY = 'ai_retention_last_run';

// Recommendations that represent Founder decisions or scored learning are
// retained beyond the window — adopted AND dismissed rows are Founder
// supervision signals (decision + reason) and are never aged out; only
// undecided expired proposals are deletable.
const DELETABLE_RECOMMENDATION_STATUSES = ['expired'];

// Scheduling moved to the leader-locked SchedulerService (Phase 3.2) — this
// service no longer owns a timer, so multiple replicas never sweep twice.
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async loadConfig(): Promise<RetentionConfig> {
    try {
      const row = await this.prisma.platformConfig.findUnique({ where: { key: CONFIG_KEY } });
      const raw = (row?.value ?? {}) as Partial<RetentionConfig>;
      const merged = { ...DEFAULT_RETENTION_CONFIG, ...raw };
      // Sanity bounds: retention can never be configured below 30 days by accident.
      for (const k of ['aiPricingLogsDays', 'aiInferenceLogsDays', 'bidOutcomesDays', 'aiRecommendationsDays', 'aiBriefsDays'] as const) {
        if (!Number.isInteger(merged[k]) || merged[k] < 30) merged[k] = DEFAULT_RETENTION_CONFIG[k];
      }
      if (!Number.isInteger(merged.batchSize) || merged.batchSize < 1 || merged.batchSize > 10_000) {
        merged.batchSize = DEFAULT_RETENTION_CONFIG.batchSize;
      }
      return merged;
    } catch {
      return DEFAULT_RETENTION_CONFIG; // config unreadable → safe defaults
    }
  }

  async run(dryRun: boolean): Promise<RetentionRunSummary> {
    const config = await this.loadConfig();
    const startedAt = new Date().toISOString();
    const now = Date.now();
    const cutoff = (days: number) => new Date(now - days * 86_400_000);

    const tables: TableRunResult[] = [];

    tables.push(await this.sweep('ai_pricing_logs', dryRun, config.batchSize, cutoff(config.aiPricingLogsDays), {
      count: (c) => this.prisma.aiPricingLog.count({ where: { createdAt: { lt: c } } }),
      deleteBatch: async (c, take) => {
        const rows = await this.prisma.aiPricingLog.findMany({ where: { createdAt: { lt: c } }, select: { id: true }, take });
        if (rows.length === 0) return 0;
        const res = await this.prisma.aiPricingLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
        return res.count;
      },
    }));

    tables.push(await this.sweep('ai_inference_logs', dryRun, config.batchSize, cutoff(config.aiInferenceLogsDays), {
      count: (c) => this.prisma.aiInferenceLog.count({ where: { createdAt: { lt: c } } }),
      deleteBatch: async (c, take) => {
        const rows = await this.prisma.aiInferenceLog.findMany({ where: { createdAt: { lt: c } }, select: { id: true }, take });
        if (rows.length === 0) return 0;
        const res = await this.prisma.aiInferenceLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
        return res.count;
      },
    }));

    tables.push(await this.sweep('bid_outcomes', dryRun, config.batchSize, cutoff(config.bidOutcomesDays), {
      count: (c) => this.prisma.bidOutcome.count({ where: { createdAt: { lt: c } } }),
      deleteBatch: async (c, take) => {
        const rows = await this.prisma.bidOutcome.findMany({ where: { createdAt: { lt: c } }, select: { id: true }, take });
        if (rows.length === 0) return 0;
        const res = await this.prisma.bidOutcome.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
        return res.count;
      },
    }));

    // Ledger: only terminal, undecided statuses age out. Adopted and
    // outcome-scored rows are Founder/business memory — retained.
    tables.push(await this.sweep('ai_recommendations', dryRun, config.batchSize, cutoff(config.aiRecommendationsDays), {
      count: (c) => this.prisma.aiRecommendation.count({ where: { createdAt: { lt: c }, status: { in: DELETABLE_RECOMMENDATION_STATUSES } } }),
      deleteBatch: async (c, take) => {
        const rows = await this.prisma.aiRecommendation.findMany({
          where: { createdAt: { lt: c }, status: { in: DELETABLE_RECOMMENDATION_STATUSES } },
          select: { id: true },
          take,
        });
        if (rows.length === 0) return 0;
        // events cascade via FK onDelete: Cascade
        const res = await this.prisma.aiRecommendation.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
        return res.count;
      },
    }));

    tables.push(await this.sweep('ai_briefs', dryRun, config.batchSize, cutoff(config.aiBriefsDays), {
      count: (c) => this.prisma.aiBrief.count({ where: { generatedAt: { lt: c } } }),
      deleteBatch: async (c, take) => {
        const rows = await this.prisma.aiBrief.findMany({ where: { generatedAt: { lt: c } }, select: { id: true }, take });
        if (rows.length === 0) return 0;
        const res = await this.prisma.aiBrief.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
        return res.count;
      },
    }));

    const summary: RetentionRunSummary = {
      dryRun,
      startedAt,
      finishedAt: new Date().toISOString(),
      config,
      tables,
    };

    // Persist the audit summary (upsert — the history of runs shows in logs;
    // the last run is queryable by the Founder surface).
    try {
      await this.prisma.platformConfig.upsert({
        where: { key: LAST_RUN_KEY },
        update: { value: summary as unknown as Prisma.InputJsonValue },
        create: { key: LAST_RUN_KEY, value: summary as unknown as Prisma.InputJsonValue, description: 'AI retention enforcement — last run audit summary' },
      });
    } catch (e) {
      this.logger.warn(`retention summary persist failed: ${(e as Error).message}`);
    }
    this.logger.log(
      `retention ${dryRun ? 'DRY-RUN' : 'run'}: ${tables.map((t) => `${t.table} eligible=${t.eligible} deleted=${t.deleted}${t.error ? ' ERROR' : ''}`).join(' | ')}`,
    );
    return summary;
  }

  async lastRun(): Promise<RetentionRunSummary | null> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: LAST_RUN_KEY } });
    return (row?.value as unknown as RetentionRunSummary) ?? null;
  }

  /** Failure in one table never blocks the others; batches keep progress on retry. */
  private async sweep(
    table: string,
    dryRun: boolean,
    batchSize: number,
    cutoff: Date,
    ops: { count: (cutoff: Date) => Promise<number>; deleteBatch: (cutoff: Date, take: number) => Promise<number> },
  ): Promise<TableRunResult> {
    const result: TableRunResult = { table, cutoff: cutoff.toISOString(), eligible: 0, deleted: 0, batches: 0 };
    try {
      result.eligible = await ops.count(cutoff);
      if (dryRun || result.eligible === 0) return result;
      // Batched deletion with a hard iteration bound (failure recovery: rerun resumes).
      const maxBatches = Math.ceil(result.eligible / batchSize) + 5;
      while (result.batches < maxBatches) {
        const deleted = await ops.deleteBatch(cutoff, batchSize);
        if (deleted === 0) break;
        result.deleted += deleted;
        result.batches += 1;
      }
    } catch (e) {
      result.error = (e as Error).message.slice(0, 300);
    }
    return result;
  }
}
