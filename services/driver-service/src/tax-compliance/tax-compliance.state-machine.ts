// SB2A Phase 4A — Tax Compliance state machine (pure functions only).
//
// Encodes the allowed transitions of the NormalizedTaxStatus lifecycle and the
// actor authority rules. This is NOT wired into any workflow in Phase 4A; it is
// the validated contract a future persistence layer (Phase 4B) will enforce.

import { NormalizedTaxStatus } from './normalized-tax-status';

export enum TaxComplianceActor {
  DRIVER = 'driver',
  HOSTED_PROVIDER = 'hosted_provider',
  PROVIDER_WEBHOOK = 'provider_webhook',
  RECONCILIATION = 'reconciliation',
  ADMINISTRATOR = 'administrator',
  SYSTEM = 'system',
}

// The ONLY actors permitted to move the record into a provider-authoritative
// state (verified / rejected / needs_update / provider_confirmed_exempt). A
// driver, client, or administrator can NEVER establish verification.
export const PROVIDER_AUTHORITATIVE_ACTORS: readonly TaxComplianceActor[] = [
  TaxComplianceActor.PROVIDER_WEBHOOK,
  TaxComplianceActor.RECONCILIATION,
] as const;

interface TransitionRule {
  from: NormalizedTaxStatus;
  to: NormalizedTaxStatus;
  actors: readonly TaxComplianceActor[];
}

const S = NormalizedTaxStatus;
const A = TaxComplianceActor;

// The complete allowed-transition set. Any (from,to,actor) not listed is
// forbidden. Same-state (from===to) is intentionally NOT a transition —
// idempotent provider replays are deduped upstream by providerEventId.
export const ALLOWED_TRANSITIONS: readonly TransitionRule[] = [
  { from: S.NOT_STARTED, to: S.SESSION_CREATED, actors: [A.DRIVER, A.SYSTEM] },
  { from: S.SESSION_CREATED, to: S.PENDING_PROVIDER, actors: [A.SYSTEM, A.HOSTED_PROVIDER, A.PROVIDER_WEBHOOK] },

  // Provider-authoritative outcomes from pending.
  { from: S.PENDING_PROVIDER, to: S.VERIFIED, actors: PROVIDER_AUTHORITATIVE_ACTORS },
  { from: S.PENDING_PROVIDER, to: S.REJECTED, actors: PROVIDER_AUTHORITATIVE_ACTORS },
  { from: S.PENDING_PROVIDER, to: S.NEEDS_UPDATE, actors: PROVIDER_AUTHORITATIVE_ACTORS },
  { from: S.PENDING_PROVIDER, to: S.PROVIDER_CONFIRMED_EXEMPT, actors: PROVIDER_AUTHORITATIVE_ACTORS },

  // Post-verification invalidation (B-notice / TIN mismatch) — provider only.
  { from: S.VERIFIED, to: S.NEEDS_UPDATE, actors: PROVIDER_AUTHORITATIVE_ACTORS },
  { from: S.PROVIDER_CONFIRMED_EXEMPT, to: S.NEEDS_UPDATE, actors: PROVIDER_AUTHORITATIVE_ACTORS },

  // Controlled re-request on a required-version/form change (never a passing state).
  { from: S.VERIFIED, to: S.SUPERSEDED, actors: [A.SYSTEM, A.ADMINISTRATOR] },
  { from: S.PROVIDER_CONFIRMED_EXEMPT, to: S.SUPERSEDED, actors: [A.SYSTEM, A.ADMINISTRATOR] },

  // Driver-driven retries / resubmissions (never reach a passing state directly).
  { from: S.NEEDS_UPDATE, to: S.SESSION_CREATED, actors: [A.DRIVER] },
  { from: S.NEEDS_UPDATE, to: S.PENDING_PROVIDER, actors: [A.HOSTED_PROVIDER, A.PROVIDER_WEBHOOK] },
  { from: S.REJECTED, to: S.SESSION_CREATED, actors: [A.DRIVER] },
  { from: S.REJECTED, to: S.PENDING_PROVIDER, actors: [A.HOSTED_PROVIDER, A.PROVIDER_WEBHOOK] },
  { from: S.SUPERSEDED, to: S.SESSION_CREATED, actors: [A.DRIVER] },
  { from: S.SUPERSEDED, to: S.PENDING_PROVIDER, actors: [A.HOSTED_PROVIDER, A.PROVIDER_WEBHOOK] },

  // Provider connectivity: disconnect/outage and recovery.
  { from: S.PENDING_PROVIDER, to: S.UNAVAILABLE, actors: [A.RECONCILIATION, A.SYSTEM] },
  { from: S.VERIFIED, to: S.UNAVAILABLE, actors: [A.RECONCILIATION, A.SYSTEM] },
  { from: S.UNAVAILABLE, to: S.PENDING_PROVIDER, actors: [A.RECONCILIATION] },
] as const;

export function isNoOpTransition(from: NormalizedTaxStatus, to: NormalizedTaxStatus): boolean {
  return from === to;
}

// Is (from -> to) permitted for `actor`? Same-state returns false (a no-op is not
// a transition; handle idempotency before calling this).
export function canTransition(
  from: NormalizedTaxStatus,
  to: NormalizedTaxStatus,
  actor: TaxComplianceActor,
): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS.some(
    (r) => r.from === from && r.to === to && r.actors.includes(actor),
  );
}

export class ForbiddenTaxTransitionError extends Error {
  constructor(
    public readonly from: NormalizedTaxStatus,
    public readonly to: NormalizedTaxStatus,
    public readonly actor: TaxComplianceActor,
  ) {
    super(`Forbidden tax-compliance transition: ${from} -> ${to} by ${actor}`);
    this.name = 'ForbiddenTaxTransitionError';
  }
}

export function assertTransition(
  from: NormalizedTaxStatus,
  to: NormalizedTaxStatus,
  actor: TaxComplianceActor,
): void {
  if (!canTransition(from, to, actor)) {
    throw new ForbiddenTaxTransitionError(from, to, actor);
  }
}
