import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { acquireJobLock } from './redis-lock';
import { DEFAULT_JOBS, JobSpec, loadJobSpecs, slaMinutesFor } from './job-config';
import { FounderService } from '../founder/founder.service';
import { OpportunityAnalyzer } from '../founder/opportunity.analyzer';
import { OutcomeSnapshotService } from '../founder/outcome-snapshot.service';
import { RecommendationLedgerService } from '../recommendations/recommendation-ledger.service';
import { RetentionService } from '../retention/retention.service';
import { BriefType } from '../founder/briefs/brief.types';

export { DEFAULT_JOBS, JobSpec } from './job-config';

export interface JobRunResult {
  job: string;
  at: string;
  action: 'ran' | 'skipped_not_due' | 'skipped_lock_held' | 'skipped_redis_unavailable' | 'failed';
  durationMs?: number;
  detail?: string;
}

const STATE_KEY = 'ai_scheduler_state';
const TICK_MS = 5 * 60_000;
const BRIEF_JOBS: BriefType[] = ['marketplace_health', 'money_map', 'ai_performance', 'focus'] as BriefType[];

// ─── Leader-locked scheduler (Phase 3.2, Build Step 3) ───────────────────────
// ONE runner per job across all replicas via Redis SET NX PX. Failed lock →
// skip (someone else runs it). Redis unavailable → skip and log — skipping is
// safe, duplicate execution is not; briefs simply go visibly stale. One
// failed job never stops the others. Manual triggers share the exact job
// implementations. Schedules and freshness SLAs come from validated
// platform_config with safe defaults.

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  readonly instanceId = randomUUID();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** last observed result per job on THIS replica — observability surface */
  readonly lastResults = new Map<string, JobRunResult>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly founder: FounderService,
    private readonly opportunity: OpportunityAnalyzer,
    private readonly outcomes: OutcomeSnapshotService,
    private readonly ledger: RecommendationLedgerService,
    private readonly retention: RetentionService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    setTimeout(() => void this.tick(), 45_000); // first tick shortly after boot
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  loadJobs(): Promise<Record<string, JobSpec>> {
    return loadJobSpecs(this.prisma);
  }

  async tick(now = new Date()): Promise<JobRunResult[]> {
    const jobs = await this.loadJobs();
    const results: JobRunResult[] = [];
    for (const spec of Object.values(jobs)) {
      try {
        results.push(await this.maybeRun(spec, now));
      } catch (e) {
        // maybeRun already contains the job try/catch; this guards the guard.
        results.push({ job: spec.name, at: now.toISOString(), action: 'failed', detail: (e as Error).message.slice(0, 200) });
      }
    }
    for (const r of results) this.lastResults.set(r.job, r);
    return results;
  }

  /** Manual trigger — same implementation, lock-guarded, dueness bypassed. */
  async runNow(jobName: string): Promise<JobRunResult> {
    const jobs = await this.loadJobs();
    const spec = jobs[jobName];
    if (!spec) throw new NotFoundException(`Unknown scheduler job "${jobName}" — valid: ${Object.keys(jobs).join(', ')}`);
    const result = await this.executeLocked(spec, new Date(), true);
    this.lastResults.set(result.job, result);
    return result;
  }

  /** Freshness SLA readout for the brief GET endpoints. */
  slaMinutesFor(briefType: string): Promise<number> {
    return slaMinutesFor(this.prisma, briefType);
  }

  private async maybeRun(spec: JobSpec, now: Date): Promise<JobRunResult> {
    if (!(await this.isDue(spec, now))) {
      return { job: spec.name, at: now.toISOString(), action: 'skipped_not_due' };
    }
    return this.executeLocked(spec, now, false);
  }

  private async executeLocked(spec: JobSpec, now: Date, force: boolean): Promise<JobRunResult> {
    const lock = await acquireJobLock(this.redis, spec.name, this.instanceId, spec.lockTtlMs);
    if (!lock.acquired) {
      const action = lock.reason === 'redis_unavailable' ? 'skipped_redis_unavailable' : 'skipped_lock_held';
      if (lock.reason === 'redis_unavailable') {
        this.logger.warn(`job ${spec.name}: Redis unavailable — skipping safely (never duplicating)`);
      }
      return { job: spec.name, at: now.toISOString(), action };
    }
    // Re-verify dueness AFTER winning the lock: another replica may have just
    // completed the run this tick (idempotence belt).
    if (!force && !(await this.isDue(spec, now))) {
      return { job: spec.name, at: now.toISOString(), action: 'skipped_not_due' };
    }
    const start = Date.now();
    try {
      const detail = await this.execute(spec.name);
      await this.recordRun(spec.name, now);
      const result: JobRunResult = { job: spec.name, at: now.toISOString(), action: 'ran', durationMs: Date.now() - start, detail };
      this.logger.log(`job ${spec.name}: ran in ${result.durationMs}ms — ${detail}`);
      return result;
    } catch (e) {
      const result: JobRunResult = {
        job: spec.name, at: now.toISOString(), action: 'failed',
        durationMs: Date.now() - start, detail: (e as Error).message.slice(0, 200),
      };
      this.logger.error(`job ${spec.name}: FAILED after ${result.durationMs}ms — ${result.detail}`);
      return result; // one failed job never stops the others
    }
  }

  private async execute(job: string): Promise<string> {
    if ((BRIEF_JOBS as string[]).includes(job)) {
      const brief = await this.founder.generate(job as BriefType);
      return `generated ${brief.briefType} (${brief.sections.length} sections)`;
    }
    switch (job) {
      case 'opportunity': {
        const res = await this.opportunity.generate();
        return `opportunity ${res.kind}${res.zone ? ` zone=${res.zone}` : ''}`;
      }
      case 'outcome_snapshots': {
        const res = await this.outcomes.snapshotDue(100);
        return `snapshots: ${res.snapshotted} written, ${res.skipped} skipped`;
      }
      case 'expire_sweep': {
        const res = await this.ledger.expireSweep();
        return `expired ${res.expired}`;
      }
      case 'retention': {
        const config = await this.retention.loadConfig();
        if (!config.scheduleEnabled) return 'retention schedule disabled by config';
        const summary = await this.retention.run(false);
        return `retention: ${summary.tables.map((t) => `${t.table}=${t.deleted}`).join(' ')}`;
      }
      default:
        throw new Error(`no implementation for job ${job}`);
    }
  }

  private async isDue(spec: JobSpec, now: Date): Promise<boolean> {
    const last = await this.lastRunAt(spec.name);
    if (!last) return true;
    return now.getTime() - last.getTime() >= spec.intervalMin * 60_000;
  }

  private async lastRunAt(job: string): Promise<Date | null> {
    // Briefs: the brief table itself is the truth.
    if ((BRIEF_JOBS as string[]).includes(job)) {
      const row = await this.prisma.aiBrief.findFirst({
        where: { briefType: job },
        orderBy: { generatedAt: 'desc' },
        select: { generatedAt: true },
      });
      return row?.generatedAt ?? null;
    }
    const state = await this.readState();
    const iso = state[job];
    return iso ? new Date(iso) : null;
  }

  private async readState(): Promise<Record<string, string>> {
    try {
      const row = await this.prisma.platformConfig.findUnique({ where: { key: STATE_KEY } });
      return (row?.value ?? {}) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private async recordRun(job: string, now: Date): Promise<void> {
    if ((BRIEF_JOBS as string[]).includes(job)) return; // ai_briefs rows are the record
    try {
      const state = await this.readState();
      state[job] = now.toISOString();
      await this.prisma.platformConfig.upsert({
        where: { key: STATE_KEY },
        update: { value: state as unknown as Prisma.InputJsonValue },
        create: { key: STATE_KEY, value: state as unknown as Prisma.InputJsonValue, description: 'AI scheduler — last successful run per job' },
      });
    } catch (e) {
      this.logger.warn(`could not record run state for ${job}: ${(e as Error).message}`);
    }
  }
}
