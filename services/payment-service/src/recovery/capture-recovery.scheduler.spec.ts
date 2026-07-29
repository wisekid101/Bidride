import { CaptureRecoveryScheduler, BATCH_SIZE } from './capture-recovery.scheduler';
import { RECOVERY_STATUS } from './capture-recovery.service';
import { RECOVERY_LOCK_KEY } from './redis-lock';
import { testing } from '@bidride/observability';
import { paymentMetrics } from '../observability/payment-metrics';

// ─── F3b-1: the worker that drains the worklist ─────────────────────────────
// Two independent guards against duplicate work: a Redis leader lock, and a
// per-row conditional claim. The rule that matters most is the third one —
// when Redis is unavailable the tick is SKIPPED, never run unlocked. A missed
// tick costs a minute; two workers on one worklist costs correctness.

const dueRow = (over: Record<string, unknown> = {}) => ({
  id: 'rec-1', tripId: 'trip-1', paymentIntentId: 'pi_1', bidId: 'bid-1',
  expectedAmountCents: 2364, status: RECOVERY_STATUS.unresolved,
  attemptNumber: 0, holdExpiresAt: new Date(Date.now() + 3600_000), ...over,
});

const makePrisma = (rows: Record<string, unknown>[] = []) => ({
  captureRecovery: {
    findMany: jest.fn().mockResolvedValue(rows),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
});

const makeRedis = (setResult: string | null = 'OK') => ({
  set: jest.fn().mockResolvedValue(setResult),
  eval: jest.fn().mockResolvedValue(1),
});

const makeRecovery = () => ({
  resolveOne: jest.fn().mockResolvedValue({
    id: 'rec-1', tripId: 'trip-1', status: RECOVERY_STATUS.resolvedNotCaptured,
    resolution: 'stripe_reports_canceled', retryScheduled: false,
  }),
});

const build = (
  prisma: ReturnType<typeof makePrisma>,
  redis: ReturnType<typeof makeRedis> | undefined,
  recovery: ReturnType<typeof makeRecovery>,
) => new CaptureRecoveryScheduler(prisma as never, recovery as never, redis as never);

describe('CaptureRecoveryScheduler', () => {
  // ── Leader lock ──────────────────────────────────────────────────────────

  it('takes the leader lock with NX and a bounded TTL', async () => {
    const redis = makeRedis();
    await build(makePrisma(), redis, makeRecovery()).tick();

    const [key, , pxFlag, ttl, nxFlag] = redis.set.mock.calls[0];
    expect(key).toBe(RECOVERY_LOCK_KEY);
    expect(pxFlag).toBe('PX');
    expect(ttl).toBeGreaterThan(0);
    expect(nxFlag).toBe('NX');
  });

  it('skips entirely when another replica holds the lock', async () => {
    const prisma = makePrisma([dueRow()]);
    const recovery = makeRecovery();

    const result = await build(prisma, makeRedis(null), recovery).tick();

    expect(result.action).toBe('skipped_lock_held');
    expect(prisma.captureRecovery.findMany).not.toHaveBeenCalled();
    expect(recovery.resolveOne).not.toHaveBeenCalled();
  });

  it('refuses to run unlocked when Redis is unavailable', async () => {
    const prisma = makePrisma([dueRow()]);
    const recovery = makeRecovery();

    const result = await build(prisma, undefined, recovery).tick();

    expect(result.action).toBe('skipped_redis_unavailable');
    expect(recovery.resolveOne).not.toHaveBeenCalled();
  });

  it('treats a Redis error as unavailable rather than as a free lock', async () => {
    const redis = { set: jest.fn().mockRejectedValue(new Error('down')), eval: jest.fn() };
    const recovery = makeRecovery();

    const result = await build(makePrisma([dueRow()]), redis as never, recovery).tick();

    expect(result.action).toBe('skipped_redis_unavailable');
    expect(recovery.resolveOne).not.toHaveBeenCalled();
  });

  it('releases the lock by compare-and-delete', async () => {
    const redis = makeRedis();
    const scheduler = build(makePrisma(), redis, makeRecovery());

    await scheduler.tick();

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1])'),
      1, RECOVERY_LOCK_KEY, scheduler.instanceId,
    );
  });

  it('releases the lock even when the batch throws', async () => {
    const prisma = makePrisma();
    prisma.captureRecovery.findMany.mockRejectedValue(new Error('db down'));
    const redis = makeRedis();

    await expect(build(prisma, redis, makeRecovery()).tick()).rejects.toThrow('db down');

    expect(redis.eval).toHaveBeenCalled();
  });

  // ── Batching and claiming ────────────────────────────────────────────────

  it('claims only due, unresolved rows and bounds the batch', async () => {
    const prisma = makePrisma([dueRow()]);
    await build(prisma, makeRedis(), makeRecovery()).tick();

    const args = prisma.captureRecovery.findMany.mock.calls[0][0];
    expect(args.where.status).toBe(RECOVERY_STATUS.unresolved);
    expect(args.where.nextAttemptAt.lte).toBeInstanceOf(Date);
    expect(args.take).toBe(BATCH_SIZE);
    expect(args.orderBy).toEqual({ nextAttemptAt: 'asc' });
  });

  it('claims each row conditionally on its observed attempt number', async () => {
    const prisma = makePrisma([dueRow({ attemptNumber: 3 })]);
    await build(prisma, makeRedis(), makeRecovery()).tick();

    expect(prisma.captureRecovery.updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-1', status: RECOVERY_STATUS.unresolved, attemptNumber: 3 },
      data: { attemptNumber: 4 },
    });
  });

  it('a lost claim means another worker took the row — skip it', async () => {
    const prisma = makePrisma([dueRow()]);
    prisma.captureRecovery.updateMany.mockResolvedValue({ count: 0 });
    const recovery = makeRecovery();

    const result = await build(prisma, makeRedis(), recovery).tick();

    expect(recovery.resolveOne).not.toHaveBeenCalled();
    expect(result.claimed).toBe(0);
  });

  it('passes the incremented attempt number into resolution', async () => {
    const recovery = makeRecovery();
    await build(makePrisma([dueRow({ attemptNumber: 2 })]), makeRedis(), recovery).tick();

    expect(recovery.resolveOne).toHaveBeenCalledWith(expect.objectContaining({ attemptNumber: 3 }));
  });

  // ── Resilience ───────────────────────────────────────────────────────────

  it('one row throwing does not stop the rest of the batch', async () => {
    const prisma = makePrisma([dueRow({ id: 'rec-1' }), dueRow({ id: 'rec-2' })]);
    const recovery = makeRecovery();
    recovery.resolveOne
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'rec-2', tripId: 't', status: RECOVERY_STATUS.needsAdmin, resolution: 'x', retryScheduled: false });

    const result = await build(prisma, makeRedis(), recovery).tick();

    expect(recovery.resolveOne).toHaveBeenCalledTimes(2);
    expect(result.resolved).toBe(1);
    expect(result.deferred).toBe(1);
  });

  it('counts deferrals separately from resolutions', async () => {
    const recovery = makeRecovery();
    recovery.resolveOne.mockResolvedValue({
      id: 'rec-1', tripId: 't', status: RECOVERY_STATUS.unresolved,
      resolution: 'retry_scheduled', retryScheduled: true,
    });

    const result = await build(makePrisma([dueRow()]), makeRedis(), recovery).tick();

    expect(result.deferred).toBe(1);
    expect(result.resolved).toBe(0);
  });

  it('records the last tick for observability', async () => {
    const scheduler = build(makePrisma([dueRow()]), makeRedis(), makeRecovery());

    await scheduler.tick();

    expect(scheduler.lastResult).toMatchObject({ action: 'ran', claimed: 1, resolved: 1 });
  });

  it('an empty worklist is a clean no-op tick', async () => {
    const result = await build(makePrisma([]), makeRedis(), makeRecovery()).tick();

    expect(result).toMatchObject({ action: 'ran', claimed: 0, resolved: 0, deferred: 0 });
  });
});

// ─── PO-1B: scheduler metrics ───────────────────────────────────────────────
// Tick counting and gauge sampling are pure in-process behaviour, so they are
// asserted here rather than in an integration suite — driving them against the
// real leader lock would only make two suites contend for one Redis key.
//
// The rule this pins down: ONE tick metric per tick, never one per row.

describe('CaptureRecoveryScheduler — metrics (PO-1B)', () => {
  let capture: ReturnType<typeof testing.captureMetrics>;

  beforeEach(() => { testing.withTestIdentity(); capture = testing.captureMetrics(); });
  afterEach(() => { capture.stop(); testing.restoreIdentity(); });

  const gaugePrisma = (rows: Array<{ status: string; _count: number }> = [], oldest: Date | null = null) => ({
    captureRecovery: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue(rows),
      findFirst: jest.fn().mockResolvedValue(oldest ? { createdAt: oldest } : null),
    },
  });

  it.each([
    ['ran', 'OK'],
    ['skipped_lock_held', null],
  ])('emits exactly one tick metric with action=%s', async (action, setResult) => {
    const scheduler = new CaptureRecoveryScheduler(
      gaugePrisma() as never, makeRecovery() as never, makeRedis(setResult) as never,
    );

    await scheduler.tick();

    const ticks = capture.named('bidride_payment_recovery_tick_total');
    expect(ticks).toHaveLength(1);
    expect(ticks[0].dimensions.action).toBe(action);
  });

  it('emits skipped_redis_unavailable when there is no Redis', async () => {
    const scheduler = new CaptureRecoveryScheduler(gaugePrisma() as never, makeRecovery() as never, undefined);

    await scheduler.tick();

    expect(capture.named('bidride_payment_recovery_tick_total')[0].dimensions.action)
      .toBe('skipped_redis_unavailable');
  });

  it('emits ONE tick metric regardless of how many rows it processes', async () => {
    const prisma = gaugePrisma();
    prisma.captureRecovery.findMany.mockResolvedValue([
      dueRow({ id: 'r1' }), dueRow({ id: 'r2' }), dueRow({ id: 'r3' }),
    ]);
    const recovery = makeRecovery();

    await new CaptureRecoveryScheduler(prisma as never, recovery as never, makeRedis() as never).tick();

    expect(recovery.resolveOne).toHaveBeenCalledTimes(3);
    expect(capture.named('bidride_payment_recovery_tick_total')).toHaveLength(1);
  });

  it('publishes a gauge for EVERY status, zero-filling the absent ones', async () => {
    // In CloudWatch "no data" and "no problem" are different things, so a status
    // with no rows must publish 0 rather than vanish.
    const prisma = gaugePrisma([{ status: 'unresolved', _count: 4 }]);

    await new CaptureRecoveryScheduler(prisma as never, makeRecovery() as never, makeRedis() as never).tick();

    const gauges = capture.named('bidride_payment_recovery_items');
    const byStatus = Object.fromEntries(gauges.map((g) => [g.dimensions.status, g.value]));
    expect(byStatus.unresolved).toBe(4);
    for (const s of ['resolved_captured', 'resolved_not_captured', 'needs_admin', 'closed']) {
      expect(byStatus[s]).toBe(0);
    }
  });

  it('publishes the oldest unresolved age, and zero when the worklist is empty', async () => {
    await new CaptureRecoveryScheduler(gaugePrisma() as never, makeRecovery() as never, makeRedis() as never).tick();

    expect(capture.named('bidride_payment_recovery_oldest_age_seconds')[0].value).toBe(0);
  });

  it('publishes a real age when an unresolved item exists', async () => {
    const prisma = gaugePrisma([], new Date(Date.now() - 120_000));

    await new CaptureRecoveryScheduler(prisma as never, makeRecovery() as never, makeRedis() as never).tick();

    expect(capture.named('bidride_payment_recovery_oldest_age_seconds')[0].value)
      .toBeGreaterThanOrEqual(119);
  });

  it('a failing gauge query does not abort the tick', async () => {
    // Sampling is telemetry; the recovery work it rides along with is not.
    const prisma = gaugePrisma();
    prisma.captureRecovery.groupBy.mockRejectedValue(new Error('db down'));

    const result = await new CaptureRecoveryScheduler(
      prisma as never, makeRecovery() as never, makeRedis() as never,
    ).tick();

    expect(result.action).toBe('ran');
    expect(capture.named('bidride_payment_recovery_items')).toHaveLength(0);
  });

  it('a skipped tick samples no gauges — the leader will', async () => {
    const prisma = gaugePrisma();

    await new CaptureRecoveryScheduler(prisma as never, makeRecovery() as never, makeRedis(null) as never).tick();

    expect(prisma.captureRecovery.groupBy).not.toHaveBeenCalled();
  });

  it('the tick metric is registered with a bounded action dimension', () => {
    paymentMetrics.recoveryTickTotal.inc({ action: 'invented_action' });

    const emitted = capture.named('bidride_payment_recovery_tick_total');
    expect(emitted[emitted.length - 1].dimensions.action).toBe('other');
  });
});
