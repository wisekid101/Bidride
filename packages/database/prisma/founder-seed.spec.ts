import { resolveFounderSeed } from './founder-seed';

// These tests are the guardrail the security fix demands: no default
// credential, no weak credential, no silent reset of an existing founder
// password — ever.

describe('founder seeding policy', () => {
  it('SKIPS founder creation when FOUNDER_SEED_PASSWORD is absent (fail safe, no default credential)', () => {
    const decision = resolveFounderSeed({}, false);
    expect(decision.action).toBe('skip');
    expect((decision as { reason: string }).reason).toContain('FOUNDER_SEED_PASSWORD');
  });

  it('skips on empty or whitespace-only values', () => {
    expect(resolveFounderSeed({ FOUNDER_SEED_PASSWORD: '' }, false).action).toBe('skip');
    expect(resolveFounderSeed({ FOUNDER_SEED_PASSWORD: '   ' }, false).action).toBe('skip');
  });

  it('refuses weak seed passwords (< 16 chars)', () => {
    expect(resolveFounderSeed({ FOUNDER_SEED_PASSWORD: 'short-pass' }, false).action).toBe('skip');
  });

  it('refuses the retired known default outright', () => {
    const decision = resolveFounderSeed({ FOUNDER_SEED_PASSWORD: 'CHANGE_ME_IMMEDIATELY' }, false);
    expect(decision.action).toBe('skip');
  });

  it('creates the founder only with a strong explicit secret', () => {
    const decision = resolveFounderSeed({ FOUNDER_SEED_PASSWORD: 'a-strong-dev-only-secret-123' }, false);
    expect(decision).toEqual({ action: 'create', password: 'a-strong-dev-only-secret-123' });
  });

  it('NEVER resets an existing founder password on rerun — even with the env var set', () => {
    const decision = resolveFounderSeed({ FOUNDER_SEED_PASSWORD: 'a-strong-dev-only-secret-123' }, true);
    expect(decision.action).toBe('preserve_existing');
  });

  it('never exposes the password in skip/preserve decisions', () => {
    const skip = resolveFounderSeed({ FOUNDER_SEED_PASSWORD: 'short' }, false);
    const preserve = resolveFounderSeed({ FOUNDER_SEED_PASSWORD: 'a-strong-dev-only-secret-123' }, true);
    expect(JSON.stringify(skip)).not.toContain('short');
    expect(JSON.stringify(preserve)).not.toContain('a-strong-dev-only-secret-123');
  });
});
