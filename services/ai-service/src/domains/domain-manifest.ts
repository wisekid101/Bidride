import { ConstitutionTag } from '../recommendations/recommendation.types';

// ─── AI Domain Registry (Intelligence Layer, Phase 3.1) ──────────────────────
// A domain is a bounded intelligence context. NO domain may exist without a
// manifest, and registering a new domain is a Founder-approval-only code
// change (decision authority matrix, ai-governance-rules.md v1.1).
// Manifests are code, not data: they are reviewed, versioned, and type-checked.

export type RolloutStatus = 'active' | 'reserved';
export type DecisionAuthority = 'advisory_only';

export interface DomainManifest {
  domain: string;
  displayName: string;
  owner: string;
  purpose: string;
  /** model/recommendation families this domain may write to the ledger */
  families: string[];
  allowedFeatureFamilies: string[];
  prohibitedFeatureFamilies: string[];
  /** attribute-level allowlist — mirrors the pricing allowlist pattern */
  featureAllowlist: string[];
  dataSources: string[];
  retentionClass: 'training_1y' | 'audit_permanent' | 'ephemeral_ttl';
  killSwitchKey: string;
  shadowRequired: boolean;
  allowedConsumers: string[];
  constitutionTags: ConstitutionTag[];
  /** Phase 3.1: every domain is advisory-only — AI never decides */
  decisionAuthority: DecisionAuthority;
  rolloutStatus: RolloutStatus;
}

const COMMON_PROHIBITED = [
  'protected_characteristics_and_proxies (governance Rule 3)',
  'panic_or_sos_data (governance Rule 6)',
  'raw_gps_traces (zone keys are the finest location granularity)',
  'pii (names, phones, emails, exact addresses)',
  'support_ticket_body_text (v1 — categories/counts only)',
];

export const DOMAIN_REGISTRY: DomainManifest[] = [
  {
    domain: 'pricing',
    displayName: 'Pricing Intelligence',
    owner: 'pricing',
    purpose: 'Bounded, explainable fare-adjustment and surge advisories; win-probability calibration.',
    families: ['fare-adjustment', 'surge-advisory', 'win-probability-calibration'],
    allowedFeatureFamilies: ['zone_demand', 'zone_supply', 'trip_geometry', 'time_of_day', 'loyalty_trip_count'],
    prohibitedFeatureFamilies: [...COMMON_PROHIBITED, 'trust_scores (governance Rule 3a — prohibited pricing features)'],
    featureAllowlist: [
      'distanceMiles', 'durationMin', 'surgeZoneScore', 'surgeMultiplier', 'isAirport', 'isAirportTrip',
      'isNight', 'hourOfDay', 'dayOfWeek', 'riderTotalTrips', 'pickupZone', 'dropoffZone', 'vehicleClass',
    ],
    dataSources: ['ai_pricing_logs', 'trips.finalFare (canonical)', 'bid_outcomes', 'surge:* (Redis)'],
    retentionClass: 'training_1y',
    killSwitchKey: 'ai_fare_enabled',
    shadowRequired: true,
    allowedConsumers: ['pricing-service', 'founder-intelligence'],
    constitutionTags: ['move_people', 'create_trust'],
    decisionAuthority: 'advisory_only',
    rolloutStatus: 'active',
  },
  {
    domain: 'marketplace',
    displayName: 'Marketplace Intelligence',
    owner: 'marketplace',
    purpose: 'Demand/supply forecasting, dispatch ranking, and wait-time signals over zone-hour features.',
    families: ['demand-forecast', 'supply-forecast', 'dispatch-ranking', 'wait-time'],
    allowedFeatureFamilies: ['zone_demand', 'zone_supply', 'driver_utilization', 'acceptance_rates', 'time_of_day'],
    prohibitedFeatureFamilies: COMMON_PROHIBITED,
    featureAllowlist: ['zoneKey', 'hourOfDay', 'dayOfWeek', 'demand', 'supply', 'acceptanceRate', 'cancellationRate', 'driverUtilization', 'distanceMiles', 'etaMinutes'],
    dataSources: ['trips', 'bid_outcomes', 'driver_session_logs', 'surge:* (Redis)', 'ai:feature:* (Redis)'],
    retentionClass: 'training_1y',
    killSwitchKey: 'ai_ranking_enabled',
    shadowRequired: true,
    allowedConsumers: ['trip-service', 'founder-intelligence', 'admin-portal'],
    constitutionTags: ['move_people'],
    decisionAuthority: 'advisory_only',
    rolloutStatus: 'active',
  },
  {
    domain: 'driver_success',
    displayName: 'Driver Success Intelligence',
    owner: 'driver',
    purpose: 'Earnings forecasts, utilization and repositioning advisories for drivers (advisory cards only).',
    families: ['earnings-forecast', 'repositioning', 'utilization-advice'],
    allowedFeatureFamilies: ['zone_earnings', 'zone_demand', 'session_patterns', 'time_of_day'],
    prohibitedFeatureFamilies: COMMON_PROHIBITED,
    featureAllowlist: ['zoneKey', 'hourOfDay', 'dayOfWeek', 'avgEarnings', 'demand', 'supply', 'utilization'],
    dataSources: ['trips.driverEarnings (canonical, Trusted-only)', 'driver_session_logs', 'earnings_floor_logs'],
    retentionClass: 'training_1y',
    killSwitchKey: 'ai_driver_success_enabled',
    shadowRequired: true,
    allowedConsumers: ['driver-service', 'founder-intelligence'],
    constitutionTags: ['move_people', 'create_trust'],
    decisionAuthority: 'advisory_only',
    rolloutStatus: 'active',
  },
  {
    domain: 'rider_experience',
    displayName: 'Rider Experience Intelligence',
    owner: 'rider',
    purpose: 'Cancellation prediction, offer guidance, and honest wait expectations (advisory copy only).',
    families: ['cancellation-prediction', 'offer-guidance', 'wait-expectations'],
    allowedFeatureFamilies: ['zone_wait', 'offer_outcomes', 'cancellation_patterns', 'time_of_day'],
    prohibitedFeatureFamilies: [...COMMON_PROHIBITED, 'trust_score_personalization', 'sensitive_trait_inference'],
    featureAllowlist: ['zoneKey', 'hourOfDay', 'dayOfWeek', 'offerRatio', 'acceptanceRate', 'waitPercentiles', 'cancellationRate'],
    dataSources: ['trips', 'bids', 'bid_outcomes', 'trip_events'],
    retentionClass: 'training_1y',
    killSwitchKey: 'ai_rider_experience_enabled',
    shadowRequired: true,
    allowedConsumers: ['rider-service', 'founder-intelligence'],
    constitutionTags: ['move_people', 'create_trust'],
    decisionAuthority: 'advisory_only',
    rolloutStatus: 'active',
  },
  {
    domain: 'integrity',
    displayName: 'Integrity Intelligence',
    owner: 'trust',
    purpose: 'Fraud probability and anomaly detection. Auto-hold ≥90% is the ONLY automated action (existing rule); bans are human-only. Safety flows are out of scope entirely.',
    families: ['fraud-score', 'anomaly-detection'],
    allowedFeatureFamilies: ['velocity_signals', 'device_link_counts', 'dispute_counts', 'account_age'],
    prohibitedFeatureFamilies: [...COMMON_PROHIBITED, 'safety_events_of_any_kind'],
    featureAllowlist: ['linkedAccounts', 'deviceFingerprints', 'fraudFlagCount', 'disputeCount', 'accountAgeDays', 'totalTrips', 'ruleScore'],
    dataSources: ['fraud_alerts', 'device_fingerprints (counts only)', 'multi_account_links (counts only)', 'payments (status only)'],
    retentionClass: 'training_1y',
    killSwitchKey: 'ai_integrity_enabled',
    shadowRequired: true,
    allowedConsumers: ['trust-service', 'founder-intelligence'],
    constitutionTags: ['create_trust'],
    decisionAuthority: 'advisory_only',
    rolloutStatus: 'active',
  },
  {
    domain: 'founder',
    displayName: 'Founder Intelligence',
    owner: 'founder',
    purpose: 'Evidence-based executive briefs and standing recommendations. Reads everything permitted, controls nothing.',
    families: ['founder-brief', 'focus-recommendation'],
    allowedFeatureFamilies: ['all_aggregates', 'zone_rollups', 'ai_performance_metrics', 'ticket_categories'],
    prohibitedFeatureFamilies: [...COMMON_PROHIBITED, 'individual_user_rows (aggregates and opaque cohorts only)'],
    featureAllowlist: ['aggregates_only — no individual-level features'],
    dataSources: [
      'trips (canonical money)', 'payments', 'refunds', 'earnings_floor_logs', 'bid_outcomes',
      'ai_inference_logs', 'ai_pricing_logs', 'ai_recommendations', 'trip_events(data_quality_classified)',
      'support_tickets (categories/counts only)', 'surge:* (Redis)',
    ],
    retentionClass: 'audit_permanent',
    killSwitchKey: 'ai_founder_intelligence_enabled',
    shadowRequired: false, // read-only briefs control nothing; governance v1.1 §activation
    allowedConsumers: ['admin-service (founder role)'],
    constitutionTags: ['meaningful_ai', 'create_trust'],
    decisionAuthority: 'advisory_only',
    rolloutStatus: 'active',
  },
  {
    domain: 'opportunity',
    displayName: 'Opportunity Intelligence',
    owner: 'founder',
    purpose: 'Measurable marketplace opportunities (zone-level, aggregate). Founder-facing only in Phase 3.1 — no rider/driver personalization.',
    families: ['zone-opportunity'],
    allowedFeatureFamilies: ['zone_demand_growth', 'zone_supply_gaps', 'zone_completion', 'zone_offer_acceptance', 'zone_earnings'],
    prohibitedFeatureFamilies: [...COMMON_PROHIBITED, 'individual_targeting (no personalization in this milestone)'],
    featureAllowlist: ['zoneKey', 'window', 'tripCounts', 'growthRatio', 'completionRate', 'cancellationRate', 'offerAcceptance', 'avgDriverEarnings', 'supplyCount'],
    dataSources: ['trips', 'bids', 'bid_outcomes', 'driver_session_logs', 'surge:* (Redis)'],
    retentionClass: 'training_1y',
    killSwitchKey: 'ai_opportunity_enabled',
    shadowRequired: false, // standing advisory recommendations to the Founder only
    allowedConsumers: ['admin-service (founder role)', 'founder-intelligence'],
    constitutionTags: ['move_people', 'help_businesses', 'meaningful_ai'],
    decisionAuthority: 'advisory_only',
    rolloutStatus: 'active',
  },
  // ── Reserved namespaces — no code until the product exists ────────────────
  ...(['delivery', 'merchant', 'community', 'financial', 'creator'] as const).map((d): DomainManifest => ({
    domain: d,
    displayName: `${d[0].toUpperCase()}${d.slice(1)} Intelligence`,
    owner: 'unassigned',
    purpose: `Reserved namespace — activates only when the ${d} product exists, with Founder approval.`,
    families: [],
    allowedFeatureFamilies: [],
    prohibitedFeatureFamilies: COMMON_PROHIBITED,
    featureAllowlist: [],
    dataSources: [],
    retentionClass: 'training_1y',
    killSwitchKey: `ai_${d}_enabled`,
    shadowRequired: true,
    allowedConsumers: [],
    constitutionTags: ['meaningful_ai'],
    decisionAuthority: 'advisory_only',
    rolloutStatus: 'reserved',
  })),
];

export function getDomain(name: string): DomainManifest | undefined {
  return DOMAIN_REGISTRY.find((d) => d.domain === name);
}

export function listDomains(status?: RolloutStatus): DomainManifest[] {
  return status ? DOMAIN_REGISTRY.filter((d) => d.rolloutStatus === status) : DOMAIN_REGISTRY;
}

/** Only active, manifested domains may write recommendations to the ledger. */
export function assertDomainActive(name: string): DomainManifest {
  const manifest = getDomain(name);
  if (!manifest) throw new Error(`Unknown AI domain "${name}" — no manifest registered`);
  if (manifest.rolloutStatus !== 'active') throw new Error(`AI domain "${name}" is reserved — not active`);
  return manifest;
}
