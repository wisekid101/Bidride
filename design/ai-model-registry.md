# BidiRide — AI Model Registry v1.0

**Status:** Pending Founder Approval  
**Author:** Engineering  
**Date:** 2026-07-02  
**Scope:** Formal record of every AI model in the BidiRide platform

This registry is the operational source of truth for what models exist, their current production status, and their deployment configuration. Changes to champion, challenger, or shadow slots require registry update before deployment.

---

## Registry Summary

| Model | Type | Champion | SageMaker Ready | Status |
|---|---|---|---|---|
| `fare-adjustment` | Rule → ML | `v1` | env: `SAGEMAKER_FARE_ENDPOINT` | Champion active; ML endpoint not deployed |
| `fraud-score` | Rule → ML | `v1` | env: `SAGEMAKER_FRAUD_ENDPOINT` | Champion active; ML endpoint not deployed |
| `bid-win-probability` | Rule | `rule-v1` | — | Champion active (13-signal rule engine) |
| `surge-forecast` | Rule | `v1` | — | Defined; no upstream caller wired |
| `driver-earnings` | Rule | `v1` | — | Defined; not surfaced to driver app |
| `driver-ranking` | Rule | `ranking-v1` | — | Active; distance input bugged (Bug 2) |
| `dispatch-simulator` | Rule | `ranking-v1` | — | Active; scores input bugged (Bug 3) |

---

## Model: `fare-adjustment`

**Model ID:** `fare-adjustment`  
**Purpose:** Adjust the rule-computed fare by up to ±$2.00 based on demand signals not captured by the pricing formula.  
**Output:** Scalar `adjustment` in dollars.

### Champion

| Field | Value |
|---|---|
| Version | `v1` |
| Type | Rule-based (no ML) — returns `adjustment: 0` via `FallbackService` |
| SageMaker endpoint env var | `SAGEMAKER_FARE_ENDPOINT` |
| Endpoint deployed | No |
| Promoted by | — |
| Promoted at | — |
| Accuracy | N/A (no outcome label yet) |
| Fallback behavior | `adjustment: 0` (fare unchanged) |

### Challenger / Shadow
None currently defined.

### Constraints
- Adjustment is hard-capped at ±$2.00 by pricing-service (`AI_ADJUSTMENT_CAP`). The cap is Founder-locked.
- Fallback to 0 is intentional: no adjustment is safer than a random adjustment.
- The earnings floor is **never** overridden by AI fare adjustment. Floor is applied after AI adjustment.

### Training Data Source
- `ai_inference_logs` where `model_name = 'fare-adjustment'`
- Join `ai_pricing_logs` (when populated) for raw fare + final fare labels
- Outcome label: `trips.earnings_floor_met` (false = AI fare was too low)

### Promotion Criteria (to SageMaker ML model)
- Minimum 500 inference-outcome pairs with populated `ai_pricing_logs`
- MAE (mean absolute error) < $1.00 on hold-out set
- No systematic bias toward any zone, time-of-day, or rider trust band
- Founder approval required

---

## Model: `fraud-score`

**Model ID:** `fraud-score`  
**Purpose:** Estimate fraud probability (0–100) for a user. Feeds trust score calculation and auto-hold decisions.  
**Output:** Scalar `fraudProbability` [0, 100].

### Champion

| Field | Value |
|---|---|
| Version | `v1` |
| Type | Rule-based (no ML) |
| SageMaker endpoint env var | `SAGEMAKER_FRAUD_ENDPOINT` |
| Endpoint deployed | No |
| Promoted by | — |
| Promoted at | — |
| Fallback behavior | Rule combination: `linkedAccounts > 2` → +30; `deviceFingerprints > 5` → +20; `fraudFlagCount > 0` → +40; `disputeCount > 3` → +20; new account + 0 trips → +10 |

### Challenger / Shadow
None currently defined.

### Constraints
- **Auto-hold threshold: 90.0.** This is Founder-locked. No automated permanent ban. Human admin must review.
- An ML model that raises this threshold without Founder approval is a **prohibited deployment**.
- Fraud signals must not include SOS events, panic events, or safety recordings (CLASS-5 PROHIBITED\_AI).
- Protected characteristics (race, gender, national origin, religion, disability) are **absolutely prohibited** as features.

### Training Data Source
- `ai_inference_logs` where `model_name = 'fraud-score'`
- `fraud_alerts` table — outcome: `is_confirmed` (admin confirmed vs dismissed)
- Ground truth label: admin decision (confirmed fraud = 1; dismissed = 0)

### Promotion Criteria
- Minimum 200 fraud-alert outcomes with admin decisions
- Precision ≥ 0.85 at the 90% threshold (to preserve auto-hold correctness)
- No disparate impact across protected groups (statistical test required)
- Founder approval required; legal review recommended

---

## Model: `bid-win-probability`

**Model ID:** `bid-win-probability`  
**Purpose:** Predict the probability that a bid will be accepted by a driver. Displayed to rider as win probability indicator. Feeds `bid_outcomes` for accuracy tracking.  
**Output:** `{ probability: [0.05, 0.95], confidence: [0.55, 0.88], explanation: string[] }`

### Champion

| Field | Value |
|---|---|
| Version | `rule-v1` |
| Type | 13-signal rule engine (`BidWinProbabilityEngine`) |
| SageMaker endpoint env var | None (not yet planned) |
| Endpoint deployed | No |
| Wiring status | ⚠️ Endpoint exists but `bids.service.ts` uses local formula (Bug 1) |
| Accuracy | Unknown (outcome data insufficient — Bug 4 means only accepted bids are tracked) |
| Confidence cap | 0.88 (rule-based cap; ML models will have real calibration) |

### Challenger / Shadow
None currently defined. Infrastructure ready (`runShadows()` in InferenceController).

### Constraints
- Probability shown to rider must be from this model, not a local formula.
- Output range is clamped [0.05, 0.95] — never 0% or 100%.
- Explanation strings shown to rider must not reveal driver trust scores, driver identity, or zone data.

### Training Data Source
- `ai_inference_logs` where `model_name = 'bid-win-probability'` → prediction
- `bid_outcomes` where `prediction_probability IS NOT NULL` → ground truth
- `prediction_correct` column — pre-computed binary accuracy label

### Promotion Criteria (to ML model)
- Minimum 1,000 bid outcomes with both prediction and ground truth (requires Bug 4 fix first)
- Accuracy ≥ 0.70 on hold-out set
- Calibration: predicted probability within 5 percentage points of actual rate in each decile bucket
- Founder approval required

---

## Model: `surge-forecast`

**Model ID:** `surge-forecast`  
**Purpose:** Forecast surge multiplier for a zone at current and near-future time. Used by admin dashboard and pricing pipeline.  
**Output:** `{ forecastedMultiplier: [1.0, 2.5] }`

### Champion

| Field | Value |
|---|---|
| Version | `v1` |
| Type | Hour-factor table + Redis live count |
| SageMaker endpoint env var | None |
| Endpoint deployed | No |
| Upstream caller | None wired (endpoint exists; not called by pricing or admin directly) |
| Fallback | `1.0 + min(currentRequests/150, 1.0) * 0.4` |

### Constraints
- Airport surge hard cap: 2.5×. Admin confirmation required above 1.5×. These limits are enforced by `airport-service`, not by this model.

---

## Model: `driver-earnings`

**Model ID:** `driver-earnings`  
**Purpose:** Estimate expected earnings for a driver at a location and time.  
**Output:** `{ estimatedEarnings: float }`

### Champion

| Field | Value |
|---|---|
| Version | `v1` |
| Type | Rule-based (floor formula estimate) |
| SageMaker endpoint env var | None |
| Endpoint deployed | No |
| Upstream caller | None wired (endpoint exists; not called from driver app yet) |
| Fallback | `$8.44` (earnings floor for typical Newark trip) |

### Constraints
- Earnings estimates displayed to drivers must always include the disclaimer: "Estimates only — not a guarantee. Actual earnings depend on trip distance, duration, and demand."
- Must never show an estimate below the earnings floor formula ($8.44 for typical trip).

---

## Model: `driver-ranking`

**Model ID:** `driver-ranking`  
**Purpose:** Score and rank candidate drivers for a trip. Determines dispatch order and strategy.  
**Output:** Ranked list with per-driver scores and signal breakdown.

### Champion

| Field | Value |
|---|---|
| Version | `ranking-v1` |
| Type | Weighted signal engine (`DriverRankingEngine`) — 11 signals, sum to 100 |
| SageMaker endpoint env var | None |
| Endpoint deployed | No |
| Known bugs | Bug 2: distanceMiles always 0; etaMinutes always 5 for all candidates |

### Constraints
- Ranking must not use protected characteristics.
- The `isPreferredByRider` signal (5 pts) is acceptable — rider preference is a legitimate input and is symmetric (any rider can save any driver).
- Ranking output must not be exposed to drivers (anti-gaming rule).

---

## Model: `dispatch-simulator`

**Model ID:** `dispatch-simulator`  
**Purpose:** Simulate dispatch strategy (top-k / phased / broadcast-all) and log the decision for future optimization.  
**Output:** Strategy, phases, simulated acceptance probability.

### Champion

| Field | Value |
|---|---|
| Version | `ranking-v1` (shares version with driver-ranking) |
| Type | Rule-based decision tree |
| SageMaker endpoint env var | None |
| Upstream caller | `trip-service/bids.service.ts` — fire-and-forget, no blocking |
| Known bugs | Bug 3: all candidates receive score=50 (ranking scores not passed) |

---

## Champion/Challenger/Shadow Framework

The framework is implemented in `InferenceController.runShadows()` and `ModelRegistryService`. It supports up to 4 concurrent model slots per model name:

| Slot | Traffic | Logged as | Decision Authority |
|---|---|---|---|
| `champion` | 100% production | `{version}` | Current production model |
| `challenger` | 0% — shadow only | `{version}:challenger` | Runs in background; logged but not served to users |
| `shadow` | 0% — shadow only | `{version}:shadow` | Experimental tracking |
| `experimental` | 0% — shadow only | `{version}:experimental` | Prototype testing |

**Challenger promotion process:** See Versioning Strategy document.

**Shadow mode rule:** A model in challenger/shadow/experimental slot never affects any user-facing output. It only logs its predictions to `ai_inference_logs`. This makes it safe to run new models in parallel before any promotion decision.
