# BidiRide — AI Core Foundation: Phase 1 Architecture v1.0

**Status:** Pending Founder Approval
**Author:** Engineering
**Date:** 2026-07-10
**Scope:** Implementation architecture for the first version of the BidiRide AI Core
**Companions:** `ai-core-data-readiness.md` (this phase) · `ai-architecture-diagram.md`, `ai-event-catalog.md`, `ai-feature-registry.md`, `ai-governance-rules.md`, `ai-model-registry.md`, `ai-versioning-strategy.md` (v1.0 suite, 2026-07-02)

> This document turns the approved-in-principle AI design suite into a buildable
> Phase 1 architecture. It reflects three platform changes that postdate the
> 2026-07-02 suite: the **canonical fare hotfix** (`e225720` — `trips.finalFare`
> is the single money truth), the **driver presence heartbeat** (`6954f44` —
> TTL-bounded location with AI-ready payload fields), and the
> **coordinate-first airport detection** (same commit). Where this document and
> the v1.0 suite disagree, this document wins and the suite gets a v1.1 revision
> before implementation.

---

## 1. Principles (Founder Directive — Non-Negotiable)

| # | Principle | Enforcement |
|---|---|---|
| P1 | **Recommend-first.** The AI Core never executes a business decision. It returns recommendations to platform services, which apply human-defined rules. | Hook contracts return advisory values; platform code owns every clamp, cap, and floor (§9). |
| P2 | **No black-box pricing.** Every fare-affecting output is bounded, logged with inputs, and explainable. | ±$2.00 adjustment clamp lives in `fare-engine.service.ts` (platform side); `ai_pricing_logs` stores features + adjustment + confidence per quote. |
| P3 | **Explainable.** Every recommendation carries `confidence`, `explanation` (one human sentence), and `factors[]` (top weighted inputs). | Response schema (§2.3) — enforced by contract tests. |
| P4 | **Observable.** Every inference is logged, timed, and joined to its eventual real-world outcome. | `ai_inference_logs` write is mandatory in the ai-service request path (§7); outcome joins via `bid_outcomes`. |
| P5 | **Secure & private.** Internal-only; no PII in features; anti-discrimination guardrails. | §8. |
| P6 | **Continuous learning, human-gated.** Models learn from marketplace data on a schedule; promotion to serving requires human approval. | Registry + shadow-mode workflow (§6); no auto-promotion. |
| P7 | **Human business rules outrank model output. Always.** | Supremacy table (§9) names the enforcement point for every rule. |

---

## 2. System Overview

### 2.1 Placement

A single **`services/ai-service`** (NestJS, **port 3012** — next free after
admin-service 3011).

> **CORRECTION (Phase 2, 2026-07-11):** this document originally described
> ai-service as "new". That was wrong — `services/ai-service` already existed
> in the repository before Phase 1 (Sprint 2C era: bid-prediction engines,
> inference controller with SageMaker registry, marketplace intelligence,
> internal-key guard). The Phase 1 investigation missed it because the
> CLAUDE.md service list stops at admin-service (3011). **AI Core Phase 2 is
> an EXTENSION of that existing service**, not a greenfield build: it adds
> the shadow-mode gate, the transparent fare engine, the data-quality
> classifier, and the feature-store projections to the modules already there.

The platform already calls three AI URLs with bounded fallbacks; the AI
Core's first job is to answer the phones that are already ringing:

| Existing hook | Caller | Contract today | Fallback today |
|---|---|---|---|
| `POST /ai/fare-adjustment` | pricing-service `fare-engine.service.ts` (`AI_SERVICE_URL`) | features → `{adjustment}` clamped ±$2.00 by caller | `adjustment: 0`, `fallback-v1`, 3s timeout |
| `POST /ai/rank-drivers` | trip-service `rankDriversWithFallback` | candidates + trip context → ordered scores | geo-distance order, 300ms hard timeout |
| `POST /ai/bid-win-probability` | trip-service `bids.service.fetchBidWinProbability` | bid context → `{probability, confidence}` | static 0.5 |

The timeout-and-fallback pattern is the platform's existing safety property:
**the marketplace runs correctly with the AI Core completely offline.** Phase 2
implementation must preserve this — the AI Core is always optional at runtime.

### 2.2 Architecture diagram

```
                        EXISTING PLATFORM (unchanged call sites)
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ pricing-svc  │   │ trip-svc     │   │ trip-svc     │   │ admin portal │
  │ fare engine  │   │ dispatch     │   │ bids         │   │ (Phase 6 UI) │
  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
         │ ±$2 clamp        │ 300ms TO         │ fallback .5      │ read-only
         │ 3s TO            │ geo fallback     │                  │
  ═══════╪══════════════════╪══════════════════╪══════════════════╪═══════════
         ▼                  ▼                  ▼                  ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                    ai-service  (NestJS · :3012 · internal-only)         │
  │                                                                         │
  │   RECOMMENDATION API          every response: { value, confidence,     │
  │   /ai/fare-adjustment           explanation, factors[], modelName,     │
  │   /ai/rank-drivers              modelVersion, inferenceLogId }         │
  │   /ai/bid-win-probability                                              │
  │   /ai/forecast/* (Phase 2+)                                            │
  │        │                                                               │
  │        ▼                                                               │
  │   PREDICTION MODULES (§5)      one module = one model family,          │
  │   demand · supply · matching    independently versioned, registered,   │
  │   pricing · airport · wait      shadow-testable, kill-switchable       │
  │   earnings · cancellation ·                                            │
  │   fraud                                                                │
  │        │ reads                                                         │
  │        ▼                                                               │
  │   FEATURE STORE (§4)           Postgres feature tables (warm)          │
  │        ▲ writes                + Redis hot cache (real-time zone keys) │
  │        │                                                               │
  │   EVENT PIPELINE (§3)          scheduled projections from existing     │
  │        ▲ reads                 source-of-truth tables — no new         │
  │        │                       instrumentation of product services     │
  └────────┼───────────────────────────────────────────────────────────────┘
           │
  ┌────────┴────────────────────────────────────────────────────────────┐
  │ SOURCES OF TRUTH (already produced by the platform, quality-gated    │
  │ per ai-core-data-readiness.md):                                      │
  │ trips (finalFare = canonical money) · trip_events · bids ·           │
  │ bid_outcomes · driver_bid_exposures · driver_session_logs ·          │
  │ payments + financial_ledger · ratings · surge:{requests,drivers}:*   │
  │ Redis zone keys · driver:{id}:location heartbeat (ephemeral)         │
  └───────────────────────────────────────────────────────────────────────┘
           │ every inference                        │ every outcome
           ▼                                        ▼
   ai_inference_logs  ←──── join on tripId/bidId ────→  bid_outcomes
   (audit: model, version, features, output,            (prediction vs
    confidence, fallbackUsed, latencyMs)                 reality)
```

### 2.3 Recommendation response contract (all endpoints)

```json
{
  "value": 1.25,
  "confidence": 0.82,
  "explanation": "Demand in zone 2262:-3372 is 2.1x the hourly average and 3 drivers are nearby.",
  "factors": [
    { "name": "zone_demand_ratio", "value": 2.1, "weight": 0.55 },
    { "name": "nearby_supply", "value": 3, "weight": 0.30 },
    { "name": "hour_of_day", "value": 18, "weight": 0.15 }
  ],
  "modelName": "pricing-adjustment",
  "modelVersion": "v1.2.0",
  "inferenceLogId": "uuid"
}
```

Callers may ignore everything but `value` (current behavior) — but the audit
trail is complete regardless.

---

## 3. Event Pipeline

**Phase-1 finding:** virtually every event the Founder listed already exists in
an authoritative store. The pipeline's job is **projection, not instrumentation.**

| Founder event | Existing source of truth | Notes |
|---|---|---|
| Ride requested | `trips` (createdAt, status history via `trip_events`) | |
| Ride accepted / declined / countered | `bids` + `bid_outcomes` (declines/counters counted), `trip_events` | |
| Ride cancelled | `trips.status='cancelled'` + `trip_events` (reason) | |
| Ride completed | `trips.status='completed'`, `completedAt`, `finalFare` (canonical) | post-`e225720` only for money fields |
| Driver online/offline | `driver_session_logs` (startedAt/endedAt/durationSec) | |
| GPS / heartbeat | `driver:{userId}:location` Redis (TTL ≤180s) | **ephemeral — never training data directly**; zone aggregates only |
| Demand by zone | `surge:requests:{zone}` (10-min rolling) | snapshot to feature store on schedule |
| Supply by zone | `surge:drivers:{zone}` sets | same |
| Airport activity | `airport_queue_entries`, `trips.isAirportTrip` (geofence-derived) | |
| Acceptance rate / cancellation rate | derivable: `drivers.acceptanceRate`, `completionRate` + `bid_outcomes` | |
| Driver earnings | `trips.driverEarnings` + `earningsSupplement` (floor) + `financial_ledger` | canonical post-hotfix |
| Customer savings | `trips.aiFare − trips.finalFare` where `bidId IS NOT NULL` | **only valid on Trusted/Reconciled rows** — see data-readiness doc |
| Tips | not implemented (no schema) | Phase 2 event catalog placeholder |
| Ratings | `trips.riderRatingDriver` / `driverRatingRider` | |
| Wait / pickup / drop-off / duration | `trip_events` timestamps + `trips.actualDurationMin` | |
| Vehicle class | `vehicles.vehicleClass` via trip → driver → active vehicle | |
| Time of day / day of week / holiday / special events | derived at projection time; holiday calendar = static config table (Phase 2) | |
| Weather / traffic | **no source exists** — Phase 2 external ingestion (NWS API + traffic provider), stored as zone-hour observations | only genuinely new pipeline work |

**Event versioning rules** (extends `ai-versioning-strategy.md`):
- Every projected event row carries `schema_version` (integer, starts at 1).
- Evolution is **additive-only**: new nullable fields bump the minor reader
  logic, never mutate existing meanings.
- Renames/removals = new `schema_version` + dual-write window + catalog update
  in `ai-event-catalog.md` + Founder approval (per that catalog's own rule).
- Deprecated versions remain readable for 12 months, then archived.

---

## 4. Feature Store

Storage: **Postgres feature tables** (`ai_features_*`, migration deferred to
Phase 2 approval) + **Redis hot cache** for real-time zone lookups. No new
infrastructure. Detailed per-feature definitions live in
`ai-feature-registry.md`; this table adds the operational contract:

| Feature | Source | Update freq | Consumers | Validation |
|---|---|---|---|---|
| avg_demand (zone,hour) | surge:requests snapshots → projection | 10 min | demand forecast, pricing | non-negative; zone must match getZoneKey grid |
| avg_supply (zone,hour) | surge:drivers snapshots | 10 min | supply forecast, matching | ≤ registered active drivers |
| avg_wait_time (zone) | trip_events accept→arrive deltas | hourly | wait prediction, dashboard | 0 < x < 120 min; Trusted/Reconciled trips only |
| acceptance_probability (zone,hour,fare-band) | bid_outcomes | hourly | bid win probability | Laplace-smoothed; n≥20 else fall back to parent aggregate |
| zone_popularity | trips pickup/dropoff counts | daily | matching, dashboard | sums to total trips |
| driver_utilization | driver_session_logs vs trips time | daily | supply forecast, earnings forecast | 0–1 |
| airport_demand | airport_queue_entries + isAirportTrip trips | 10 min | airport traffic module | non-negative |
| estimated_earnings (zone,hour) | trips.driverEarnings (canonical) | hourly | driver-facing forecast | **Trusted/Reconciled only**; floor-consistency check |
| avg_fare (zone,hour) | trips.finalFare (canonical) | hourly | pricing recommendation | **Trusted/Reconciled only**; ≥ MINIMUM_FARE |
| cancellation_probability | trips cancelled/created ratios | hourly | cancellation prediction | 0–1; n≥30 |
| customer_lifetime_value | payments (succeeded) per rider | daily | analytics only (Phase 2+) | **Trusted/Reconciled only** |
| driver_reliability_score | acceptanceRate, completionRate, session regularity | daily | matching (recommend-only) | 0–1; **never exposed** (trust-score rule) |
| marketplace_health_score | composite of supply/demand balance, wait, cancellation | hourly | Founder dashboard | components logged separately — no opaque single number |

Every feature row: `computed_at`, `source_window`, `schema_version`,
`quality_class_floor` (the minimum data-quality class that fed it — see
`ai-core-data-readiness.md` §2).

---

## 5. Prediction Modules (Phase 2 build list — recommend-only)

One module = one model family = one registry entry. **v1 of every module is a
transparent statistical model** (zone/time-of-day profiles, Laplace-smoothed
rates, exponentially weighted moving averages) — explainability by
construction, and an honest baseline that any later learned model must beat in
shadow mode.

| Module | v1 method | Consumed by | Output bound (platform-enforced) |
|---|---|---|---|
| Demand forecast | EWMA per zone-hour + weekday profile | dashboard, pricing | forecast only — no action |
| Supply forecast | session-log profiles per zone-hour | dashboard, matching | forecast only |
| Matching recommendations | score = f(distance, reliability, utilization) | dispatch ranking hook | advisory order; dispatch still broadcasts per current rules |
| Dynamic pricing recommendation | demand/supply ratio → suggested adjustment | fare engine hook | **clamped ±$2.00 in fare-engine.service.ts** — the clamp never moves into the model |
| Airport traffic | queue depth + flight schedule (Phase 2 FlightAware reuse) | queue advisories | advisory only |
| Wait time | zone acceptance→arrival percentiles | rider display (Phase 2+) | display only |
| Driver earnings forecast | zone-hour canonical earnings averages | driver app (Phase 2+) | labeled "estimated"; never a guarantee (floor is the guarantee) |
| Cancellation prediction | logistic on wait/fare-gap features | ops alerting | alert only, no auto-cancel |
| Fraud detection | existing trust-service signals + velocity rules | trust-service | **auto-hold ≥90% allowed; permanent ban requires human** (existing rule) |

---

## 6. Model Registry & Experiment Framework

- Naming: `modelName` kebab-case family (`pricing-adjustment`,
  `bid-win-probability`), `modelVersion` semver (`v1.2.0`) — already the
  convention in `ai_inference_logs`; `ai-model-registry.md` is the human
  registry today and becomes a `model_registry` table in Phase 2 (migration
  deferred — design: name, version, status[shadow|challenger|champion|retired],
  activatedAt, activatedBy, configJson, killSwitch).
- **Shadow-mode-first:** every new model version serves in shadow (logged to
  `ai_inference_logs` with `status:'shadow'`, output NOT returned to callers)
  for a minimum evaluation window, compared against the champion on
  prediction-vs-outcome joins before promotion.
- **Champion/challenger:** at most one champion + one challenger per family;
  challenger receives a config-defined traffic fraction, results only (never
  decisions) diverge.
- **Kill switches:** per-family flag in `platform_config`
  (`ai_<family>_enabled`) checked by the ai-service per request; OFF → the
  endpoint returns the deterministic fallback immediately. Platform callers
  additionally keep their own timeouts/fallbacks (defense in depth, unchanged).
- Promotion/rollback: human action, recorded in the registry with actor +
  reason (extends `ai-versioning-strategy.md` §Promotion).

---

## 7. Monitoring & AI Audit

- **Mandate:** every request served by ai-service writes one
  `ai_inference_logs` row (model, version, inputFeatures, output, confidence,
  fallbackUsed, latencyMs, tripId/userId when applicable) — including fallback
  and kill-switch responses. The three existing hooks currently log only on the
  pricing path (`ai_pricing_logs`); Phase 2 unifies on `ai_inference_logs`
  with `ai_pricing_logs` retained as the pricing-specific projection.
- **Dashboards (Phase 6):** fallback rate per family, p50/p95 latency vs the
  caller timeouts (3000ms pricing / 300ms ranking), input drift (feature
  distribution vs training window), prediction-vs-outcome calibration from
  `bid_outcomes` (predictionProbability vs wasAccepted), and clamp saturation
  (% of pricing outputs hitting ±$2 — a saturated clamp means the model wants
  something the rules forbid: surface it, never widen the clamp silently).
- **Audit chain:** `inferenceLogId` returned in every response → callers store
  it where they already store AI context (`trips`, `bid_outcomes.prediction*`)
  → any fare or match is reconstructible: which model, which version, which
  features, what it said, what the rules did to it, what actually happened.

---

## 8. Security & Boundaries

- ai-service binds internal-only (no public ALB route), and — unlike today's
  internal endpoints — **validates `INTERNAL_SERVICE_KEY` from day one**
  (tech-debt register item #3 is the cautionary tale; the AI Core does not
  inherit that debt).
- **Client-supplied heartbeat fields (`speed`, `available`, `rideEligibility`,
  `vehicleClass`) are UNVERIFIED client input.** Before any model consumes
  them, the ai-service must re-derive them server-side (eligibility/class from
  the drivers/vehicles tables; availability from `drivers.isAvailable`). The
  Redis payload is a hint, never a feature.
- **No PII in features:** trust scores, counts, rates, zones, timestamps are
  allowed; names, phones, emails, exact addresses, raw GPS traces are not.
  Zone keys (2km grid) are the finest location granularity in any feature.
- **Anti-discrimination guardrail** (extends `ai-governance-rules.md`): trust
  scores are internal-only (existing rule — 4 badge labels max), and **no
  model may price, match, or rank differently on any attribute serving as a
  proxy for protected classes.** Concretely: rider/driver identity features
  are limited to the registry-approved list (trust score, tenure, trip counts,
  ratings); feature additions require registry + Founder approval; pricing
  features additionally exclude rider-identifying attributes beyond
  trust/tenure (already true of today's fare-adjustment feature set).

---

## 9. Human-Rule Supremacy Table

| Business rule | Value | Enforcement point (code) | AI may |
|---|---|---|---|
| Earnings floor | (mi × $1.10) + (min × $0.22) + $2.50, deterministic | `earnings-floor.service.ts`, trip-service completion | never touch it; formula changes require Founder JWT |
| AI fare adjustment bound | ±$2.00 | `fare-engine.service.ts` `AI_ADJUSTMENT_CAP` (caller-side clamp) | recommend within; clamp saturation is monitored, never widened by AI |
| Airport premium | +$3.50, coordinate geofence | `trips.service.ts` / `fare-engine.service.ts` | no influence |
| Canonical fare | accepted offer = `trips.finalFare`; guards refuse mismatches | `trips.service.ts` endTrip + `payment.service.ts` integrity guard | no influence; AI reads canonical data only |
| Surge cap | 2.5× max; >1.5× requires admin confirmation | airport-service / pricing config | recommend below caps only |
| Bid floor/ceiling | 65% × standard ≤ offer < standard | `bid-state-machine.ts` + `bids.service.ts` | no influence |
| Fraud action | auto-hold ≥90% probability; permanent ban = human only | trust-service | recommend probability; never ban |
| Safety | SOS/panic flows override everything | safety-service | no interaction whatsoever |
| Dispatch eligibility | `isAvailable` + `status='approved'` in Postgres | bids matcher (post-`6954f44`) | rank eligible drivers only; never add/remove eligibility |

---

## 10. Phase 1 Deliverable Boundary

Phase 1 = this architecture + `ai-core-data-readiness.md` + Founder approval.
Explicit non-goals: no ai-service code, no migrations, no model training, no
autonomous pricing or dispatch, no deployment, no dashboard build. Phase 2
begins only on Founder approval of both documents and the data-readiness
gates.
