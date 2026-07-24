import { NormalizedTaxStatus as S } from './normalized-tax-status';
import {
  TaxComplianceActor as A,
  ALLOWED_TRANSITIONS,
  PROVIDER_AUTHORITATIVE_ACTORS,
  canTransition,
  assertTransition,
  isNoOpTransition,
  ForbiddenTaxTransitionError,
} from './tax-compliance.state-machine';

describe('Tax compliance state machine — allowed transitions', () => {
  it('driver can start a session; system can too', () => {
    expect(canTransition(S.NOT_STARTED, S.SESSION_CREATED, A.DRIVER)).toBe(true);
    expect(canTransition(S.NOT_STARTED, S.SESSION_CREATED, A.SYSTEM)).toBe(true);
  });

  it('provider webhook and reconciliation can verify from pending', () => {
    expect(canTransition(S.PENDING_PROVIDER, S.VERIFIED, A.PROVIDER_WEBHOOK)).toBe(true);
    expect(canTransition(S.PENDING_PROVIDER, S.VERIFIED, A.RECONCILIATION)).toBe(true);
  });

  it('a driver can retry from rejected/needs_update/superseded', () => {
    expect(canTransition(S.REJECTED, S.SESSION_CREATED, A.DRIVER)).toBe(true);
    expect(canTransition(S.NEEDS_UPDATE, S.SESSION_CREATED, A.DRIVER)).toBe(true);
    expect(canTransition(S.SUPERSEDED, S.SESSION_CREATED, A.DRIVER)).toBe(true);
  });

  it('system/admin can supersede on a version change (a re-request, not a pass)', () => {
    expect(canTransition(S.VERIFIED, S.SUPERSEDED, A.SYSTEM)).toBe(true);
    expect(canTransition(S.VERIFIED, S.SUPERSEDED, A.ADMINISTRATOR)).toBe(true);
  });

  it('provider disconnect → unavailable → recovery', () => {
    expect(canTransition(S.VERIFIED, S.UNAVAILABLE, A.RECONCILIATION)).toBe(true);
    expect(canTransition(S.UNAVAILABLE, S.PENDING_PROVIDER, A.RECONCILIATION)).toBe(true);
  });
});

describe('Tax compliance state machine — forbidden transitions', () => {
  it('verified cannot regress into a session (any actor)', () => {
    for (const actor of Object.values(A)) {
      expect(canTransition(S.VERIFIED, S.SESSION_CREATED, actor)).toBe(false);
    }
  });

  it('an administrator can NEVER verify (rejected → verified by admin is forbidden)', () => {
    expect(canTransition(S.REJECTED, S.VERIFIED, A.ADMINISTRATOR)).toBe(false);
    expect(canTransition(S.PENDING_PROVIDER, S.VERIFIED, A.ADMINISTRATOR)).toBe(false);
  });

  it('a driver/client can NEVER verify (needs_update → verified by driver is forbidden)', () => {
    expect(canTransition(S.NEEDS_UPDATE, S.VERIFIED, A.DRIVER)).toBe(false);
    expect(canTransition(S.PENDING_PROVIDER, S.VERIFIED, A.DRIVER)).toBe(false);
    expect(canTransition(S.PENDING_PROVIDER, S.VERIFIED, A.HOSTED_PROVIDER)).toBe(false);
  });

  it('cannot skip the flow (not_started → verified)', () => {
    for (const actor of Object.values(A)) {
      expect(canTransition(S.NOT_STARTED, S.VERIFIED, actor)).toBe(false);
    }
  });

  it('exemption cannot be set by admin or driver', () => {
    expect(canTransition(S.PENDING_PROVIDER, S.PROVIDER_CONFIRMED_EXEMPT, A.ADMINISTRATOR)).toBe(false);
    expect(canTransition(S.PENDING_PROVIDER, S.PROVIDER_CONFIRMED_EXEMPT, A.DRIVER)).toBe(false);
    expect(canTransition(S.PENDING_PROVIDER, S.PROVIDER_CONFIRMED_EXEMPT, A.PROVIDER_WEBHOOK)).toBe(true);
  });

  it('same-state is a no-op, not a transition', () => {
    expect(isNoOpTransition(S.VERIFIED, S.VERIFIED)).toBe(true);
    expect(canTransition(S.VERIFIED, S.VERIFIED, A.PROVIDER_WEBHOOK)).toBe(false);
  });

  it('assertTransition throws ForbiddenTaxTransitionError on an illegal move', () => {
    expect(() => assertTransition(S.REJECTED, S.VERIFIED, A.ADMINISTRATOR)).toThrow(
      ForbiddenTaxTransitionError,
    );
    expect(() => assertTransition(S.NOT_STARTED, S.SESSION_CREATED, A.DRIVER)).not.toThrow();
  });
});

describe('Tax compliance state machine — passing-state authority invariant', () => {
  it('ONLY provider-authoritative actors can reach a passing state', () => {
    const passing = new Set([S.VERIFIED, S.PROVIDER_CONFIRMED_EXEMPT]);
    for (const rule of ALLOWED_TRANSITIONS) {
      if (passing.has(rule.to)) {
        for (const actor of rule.actors) {
          expect(PROVIDER_AUTHORITATIVE_ACTORS).toContain(actor);
        }
      }
    }
  });

  it('no allowed transition lets a driver or administrator reach verified/exempt', () => {
    const passing = [S.VERIFIED, S.PROVIDER_CONFIRMED_EXEMPT];
    for (const to of passing) {
      for (const from of Object.values(S)) {
        expect(canTransition(from, to, A.DRIVER)).toBe(false);
        expect(canTransition(from, to, A.ADMINISTRATOR)).toBe(false);
        expect(canTransition(from, to, A.HOSTED_PROVIDER)).toBe(false);
      }
    }
  });
});
