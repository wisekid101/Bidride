# BidRide API Architecture

> **Status: DRAFT — Awaiting founder approval before development begins**
> **Last updated: 2026-06-24**
> **Style: REST + WebSocket (Socket.io)**
> **Base URL: `https://api.bidride.com/v1`**

---

## TABLE OF CONTENTS
1. [API Design Principles](#1-api-design-principles)
2. [Authentication & Authorization](#2-authentication--authorization)
3. [API Versioning & Standards](#3-api-versioning--standards)
4. [Rider Endpoints](#4-rider-endpoints)
5. [Driver Endpoints](#5-driver-endpoints)
6. [Bid Flow Endpoints](#6-bid-flow-endpoints)
7. [Payment Endpoints](#7-payment-endpoints)
8. [Safety Endpoints](#8-safety-endpoints)
9. [Admin Endpoints](#9-admin-endpoints)
10. [WebSocket Event Reference](#10-websocket-event-reference)
11. [Error Handling](#11-error-handling)
12. [Rate Limits](#12-rate-limits)

---

## 1. API Design Principles

- **REST for CRUD, WebSocket for real-time** — booking, profiles, history = REST; live location, bid negotiation, ride status = WebSocket
- **Consistent response envelope** — every response uses the same shape
- **Explicit versioning** — `/v1/` prefix, breaking changes go in `/v2/`
- **No leaking internal IDs** — always use UUIDs
- **Minimal data in responses** — return only what the client needs, not full database rows
- **Idempotency keys** for payment operations — retry safety
- **All amounts in cents** — no floating-point currency

### Standard Response Envelope

**Success:**
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "request_id": "req_01abc...",
    "timestamp": "2026-06-24T14:30:00Z"
  }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "RIDE_NOT_FOUND",
    "message": "The requested ride does not exist.",
    "details": {}
  },
  "meta": {
    "request_id": "req_01abc...",
    "timestamp": "2026-06-24T14:30:00Z"
  }
}
```

**Paginated List:**
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 245,
    "page": 1,
    "per_page": 20,
    "next_cursor": "cursor_abc123"
  }
}
```

---

## 2. Authentication & Authorization

### Auth Flow

**Step 1 — Request OTP**
```
POST /v1/auth/otp/request
Body: { "phone": "+19735551234" }
Response: { "expires_in": 300 }
```

**Step 2 — Verify OTP**
```
POST /v1/auth/otp/verify
Body: { "phone": "+19735551234", "code": "847291" }
Response: {
  "access_token": "eyJ...",
  "refresh_token": "rt_...",
  "user": { id, role, full_name, status }
}
```

**Step 3 — Refresh Access Token**
```
POST /v1/auth/token/refresh
Body: { "refresh_token": "rt_..." }
Response: { "access_token": "eyJ...", "refresh_token": "rt_..." }
```

**Step 4 — Logout**
```
POST /v1/auth/logout
Headers: Authorization: Bearer {access_token}
Body: { "refresh_token": "rt_..." }
```

### Token Format
- **Access token:** JWT, signed with RS256, expires in 15 minutes
- **Refresh token:** opaque token stored in Redis, expires in 30 days, rotated on each use
- **All protected endpoints:** require `Authorization: Bearer {access_token}` header

### Role Guards
Every endpoint is annotated with the minimum role required:
- `[PUBLIC]` — No auth required
- `[RIDER]` — Rider-only
- `[DRIVER]` — Driver-only
- `[ANY_USER]` — Rider or driver
- `[ADMIN]` — Admin only

---

## 3. API Versioning & Standards

### HTTP Methods
| Method | Use |
|--------|-----|
| GET | Read data (never modifies state) |
| POST | Create new resource or trigger action |
| PATCH | Partial update of a resource |
| DELETE | Soft delete (sets deleted_at) |

### URL Patterns
```
Collection:   GET    /v1/rides
Single item:  GET    /v1/rides/{rideId}
Create:       POST   /v1/rides
Update:       PATCH  /v1/rides/{rideId}
Action:       POST   /v1/rides/{rideId}/cancel
```

### Pagination
- Cursor-based pagination (not offset) for high-volume lists
- Default page size: 20
- Max page size: 100
- Query params: `?cursor={cursor}&limit={limit}`

---

## 4. Rider Endpoints

### Account

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/v1/rider/profile` | [RIDER] | Get own profile |
| PATCH | `/v1/rider/profile` | [RIDER] | Update name, email, profile photo |
| DELETE | `/v1/rider/account` | [RIDER] | Request account deletion |

**GET /v1/rider/profile — Response:**
```json
{
  "id": "uuid",
  "phone": "+19735551234",
  "email": "rider@example.com",
  "full_name": "Jane Smith",
  "profile_photo_url": "https://cdn.bidride.com/photos/...",
  "average_rating": 4.85,
  "member_since": "2026-06-24"
}
```

### Fare Estimation

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/v1/fare/estimate` | [RIDER] | Get fare estimate before booking |

**POST /v1/fare/estimate — Request:**
```json
{
  "pickup": {
    "lat": 40.7357,
    "lng": -74.1724,
    "address": "Newark Penn Station, Newark, NJ"
  },
  "dropoff": {
    "lat": 40.6895,
    "lng": -74.1745,
    "address": "Newark Liberty International Airport, NJ"
  }
}
```

**Response:**
```json
{
  "standard_fare_cents": 1850,
  "standard_fare_display": "$18.50",
  "estimated_distance_miles": 4.2,
  "estimated_duration_minutes": 14,
  "surge_multiplier": 1.0,
  "is_airport_ride": true,
  "airport_fee_cents": 500,
  "bid_floor_cents": 1200,
  "bid_floor_display": "$12.00",
  "eta_to_pickup_minutes": 4,
  "drivers_nearby": 7
}
```

### Booking a Ride

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/v1/rides` | [RIDER] | Request a standard ride |
| GET | `/v1/rides/{rideId}` | [RIDER] | Get ride status |
| POST | `/v1/rides/{rideId}/cancel` | [RIDER] | Cancel a ride |
| GET | `/v1/rides` | [RIDER] | Rider's trip history |

**POST /v1/rides — Request (Standard Fare):**
```json
{
  "ride_type": "standard",
  "pickup": {
    "lat": 40.7357,
    "lng": -74.1724,
    "address": "Newark Penn Station, Newark, NJ"
  },
  "dropoff": {
    "lat": 40.6895,
    "lng": -74.1745,
    "address": "Newark Liberty International Airport, NJ"
  },
  "payment_method_id": "pm_uuid",
  "note_to_driver": "I have 2 bags"
}
```

**Response:**
```json
{
  "ride_id": "uuid",
  "status": "requesting",
  "estimated_fare_cents": 1850,
  "websocket_channel": "ride:uuid"
}
```

### Payment Methods

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/v1/rider/payment-methods` | [RIDER] | List saved payment methods |
| POST | `/v1/rider/payment-methods` | [RIDER] | Add a payment method (Stripe SetupIntent) |
| DELETE | `/v1/rider/payment-methods/{id}` | [RIDER] | Remove a payment method |
| PATCH | `/v1/rider/payment-methods/{id}/default` | [RIDER] | Set as default |

**POST /v1/rider/payment-methods — Response:**
```json
{
  "client_secret": "seti_xxx_secret_xxx"
}
```
*Client uses this secret with Stripe SDK to tokenize the card — card number never touches BidRide servers.*

### Trip History & Receipts

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/v1/rides` | [RIDER] | List past rides (paginated) |
| GET | `/v1/rides/{rideId}/receipt` | [RIDER] | Get trip receipt |
| POST | `/v1/rides/{rideId}/tip` | [RIDER] | Add tip post-trip |
| POST | `/v1/rides/{rideId}/rate` | [RIDER] | Rate driver |

---

## 5. Driver Endpoints

### Onboarding

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/v1/driver/onboarding/start` | [ANY_USER] | Begin driver application |
| GET | `/v1/driver/onboarding/status` | [DRIVER] | Check onboarding status |
| POST | `/v1/driver/documents` | [DRIVER] | Upload document (returns S3 presigned URL) |
| POST | `/v1/driver/vehicles` | [DRIVER] | Add vehicle |
| PATCH | `/v1/driver/vehicles/{vehicleId}` | [DRIVER] | Update vehicle details |

**POST /v1/driver/documents — Request:**
```json
{
  "document_type": "drivers_license_front",
  "file_size_bytes": 245760,
  "content_type": "image/jpeg"
}
```

**Response:**
```json
{
  "document_id": "uuid",
  "upload_url": "https://s3.amazonaws.com/...",
  "upload_fields": { ... }
}
```
*Driver uploads directly to S3 using this presigned URL — never through BidRide's server.*

### Driver Profile

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/v1/driver/profile` | [DRIVER] | Get own driver profile |
| PATCH | `/v1/driver/profile` | [DRIVER] | Update profile |
| GET | `/v1/driver/earnings` | [DRIVER] | Earnings summary |
| GET | `/v1/driver/earnings/history` | [DRIVER] | Detailed earnings per trip |

### Going Online / Offline

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/v1/driver/status/online` | [DRIVER] | Go online (begin receiving requests) |
| POST | `/v1/driver/status/offline` | [DRIVER] | Go offline |

**POST /v1/driver/status/online — Request:**
```json
{
  "vehicle_id": "uuid",
  "current_lat": 40.7357,
  "current_lng": -74.1724
}
```

### Ride Actions (Driver)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/v1/rides/{rideId}/accept` | [DRIVER] | Accept a standard ride request |
| POST | `/v1/rides/{rideId}/decline` | [DRIVER] | Decline a ride request |
| POST | `/v1/rides/{rideId}/arrived` | [DRIVER] | Mark arrived at pickup |
| POST | `/v1/rides/{rideId}/start` | [DRIVER] | Start the trip (rider in vehicle) |
| POST | `/v1/rides/{rideId}/complete` | [DRIVER] | End the trip |
| POST | `/v1/rides/{rideId}/cancel` | [DRIVER] | Cancel (with reason) |
| POST | `/v1/rides/{rideId}/rate` | [DRIVER] | Rate rider post-trip |

### Payouts

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/v1/driver/payouts` | [DRIVER] | List payout history |
| GET | `/v1/driver/payout/balance` | [DRIVER] | Current balance available to pay out |
| POST | `/v1/driver/payout/instant` | [DRIVER] | Request instant payout (fee applies) |

---

## 6. Bid Flow Endpoints

The bid flow is the core differentiator of BidRide. These endpoints handle the full negotiation lifecycle.

### Submit a Bid (Rider)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/v1/rides` | [RIDER] | Create a bid ride (ride_type: "bid") |
| GET | `/v1/bids/{bidId}` | [ANY_USER] | Get current bid status |
| POST | `/v1/bids/{bidId}/accept` | [RIDER] | Accept driver's counter-offer |
| POST | `/v1/bids/{bidId}/decline` | [RIDER] | Decline driver's counter-offer |
| POST | `/v1/bids/{bidId}/cancel` | [RIDER] | Cancel bid before driver responds |

**POST /v1/rides — Request (Bid):**
```json
{
  "ride_type": "bid",
  "pickup": {
    "lat": 40.7357,
    "lng": -74.1724,
    "address": "Newark Penn Station, Newark, NJ"
  },
  "dropoff": {
    "lat": 40.6895,
    "lng": -74.1745,
    "address": "Newark Liberty International Airport, NJ"
  },
  "bid_amount_cents": 1400,
  "payment_method_id": "pm_uuid"
}
```

**Validation rules (enforced server-side):**
- `bid_amount_cents` must be ≥ `bid_floor_cents` (returned in fare estimate)
- `bid_amount_cents` must be ≤ `standard_fare_cents` (can't bid higher than standard)

**Response:**
```json
{
  "ride_id": "uuid",
  "bid_id": "uuid",
  "status": "bid_pending",
  "bid_amount_cents": 1400,
  "standard_fare_cents": 1850,
  "bid_floor_cents": 1200,
  "expires_at": "2026-06-24T14:33:00Z",
  "websocket_channel": "ride:uuid"
}
```

### Driver Responds to Bid

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/v1/bids/{bidId}/accept` | [DRIVER] | Accept rider's bid |
| POST | `/v1/bids/{bidId}/decline` | [DRIVER] | Decline rider's bid |
| POST | `/v1/bids/{bidId}/counter` | [DRIVER] | Submit counter-offer |

**POST /v1/bids/{bidId}/counter — Request:**
```json
{
  "counter_amount_cents": 1600
}
```

**Validation rules:**
- Counter must be > rider's original bid
- Counter must be ≤ standard fare
- Only one counter per driver per bid allowed (prevents ping-pong)

**Response:**
```json
{
  "bid_id": "uuid",
  "counter_bid_id": "uuid",
  "counter_amount_cents": 1600,
  "expires_at": "2026-06-24T14:34:30Z"
}
```

### Bid State Machine

```
[Rider submits bid]
         │
         ▼
    bid_pending ──────────────────────────────┐
         │                                    │
   ┌─────┼──────────────────┐          [TTL expires]
   ▼     ▼                  ▼                │
driver  driver          driver               ▼
accepts declines        counters          expired
   │       │                │
   ▼       ▼                ▼
[ride  [rider:         [counter
 begins standard         pending]
        fare or              │
        cancel]        ┌─────┴──────┐
                       ▼            ▼
                  rider          rider
                 accepts        declines
                       │            │
                       ▼            ▼
                  [ride        [bid flow
                   begins]      ends — standard
                                fare or cancel]
```

---

## 7. Payment Endpoints

Payments are largely handled server-side and by Stripe webhooks. Client-facing endpoints are minimal.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/v1/payments/setup-intent` | [RIDER] | Create Stripe SetupIntent (for adding card) |
| POST | `/v1/rides/{rideId}/tip` | [RIDER] | Add tip after ride completes |
| GET | `/v1/rides/{rideId}/receipt` | [RIDER] | Get itemized receipt |
| POST | `/v1/payments/dispute` | [RIDER] | Submit a fare dispute |

### Stripe Webhook Endpoint

```
POST /v1/webhooks/stripe
```
- Verifies Stripe-Signature header before processing
- Handles: `payment_intent.succeeded`, `payment_intent.payment_failed`, `transfer.paid`, `transfer.failed`
- This endpoint is NOT authenticated with user JWTs — it uses Stripe signature verification

---

## 8. Safety Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/v1/safety/sos` | [ANY_USER] | Trigger SOS (highest priority endpoint) |
| POST | `/v1/rides/{rideId}/report` | [ANY_USER] | Report a safety concern |
| POST | `/v1/rides/{rideId}/share` | [RIDER] | Generate a shareable trip link |
| GET | `/v1/trips/share/{token}` | [PUBLIC] | View shared trip (for non-users) |

**POST /v1/safety/sos — Request:**
```json
{
  "ride_id": "uuid",
  "lat": 40.7357,
  "lng": -74.1724,
  "message": "Optional message from user"
}
```

**Behavior:**
1. Immediately returns 200 (do not make user wait)
2. Asynchronously: logs incident, alerts safety team, triggers RapidSOS if integrated
3. SOS endpoint has no rate limiting (safety-critical — never block)

**POST /v1/rides/{rideId}/report — Request:**
```json
{
  "incident_type": "unsafe_driving",
  "description": "Driver ran two red lights"
}
```

---

## 9. Admin Endpoints

All admin endpoints require `[ADMIN]` role. Served from same API but separate route group.

### Driver Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/admin/drivers` | List drivers with filters (status, onboarding_status) |
| GET | `/v1/admin/drivers/{driverId}` | Full driver profile + documents |
| POST | `/v1/admin/drivers/{driverId}/approve` | Approve driver onboarding |
| POST | `/v1/admin/drivers/{driverId}/suspend` | Suspend driver (with reason) |
| POST | `/v1/admin/drivers/{driverId}/deactivate` | Permanently deactivate |
| GET | `/v1/admin/drivers/{driverId}/documents/{docId}/url` | Get presigned S3 URL to view document |

### Ride Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/admin/rides` | List all rides with filters |
| GET | `/v1/admin/rides/{rideId}` | Full ride detail (route, bids, messages) |
| POST | `/v1/admin/rides/{rideId}/refund` | Issue a refund |

### Safety Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/admin/safety/incidents` | List all safety incidents |
| GET | `/v1/admin/safety/incidents/{id}` | Incident detail |
| PATCH | `/v1/admin/safety/incidents/{id}` | Update status, add resolution notes |
| GET | `/v1/admin/safety/zero-tolerance` | Zero tolerance report queue |

### Pricing Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/admin/pricing` | Current pricing config |
| PATCH | `/v1/admin/pricing` | Update rates (requires super-admin) |
| GET | `/v1/admin/service-zones` | List service zones |
| POST | `/v1/admin/service-zones` | Create zone |
| PATCH | `/v1/admin/service-zones/{id}` | Update zone boundary or pricing |

### Reporting

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/admin/reports/revenue` | Revenue summary by period |
| GET | `/v1/admin/reports/drivers` | Driver activity summary |
| GET | `/v1/admin/reports/ewr-fees` | Port Authority fee report |
| GET | `/v1/admin/reports/safety` | Safety incident summary |

---

## 10. WebSocket Event Reference

**Connection:** `wss://api.bidride.com/socket`

**Authentication:** Pass JWT in connection handshake:
```javascript
const socket = io('wss://api.bidride.com', {
  auth: { token: accessToken }
});
```

### Rooms / Channels
- `ride:{rideId}` — All parties on a specific ride (rider, driver, admin)
- `driver:{driverId}` — Private channel for incoming requests to a specific driver
- `admin:dashboard` — Admin live feed

### Event Reference

#### Rider-Emitted Events
| Event | Payload | Description |
|-------|---------|-------------|
| `ride:request` | `{ ride_id }` | Join ride room after creating a ride |
| `bid:counter:accept` | `{ bid_id }` | Accept driver counter (real-time path) |
| `bid:counter:decline` | `{ bid_id }` | Decline driver counter |

#### Driver-Emitted Events
| Event | Payload | Description |
|-------|---------|-------------|
| `driver:location` | `{ lat, lng, bearing, speed }` | Location update (every 4 seconds) |
| `driver:ride:accept` | `{ ride_id }` | Accept standard ride |
| `driver:bid:accept` | `{ bid_id }` | Accept rider's bid |
| `driver:bid:counter` | `{ bid_id, amount_cents }` | Counter a bid |
| `driver:bid:decline` | `{ bid_id }` | Decline a bid |

#### Server-Emitted Events (to Rider)
| Event | Payload | Description |
|-------|---------|-------------|
| `ride:driver_assigned` | `{ driver, vehicle, eta_minutes }` | Driver accepted |
| `ride:driver_location` | `{ lat, lng, bearing, eta_minutes }` | Live driver location |
| `ride:driver_arrived` | `{}` | Driver at pickup |
| `ride:started` | `{ started_at }` | Ride in progress |
| `ride:completed` | `{ fare_cents, receipt_url }` | Trip complete |
| `ride:cancelled` | `{ reason }` | Ride cancelled |
| `bid:driver_counter` | `{ counter_bid_id, amount_cents, expires_at, driver }` | Driver countered |
| `bid:driver_accepted` | `{ bid_id, driver, vehicle, eta_minutes }` | Driver accepted bid |
| `bid:driver_declined` | `{ bid_id }` | Driver declined bid |
| `bid:expired` | `{ bid_id }` | Bid timed out |
| `ride:no_drivers` | `{}` | No drivers available |

#### Server-Emitted Events (to Driver)
| Event | Payload | Description |
|-------|---------|-------------|
| `ride:new_request` | `{ ride_id, pickup, dropoff, fare_cents, rider_rating, expires_at }` | New standard ride request |
| `bid:new_bid` | `{ bid_id, ride_id, pickup, dropoff, bid_cents, standard_fare_cents, rider_rating, expires_at }` | New bid from rider |
| `bid:rider_accepted_counter` | `{ bid_id, amount_cents }` | Rider accepted your counter |
| `bid:rider_declined_counter` | `{ bid_id }` | Rider declined your counter |
| `ride:rider_cancelled` | `{ ride_id }` | Rider cancelled |

---

## 11. Error Handling

### Error Code Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | No valid token |
| `FORBIDDEN` | 403 | Valid token, wrong role |
| `NOT_FOUND` | 404 | Resource does not exist |
| `VALIDATION_ERROR` | 422 | Request body failed validation |
| `RIDE_NOT_FOUND` | 404 | Specific ride not found |
| `BID_BELOW_FLOOR` | 422 | Bid amount below minimum |
| `BID_ABOVE_STANDARD` | 422 | Bid exceeds standard fare |
| `BID_EXPIRED` | 409 | Bid TTL reached before action |
| `RIDE_NOT_ACTIVE` | 409 | Action attempted on wrong ride state |
| `DRIVER_NOT_APPROVED` | 403 | Driver account not yet approved |
| `DRIVER_OFFLINE` | 409 | Driver must be online to receive rides |
| `PAYMENT_FAILED` | 402 | Stripe payment failed |
| `NO_PAYMENT_METHOD` | 422 | Rider has no payment method on file |
| `ZONE_NOT_SERVED` | 422 | Pickup or dropoff outside service zone |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error (logged to Sentry) |

### Validation Errors
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": {
      "bid_amount_cents": ["Bid amount must be at least $12.00 (1200 cents)"]
    }
  }
}
```

---

## 12. Rate Limits

| Endpoint Group | Limit | Window |
|----------------|-------|--------|
| Auth (OTP request) | 5 requests | per phone per 15 minutes |
| Auth (OTP verify) | 5 attempts | per OTP (then OTP invalidated) |
| Fare estimate | 30 requests | per user per minute |
| Ride creation | 5 requests | per user per minute |
| Bid submission | 10 requests | per user per minute |
| General API | 120 requests | per user per minute |
| Admin API | 300 requests | per admin per minute |
| SOS endpoint | No limit | Safety-critical — never rate limit |
| Stripe webhooks | No limit | Verified by signature, not rate-limited |

Rate limit headers are included on all responses:
```
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 118
X-RateLimit-Reset: 1750000060
```

When exceeded:
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please slow down.",
    "retry_after": 42
  }
}
```

---

*This document requires founder approval before development begins.*
*After approval, these endpoints will be implemented in NestJS controllers with full validation, guards, and Swagger documentation.*
