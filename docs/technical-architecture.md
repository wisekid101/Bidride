# BidRide Technical Architecture

> **Status: DRAFT — Awaiting founder approval before development begins**
> **Last updated: 2026-06-24**

---

## TABLE OF CONTENTS
1. [Architecture Philosophy](#1-architecture-philosophy)
2. [System Overview](#2-system-overview)
3. [Tech Stack Decisions](#3-tech-stack-decisions)
4. [Application Layer](#4-application-layer)
5. [Backend Services](#5-backend-services)
6. [Real-Time Layer](#6-real-time-layer)
7. [Infrastructure & Cloud](#7-infrastructure--cloud)
8. [Third-Party Integrations](#8-third-party-integrations)
9. [Security Architecture](#9-security-architecture)
10. [Scalability Plan](#10-scalability-plan)

---

## 1. Architecture Philosophy

### Core Principles
1. **Safety over speed** — never ship a feature that could compromise rider or driver safety
2. **Security by default** — encryption, least-privilege access, and input validation are not optional
3. **Start simple, scale when proven** — do not over-engineer for scale we don't have yet
4. **Real-time where it matters** — location, bid negotiation, and ride status must be live
5. **Offline resilience** — apps must handle poor network gracefully (NYC/NJ tunnels, airports)
6. **Compliance-first** — architecture must support legal audit, data deletion, and reporting from day one

### Architecture Style
BidRide uses a **modular monolith backend** at launch, structured to split into microservices later.

**Why not microservices from day one?**
- Microservices add operational complexity (service discovery, distributed tracing, inter-service auth)
- At MVP scale (Newark only), a well-structured monolith is faster to build and easier to debug
- The codebase is organized as if it were microservices (separate modules, no cross-module DB joins) — splitting later requires changing deployment, not rewriting logic
- Re-evaluate at 10,000 monthly active users or when team exceeds 5 engineers

---

## 2. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Rider App   │  │  Driver App  │  │    Admin Portal      │  │
│  │ (React Native│  │ (React Native│  │      (React Web)     │  │
│  │  iOS/Android)│  │  iOS/Android)│  │                      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
└─────────┼─────────────────┼──────────────────────┼─────────────┘
          │                 │                       │
          ▼                 ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API GATEWAY (AWS API Gateway / Nginx)       │
│         Rate limiting │ Auth validation │ SSL termination        │
└───────────────────────────────┬─────────────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   REST API       │  │  WebSocket       │  │  Admin REST API  │
│   (Node.js /     │  │  Server          │  │  (same backend,  │
│   NestJS)        │  │  (Socket.io)     │  │  admin routes)   │
└────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
         │                     │                      │
         └─────────────────────┼──────────────────────┘
                               │
         ┌─────────────────────┼──────────────────────┐
         ▼                     ▼                      ▼
┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  PostgreSQL  │    │     Redis        │    │  Message Queue   │
│  (Primary DB)│    │ (Cache/Sessions/ │    │  (BullMQ/Redis)  │
│  + PostGIS   │    │  Pub/Sub)        │    │                  │
└──────────────┘    └──────────────────┘    └──────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│                     EXTERNAL SERVICES                             │
│  Stripe Connect │ Checkr │ Google Maps │ Firebase FCM │ Twilio   │
│  AWS S3         │ SendGrid│ RapidSOS    │ Sentry       │          │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Tech Stack Decisions

### Mobile Apps (Rider & Driver)

**Decision: React Native**

| Option | Pros | Cons |
|--------|------|------|
| **React Native** ✓ | Single codebase for iOS + Android; large talent pool; mature ecosystem; Expo for rapid prototyping | Slightly lower native performance vs. Swift/Kotlin |
| Swift + Kotlin (native) | Best performance, full platform access | Two codebases, 2x development cost, 2x bugs |
| Flutter | Fast, consistent UI | Dart is a smaller talent pool; less mature payments/maps ecosystem |

**Verdict:** React Native. BidRide is a forms + maps + real-time app — React Native handles all three well. Performance difference vs. native is negligible for this use case.

**Framework within React Native:** Expo (managed workflow) for MVP; eject to bare workflow when needed for advanced native features.

### Backend

**Decision: Node.js with NestJS**

| Option | Pros | Cons |
|--------|------|------|
| **NestJS (Node.js)** ✓ | TypeScript-first; opinionated structure (modules/controllers/services); large ecosystem; same language as web frontend; excellent WebSocket support | Single-threaded (mitigated by clustering) |
| Express (Node.js) | Minimal, flexible | No structure — requires discipline to avoid spaghetti code at scale |
| Go | High performance, strong concurrency | Smaller talent pool; fewer rideshare-specific libraries |
| Python/Django | Great for data science integration | Slower for high-concurrency real-time use cases |

**Verdict:** NestJS. Structure matters more than flexibility at this stage. TypeScript across the stack reduces context switching.

### Database

**Decision: PostgreSQL with PostGIS**

- PostgreSQL for all relational data (users, rides, bids, payments)
- PostGIS extension for geospatial queries (driver proximity, geofencing for EWR)
- Redis for: session storage, caching, real-time pub/sub, job queues (via BullMQ)

### Admin Portal

**Decision: React (Next.js)**

- Server-side rendering for fast initial load
- Same language/ecosystem as mobile apps
- Tailwind CSS for rapid UI development

### Language

**TypeScript across the entire stack.** One language, shared types between frontend and backend where possible, fewer runtime errors.

---

## 4. Application Layer

### Rider App — Core Screens

```
Authentication
  ├── Splash / Onboarding
  ├── Sign Up (phone → OTP → name → email → payment)
  └── Sign In (phone → OTP)

Home
  ├── Map view (Google Maps SDK)
  ├── "Where to?" search bar
  └── Saved places (Home, Work)

Booking Flow
  ├── Destination selected → Fare estimate shown
  ├── Ride options (BidRide Standard | Submit a Bid)
  │   ├── Standard: Confirm → Matching → En Route → Ride → Complete
  │   └── Bid:
  │       ├── Enter bid amount (with min/max guidance)
  │       ├── Bid submitted → waiting for driver
  │       ├── Driver accepts → En Route → Ride → Complete
  │       ├── Driver counters → Rider sees counter → Accept/Decline
  │       └── Bid expires or rejected → Standard fare offer or cancel
  └── Payment method selection

Active Ride
  ├── Driver en route view (real-time location)
  ├── Driver ETA
  ├── Driver info card (name, photo, vehicle, plate)
  ├── Contact driver (in-app message)
  ├── Share trip button
  ├── SOS / Emergency button
  └── Cancel ride (with cancellation policy disclosure)

Post-Ride
  ├── Trip summary (route, fare, time)
  ├── Rate driver (1–5 stars + tags)
  ├── Tip option
  └── Receipt (emailed)

Profile / Account
  ├── Payment methods
  ├── Trip history
  ├── Saved places
  ├── Promotions
  └── Settings (notifications, accessibility)
```

### Driver App — Core Screens

```
Authentication / Onboarding
  ├── Sign Up → Multi-step document submission
  ├── Background check status
  └── Sign In

Home (Online/Offline Toggle)
  ├── Map view (driver position)
  ├── Earnings today / week
  └── Go Online / Go Offline toggle

Ride Request Flow
  ├── Incoming standard ride request (accept/decline — timer)
  ├── Incoming bid request
  │   ├── See: pickup, destination, bid amount, rider rating
  │   ├── Accept bid
  │   ├── Decline bid
  │   └── Counter offer (enter counter amount)
  └── Ride accepted → Navigate → Pickup → Start Ride → End Ride

Active Ride
  ├── Navigation (Google Maps turn-by-turn)
  ├── Rider info (name, rating)
  ├── Contact rider (in-app)
  ├── Emergency / SOS
  └── End Ride button

Post-Ride
  ├── Earnings summary for the trip
  ├── Rate rider (1–5 stars)
  └── Report issue

Earnings
  ├── Daily / weekly / monthly breakdown
  ├── Payout schedule and bank account
  └── Tax documents (1099)

Profile / Documents
  ├── Vehicle information
  ├── Insurance documents
  ├── Background check status
  └── Settings
```

### Admin Portal — Core Features

```
Dashboard
  ├── Live map (all active rides, drivers online)
  ├── Today's metrics (rides, revenue, drivers active, riders active)
  └── Alerts (safety incidents, failed payments, low driver supply)

Driver Management
  ├── Driver list (status: pending, active, suspended, deactivated)
  ├── Individual driver profile (documents, ride history, ratings)
  ├── Background check status
  ├── Approve / Suspend / Deactivate
  └── Zero-tolerance reports

Rider Management
  ├── Rider list and search
  ├── Individual rider profile (trip history, payments, disputes)
  └── Account actions (suspend, refund)

Ride Management
  ├── All rides (filter by status, driver, rider, date, amount)
  ├── Individual ride detail (route, fare, bid history, messages)
  └── Dispute resolution

Pricing Controls
  ├── Base fare rates by zone
  ├── Per-mile and per-minute rates
  ├── Bid floor configuration
  └── Demand multiplier rules

Financial
  ├── Revenue by day / week / month
  ├── Driver payouts
  ├── Refund management
  └── Port Authority fee reporting (EWR)

Settings
  ├── Service zones (geofence management)
  └── User management (admin team)
```

---

## 5. Backend Services

BidRide's backend is a NestJS monolith organized into discrete modules. Each module owns its domain and does not reach into another module's database tables directly.

### Module Map

```
src/
  auth/           ← JWT issuance, OTP/SMS verification, session management
  users/          ← Rider and driver profiles, account management
  rides/          ← Ride lifecycle: request → match → active → complete
  bids/           ← Bid creation, counter-offers, expiration, acceptance
  pricing/        ← Fare calculation, bid floor, demand multipliers
  geo/            ← Driver location updates, proximity queries, geofencing
  payments/       ← Stripe integration, escrow holds, payouts, refunds
  notifications/  ← Push (FCM), SMS (Twilio), email (SendGrid)
  safety/         ← SOS events, incident reporting, zero-tolerance reports
  admin/          ← Admin-only routes, reporting, operator actions
  background/     ← Checkr integration, document verification workflow
  jobs/           ← Background job queues (BullMQ): bid expiration, payouts
```

### Key Service Interactions

**Booking a Standard Ride:**
```
Rider requests ride
  → geo service finds nearby drivers
  → pricing service calculates fare
  → rides service creates ride record
  → notifications service pushes to driver
  → driver accepts
  → rides service updates status
  → geo service begins tracking
  → payments service creates hold on rider card
  → ride completes
  → payments service captures payment
  → split: driver earnings + BidRide commission
```

**Bid Flow:**
```
Rider submits bid
  → bids service creates bid record
  → payments service creates authorization hold for standard fare (protect against non-payment)
  → geo service finds drivers for this route
  → notifications service pushes bid to nearby drivers
  → Driver A counters
  → bids service records counter, notifies rider
  → Rider accepts counter
  → bids service marks accepted, triggers rides service
  → payments service adjusts hold to counter-offer amount
  → ride proceeds as standard
```

**Bid Expiration (Background Job):**
```
BullMQ job scheduled when bid is created (TTL: configurable, default 3 min)
  → if bid still in 'pending' status at TTL:
  → bids service marks bid 'expired'
  → payments service releases hold
  → notifications service alerts rider (bid expired, try again or use standard fare)
```

---

## 6. Real-Time Layer

Real-time is the heart of the BidRide experience. Location, bid status, and ride status cannot be delayed.

### Technology: Socket.io (WebSockets)

**Why Socket.io over raw WebSockets:**
- Automatic fallback to long-polling if WebSocket is unavailable (poor signal at EWR)
- Built-in room/namespace management (per-ride rooms for isolated communication)
- NestJS has a native Socket.io gateway module

### Real-Time Event Map

| Event | Direction | Payload |
|-------|-----------|---------|
| `driver.location.update` | Driver → Server → Rider (active ride) | lat, lng, timestamp, bearing |
| `driver.location.broadcast` | Driver → Server → Redis | lat, lng (for proximity queries) |
| `bid.submitted` | Rider → Server → Nearby Drivers | bid amount, pickup, destination |
| `bid.counter` | Driver → Server → Rider | counter amount, driver info |
| `bid.accepted` | Rider → Server → Driver | confirmation |
| `bid.rejected` | Driver → Server → Rider | rejection |
| `bid.expired` | Server → Rider | bid TTL reached |
| `ride.request` | Server → Driver | pickup, destination, fare |
| `ride.accepted` | Driver → Server → Rider | driver ETA, driver info |
| `ride.cancelled` | Either → Server → Other | reason |
| `ride.status` | Server → Rider + Driver | status change events |
| `sos.triggered` | Rider/Driver → Server | location, user info |

### Driver Location Architecture

Driver location updates every 3–5 seconds while online. This must be efficient:

1. Driver app sends GPS coordinates every 4 seconds via WebSocket
2. Server receives → validates → writes to **Redis** (not PostgreSQL) as `driver_location:{driverId}`
3. Redis TTL: 30 seconds (if driver stops sending, location expires — driver treated as offline)
4. Proximity queries use PostGIS on PostgreSQL (updated via async job from Redis every 10 seconds for persistence)
5. Active ride location (shown to rider): delivered directly via WebSocket room, not polled

---

## 7. Infrastructure & Cloud

### Cloud Provider: AWS

**Services used:**

| Service | Purpose |
|---------|---------|
| **EC2** (or ECS Fargate) | Run backend API and WebSocket server |
| **RDS (PostgreSQL)** | Managed PostgreSQL with Multi-AZ for high availability |
| **ElastiCache (Redis)** | Managed Redis for cache, sessions, pub/sub |
| **S3** | Store driver documents (license photos, insurance, vehicle photos) |
| **CloudFront** | CDN for static assets |
| **API Gateway** | Rate limiting, SSL termination for REST endpoints |
| **SQS** | Message queue for async jobs (alternative to BullMQ for production) |
| **Route 53** | DNS management |
| **ACM** | Free SSL certificates |
| **CloudWatch** | Logging and monitoring |
| **Secrets Manager** | Store API keys, DB credentials (never in code) |

### Environments

| Environment | Purpose | Cost Approach |
|-------------|---------|---------------|
| **Development** | Local dev with Docker Compose | No cloud cost — runs on laptop |
| **Staging** | Pre-production testing | Smallest EC2 + RDS instances |
| **Production** | Live system | Right-sized for actual load |

### Docker Strategy
- All services containerized with Docker
- Docker Compose for local development (runs full stack locally: API, PostgreSQL, Redis)
- Production: ECS Fargate (managed containers — no server management)
- Kubernetes: defer until team grows and complexity warrants it

### CI/CD Pipeline
- **GitHub** for source control (monorepo: all apps and services in one repo)
- **GitHub Actions** for CI/CD
  - On PR: run linter, type check, unit tests
  - On merge to main: deploy to staging automatically
  - On tag/release: deploy to production (manual approval gate)

---

## 8. Third-Party Integrations

| Integration | Purpose | Notes |
|-------------|---------|-------|
| **Stripe Connect** | Payments, payouts, marketplace split | Required — do not build custom payment processing |
| **Google Maps Platform** | Maps display, routing, fare distance calculation, ETA | Requires Maps SDK (mobile) + Directions API + Places API |
| **Checkr** | Driver background checks and MVR | FCRA compliant, API-based |
| **Firebase Cloud Messaging (FCM)** | Push notifications (iOS + Android) | Free tier sufficient for MVP |
| **Twilio** | SMS OTP for phone verification | Pay-per-SMS |
| **SendGrid** | Transactional email (receipts, alerts) | Free tier: 100 emails/day |
| **Sentry** | Error tracking and alerting | Catch crashes before riders report them |
| **RapidSOS** | Enhanced emergency dispatch (SOS button) | Integrates with 911 dispatch centers |
| **AWS S3** | Document storage (driver photos, insurance) | Presigned URLs — never expose S3 bucket publicly |

### Google Maps Platform — Required APIs
- Maps SDK for Android and iOS (app map display)
- Directions API (route calculation)
- Distance Matrix API (distance and time for fare calculation)
- Geocoding API (address to lat/lng)
- Places API (autocomplete for destination search)

**Cost note:** Google Maps charges per API call. Budget $200–$500/month for MVP-scale usage. Use caching aggressively to minimize calls.

---

## 9. Security Architecture

### Authentication
- **JWT (JSON Web Tokens)** for API authentication
  - Access token: 15-minute expiry
  - Refresh token: 30-day expiry, stored in httpOnly cookie or secure storage
  - Refresh token rotation: issue new refresh token on each use (invalidate old one)
- **Phone OTP** for account creation and login (Twilio Verify)
- **Driver session:** Additional real-time identity check (selfie match recommended)

### Authorization
- Role-based access control (RBAC): `rider`, `driver`, `admin`, `super-admin`
- Every API endpoint declares required role — enforced by NestJS Guards
- Admin portal: separate JWT secret, separate token expiry (shorter: 8 hours)

### Data Security
- All data encrypted at rest: AWS RDS encryption enabled, S3 server-side encryption
- All data in transit: TLS 1.3 (enforced — reject TLS 1.0 and 1.1)
- Driver SSN stored as encrypted field in database (application-level encryption with separate key)
- API keys, database credentials, and secrets: AWS Secrets Manager (never in `.env` files in production)

### API Security
- Rate limiting on all endpoints (AWS API Gateway + application-level via NestJS throttler)
- Input validation on all request bodies (NestJS class-validator — no raw input reaches the database)
- SQL injection: prevented by TypeORM (parameterized queries — never raw SQL with user input)
- CORS: configured to allow only known app origins
- Helmet.js: security headers on all API responses

### Payment Security
- PCI DSS: BidRide never sees raw card numbers — Stripe handles all card data
- Stripe webhooks: verified by signature before processing
- Payout fraud: verify driver bank account via Stripe micro-deposit or instant verification before first payout

### Monitoring and Alerting
- Sentry: application errors, crash reports
- CloudWatch: infrastructure metrics, unusual traffic patterns
- Set alerts for: spike in 5xx errors, unusual payout volumes, multiple failed auth attempts

---

## 10. Scalability Plan

### MVP Phase (Launch: Newark + EWR)
- Expected: < 500 rides/day
- Infrastructure: single EC2 instance + single RDS instance + ElastiCache
- Cost estimate: ~$200–$400/month
- This is intentionally small — validate the model before scaling infrastructure

### Growth Phase (Newark saturated, preparing to expand)
- Expected: 500–5,000 rides/day
- Move to: ECS Fargate (auto-scaling containers), RDS Multi-AZ, ElastiCache cluster mode
- Add: read replicas for PostgreSQL (separate read-heavy queries)
- Cost estimate: ~$800–$2,000/month

### Scale Phase (Multi-city)
- Consider: Extract highest-traffic services (geo, rides) into separate deployments
- Consider: Dedicated WebSocket cluster
- Consider: PostgreSQL → Citus (distributed PostgreSQL) for geo-sharding
- Cost estimate: Scales with revenue

### The Non-Negotiable Performance Targets
- Fare estimate: < 500ms response time
- Driver match (standard fare): < 5 seconds
- Bid notification to drivers: < 2 seconds from submission
- Driver location update on rider screen: lag < 5 seconds
- SOS event processing: < 1 second (highest priority)

---

*This document requires founder approval before development begins.*
*After approval, the next step is detailed database schema and API specification.*
