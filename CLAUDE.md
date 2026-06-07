# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BidRide — AI-powered rideshare marketplace. Delaware LLC. Launch market: Newark, NJ (EWR airport focus).

## Monorepo Structure

pnpm workspaces + Turborepo:

```
apps/
  rider-app/        React Native + Expo (rider-facing)
  driver-app/       React Native + Expo (driver-facing)
  admin/            Next.js 14 (admin command center)
services/
  auth-service/     NestJS — port 3001
  trip-service/     NestJS — port 3002
  driver-service/   NestJS — port 3003
  rider-service/    NestJS — port 3004
  pricing-service/  NestJS — port 3005
  safety-service/   NestJS — port 3006
  payment-service/  NestJS — port 3007
  notification-service/ NestJS — port 3008
  trust-service/    NestJS — port 3009
  airport-service/  NestJS — port 3010
  admin-service/    NestJS — port 3011
packages/
  database/         Prisma schema + migrations (@bidride/database)
infrastructure/
  terraform/        AWS infrastructure (ECS, RDS, ElastiCache, S3, SQS)
design/             Product specs and architecture documents
```

## Common Commands

```bash
# Install all dependencies
pnpm install

# Run all services in dev mode
pnpm dev

# Run a single service
pnpm --filter @bidride/auth-service dev
pnpm --filter @bidride/trip-service dev

# Database
pnpm db:migrate         # run migrations (dev)
pnpm db:migrate:prod    # run migrations (production)
pnpm db:seed            # seed platform_config + founder admin
pnpm db:studio          # Prisma Studio UI

# Tests
pnpm test               # all unit tests
pnpm --filter @bidride/trip-service test
pnpm turbo run test:int # integration tests (requires PG + Redis)

# Type check
pnpm typecheck

# Mobile apps
pnpm --filter @bidride/rider-app dev
pnpm --filter @bidride/driver-app dev

# Admin portal
pnpm --filter @bidride/admin dev
```

## Design System

- Background: `#0A2342` (Deep Navy)
- Primary/AI: `#00D4C6` (Electric Teal)
- Earnings ONLY: `#F4B400` (Gold) — never use for other UI elements
- Safety/SOS: `#EF4444` (Red) — only for SOS and safety alerts
- Text on dark: `#FFFFFF`
- Text on Teal: `#0A2342` (NAVY — white on teal FAILS WCAG AA)
- Financial figures: `JetBrains Mono` font — all dollar amounts
- Body text: `Inter` font

## Key Business Rules (Non-Negotiable)

**Driver Take-Home:** Always show driver take-home first and largest. Gross fare is secondary.

**Earnings Floor:** `floor = (distance_miles × $1.10) + (duration_min × $0.22) + $2.50`. Platform absorbs supplement. Deterministic — no ML override. Formula changes require signed Founder JWT.

**Trust Scores:** Internal ONLY. Never expose numerical scores to drivers or riders. 4 visible badge labels only: Verified, Trusted, Business (riders), VIP. Anti-discrimination rule.

**Safety:** SOS is 3-state (initiate → 5s countdown → confirm). Panic = triple-tap, single vibration, no visual change, NOT in accessibility tree. Audio recording starts ONLY on SOS confirmation. Safety decisions override all other decisions.

**Fraud:** Auto-hold at fraud_probability ≥ 90%. No automated permanent ban — human admin required.

**Admin roles:** Founder → Super Admin → Operations Admin → Safety Admin → Driver Approval Admin → Fraud Admin → Support Admin → Analytics Admin. Earnings floor formula: Founder only.

**Panic admin payload:** NEVER include riderId, riderName, or riderPhone. Admin must NOT contact the rider during a panic event.

**Airport surge:** Max 2.5×. Admin confirmation required above 1.5×. EWR queue is FIFO via Redis sorted set.

## Code Generation Status

**Complete (production-ready):**
- PostgreSQL schema (Prisma) — all 35+ models
- Auth Service — OTP, JWT, MFA (TOTP + FIDO2), WebSocket gateway
- Trip Service — state machine, earnings floor, race condition prevention
- Pricing Service — FareEngineService (hybrid SageMaker + rule), AI bounded ±$2.00
- Payment Service — Stripe Connect, instant payout ($0.99, $10 min, $500 cap, 2h hold)
- Safety Service — SOS 3-state, panic (PanResponder, no accessibility tree), audio recording
- Notification Service — FCM, Twilio SMS, FCRA adverse action letter
- Trust Service — score engine, 4-badge system, fraud auto-hold
- Airport Service — EWR virtual queue (FIFO), FlightAware 30s cache, surge 2.5× max
- Driver Service — onboarding, documents (S3 presigned), vehicles, approval workflow
- Rider Service — profile, payment methods (Stripe), trusted contacts
- Admin Service — analytics, audit logs (compliance-only), platform config (Founder JWT), refunds
- Rider App — Home, Auth, Tracking, SOS, TripComplete, BidRequest, TrustedContacts
- Driver App — Home, IncomingRequest, InTrip, EarningsDashboard, AirportMode, full onboarding (6 screens)
- Admin Portal — Dashboard, Safety Center, Drivers, Fraud, EarningsFloor, Refunds
- Terraform infrastructure (ECS, RDS Multi-AZ, ElastiCache, S3, SQS, ALB, WAF)
- GitHub Actions CI/CD (staging auto, production with manual approval + RDS snapshot)
- Unit tests — 6 service spec files; Integration tests — trip service; E2E — Playwright (admin)
