# BidiRide — AI Event Catalog v1.0

**Status:** Pending Founder Approval  
**Author:** Engineering  
**Date:** 2026-07-02  
**Scope:** Every event that feeds the BidiRide AI learning pipeline

This document is the single source of truth for AI learning events. No new event may be emitted to the AI pipeline, and no existing event payload may be extended, without an update to this catalog and Founder approval.

---

## Privacy Classification Reference

| Class | Label | Definition |
|---|---|---|
| CLASS-1 | INTERNAL | Internal UUIDs and derived metrics only. No user-identifiable data. Safe for AI training. |
| CLASS-2 | PSEUDONYMOUS | Contains internal user IDs (UUID). Can be re-linked to PII by authorized admin. Safe for AI training after pseudonymization check. |
| CLASS-3 | LOCATION | Contains precise coordinates (lat/lng). Pseudonymous but location-sensitive. Requires zone-bucketing before ML training; raw coordinates must not leave the system. |
| CLASS-4 | SENSITIVE | Safety signals, fraud signals, or financial signals. Restricted read access. AI consumption requires explicit approval per model. |
| CLASS-5 | PROHIBITED\_AI | **Must never appear as AI training features.** Includes SOS context, panic signals, PII fields (name, phone, email), and raw card data. |

**Rule:** Any event that carries a CLASS-5 field must strip those fields before writing to AI storage. The remaining fields may be CLASS-1 through CLASS-4.

---

## Retention Policy Reference

| Policy | Duration | Applies To |
|---|---|---|
| EPHEMERAL | In-memory / Redis TTL only | Real-time signals (location pings, surge counters) |
| OPERATIONAL | 90 days | Session logs, app-open events, queue events |
| TRAINING | 1 year (rolling) | All ML training data — bid outcomes, inference logs, pricing logs |
| FINANCIAL | 3 years | Payment events, earnings records |
| SAFETY | 3 years minimum (legal hold possible) | SOS, panic, fraud alerts, route deviations |

---

## Implementation Status Key

| Symbol | Meaning |
|---|---|
| ✅ | Fully implemented — event fires, all required fields stored |
| ⚠️ | Partially implemented — event fires but payload is incomplete (see Bug reference) |
| 🔲 | Not yet implemented — defined here, approved for future build |

---

## Event Catalog

---

### 1. TRIP\_REQUESTED

**Status:** ✅ Implemented  
**Category:** Trip Lifecycle

| Field | Value |
|---|---|
| **Emitting service** | `trip-service` |
| **Trigger** | `POST /trips` (standard fare) or `POST /bids` (bid mode) — `createTrip()` / `createBid()` |
| **Privacy class** | CLASS-2 (PSEUDONYMOUS) |
| **Required** | YES |

**Payload schema:**

```json
{
  "tripId": "uuid",
  "riderId": "uuid",
  "pickupLat": "decimal(9,6)",
  "pickupLng": "decimal(9,6)",
  "dropoffLat": "decimal(9,6)",
  "dropoffLng": "decimal(9,6)",
  "distanceMiles": "float",
  "durationMin": "int",
  "rideType": "standard | priority | premium",
  "aiFare": "decimal(8,2)",
  "isAirportTrip": "boolean",
  "isNightRide": "boolean",
  "hourOfDay": "int (0–23)",
  "dayOfWeek": "int (0–6)",
  "surgeZoneScore": "float (0.0–1.0)",
  "riderTrustScore": "int (0–1000)",
  "riderTotalTrips": "int",
  "createdAt": "ISO 8601"
}
```

**Storage:**
- `trips` table (primary record)
- `ai_inference_logs` (via fare-adjustment call in pricing-service)
- `ai_pricing_logs` (intended — currently NOT written; see Bug in planning report)

**AI models that consume it:**
- `fare-adjustment` — feature input (distanceMiles, durationMin, surgeZoneScore, isAirport, isNight, hourOfDay, dayOfWeek, riderTrustScore, riderTotalTrips)
- `surge-forecast` — supply/demand signal at pickup zone
- `bid-win-probability` — used indirectly via aiFare as the reference fare

**Retention:** TRAINING (1 year)

---

### 2. TRIP\_ACCEPTED

**Status:** ⚠️ Partial — `driversViewed` / `driversDeclined` fields always 0 (Bug 5)  
**Category:** Trip Lifecycle

| Field | Value |
|---|---|
| **Emitting service** | `trip-service` |
| **Trigger** | `PATCH /bids/:id/accept` → `driverAcceptBid()` |
| **Privacy class** | CLASS-2 (PSEUDONYMOUS) |
| **Required** | YES |

**Payload schema:**

```json
{
  "tripId": "uuid",
  "bidId": "uuid",
  "driverId": "uuid",
  "riderId": "uuid",
  "zoneKey": "string (lat_bucket:lng_bucket)",
  "finalFare": "decimal(10,2)",
  "finalAcceptedAmount": "decimal(10,2)",
  "driverEarnings": "decimal(10,2)",
  "platformFee": "decimal(10,2)",
  "timeToAcceptanceMs": "int",
  "driversViewed": "int",
  "driversDeclined": "int",
  "driversCountered": "int",
  "driversIgnored": "int",
  "predictionProbability": "decimal(5,4) | null",
  "predictionConfidence": "decimal(5,4) | null",
  "predictionCorrect": "boolean | null",
  "modelVersion": "string | null"
}
```

**Storage:**
- `bid_outcomes` table (`wasAccepted: true`)

**AI models that consume it:**
- `bid-win-probability` — ground truth label (wasAccepted = true) for calibration and accuracy metrics
- `driver-ranking` — positive signal: this driver accepted, others declined
- `dispatch-simulator` — strategy validation: which dispatch phase succeeded

**Retention:** TRAINING (1 year)

---

### 3. TRIP\_REJECTED

**Status:** 🔲 Not Implemented — rejected bids generate no `bid_outcomes` row today (Bug 4)  
**Category:** Trip Lifecycle

| Field | Value |
|---|---|
| **Emitting service** | `trip-service` |
| **Trigger** | `PATCH /bids/:id/decline` → `driverDeclineBid()` |
| **Privacy class** | CLASS-2 (PSEUDONYMOUS) |
| **Required** | YES |

**Payload schema:**

```json
{
  "tripId": "uuid",
  "bidId": "uuid",
  "driverId": "uuid",
  "zoneKey": "string",
  "wasAccepted": false,
  "driversDeclined": 1,
  "createdAt": "ISO 8601"
}
```

**Storage:**
- `bid_outcomes` table (`wasAccepted: false`) — NOT currently written

**AI models that consume it:**
- `bid-win-probability` — ground truth label (wasAccepted = false); without this, the model only sees successes and is severely biased
- `driver-ranking` — negative signal: this driver rejected this trip type/fare
- `dispatch-simulator` — strategy failure signal

**Retention:** TRAINING (1 year)

**Note:** This is the most critical missing event. Training data without rejections will produce a model that overestimates win probability for every bid.

---

### 4. TRIP\_COUNTERED

**Status:** ⚠️ Partial — counter action is stored in `bids` table but no dedicated AI learning row  
**Category:** Trip Lifecycle

| Field | Value |
|---|---|
| **Emitting service** | `trip-service` |
| **Trigger** | `POST /bids/:id/counter` → `driverCounterBid()` |
| **Privacy class** | CLASS-2 (PSEUDONYMOUS) |
| **Required** | YES |

**Payload schema:**

```json
{
  "tripId": "uuid",
  "bidId": "uuid",
  "driverId": "uuid",
  "riderOffer": "decimal(10,2)",
  "counterAmount": "decimal(10,2)",
  "counterRatio": "float (counterAmount / aiFare)",
  "zoneKey": "string",
  "expiresAt": "ISO 8601",
  "createdAt": "ISO 8601"
}
```

**Storage:**
- `bids` table (`status: countered`, `counterAmount`)
- Future: `bid_outcomes` should receive a row when the counter expires or is acted on

**AI models that consume it:**
- `bid-win-probability` — counter behavior (driversCountered field in bid_outcomes)
- `driver-ranking` — signals driver pricing preferences and negotiation style

**Retention:** TRAINING (1 year)

---

### 5. TRIP\_CANCELLED

**Status:** ⚠️ Partial — trips table updated, but no `bid_outcomes` row for in-progress-bid cancellations (Bug 4)  
**Category:** Trip Lifecycle

| Field | Value |
|---|---|
| **Emitting service** | `trip-service` |
| **Trigger** | `PATCH /trips/:id/cancel` → `cancelTrip()` |
| **Privacy class** | CLASS-2 (PSEUDONYMOUS) |
| **Required** | YES |

**Payload schema:**

```json
{
  "tripId": "uuid",
  "cancelledBy": "rider | driver",
  "tripStatusAtCancel": "searching | accepted | driver_en_route | driver_arrived",
  "driverId": "uuid | null",
  "riderId": "uuid",
  "zoneKey": "string",
  "cancelReason": "string | null",
  "cancelledAt": "ISO 8601"
}
```

**Storage:**
- `trips` table (`cancelledAt`, `cancelReason`, `status: cancelled`)
- `bid_outcomes` (`wasAccepted: false`) — only if a bid was active at time of cancel (NOT currently written)

**AI models that consume it:**
- `fraud-score` — cancellation pattern; high cancellation rate is a fraud/abuse signal
- `driver-ranking` — negative signal for the cancelling driver
- `bid-win-probability` — if cancelled during bid phase, counts as rejected outcome

**Retention:** TRAINING (1 year)

---

### 6. TRIP\_STARTED

**Status:** ✅ Implemented  
**Category:** Trip Lifecycle

| Field | Value |
|---|---|
| **Emitting service** | `trip-service` |
| **Trigger** | `PATCH /trips/:id/start` → `startTrip()` |
| **Privacy class** | CLASS-2 (PSEUDONYMOUS) |
| **Required** | YES |

**Payload schema:**

```json
{
  "tripId": "uuid",
  "driverId": "uuid",
  "riderId": "uuid",
  "startedAt": "ISO 8601",
  "pickupLat": "decimal(9,6)",
  "pickupLng": "decimal(9,6)",
  "actualWaitSeconds": "int",
  "zoneKey": "string"
}
```

**Storage:**
- `trips` table (`startedAt`, `status: in_progress`)
- `trip_events` (`eventType: trip_started`)

**AI models that consume it:**
- `surge-forecast` — a started trip reduces available supply signal
- `driver-ranking` — pickup wait time feeds driver responsiveness metrics

**Retention:** TRAINING (1 year)

---

### 7. TRIP\_COMPLETED

**Status:** ✅ Implemented  
**Category:** Trip Lifecycle

| Field | Value |
|---|---|
| **Emitting service** | `trip-service` |
| **Trigger** | `PATCH /trips/:id/end` → `endTrip()` |
| **Privacy class** | CLASS-2 (PSEUDONYMOUS) |
| **Required** | YES |

**Payload schema:**

```json
{
  "tripId": "uuid",
  "driverId": "uuid",
  "riderId": "uuid",
  "zoneKey": "string",
  "finalFare": "decimal(8,2)",
  "driverEarnings": "decimal(8,2)",
  "platformFee": "decimal(8,2)",
  "earningsFloorMet": "boolean",
  "earningsSupplement": "decimal(8,2)",
  "actualDistanceMiles": "decimal(6,2) | null",
  "actualDurationMin": "int | null",
  "routeDeviationCount": "int",
  "pickupWaitSeconds": "int",
  "timeToAcceptanceMs": "int | null",
  "completedAt": "ISO 8601"
}
```

**Storage:**
- `trips` table (`completedAt`, `finalFare`, `driverEarnings`, etc.)
- `bid_outcomes` (via `recordBidOutcome()` — `wasAccepted: true`)
- `earnings_floor_logs` (if floor was triggered)

**AI models that consume it:**
- `bid-win-probability` — outcome label (accepted = true, final fare recorded)
- `fare-adjustment` — model outcome: did the fare get accepted without counter?
- `driver-ranking` — completion confirms driver reliability
- `earnings-optimizer` — historical data point for zone + time earnings estimation

**Retention:** TRAINING (1 year); financial fields FINANCIAL (3 years)

---

### 8. PAYMENT\_CAPTURED

**Status:** ✅ Implemented  
**Category:** Payment

| Field | Value |
|---|---|
| **Emitting service** | `payment-service` |
| **Trigger** | Stripe charge succeeds in `captureAuthorizationHold()` or `chargeTripByDefault()` |
| **Privacy class** | CLASS-4 (SENSITIVE) — financial; no card data in payload |
| **Required** | YES |

**Payload schema:**

```json
{
  "tripId": "uuid",
  "riderId": "uuid",
  "amount": "decimal(10,2)",
  "currency": "usd",
  "paymentMethodType": "card | apple_pay | google_pay",
  "stripePaymentIntentId": "string",
  "capturedAt": "ISO 8601"
}
```

**Fields explicitly excluded from AI payloads:**
- Card last 4 digits — CLASS-5 PROHIBITED\_AI
- Stripe customer ID — CLASS-5 PROHIBITED\_AI
- Billing address — CLASS-5 PROHIBITED\_AI

**Storage:**
- `payments` table (`status: succeeded`)

**AI models that consume it:**
- `fraud-score` — payment success is a trust-building signal (reduces fraudProbability)
- `trust-service` — triggers trust score recalculation

**Retention:** FINANCIAL (3 years)

---

### 9. PAYMENT\_FAILED

**Status:** ✅ Implemented  
**Category:** Payment

| Field | Value |
|---|---|
| **Emitting service** | `payment-service` |
| **Trigger** | Stripe error in charge path; `chargeTrip()` throws |
| **Privacy class** | CLASS-4 (SENSITIVE) — financial + fraud signal |
| **Required** | YES |

**Payload schema:**

```json
{
  "tripId": "uuid",
  "riderId": "uuid",
  "amount": "decimal(10,2)",
  "stripeDeclineCode": "string (e.g. insufficient_funds, card_declined)",
  "failureCategory": "card_error | authentication_required | fraud_block | network_error",
  "attemptNumber": "int",
  "failedAt": "ISO 8601"
}
```

**Fields explicitly excluded from AI payloads:**
- Raw Stripe error message (may contain PII) — CLASS-5 PROHIBITED\_AI
- Card details — CLASS-5 PROHIBITED\_AI

**Storage:**
- `payments` table (`status: failed`)
- `fraud_alerts` (if repeated failures meet threshold)

**AI models that consume it:**
- `fraud-score` — repeated payment failures are a high-weight fraud signal
- `trust-service` — negative trust signal; triggers recalculation

**Retention:** FINANCIAL (3 years)

---

### 10. DRIVER\_ONLINE

**Status:** ✅ Implemented  
**Category:** Driver Session

| Field | Value |
|---|---|
| **Emitting service** | `auth-service` WebSocket gateway or `driver-service` |
| **Trigger** | Driver sets `isAvailable: true`; WebSocket connect with role=driver |
| **Privacy class** | CLASS-3 (LOCATION) — zone-bucketed lat/lng |
| **Required** | YES |

**Payload schema:**

```json
{
  "driverId": "uuid",
  "zoneKey": "string (lat_bucket:lng_bucket)",
  "lat": "decimal(9,6)",
  "lng": "decimal(9,6)",
  "sessionId": "uuid",
  "vehicleType": "standard | priority | premium",
  "hourOfDay": "int",
  "dayOfWeek": "int",
  "startedAt": "ISO 8601"
}
```

**AI payload restriction:** Raw `lat`/`lng` are CLASS-3. AI models receive `zoneKey` only; coordinates are used for zone assignment then discarded from training features.

**Storage:**
- `driver_session_logs` (`startedAt`, `driverUserId`)
- Redis `surge:drivers:{zoneKey}` SADD (ephemeral — 24h TTL)
- Redis `driver:{userId}:session_start` (for hours-online computation)

**AI models that consume it:**
- `surge-forecast` — supply signal at zone
- `demand-forecast` — supply-side availability
- `driver-ranking` — session start is used to compute hoursOnline
- `earnings-optimizer` — session context for break recommendations

**Retention:** OPERATIONAL (90 days for session logs); EPHEMERAL for Redis

---

### 11. DRIVER\_OFFLINE

**Status:** ✅ Implemented (session end recorded)  
**Category:** Driver Session

| Field | Value |
|---|---|
| **Emitting service** | `auth-service` WebSocket gateway (disconnect handler) or `driver-service` |
| **Trigger** | Driver sets `isAvailable: false`; WebSocket disconnect |
| **Privacy class** | CLASS-2 (PSEUDONYMOUS) |
| **Required** | YES |

**Payload schema:**

```json
{
  "driverId": "uuid",
  "sessionId": "uuid",
  "zoneKey": "string",
  "sessionDurationSec": "int",
  "tripsCompletedThisSession": "int",
  "earningsThisSession": "decimal(8,2)",
  "endedAt": "ISO 8601"
}
```

**Storage:**
- `driver_session_logs` (`endedAt`, `durationSec`)
- Redis SREM from `surge:drivers:{zoneKey}`

**AI models that consume it:**
- `surge-forecast` — supply drop signal at zone
- `earnings-optimizer` — session summary for future trip-count and earnings modeling
- `driver-ranking` — session productivity metrics

**Retention:** OPERATIONAL (90 days)

---

### 12. DRIVER\_LOCATION\_UPDATE

**Status:** ✅ Implemented (real-time Redis only)  
**Category:** Driver Session

| Field | Value |
|---|---|
| **Emitting service** | `auth-service` WebSocket gateway |
| **Trigger** | Driver app sends GPS ping (every ~10s while online) |
| **Privacy class** | CLASS-3 (LOCATION) — real-time precise location |
| **Required** | YES |

**Payload schema:**

```json
{
  "driverId": "uuid",
  "lat": "decimal(9,6)",
  "lng": "decimal(9,6)",
  "accuracy": "float (meters)",
  "bearing": "float (degrees) | null",
  "speed": "float (mph) | null",
  "tripId": "uuid | null",
  "timestamp": "ISO 8601"
}
```

**AI payload restriction:** Raw coordinates are CLASS-3. Only `zoneKey` (derived from lat/lng) reaches AI models. Raw lat/lng is **never persisted to any DB table** — it exists only in Redis for real-time routing and is overwritten on the next ping.

**Storage:**
- Redis `driver:{userId}:location` (overwritten each ping; ~10s TTL)
- Redis `surge:drivers:{zoneKey}` (zone membership, updated on zone change)
- **No DB persistence** — by design, for driver privacy

**AI models that consume it:**
- `heatmap` — reads Redis zone data every 30s to compute supply density
- `repositioning` — reads adjacent zone supply/demand from Redis
- `earnings-optimizer` — reads current zone demand for recommendation

**Retention:** EPHEMERAL — Redis only, no DB

---

### 13. RIDER\_APP\_OPEN

**Status:** 🔲 Not Implemented — no dedicated logging today  
**Category:** App Session

| Field | Value |
|---|---|
| **Emitting service** | `rider-service` |
| **Trigger** | First authenticated API call on HomeScreen mount (e.g., fare estimate or `GET /riders/me`) |
| **Privacy class** | CLASS-2 (PSEUDONYMOUS) |
| **Required** | OPTIONAL |

**Payload schema:**

```json
{
  "riderId": "uuid",
  "zoneKey": "string | null",
  "hourOfDay": "int",
  "dayOfWeek": "int",
  "sessionId": "uuid",
  "openedAt": "ISO 8601"
}
```

**Fields explicitly excluded:**
- Precise lat/lng at app open — CLASS-3; zone-bucket only if location granted

**Storage:**
- Future: `rider_session_logs` table (not yet in schema) or `ai_inference_logs` with modelName `session-open`

**AI models that consume it:**
- `demand-forecast` — demand intent signal (app open suggests trip intent)
- `surge-forecast` — demand pressure at zone

**Retention:** OPERATIONAL (90 days)

**Note:** Do not implement until schema migration is approved. Aggregate only — individual open events should not be retained beyond 90 days.

---

### 14. DRIVER\_APP\_OPEN

**Status:** 🔲 Not Implemented  
**Category:** App Session

| Field | Value |
|---|---|
| **Emitting service** | `driver-service` |
| **Trigger** | First authenticated API call on driver HomeScreen mount |
| **Privacy class** | CLASS-2 (PSEUDONYMOUS) |
| **Required** | OPTIONAL |

**Payload schema:**

```json
{
  "driverId": "uuid",
  "zoneKey": "string | null",
  "hourOfDay": "int",
  "dayOfWeek": "int",
  "sessionId": "uuid",
  "openedAt": "ISO 8601"
}
```

**Storage:**
- Future: `driver_session_logs` (add `openedAt` column) or separate `driver_app_sessions` table

**AI models that consume it:**
- `supply-forecast` — driver availability intent (app open = likely to go online soon)
- `earnings-optimizer` — session start context for shift recommendations

**Retention:** OPERATIONAL (90 days)

**Note:** Do not implement until schema migration is approved.

---

### 15. SOS\_TRIGGERED

**Status:** ✅ Implemented (safety pipeline only)  
**Category:** Safety

| Field | Value |
|---|---|
| **Emitting service** | `safety-service` |
| **Trigger** | SOS confirmation after 5-second countdown in SosScreen |
| **Privacy class** | CLASS-4 (SENSITIVE) + CLASS-5 (PROHIBITED\_AI) |
| **Required** | YES — for safety pipeline; PROHIBITED for AI learning pipeline |

**Payload schema (safety pipeline only):**

```json
{
  "sessionId": "uuid",
  "tripId": "uuid",
  "initiatedBy": "rider | driver",
  "safetyState": "sos_active",
  "lat": "decimal(9,6)",
  "lng": "decimal(9,6)",
  "timestamp": "ISO 8601"
}
```

**Storage:**
- `sos_events` table
- `safety_sessions` table (state transition)

**AI models that consume it:** **NONE — AI consumption is PROHIBITED.**

**Prohibition rationale:**
1. SOS events cannot be used as fraud signals. A rider who triggers SOS due to a genuine threat must not have that event counted against their trust score.
2. The geographic location of an SOS event is safety-critical; exposing it in training data or model features would create re-identification risk.
3. SOS data is subject to legal hold requirements and cannot be freely processed.

**Retention:** SAFETY (3 years minimum; legal hold possible)

---

### 16. ROUTE\_DEVIATION

**Status:** ✅ Implemented (count stored in trips table)  
**Category:** Safety / Fraud

| Field | Value |
|---|---|
| **Emitting service** | `trip-service` or `safety-service` |
| **Trigger** | In-trip GPS comparison shows significant deviation from expected route |
| **Privacy class** | CLASS-4 (SENSITIVE) — location deviation is both privacy and safety signal |
| **Required** | YES (when in-trip GPS tracking is active) |

**Payload schema:**

```json
{
  "tripId": "uuid",
  "driverId": "uuid",
  "deviationNumber": "int (1-indexed within trip)",
  "deviationMiles": "float",
  "expectedLat": "decimal(9,6)",
  "expectedLng": "decimal(9,6)",
  "actualLat": "decimal(9,6)",
  "actualLng": "decimal(9,6)",
  "durationOffRouteSeconds": "int | null",
  "timestamp": "ISO 8601"
}
```

**AI payload restriction:** Precise coordinates are CLASS-3/4. AI models receive `deviationMiles` and `durationOffRouteSeconds` only — not actual coordinates.

**Storage:**
- `trip_events` (`eventType: route_deviation`, `lat`, `lng`, `metadata: { deviationMiles, durationOffRouteSec }`)
- `trips.routeDeviationCount` (incremented)

**AI models that consume it:**
- `fraud-score` — multiple deviations on a trip are a strong detour-fraud signal
- Safety pipeline (non-AI): triggers soft\_alert escalation based on business rules

**Retention:** SAFETY (3 years)

---

### 17. FRAUD\_ALERT

**Status:** ✅ Implemented  
**Category:** Trust / Fraud

| Field | Value |
|---|---|
| **Emitting service** | `trust-service` |
| **Trigger** | `calculateTrustScore()` returns `fraudProbability ≥ 90%`; or manual admin flag |
| **Privacy class** | CLASS-4 (SENSITIVE) — fraud signals are regulatory-sensitive |
| **Required** | YES |

**Payload schema:**

```json
{
  "userId": "uuid",
  "userRole": "rider | driver",
  "fraudProbability": "decimal(5,2) (0–100)",
  "ruleScore": "int",
  "triggeredRules": ["string"],
  "autoHold": "boolean",
  "reviewedByAdmin": "boolean",
  "outcome": "hold | dismissed | banned | null (pending)",
  "createdAt": "ISO 8601"
}
```

**Fields explicitly excluded from AI payloads:**
- User name, phone, email — CLASS-5 PROHIBITED\_AI
- Raw device fingerprint strings — CLASS-5 PROHIBITED\_AI

**Storage:**
- `fraud_alerts` table

**AI models that consume it:**
- `fraud-score` — outcome feedback loop: alerts dismissed by admin are negative training signals; confirmed fraud is positive
- Future model retraining: alert outcomes (hold confirmed vs dismissed) are ground-truth labels

**Retention:** SAFETY (3 years)

---

### 18. AIRPORT\_QUEUE\_ENTERED

**Status:** ✅ Implemented  
**Category:** Airport Operations

| Field | Value |
|---|---|
| **Emitting service** | `airport-service` |
| **Trigger** | `POST /airport/queue/join` → driver joins EWR FIFO queue |
| **Privacy class** | CLASS-2 (PSEUDONYMOUS) |
| **Required** | YES |

**Payload schema:**

```json
{
  "driverId": "uuid",
  "queuePosition": "int",
  "queueLengthAtJoin": "int",
  "estimatedWaitMin": "int",
  "hourOfDay": "int",
  "dayOfWeek": "int",
  "flightId": "string | null",
  "flightEstimatedArrival": "ISO 8601 | null",
  "joinedAt": "ISO 8601"
}
```

**Storage:**
- `airport_queue_entries` (`joinedAt`, `queuePosition`, `status: waiting`)
- Redis `queue:ewr` sorted set (ZADD)

**AI models that consume it:**
- `earnings-optimizer` — EWR queue length at join time used to calibrate wait-time estimates and airport recommendations
- `demand-forecast` — queue join rate is an indicator of anticipated airport demand

**Retention:** OPERATIONAL (90 days)

---

### 19. AIRPORT\_QUEUE\_EXITED

**Status:** ✅ Implemented  
**Category:** Airport Operations

| Field | Value |
|---|---|
| **Emitting service** | `airport-service` |
| **Trigger** | Driver dispatched from queue (`status: dispatched`) or voluntarily exits (`status: left`) |
| **Privacy class** | CLASS-2 (PSEUDONYMOUS) |
| **Required** | YES |

**Payload schema:**

```json
{
  "driverId": "uuid",
  "exitReason": "dispatched | left | expired",
  "waitDurationSec": "int",
  "finalQueuePosition": "int",
  "queuePositionAtJoin": "int",
  "tripId": "uuid | null",
  "hourOfDay": "int",
  "dayOfWeek": "int",
  "exitedAt": "ISO 8601"
}
```

**Storage:**
- `airport_queue_entries` (`dispatchedAt` or `leftAt`, `status`, `tripId`)
- Redis `queue:ewr` sorted set (ZREM)

**AI models that consume it:**
- `earnings-optimizer` — actual wait duration vs estimated at join; calibrates EWR recommendations (if estimated 20 min but actual 45 min, deprioritize EWR suggestion in that hour)
- `supply-forecast` — driver becoming available/unavailable at EWR

**Retention:** OPERATIONAL (90 days)

---

## Supplemental Events

These events are not in the primary 19 but are actively collected and feed the AI pipeline.

---

### S1. BID\_EXPOSURE

**Status:** ✅ Implemented  
**Category:** Bid Pipeline

| Field | Value |
|---|---|
| **Emitting service** | `trip-service` (`dispatch.service.ts`) |
| **Trigger** | `broadcastBidRequest()` — written per driver who receives a bid broadcast |
| **Privacy class** | CLASS-2 (PSEUDONYMOUS) |
| **Required** | YES |

**Payload schema:**

```json
{
  "bidId": "uuid",
  "tripId": "uuid",
  "driverUserId": "uuid",
  "exposedAt": "ISO 8601"
}
```

**Storage:**
- `driver_bid_exposures` table

**AI models that consume it:**
- `bid-win-probability` — used to compute `driversViewed` in `BidOutcomeService` (currently Bug 5 — not yet queried)
- `driver-ranking` — which drivers were shown and did not accept

**Retention:** TRAINING (1 year)

---

### S2. RATING\_SUBMITTED

**Status:** ✅ Implemented  
**Category:** Quality Signal

| Field | Value |
|---|---|
| **Emitting service** | `trip-service` |
| **Trigger** | `POST /trips/:id/rate-driver` or `POST /trips/:id/rate-rider` |
| **Privacy class** | CLASS-2 (PSEUDONYMOUS) — rating comments may contain PII; strip before AI |
| **Required** | YES |

**Payload schema (AI-safe version):**

```json
{
  "tripId": "uuid",
  "ratedUserId": "uuid",
  "ratedRole": "driver | rider",
  "rating": "int (1–5)",
  "safetyFlagged": "boolean",
  "createdAt": "ISO 8601"
}
```

**Fields explicitly excluded from AI payloads:**
- `riderComment` / `driverComment` — may contain PII or slurs; CLASS-5 PROHIBITED\_AI unless NLP-scrubbed

**Storage:**
- `ratings` table

**AI models that consume it:**
- `driver-ranking` — driver rating is a direct input signal (avgRating field)
- `fraud-score` — low mutual ratings combined with other signals may be a fraud indicator

**Retention:** TRAINING (1 year)

---

## Prohibited AI Fields — Master List

The following fields must **never** appear in any `inputFeatures` payload sent to the AI service, any `ai_inference_logs` row, or any `bid_outcomes` row.

| Field | Source Table | Reason |
|---|---|---|
| `name` (any) | `users`, `riders`, `drivers` | PII |
| `phone` | `users` | PII |
| `email` | `users` | PII |
| `pushToken` | `riders`, `drivers` | Device identifier |
| `stripeCustomerId` | `riders` | Financial identifier |
| `defaultPaymentMethodId` | `riders` | Financial identifier |
| `cardLast4` | any | Payment card PII |
| `licenseNumber` | `drivers` (documents) | Government ID |
| `ssnLast4` | `drivers` | Government ID |
| `driverLicenseState` | `drivers` | PII |
| `birthDate` | `drivers` | PII |
| SOS event lat/lng | `sos_events` | Safety + location privacy |
| Panic event fields | `panic_events` | CLASS-5 by design |
| Audio recording path | `safety_recordings` | Safety + CLASS-5 |
| `cancelReason` (free text) | `trips` | May contain PII |
| `riderComment`, `driverComment` | `ratings` | May contain PII |

---

## Change Process

1. Any new AI learning event requires a catalog entry before the first line of implementation code is written.
2. Any change to a payload schema (adding or removing fields) requires catalog update + re-approval.
3. Privacy class upgrades (e.g., CLASS-1 → CLASS-3) require Founder approval.
4. Retention policy changes require Founder approval.
5. Adding a new AI model as a consumer of an existing event requires catalog update.

**Approval authority:** Founder (Markie Brown) for all catalog changes.
