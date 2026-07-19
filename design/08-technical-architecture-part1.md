# BidiRide — Technical Architecture v1.0 · Part 1: System Architecture

**Status:** Draft — Pending Founder Approval
**Document:** 08-A · Part 1 of 5
**References:** 02-product-requirements-document-v1.md §14 · 00c-trust-score-engine.md · 00d-safety-shield-system.md

---

## Document Map

| Part | Contents | File |
|---|---|---|
| **Part 1 (this)** | System Architecture · Services · Communication | 08-technical-architecture-part1.md |
| Part 2 | Database Architecture · Full PostgreSQL Schema | 08-technical-architecture-part2.md |
| Part 3 | API Architecture · REST · WebSocket · Auth | 08-technical-architecture-part3.md |
| Part 4 | AI Architecture · 5 AI Engines | 08-technical-architecture-part4.md |
| Part 5 | Deployment · AWS · CI/CD · Environments | 08-technical-architecture-part5.md |

---

## System Overview

```
╔═══════════════════════════════════════════════════════════════════════╗
║                      BIDIRIDE SYSTEM ARCHITECTURE                    ║
╠═══════════════════════╦═══════════════════════╦═══════════════════════╣
║   CLIENT LAYER        ║   GATEWAY LAYER       ║   SERVICE LAYER       ║
║                       ║                       ║                       ║
║  [Rider App]          ║   AWS API Gateway     ║  [Trip Service]       ║
║  React Native + Expo  ║   + WAF               ║  [Driver Service]     ║
║                       ║   Rate limiting       ║  [Rider Service]      ║
║  [Driver App]         ║   Auth middleware     ║  [Auth Service]       ║
║  React Native + Expo  ║   TLS termination     ║  [Pricing AI Service] ║
║                       ║   WebSocket upgrade   ║  [Safety Service]     ║
║  [Admin Portal]       ║                       ║  [Payment Service]    ║
║  Next.js (web)        ║   ───────────────     ║  [Notification Svc]  ║
║                       ║                       ║  [Trust Score Svc]   ║
╠═══════════════════════╬═══════════════════════╬═══════════════════════╣
║   DATA LAYER          ║   AI LAYER            ║   EXTERNAL SERVICES   ║
║                       ║                       ║                       ║
║  PostgreSQL (primary) ║  [Fare Engine]        ║  Stripe (payments)    ║
║  Redis (cache/RT)     ║  [Demand Forecast]    ║  Checkr (bg checks)   ║
║  S3 (files/recording) ║  [Driver Position]    ║  Twilio (SMS/calls)   ║
║  ElasticSearch (logs) ║  [Airport Queue AI]   ║  Firebase (push)      ║
║                       ║  [Safety Monitor]     ║  Google Maps          ║
║                       ║  [Fraud Detector]     ║  Mapbox               ║
║                       ║  [Trust Scorer]       ║  FlightAware (flights)║
╚═══════════════════════╩═══════════════════════╩═══════════════════════╝
```

---

## Client Applications

### Rider App + Driver App — React Native + Expo

| Attribute | Specification |
|---|---|
| Framework | React Native 0.74+ with Expo SDK 51 |
| Navigation | React Navigation v6 (stack + bottom tabs) |
| State management | Zustand (lightweight, no boilerplate) |
| Real-time | WebSocket client via `socket.io-client` |
| Maps | React Native Maps + Google Maps SDK |
| Payments | Stripe React Native SDK |
| Push notifications | Expo Notifications (wraps APNs + FCM) |
| Camera | Expo Camera (document uploads, profile photos) |
| Location | Expo Location (background GPS during trips) |
| Build | EAS Build (Expo Application Services) |
| OTA updates | Expo Updates (JS bundle updates without App Store resubmit) |

**Background location (critical for trips):**
- iOS: `UIBackgroundModes: location` in Info.plist
- Android: foreground service with persistent notification during active trip
- Location update interval: 3 seconds during active trip · 10 seconds while online-idle
- GPS data never stored raw on device — streamed to Trip Service immediately

### Admin Portal — Next.js

| Attribute | Specification |
|---|---|
| Framework | Next.js 14 (App Router) |
| UI library | Tailwind CSS + shadcn/ui |
| State | React Query (server state) + Zustand (UI state) |
| Real-time | Socket.io client (Safety dashboard, Live Ops) |
| Auth | NextAuth.js + custom JWT + TOTP/YubiKey |
| Charts | Recharts |
| Deployment | AWS Amplify or Vercel (admin-only subdomain) |

---

## Backend Services

All backend services use **NestJS** (TypeScript). Chosen for: built-in dependency injection, decorator-based architecture, strong typing, first-class WebSocket support, and compatibility with the team's TypeScript stack.

| Service | Responsibility | Port (internal) |
|---|---|---|
| **API Gateway** | Route to services, auth, rate limiting, WebSocket upgrade | 443 (public) |
| **Auth Service** | JWT issuance, refresh, MFA verification, session management | 3001 |
| **Trip Service** | Trip lifecycle, dispatch, state machine, fare finalization | 3002 |
| **Driver Service** | Driver CRUD, document management, approval flow, performance | 3003 |
| **Rider Service** | Rider CRUD, payment methods, rewards, trust inputs | 3004 |
| **Pricing Service** | AI fare calculation, bid validation, earnings floor enforcement | 3005 |
| **Safety Service** | SOS/panic, safety sessions, recording triggers, admin alerts | 3006 |
| **Payment Service** | Stripe integration, payouts, instant payouts, refunds | 3007 |
| **Notification Service** | Push (FCM/APNs), SMS (Twilio), email (SES), trusted contacts | 3008 |
| **Trust Service** | Trust score calculation, badge assignment, fraud scoring | 3009 |
| **Airport Service** | Queue management, flight data ingestion, EWR dispatch | 3010 |
| **Admin Service** | Admin-only APIs, audit logging, analytics aggregation | 3011 |

**Inter-service communication:**
- Synchronous: REST over internal VPC (no public exposure)
- Asynchronous: AWS SQS queues for non-critical events (rating updates, email sends, analytics)
- Real-time broadcast: Redis Pub/Sub → WebSocket gateway

---

## Communication Patterns

### Client → Backend
```
Client (Rider/Driver App)
  → HTTPS + JWT Bearer token
  → AWS API Gateway (TLS termination, WAF, rate limit)
  → Load balancer (ALB)
  → Target service (NestJS)
  → PostgreSQL / Redis
```

### Real-Time (WebSocket)
```
Client connects: wss://api.bidiride.com/ws
  → Authenticates with JWT on connect
  → Subscribes to channels:
      driver:{driver_id}   — incoming requests, dispatch, trip state
      rider:{rider_id}     — driver location, trip state, ETA
      admin:{admin_id}     — live ops feed, safety alerts

Safety Service publishes: Redis Pub/Sub → channel → WebSocket gateway → client
Trip Service publishes: GPS updates every 3s → rider and trusted contacts
```

### Service → External APIs
```
Payment Service  → Stripe API (idempotency keys on all writes)
Driver Service   → Checkr API (background check orders)
Safety Service   → Twilio (SOS SMS to trusted contacts)
Notification Svc → Firebase FCM (push) + APNs (iOS push) + AWS SES (email)
Airport Service  → FlightAware API (flight status) — 30s polling, cached in Redis
```

---

## Data Layer

### PostgreSQL — Primary Database
- Version: PostgreSQL 15
- Hosting: AWS RDS Multi-AZ (automatic failover, < 30s RTO)
- Read replicas: 2 (analytics queries, admin read-heavy operations)
- Encryption: AES-256 at rest, TLS in transit
- Backups: Automated daily snapshots retained 30 days + PITR (point-in-time recovery)
- Connection pooling: PgBouncer (transaction mode, max 100 connections per service)

### Redis — Cache and Real-Time State
- Version: Redis 7
- Hosting: AWS ElastiCache (cluster mode, 3 nodes)
- Uses:

| Key pattern | Data | TTL |
|---|---|---|
| `driver:{id}:state` | Current shift state (enum) | Session |
| `driver:{id}:location` | Last known GPS `{lat,lng,ts}` | 10 seconds |
| `trip:{id}:state` | Safety state machine value | Trip duration |
| `queue:ewr` | Sorted set: driver queue positions | Session |
| `surge:{area}` | Surge multiplier for zone | 5 minutes |
| `flight:{flight_id}` | Cached FlightAware response | 30 seconds |
| `session:{token}` | Admin session data | 8 hours |
| `otp:{phone}` | OTP code + attempt count | 5 minutes |
| `ratelimit:{ip}:{endpoint}` | Request count | 1 minute |

### Amazon S3 — Object Storage

| Bucket | Contents | Access |
|---|---|---|
| `bidride-driver-documents` | License, insurance, vehicle photos | Private — signed URL only |
| `bidride-safety-recordings` | SOS audio recordings | Private — admin dual-auth |
| `bidride-profile-photos` | Driver + rider profile photos | Private — signed URL |
| `bidride-exports` | Admin CSV exports | Private — 24h expiry |
| `bidride-tax-documents` | 1099 PDFs | Private — driver signed URL |

---

## External Service Integration Map

| Service | Provider | Used by | Auth |
|---|---|---|---|
| Payments + payouts | Stripe | Payment Service | API key + webhook secret |
| Background checks | Checkr | Driver Service | API key |
| SMS + masked calls | Twilio | Notification Service + Safety | Account SID + auth token |
| Push notifications | Firebase FCM | Notification Service | Service account JSON |
| iOS push | Apple APNs | Notification Service | P8 key |
| Email | AWS SES | Notification Service | IAM role |
| Maps (rider/driver) | Google Maps SDK | Mobile apps | API key (restricted) |
| Maps (fallback) | Mapbox | Mobile apps | Access token |
| Flight data | FlightAware AeroAPI | Airport Service | API key |
| AI/ML runtime | AWS SageMaker | AI Services | IAM role |

---

## Continuation Notes — Part 2 Covers

- Complete PostgreSQL schema (all 25+ tables with columns, types, constraints)
- Foreign key relationships and ER diagram (ASCII)
- Indexing strategy (performance-critical indexes)
- Partitioning strategy (trips table by month)
- Soft-delete patterns

---

*BidiRide Technical Architecture — Part 1 of 5 — Confidential · Delaware LLC*
