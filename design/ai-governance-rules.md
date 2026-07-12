# BidiRide — AI Governance Rules v1.1

**Status:** Pending Founder Approval  
**Author:** Engineering  
**Date:** 2026-07-02 (v1.0) · 2026-07-11 (v1.1 — AI Core Phase 2 amendments)  
**Scope:** Non-negotiable rules governing every AI model, feature, and decision in BidiRide

**v1.1 changes:** Rule 3 extended with the trust-score pricing prohibition and
the enforced pricing-feature allowlist; new Rule 11 (Shadow Mode Is Mandatory)
and Rule 12 (Internal Authentication); new "AI Core Phase 2 Operational
Governance" section covering allowed/prohibited pricing features, kill-switch
behavior, feature-family activation, rollback, and data retention.

These rules are permanent constraints on the AI system. They exist to protect riders, drivers, and the company. They override business pressure, engineering convenience, and model accuracy improvements.

---

## Rule 1: Safety Decisions Override AI

AI models have zero authority over safety decisions. No model output may:

- Prevent a rider or driver from triggering SOS
- Delay or filter a panic event
- Influence whether a safety alert is escalated
- Affect the 5-second SOS countdown
- Suppress or modify 911 routing

If a model's recommendation conflicts with a safety rule, the safety rule wins unconditionally. The AI system must be architected so that the safety pipeline has no dependency on `ai-service` availability.

---

## Rule 2: Earnings Floor Is Inviolable

The earnings floor formula is Founder-locked:

```
floor = (distance_miles × $1.10) + (duration_min × $0.22) + $2.50
```

No AI model — including fare-adjustment, driver-earnings, and pricing-service — may produce a driver take-home below this floor. The platform absorbs any supplement needed to meet the floor. Changes to the formula require a signed Founder JWT (`platformConfig` key: `earnings_floor_formula`).

**Enforcement:** The earnings floor check runs in `trips.service.ts` after all AI adjustments are applied. AI adjustments run first; the floor check is last and cannot be bypassed.

---

## Rule 3: Anti-Discrimination — Absolute Prohibition

The following characteristics must **never** appear as features, proxies, or derived signals in any BidiRide AI model:

| Prohibited Characteristic | Prohibited Proxies |
|---|---|
| Race / ethnicity | Neighborhood demographic data, zip code as primary feature |
| Gender / gender identity | Any gender-derived feature |
| National origin | Language preference as ranking signal |
| Religion | — |
| Disability | Accessibility feature usage as negative signal |
| Age | — (age of account is allowed; age of user is not) |
| Sexual orientation | — |
| Marital / family status | — |
| Source of income | Payment method type as negative signal |

**Enforcement:**
- Code review must check any new feature addition against this list.
- Before any SageMaker model promotion, a disparate impact analysis is required.
- If a deployed model is found to correlate outputs with a protected characteristic (even via proxy), it must be rolled back immediately, regardless of business impact.

### Rule 3a (v1.1): Trust Scores Are Prohibited Pricing Features

Rider and driver trust scores must **never** be used as fare or pricing
features — not in fare recommendations, not in pricing model training data,
not in pricing audit payloads. A trust score is a behavioral-integrity metric;
letting it move prices is identity-based pricing and is prohibited under this
rule regardless of predictive value.

**Enforcement (implemented, AI Core Phase 2):**
- `pickAllowedPricingFeatures()` in `pricing-service/fare-engine.service.ts` is
  a **code-level allowlist**: only named attributes may enter the AI fare hook
  request or the `ai_pricing_logs.inputFeatures` audit payload. Unknown or
  prohibited attributes are dropped, so nothing can be silently added upstream.
- `trip-service` does not read or transmit trust scores when requesting a quote.
- `ai-service` `buildFareFeatures()` accepts no trust-score input and emits none
  into inference logs.
- Regression tests assert that changing a trust score cannot change a quoted
  fare, and that smuggled trust attributes never reach audit or the AI hook.

`riderTotalTrips` (a plain trip count) remains an allowed loyalty signal; it is
not a trust attribute. The bid **win-probability** model (which predicts driver
acceptance, not price) retains its existing trust inputs — that model's output
never sets a fare, and its inputs are governed by Rule 4's exposure limits.

---

## Rule 4: Trust Scores Are Internal — Never Expose to Users

Trust scores (0–1000) and fraud probability (0–100) are internal metrics. They must never be:

- Shown to the user whose score they represent
- Shown to the counterparty in a transaction (e.g., drivers must not see rider trust scores; riders must not see driver trust scores)
- Mentioned in push notifications
- Included in any API response that reaches a mobile app

The four visible badge labels (Verified, Trusted, Business, VIP) are the only trust-level information exposed externally. These badges are computed from trust scores but do not reveal the underlying number.

**Exception:** Admins with `FRAUD_ADMIN` or `SUPER_ADMIN` role may view trust scores and fraud probability in the admin portal.

---

## Rule 5: Fraud Auto-Hold — Human Review Required

When `fraudProbability ≥ 90`, the system may automatically place a payment hold on the account. This is the only automated action permitted.

The following actions require human admin review and approval:

- Permanent account ban
- Suspension lasting more than 72 hours
- Reversal of a fraud hold
- FCRA adverse action letter issuance

No AI model may trigger a permanent ban. The `FRAUD_ADMIN` role is the minimum required for permanent action; `SUPER_ADMIN` is required for lifetime bans.

---

## Rule 6: Panic Events Are Inaccessible to AI

Panic events (triple-tap, single vibration, no visual change) are safety signals. They must never:

- Appear in any model's feature vector
- Appear in `ai_inference_logs`
- Be used to compute a trust score modification
- Be used as a fraud signal

The panic mechanism is specifically designed to be invisible to the app's UI layer. It must also be invisible to the AI pipeline.

**Why:** A rider who triggers a panic event due to genuine threat must not have their account flagged. The privacy of the panic trigger is itself a safety property — if a threatening driver could identify that a rider triggered panic, it would endanger the rider.

---

## Rule 7: Driver Ranking Must Not Be Disclosed

Driver ranking scores and the factors used to rank a driver for a specific trip must never be:

- Shown to the ranked driver
- Communicated to the rider as anything other than "we're finding you the best driver"
- Used to explain why a driver did or did not receive a trip request

Rationale: If drivers know the ranking formula, they can game it. Undisclosed ranking is also legally cleaner in jurisdictions that regulate algorithmic transparency for gig workers (pending legal review).

**Exception:** Aggregate, anonymized signal weights (the WEIGHTS constant: eta=25, trust=12, etc.) may be disclosed publicly as general information about how the platform works, without per-driver scores.

---

## Rule 8: Airport Surge Cap Is Hard-Coded

Maximum surge multiplier at EWR: **2.5×**.  
Admin confirmation required above **1.5×**.

These limits are enforced in `airport-service` and must not be overridden by any AI model, including `surge-forecast`. The AI model's `forecastedMultiplier` output is advisory; the hard cap is applied at the service layer.

---

## Rule 9: AI Must Never Cause a Payment Action Directly

AI models are advisory. They may output a probability, a score, or a recommendation. They must never:

- Directly trigger a Stripe charge, refund, or payout
- Directly create or delete a payment hold
- Directly modify a driver's wallet balance

AI outputs are consumed by `trust-service` and `trip-service`, which contain the business logic for what action to take. The AI service has no Stripe credentials and no direct database write access to payment tables.

---

## Rule 10: No Generative AI in User-Facing Flows

Generative AI (LLMs, image generation, etc.) must not be used in any user-facing feature without explicit Founder approval and a separate safety review. This includes:

- Driver or rider chat
- Push notification copy
- Fare explanations or bid explanations
- Support auto-responses

The current AI pipeline is predictive (classification, regression). Generative AI introduces different risks (hallucination, prompt injection, content policy) that require separate governance.

---

## Rule 11: Shadow Mode Is Mandatory (v1.1)

Every AI decision family runs in **shadow mode by default**: the service always
computes and logs its real recommendation, but **serves the exact neutral value
the caller's own fallback would produce** (fare adjustment `0`, driver ranking
in input order with score `50`, win probability `0.5`). Production behavior can
never change because of the AI while shadowed.

- Global switch: `platform_config.ai_shadow_mode` — **defaults TRUE**.
- Per-family switches: `ai_fare_enabled`, `ai_ranking_enabled`,
  `ai_win_probability_enabled` — **default FALSE**.
- A family is live **only when** `ai_shadow_mode` is false **and** its family
  switch is true. Any config-read failure forces shadow (fail safe).
- Shadow recommendations are **non-authoritative by construction**: responses
  carry `shadow: true` and the real value only under `shadowRecommendation`.
- **Live activation requires separate, explicit Founder approval** — flipping
  either switch is a Founder-only decision (see activation procedure below).

---

## Rule 12: Internal Authentication Is Required (v1.1)

The ai-service is internal-only. Every inference, marketplace, data-quality,
and feature-store endpoint requires the `x-internal-key` header validated
against `INTERNAL_SERVICE_KEY`. **Production fails closed**: the service
refuses to start without the key, and the guard rejects all requests if the
key is somehow absent at runtime. Development/test may run keyless with a loud
startup warning. Only the read-only `GET /ai/health` probe is public (load
balancers).

---

## AI Core Phase 2 Operational Governance (v1.1)

### Allowed pricing features (the complete allowlist)

`distanceMiles`, `durationMin`, `surgeZoneScore`, `surgeMultiplier`,
`isAirport`/`isAirportTrip`, `isNight`, `hourOfDay`, `dayOfWeek`,
`riderTotalTrips`, `pickupZone`, `dropoffZone`, `vehicleClass`.

Adding an attribute to this list requires Eng Lead approval **and** a Rule 3
anti-discrimination check; trust scores and identity attributes can never be
added (Rule 3a).

### Prohibited pricing features

Trust scores (rider or driver), user/rider/driver identifiers, names, phone
numbers, emails, payment details, device fingerprints, raw GPS coordinates
(zone keys are the finest allowed location granularity), and every Rule 3
protected characteristic or proxy.

### Kill-switch behavior

- `ai_shadow_mode = true` (or unreadable config): every family serves neutral
  fallback values immediately; recommendations continue to be computed and
  logged for evaluation.
- Switches are read with a 30-second cache: a flip takes effect within 30s on
  every ai-service instance, no restart or deploy required.
- The callers' own timeouts and fallbacks (±$2 clamp + 3s timeout, 300ms
  ranking timeout, static 0.5 probability) remain in place *underneath* the
  kill switches — turning the ai-service off entirely is always safe.

### Feature-family activation procedure (requires Founder approval)

1. Founder reviews the family's shadow-mode evaluation report (logged
   recommendations vs. actual outcomes over an agreed window).
2. Founder approves activation of ONE named family in writing.
3. Set the family switch (e.g. `ai_fare_enabled = true`) — family still
   shadowed while `ai_shadow_mode` is true.
4. Set `ai_shadow_mode = false` during a monitored window.
5. Monitor the family's inference logs and business invariants (fare
   integrity, earnings floor) for the agreed soak period.

### Rollback procedure

Set `ai_shadow_mode = true` (single config write, effective ≤30s, no deploy).
For a single family, set its `ai_<family>_enabled = false` instead. If
platform_config itself is unreachable, the service already fails safe to
shadow. Full-service rollback: stop ai-service — every caller degrades to its
built-in fallback with zero customer impact (the marketplace runs correctly
with the AI Core offline).

### Data retention

- **Redis feature store** (`ai:feature:*`): every key written with a 180s TTL
  — bounded retention by construction; nothing accumulates.
- **`ai_pricing_logs`, `ai_inference_logs`, `bid_outcomes`**: TRAINING-class
  data, 1-year retention per the Event Catalog; never financial truth
  (`trips.finalFare` is canonical).
- **`data_quality_classified` trip events**: audit-class, retained with the
  trip record; superseded assessments are appended, never rewritten.

---

## Decision Authority Matrix

| Decision | Engineering | Eng Lead | Founder |
|---|---|---|---|
| Add optional feature to existing model | ✅ | — | — |
| Remove feature from model | — | ✅ | — |
| Add new model (shadow mode) | — | ✅ | — |
| Promote challenger → champion (rule → rule) | — | ✅ | — |
| Promote challenger → champion (rule → ML, first time) | — | — | ✅ |
| Change AI adjustment cap | — | — | ✅ |
| Change auto-hold threshold | — | — | ✅ |
| Change earnings floor formula | — | — | ✅ (signed JWT) |
| Retire a model version | — | ✅ | — |
| Deploy SageMaker endpoint | — | ✅ | — |
| Enable live A/B testing (split production traffic) | — | — | ✅ |
| Activate an AI family live (`ai_shadow_mode` / `ai_<family>_enabled`) | — | — | ✅ |
| Add new data source to feature pipeline | — | ✅ | — |
| Use protected characteristic as feature | — | — | **Prohibited** |
| Expose AI data to third parties | — | — | ✅ + Legal |

---

## Incident Response

### Severity 1 — Model producing actively harmful output

Definition: Model output is causing or about to cause financial harm, user distress, or safety risk.

Response:
1. Engineering lead immediately reverts champion to prior rule-based version.
2. Page on-call.
3. Notify Founder within 1 hour.
4. Post-mortem within 48 hours.
5. Model does not return to production until post-mortem is complete and Founder approves.

### Severity 2 — Model accuracy degraded but not harmful

Definition: Accuracy metrics have deteriorated below promotion thresholds; user experience degraded.

Response:
1. Engineering lead opens issue within 24 hours.
2. Investigate data drift, feature distribution shift.
3. Retrain or rollback within 7 days.
4. Founder notified if rollback required.

### Severity 3 — Shadow model anomaly

Definition: A challenger/shadow model is producing unexpected outputs (not served to users).

Response:
1. Engineering lead reviews within 48 hours.
2. Shadow deployment may be paused without Founder approval.

---

## Audit Trail Requirements

Every AI decision that affects a user-visible outcome must be traceable:

| Decision | Audit record |
|---|---|
| Fare shown to rider | `ai_inference_logs` row for `fare-adjustment` with `trip_id` |
| Win probability shown to rider | `ai_inference_logs` row for `bid-win-probability` with `trip_id` |
| Fraud hold placed | `fraud_alerts` row + `audit_logs` row |
| Auto-hold triggered | `fraud_alerts.auto_hold = true` + admin notification |
| Driver ranking order | `ai_inference_logs` rows for `driver-ranking` with `trip_id` |

Audit records are never deleted. Retention follows the `SAFETY` (3 years) or `TRAINING` (1 year) policy per the Event Catalog.
