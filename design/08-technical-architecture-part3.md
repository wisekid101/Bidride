# BidRide — Technical Architecture v1.0 · Part 3: API Architecture

**Status:** Draft — Pending Founder Approval
**Document:** 08-C · Part 3 of 5

---

## Authentication Architecture

### Token System

```
Access Token (JWT)  — 15 minute TTL
Refresh Token       — 30 day TTL, stored in Redis, rotated on use
MFA Token           — required for sensitive actions (payout, bank change)
Admin Session Token — 8 hour TTL, invalidated on role change
```

### JWT Payload
```typescript
{
  sub: string;           // user UUID
  role: 'rider' | 'driver' | 'admin';
  admin_role?: AdminRole; // if role === 'admin'
  jti: string;           // JWT ID for revocation
  iat: number;
  exp: number;
}
```

### Auth Flow — Rider / Driver
```
1. POST /auth/send-otp         → Twilio sends 6-digit OTP, stored Redis 5min
2. POST /auth/verify-otp       → validate OTP → create user or return existing
3. Response: { access_token, refresh_token, user }
4. POST /auth/refresh           → validate refresh token → issue new pair
5. POST /auth/logout            → revoke refresh token in Redis

Driver-only additional step:
6. POST /auth/mfa/setup         → generate TOTP QR code
7. POST /auth/mfa/verify        → validate TOTP → mark MFA active
8. All /driver/* writes require valid MFA claim in token
```

### Auth Flow — Admin
```
1. POST /admin/auth/login       → validate email/password
2. POST /admin/auth/mfa         → validate TOTP (all admins) or YubiKey (Super Admin+)
3. Response: { session_token } → HttpOnly cookie, 8-hour TTL
4. All admin API calls require cookie + CSRF token header
5. Idle timeout: 30 min → re-authenticate
```

---

## REST API Catalog

Base URL: `https://api.bidride.com/v1`

### Auth Service — /auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /auth/send-otp | None | Send OTP to phone |
| POST | /auth/verify-otp | None | Verify OTP, return tokens |
| POST | /auth/refresh | Refresh token | Rotate token pair |
| POST | /auth/logout | Access token | Revoke refresh token |
| POST | /auth/mfa/setup | Access token | Begin TOTP setup |
| POST | /auth/mfa/verify | Access token | Confirm TOTP enrollment |

### Rider Service — /rider

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /rider/profile | Rider | Get own profile |
| PUT | /rider/profile | Rider | Update display name, photo |
| GET | /rider/payment-methods | Rider | List saved payment methods |
| POST | /rider/payment-methods | Rider | Add payment method (Stripe) |
| DELETE | /rider/payment-methods/:id | Rider | Remove payment method |
| PUT | /rider/payment-methods/:id/default | Rider | Set default |
| GET | /rider/rewards | Rider | Points balance, tier, history |
| GET | /rider/trips | Rider | Trip history (paginated) |
| GET | /rider/trips/:id | Rider | Trip detail |
| POST | /rider/trips/:id/rate | Rider | Rate driver (after completion) |
| GET | /rider/trusted-contacts | Rider | List trusted contacts |
| POST | /rider/trusted-contacts | Rider | Add trusted contact |
| DELETE | /rider/trusted-contacts/:id | Rider | Remove trusted contact |
| GET | /rider/notifications | Rider | Notification center |
| PUT | /rider/notifications/settings | Rider | Notification preferences |

### Trip Service — /trips

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /trips | Rider | Request a ride (returns trip_id) |
| GET | /trips/:id | Rider\|Driver | Trip state + details |
| DELETE | /trips/:id | Rider | Cancel (pre-acceptance) |
| POST | /trips/:id/accept | Driver | Accept ride request |
| POST | /trips/:id/reject | Driver | Decline (returns to pool) |
| POST | /trips/:id/arrived | Driver | Mark arrived at pickup |
| POST | /trips/:id/start | Driver | Start trip |
| POST | /trips/:id/end | Driver | End trip (with GPS check) |
| POST | /trips/:id/rate | Driver | Rate rider |
| POST | /trips/:id/no-show | Driver | Mark rider no-show (after 5 min) |

### Pricing Service — /pricing

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /pricing/estimate | Rider | Get AI fare estimate before booking |
| POST | /pricing/floor | Internal | Calculate earnings floor for trip |
| GET | /pricing/surge/:area | Any | Current surge multiplier for zone |

### Bid Service — /bids

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /bids | Rider | Submit a bid offer |
| GET | /bids/:id | Rider\|Driver | Bid detail |
| POST | /bids/:id/accept | Driver | Accept rider's bid |
| POST | /bids/:id/decline | Driver | Decline bid |
| POST | /bids/:id/counter | Driver | Counter-offer (round 1 only) |
| POST | /bids/:id/rider-accept | Rider | Accept driver's counter |
| POST | /bids/:id/rider-decline | Rider | Decline counter (bid closes) |

### Driver Service — /driver

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /driver/auth/register | None | Begin driver application |
| GET | /driver/profile | Driver | Own profile + application status |
| PUT | /driver/profile | Driver | Update profile photo |
| POST | /driver/documents/upload | Driver | Upload document (returns signed S3 URL flow) |
| GET | /driver/documents | Driver | Document list + status |
| POST | /driver/background-check/consent | Driver | Submit FCRA consent |
| POST | /driver/payout/bank-account | Driver + MFA | Link bank (Stripe tokenized) |
| PUT | /driver/payout/bank-account | Driver + MFA | Update bank account |
| GET | /driver/payout/bank-account | Driver | View masked bank info |
| POST | /driver/status/online | Driver | Go online (shift start) |
| POST | /driver/status/offline | Driver | Go offline |
| GET | /driver/earnings/today | Driver | Today's earnings summary |
| GET | /driver/earnings/week | Driver | Current week summary |
| GET | /driver/earnings/history | Driver | Historical trips + earnings |
| POST | /driver/payout/instant | Driver + MFA | Request instant payout ($0.99 fee) |
| GET | /driver/vehicles | Driver | Own vehicle list |
| POST | /driver/vehicles | Driver | Register vehicle |
| PUT | /driver/vehicles/:id/active | Driver | Switch active vehicle |
| GET | /driver/performance | Driver | Acceptance rate, completion, rating |
| GET | /driver/rewards | Driver | Milestones, challenges, badges |
| GET | /driver/documents/compliance | Driver | Expiry alerts + renewal links |

### Safety Service — /safety

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /safety/sos/initiate | Rider\|Driver | Begin SOS (5s countdown) |
| POST | /safety/sos/:id/confirm | Rider\|Driver | Confirm SOS (countdown complete) |
| POST | /safety/sos/:id/cancel | Rider\|Driver | Cancel during countdown |
| POST | /safety/sos/:id/resolve | Admin | Mark SOS resolved |
| POST | /safety/panic | Rider\|Driver | Silent panic trigger |
| POST | /safety/check-in | Rider\|Driver | Safe check-in after trip |
| GET | /safety/sessions/:trip_id | Admin | Safety session detail |
| GET | /safety/recordings/:id/access | Admin | Dual-auth recording access |

### Payment Service — /payments

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /payments/:trip_id | Rider | Payment detail for trip |
| POST | /payments/refund | Admin | Issue refund |
| GET | /driver/payouts | Driver | Payout history |
| GET | /driver/payouts/:id | Driver | Payout detail |
| GET | /driver/wallet | Driver | Current balance (held + available) |
| POST | /driver/payouts/instant | Driver + MFA | Trigger instant payout |

### Airport Service — /airport

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /airport/queue/join | Driver | Enter EWR virtual queue |
| DELETE | /airport/queue/leave | Driver | Leave queue |
| GET | /airport/queue/position | Driver | Own queue position + ETA |
| GET | /airport/queue | Admin | Full queue view |
| GET | /airport/flights | Driver | Upcoming EWR arrivals (cached) |
| GET | /airport/surge | Driver | Current airport surge |

### Admin Service — /admin

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /admin/auth/login | None | Admin login |
| POST | /admin/auth/mfa | Session | Complete MFA |
| POST | /admin/auth/logout | Session | End admin session |
| GET | /admin/dashboard | Admin | Live ops metrics |
| GET | /admin/trips | Admin | Trip table (filterable) |
| GET | /admin/trips/:id | Admin | Trip detail (full + safety) |
| GET | /admin/drivers | Admin | Driver directory |
| GET | /admin/drivers/:id | Admin | Driver profile (full internal) |
| POST | /admin/drivers/:id/approve | Approval Admin | Approve driver application |
| POST | /admin/drivers/:id/decline | Approval Admin | Decline with reason |
| POST | /admin/drivers/:id/suspend | Safety Admin | Suspend driver |
| POST | /admin/drivers/:id/notes | Admin | Append note (immutable) |
| GET | /admin/riders | Admin | Rider directory |
| GET | /admin/riders/:id | Admin | Rider profile |
| POST | /admin/riders/:id/ban | Safety Admin | Ban rider |
| GET | /admin/safety/incidents | Safety Admin | Safety incident queue |
| GET | /admin/safety/sos | Safety Admin | Active SOS queue |
| POST | /admin/safety/sos/:id/assign | Safety Admin | Assign to self |
| GET | /admin/fraud | Fraud Admin | Fraud detection queue |
| POST | /admin/fraud/:id/hold | Fraud Admin | Place account on hold |
| GET | /admin/refunds | Support Admin | Refund queue |
| POST | /admin/refunds | Support Admin | Issue refund |
| GET | /admin/platform-config | Founder | Platform config values |
| PUT | /admin/platform-config/earnings-floor | Founder | Update floor formula (signed JWT) |
| GET | /admin/audit-logs | Super Admin | Audit trail |
| GET | /admin/analytics | Analytics Admin | GMV, retention, safety SLAs |

---

## WebSocket Events

Connection: `wss://api.bidride.com/ws?token={access_token}`

### Events: Server → Client (Driver)

| Event | Payload | Trigger |
|---|---|---|
| `request:incoming` | Trip ID, pickup, dropoff, AI fare, rider badge, distance | New trip request matched to driver |
| `request:bid_incoming` | Trip ID, rider offer, AI fare, counter allowed | Bid request matched |
| `request:expired` | Trip ID | Request timer elapsed |
| `trip:state_change` | Trip ID, new state | Any trip state transition |
| `trip:cancelled` | Trip ID, reason | Rider cancelled |
| `earnings:floor_triggered` | Trip ID, supplement amount | Floor exceeded — supplement added |
| `queue:position_update` | Queue position, estimated dispatch | Airport queue change |
| `dispatch:advance_notice` | ETA to dispatch in minutes | 10 min before airport dispatch |
| `dispatch:ready` | Trip request card | Airport dispatch ready |
| `safety:check_in_due` | Trip ID | Night ride check-in prompt |

### Events: Server → Client (Rider)

| Event | Payload | Trigger |
|---|---|---|
| `driver:assigned` | Driver name, vehicle, ETA | Trip accepted by driver |
| `driver:location` | `{lat, lng, heading}` | Every 3 seconds during trip |
| `driver:arrived` | Timestamp | Driver marked arrived |
| `trip:started` | Timestamp | Trip started |
| `trip:completed` | Final fare, receipt URL | Trip ended |
| `trip:cancelled` | Reason | Driver/system cancelled |
| `bid:counter` | Counter offer amount | Driver countered |
| `bid:accepted` | Final fare | Bid accepted |
| `bid:expired` | — | Bid timer elapsed |

### Events: Server → Client (Admin)

| Event | Payload | Trigger |
|---|---|---|
| `ops:activity` | Trip/driver events summary | Continuous, ~5s interval |
| `safety:sos_new` | SOS event ID, trip ID, GPS | SOS activated |
| `safety:panic_new` | Trip ID (no rider detail) | Panic triggered |
| `safety:sla_warning` | SOS ID, time remaining | SLA at 60s |
| `fraud:alert` | User ID, score, reason | Fraud score ≥ 90 |
| `approval:new` | Driver ID | New driver approval request |

---

## Error Response Format

```typescript
{
  error: {
    code: string;       // e.g. "TRIP_NOT_FOUND"
    message: string;    // human-readable
    status: number;     // HTTP status code
    details?: unknown;  // validation details only
  }
}
```

### Standard Error Codes

| Code | HTTP | Description |
|---|---|---|
| `AUTH_INVALID_OTP` | 400 | OTP incorrect or expired |
| `AUTH_TOKEN_EXPIRED` | 401 | Access token expired |
| `AUTH_INSUFFICIENT_ROLE` | 403 | Action requires higher role |
| `AUTH_MFA_REQUIRED` | 403 | Action requires MFA verification |
| `TRIP_NOT_FOUND` | 404 | Trip does not exist or not accessible |
| `TRIP_INVALID_STATE` | 409 | State machine violation |
| `BID_COUNTER_LIMIT` | 409 | Counter round limit reached |
| `DRIVER_NOT_APPROVED` | 403 | Driver application not approved |
| `EARNINGS_FLOOR_ACTIVE` | 200 | Trip below floor — supplement applied (not error) |
| `PAYOUT_INSUFFICIENT_BALANCE` | 422 | Balance below $10 minimum |
| `QUEUE_ALREADY_JOINED` | 409 | Driver already in EWR queue |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `VALIDATION_FAILED` | 422 | Request body validation errors |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Rate Limiting

| Endpoint group | Limit | Window |
|---|---|---|
| Auth — OTP send | 3 requests | 10 minutes per phone |
| Auth — OTP verify | 5 attempts | 5 minutes per phone |
| Trip request | 10 requests | 1 minute per rider |
| Pricing estimate | 30 requests | 1 minute per user |
| Admin login | 5 attempts | 15 minutes per IP |
| General API | 300 requests | 1 minute per user |

---

*BidRide Technical Architecture — Part 3 of 5 — Confidential · Delaware LLC*
