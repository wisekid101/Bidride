// Canonical feature registry (AI Core Phase 2, Phase 6 — projections only).
// Every projected feature is documented here; the projection job and the
// GET /ai/features endpoint are driven by this table. Mirrors the feature
// documentation format in design/ai-core-architecture.md §4.
//
// Redis key convention: ai:feature:<name>[:<zone>]   TTL 180s
// Freshness SLA: every feature recomputed by the 60s projection job; a
// missing key means the value is stale/unavailable — consumers must treat
// absence as "no data", never as zero.

export interface FeatureSpec {
  name: string;
  owner: string;        // owning domain team
  definition: string;   // plain-language definition
  source: string;       // authoritative store(s) projected from
  validation: string;   // rule the projection enforces before writing
  freshnessSlaSec: number;
  usage: string;        // intended consumers
  zoned: boolean;       // true → one key per 2km zone
}

export const FEATURE_TTL_SEC = 180;
export const PROJECTION_INTERVAL_MS = 60_000;

export const FEATURE_REGISTRY: FeatureSpec[] = [
  {
    name: 'demand',
    owner: 'marketplace',
    definition: 'Ride requests per 2km zone in the rolling 10-minute surge window',
    source: 'Redis surge:requests:{zone} counters (written by trip-service on trip creation)',
    validation: 'non-negative integer; zones with no counter are omitted',
    freshnessSlaSec: FEATURE_TTL_SEC,
    usage: 'demand forecasting, pricing recommendations, founder dashboard',
    zoned: true,
  },
  {
    name: 'supply',
    owner: 'marketplace',
    definition: 'Online drivers per 2km zone (gateway-maintained surge:drivers sets)',
    source: 'Redis surge:drivers:{zone} sets (gateway zone heartbeat)',
    validation: 'non-negative integer set cardinality',
    freshnessSlaSec: FEATURE_TTL_SEC,
    usage: 'supply forecasting, matching recommendations, founder dashboard',
    zoned: true,
  },
  {
    name: 'acceptance_rate',
    owner: 'bidding',
    definition: 'Accepted bids / total resolved bid outcomes, trailing 7 days',
    source: 'bid_outcomes (wasAccepted), 7-day window',
    validation: '0..1; null when fewer than 5 outcomes in window',
    freshnessSlaSec: FEATURE_TTL_SEC,
    usage: 'win-probability calibration, marketplace health',
    zoned: false,
  },
  {
    name: 'cancellation_rate',
    owner: 'marketplace',
    definition: 'Cancelled trips / all terminal trips, trailing 7 days',
    source: 'trips (status cancelled|completed), 7-day window',
    validation: '0..1; null when fewer than 5 terminal trips in window',
    freshnessSlaSec: FEATURE_TTL_SEC,
    usage: 'cancellation prediction, marketplace health',
    zoned: false,
  },
  {
    name: 'driver_utilization',
    owner: 'dispatch',
    definition: 'Drivers currently on an in-progress trip / online drivers',
    source: 'trips (status in_progress) ÷ drivers (isAvailable=true)',
    validation: '0..1 clamped; null when no drivers online',
    freshnessSlaSec: FEATURE_TTL_SEC,
    usage: 'supply forecasting, repositioning recommendations',
    zoned: false,
  },
  {
    name: 'airport_demand',
    owner: 'airport',
    definition: 'Ride requests in the EWR zone in the rolling surge window',
    source: 'Redis surge:requests:{EWR zone} (zone of 40.6895,-74.1745)',
    validation: 'non-negative integer; 0 when counter absent',
    freshnessSlaSec: FEATURE_TTL_SEC,
    usage: 'airport traffic prediction, EWR queue guidance',
    zoned: false,
  },
  {
    name: 'customer_savings',
    owner: 'pricing',
    definition: 'Σ(aiFare − finalFare) over completed bid trips, trailing 7 days — QUALITY-GATED: Trusted trips only',
    source: 'trips joined to latest data_quality_classified trip_events',
    validation: 'only trips whose latest quality class is trusted; negative sum floors at 0',
    freshnessSlaSec: FEATURE_TTL_SEC,
    usage: 'customer savings dashboard (the "riders pay less" promise, honestly measured)',
    zoned: false,
  },
  {
    name: 'driver_earnings_avg',
    owner: 'earnings',
    definition: 'Average driverEarnings over completed trips, trailing 7 days — quality-gated: Trusted trips only',
    source: 'trips.driverEarnings joined to quality classifications',
    validation: 'positive; null when fewer than 5 trusted completed trips',
    freshnessSlaSec: FEATURE_TTL_SEC,
    usage: 'earnings forecasting, founder dashboard',
    zoned: false,
  },
  {
    name: 'average_fare',
    owner: 'pricing',
    definition: 'Average canonical finalFare over completed trips, trailing 7 days — quality-gated: Trusted trips only',
    source: 'trips.finalFare joined to quality classifications',
    validation: 'positive; null when fewer than 5 trusted completed trips',
    freshnessSlaSec: FEATURE_TTL_SEC,
    usage: 'pricing recommendations, marketplace health',
    zoned: false,
  },
];
