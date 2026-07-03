# BidiRide — AI Feature Registry v1.0

**Status:** Pending Founder Approval  
**Author:** Engineering  
**Date:** 2026-07-02  
**Scope:** Every input feature for every AI model in BidiRide

This document is the authoritative source for feature definitions. Before a feature is added to, removed from, or renamed in any model, this registry must be updated and approved. Feature schema changes that affect stored `inputFeatures` JSON (in `ai_inference_logs`) require a migration plan.

---

## Registry Format

Each feature entry defines:

| Column | Meaning |
|---|---|
| **Feature** | Canonical snake\_case name used in the feature vector JSON |
| **Type** | `float`, `int`, `boolean`, `string`, `enum` |
| **Source** | Where the value comes from |
| **Default** | Value used when the feature is unavailable |
| **Range / Values** | Valid domain |
| **Privacy** | CLASS-1 through CLASS-5 (see Event Catalog) |
| **Notes** | Derivation logic, caveats, known issues |

---

## Model: `fare-adjustment`

**Purpose:** Adjust the rule-based fare estimate up or down by up to ±$2.00 based on contextual demand signals.  
**Assembled by:** `FeatureService.buildFareFeatures()`  
**Called by:** `pricing-service` → `POST /ai/fare-adjustment`  
**Version:** `v1` (rule-based; SageMaker endpoint gated on `SAGEMAKER_FARE_ENDPOINT`)

| Feature | Type | Source | Default | Range / Values | Privacy | Notes |
|---|---|---|---|---|---|---|
| `distanceMiles` | float | Haversine(pickup, dropoff) | — | [0.1, 200] | CLASS-1 | Required. Never null. |
| `durationMin` | int | `round(distanceMiles / 20 * 60)` | — | [1, 480] | CLASS-1 | Newark avg speed 20 mph |
| `surgeZoneScore` | float | Redis `surge:requests:{zone}` / threshold(150) | `0.0` | [0.0, 1.0] | CLASS-1 | 0 = no demand; 1 = at or above threshold. Capped at 1.0. |
| `isAirport` | boolean | EWR keyword match on pickup/dropoff address | `false` | true / false | CLASS-1 | Keywords: EWR, Newark Airport, Terminal A/B/C |
| `isNight` | boolean | `hour >= 22 \|\| hour < 5` | `false` | true / false | CLASS-1 | Based on requestedAt UTC converted to ET |
| `hourOfDay` | int | `requestedAt.getHours()` | current hour | [0, 23] | CLASS-1 | 0 = midnight ET |
| `dayOfWeek` | int | `requestedAt.getDay()` | current day | [0, 6] (0=Sun) | CLASS-1 | |
| `riderTrustScore` | int | `trust_scores.trust_score` for riderId | `500` | [0, 1000] | CLASS-2 | Internal score only. Never exposed to rider. |
| `riderTotalTrips` | int | `riders.total_trips` | `0` | [0, ∞) | CLASS-2 | Cumulative completed trips |

**Output schema:**

```json
{ "adjustment": "float [-2.00, +2.00]" }
```

**Fallback output (when SageMaker unreachable or AI service down):**

```json
{ "adjustment": 0 }
```

---

## Model: `fraud-score`

**Purpose:** Estimate the probability (0–100) that a user is engaged in fraudulent activity.  
**Assembled by:** `FeatureService.buildFraudFeatures()` — passes inputs through as-is  
**Called by:** `trust-service` → `POST /ai/fraud-score`  
**Version:** `v1` (rule-based; SageMaker endpoint gated on `SAGEMAKER_FRAUD_ENDPOINT`)

| Feature | Type | Source | Default | Range / Values | Privacy | Notes |
|---|---|---|---|---|---|---|
| `userId` | string (uuid) | caller | — | UUID | CLASS-2 | Included for logging linkage; never used as a model feature weight |
| `userRole` | enum | caller | — | `rider` / `driver` | CLASS-1 | Different fraud patterns per role |
| `linkedAccounts` | int | `multi_account_links` count for userId | — | [0, ∞) | CLASS-2 | >2 = strong fraud signal |
| `deviceFingerprints` | int | `device_fingerprints` count for userId | — | [0, ∞) | CLASS-2 | >5 = strong fraud signal |
| `fraudFlagCount` | int | `fraud_alerts` count for userId | — | [0, ∞) | CLASS-4 | Prior fraud flags |
| `disputeCount` | int | `support_tickets` where type=dispute for userId | — | [0, ∞) | CLASS-4 | Payment disputes |
| `accountAgeDays` | int | `now() - users.created_at` in days | — | [0, ∞) | CLASS-1 | New account + 0 trips = moderate signal |
| `totalTrips` | int | role-specific trips count | — | [0, ∞) | CLASS-1 | Completed trips only |
| `ruleScore` | int | trust-service rule engine output | — | [0, 1000] | CLASS-4 | Trust score computed before AI call; passed as a meta-feature |
| `identityVerified` | boolean | `drivers.identity_verified` or `riders.identity_verified` | — | true / false | CLASS-2 | |
| `paymentVerified` | boolean | presence of verified Stripe payment method | — | true / false | CLASS-2 | |
| `emailVerified` | boolean | `users.email_verified` | — | true / false | CLASS-2 | |

**Output schema:**

```json
{ "fraudProbability": "float [0, 100]" }
```

**Fallback output:**

```json
{ "fraudProbability": "<rule-based estimate from FallbackService>" }
```

Fallback logic: `linkedAccounts > 2` → +30; `deviceFingerprints > 5` → +20; `fraudFlagCount > 0` → +40; `disputeCount > 3` → +20; new account + 0 trips → +10. Capped at 100.

**Hard rule:** `fraudProbability ≥ 90` triggers automatic payment hold. Human admin must review before permanent action. This threshold is Founder-locked; changes require signed Founder JWT.

---

## Model: `bid-win-probability`

**Purpose:** Predict the probability (0.05–0.95) that a submitted bid will be accepted by a driver.  
**Assembled by:** `FeatureService.buildBidFeatures()`  
**Called by:** `trip-service` → `POST /ai/bid-win-probability`  
**Version:** `rule-v1` (`BidWinProbabilityEngine` — 13 signals, no SageMaker endpoint yet)  
**Current wiring status:** ⚠️ `bids.service.ts` does NOT call this endpoint yet — uses local formula (Bug 1)

| Feature | Type | Source | Default | Range / Values | Privacy | Notes |
|---|---|---|---|---|---|---|
| `bidAmount` | float | rider input | — | [1.00, 999.99] | CLASS-2 | The rider's dollar offer |
| `aiFare` | float | `trips.ai_fare` | — | [5.00, ∞) | CLASS-1 | AI-estimated fare; reference point for bidRatio |
| `distanceMiles` | float | trip record | `null` | [0.1, 200] | CLASS-1 | Optional; improves ETA signal |
| `etaMinutes` | float | driver location or estimate | `null` | [0, 120] | CLASS-1 | Optional |
| `riderTrustScore` | int | `trust_scores.trust_score` | `500` | [0, 1000] | CLASS-2 | Never exposed to drivers |
| `driverTrustScore` | int | `trust_scores.trust_score` | `500` | [0, 1000] | CLASS-2 | Never exposed to riders |
| `isAirport` | boolean | EWR detection on trip | `null` | true / false | CLASS-1 | Airport trips have higher driver motivation |
| `weatherFactor` | float | external weather API (future) | `1.0` | [1.0, 2.5] | CLASS-1 | 1.0 = normal; >1.0 = adverse. Not yet wired. |
| `timeOfDay` | int | `now().getHours()` | current hour | [0, 23] | CLASS-1 | Peak hours boost probability |
| `driverAcceptanceHistory` | float | `drivers.acceptance_rate` | `null` | [0.0, 1.0] | CLASS-2 | Historical acceptance rate of matched drivers |
| `driverCancellationRate` | float | `1 - drivers.completion_rate` | `null` | [0.0, 1.0] | CLASS-2 | Historical cancellation rate |
| `driverResponseTimeMs` | int | from driver session Redis key (future) | `null` | [0, 300000] | CLASS-2 | Avg ms to respond to requests |
| `currentZoneDemand` | float | Redis `surge:requests:{zone}` / 150 | `null` | [0.0, 1.0] | CLASS-1 | Live demand score |
| `availableDriversInZone` | int | Redis `SCARD surge:drivers:{zone}` | `null` | [0, ∞) | CLASS-1 | Live supply count |
| `historicalAcceptanceRate` | float | `bid_outcomes` zone aggregate | `null` | [0.0, 1.0] | CLASS-1 | Zone-level bid acceptance rate (future) |

**Derived signal used internally (not a raw feature):**

| Signal | Derivation |
|---|---|
| `bidRatio` | `bidAmount / aiFare` — the single most influential signal |

**Output schema:**

```json
{
  "probability": "float [0.05, 0.95]",
  "confidence": "float [0.55, 0.88]",
  "explanation": ["string", "..."]
}
```

**Confidence cap:** Rule-based models are capped at 0.88 max confidence. ROC-AUC placeholder will be replaced when the first SageMaker model is trained.

**Fallback output:** `{ "probability": clamp(0.4 + (bidAmount/aiFare * 0.5), 0, 1) }`

---

## Model: `surge-forecast`

**Purpose:** Predict the surge multiplier for a given zone at current time (used to feed fare-adjustment and admin dashboard).  
**Assembled by:** `FeatureService.buildSurgeFeatures()`  
**Called by:** `InferenceController` → `POST /ai/surge-forecast` (no upstream caller wired yet)  
**Version:** `v1` (rule-based; no SageMaker endpoint)

| Feature | Type | Source | Default | Range / Values | Privacy | Notes |
|---|---|---|---|---|---|---|
| `lat` | float | caller input | — | [40.4, 41.0] (Newark area) | CLASS-3 | Used only to derive `zone`; not stored in training features |
| `lng` | float | caller input | — | [-74.5, -73.9] | CLASS-3 | Same as lat |
| `zone` | string | `floor(lat/0.018):floor(lng/0.022)` | — | string | CLASS-1 | The actual feature; lat/lng discarded after zone derivation |
| `hourOfDay` | int | `now().getHours()` | current hour | [0, 23] | CLASS-1 | |
| `dayOfWeek` | int | `now().getDay()` | current day | [0, 6] | CLASS-1 | |
| `currentRequests` | int | Redis `surge:requests:{zone}` | `0` | [0, ∞) | CLASS-1 | Live request count in zone |
| `currentDrivers` | int | Redis `SCARD surge:drivers:{zone}` | `0` | [0, ∞) | CLASS-1 | Live driver count in zone |

**Output schema:**

```json
{ "forecastedMultiplier": "float [1.0, 2.5]" }
```

**Fallback:** `1.0 + min(1.0, currentRequests / 150) * 0.4`

---

## Model: `driver-earnings`

**Purpose:** Estimate expected earnings for a driver at a given location and time.  
**Assembled by:** `FeatureService.buildDriverEarningsFeatures()` — passes inputs through  
**Called by:** `InferenceController` → `POST /ai/driver-earnings` (no upstream caller wired yet)  
**Version:** `v1` (rule-based; no SageMaker endpoint)

| Feature | Type | Source | Default | Range / Values | Privacy | Notes |
|---|---|---|---|---|---|---|
| `lat` | float | driver GPS | — | [40.4, 41.0] | CLASS-3 | Zone derivation only; not stored as training feature |
| `lng` | float | driver GPS | — | [-74.5, -73.9] | CLASS-3 | Same as lat |
| `hourOfDay` | int | current time | current hour | [0, 23] | CLASS-1 | |
| `dayOfWeek` | int | current time | current day | [0, 6] | CLASS-1 | |
| `driverSessionHours` | float | Redis `driver:{uid}:session_start` | `0` | [0, 12] | CLASS-2 | Hours online this session |
| `tripsThisSession` | int | from trip count query | `0` | [0, ∞) | CLASS-2 | Trips completed this session |

**Output schema:**

```json
{ "estimatedEarnings": "float [floor, ∞)" }
```

**Fallback:** `$8.44` (earnings floor for a typical Newark trip: 3 mi × $1.10 + 12 min × $0.22 + $2.50)

---

## Model: `driver-ranking`

**Purpose:** Rank a set of candidate drivers for a given trip to optimize acceptance probability and rider experience.  
**Assembled by:** `DriverRankingService.rankDrivers()` — enriches from DB + Redis  
**Called by:** `trip-service` → `POST /ai/driver-ranking`  
**Version:** `ranking-v1` (`DriverRankingEngine`)

| Feature | Type | Source | Default | Range / Values | Privacy | Notes |
|---|---|---|---|---|---|---|
| `distanceMiles` | float | driver location vs pickup (haversine) | — | [0, 50] | CLASS-3 | **Bug 2:** currently always 0.00 — driver location not being joined. Must fix before meaningful ranking. |
| `etaMinutes` | float | estimated travel time | `5` | [0, 120] | CLASS-1 | **Bug 2:** hardcoded 5 min for all drivers currently |
| `trustScore` | int | `trust_scores.trust_score` | `500` | [0, 1000] | CLASS-2 | Never exposed to rider |
| `acceptanceRate` | float | `drivers.acceptance_rate` | `0.70` | [0.0, 1.0] | CLASS-2 | Historical rate |
| `cancellationRate` | float | `1 - drivers.completion_rate` | `0.05` | [0.0, 1.0] | CLASS-2 | |
| `avgRating` | float | `drivers.avg_rating` | `4.0` | [1.0, 5.0] | CLASS-2 | |
| `avgResponseTimeMs` | int | future Redis key | `20000` | [0, 300000] | CLASS-2 | Not yet populated from Redis |
| `isPreferredByRider` | boolean | rider's saved drivers (future) | `false` | true / false | CLASS-2 | Not yet wired |
| `hasAirportExperience` | boolean | `drivers.total_trips > 30` | `false` | true / false | CLASS-1 | Proxy for airport experience; rough heuristic |
| `currentSessionEarningsUsd` | float | future — from wallet/session | `null` | [0, ∞) | CLASS-2 | Earnings fairness signal; not yet populated |
| `expectedSessionEarningsUsd` | float | derived from session hours | `null` | [0, ∞) | CLASS-1 | |
| `hoursOnline` | float | Redis `driver:{uid}:session_start` | `0` | [0, 24] | CLASS-2 | Fresh driver bonus |

**Score weights (sum to 100):**

| Signal | Weight | Description |
|---|---|---|
| `eta` | 25 | Lower ETA = higher score. 0 min = 25 pts; ≥30 min = 0 pts |
| `distance` | 15 | Closer driver = higher score. 0 mi = 15 pts; ≥10 mi = 0 pts |
| `trust` | 12 | trustScore / 1000 × 12 |
| `acceptance` | 10 | acceptanceRate × 10 |
| `antiCancel` | 8 | (1 − cancellationRate) × 8 |
| `rating` | 8 | (avgRating − 3) / 2 × 8 (clamped at 0) |
| `responseTime` | 7 | Fast response → higher. <5s = 7 pts; ≥60s = 0 pts |
| `preferredByRider` | 5 | Rider-saved driver gets bonus |
| `airportExperience` | 5 | Only applied to airport trips |
| `earningsFairness` | 3 | Driver near fair-share earns bonus (reduces over-concentration) |
| `freshDriver` | 2 | Online < 4 hours gets bonus |

**Output schema:**

```json
[
  {
    "driverUserId": "uuid",
    "score": "float [0, 100]",
    "rank": "int (1-indexed)",
    "signals": { "eta": 20.5, "distance": 12.0, "..." }
  }
]
```

---

## Model: `dispatch-simulator`

**Purpose:** Choose a dispatch strategy (top-k / phased / broadcast-all) that maximizes acceptance probability given ranked candidates.  
**Assembled by:** Caller passes candidates with scores  
**Called by:** `trip-service` → `POST /ai/dispatch-simulate` (fire-and-forget)  
**Version:** `ranking-v1` (shares version with driver-ranking)

| Feature | Type | Source | Default | Range / Values | Privacy | Notes |
|---|---|---|---|---|---|---|
| `score` | float | output of driver-ranking | `50` | [0, 100] | CLASS-1 | **Bug 3:** currently hardcoded 50 for all candidates |
| `acceptanceRate` | float | `drivers.acceptance_rate` | `0.65` | [0.0, 1.0] | CLASS-2 | Per-driver historical rate |
| `avgResponseTimeMs` | int | future Redis | `25000` | [0, ∞) | CLASS-2 | Used to estimate ETA to response |

**Output schema:**

```json
{
  "strategy": "top-k | phased | broadcast-all",
  "selectedDriverUserIds": ["uuid"],
  "phases": [{ "phase": 1, "driverUserIds": ["uuid"], "delayMs": 0, "reason": "string" }],
  "simulatedAcceptanceProbability": "float [0, 1]",
  "simulatedEtaMinutes": "float",
  "reasoning": "string",
  "modelVersion": "string"
}
```

---

## Marketplace / Repositioning Models (no inference logging)

These endpoints serve the driver app and admin dashboard but do not use `AiInferenceLog`.

| Model | Endpoint | Key Inputs | Output |
|---|---|---|---|
| `heatmap` | `GET /ai/heatmap` | Redis zone data | Zone demand scores, surge multipliers |
| `demand-forecast` | `GET /ai/demand-forecast?lat&lng` | Redis + HOUR\_FACTORS | 5 forecast horizons (15m, 30m, 1h, 4h, 24h) |
| `repositioning` | `GET /ai/repositioning?lat&lng` | Redis adjacent zones | Up to 3 zone recommendations with ride success probability |
| `earnings-optimizer` | `GET /ai/earnings-optimizer?lat&lng&hoursOnline&sessionEarnings` | Redis + EWR queue | Best zones, best hours, break recommendation, EWR recommendation |

---

## Feature Naming Conventions

1. All feature names are `snake_case`.
2. Scores (0–1): suffix `_score` or `_rate` (e.g., `currentZoneDemand`, `acceptanceRate`).
3. Counts: suffix `_count` or plural noun (e.g., `fraudFlagCount`, `linkedAccounts`).
4. Flags: prefix `is_` or `has_` (e.g., `isAirport`, `hasAirportExperience`).
5. Time: suffix `_min`, `_sec`, or `_ms` for durations; `_at` for timestamps (ISO 8601).
6. Never use PII field names in feature vectors (no `name`, `phone`, `email`, `cardLast4`).

---

## Feature Change Process

| Change Type | Approval Required |
|---|---|
| Add optional feature to existing model | Engineering lead |
| Remove existing feature | Engineering lead + QA sign-off |
| Change feature name | Engineering lead + schema migration |
| Change default value | Engineering lead |
| Add feature that changes model output range | Founder approval |
| Increase `AI_ADJUSTMENT_CAP` above $2.00 | Founder approval (Founder-locked) |
| Add protected characteristic as feature | **Prohibited — see Governance Rules** |
