import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { acquireRecoveryLock, releaseRecoveryLock } from './redis-lock';
import { CaptureRecoveryService, RECOVERY_STATUS, RecoveryRow } from './capture-recovery.service';
import { paymentMetrics } from '../observability/payment-metrics';
import { withCorrelation, BidRideLogger } from '@bidride/observability';

/**
 * Drains the capture-recovery worklist.
 *
 * A scheduled poller over an indexed table rather than a queue: no queue
 * infrastructure exists in this repository, and adding one would mean new infra
 * and new failure modes for a worklist that holds single-digit rows on a normal
 * day. The webhook fast path covers the latency case.
 *
 * Two independent guards stop duplicate work. A Redis leader lock means one
 * replica ticks at a time — and when Redis is unavailable the tick is SKIPPED,
 * never run unlocked. Each row is then claimed with a conditional update, so
 * even if a lock were somehow lost mid-tick, two workers cannot process the
 * same row.
 */

export const TICK_INTERVAL_MS = 60_000;
export const LOCK_TTL_MS = 55_000;
export const BATCH_SIZE = 25;
export const TICK_BUDGET_MS = 30_000;
/** First tick shortly after boot, not instantly — let the service settle. */
export const FIRST_TICK_DELAY_MS = 20_000;

/** Structured tick logging, separate from the Nest logger's string output. */
const tickLogger = new BidRideLogger('capture-recovery-scheduler');

export interface TickResult {
  at: string;
  action: 'ran' | 'skipped_lock_held' | 'skipped_redis_unavailable';
  claimed: number;
  resolved: number;
  deferred: number;
  budgetExhausted?: boolean;
}

@Injectable()
export class CaptureRecoveryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CaptureRecoveryScheduler.name);
  readonly instanceId = randomUUID();
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstTick: ReturnType<typeof setTimeout> | null = null;
  /** Last observed tick on THIS replica — the observability surface. */
  lastResult: TickResult | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly recovery: CaptureRecoveryService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.safeTick(), TICK_INTERVAL_MS);
    this.firstTick = setTimeout(() => void this.safeTick(), FIRST_TICK_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstTick) clearTimeout(this.firstTick);
  }

  private async safeTick(): Promise<void> {
    try {
      // PO-1B: a tick has no HTTP request, so it establishes its own context.
      // Every log line and EMF record inside the tick then carries jobRunId,
      // which is what makes one tick's work traceable end to end.
      await withCorrelation(randomUUID(), () => this.tick());
    } catch (e) {
      this.logger.error('capture recovery tick failed', e as Error);
    }
  }

  /** One pass over the worklist. Exposed so tests and manual triggers share it. */
  async tick(now = new Date()): Promise<TickResult> {
    const lock = await acquireRecoveryLock(this.redis, this.instanceId, LOCK_TTL_MS);
    if (!lock.acquired) {
      const action = lock.reason === 'redis_unavailable'
        ? 'skipped_redis_unavailable'
        : 'skipped_lock_held';
      if (lock.reason === 'redis_unavailable') {
        this.logger.warn('capture recovery tick skipped — Redis unavailable, refusing to run unlocked');
      }
      // ONE emission per tick, never per row — per-row counts belong to
      // recoveryResolutionTotal. `skipped_lock_held` is normal and proves the
      // lock works; sustained `skipped_redis_unavailable` means recovery has
      // stalled silently, which is the alarm-worthy case.
      paymentMetrics.recoveryTickTotal.inc({ action });
      const result: TickResult = { at: now.toISOString(), action, claimed: 0, resolved: 0, deferred: 0 };
      this.lastResult = result;
      return result;
    }

    const startedAt = Date.now();
    let claimed = 0;
    let resolved = 0;
    let deferred = 0;
    let budgetExhausted = false;

    try {
      const due = await this.prisma.captureRecovery.findMany({
        where: { status: RECOVERY_STATUS.unresolved, nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: 'asc' },
        take: BATCH_SIZE,
      });

      for (const row of due) {
        if (Date.now() - startedAt > TICK_BUDGET_MS) {
          budgetExhausted = true;
          break; // the rest keep their nextAttemptAt and are picked up next tick
        }

        if (!(await this.claim(row as RecoveryRow))) continue;
        claimed++;

        try {
          const outcome = await this.recovery.resolveOne({
            ...(row as RecoveryRow),
            attemptNumber: row.attemptNumber + 1, // the claim already incremented it
          });
          if (outcome.retryScheduled) deferred++;
          else resolved++;
        } catch (e) {
          // A row that throws must not take the tick down with it.
          this.logger.error(`capture recovery ${row.id} threw during resolution`, e as Error);
          deferred++;
        }
      }
    } finally {
      await releaseRecoveryLock(this.redis, this.instanceId);
    }

    paymentMetrics.recoveryTickTotal.inc({ action: 'ran' });

    // Gauges are sampled here, on the leader, because the lock is ALREADY held:
    // no second lock, no second schedule, and N replicas do not all query the
    // database every 60 seconds.
    await this.publishWorklistGauges();

    const result: TickResult = {
      at: now.toISOString(), action: 'ran', claimed, resolved, deferred,
      ...(budgetExhausted ? { budgetExhausted } : {}),
    };
    this.lastResult = result;
    tickLogger.info('recovery_tick', {
      action: 'ran', claimed, resolved, deferred, budgetExhausted: !!budgetExhausted,
      instanceId: this.instanceId,
    });
    return result;
  }

  /**
   * Sample the worklist depth (PO-1B).
   *
   * Reuses the two indexed queries the admin metrics endpoint already runs —
   * `[status, created_at DESC]` serves the groupBy, `[status, next_attempt_at]`
   * serves the oldest lookup.
   *
   * Zero-fill is mandatory. In CloudWatch "no data" and "no problem" are
   * different things, and an alarm on a missing series behaves differently from
   * one on zero, so a status with no rows must publish 0 rather than vanish.
   *
   * A failed query logs and publishes nothing. Gauge sampling must never abort
   * the recovery work the tick exists to do.
   */
  private async publishWorklistGauges(): Promise<void> {
    try {
      const [byStatus, oldest] = await Promise.all([
        this.prisma.captureRecovery.groupBy({ by: ['status'], _count: true }),
        this.prisma.captureRecovery.findFirst({
          where: { status: RECOVERY_STATUS.unresolved },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
      ]);

      const counts = new Map<string, number>(
        byStatus.map((r: { status: string; _count: number }) => [r.status, r._count]),
      );
      for (const status of Object.values(RECOVERY_STATUS)) {
        paymentMetrics.recoveryItems.set(counts.get(status) ?? 0, { status, resolution: 'none' });
      }

      paymentMetrics.recoveryOldestAgeSeconds.set(
        oldest ? Math.round((Date.now() - oldest.createdAt.getTime()) / 1000) : 0,
      );

      paymentMetrics.recoveryItems.publish();
      paymentMetrics.recoveryOldestAgeSeconds.publish();
    } catch (e) {
      this.logger.error('capture recovery gauge sampling failed', e as Error);
    }
  }

  /**
   * Conditional claim: succeeds for exactly one worker.
   *
   * Matching on the observed attemptNumber makes this a compare-and-set — if
   * another worker incremented it first, count is 0 and we skip the row rather
   * than resolving it twice.
   */
  private async claim(row: RecoveryRow): Promise<boolean> {
    const claimed = await this.prisma.captureRecovery.updateMany({
      where: {
        id: row.id,
        status: RECOVERY_STATUS.unresolved,
        attemptNumber: row.attemptNumber,
      },
      data: { attemptNumber: row.attemptNumber + 1 },
    });
    return claimed.count === 1;
  }
}
