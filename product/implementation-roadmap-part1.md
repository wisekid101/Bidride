# BidRide — Implementation Roadmap
## Part 1 of 3: Roadmap · Milestones · Dependencies · Definition of Done

**Status:** FOUNDER APPROVED — 2026-06-07
**Build standard:** Production-quality only. No shortcuts. All features include unit + integration + E2E tests.
**Repository:** wisekid101/Bidride · branch strategy: `feature/* → staging → main`

---

## 1. Guiding Principles

1. **Test-first on critical paths.** Earnings floor, dispatch, payments, SOS, and fraud flows require tests written before implementation is marked complete.
2. **Safety overrides everything.** Any sprint containing safety-adjacent work (SOS, panic, fraud) must have a dedicated safety review before the PR merges.
3. **No hardcoded secrets.** All credentials via environment variables, injected at ECS task level in production.
4. **Backward-compatible schema changes only.** Additive columns/tables only. No destructive migrations without Founder approval and RDS snapshot.
5. **Driver take-home shown first.** Every earnings-facing UI element must pass design review against this rule before merge.
6. **Staging before production.** Every feature ships to staging, passes smoke tests and manual QA, then awaits promotion. No direct-to-production pushes.

---

## 2. Current Baseline (Validated — June 2026)

The following are **production-ready and validated** per the E2E session and Playwright suite:

| Component | Status |
|-----------|--------|
| PostgreSQL schema (40+ models) | Complete |
| Auth Service — OTP, JWT, MFA | Complete |
| Trip Service — state machine, earnings floor | Complete |
| Pricing Service — FareEngine (hybrid rule + SageMaker) | Complete |
| Payment Service — Stripe Connect, instant payout | Complete |
| Safety Service — SOS 3-state, panic | Complete |
| Notification Service — FCM, Twilio SMS | Complete |
| Trust Service — score engine, 4-badge system | Complete |
| Airport Service — EWR FIFO queue, FlightAware | Complete |
| Driver Service — onboarding, documents, vehicles | Complete |
| Rider Service — profile, payment methods | Complete |
| Admin Service — analytics, audit, platform config | Complete |
| Admin Portal (Next.js) — 8 pages, Playwright-verified | Complete |
| GitHub Actions CI/CD — lint, test, build, deploy | Complete |
| Terraform infrastructure (ECS, RDS, ElastiCache, S3) | Defined |

**What remains:** Mobile app UI completion, relationship-service, corporate-service, and the Phase 2–3 feature set.

---

## 3. Phase Overview

```
Phase 1 — Foundation + Core UX        Weeks 1–12   (Sprints 1–6)
  ├── Core Rider App                   Weeks 1–4
  ├── Core Driver App                  Weeks 1–4
  ├── Bid Marketplace                  Weeks 3–6
  ├── Real-Time Matching               Weeks 4–8
  ├── Payments (rider-facing)          Weeks 5–8
  ├── Ratings                          Weeks 6–8
  └── Preferred Driver Network         Weeks 8–12

Phase 2 — Relationship Layer           Weeks 13–22  (Sprints 7–11)
  ├── Driver Following                 Weeks 13–16
  ├── BidRide Connect                  Weeks 15–20
  └── Driver Business Center           Weeks 18–22

Phase 3 — Enterprise + Revenue         Weeks 23–32  (Sprints 12–16)
  ├── Corporate Preferred Driver       Weeks 23–28
  └── Driver Subscription Plans        Weeks 26–32

Staging validation + production launch Weeks 33–34
```

---

## 4. Phase 1 — Detailed Roadmap

### 4.1 Core Rider App (Weeks 1–4)

**Scope:** Complete and production-ready rider-facing mobile experience.

| Screen / Feature | Backend Dependency | Test Requirement |
|-----------------|-------------------|-----------------|
| Phone Auth (OTP → JWT) | auth-service ✅ | Unit: OTP validation · E2E: full auth flow |
| Home Screen — request ride | trip-service ✅, pricing-service ✅ | Unit: fare estimate · E2E: trip creation |
| Pickup/dropoff map selection | Google Maps SDK | Manual: accuracy on EWR address |
| Fare estimate display | pricing-service ✅ | Unit: floor calculation · Integration: FareEngine |
| Real-time driver tracking | WebSocket gateway ✅ | Integration: location update latency <2s |
| Trip status updates | trip-service state machine ✅ | Integration: all 7 state transitions |
| SOS screen | safety-service ✅ | E2E: 3-state SOS + countdown · Safety review required |
| Panic gesture | safety-service ✅ | Manual: triple-tap, no accessibility tree · Safety review |
| Trusted contacts | rider-service ✅ | Unit: add/remove · E2E: contact notified on SOS |
| Trip complete screen | trip-service ✅ | E2E: fare displayed correctly, driver take-home hidden |
| Rate driver (1–5 stars) | trip-service ✅ | Unit: rating persisted · Integration: trust score update |
| Payment method management | rider-service ✅, payment-service ✅ | Integration: Stripe card add/remove |
| Trip history | trip-service ✅ | Unit: pagination · E2E: completed trip visible |

**Milestone M1:** Rider can complete a full trip end-to-end on a physical device. SOS and panic verified on device (not emulator). **Week 4.**

### 4.2 Core Driver App (Weeks 1–4)

| Screen / Feature | Backend Dependency | Test Requirement |
|-----------------|-------------------|-----------------|
| Phone Auth (OTP → JWT) | auth-service ✅ | Same as rider |
| Onboarding (6 screens) | driver-service ✅ | E2E: full 6-step onboarding to approval queue |
| Document upload | driver-service ✅, S3 | Integration: presigned URL upload · manual: file visible in admin |
| Home screen — online/offline toggle | driver-service ✅, Redis | Integration: status reflected in dispatch within 2s |
| Incoming request screen | trip-service ✅ | E2E: request received, accepted, trip starts |
| Accept/decline with countdown | trip-service ✅ | Unit: 30s countdown · Integration: claim via Redis NX |
| In-trip navigation overlay | Google Maps SDK | Manual: route displayed, dropoff correct |
| Trip state controls (Arrived / Start / End) | trip-service ✅ | E2E: full state machine traversal |
| Earnings display | trip-service ✅ | Unit: driver take-home shown first · design review |
| Earnings dashboard | trip-service ✅ | Unit: daily/weekly totals correct |
| Airport mode | airport-service ✅ | Integration: EWR queue join/leave · E2E: FIFO order preserved |
| Panic (driver) | safety-service ✅ | Manual: triple-tap on device · Safety review |

**Milestone M2:** Driver can receive, accept, and complete a trip. Earnings shown correctly (take-home first). Airport mode joins EWR queue. **Week 4.**

### 4.3 Bid Marketplace (Weeks 3–6)

BidRide's core differentiator: AI-bounded fare with rider transparency.

| Feature | Description | Test Requirement |
|---------|-------------|-----------------|
| Bid request flow (rider) | Rider sees AI fare estimate before confirming | Unit: FareEngine bounds (AI ±$2.00 of rule) |
| Fare breakdown screen | Show: base, distance, time, surge, AI adjustment | Unit: each component correct |
| Airport surge indicator | Show surge multiplier; cap at 2.5× | Unit: cap enforced · Integration: admin confirmation >1.5× |
| Fare accept/decline (rider) | Rider confirms or cancels before dispatch fires | E2E: cancel before dispatch → no driver notified |
| Driver bid earnings preview | Show driver take-home before accepting | Unit: earnings floor applied · design review: take-home first |
| No-show handling | Driver marks no-show → rider charged partial fare | Unit: no-show state transition · Integration: charge applied |

**Milestone M3:** Full bid flow: rider sees fare → confirms → driver sees take-home → accepts. Surge cap enforced. Earnings floor verified in staging. **Week 6.**

### 4.4 Real-Time Matching (Weeks 4–8)

| Feature | Description | Test Requirement |
|---------|-------------|-----------------|
| Driver geo-presence (Redis) | Drivers publish location every 5s when online | Integration: geo search returns drivers within radius |
| Dispatch fan-out | Trip offered to top N=8 drivers simultaneously | Integration: all 8 notified within 500ms |
| Redis NX atomic claim | First driver to accept wins; others get "already taken" | Integration: concurrent accept stress test (race condition) |
| Dispatch timeout | No accept in 60s → re-dispatch to next pool | E2E: timeout → new set of drivers notified |
| WebSocket location stream | Rider receives driver location updates in-trip | Integration: <2s latency · load test: 50 concurrent trips |
| EWR FIFO dispatch | EWR queue drivers dispatched in timestamp order | Integration: FIFO order verified under concurrent requests |

**Milestone M4:** 50 simulated concurrent trips dispatched correctly. No race condition on Redis NX claim. EWR FIFO order preserved under load. **Week 8.**

### 4.5 Payments — Rider-Facing (Weeks 5–8)

| Feature | Description | Test Requirement |
|---------|-------------|-----------------|
| Trip charge on completion | Stripe charge fires when trip status → completed | Integration: charge amount matches final_fare |
| Earnings hold (2h) | Driver payout held 2h post-completion | Unit: hold enforced · Integration: payout not immediate |
| Instant payout ($0.99 fee, $10 min, $500 cap) | Driver requests instant payout | Integration: limits enforced · Stripe payout verified |
| Payment failure handling | Card decline → rider notified → retry | Integration: decline flow · E2E: rider prompted to update card |
| Refund flow | Admin-initiated only (no automated refunds) | Unit: refund requires admin role · Integration: Stripe refund fires |
| Earnings floor supplement | Platform absorbs supplement when earnings below floor | Unit: supplement calculation correct · Integration: trip record updated |
| Receipt (rider) | Email + in-app receipt with full fare breakdown | Integration: receipt sent · Unit: no driver take-home in rider receipt |

**Milestone M5:** Real Stripe test-mode charge fires on trip completion. Payout hold verified. Instant payout within limits. Admin refund flow tested. **Week 8.**

### 4.6 Ratings (Weeks 6–8)

| Feature | Description | Test Requirement |
|---------|-------------|-----------------|
| Rider rates driver (1–5) | Post-trip, required before next trip request | Unit: rating persisted · Integration: trust score updated async |
| Driver rates rider (1–5) | Post-trip, optional | Unit: rating persisted |
| Trust score update | rating-complete → trust-service recalculates | Integration: score updated within 5s |
| Trust badge display | Verified/Trusted/Business/VIP — never numerical | Unit: no score in API response to rider/driver · Security test |
| Low-rating flag | Internal alert if driver falls below threshold | Unit: flag triggered · Admin: alert visible in Safety Center |

**Milestone M6:** Mutual ratings work. Trust score updates async. No numerical score exposed in any rider or driver API response (verified by automated security test). **Week 8.**

### 4.7 Preferred Driver Network (Weeks 8–12)

Requires `relationship-service` (new — port 3012) and matching engine Layer 3.

| Feature | Description | Test Requirement |
|---------|-------------|-----------------|
| relationship-service scaffold | NestJS service, Prisma models, health endpoint | Integration: service starts, /health returns 200 |
| PreferredDriver CRUD | Add/remove preferred, list (max 10) | Unit: cap enforced · Integration: persisted |
| Preferred dispatch layer (Layer 3) | 45s exclusive window before standard pool | Integration: preferred driver offered first · Race condition test |
| Redis exclusive lock | `preferred:lock:<tripId>` TTL=45s | Integration: lock expires → Layer 4 fires |
| Rider UI — preferred list screen | Add/remove preferred drivers | E2E: add post-trip → appears in list |
| Driver UI — preferred badge | "Preferred Rider" badge on IncomingRequestScreen | Unit: badge shows only for preferred dispatch |
| Preferred-by count (driver) | Count only — no rider identity | Security test: API response contains count, no riderId |
| EWR queue protection | Preferred dispatch skips drivers in EWR queue | Integration: queued driver not offered preferred trip |
| Preferred tripCount increment | Async update after trip completion | Integration: tripCount +1 after completed trip |

**Milestone M7:** Preferred dispatch verified end-to-end. EWR queue protection confirmed. No rider identity exposed to driver. 45s exclusive window tested with timeout fallback. **Week 12.**

---

## 5. Phase 2 — Relationship Layer (Weeks 13–22)

### 5.1 Driver Following (Weeks 13–16)

| Feature | Test Requirement |
|---------|-----------------|
| Follow/unfollow API | Unit: rate limit enforced (10 changes/day) |
| Online notification fan-out | Integration: notification fires within 5s of driver coming online |
| Notification rate limit (3/24h per driver) | Unit: 4th notification suppressed |
| Driver opt-out (disable following) | Integration: existing followers silently deactivated |
| Follower count API | Security test: count only, no rider identities in response |
| Follower analytics (count only — MVP) | Unit: count accurate |

### 5.2 BidRide Connect (Weeks 15–20)

| Feature | Test Requirement |
|---------|-----------------|
| Connect request (requires ≥1 shared trip) | Integration: shared trip verified before request allowed |
| 72h expiry | Unit: request auto-expires · Integration: driver notified 24h before expiry |
| Accept/decline flow | E2E: both parties notified on accept |
| 30-day re-request cooldown | Unit: re-request blocked within 30 days of decline |
| Direct booking (Layer 1 dispatch) | Integration: connectDriverId bypasses all other layers |
| 120s exclusive window | Integration: timeout → Layer 4 fallback |
| Disconnect (either party) | Integration: both lose direct booking access immediately |

### 5.3 Driver Business Center (Weeks 18–22)

| Feature | Test Requirement |
|---------|-----------------|
| Earnings detail (daily/weekly/monthly) | Unit: totals match completed trips |
| Per-trip breakdown | Unit: gross, fee, supplement, net all correct |
| CSV export | Integration: CSV generated · Unit: format matches 1099-K fields |
| Performance metrics | Unit: acceptance rate, completion rate, cancellation rate |
| Rating trend | Unit: 30/60/90-day window calculations |
| Market comparison (anonymized) | Unit: no individual driver data in comparison |
| EWR earnings/hr (Phase 2) | Integration: FlightAware data overlaid |

---

## 6. Phase 3 — Enterprise + Revenue (Weeks 23–32)

### 6.1 Corporate Preferred Driver Program (Weeks 23–28)

Requires `corporate-service` (new — port 3013). Legal docs must be complete before sprint begins.

| Feature | Test Requirement |
|---------|-----------------|
| corporate-service scaffold | Integration: service starts, health endpoint |
| CorporateAccount CRUD | Unit: founderApproved gate enforced |
| Custom fee rate (Founder JWT required) | Security test: non-Founder cannot set rate |
| Driver roster opt-in | Integration: driver notification sent · opt-in required |
| Corporate dispatch (Layer 2) | Integration: roster driver offered first (60s window) |
| Employee linking (SMS invite) | Integration: SMS sent · rider account linked |
| PDF invoice generation | Integration: invoice totals match trip records |
| Minimum monthly enforcement | Unit: invoice = max(actual, minMonthlyCommit) |
| EWR queue protection for corporate | Integration: queued drivers not pulled for corporate trips |
| DPA acceptance gate | Integration: corporate cannot access data before DPA signed |

### 6.2 Driver Subscription Plans (Weeks 26–32)

| Feature | Test Requirement |
|---------|-----------------|
| Stripe Subscription create/upgrade/downgrade | Integration: Stripe webhook fires · tier updated |
| 14-day trial | Unit: trial-to-paid conversion · 7-day advance notice email |
| Subscription dispatch boost (Pro 1.15×, Elite 1.30×) | Integration: boost applied in Layer 4 score only |
| Fee reduction at trip completion | Unit: Pro driver charged 15%, Elite 10% |
| Subscription pause/resume | Integration: auto-pause after 30d inactivity |
| Elite badge display | Unit: badge shown to rider · not shown during SOS |
| Admin subscription monitoring | Integration: MRR widget updates daily |
| Grace period on payment failure (7 days) | Unit: downgrade after grace, not immediately |

---

## 7. Feature Dependency Graph

```
Auth (✅) ──────────────────────────────────────────────────┐
                                                            │
Trip State Machine (✅) ──── Bid Marketplace ──────────────┤
                         ──── Real-Time Matching ───────────┤
                         ──── Ratings ─────────────────────┤
                                                            │
Pricing / FareEngine (✅) ── Bid Marketplace               │
                                                            ▼
Payment (✅) ──────────────── Subscriptions (Phase 3)  Core Platform
                                                            │
Rider App (screens) ──────────────────────────────────── Phase 1
Driver App (screens) ──────────────────────────────────── Phase 1
                                                            │
relationship-service ────── Preferred Driver ──────────── Phase 1
                       ───── Driver Following ────────── Phase 2
                       ───── BidRide Connect ─────────── Phase 2
                                                            │
Driver Business Center ── relationship-service data ─── Phase 2
                                                            │
corporate-service ──────── Corporate Program ────────── Phase 3
                       ─── Subscription dispatch ─────── Phase 3
```

---

## 8. Definition of Done

A feature is **done** when ALL of the following are true:

- [ ] Unit tests written and passing (minimum 80% coverage on new files)
- [ ] Integration tests written and passing (all service boundaries exercised)
- [ ] E2E test written for happy path (Playwright for admin/web; device test for mobile)
- [ ] No TypeScript errors (`pnpm typecheck` passes)
- [ ] No lint errors (`pnpm turbo run lint` passes)
- [ ] PR reviewed (self-review with checklist on solo build)
- [ ] Merged to `staging` branch; CI pipeline green
- [ ] Manual QA pass on staging environment
- [ ] Safety-adjacent features: dedicated safety review completed
- [ ] Earnings-adjacent features: driver take-home display confirmed correct
- [ ] Security test: no internal data (trust scores, rider PII in panic payload) exposed
- [ ] Deployed to staging; smoke test passing
- [ ] CHANGELOG entry added

---

## 9. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Google Maps SDK cost overrun | Medium | Medium | Set billing alert at $200/mo; evaluate Mapbox if exceeded |
| Stripe Connect approval delay | Low | High | Apply for Connect account before Week 5; use test mode until approved |
| Real device testing bottleneck | High | Medium | Acquire 2 physical devices (iOS + Android) before Week 1 |
| Redis race condition in dispatch | Medium | High | Dedicated load test in Sprint 4; Redis NX pattern verified in unit tests |
| NJ ABC Test legal delay | Medium | High | Engage counsel Week 1; subscriptions blocked until opinion received |
| EWR airport launch surge | Low | High | Surge cap hard-enforced at 2.5×; admin paged above 1.5× |
| relationship-service memory leak (fan-out) | Low | Medium | Circuit breaker on notification fan-out; max batch size = 500 |

---

*Part 1 of 3 complete — Roadmap, Milestones, Dependencies, Definition of Done.*
*Part 2: Sprint Plan (16 sprints, 2 weeks each, full acceptance criteria)*
*Part 3: Deployment Sequence (environment progression, feature flags, rollback)*
*Awaiting direction to continue to Part 2.*
