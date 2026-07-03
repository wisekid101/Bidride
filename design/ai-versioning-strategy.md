# BidiRide — AI Versioning Strategy v1.0

**Status:** Pending Founder Approval  
**Author:** Engineering  
**Date:** 2026-07-02  
**Scope:** How AI models are versioned, promoted, rolled back, and retired

---

## Version Naming

### Model Versions

All model versions follow the format: `{type}-v{N}`

| Segment | Values | Example |
|---|---|---|
| `{type}` | `rule` for pure rule engines; `ml` for SageMaker-trained models | `rule`, `ml` |
| `{N}` | Monotonically increasing integer, starting at 1 | `1`, `2`, `3` |

**Examples:**
- `rule-v1` — first rule-based implementation (current for all models)
- `ml-v1` — first ML-trained model
- `ml-v2` — retrained ML model (same architecture, new data)

**Champion slot version** is stored in `ModelRegistryService.REGISTRY_CONFIG`.  
**Challenger/shadow versions** are set at runtime via `promoteChallenger()` / `promoteShadow()`.

**Shadow log suffix:** When `InferenceController.runShadows()` logs a non-champion run, it appends `:{slot}` to the version string: `ml-v1:challenger`, `ml-v1:shadow`. This ensures champion and shadow predictions are distinguishable in `ai_inference_logs`.

### Feature Vector Versions

Feature vectors (stored in `ai_inference_logs.input_features` as JSONB) are not independently versioned. Instead, the `model_version` field on the log row implies the feature schema — they move together. When features change, the model version increments.

### Service Version

The AI service itself uses a service-level version (`version: '1.0.0'` in `InferenceController.getHealth()`). This is the NestJS service version, not a model version. These are independent.

---

## Promotion Process

### Stage 1: Shadow Mode

A new model is deployed to the `shadow` or `challenger` slot in `ModelRegistryService`. It receives all production feature vectors in parallel (via `runShadows()`), but its predictions are never served to users. Predictions are logged with `model_version: '{version}:shadow'`.

**Shadow mode requirements:**
- Minimum 500 shadow inferences before any evaluation
- No user impact — shadow predictions are silently discarded
- Shadow can run indefinitely without Founder approval

### Stage 2: Offline Evaluation

Engineering runs backtesting against the existing `bid_outcomes` / `ai_inference_logs` dataset. The challenger model's shadow predictions are compared against ground truth.

**Evaluation metrics required before promotion:**

| Model | Primary Metric | Threshold | Secondary |
|---|---|---|---|
| `bid-win-probability` | Accuracy | ≥ 0.70 | Calibration error < 5pp per decile |
| `fare-adjustment` | MAE | < $1.00 | No systematic zone or time bias |
| `fraud-score` | Precision at 90% threshold | ≥ 0.85 | No disparate impact (statistical test) |
| `driver-ranking` | Acceptance rate improvement | ≥ +2pp vs champion | No protected-characteristic correlation |
| `surge-forecast` | RMSE on held-out zones | < 0.3 | No systematic hour-of-day bias |

### Stage 3: Approval

| Change | Approver |
|---|---|
| Rule-based parameter tweak (e.g. adjust weight from 10 → 12) | Engineering lead |
| New shadow/challenger deployment | Engineering lead |
| Champion promotion (rule → rule, same architecture) | Engineering lead |
| Champion promotion (rule → ML, first ML model) | **Founder approval** |
| Increase `AI_ADJUSTMENT_CAP` above $2.00 | **Founder approval** |
| Change auto-hold threshold (currently 90%) | **Founder approval** |
| Any change to earnings floor formula or supplement logic | **Founder approval (signed JWT required)** |

### Stage 4: Champion Swap

1. Update `REGISTRY_CONFIG` in `model-registry.service.ts` with new `championVersion` and optional `endpointEnv`.
2. Deploy updated `ai-service`.
3. Verify `GET /ai/health` returns new version in `activeVersion`.
4. Monitor `fallback_rate` and `error_rate` for 15 minutes post-deployment.
5. If error rate exceeds 5% within 15 minutes → immediate rollback (see below).

---

## Rollback Process

### Automated (within deployment window)

If `ModelHealthService` detects `errorRatePercent > 5` within 15 minutes of a champion swap:
1. Revert `REGISTRY_CONFIG` to previous champion version.
2. Redeploy previous ai-service image.
3. All in-flight inferences fall back to rule-based `FallbackService` during the gap.
4. Page on-call engineer.

### Manual Rollback

If a model produces systematically wrong predictions after the automated window:
1. Engineering lead sets the model's champion version back to the prior version in `REGISTRY_CONFIG`.
2. Redeploy ai-service.
3. Open post-mortem: document what metric was wrong, what data quality issue was missed.
4. Previous champion version is never deleted — always available for rollback.

**Rollback does not require deleting bad inference logs.** All `ai_inference_logs` rows are immutable. Filter by `model_version` to exclude bad-model predictions from retraining.

---

## A/B Testing

BidiRide does not do live A/B testing with split production traffic. All non-champion models run in shadow mode only. Rationale:

1. Split traffic would expose riders and drivers to two different pricing/probability experiences simultaneously, creating fairness concerns.
2. The champion/shadow framework provides offline A/B comparison without live user risk.
3. At alpha/beta scale, the volume of trips is too low for statistically significant live A/B tests.

**Exception:** When the first SageMaker model is ready, a supervised shadow run of at least 2 weeks (or 1,000 completed trips, whichever is longer) is required before promotion, to confirm shadow accuracy matches offline evaluation.

---

## Retraining Schedule

| Model | Retraining Trigger | Minimum Data |
|---|---|---|
| `bid-win-probability` | 1,000 new bid outcomes since last training | 1,000 labeled rows |
| `fare-adjustment` | 500 new trip completions since last training | 500 trips with fare outcome |
| `fraud-score` | 50 new admin-reviewed fraud alerts since last training | 50 labeled outcomes |
| `driver-ranking` | Every 3 months or after driver fleet grows by 25% | 200 trips per active driver |

**Retraining is always manual for now.** No automated retraining pipeline exists yet. All model retraining requires a pull request against the model code or a new SageMaker training job triggered by an engineer.

---

## Version Retirement

A model version is retired when:
1. A newer version has been champion for at least 30 days without a rollback.
2. All shadow/challenger runs referencing the old version have completed.

Retirement means:
- Removing the version from `ModelRegistryService.REGISTRY_CONFIG` challenger/shadow slots.
- Historical `ai_inference_logs` rows with the old version string are retained for audit; they are not deleted.
- If a SageMaker endpoint exists for the old version, it is deleted by an engineer with Founder approval.

---

## Version History Log

| Model | Version | Type | Deployed | Retired | Notes |
|---|---|---|---|---|---|
| `fare-adjustment` | `rule-v1` | Rule | Initial build | Active | Always returns adjustment: 0 until ML deployed |
| `fraud-score` | `rule-v1` | Rule | Initial build | Active | Fallback mirrors original trust-service logic |
| `bid-win-probability` | `rule-v1` | Rule | Initial build | Active | 13-signal engine; confidence cap 0.88 |
| `surge-forecast` | `rule-v1` | Rule | Initial build | Active | Hour-factor + Redis counters |
| `driver-earnings` | `rule-v1` | Rule | Initial build | Active | Returns earnings floor estimate |
| `driver-ranking` | `ranking-v1` | Rule | Initial build | Active | 11 signals, sum to 100; distance bug pending fix |
| `dispatch-simulator` | `ranking-v1` | Rule | Initial build | Active | Score input bug pending fix |
