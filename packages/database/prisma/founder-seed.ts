// ─── Founder account seeding policy (security-hardened) ─────────────────────
// There is NO default founder password. Privileged-account seeding requires
// FOUNDER_SEED_PASSWORD in the environment; absent that, seeding SKIPS the
// founder account (fail safe) instead of creating a privileged login with a
// guessable credential. Reruns never overwrite an existing founder password.
// The password value must never be logged, printed, or written to any file.

export interface FounderSeedEnv {
  FOUNDER_SEED_PASSWORD?: string;
}

export type FounderSeedDecision =
  | { action: 'skip'; reason: string }
  | { action: 'create'; password: string }
  | { action: 'preserve_existing'; reason: string };

const MIN_SEED_PASSWORD_LENGTH = 16;

/**
 * Pure decision logic — testable without a database.
 * @param env       process environment (only FOUNDER_SEED_PASSWORD is read)
 * @param founderExists whether the founder admin row already exists
 */
export function resolveFounderSeed(env: FounderSeedEnv, founderExists: boolean): FounderSeedDecision {
  if (founderExists) {
    // NEVER reset an existing founder credential from a seed rerun —
    // regardless of what the environment contains.
    return { action: 'preserve_existing', reason: 'founder account exists; seed reruns never touch its password' };
  }
  const password = env.FOUNDER_SEED_PASSWORD;
  if (!password || password.trim().length === 0) {
    return { action: 'skip', reason: 'FOUNDER_SEED_PASSWORD is not set — refusing to create a privileged account with a default credential' };
  }
  if (password.trim().length < MIN_SEED_PASSWORD_LENGTH) {
    return { action: 'skip', reason: `FOUNDER_SEED_PASSWORD must be at least ${MIN_SEED_PASSWORD_LENGTH} characters — refusing weak privileged credential` };
  }
  if (password === 'CHANGE_ME_IMMEDIATELY') {
    return { action: 'skip', reason: 'FOUNDER_SEED_PASSWORD is set to the retired known default — refusing' };
  }
  return { action: 'create', password };
}
