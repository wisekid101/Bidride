import { PrismaService } from '../prisma/prisma.service';

// ─── Scheduler job configuration (shared, validated, safe defaults) ─────────
// Read by the SchedulerService (cadence + lock TTLs) and by the Founder brief
// endpoints (freshness SLAs) — one source of truth, no circular imports.

export interface JobSpec {
  name: string;
  intervalMin: number;
  /** freshness SLA for briefs (staleness display); tasks use intervalMin */
  slaMin: number;
  lockTtlMs: number;
}

export const SCHEDULE_CONFIG_KEY = 'ai_brief_schedule';

export const DEFAULT_JOBS: Record<string, JobSpec> = {
  marketplace_health: { name: 'marketplace_health', intervalMin: 1440, slaMin: 1560, lockTtlMs: 10 * 60_000 },
  money_map: { name: 'money_map', intervalMin: 1440, slaMin: 1560, lockTtlMs: 10 * 60_000 },
  ai_performance: { name: 'ai_performance', intervalMin: 1440, slaMin: 1560, lockTtlMs: 10 * 60_000 },
  focus: { name: 'focus', intervalMin: 10_080, slaMin: 10_200, lockTtlMs: 10 * 60_000 },
  opportunity: { name: 'opportunity', intervalMin: 10_080, slaMin: 10_200, lockTtlMs: 10 * 60_000 },
  outcome_snapshots: { name: 'outcome_snapshots', intervalMin: 1440, slaMin: 1560, lockTtlMs: 30 * 60_000 },
  expire_sweep: { name: 'expire_sweep', intervalMin: 360, slaMin: 420, lockTtlMs: 5 * 60_000 },
  retention: { name: 'retention', intervalMin: 1440, slaMin: 1560, lockTtlMs: 30 * 60_000 },
};

// Lock TTL must exceed any plausible run duration and never the interval.
const MIN_LOCK_TTL_MS = 60_000;

/** Config-validated job specs — a typo never breaks scheduling. */
export async function loadJobSpecs(prisma: PrismaService): Promise<Record<string, JobSpec>> {
  const jobs: Record<string, JobSpec> = JSON.parse(JSON.stringify(DEFAULT_JOBS));
  try {
    const row = await prisma.platformConfig.findUnique({ where: { key: SCHEDULE_CONFIG_KEY } });
    const raw = (row?.value ?? {}) as Record<string, Partial<JobSpec>>;
    for (const [name, spec] of Object.entries(raw)) {
      if (!jobs[name]) continue; // unknown job names in config are ignored
      const merged = { ...jobs[name], ...spec, name };
      if (!Number.isFinite(merged.intervalMin) || merged.intervalMin < 5) merged.intervalMin = jobs[name].intervalMin;
      if (!Number.isFinite(merged.slaMin) || merged.slaMin < merged.intervalMin) merged.slaMin = merged.intervalMin + 120;
      if (!Number.isFinite(merged.lockTtlMs) || merged.lockTtlMs < MIN_LOCK_TTL_MS || merged.lockTtlMs > merged.intervalMin * 60_000) {
        merged.lockTtlMs = jobs[name].lockTtlMs;
      }
      jobs[name] = merged;
    }
  } catch {
    // config unreadable → defaults
  }
  return jobs;
}

export async function slaMinutesFor(prisma: PrismaService, briefType: string): Promise<number> {
  const jobs = await loadJobSpecs(prisma);
  return jobs[briefType]?.slaMin ?? 1560;
}
