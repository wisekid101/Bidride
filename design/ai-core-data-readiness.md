# BidiRide — AI Core Foundation: Data Readiness & Quality Governance v1.0

**Status:** Pending Founder Approval
**Author:** Engineering
**Date:** 2026-07-10
**Scope:** Data ownership, training-data quality classification, historical
contamination detection, and auditability rules that gate all AI Core learning
**Companions:** `ai-core-architecture.md` · `ai-data-dictionary.md` (v1.0) · `technical-debt-payments.md`

> Core premise: the AI Core learns only from data whose money semantics are
> proven. The Offer Fare Integrity Hotfix (`e225720`) made fares canonical
> going forward — but every row written before it is presumed guilty until
> reconciled. **Historical data is not automatically trusted training data.**

---

## 1. Data Ownership & Source-of-Truth Rules

| Domain | Owner service | Authoritative store | Consumers | Rule |
|---|---|---|---|---|
| Trip money (fare, fee, earnings) | trip-service | `trips.finalFare` / `platformFee` / `driverEarnings` (post-`e225720`) | payments, apps, analytics, AI | `finalFare` is THE fare. On bid trips `aiFare` is reference-only. |
| Settlement | payment-service | Stripe (PaymentIntents) | reconciliation | Stripe is truth for what money actually moved; `payments` mirrors it. |
| Bookkeeping | payment-service | `payments` + `financial_ledger` | refunds, receipts, analytics, AI | one payments row per settled trip; ledger pairs keyed `charge:{tripId}` / `capture:{tripId}`. |
| Negotiation | trip-service | `bids` (riderOffer, counterOffer, status) + `bid_outcomes` | AI training | accepted amount must equal `trips.finalFare` — divergence = contamination signal. |
| Driver presence | auth-service gateway | `driver:{userId}:location` Redis, TTL ≤ `LOCATION_TTL_SECONDS` (180) | offer matching only | **ephemeral; never lands in training data directly** — only zone-level aggregates snapshot into features. |
| Driver eligibility | driver-service | `drivers.isAvailable`, `drivers.status`, vehicles | matching, AI features | Postgres always outranks any Redis hint or client-supplied heartbeat field. |
| Sessions | auth-service | `driver_session_logs` | utilization features | duration-only; no coordinates stored. |
| Zone demand/supply | pricing/gateway | `surge:requests:{zone}`, `surge:drivers:{zone}` | features (snapshotted) | 10-min rolling; snapshots carry `computed_at`. |
| AI inference audit | ai-service (Phase 2) | `ai_inference_logs` (+ `ai_pricing_logs` projection) | monitoring, model eval | append-only; every served request writes one row. |
| Config & rules | admin-service | `platform_config` | all | earnings-floor changes Founder-JWT-gated (existing). |

---

## 2. Training-Data Quality Classification

Every trip-derived training row is stamped with exactly one class. The stamp is
computed by the reconciliation job (Phase 2) and stored alongside projections
(`quality_class` column; feature rows carry `quality_class_floor`).

| Class | Definition | Monetary targets (fares, earnings, savings, CLV) | Behavioral features (acceptance timing, decline counts, zones, waits) |
|---|---|---|---|
| **Trusted** | Written after `e225720` AND passes reconciliation: exactly one succeeded `payments` row; `payments.amount == trips.finalFare`; Stripe captured == payments.amount; bid trips: `finalFare == accepted riderOffer/counterOffer` | ✅ | ✅ |
| **Reconciled** | Pre-hotfix row repaired by a documented, deterministic correction (e.g., bid trip's true fare recomputed from `bids.riderOffer`; correction stored in `trip_events` as `data_reconciliation`) | ✅ (corrected values only) | ✅ |
| **Suspect** | Pre-hotfix offer completions not yet reconciled; rows with missing payments; double-charge-era rows; amounts that disagree across stores | ❌ never | ⚠️ allowed with `quality_class='suspect'` flag propagated to any model that consumed them |
| **Excluded** | `fare_integrity_error` trips; known test artifacts (alpha test accounts — see §3.4); contradictory Stripe state that cannot be deterministically repaired | ❌ | ❌ |

**Gates (hard rules for every Phase-2+ training pipeline):**
1. Monetary targets: Trusted + Reconciled only.
2. Behavioral features: Trusted + Reconciled + flagged-Suspect.
3. Excluded rows never enter any pipeline; they remain queryable for audit.
4. A model's registry entry records the class mix of its training window.
5. `customer savings` (aiFare − finalFare on bid trips) additionally requires
   the airport-detection era check (§3.3) because pre-geofence `aiFare` values
   may embed false airport premiums — savings computed against a contaminated
   reference exaggerate the discount.

---

## 3. Historical Contamination Detection

### 3.1 Detection queries (canonical definitions)

```sql
-- C1: bid trips whose completed fare does not equal the accepted negotiation
SELECT t.id, t.final_fare, b.rider_offer, b.counter_offer, b.status
FROM trips t JOIN bids b ON b.id = t.bid_id
WHERE t.status = 'completed'
  AND t.final_fare IS DISTINCT FROM COALESCE(b.final_fare, b.rider_offer);

-- C2: double-charge era — completed bid trips that ALSO have a charge-trip
--     payments row (bid trips must settle by capture only)
SELECT t.id, p.amount, p.stripe_payment_intent_id
FROM trips t JOIN payments p ON p.trip_id = t.id
WHERE t.bid_id IS NOT NULL AND t.status = 'completed'
  AND p.amount IS DISTINCT FROM t.final_fare;

-- C3: invisible settlements — completed bid trips with NO payments row
--     (hold captured on Stripe, never booked)
SELECT t.id, t.final_fare, t.completed_at
FROM trips t
WHERE t.bid_id IS NOT NULL AND t.status = 'completed'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.trip_id = t.id);

-- C4: any completed trip whose booked payment disagrees with canonical fare
SELECT t.id, t.final_fare, p.amount
FROM trips t JOIN payments p ON p.trip_id = t.id
WHERE t.status = 'completed' AND p.status = 'succeeded'
  AND ABS(p.amount - t.final_fare) > 0.005;

-- C5: fare-integrity-frozen trips (always Excluded)
SELECT DISTINCT trip_id FROM trip_events WHERE event_type = 'fare_integrity_error';
```

### 3.2 Live analysis results (2026-07-10 database)

Executed against the alpha database (25 completed trips; all data is test
data — the classifications below validate the *process* that will govern
production data from day one).

| Query | Hits | Rows | Disposition |
|---|---|---|---|
| C1 fare ≠ accepted offer | 2 | `fe575dc2` (2026-07-04: accepted $14.00, charged $18.31 — a previously unknown pre-hotfix victim) · `7bc3853d` (2026-07-10: accepted $20.16, charged $24.66 — the documented double charge) | **Excluded** |
| C2 double-charge era | 1 | `7bc3853d` (Stripe hold captured $20.16 unbooked + fresh $24.66 charge) | **Excluded** (already via C1) |
| C3 invisible settlements | 1 | `fe575dc2` (bid trip, no payments row — capture never booked) | **Excluded** (already via C1) |
| C4 payment ≠ canonical | 3 | three early standard trips ($7.20, $8.21, $5.00) with **no payments row at all** (payment service down or path predating charge wiring) | **Suspect** — behavioral features only |
| C5 integrity-frozen trips | 2 events / 2 trips | `fare_integrity_error` events on `eaa49cc2` + `cfa9a6e5` are **deliberate guard-verification tests** from the hotfix live proof, not organic failures; the trips' own money chains are fully reconciled | Trips stay **Trusted**; the *events* are flagged test artifacts (see §3.4) |

**Resulting classification of all 25 completed trips:** 2 Excluded · 3 Suspect
· 20 Trusted (4 post-hotfix rides fully reconciled to Stripe live; 16
pre-hotfix standard rides passing `payments.amount == finalFare`
reconciliation — the standard path was always canonical).

**Audit-infrastructure gaps found during this analysis (must close before any
learning pipeline consumes these tables):**

1. `ai_pricing_logs` — **0 rows, no writers anywhere in the codebase.** The
   pricing audit table exists but `FareEngineService.estimateFare` never
   writes it: every fare quote served to date is unaudited. Wiring this is a
   Phase 2 prerequisite, not an enhancement.
2. `bid_outcomes` — **1 row vs 4 completed bid trips.** `recordBidOutcome`
   is fire-and-forget and is silently under-delivering the AI Core's primary
   outcome table. Root-cause and backfill before training on it.
3. `bid_outcomes.finalFare` inherits trip contamination — join through
   `trip_id` and apply the same C1/C2 classes.

### 3.3 Airport-premium era boundary

`aiFare` values quoted before the coordinate-first airport detection
(`6954f44`) may include a false +$3.50 premium on street addresses matching
'Terminal X' substrings. For savings/fare-reference features, rows older than
that commit are at best **Suspect** unless the geofence re-evaluation
(recompute `isAirportTrip` from stored coordinates) confirms the premium was
legitimate — a deterministic, automatable reconciliation.

### 3.4 Test-artifact exclusion

The alpha environment's seeded and test accounts (documented in the alpha test
environment runbook) generate rides that are mechanically valid but
economically meaningless (GPS teleports, $0-distance completions, repeated
identical routes). Exclusion rule: rides by the designated test rider/driver
accounts are class **Excluded** for all training purposes. Production launch
must define the allowlist/denylist in `platform_config`
(`ai_training_excluded_accounts`).

---

## 4. Auditability Chain & Retention

```
recommendation served
  └─ ai_inference_logs.id  (model, version, features, output, confidence,
       │                    fallbackUsed, latencyMs, tripId/userId)
       └─ trips / bids (what the platform did after the rules applied)
            └─ payments + financial_ledger (what money moved — canonical)
                 └─ bid_outcomes (what the marketplace did: accepted?,
                      time-to-accept, drivers viewed/declined/countered,
                      predictionProbability vs reality)
```

- Any fare, match, or forecast is reconstructible end-to-end from durable rows.
- **Retention:** `ai_inference_logs` / `ai_pricing_logs` / `bid_outcomes` /
  `trip_events` — durable (compliance-grade, same policy as audit_logs).
  Driver location — ≤180s TTL, never persisted into training data (privacy
  rule from the reliability milestone). Feature snapshots — 24 months.
  Excluded-class rows are retained (audit) but firewalled from pipelines.

---

## 5. Phase 2 Readiness Checklist & Non-Goals

**Ready when all true:**
- [ ] Founder approves both Phase 1 documents.
- [ ] Contamination results (§3.2) reviewed; per-class dispositions accepted.
- [ ] Reconciliation job design approved (C1/C3 repairs + `data_reconciliation` trip_events).
- [ ] `quality_class` stamping design approved (projection-side column, no schema change to product tables).
- [ ] v1.1 revisions of the 2026-07-02 AI suite docs merged (canonical fare, heartbeat, geofence updates).
- [ ] INTERNAL_SERVICE_KEY validation pattern agreed (ai-service will not launch without it).

**Phase 1 explicit non-goals:** no autonomous pricing; no autonomous dispatch;
no production model training; no ai-service deployment; no schema migrations;
no dashboard implementation.
