import type Redis from 'ioredis';

/**
 * Leader lock for the capture-recovery worker.
 *
 * Mirrors ai-service/src/scheduler/redis-lock.ts rather than inventing a second
 * pattern. The rule that matters: when Redis is unavailable we SKIP rather than
 * run unlocked. A tick that does not happen costs a minute of latency; two
 * workers draining the same worklist costs correctness.
 */
export type LockReason = 'acquired' | 'held_elsewhere' | 'redis_unavailable';

export interface LockResult {
  acquired: boolean;
  reason: LockReason;
}

export const RECOVERY_LOCK_KEY = 'payment:capture-recovery:lock';

export async function acquireRecoveryLock(
  redis: Redis | undefined,
  instanceId: string,
  ttlMs: number,
): Promise<LockResult> {
  if (!redis) return { acquired: false, reason: 'redis_unavailable' };
  try {
    const res = await redis.set(RECOVERY_LOCK_KEY, instanceId, 'PX', ttlMs, 'NX');
    return res === 'OK'
      ? { acquired: true, reason: 'acquired' }
      : { acquired: false, reason: 'held_elsewhere' };
  } catch {
    return { acquired: false, reason: 'redis_unavailable' };
  }
}

/** Release only if we still hold it — an expired-and-reclaimed lock is not ours. */
const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export async function releaseRecoveryLock(
  redis: Redis | undefined,
  instanceId: string,
): Promise<void> {
  if (!redis) return;
  try {
    await redis.eval(RELEASE_LUA, 1, RECOVERY_LOCK_KEY, instanceId);
  } catch {
    /* the TTL reclaims it — a failed release is safe */
  }
}
