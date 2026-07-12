// ─── Universal Recommendation Contract (Intelligence Layer, Phase 3.1) ───────
// EVERY AI domain speaks this format. Recommendations are ADVISORY ONLY:
// adopting one records a human decision — it never executes anything.
// See design/ai-intelligence-layer.md §5 and design/ai-governance-rules.md.

export const RECOMMENDATION_STATUSES = [
  'proposed',
  'viewed',
  'adopted',
  'dismissed',
  'expired',
  'outcome_pending',
  'outcome_scored',
] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

// Legal lifecycle transitions. Anything not listed is rejected.
// dismissed → outcome_scored is allowed so "the dismissal was wrong" is
// recordable — dismissals are a Founder-supervision learning signal.
export const STATUS_TRANSITIONS: Record<RecommendationStatus, RecommendationStatus[]> = {
  proposed: ['viewed', 'adopted', 'dismissed', 'expired'],
  viewed: ['adopted', 'dismissed', 'expired'],
  adopted: ['outcome_pending', 'outcome_scored'],
  dismissed: ['outcome_scored'],
  expired: [],
  outcome_pending: ['outcome_scored'],
  outcome_scored: [],
};

export const CONSTITUTION_TAGS = [
  'move_people',
  'move_goods',
  'move_money',
  'help_businesses',
  'create_trust',
  'meaningful_ai',
] as const;
export type ConstitutionTag = (typeof CONSTITUTION_TAGS)[number];

// The only stores a financial recommendation may cite as its money source.
export const CANONICAL_FINANCIAL_SOURCES = [
  'trips.finalFare',
  'trips.driverEarnings',
  'trips.platformFee',
  'trips.earningsSupplement',
  'payments',
  'refunds',
  'financial_ledger',
  'earnings_floor_logs',
] as const;

export const INSUFFICIENT_EVIDENCE = 'insufficient_evidence' as const;

// Below this sample size a recommendation MUST declare insufficient evidence.
export const MIN_SAMPLE_SIZE = 5;

export interface EvidenceItem {
  /** Authoritative store or feature the value came from, e.g. "trips.finalFare (canonical, Trusted-only)" */
  source: string;
  metric: string;
  value: string | number | boolean | null;
  /** Observation window, e.g. "2026-07-04..2026-07-11" */
  window?: string;
  sampleSize?: number;
  asOf: string;
}

export interface AlternativeOption {
  action: string;
  expectedValue?: string;
  tradeoff: string;
}

export interface RecommendationAction {
  action: string;
  value?: number | string;
  unit?: string;
  detail?: string;
}

export interface ExpectedValue {
  metric: string;
  delta: string;
  horizon: string;
}

export interface UniversalRecommendation {
  id?: string;
  domain: string;
  family: string;
  recommendationType: string;
  title: string;
  summary: string;
  recommendation: RecommendationAction;
  /** 0..1 */
  confidence: number;
  sampleSize: number;
  evidence: EvidenceItem[];
  reasoning: string[];
  expectedOutcome: string;
  expectedValue: ExpectedValue | typeof INSUFFICIENT_EVIDENCE;
  alternatives: AlternativeOption[];
  why: string;
  whyNot: string;
  rollback: string;
  businessImpact: string;
  userImpact: string;
  /** must be declared; anything other than "none…" is rejected — safety is not an AI surface */
  safetyImpact: string;
  revenueImpact: string;
  trustImpact: string;
  constitutionTags: ConstitutionTag[];
  sourceVersion: string;
  modelVersion?: string;
  rulesVersion?: string;
  featureVersion?: string;
  /** REQUIRED for financial recommendations — one of CANONICAL_FINANCIAL_SOURCES */
  canonicalFinancialSource?: string;
  /** references to canonical rows (ids, zone keys) — never copies of money state */
  canonicalRefs?: Record<string, unknown>;
  insufficientEvidence?: boolean;
  createdAt?: string;
  expiresAt?: string;
  status?: RecommendationStatus;
}

// Evidence sources referencing these columns make a recommendation
// money-centric regardless of how the producer self-classified it.
const MONEY_SOURCE_PATTERN = /finalFare|driverEarnings|platformFee|earningsSupplement|financial_ledger|payments|refunds|earnings_floor/i;

/**
 * A recommendation counts as financial if it touches money in any declared
 * way — including via its evidence sources, so producers cannot skip the
 * canonical-source requirement by omitting the move_money tag.
 */
export function isFinancialRecommendation(rec: UniversalRecommendation): boolean {
  return (
    rec.constitutionTags.includes('move_money') ||
    rec.recommendationType === 'financial' ||
    rec.domain === 'pricing' ||
    rec.domain === 'financial' ||
    (rec.evidence ?? []).some((e) => MONEY_SOURCE_PATTERN.test(e?.source ?? ''))
  );
}
