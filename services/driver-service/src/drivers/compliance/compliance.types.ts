// SB2A Batch 3A — Compliance Requirements Engine (behavior-preserving foundation).
//
// This is the permanent foundation for all future compliance evaluation
// (activation, onboarding, admin dashboard, reporting, analytics). Phase 3A
// introduces the engine and models the EXISTING activation gates as modules
// WITHOUT changing behavior. Requirement modules are PURE: no I/O, no writes,
// no side effects — they are functions of an immutable ComplianceContext.

import { BackgroundCheckStatus } from '@bidride/database';

export type RequirementStatus =
  | 'met'
  | 'missing'
  | 'pending'
  | 'expired'
  | 'not_applicable';

export type Severity = 'blocking' | 'informational';

// Stable grouping label for a requirement. METADATA ONLY — it never affects
// evaluation, activation, ordering, or the missing-key output. It exists so
// future systems (onboarding, admin dashboard, reporting, analytics) can group
// requirements consistently. The union is open-ended (extensible via edits) but
// the current set is fixed.
export type RequirementCategory =
  | 'identity'
  | 'vehicle'
  | 'documentation'
  | 'insurance'
  | 'background'
  | 'compliance'
  | 'tax'
  | 'training'
  | 'airport'
  | 'jurisdiction';

// What a requirement gates. Phase 3A uses only 'activation' (today's behavior);
// the wider set is reserved for future phases (payouts, airport, ride-types).
export type RequirementScope = 'activation' | 'payout' | 'airport' | string;

// Static, declarative metadata for a requirement. This is the intended single
// source of truth for future onboarding, activation, admin dashboard, and
// reporting — exposed now, consumed incrementally in later phases.
export interface RequirementMetadata {
  id: string;
  displayName: string;
  description: string;
  // Stable grouping label (metadata only — never affects evaluation).
  category: RequirementCategory;
  severity: Severity;
  scope: RequirementScope;
  supportsExpiration: boolean;
  supportsJurisdiction: boolean;
  // Non-null when a requirement is governed by a versioned policy (e.g. Zero
  // Tolerance / W-9 in later phases). Null for the current record-derived gates.
  policyVersion: string | null;
  // The onboarding step this requirement corresponds to, when applicable. Not
  // consumed for routing in Phase 3A (resolver unification is a future phase).
  onboardingStep: string | null;
}

// The immutable snapshot every requirement evaluates against. Built once (pure
// mapper) from an already-fetched driver record — no new queries in Phase 3A.
export interface ComplianceContext {
  // Personal info (informational in Phase 3A — not a current activation gate).
  legalFirstName: string | null;
  dateOfBirth: Date | null;
  licenseNumber: string | null;
  // Activation-gating facts (identical inputs to today's checks).
  documents: Array<{ documentType: string; status: string }>;
  vehicles: Array<{ isActive: boolean }>;
  backgroundCheckStatus: BackgroundCheckStatus;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  insuranceExpiry: Date | null;
  // Zero Tolerance (Phase 3B). The driver's latest accepted policy version
  // (denormalized) and the CURRENT active policy version — the latter resolved
  // OUTSIDE the engine (a DB read in the async caller) and injected here, so the
  // requirement module stays pure. Null current version = no policy published
  // (gate inert).
  zeroToleranceAcceptedVersion: string | null;
  currentZeroTolerancePolicyVersion: string | null;
  // Reserved for future jurisdiction-scoped requirements (unused in Phase 3A).
  jurisdiction?: string | null;
  // Evaluation clock — injectable for deterministic tests; defaults to now.
  now: Date;
}

export interface RequirementResult {
  metadata: RequirementMetadata;
  status: RequirementStatus;
  // The admin-checklist keys this requirement contributes to the flat `missing`
  // list when it is blocking and unmet. Empty when met or informational. A
  // single requirement may contribute several keys (e.g. Documents → one per
  // unmet required document), preserving today's exact output + order.
  keys: string[];
  expiresAt?: Date | null;
}

// A requirement module. `evaluate` MUST be pure.
export interface ComplianceRequirement {
  readonly metadata: RequirementMetadata;
  appliesTo(ctx: ComplianceContext): boolean;
  evaluate(ctx: ComplianceContext): RequirementResult;
}

// The aggregate outcome of an evaluation.
export interface ComplianceReport {
  all: RequirementResult[];
  blockingUnmet: RequirementResult[];
  warnings: RequirementResult[];
  // Flat, ordered admin-checklist keys — identical to the legacy
  // computeMissingRequirements() output.
  missing: string[];
  canActivate: boolean;
}
