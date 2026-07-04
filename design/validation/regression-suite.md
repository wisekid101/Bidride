# Regression Suite

Defines what must pass before any merge to `main` and before any production deploy.
Run order: unit → integration → E2E → manual alpha spot-check.

---

## Unit Tests

Run: `pnpm test`
Required: **zero failures, zero skipped**

| Service / Package | Spec files | Key coverage |
|---|---|---|
| `auth-service` | `auth.service.spec.ts`, `otp.service.spec.ts`, `websocket.gateway.spec.ts` | OTP flow, JWT issue, WebSocket driver location write (`driver:{userId}:location`) |
| `trip-service` | `trips.service.spec.ts`, `bids.service.spec.ts`, `pricing.service.spec.ts` | State machine transitions, earnings floor formula, race condition prevention, dispatch Redis key format |
| `payment-service` | `payment.service.spec.ts` | Stripe auth hold → capture → void chain; instant payout fee + cap + hold period |
| `safety-service` | `sos.service.spec.ts` | 3-state SOS flow; panic payload must not contain `riderId`/`riderName`/`riderPhone`; audio recording only on confirmation |
| `trust-service` | `trust.service.spec.ts` | Badge label output only (Verified/Trusted/Business/VIP); numerical score never returned |
| `driver-service` | `drivers.service.spec.ts`, `checkr.service.spec.ts` | Redis location key format (`driver:{userId}:location` not `driver:location:{driver.id}`); FCRA adverse action flow; idempotent webhook handling |
| `notification-service` | `notifications.service.spec.ts` | FCM + SMS routing; FCRA letter trigger |
| `airport-service` | `airport.service.spec.ts` | EWR FIFO queue; surge 2.5× hard cap; FlightAware 30s cache |
| `admin-service` | `analytics.service.spec.ts`, `fraud.service.spec.ts` | Role-gated endpoints; earnings floor Founder-only mutation; fraud auto-hold threshold |
| `ai-service` | `bid-outcome.service.spec.ts`, `bid-prediction.service.spec.ts`, `dispatch.service.spec.ts` | Outcome recording; win probability; dispatch simulation |
| `pricing-service` | `fare-engine.service.spec.ts` | Hybrid SageMaker + rule engine; AI bounded ±$2.00 from rule baseline |

---

## Integration Tests

Run: `pnpm turbo run test:int` (requires live PostgreSQL + Redis)
Required: **zero failures**

| Suite | Scope |
|---|---|
| `trip-service` integration | Full trip state machine against real DB; earnings floor supplement written to `earnings_floor_logs`; `payments` row lifecycle; concurrent bid race condition (optimistic lock) |
| `auth-service` integration | OTP send → verify → JWT round-trip; refresh token rotation; MFA TOTP enroll + verify |
| `driver-service` integration | Onboarding steps; background check webhook idempotency; Redis key written on go-online; key deleted on suspend |
| `payment-service` integration | Stripe webhook signature verification; hold → capture → instant payout; failed payout retry |

---

## E2E Tests

Run: `pnpm --filter @bidride/admin playwright test`
Required: **zero failures**

| Test | Description |
|---|---|
| Admin login | Cookie-based auth; role-gated page access |
| Driver approval flow | List pending drivers; approve; status change reflected |
| Fraud queue | Fraud alert displayed; clear/ban actions; audit log entry written |
| Earnings floor config | Non-founder cannot modify; Founder JWT required |
| Safety SOS center | Active SOS sessions listed; assign; no rider contact info visible |
| Analytics dashboard | GMV, trip counts, active drivers render correctly |

---

## Alpha Validation Spot-Check (Pre-Production)

Full manual run of E1–E20 against staging. Reference: `sprint-2c-alpha-validation.md`.

Critical paths that must always be re-validated before production deploy:

| Step | Why it must be re-checked |
|---|---|
| **E3** Driver goes online | Redis key format regression risk — `driver:{userId}:location` must not revert to DB UUID format |
| **E5** Stripe hold created | Any payment-service change risks the auth hold chain |
| **E12** Trip end + earnings | Earnings floor formula must remain deterministic; `earnings_floor_met` must be set |
| **E17** Trust badge | Numerical score must never appear in any API response |
| **E19** AI outcome recorded | `AI_SERVICE_URL` must be set in trip-service config; `bid_outcomes` must receive accepted-bid records |
| **E20** Admin dashboard | GMV and trip counts must match actual completed trips |

---

## Regression Invariants

These conditions must hold at all times. Any test or validation that contradicts them is a blocking regression.

### Redis Key Format
All driver location keys use auth UUID (`userId`), not database UUID (`driver.id`):
```
CORRECT:   driver:{userId}:location
INCORRECT: driver:location:{driver.id}
```
Written by: `auth-service` WebSocket (10s TTL), `driver-service` HTTP (300s TTL)
Read by: `bids.service.ts` dispatch via `redis.keys('driver:*:location')`

### Earnings Floor
Formula coefficients are locked. Any change to these values without a Founder JWT is a security regression:
```
floor = (distance_miles × $1.10) + (duration_min × $0.22) + $2.50
```

### Trust Score Visibility
`GET /riders/me`, `GET /drivers/me`, and all trip-facing endpoints must return zero numerical trust score fields. Only badge labels are permitted.

### Panic Payload
`safety-service` panic event must never include `riderId`, `riderName`, or `riderPhone` in the admin-bound payload.

### Surge Cap
`airport-service` surge multiplier must never exceed 2.5×. Any value above 1.5× must require admin confirmation before activation.

### SOS Audio
Audio recording session creation must only be triggered on SOS confirmation (state 3), not on SOS initiation (state 1) or countdown (state 2).

---

## CI Enforcement

| Gate | Trigger | Required to pass |
|---|---|---|
| Unit tests | Every PR, every push to `main` | 100% pass |
| Typecheck | Every PR, every push to `main` | Zero errors |
| Integration tests | Every push to `main` | 100% pass |
| E2E (Playwright) | Every push to `main` | 100% pass |
| Dependency audit | Every PR | No high/critical unresolved |
| Staging deploy | Automatic on merge to `main` | Health checks pass |
| Production deploy | Manual Founder approval | Full checklist (see `release-checklist.md`) |
