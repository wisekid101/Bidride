# BidRide Gap Analysis Report

> **Date:** 2026-06-24
> **Audited Against:** legal-safety-requirements.md, technical-architecture.md, database-architecture.md, api-architecture.md
> **Codebase:** Wisekid101/Bidride — commit 7992fdf (16 commits, tags: v0.1.0-sprint1, v0.9-readiness-validated)
> **Status:** FOUNDER REVIEW REQUIRED before any development proceeds

---

## EXECUTIVE SUMMARY

The existing codebase is substantially more built than expected. It contains 11 NestJS microservices, a full Prisma schema (35+ models), React Native mobile apps, a Next.js admin portal, Terraform infrastructure, and a complete CI/CD pipeline. The overall architecture is more advanced than the modular monolith recommended in the architecture doc — and that's not a problem. It's a head start.

**The single most critical gap: BidRide's core differentiator — the bid flow — has a complete database schema but zero API endpoints.** The codebase, without bid endpoints, is a well-built Uber clone. The bid flow is what makes it BidRide.

**Estimated overall completion: ~68%**

---

## A. FEATURES ALREADY IMPLEMENTED

### Authentication & Identity
- Phone OTP via Twilio — fully implemented
- JWT access + refresh token rotation — implemented in `auth-service`
- MFA: TOTP (Google Authenticator-style) + FIDO2/YubiKey — implemented in `mfa.service.ts`
- Role-based JWT payload (`rider`, `driver`, `admin`) — enforced on all routes

### Trip Lifecycle
- Complete state machine: `searching → accepted → driver_en_route → driver_arrived → in_progress → completed/cancelled/no_show`
- Invalid transition enforcement via `assertValidTransition()`
- **Race condition prevention**: atomic Redis `SET NX` claim — when two drivers accept simultaneously, only one wins. The other gets `TRIP_ALREADY_CLAIMED`. This is production-grade.
- No-show handling after 5-minute wait
- Night ride detection (10pm–5am) with automatic safety check-in
- Airport trip auto-detection from address string

### Earnings Floor (BidRide's Driver Protection Feature)
- Implemented exactly per CLAUDE.md formula: `(distance_miles × $1.10) + (duration_min × $0.22) + $2.50`
- Formula is configurable via `PlatformConfig` (only Founder can change it)
- Platform absorbs supplement — driver always earns at least the floor
- Every supplement logged to `earnings_floor_logs` table for audit

### Pricing Engine
- Hybrid AI + rule-based fare calculation in `fare-engine.service.ts`
- AI component: AWS SageMaker integration with ±$2.00 cap on AI adjustment
- Rule base: `$2.50 base + ($1.10/mile) + ($0.22/min) + airport premium ($3.50) + night premium ($1.00)`
- Surge multiplier from Redis (zone-based demand score)
- `POST /pricing/estimate` endpoint implemented

### Payments
- Stripe Connect: rider payment methods, charge on trip completion
- Driver instant payout: $0.99 fee, $10 minimum, $500 daily cap, 2-hour hold on recent earnings
- Stripe idempotency keys on charge (`charge_{tripId}`) — safe to retry
- Payout history and earnings tracking

### Safety System
- **SOS 3-state** (initiate → 5-second countdown → confirm): implemented in `safety.service.ts`
- **Panic mode** (triple-tap, single vibration, no visual change, NOT in accessibility tree): implemented in rider-app
- Audio recording: starts ONLY on SOS confirmation, stored encrypted to S3
- Safe check-ins for night rides (must respond within 5 minutes)
- Trusted contacts: notify on SOS, optional notify on night rides
- Safety sessions created automatically on every trip
- SLA monitoring: 90-second admin response SLA on SOS events

### Trust & Fraud
- Trust score engine (0–1000 internal scale — never exposed to users)
- Fraud probability (0–100 internal — never exposed to users)
- **4 badge system only**: Verified, Trusted, VIP (drivers); Verified, Trusted, Business, VIP (riders)
- Auto-hold at fraud_probability ≥ 90% — human admin required to lift
- Device fingerprinting for multi-account detection
- Multi-account link graph (shared device, phone, payment, IP)

### Airport / EWR
- **FIFO queue via Redis sorted set** (`queue:ewr` key, score = join timestamp)
- FlightAware API integration with 30-second cache
- 10-minute advance notice before dispatch
- Airport queue DB persistence (`airport_queue_entries`)

### Notifications
- FCM push (Firebase) for iOS and Android
- Twilio SMS for OTP and critical alerts
- AWS SES for transactional email (not SendGrid as architecture doc stated — SES is the better choice for cost at this scale)

### Driver Onboarding
- 6-screen onboarding flow in driver-app
- Document upload via S3 presigned URLs (never passes files through backend)
- Checkr background check ID tracked in `Driver` model
- Vehicle management with inspection status
- 6-step onboarding progress: `personal_info → documents → vehicle → background_check → bank_account → complete`

### Admin System
- 8-tier role hierarchy: `founder → super_admin → operations_admin → safety_admin → driver_approval_admin → fraud_admin → support_admin → analytics_admin`
- Founder-only protection on earnings floor formula via Founder JWT guard
- Audit logs on all sensitive admin actions
- Admin portal: Dashboard, Safety Center, Driver Management, Fraud, Earnings Floor, Refunds

### Database
- 35+ Prisma models covering all core domains
- Soft deletes (`deletedAt`) on User model
- Immutable financial records (payments, payouts never updated)
- UUID primary keys throughout
- Compound indexes on high-query paths (trips by driver/status, trust scores)

### Infrastructure & DevOps
- GitHub Actions CI/CD: lint → typecheck → unit tests → integration tests (with Postgres + Redis containers) → E2E Playwright → staging auto-deploy → production deploy with manual approval gate + RDS snapshot
- Terraform: ECS Fargate, RDS Multi-AZ, ElastiCache, S3, SQS, ALB, WAF
- Docker template for all services

---

## B. FEATURES PARTIALLY IMPLEMENTED

### Bid Flow — Schema Ready, API Missing
- **What exists:** `Bid` model in Prisma schema with all needed fields (`riderOffer`, `counterOffer`, `counterRound`, `status`, `expiresAt`)
- **What's missing:** No bid controller. No bid endpoints. No bid expiration job. No bid state machine.
- **Evidence:** Trip service comment says `"bid resolves separately"` — but no bid resolution service exists
- **Impact:** CRITICAL — This is BidRide's entire differentiator

### Driver Location & Dispatch
- **What exists:** `DispatchService` publishes ride requests to Redis `dispatch:requests` channel. WebSocket gateway subscribes to Redis and fans out to connected drivers.
- **What's missing:** No `POST /driver/location` endpoint for drivers to send GPS updates. No real-time rider location tracking screen working end-to-end. No geospatial radius query — dispatch broadcasts to ALL connected drivers regardless of location.
- **Impact:** HIGH — Without location updates, riders can't track drivers

### Geofencing / Service Zones
- **What exists:** Coordinates stored as `Decimal(9,6)`. `isAirportTrip` detected via address string matching.
- **What's missing:** No `service_zones` table. No geofencing. No Newark city limits enforcement. EWR zone is a text match, not a geospatial boundary.
- **Impact:** HIGH — Riders outside the service area can request rides

### Stripe Webhook Handler
- **What exists:** Stripe payment intents created with idempotency keys
- **What's missing:** No incoming `POST /webhooks/stripe` endpoint. No Stripe signature verification. No handling of `payment_intent.succeeded`, `transfer.paid`, or `transfer.failed` events from Stripe.
- **Impact:** HIGH — Payment confirmations are never received from Stripe

### Surge Pricing
- **What exists:** Surge multiplier logic in `fare-engine.service.ts`, surge zone score read from Redis
- **What's missing:** `GET /pricing/surge/:area` returns hardcoded `{ multiplier: 1.0 }`. No demand monitoring job that writes surge scores to Redis.
- **Impact:** MEDIUM — Surge pricing never activates

### Mobile App Screens (Stubs)
- Several screens exist as files but contain only 2–3 lines of placeholder code
- `app/airport-mode.tsx`, `app/in-trip.tsx`, `app/incoming-request.tsx` in driver-app are thin wrappers around screen components
- Core logic is in `/src/screens/` — the `app/` router layer is partially wired

---

## C. MISSING FEATURES

| Feature | Priority | Notes |
|---------|----------|-------|
| **Bid API endpoints** (submit, accept, decline, counter, cancel, expire) | CRITICAL | BidRide's core differentiator. Schema ready. Zero API. |
| **Bid expiration job** (BullMQ/cron — expire pending bids after TTL) | CRITICAL | Without this, bids never expire |
| **Driver location update endpoint** (`POST /driver/location`) | HIGH | Drivers can't broadcast position |
| **Real-time rider location tracking** (WebSocket → rider screen) | HIGH | Rider can't see driver moving |
| **Stripe webhook handler** | HIGH | Stripe confirmations never received |
| **Bid floor in fare estimate response** | HIGH | Required for rider to know minimum bid |
| **In-app messaging** (rider ↔ driver within trip) | MEDIUM | No ride_messages table or API |
| **Service zone geofencing** | MEDIUM | Anyone anywhere can request a ride |
| **Account deletion endpoint** (user right to delete) | MEDIUM | Privacy compliance |
| **Data retention automation** | MEDIUM | No archival or purge jobs |
| **NJ TNC compliance report** | MEDIUM | Required for NJMVC |
| **Port Authority EWR fee remittance** | MEDIUM | Required for airport operations |
| **W-9 / 1099-K workflow** | MEDIUM | IRS requirement for driver earnings |
| **FCRA adverse action letter** | MEDIUM | Required when driver denied via background check |
| **Demand monitoring job** (writes surge scores to Redis) | LOW | Required for surge to work |
| **Continuous driver MVR monitoring** | LOW | Annual minimum, continuous recommended |
| **Trip route snapshot** (GPS breadcrumb trail per trip) | LOW | Safety and dispute resolution |
| **Rate rider** (driver rating rider) | LOW | Partially there — driver→rider rating in Trip model but no exposed endpoint |

---

## D. ARCHITECTURE CONFLICTS

### CONFLICT 1 — Microservices vs Modular Monolith
| | Architecture Doc | GitHub Codebase |
|---|---|---|
| **Recommended** | Modular monolith at MVP | 11 separate NestJS microservices |
| **Risk** | Re-evaluate at 10K MAU | Already at microservice complexity |
| **Verdict** | Not a problem — it's ahead. Microservices are built and working. But operational complexity (inter-service auth, distributed tracing, service discovery) must be managed. |

### CONFLICT 2 — PostGIS NOT Used ⚠️
| | Architecture Doc | GitHub Codebase |
|---|---|---|
| **Location type** | `GEOGRAPHY(POINT, 4326)` — PostGIS | `Decimal(9,6)` lat/lng columns |
| **Proximity query** | PostGIS `ST_DWithin()` with spatial index | Redis pub/sub broadcast to all drivers |
| **Geofencing** | `GEOGRAPHY(POLYGON)` service zones | Not implemented |
| **Impact** | HIGH — Without PostGIS, true geospatial queries (radius search, polygon containment) are unavailable. Dispatch broadcasts to ALL connected drivers, not nearby ones. |
| **Fix** | Enable PostGIS on RDS. Add migration to convert Decimal columns to GEOGRAPHY type. Or: use Haversine math in application layer (simpler, less accurate). |

### CONFLICT 3 — Amounts: Decimal vs Integer Cents
| | Architecture Doc | GitHub Codebase |
|---|---|---|
| **Storage** | INTEGER cents (avoid float) | `Decimal(8,2)` in Prisma |
| **Stripe calls** | Already in cents | Converted at API call boundary (`Math.round(amount * 100)`) |
| **Risk** | Low — Prisma Decimal avoids IEEE 754 float issues. Conversion is consistent. |
| **Verdict** | Acceptable deviation. No data integrity issue if conversions are consistent. |

### CONFLICT 4 — Email Provider
| | Architecture Doc | GitHub Codebase |
|---|---|---|
| **Provider** | SendGrid | AWS SES |
| **Verdict** | Non-issue. AWS SES is cheaper and already integrated with the AWS infrastructure stack. |

### CONFLICT 5 — Users Table Structure
| | Architecture Doc | GitHub Codebase |
|---|---|---|
| **Design** | Single `users` table, role column | `User` + `Rider` + `Driver` models (3 tables) |
| **Verdict** | GitHub's approach is better — cleaner normalization, each profile type can have its own fields. Accept GitHub's design. |

---

## E. SECURITY CONCERNS

### 🔴 CRITICAL — WebSocket CORS Allows Any Origin
- **File:** `services/auth-service/src/websocket/websocket.gateway.ts:18`
- **Code:** `cors: { origin: '*', credentials: true }`
- **Risk:** Any website can connect to the BidRide WebSocket server. Combined with JWT auth this is medium risk, but `credentials: true` with `origin: '*'` is explicitly disallowed by the CORS spec in browsers — this will cause failures in production and is a misconfiguration.
- **Fix:** Set to `origin: process.env.ALLOWED_ORIGINS?.split(',')` (same pattern as REST services)

### 🔴 HIGH — SSN Transmitted Without Confirmed Encryption
- **File:** `services/driver-service/src/drivers/dto.ts`
- **Code:** DTO validates full 9-digit SSN and passes it through the service
- **Risk:** Architecture doc required application-level AES-256 encryption before DB storage. No encryption wrapper found in driver service. If SSN is stored in plaintext, this is a serious compliance violation.
- **Fix:** Encrypt SSN before writing to DB using a KMS-managed key. Or: pass SSN directly to Checkr (never store it at all — preferred approach).

### 🔴 HIGH — No Stripe Webhook Signature Verification
- **Risk:** Without verifying `Stripe-Signature` header on incoming webhooks, any attacker can POST fake payment success events to BidRide's payment handler.
- **Fix:** Implement `POST /webhooks/stripe` with `stripe.webhooks.constructEvent(body, sig, secret)` before processing any webhook event.

### 🟡 MEDIUM — MFA Not Enforced on Admin Login
- **What exists:** MFA implemented (TOTP + FIDO2)
- **Risk:** MFA appears to be optional. Admin accounts with access to safety recordings, financial data, and driver SSNs should require MFA unconditionally.
- **Fix:** Add MFA enforcement guard on all admin routes. First admin login after MFA is enabled must complete MFA setup before accessing any admin function.

### 🟡 MEDIUM — Bid Floor Not Validated Server-Side (When Implemented)
- **Risk:** When bid endpoints are built, the bid floor must be enforced server-side. A malicious client could submit a bid below the floor if only client-side validation exists.
- **Fix:** When building bid endpoints, validate `bid_amount >= bid_floor` and `bid_amount <= standard_fare` server-side before creating any Bid record.

### 🟢 LOW — Hardcoded Placeholder Email on User Creation
- **File:** `services/auth-service/src/auth/auth.service.ts:41`
- **Code:** `email: \`${phone.replace(/\D/g, '')}@placeholder.bidride.com\``
- **Risk:** Low — but these placeholder emails could trigger email deliverability issues and should be replaced with `null` (email field is already nullable).

---

## F. LEGAL / COMPLIANCE GAPS

### 🔴 CRITICAL — No NJ TNC Compliance Module
- NJ law requires BidRide to maintain records of all rides and make them available to NJMVC on request
- No reporting endpoint, no compliance export, no NJMVC registration tracking in the codebase
- **Required before launch:** Admin portal must include a compliance reporting section that can export ride records in NJMVC-required format

### 🔴 HIGH — Port Authority EWR Fee Tracking & Remittance
- EWR charges per-trip fees that BidRide must collect and remit to the Port Authority
- `isAirportTrip` is tracked, but no dedicated EWR fee ledger or Port Authority remittance report exists
- **Required before EWR launch:** Add EWR fee line item to payment flow, build remittance report for Port Authority

### 🔴 HIGH — FCRA Adverse Action Workflow Incomplete
- When a driver's background check fails, FCRA law requires: pre-adverse action notice → waiting period → final adverse action letter → right to dispute
- Checkr ID is stored in `Driver` model but no adverse action letter generation or workflow is implemented
- **Required before onboarding any drivers**

### 🔴 HIGH — Driver SSN Encryption
- Full SSN passes through DTO. Architecture doc required AES-256 encryption at application layer.
- Preferred fix: pass SSN directly to Checkr and never store it. Store only Checkr candidate ID.

### 🟡 MEDIUM — W-9 / 1099-K Workflow Missing
- Drivers earning over $5,000/year require IRS Form 1099-K
- No W-9 collection step in driver onboarding
- Stripe Connect handles some of this, but BidRide must confirm W-9 is collected before first payout
- **Required before first driver payout**

### 🟡 MEDIUM — Data Deletion Endpoint Missing
- NJ Privacy Act and best practice requires users to be able to request account deletion
- `deletedAt` field exists on User model but no deletion endpoint, no PII anonymization job, no purge workflow
- **Required for compliance launch**

### 🟡 MEDIUM — Zero-Tolerance Policy Documentation in App
- NJ TNC law requires that zero-tolerance policy be disclosed to ALL drivers in writing and that drivers acknowledge it
- Onboarding flow needs an explicit acknowledgment screen with zero-tolerance language
- **Required before any driver is activated**

### 🟢 LOW — Audio Recording Consent
- NJ wiretapping law requires all-party consent in some contexts
- Safety recording is triggered by SOS confirmation (consent implied by initiating SOS)
- Verify this consent model with NJ attorney before launch

---

## G. TECHNICAL DEBT

| Debt Item | Severity | Location |
|-----------|----------|----------|
| WebSocket CORS `origin: '*'` | HIGH | `auth-service/src/websocket/websocket.gateway.ts:18` |
| SSN transmitted without confirmed encryption | HIGH | `driver-service/src/drivers/dto.ts` |
| Stripe webhook handler missing | HIGH | `payment-service/` — endpoint doesn't exist |
| Bid API — schema exists, zero API layer | HIGH | No bid controller anywhere in codebase |
| Dispatch broadcasts to ALL drivers (no geo filter) | HIGH | `trip-service/src/trips/dispatch.service.ts` |
| No driver location update endpoint | HIGH | No `POST /driver/location` route exists |
| Surge endpoint returns hardcoded `1.0` | MEDIUM | `pricing-service/src/pricing/pricing.controller.ts:35` |
| `App.js` root file (legacy leftover) | LOW | `./App.js` — not referenced by monorepo |
| Placeholder email on user creation | LOW | `auth-service/src/auth/auth.service.ts:41` |
| No bid expiration job | HIGH | BullMQ/cron job needed for bid TTL |
| `RideType` enum has `priority` and `premium` but architecture defines standard-only for MVP | LOW | `packages/database/prisma/schema.prisma` |

---

## H. ESTIMATED COMPLETION PERCENTAGE

| Domain | Complete | Notes |
|--------|----------|-------|
| Database / Schema | 95% | Exceptional. Covers all core + advanced features. |
| Authentication | 90% | OTP, JWT, MFA all working. Minor placeholder email issue. |
| Trip Core Flow | 85% | State machine, race prevention, floor, ratings. Missing bid resolution. |
| **Bid Flow** | **20%** | **Schema only. No API. No expiration job. No state machine.** |
| Payments | 65% | Charge and payout work. Stripe webhook missing. W-9 missing. |
| Safety | 90% | SOS, panic, recording, check-ins all implemented correctly. |
| Notifications | 85% | FCM, SMS, SES all working. |
| Trust & Fraud | 80% | Score engine, badge system, auto-hold all implemented. |
| Airport / EWR | 65% | Queue and FlightAware exist. Fee remittance and compliance missing. |
| Geospatial / Location | 30% | No PostGIS. No driver location endpoint. No geofencing. |
| Admin Portal | 75% | 6 sections live. Compliance reporting missing. |
| Mobile Apps (Rider) | 65% | Core screens exist. Bid screen is present but backend is missing. |
| Mobile Apps (Driver) | 70% | Core screens + onboarding. Location updates missing. |
| CI/CD Pipeline | 90% | Full pipeline working. Secrets configuration documented. |
| Infrastructure (Terraform) | 80% | ECS, RDS, ElastiCache, WAF. Needs env validation. |
| Legal / Compliance | 15% | Structure exists. Zero NJ-specific compliance modules. |

### **Overall Estimated Completion: ~68%**

---

## RECOMMENDED NEXT DEVELOPMENT PRIORITY

Based on the audit, the recommended sequence is:

### Priority 1 — Bid Flow (BidRide's Core Differentiator)
The bid flow has a complete database schema but zero API layer. This is the highest priority because without it, BidRide has no competitive differentiation from Uber/Lyft.

Build in this order:
1. `POST /trips` — bid variant (already partially handled in `CreateTripDto`)
2. `POST /bids/:id/accept` (driver accepts rider's bid)
3. `POST /bids/:id/decline` (driver declines)
4. `POST /bids/:id/counter` (driver counters — enforce server-side limits)
5. `POST /bids/:id/accept` (rider accepts counter)
6. `POST /bids/:id/cancel` (rider cancels before response)
7. Bid expiration BullMQ job (TTL enforcement)
8. WebSocket events for the full bid negotiation flow

### Priority 2 — Driver Location & Real-Time Tracking
Without GPS updates from drivers, the app cannot show riders where their driver is.

Build:
1. `POST /driver/location` — driver sends GPS every 4 seconds
2. Redis key: `driver:location:{driverId}` with 30-second TTL
3. WebSocket broadcast of location to rider's trip room
4. Geo-filter on dispatch (only notify drivers within 5-mile radius)

### Priority 3 — Security Fixes (Non-Negotiable Before Any Beta)
1. Fix WebSocket CORS (30 minutes)
2. Add Stripe webhook handler with signature verification
3. Confirm or fix SSN encryption before any driver data is accepted

### Priority 4 — Legal/Compliance Foundations
1. FCRA adverse action workflow (before first driver is onboarded)
2. Zero-tolerance acknowledgment screen in driver onboarding
3. W-9 collection before first payout
4. Account deletion endpoint

---

*This report was produced by auditing the full GitHub codebase against the BidRide architecture and legal research documents. All findings require founder review before development actions are taken.*
*Produced: 2026-06-24*
