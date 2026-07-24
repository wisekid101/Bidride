import { ComplianceContext, ComplianceRequirement, RequirementResult } from '../compliance.types';

// Blocking (Phase 3B): a driver must have accepted the CURRENT Zero Tolerance
// policy version. PURE — reads only the context; the current policy version is
// resolved by the caller (a DB read) and injected into the context, so this
// module performs no I/O and needs no service injection.
//
// Behavior:
//   no active policy (currentZeroTolerancePolicyVersion == null) -> met (INERT)
//   acceptedVersion === currentVersion                           -> met
//   acceptedVersion !== currentVersion (incl. null accepted)     -> BLOCK
//                                                     key: zero_tolerance:not_accepted
//
// Grandfathered drivers have zeroToleranceAcceptedVersion set to the current
// version (via the grandfather backfill), so they pass with no special-casing.
export const ZeroToleranceRequirement: ComplianceRequirement = {
  metadata: {
    id: 'zero_tolerance',
    displayName: 'Zero Tolerance policy',
    description: 'The driver must have accepted the current Zero Tolerance policy version.',
    category: 'compliance',
    severity: 'blocking',
    scope: 'activation',
    // Version-based (a new policy version supersedes prior acceptance), not
    // date-based, so this is not modeled as time-expiration.
    supportsExpiration: false,
    supportsJurisdiction: false,
    // Static metadata cannot hold the dynamic current version. Callers that need
    // the live version resolve it outside the engine (getActiveZeroTolerancePolicyVersion).
    policyVersion: null,
    onboardingStep: 'zero_tolerance',
  },
  appliesTo: () => true,
  evaluate(ctx: ComplianceContext): RequirementResult {
    const current = ctx.currentZeroTolerancePolicyVersion;
    // No active policy published → the gate is inert (nothing to accept).
    if (current == null) {
      return { metadata: this.metadata, status: 'not_applicable', keys: [] };
    }
    const accepted = ctx.zeroToleranceAcceptedVersion === current;
    return {
      metadata: this.metadata,
      status: accepted ? 'met' : 'missing',
      keys: accepted ? [] : ['zero_tolerance:not_accepted'],
    };
  },
};
