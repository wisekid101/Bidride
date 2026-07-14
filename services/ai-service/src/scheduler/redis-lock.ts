import Redis from 'ioredis';

// ─── Redis leader lock (Phase 3.2, Build Step 3) ─────────────────────────────
// One runner per job across replicas: SET ai:scheduler:lock:<job> <id> NX PX.
// A failed acquire means "someone else runs it" — skip. A Redis FAILURE also
// means skip (never run without the lock: skipping is safe, duplicating is
// not). Locks are NOT released early on job completion — the TTL is the
// re-run guard for the whole scheduling window.

export interface LockResult {
  acquired: boolean;
  reason: 'acquired' | 'held_elsewhere' | 'redis_unavailable';
}

export async function acquireJobLock(
  redis: Redis | undefined,
  job: string,
  instanceId: string,
  ttlMs: number,
): Promise<LockResult> {
  if (!redis) return { acquired: false, reason: 'redis_unavailable' };
  try {
    const res = await redis.set(`ai:scheduler:lock:${job}`, instanceId, 'PX', ttlMs, 'NX');
    return res === 'OK' ? { acquired: true, reason: 'acquired' } : { acquired: false, reason: 'held_elsewhere' };
  } catch {
    return { acquired: false, reason: 'redis_unavailable' };
  }
}
