# BidRide — Sprint Plan
## Part 2 of 3: 16 Sprints · 2 Weeks Each · Full Acceptance Criteria

**Status:** FOUNDER APPROVED — 2026-06-07
**Sprint cadence:** 2-week sprints · Monday start · Friday demo + retrospective
**Branch strategy:** `feature/<sprint>-<name>` → PR to `staging` → promote to `main` on milestone
**Test gate:** CI must be green before any merge. No exceptions.

---

## Sprint Conventions

Each sprint entry lists:
- **Goal** — single sentence of what is shippable at the end
- **Deliverables** — concrete artifacts (screens, endpoints, services)
- **Tests required** — what must be green before sprint closes
- **Blocked by** — hard dependencies
- **Milestone** — whether this sprint closes a Phase milestone

---

## PHASE 1 — Foundation + Core UX (Sprints 1–6)

---

### Sprint 1 — Weeks 1–2
**Goal:** Rider and driver apps authenticate and display home screens on physical devices.

**Deliverables:**
- React Native project scaffolding complete for rider-app and driver-app
- Navigation structure: rider (Auth → Home → Trip → SOS → Complete)
- Navigation structure: driver (Auth → Home → Incoming → InTrip → Earnings)
- PhoneAuthScreen (rider + driver): OTP input, verify, JWT stored in SecureStore
- Rider HomeScreen: map, pickup input, offline state
- Driver HomeScreen: online/offline toggle, status indicator
- Theme constants applied: Navy `#0A2342`, Teal `#00D4C6`, JetBrains Mono for all dollar amounts

**Tests required:**
- Unit: OTP field validation (E.164 format)
- Unit: JWT stored in SecureStore, not AsyncStorage
- Unit: online/offline toggle fires correct driver-service PATCH
- Integration: auth-service OTP → JWT flow (real service, test credentials)
- Manual on device: auth flow completes, home screen renders

**Blocked by:** Physical test devices available (iOS + Android)
**Milestone:** none

---

### Sprint 2 — Weeks 3–4
**Goal:** A rider can request a trip and see a live fare estimate; a driver can accept and start the trip.

**Deliverables:**
- Rider: pickup/dropoff selection (Google Maps Places autocomplete)
- Rider: fare estimate card (aiFare, breakdown, EWR surge indicator)
- Rider: "Request Ride" → trip created → searching state
- Driver: IncomingRequestScreen with 30s countdown, fare preview, driver take-home
- Driver: Accept → en route → arrived → start controls
- Rider: real-time driver location on map (WebSocket)
- Both: trip status bar (searching → accepted → driver en route → driver arrived → in progress)

**Tests required:**
- Unit: fare estimate displays aiFare, not gross fare, as primary figure
- Unit: driver IncomingRequestScreen shows take-home first (design review required)
- Unit: 30s countdown timer fires decline if no action
- Integration: POST /trips → dispatch → driver notified within 2s
- Integration: Redis NX claim — concurrent accept test (2 drivers, 1 trip, 1 wins)
- Integration: WebSocket location update latency <2s under normal conditions
- E2E (Playwright, backend): full trip create → accept → start flow

**Blocked by:** Sprint 1 complete; Google Maps API key configured
**Milestone:** Rider and driver apps functionally connected to backend — **M1 + M2**

---

### Sprint 3 — Weeks 5–6
**Goal:** Trips complete with correct payment, receipt, and mutual ratings.

**Deliverables:**
- Driver: End Trip button + location confirmation
- Rider: TripCompleteScreen — total fare, breakdown, driver take-home hidden, "Rate driver"
- Driver: TripCompleteScreen — take-home first (large), gross fare secondary (small)
- Rider: 1–5 star rating with optional comment
- Driver: 1–5 star rating for rider (optional)
- Payment: Stripe charge on trip completion (test mode)
- Receipt: in-app receipt + email (Twilio SendGrid or Resend)
- Trust score update: async, post-rating (no blocking of UI)

**Tests required:**
- Unit: rider receipt contains no driver take-home percentage or amount
- Unit: driver receipt shows take-home first, larger font than gross fare
- Unit: earnings floor supplement calculation (formula: miles×$1.10 + min×$0.22 + $2.50)
- Integration: Stripe test charge fires on trip completion
- Integration: trust-service receives rating event and updates score within 5s
- Security: GET /trips/:id response contains no numerical trust score
- E2E: rate driver → next trip request allowed; skip rating → blocked

**Blocked by:** Sprint 2 complete; Stripe test key configured
**Milestone:** Full trip lifecycle with payment and ratings — **M3 + M5 + M6**

---

### Sprint 4 — Weeks 7–8
**Goal:** SOS, panic, trusted contacts, and safety flows are device-verified and safety-reviewed.

**Deliverables:**
- Rider: SosScreen — 3-state (initiate → 5s countdown → confirm)
- Rider: Panic gesture — triple-tap, single vibration, no visual change, `accessible={false}`, `importantForAccessibility="no"`
- Rider: TrustedContactsScreen — add/remove contacts, notified on SOS confirm
- Driver: Panic gesture (same implementation)
- Safety service: audio recording starts only on SOS confirm (AES-256)
- Admin: SOS events appear in Safety Center with no riderId/riderName/riderPhone in payload
- Notification: emergency SMS to trusted contacts on SOS confirm

**Tests required:**
- Unit: panic gesture NOT in accessibility tree (accessibility audit)
- Unit: audio recording does not start until SOS state = confirmed
- Unit: admin panic payload contains no riderId, riderName, riderPhone
- Integration: SOS confirm → trusted contact SMS within 10s
- Integration: SOS confirm → Safety Center event created
- Manual on device: panic triple-tap fires with single vibration, zero visual change
- Safety review: dedicated review session before sprint closes — no merge without sign-off

**Blocked by:** Sprint 2 complete; physical device required for panic gesture test
**Milestone:** Safety flows verified on device — **M4 (safety component)**

---

### Sprint 5 — Weeks 9–10
**Goal:** Real-time matching handles load; driver onboarding is complete; airport mode works end-to-end.

**Deliverables:**
- Driver: full 6-screen onboarding (Welcome → PersonalInfo → VehicleInfo → DocumentUpload → BankAccount → BackgroundCheck)
- Driver: S3 document upload via presigned URL
- Admin: driver approval workflow (pending → approved/rejected)
- Airport: driver enters EWR virtual queue; FIFO dispatch confirmed
- Airport: surge multiplier displayed; admin confirmation required >1.5×
- Matching: dispatch fan-out to N=8 drivers; 60s timeout → re-dispatch
- Load test: 50 concurrent trip requests dispatched correctly

**Tests required:**
- Unit: onboarding step validation (each field required before next step)
- Unit: document upload returns presigned URL, not raw S3 credentials
- Integration: driver approved in admin → can go online and receive trips
- Integration: EWR FIFO order preserved under 10 concurrent queue joins
- Integration: surge >1.5× blocked without admin confirmation
- Load test: 50 concurrent trips, zero dispatch collisions (Redis NX)
- Integration: re-dispatch fires after 60s timeout with different driver pool

**Blocked by:** Sprint 3 complete; AWS S3 configured; EWR test data seeded
**Milestone:** Full real-time matching with load verification — **M4 (dispatch component)**

---

### Sprint 6 — Weeks 11–12
**Goal:** Preferred Driver Network is live; relationship-service is deployed to staging.

**Deliverables:**
- `relationship-service` (port 3012): scaffold, Prisma models, health endpoint, auth guard
- PreferredDriver CRUD: add (max 10 enforced), remove, list
- Rider: TripCompleteScreen CTA — "Add to Preferred" (post-trip only)
- Rider: PreferredDriversScreen — list with last-trip date, trip count, remove button
- Driver: IncomingRequestScreen — "⭐ Preferred Rider" badge for preferred dispatch
- Driver: preferred-by count (no identity) in profile section
- Matching Layer 3: preferred exclusive window (45s, Redis TTL)
- EWR queue protection: preferred dispatch skips drivers in EWR queue
- Notification: preferred driver online → no notification (following is Phase 2)

**Tests required:**
- Unit: preferred list capped at 10; 11th add returns 400 with clear message
- Unit: preferred-by API returns `{ count: N }` only — no riderId in response
- Integration: preferred driver offered trip before standard pool
- Integration: preferred lock expires after 45s → Layer 4 fires
- Integration: driver in EWR queue NOT offered preferred trip
- Integration: tripCount increments after completed preferred trip
- Security: GET /preferred response contains no driver PII beyond existing public fields
- E2E: add preferred post-trip → next ride → preferred driver offered first

**Blocked by:** Sprint 5 complete; relationship-service deployed to staging
**Milestone:** Phase 1 complete — all 7 Phase 1 features shippable — **M7**

---

## PHASE 2 — Relationship Layer (Sprints 7–11)

---

### Sprint 7 — Weeks 13–14
**Goal:** Driver Following is live; followers receive online notifications.

**Deliverables:**
- Follow/unfollow endpoints in relationship-service
- Rate limits: 10 follow-changes/day per rider; 3 online notifications/24h per driver
- Rider: "Follow [Driver]" CTA on TripCompleteScreen and DriverProfileScreen
- Rider: MyNetworkScreen — Following tab
- Driver: opt-out toggle (disable being followed) in profile settings
- Driver: follower count display (no identities)
- Notification: rider receives push when followed driver comes online within 10 miles
- Driver public profile: photo, first name, badge, vehicle, rating, bio (200 char)

**Tests required:**
- Unit: follow rate limit enforced (11th change in 24h → 429)
- Unit: notification rate limit enforced (4th notification suppressed)
- Integration: driver comes online → followers notified within 5s
- Integration: driver disables following → new follows rejected; existing deactivated
- Security: GET /followers/count returns count only, no rider list

---

### Sprint 8 — Weeks 15–16
**Goal:** BidRide Connect request and accept flow is live.

**Deliverables:**
- Connect request endpoint: requires ≥1 shared completed trip
- 72h expiry with 24h reminder notification to driver
- Accept/decline flow with mutual notification
- 30-day re-request cooldown after decline
- Rider: ConnectRequestScreen, MyNetworkScreen → Connected tab
- Driver: ConnectRequestsScreen with countdown badge

**Tests required:**
- Unit: connect request blocked if no shared completed trip
- Unit: 72h expiry fires; request removed from pending
- Unit: re-request blocked within 30 days of decline
- Integration: accept → both parties see Active status
- Integration: 24h expiry reminder notification sent

---

### Sprint 9 — Weeks 17–18
**Goal:** BidRide Connect Direct booking (Layer 1 dispatch) is live and tested.

**Deliverables:**
- Direct booking flow: rider selects Connected driver → POST /trips { connectDriverId }
- Layer 1 dispatch: 120s exclusive window, dedicated notification to driver
- Driver: direct booking toggle in Connect settings (on by default)
- Timeout/decline → rider notified → Layer 4 option offered
- dispatchType=connect_direct logged on trip record

**Tests required:**
- Integration: connectDriverId triggers Layer 1 before any other layer
- Integration: 120s exclusive lock expires → Layer 4 offered to rider
- Integration: driver decline → rider notified within 3s
- E2E: full Connect Direct booking from MyNetworkScreen → trip complete
- Unit: disconnect → direct booking no longer available (immediate)

---

### Sprint 10 — Weeks 19–20
**Goal:** Driver Business Center — Earnings and Performance screens are live.

**Deliverables:**
- BusinessCenterHomeScreen: cards for Earnings, Performance, Airport (Phase 2), Connect Calendar (Phase 2)
- EarningsDetailScreen: daily/weekly/monthly/YTD, per-trip breakdown
- CSV export: trip date, gross, fee, supplement, net (1099-K compatible fields)
- PerformanceScreen: acceptance rate, completion rate, cancellation rate, rating trend
- Market comparison widget (anonymized — rider count range, not names)

**Tests required:**
- Unit: CSV totals match sum of completed trips in date range
- Unit: performance metrics calculated correctly (edge: zero trips in period)
- Unit: market comparison contains no individual driver data
- Integration: CSV download returns correct Content-Type and filename
- E2E: navigate Business Center → Earnings → download CSV → verify row count

---

### Sprint 11 — Weeks 21–22
**Goal:** Phase 2 hardening — all relationship features stable, tested under load.

**Deliverables:**
- Load test: 500 simulated follower notifications (fan-out from single driver online event)
- Circuit breaker on notification fan-out (max batch 500, overflow queued)
- Connect + Preferred + Following integration tests run together (no interference)
- Admin: Relationships tab on driver detail (preferred-by count, follower count, connection count)
- Admin: relationship abuse investigation actions (suspend following, suspend connect)
- Bug fixes from Sprint 7–10 retrospectives

**Tests required:**
- Load: 500 follower fan-out completes within 10s
- Integration: circuit breaker activates at batch size >500; excess queued in SQS
- Integration: all three relationship types coexist on same driver without conflict
- Security: admin relationship actions create audit log entries

**Milestone:** Phase 2 complete — Following, Connect, Business Center shippable

---

## PHASE 3 — Enterprise + Revenue (Sprints 12–16)

---

### Sprint 12 — Weeks 23–24
**Goal:** corporate-service scaffold deployed; corporate account creation and approval flow live.

**Blocked by:** Legal docs complete (NJ ABC review, DPA template, auto-renewal copy)

**Deliverables:**
- `corporate-service` (port 3013): scaffold, Prisma models, health endpoint
- CorporateAccount CRUD: create (pending), Founder approve (requires Founder JWT)
- Custom fee rate input: Founder JWT required for any rate; additional gate at <15%
- Admin: Corporate Approval Queue page (`/corporate/pending`)
- DPA acceptance gate: in-portal; logged with timestamp before data access

**Tests required:**
- Unit: corporate creation sets status=pending, founderApproved=false
- Security: non-Founder JWT cannot set platformFeeRate (403)
- Security: corporate admin cannot access trip data before DPA signed
- Integration: Founder approves → status=active → corporate admin notified

---

### Sprint 13 — Weeks 25–26
**Goal:** Corporate driver roster and employee linking are live; corporate dispatch (Layer 2) works.

**Deliverables:**
- Roster management: add driver (sends opt-in notification), remove driver
- Driver: opt-in notification → confirm/decline → Corporate Partner badge
- Employee linking: invite via SMS deep link → rider account linked
- Layer 2 dispatch: corporate roster drivers offered first (60s window)
- EWR queue protection: roster drivers in EWR queue skipped
- dispatchType=corporate logged on trip record

**Tests required:**
- Unit: roster capped at 20 drivers
- Integration: driver receives opt-in notification; roster slot = pending until confirmed
- Integration: corporate trip → Layer 2 roster drivers offered first
- Integration: queued EWR driver NOT pulled for corporate Layer 2 dispatch
- E2E: employee requests trip → roster driver accepts → receipt shows "Billed to [Company]"

---

### Sprint 14 — Weeks 27–28
**Goal:** Corporate invoicing and reporting live; employee billing confirmed.

**Deliverables:**
- Monthly invoice generation: PDF, itemized by employee and trip
- Minimum monthly commitment enforcement (invoice = max(actual, minCommit))
- Net-30 payment via Stripe invoice
- Overdue handling: 7-day grace → account suspended → employees' personal cards charged
- Admin: Corporate Account Detail page with invoice history
- Corporate admin: trip history export (PDF; CSV in Phase 2)

**Tests required:**
- Unit: invoice total = max(sum of trips, minMonthlyCommit)
- Integration: Stripe invoice created with correct line items
- Integration: overdue →7 days → corporate status = suspended; employees notified
- Integration: suspended account → Layer 2 dispatch skipped; Layer 3/4 used

---

### Sprint 15 — Weeks 29–30
**Goal:** Driver Subscription Plans live; Stripe billing, tier enforcement, and dispatch boost active.

**Deliverables:**
- SubscriptionScreen: tier comparison table, upgrade/downgrade CTA
- Stripe Subscription: create, upgrade, downgrade, cancel
- 14-day free trial for newly approved drivers (auto-converts; 7-day advance email)
- Tier sync: payment-service webhook → relationship-service → driver denorm
- Layer 4 dispatch boost: Pro 1.15×, Elite 1.30× (score only, not fare)
- Fee reduction: Pro 15%, Elite 10% applied at trip completion
- Elite badge: displayed to rider during matching; hidden during SOS

**Tests required:**
- Unit: Pro driver charged 15% platform fee on trip completion
- Unit: Elite driver charged 10% platform fee
- Unit: Elite badge NOT shown during active SOS event
- Integration: Stripe webhook `invoice.payment_succeeded` → tier updated within 5s
- Integration: `invoice.payment_failed` → 7-day grace → downgrade to Basic
- Integration: dispatch boost applied in Layer 4 score calculation
- Unit: boost does NOT affect fare amount (riders pay same price regardless of driver tier)
- Security: rider API response does not contain driver subscription tier name or price

---

### Sprint 16 — Weeks 31–32
**Goal:** Phase 3 hardened; full platform regression tested; staging promotion ready.

**Deliverables:**
- Admin: Subscriptions Overview (MRR, tier breakdown, churn, trial conversion)
- Admin: Corporate MRR widget on main dashboard
- Subscription pause/resume (auto-pause at 30d driver inactivity)
- Full regression test suite: all three phases run together
- Performance baseline: p95 dispatch latency <800ms under 100 concurrent trips
- Security audit: no trust scores, no panic PII, no tier names exposed in any API
- Staging promotion checklist completed (see Part 3)

**Tests required:**
- Integration: auto-pause triggers after 30d no trips; driver notified
- Integration: manual resume → subscription reactivates; tier restored
- Load: 100 concurrent trips across all 4 dispatch layers; no collision; p95 <800ms
- Security: automated scan of all API responses for disallowed fields
- E2E regression: Playwright suite covers Phases 1–3 admin flows
- Full smoke test suite green on staging

**Milestone:** All 3 phases complete — full platform ready for production — **Final milestone**

---

## Sprint Velocity Summary

| Phase | Sprints | Weeks | Key Milestone |
|-------|--------|-------|--------------|
| Phase 1 | 1–6 | 1–12 | Core rider/driver apps + preferred network |
| Phase 2 | 7–11 | 13–22 | Following, Connect, Business Center |
| Phase 3 | 12–16 | 23–32 | Corporate program + subscriptions |
| Staging + launch | — | 33–34 | Production deployment (see Part 3) |
| **Total** | **16** | **34 weeks** | **~8.5 months solo; ~4.5 months with 2 engineers** |

---

*Part 2 of 3 complete — 16-sprint plan with full acceptance criteria.*
*Part 3: Deployment Sequence — environment progression, feature flags, rollback procedures, launch checklist.*
*Awaiting direction to continue to Part 3.*
