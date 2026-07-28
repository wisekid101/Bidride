/**
 * Test-only support for integration specs that drive BidsService.sweepExpiredBids().
 *
 * TEST-ONLY. Lives outside src/ so it is excluded from the build and never
 * collected as a suite. No production file imports it.
 *
 * Why it exists: F2 gave the sweep a Redis lease so only one replica sweeps at
 * a time, and a contended sweep returns silently by design (Founder Decision 1
 * — silent contention, no operational noise). Integration spec files run in
 * PARALLEL Jest workers and every sweep contends for the same production key,
 * which breaks two naive assumptions:
 *
 *   1. "the lock key is absent afterwards" — false, another worker may
 *      legitimately hold it by then;
 *   2. "the sweep I just called did the work" — false, it may have silently
 *      skipped because another worker held the lease.
 *
 * Both specs therefore go through this helper, which establishes that THIS
 * test owned the lease for the sweep it is about to assert on. That keeps the
 * suite fully parallel — no maxWorkers=1 — and it is what makes the assertions
 * mean something rather than pass vacuously.
 *
 * Production sweepExpiredBids() is untouched: ownership is observed from
 * outside, by watching what the service writes to Redis.
 */
import type { Redis } from 'ioredis';

/** Mirrors SWEEP_LOCK_KEY in bids.service.ts. */
export const SWEEP_LOCK_KEY = 'bid:sweep:lock';

/** The lock is held only for the duration of one sweep, so a few tries is ample. */
const MAX_ATTEMPTS = 25;
const RETRY_DELAY_MS = 50;

export interface SweepResult {
  /** The lease token this test's sweep actually wrote. Never null on return. */
  token: string;
  /** Whatever the sweep threw, if anything — the caller decides if that is expected. */
  error?: unknown;
}

/**
 * Run `sweep` until it acquires the lease, and return the token it wrote.
 *
 * `redisSet` must be the SAME ioredis instance the service was constructed
 * with; the spy delegates to the real implementation, so behaviour is
 * unchanged — the token is merely observed in passing.
 */
export async function sweepOwningLease(
  redis: Redis,
  sweep: () => Promise<unknown>,
): Promise<SweepResult> {
  const realSet = redis.set.bind(redis);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let token: string | null = null;
    let error: unknown;

    const spy = jest.spyOn(redis, 'set').mockImplementation((async (...args: unknown[]) => {
      const result = await (realSet as (...a: unknown[]) => Promise<unknown>)(...args);
      if (args[0] === SWEEP_LOCK_KEY && result === 'OK') token = args[1] as string;
      return result;
    }) as never);

    try {
      await sweep();
    } catch (e) {
      error = e;
    } finally {
      spy.mockRestore();
    }

    if (token !== null) return { token, error };
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS)); // another worker holds it
  }

  throw new Error(
    `never acquired ${SWEEP_LOCK_KEY} in ${MAX_ATTEMPTS} attempts — ` +
      'the lease looks stuck, not merely contended',
  );
}

/**
 * Advisory lock that gives ONE spec exclusive use of sweepable bid fixtures.
 *
 * Distinct from SWEEP_LOCK_KEY and invisible to production: no production code
 * reads this key, and sweepExpiredBids() is unchanged.
 *
 * Why it is needed. The production sweep deliberately has no fixture filter —
 * it selects every bid where `status ∈ EXPIRABLE ∧ expiresAt ≤ now`, across the
 * whole database. The production lease guarantees only that one sweeper runs at
 * a time; it does not stop that sweeper from consuming a parallel worker's
 * fixtures. So a spec that seeds an expired bid can have it expired, and its
 * trip cancelled with `bid_expired`, by a sweeper in another Jest worker before
 * its own assertions run.
 *
 * The fix belongs in the tests, not the sweep. Every critical section that
 * seeds a sweepable bid and asserts on its fate takes this lock, so only one
 * such section is live at a time. Everything else — other spec files, other
 * services, Turbo itself — stays fully parallel.
 */
const FIXTURE_LOCK_KEY = 'test:bid-fixtures:lock';

/** Comfortably longer than any single test, so a crashed worker self-heals. */
const FIXTURE_LOCK_TTL_SECONDS = 60;

/** Under Jest's 30s testTimeout: wait up to 20s for the holder to finish. */
const FIXTURE_LOCK_MAX_WAIT_MS = 20_000;
const FIXTURE_LOCK_POLL_MS = 50;

export interface FixtureLease {
  release: () => Promise<void>;
}

/**
 * Take exclusive use of sweepable bid fixtures. ALWAYS release in a finally —
 * `withExclusiveBidFixtures` does that for you.
 */
export async function acquireBidFixtures(redis: Redis): Promise<FixtureLease> {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + FIXTURE_LOCK_MAX_WAIT_MS;

  for (;;) {
    const ok = await redis.set(
      FIXTURE_LOCK_KEY, token, 'EX', FIXTURE_LOCK_TTL_SECONDS, 'NX',
    );
    if (ok === 'OK') {
      return {
        // Compare-and-delete: never drop a lock that has since been reclaimed
        // by another worker after our TTL expired.
        release: async () => {
          if ((await redis.get(FIXTURE_LOCK_KEY)) === token) await redis.del(FIXTURE_LOCK_KEY);
        },
      };
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${FIXTURE_LOCK_MAX_WAIT_MS}ms waiting for ${FIXTURE_LOCK_KEY} — ` +
          'a spec is holding the bid-fixture lock far longer than a test should',
      );
    }
    await new Promise((r) => setTimeout(r, FIXTURE_LOCK_POLL_MS));
  }
}

/** Run `fn` with exclusive use of sweepable bid fixtures, releasing on any exit. */
export async function withExclusiveBidFixtures<T>(
  redis: Redis,
  fn: () => Promise<T>,
): Promise<T> {
  const lease = await acquireBidFixtures(redis);
  try {
    return await fn();
  } finally {
    await lease.release();
  }
}

/**
 * Take the lease the way a competing replica would, so a test can prove the
 * service refuses to work — or to release — while someone else holds it.
 *
 * Acquired with NX and released by compare-and-delete, never by a bare SET or
 * DEL: forcing the key would steal a parallel worker's live lease and break
 * the very mutual exclusion the other specs depend on.
 */
export async function holdForeignLease(
  redis: Redis,
  token = `foreign-${process.pid}-${Date.now()}`,
): Promise<{ token: string; release: () => Promise<void> }> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const ok = await redis.set(SWEEP_LOCK_KEY, token, 'EX', 25, 'NX');
    if (ok === 'OK') {
      return {
        token,
        release: async () => {
          if ((await redis.get(SWEEP_LOCK_KEY)) === token) await redis.del(SWEEP_LOCK_KEY);
        },
      };
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
  throw new Error(
    `never acquired ${SWEEP_LOCK_KEY} in ${MAX_ATTEMPTS} attempts — ` +
      'the lease looks stuck, not merely contended',
  );
}

/**
 * True when OUR lease is gone: the key is absent, or has been re-acquired by
 * someone else. Asserting absence would be wrong — a parallel worker owning
 * the key is correct behaviour, not a leak.
 *
 * The production guarantee is "a worker never releases another worker's lease",
 * and this is the observable half of it.
 */
export async function ourLeaseReleased(redis: Redis, token: string): Promise<boolean> {
  return (await redis.get(SWEEP_LOCK_KEY)) !== token;
}
