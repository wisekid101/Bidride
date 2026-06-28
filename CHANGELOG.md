# Changelog

All notable changes to BidiRide are documented in this file.  
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)  
Versioning: [Semantic Versioning](https://semver.org/)

---

## [Unreleased] — Sprint 1

### Added

#### Infrastructure
- Health endpoints (`/health`) on all 11 NestJS microservices (ports 3001–3011)
- Shared `Dockerfile.template` with `--build-arg SERVICE_NAME` for all services
- GitHub Actions CI/CD pipeline: staging auto-deploy, production with manual approval + RDS snapshot gate
- `.github/SECRETS.md` — full documentation of all required GitHub Actions secrets with sources
- Git repository initialized and pushed to https://github.com/wisekid101/Bidride

#### Rider App (`apps/rider-app`)
- Expo Router `app/` directory structure with file-based routing
- Auth flow: `(auth)/` group with redirect guard → `PhoneAuthScreen`
- Tabs: Home, Trips, Profile with Ionicons and auth guard
- Screen routes: `/tracking`, `/sos`, `/trip-complete`, `/bid-request`, `/trusted-contacts`
- `app.json` — Expo config: scheme `bidride-rider`, iOS microphone + location permissions for SOS
- `babel.config.js` — `babel-preset-expo`
- Test infrastructure: jest-expo preset, SecureStore/AsyncStorage/Location/Maps mocks
- Unit tests: auth store (SecureStore enforcement, no AsyncStorage), API client (E.164 validation, JWT header injection, 401 refresh), rider receipt (no driver earnings exposure)

#### Driver App (`apps/driver-app`)
- Expo Router `app/` directory structure with file-based routing
- Auth flow: `(auth)/` group → `DriverAuthScreen` (OTP, role=driver, routes new drivers to onboarding)
- Tabs: Drive, Earnings, Profile with sign-out guard when online
- Screen routes: `/incoming-request`, `/in-trip`, `/airport-mode`
- Onboarding stack: `welcome → personal-info → vehicle-info → document-upload → bank-account → background-check → complete`
- `src/api/client.ts` — Fetch wrapper with JWT injection from `useDriverStore`, 401 auto-refresh, error code extraction
- `src/screens/DriverAuthScreen.tsx` — Phone + OTP auth, role=driver, routes to onboarding if new driver
- `app.json` — Expo config: scheme `bidride-driver`, background location, camera permissions
- Test infrastructure: jest-expo preset, SecureStore/AsyncStorage/Location/Maps mocks
- Unit tests: driver store (SecureStore enforcement, driver-prefixed keys, online/offline toggle, earnings merge)

#### Product Documentation
- `product/feature-addendum-preferred-drivers-subscriptions-part1.md` — Feature architecture overview
- `product/feature-addendum-preferred-drivers-subscriptions-part2.md` — DB schema, API, matching engine
- `product/feature-addendum-preferred-drivers-subscriptions-part3.md` — Privacy, safety, regulatory, revenue
- `product/feature-addendum-preferred-drivers-subscriptions-part4.md` — User journeys, MVP checklist
- `product/FOUNDER_REVIEW_PACKAGE.md` — Business review, competitive analysis, founder recommendation
- `product/implementation-roadmap-part1.md` — Sprint plan overview (16 sprints)
- `product/implementation-roadmap-part2-sprints.md` — Sprint-by-sprint detail
- `product/implementation-roadmap-part3-deployment.md` — Deployment sequence, feature flags, rollback

### Security Constraints (non-negotiable, enforced by tests)
- JWT tokens stored in `expo-secure-store` ONLY — AsyncStorage is mocked and asserted to be unused
- Driver take-home displayed first and largest — gross fare is secondary (enforced in earnings display test)
- Rider receipt never exposes driver earnings percentage or trust score numbers
- Trust scores: 4 badge labels only (Verified/Trusted/Business/VIP) — no numerical scores to drivers or riders
- Gold (#F4B400) used ONLY for earnings — never decorative UI
- Navy (#0A2342) text on Teal — white on Teal fails WCAG AA (enforced in theme constants)
- JetBrains Mono for ALL financial figures — no exceptions

---

## [0.9.0] — 2026-04-15 — Readiness Validated

### Added
- Complete PostgreSQL schema (Prisma) — 35+ models
- All 11 NestJS microservices production-ready with unit tests
- Full trip state machine (searching → accepted → en_route → arrived → in_progress → completed)
- Earnings floor formula (Founder-only write): `floor = (miles × $1.10) + (min × $0.22) + $2.50`
- SOS 3-state machine (initiate → 5s countdown → confirm), AES-256 audio recording
- Panic mode: triple-tap, no accessibility tree entry, panic admin payload excludes riderId/riderName/riderPhone
- Stripe Connect payment processing, instant payout ($0.99 fee, $500 cap, 2h hold)
- EWR virtual queue (FIFO via Redis sorted set), surge cap 2.5×, admin confirmation >1.5×
- Trust score engine: 4-badge system (Verified/Trusted/Business/VIP), auto-hold at fraud_probability ≥ 90%
- Admin portal: Dashboard, Safety Center, Drivers, Fraud, EarningsFloor, Refunds
- Rider app: Home, Auth, Tracking, SOS, TripComplete, BidRequest, TrustedContacts
- Driver app: Home, IncomingRequest, InTrip, EarningsDashboard, AirportMode, full 6-screen onboarding
- Terraform infrastructure: ECS, RDS Multi-AZ, ElastiCache, S3, SQS, ALB, WAF
- GitHub Actions CI/CD pipeline
- E2E validation report: FINAL_READINESS_REPORT.md

### Tagged
- `v0.9-readiness-validated`

---

## [0.0.0] — Project Inception

- BidiRide AI-powered rideshare marketplace founded
- Delaware LLC registered
- Launch market: Newark, NJ (EWR airport focus)
- Driver-first economics: 70–80% take-home target
