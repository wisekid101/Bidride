# BidiRide — AI Data Dictionary v1.0

**Status:** Pending Founder Approval  
**Author:** Engineering  
**Date:** 2026-07-02  
**Scope:** Every field in every AI-facing database table and the key fields from upstream tables that feed the AI pipeline

This dictionary is the authoritative definition of what each field means, how it is populated, and how it should be interpreted in the context of model training and inference logging.

---

## Table: `ai_inference_logs`

**Prisma model:** `AiInferenceLog`  
**Purpose:** Immutable log of every inference call made to the AI service. Primary training signal source and model performance record.  
**Write path:** `InferenceLogService.log()` — fire-and-forget; never blocks inference response.  
**Read path:** `ModelMetricsService` (bid-win-probability metrics), admin AI dashboard.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | UUID | No | Primary key. Auto-generated. |
| `model_name` | VARCHAR(100) | No | Canonical model identifier. One of: `fare-adjustment`, `fraud-score`, `bid-win-probability`, `surge-forecast`, `driver-earnings`, `driver-ranking`, `dispatch-simulator`. Must match `MODEL_NAMES` constants in `types.ts`. |
| `model_version` | VARCHAR(50) | No | Version string at time of inference. Format: `{name}-v{N}` for champions; `{name}-v{N}:{slot}` for challenger/shadow rows. E.g. `rule-v1`, `rule-v1:shadow`. |
| `input_features` | JSONB | No | Feature vector sent to the model. Must not contain CLASS-5 fields (PII, SOS data, card data). Schema is model-specific — see Feature Registry. |
| `output` | JSONB | No | Raw model output. Schema is model-specific. E.g. `{"adjustment": 0.75}` for fare-adjustment. |
| `confidence` | DECIMAL(5,2) | No | Model confidence score [0.00, 1.00]. Rule-based models cap at 0.88. ML models will report actual confidence. |
| `fallback_used` | BOOLEAN | No | `true` if SageMaker was unreachable and `FallbackService` was used. Inference with `fallback_used = true` should not be used to evaluate model accuracy. |
| `latency_ms` | INT | No | Wall-clock milliseconds from feature assembly start to response returned to caller. Excludes network round-trip to SageMaker when applicable. |
| `trip_id` | UUID | Yes | FK to `trips.id`. NULL for inferences not associated with a specific trip (e.g. fraud-score at account creation). |
| `user_id` | UUID | Yes | FK to `users.id`. NULL for non-user-specific inferences. |
| `created_at` | TIMESTAMPTZ | No | Inference timestamp. Immutable. |

**Indexes:**
- `(model_name, created_at DESC)` — for time-series metric queries per model
- `(trip_id)` — for joining with bid outcomes
- `(user_id)` — for per-user inference history

**Training data use:**
- Filter `fallback_used = false` before using for model evaluation.
- Filter `model_version NOT LIKE '%:shadow%'` to exclude shadow runs from champion accuracy metrics.
- Join with `bid_outcomes` on `trip_id` (where `model_name = 'bid-win-probability'`) to get ground truth labels.

---

## Table: `bid_outcomes`

**Prisma model:** `BidOutcome`  
**Purpose:** Ground truth labels for bid-win-probability model training. One row per trip completion or bid rejection. The primary ML training dataset.  
**Write path:** `BidOutcomeService.recordOutcome()` called from trip-service after trip end. **Currently only called on accepted bids (Bug 4).**  
**Read path:** `ModelMetricsService` (accuracy, calibration, by-zone, by-hour metrics).

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | UUID | No | Primary key. |
| `trip_id` | UUID | No | FK to `trips.id`. |
| `bid_id` | UUID | Yes | FK to `bids.id`. NULL if trip was taken at standard fare (no bid submitted). |
| `zone_key` | VARCHAR(50) | Yes | Zone bucket of pickup location: `floor(lat/0.018):floor(lng/0.022)`. Used for by-zone accuracy metrics. NULL if pickup lat/lng unavailable. |
| `was_accepted` | BOOLEAN | No | `true` = driver accepted the bid; `false` = bid was declined, expired, or cancelled. **All outcomes must be recorded — not just accepted bids.** |
| `time_to_acceptance_ms` | INT | Yes | Milliseconds from bid creation to driver acceptance. NULL for rejected/expired bids. |
| `drivers_viewed` | INT | No | Count of unique drivers who received this bid broadcast (from `driver_bid_exposures`). **Currently always 0 (Bug 5).** |
| `drivers_ignored` | INT | No | Count of drivers who saw the bid and took no action. `drivers_ignored = drivers_viewed - drivers_declined - drivers_countered - (was_accepted ? 1 : 0)`. **Currently always 0 (Bug 5).** |
| `drivers_declined` | INT | No | Count of drivers who explicitly declined. **Currently always 0 (Bug 5).** |
| `drivers_countered` | INT | No | Count of drivers who submitted a counter offer. **Currently always 0 (Bug 5).** |
| `final_accepted_amount` | DECIMAL(10,2) | Yes | The dollar amount the driver agreed to. For accepted bids: equals `bids.rider_offer` or `bids.counter_amount` depending on flow. NULL for rejections. |
| `final_fare` | DECIMAL(10,2) | Yes | Final fare charged to rider including wait fees. May differ from `final_accepted_amount` if wait fee was added. NULL for rejections. |
| `driver_earnings` | DECIMAL(10,2) | Yes | Driver take-home after platform fee. NULL for rejections. |
| `platform_fee` | DECIMAL(10,2) | Yes | Platform revenue from this trip. NULL for rejections. |
| `prediction_probability` | DECIMAL(5,4) | Yes | The `probability` output from the most recent `bid-win-probability` inference for this trip at bid time. NULL if no inference was logged. This is the MODEL'S PREDICTION — compared against `was_accepted` to compute accuracy. |
| `prediction_confidence` | DECIMAL(5,4) | Yes | The model's confidence at the time of prediction. |
| `prediction_correct` | BOOLEAN | Yes | `(prediction_probability >= 0.5) == was_accepted`. Populated by `BidOutcomeService`. NULL if `prediction_probability` was NULL. |
| `model_version` | VARCHAR(50) | Yes | Version of the model that made the prediction. Copied from the linked `ai_inference_logs` row. |
| `created_at` | TIMESTAMPTZ | No | When this outcome was recorded. |

**Indexes:**
- `(trip_id)` — join with trips and inference logs
- `(was_accepted, created_at DESC)` — time-sliced accuracy queries
- `(zone_key, was_accepted)` — zone-level acceptance rate
- `(prediction_correct, created_at DESC)` — time-series accuracy trending

**Training data use:**
- `was_accepted` is the ground truth label (binary classification).
- `prediction_probability` is the model's pre-outcome prediction — compare to label to compute accuracy.
- Use `drivers_viewed`, `drivers_ignored` to compute supply-side context features for retraining.
- Use `zone_key` and `created_at` (hour extraction) for stratified accuracy analysis.

**Known data quality issues:**
1. **Bug 4:** `was_accepted = false` rows not written today. Training dataset is 100% positive-only. Will produce optimistically biased models.
2. **Bug 5:** `drivers_viewed`, `drivers_ignored`, `drivers_declined`, `drivers_countered` always 0. Supply-side features in bid_outcomes are unusable until fixed.

---

## Table: `driver_bid_exposures`

**Prisma model:** `DriverBidExposure`  
**Purpose:** Record of which driver saw which bid. Written in bulk at broadcast time. Used to compute `drivers_viewed` in `bid_outcomes` and to identify which drivers ignored a bid (strong negative training signal).  
**Write path:** `dispatch.service.ts` `broadcastBidRequest()` — `prisma.driverBidExposure.createMany()`  
**Read path:** `BidOutcomeService.recordOutcome()` (intended — currently not queried, Bug 5).

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | UUID | No | Primary key. |
| `bid_id` | UUID | No | FK to `bids.id`. |
| `trip_id` | UUID | No | FK to `trips.id`. Denormalized from bid for query convenience. |
| `driver_user_id` | UUID | No | FK to `users.id` (driver's user record). |
| `exposed_at` | TIMESTAMPTZ | No | When the bid was broadcast to this driver. |

**Indexes:**
- `(bid_id)` — count exposures per bid
- `(driver_user_id, exposed_at DESC)` — per-driver exposure history

**Training data use:**
- `COUNT(*) WHERE bid_id = ?` → `drivers_viewed` in `bid_outcomes`
- Cross-reference with `bid_outcomes`: drivers who were exposed but did not accept and did not decline = ignored

---

## Table: `ai_pricing_logs`

**Prisma model:** `AiPricingLog`  
**Purpose:** Per-trip record of the AI fare adjustment applied. Intended as a richer alternative to `ai_inference_logs` for fare-adjustment analysis.  
**Write path:** **Not currently written (dead table — Bug from planning report).** Pricing-service logs via `ai_inference_logs` instead.  
**Status:** To be evaluated: either populate this table from pricing-service or deprecate it in a future migration.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | UUID | No | Primary key. |
| `trip_id` | UUID | No | FK to `trips.id`. |
| `input_features` | JSONB | No | Feature vector sent to fare-adjustment model. See Feature Registry. |
| `raw_fare` | DECIMAL(8,2) | No | Fare computed by rule engine before AI adjustment. |
| `ai_adjustment` | DECIMAL(8,2) | No | Adjustment returned by AI model. Range: [-2.00, +2.00]. |
| `final_fare` | DECIMAL(8,2) | No | `raw_fare + ai_adjustment` (before minimum fare floor). |
| `model_version` | VARCHAR(50) | No | Model version at time of inference. |
| `confidence_score` | DECIMAL(5,2) | No | Model confidence [0.00, 1.00]. |
| `created_at` | TIMESTAMPTZ | No | Inference timestamp. |

---

## Table: `driver_session_logs`

**Prisma model:** `DriverSessionLog`  
**Purpose:** Record of each driver availability session (online → offline). Used by earnings-optimizer for historical session context.  
**Write path:** Driver-service or WebSocket gateway at online/offline transition.  
**Read path:** `EarningsOptimizerService` (future — not yet queried directly).

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | UUID | No | Primary key. |
| `driver_user_id` | UUID | No | FK to `users.id`. |
| `started_at` | TIMESTAMPTZ | No | When driver went online. |
| `ended_at` | TIMESTAMPTZ | Yes | When driver went offline. NULL if session is currently active. |
| `duration_sec` | INT | Yes | `EXTRACT(EPOCH FROM ended_at - started_at)`. Populated on session end. NULL if active. |

---

## Key Upstream Fields (feeding AI but stored in other tables)

### `trips` table — AI-relevant fields

| Column | AI Use |
|---|---|
| `ai_fare` | Reference fare for bid-win-probability; fare-adjustment baseline |
| `final_fare` | Outcome label for fare-adjustment model evaluation |
| `driver_earnings` | Outcome for earnings-optimizer calibration |
| `platform_fee` | Business metric; logged in bid_outcomes |
| `earnings_floor_met` | Signal for whether fare undercut the floor (useful for pricing model) |
| `earnings_supplement` | Amount BidiRide added; indicates AI fare was too low |
| `route_distance_miles` | Planned distance — compare to `actual_distance_miles` for detour detection |
| `actual_distance_miles` | Actual GPS-measured distance — detour fraud signal |
| `estimated_duration_min` | Planned duration |
| `actual_duration_min` | Actual duration — detour fraud signal |
| `pickup_wait_seconds` | Driver wait time at pickup — quality signal |
| `route_deviation_count` | Count of route deviations — fraud/safety signal |
| `accepted_at` | Used to compute `time_to_acceptance_ms` for bid outcomes |
| `is_airport_trip` | Airport flag for multiple models |
| `is_night_ride` | Night flag for fare-adjustment |

### `drivers` table — AI-relevant fields

| Column | AI Use |
|---|---|
| `avg_rating` | Driver-ranking signal (8-point weight) |
| `acceptance_rate` | Driver-ranking signal (10-point weight); bid-win-probability feature |
| `completion_rate` | Driver-ranking (anti-cancel signal, 8-point weight) |
| `total_trips` | Airport experience proxy (`total_trips > 30`) |

### `trust_scores` table — AI-relevant fields

| Column | AI Use |
|---|---|
| `trust_score` | Input to fare-adjustment, bid-win-probability, driver-ranking |
| `fraud_probability` | Output from fraud-score model; triggers auto-hold at ≥90 |
| `current_badge` | Displayed badge — NOT an AI feature; derived from trust_score |

---

## Redis Keys Used by AI Pipeline

| Key Pattern | Type | TTL | AI Use |
|---|---|---|---|
| `surge:requests:{zone}` | STRING (int) | 24h | Demand count per zone → surgeZoneScore, currentZoneDemand |
| `surge:drivers:{zone}` | SET (userIds) | 24h | Supply count per zone → availableDriversInZone |
| `driver:{userId}:location` | STRING (JSON) | ~10s | Real-time driver position (ephemeral; never persisted) |
| `driver:{userId}:session_start` | STRING (epoch ms) | 24h | Session duration → hoursOnline |
| `queue:ewr` | ZSET (driverId → score) | 24h | EWR queue → airport recommendation, queueLength |

---

## Null / Missing Value Policy

| Situation | Correct Handling |
|---|---|
| Feature unavailable (Redis miss, DB NULL) | Use documented default from Feature Registry. Never substitute 0 for a nullable score unless 0 is the semantic default. |
| Feature is CLASS-5 (prohibited) | Omit field entirely from feature vector. Do not substitute. |
| Inference returns null output | Log error, mark `fallback_used = true`, return fallback value. |
| `prediction_probability` is null in bid_outcomes | `prediction_correct` must be null. Do not set false. |
| `drivers_viewed` is 0 | Means "not yet populated" (Bug 5), not "zero drivers saw it". Filter `drivers_viewed = 0` from accuracy training until fixed. |
