# BidiRide — Technical Architecture v1.0 · Part 4: AI Architecture

**Status:** Draft — Pending Founder Approval
**Document:** 08-D · Part 4 of 5

---

## AI System Overview

BidiRide operates five AI engines, each with a distinct purpose and data boundary:

| Engine | Purpose | Hosting | Latency Target |
|---|---|---|---|
| **Fare Pricing Engine** | Calculate AI fare for every trip request | SageMaker endpoint | < 200ms |
| **Earnings Floor AI** | Enforce driver earnings floor, calculate supplement | Pricing Service (in-process) | < 50ms |
| **Airport Queue AI** | Demand forecasting, EWR queue optimization | Airport Service + SageMaker | < 500ms |
| **Fraud Detection AI** | Real-time fraud scoring, multi-account detection | Trust Service + SageMaker | < 300ms |
| **Safety Monitor AI** | Route deviation, anomaly detection, escalation | Safety Service (streaming) | < 1s |

All AI engines log inputs, outputs, and confidence scores to `ai_pricing_logs` (trip pricing) and respective event tables for auditability.

---

## Engine 1 — Fare Pricing Engine

**Owner:** Pricing Service (port 3005)
**Invoked:** On every trip request before presenting fare to rider

### Input Features

```typescript
interface FarePricingInput {
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  pickup_address_type: 'airport' | 'residential' | 'commercial' | 'transit';
  estimated_distance_miles: number;
  estimated_duration_min: number;
  requested_at: Date;           // hour of day, day of week
  active_drivers_in_zone: number;
  pending_requests_in_zone: number;
  surge_zone_score: number;     // pre-computed from demand heatmap
  is_airport_trip: boolean;
  is_night_ride: boolean;       // 10pm–5am
  rider_trust_score: number;    // internal, range 0–1000
  rider_total_trips: number;
}
```

### Fare Formula (hybrid rule + ML)

```
base_fare = $2.50
distance_component = distance_miles × $1.10
duration_component = duration_min × $0.22
demand_multiplier = 1.0 + (surge_zone_score × 0.4)  // max 1.4×
airport_premium = is_airport_trip ? $3.50 : $0
night_premium = is_night_ride ? $1.00 : $0

raw_fare = (base_fare + distance_component + duration_component
           + airport_premium + night_premium) × demand_multiplier

ai_adjustment = SageMaker_endpoint(features) × ±$2.00  // bounded adjustment
final_ai_fare = max(raw_fare + ai_adjustment, $5.00)   // floor $5.00
```

The SageMaker model (XGBoost) is trained on historical trip completions, acceptance rates at given fares, and driver earnings outcomes. The model output is bounded to ±$2.00 so no single model prediction can distort a fare significantly.

### Founder Control Override

Platform config key `earnings_floor_formula` is signed by Founder JWT before write. The earnings floor is applied as a **post-hoc guarantee**, never as fare inflation:

```typescript
floor = (distance × 1.10) + (duration × 0.22) + 2.50
driver_earnings = final_fare × 0.80  // 20% platform fee
if (driver_earnings < floor) {
  supplement = floor - driver_earnings
  platform absorbs supplement
}
```

### Transparency Rule

Driver app shows: **driver take-home = `driver_earnings + supplement`** as the first and largest number.
Gross fare is secondary. Rider app shows: **AI fare** only. Neither party sees the other's internal calculation.

---

## Engine 2 — Earnings Floor AI

**Owner:** Pricing Service (in-process, no external ML)
**Invoked:** At trip completion before payout finalization

This engine is deterministic — no ML model. It enforces the founder-defined formula exactly, with no ML override possible. It is listed as an "AI engine" for organizational clarity but is a pure rules engine.

### Enforcement Flow

```typescript
function enforceEarningsFloor(trip: CompletedTrip): FloorResult {
  const formula = await getFloorFormula(); // from platform_config
  const floor = (trip.actual_distance_miles * formula.per_mile)
              + (trip.actual_duration_min  * formula.per_min)
              + formula.base;
  
  const earned = trip.final_fare * (1 - PLATFORM_FEE_RATE);
  const supplement = max(0, floor - earned);

  if (supplement > 0) {
    await logFloorSupplement(trip.id, floor, earned, supplement);
    await notifyDriver(trip.driver_id, 'FLOOR_TRIGGERED', supplement);
  }

  return { floor, earned, supplement, floor_met: supplement === 0 };
}
```

The floor formula (`per_mile`, `per_min`, `base`) can only be modified by the Founder. The `platform_config` write endpoint requires a signed JWT unique to the Founder account. Admin users with other roles receive a 403 on write attempts.

---

## Engine 3 — Airport Queue AI

**Owner:** Airport Service (port 3010) + SageMaker
**Invoked:** On every FlightAware poll (30s intervals) and on queue join/leave events

### Demand Forecasting Inputs

```typescript
interface AirportDemandInput {
  incoming_flights: FlightArrival[];      // next 90 minutes
  passengers_per_flight: number[];        // seat × load factor
  current_queue_length: number;
  historical_rideshare_rate: number;      // from past data at this hour
  weather_code: string;                   // 'clear' | 'rain' | 'snow'
  day_of_week: number;                    // 0–6
  hour_of_day: number;
  active_drivers_at_terminal: number;
  known_surge_active: boolean;
}
```

### Output

```typescript
interface AirportDemandForecast {
  estimated_requests_next_30min: number;
  estimated_requests_next_60min: number;
  recommended_queue_size: number;
  suggested_surge_multiplier: number;
  confidence: number;          // 0.0–1.0
}
```

### Queue Position Algorithm

```
Drivers are ranked by queue join timestamp (FIFO).
On dispatch: next driver in queue receives trip request (standard 15s window).
If driver declines: trip passed to next driver, original driver maintains queue position.
If driver does not respond in 15s: position drops by 3.
Driver advances automatically as drivers ahead accept dispatches or leave queue.
```

### Surge Control

Airport surge is suggested by the forecast model but requires admin confirmation above 1.5×. Surge changes are logged with admin ID and justification. Riders see real-time surge indicator before requesting from the airport.

---

## Engine 4 — Fraud Detection AI

**Owner:** Trust Service (port 3009) + SageMaker
**Invoked:** On registration, on payment method add, on trip request (background), on payout request

### Input Features

```typescript
interface FraudDetectionInput {
  user_id: string;
  event_type: 'registration' | 'payment_add' | 'trip_request' | 'payout';
  device_fingerprint: string;
  ip_address: string;
  account_age_days: number;
  total_trips: number;
  linked_accounts_count: number;
  payment_methods_count: number;
  shared_device_accounts: number;  // other users on same device fingerprint
  velocity_24h: number;            // requests in last 24h
  gps_anomaly_score: number;       // pickup GPS vs IP location deviation
  identity_verified: boolean;
  phone_age_days: number;          // carrier data
}
```

### Output + Action Rules

```typescript
interface FraudScore {
  fraud_probability: number;   // 0.0–100.0
  risk_signals: string[];
  recommended_action: 'allow' | 'monitor' | 'hold' | 'block';
}
```

| Score Range | Action | Human Review |
|---|---|---|
| 0–39 | Allow | None |
| 40–69 | Monitor + flag | Weekly batch review |
| 70–89 | Enhanced verification | Admin queue within 24h |
| 90–100 | Auto-hold | Admin review within 2 hours |

**Rule:** No automated permanent action. Fraud probability ≥ 90 places account on hold pending admin review. A human admin must confirm before any permanent ban or account closure. This is a founder-level non-negotiable.

### Multi-Account Detection

```typescript
// Checked on every new registration + device change
async function detectMultiAccount(user: User, fingerprint: string): Promise<void> {
  const existing = await findByFingerprint(fingerprint);
  for (const linked of existing) {
    if (linked.user_id !== user.id) {
      await createMultiAccountLink({
        user_id_a: user.id,
        user_id_b: linked.user_id,
        link_type: 'shared_device',
        confidence: calculateConfidence(user, linked),
      });
    }
  }
}
```

---

## Engine 5 — Safety Monitor AI

**Owner:** Safety Service (port 3006), streaming
**Invoked:** Every 10 seconds during active trips

### Route Deviation Detection

```typescript
interface SafetyCheckInput {
  trip_id: string;
  current_lat: number;
  current_lng: number;
  planned_route_polyline: string;
  speed_mph: number;
  elapsed_min: number;
  expected_elapsed_min: number;
}

function checkRouteDeviation(input: SafetyCheckInput): SafetyAlert | null {
  const deviationMeters = distanceFromRoute(input.current_lat, input.current_lng, input.planned_route_polyline);
  const timeDeviation = input.elapsed_min - input.expected_elapsed_min;
  
  if (deviationMeters > 400 && timeDeviation > 3) {
    return { level: 'moderate', reason: 'route_deviation' };
  }
  if (deviationMeters > 800) {
    return { level: 'critical', reason: 'major_route_deviation' };
  }
  return null;
}
```

### Anomaly Signals

| Signal | Threshold | Action |
|---|---|---|
| Route deviation | > 400m + 3 min late | Soft alert, in-app prompt |
| Major deviation | > 800m | Critical alert, admin notified |
| Speed anomaly | > 90 mph in city | Moderate alert |
| Stop anomaly | > 8 min unexpected stop | Soft alert, safe check-in prompt |
| Night ride check-in miss | No response in 5 min | Escalate to admin |
| SOS countdown started | — | Begin audio recording, notify admin queue |

### State Machine Integration

The Safety Monitor feeds the `safety_sessions.current_state` field:
```
normal → soft_alert → moderate_alert → critical → sos_active
                                               ↘ panic_active
```
State changes are published to Redis Pub/Sub → Admin WebSocket channel in real-time.

---

## AI Governance

- **Model versions:** All SageMaker models are versioned. Production deployments require Founder or Super Admin sign-off.
- **Bias monitoring:** Fare distribution by pickup ZIP code and rider demographics reviewed monthly.
- **Human override always available:** No AI decision is irreversible without admin confirmation.
- **Audit trail:** Every AI invocation that affects money or safety is logged with input features, output, model version, and timestamp.
- **Earnings Floor is not AI:** The floor enforcement engine is deterministic and cannot be overridden by ML output. This is an architectural invariant.

---

*BidiRide Technical Architecture — Part 4 of 5 — Confidential · Delaware LLC*
