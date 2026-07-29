import { CaptureRecoveryScheduler, BATCH_SIZE } from './capture-recovery.scheduler';
import { RECOVERY_STATUS } from './capture-recovery.service';
import { RECOVERY_LOCK_KEY } from './redis-lock';

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
