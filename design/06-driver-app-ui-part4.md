# BidiRide — Driver App UI v1.0 · Part 4: Safety, Profile, Rewards & Flow Diagrams

**Status:** Draft — Pending Founder Approval
**Document:** 06-D of 10 · Part 4 of 4
**References:** 06-driver-app-ui-part1/2/3.md · 00d-safety-shield-system.md · 00c-trust-score-engine.md

---

## Screen Index

| ID | Screen | Section |
|---|---|---|
| DS-036 | Safety Shield Center | §1 |
| DS-037 | Driver Profile Management | §2 |
| DS-038 | Vehicle Management | §2 |
| DS-039 | Driver Rewards Program | §3 |
| DS-040 | Driver Settings | §3 |
| DS-041 | Driver Documents & Compliance | §4 |
| DS-042 | Driver Performance Dashboard | §4 |
| DS-043 | Driver Support Center | §5 |
| DS-044 | Driver Notifications Center | §5 |
| DS-045 | Full Driver Flow Diagrams | §6 |

---

## §1 — Safety Shield

### DS-036 · Safety Shield Center

**Purpose:** Driver's hub for all safety features. Shows status of every Safety Shield component and provides access to configuration. Safety always one tap from the home screen.

```
╔══════════════════════════════════════════╗
║  ← Back   🛡 Safety Center               ║
╠══════════════════════════════════════════╣
║  EMERGENCY                               ║
║  type-label / text-red / uppercase       ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  🔴  SOS Button                  │    ║
║  │  Always active during trips      │    ║
║  │  Hold both volume buttons = SOS  │    ║
║  │  [ How to use SOS ]              │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / border-l: red            ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  🔕  Discreet Panic Mode         │    ║
║  │  Triple-tap shield icon          │    ║
║  │  Silent — rider does not see it  │    ║
║  │  [ Learn more ]                  │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / border-l: red            ║
║                                          ║
║  CONTACTS & SHARING                      ║
║  type-label / text-teal / uppercase      ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  👥  Trusted Contacts     2 / 5  │    ║
║  │  Marcus, Sarah  ·  [ Manage ]    │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary                            ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  🌙  Night Ride Check-In    ON  ║│    ║
║  │  Post-trip check after 10pm      │    ║
║  │                         [toggle] │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary                            ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  🔊  Audio Recording             │    ║
║  │  Activates only during SOS       │    ║
║  │  Auto + encrypted + admin-only   │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / text-caption             ║
║                                          ║
║  🔴  SOS:  1-800-BID-SAFE               ║
║  text-caption / text-red / centered      ║
╚══════════════════════════════════════════╝
```

**Trusted Contacts sub-screen (DS-036a):**
```
  [ + Add Contact ]  → name, phone, relationship
  ┌─────────────────────────────────────┐
  │  Marcus Brown  ·  Brother  ·  📞   │
  │  Auto-share: ON  ·  SOS: always    │
  │  [ Edit ]   [ Remove ]             │
  └─────────────────────────────────────┘
  Up to 5 contacts. SOS notify cannot be disabled.
  Night ride share: toggle per contact.
```

**Business rules (from 00d §6.3):**
- Trusted contacts: max 5 per driver
- SOS notification: always on — cannot be disabled by driver or admin
- Panic mode: silent — rider sees no visual change
- Audio recording: SOS-triggered only, AES-256, admin dual-auth to access

**Analytics events:** `safety_center_viewed`, `trusted_contact_added`, `panic_mode_tutorial_viewed`

**Security requirement:** The panic mode activation gesture (triple-tap) must not be discoverable by inspecting the UI tree. It must not appear in accessibility labels.

---

## §2 — Profile & Vehicle

### DS-037 · Driver Profile Management

**Purpose:** Driver views and edits their profile. Shows trust badge, rating, and trip count. Primary identity surface used across the platform.

```
╔══════════════════════════════════════════╗
║  ← Back   My Profile                     ║
╠══════════════════════════════════════════╣
║                                          ║
║  ╔════════════╗  Marcus Brown            ║
║  ║  [photo]   ║  type-h2 / text-primary  ║
║  ╚════════════╝  🏅 Trusted Driver       ║
║  96×96px circle   text-teal badge        ║
║  [ Change Photo ]                        ║
║                                          ║
║  ⭐ 4.91   ·   247 trips   ·   14 months ║
║  text-secondary / type-body              ║
║                                          ║
║  ── PROFILE INFO ───────────────────     ║
║  ┌────────────────────────────────────┐  ║
║  │  Display Name:  Marcus B.          │  ║
║  │  Phone:  +1 (973) ···-0192         │  ║
║  │  Email:  m.brow···@email.com       │  ║
║  └────────────────────────────────────┘  ║
║  [ Edit Contact Info ]  text-teal link   ║
║                                          ║
║  ── TRUST BADGE ────────────────────     ║
║  🏅  Trusted Driver                      ║
║  247 trips · 4.91 rating · 14 months    ║
║  Next: VIP requires 250 trips, 4.8 avg  ║
║  text-caption / text-muted               ║
║  [ How badges work ]  text-teal link     ║
╚══════════════════════════════════════════╝
```

**Badge tooltip:** Plain-language Verified → Trusted → VIP progression. No numerical scores. See 00c §4 for thresholds.

**Editable:** Display name + profile photo only. Legal name, phone, email changes require admin verification.

### DS-038 · Vehicle Management

**Purpose:** View registered vehicles, switch active vehicle, add a second vehicle, update inspection status.

```
╔══════════════════════════════════════════╗
║  ← Back   My Vehicles                    ║
╠══════════════════════════════════════════╣
║                                          ║
║  ACTIVE VEHICLE                          ║
║  type-label / text-teal / uppercase      ║
║  ┌──────────────────────────────────┐    ║
║  │  ● 2021 Toyota Camry · Silver    │    ║
║  │  NJA-1234  ·  BidiRide Standard  │    ║
║  │  Inspection: ✓ Valid (Jun 2027)  │    ║
║  │  Insurance:  ✓ Valid (Dec 2026)  │    ║
║  │  [ View Documents ]              │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / border-l: teal           ║
║                                          ║
║  [ + Add Another Vehicle ]               ║
║  Secondary button → DS-012 form pattern  ║
║                                          ║
║  ── VEHICLE REQUIREMENTS ───────────     ║
║  ✓  2008 or newer  ·  4-door             ║
║  ✓  NJ registration  ·  No salvage title ║
║  text-caption / text-muted               ║
╚══════════════════════════════════════════╝
```

**Switch vehicle:** Tap secondary vehicle to set as active. Switch logged with timestamp (insurance period audit trail).

## §3 — Rewards & Settings

### DS-039 · Driver Rewards Program

**Purpose:** Gamified milestone system that rewards drivers for consistency, quality, and longevity. Separate from trust badges — rewards are earnings-denominated, not status labels.

```
╔══════════════════════════════════════════╗
║  9:41  🏅 Rewards               ███      ║
╠══════════════════════════════════════════╣
║                                          ║
║  BidiRide Driver Milestones               ║
║  type-h2 / text-primary                  ║
║                                          ║
║  YOUR PROGRESS                           ║
║  247 trips  ·  Trusted Badge             ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  🏆 MILESTONE: 250 Trips         │    ║
║  │  247 / 250  [████████████░░] 99% │    ║
║  │  Reward: +$25.00 bonus           │    ║
║  │  text-gold / JetBrains Mono      │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / border-l: gold           ║
║                                          ║
║  AVAILABLE REWARDS                       ║
║  type-label / uppercase / text-muted     ║
║  ┌──────────────────────────────────┐    ║
║  │  ✓  100 Trips        +$10.00 ✓  │    ║
║  │  ✓  Perfect Week     +$15.00 ✓  │    ║
║  │  ✓  4.9+ Rating x30  +$20.00 ✓  │    ║
║  │  ⏳  250 Trips        +$25.00    │    ║
║  │  ⏳  500 Trips        +$50.00    │    ║
║  │  ⏳  1,000 Trips      +$100.00   │    ║
║  └──────────────────────────────────┘    ║
║  Earned items: gold checkmark            ║
║  Pending items: teal hourglass           ║
║                                          ║
║  WEEKLY CHALLENGES                       ║
║  type-label / uppercase / text-muted     ║
║  ┌──────────────────────────────────┐    ║
║  │  Complete 15 trips this week     │    ║
║  │  12 / 15  [████████░░░]  +$20   │    ║
║  │  Resets Monday  ·  3 trips left  │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / border-l: teal           ║
║                                          ║
║  TOTAL EARNED (lifetime)                 ║
║  $45.00  text-gold / JetBrains Mono      ║
╚══════════════════════════════════════════╝
```

**Milestone rewards structure:**

| Milestone | Reward | Paid |
|---|---|---|
| 50 trips | +$10.00 | Next Monday payout |
| 100 trips | +$10.00 | Next Monday payout |
| 250 trips | +$25.00 | Next Monday payout |
| 500 trips | +$50.00 | Next Monday payout |
| 1,000 trips | +$100.00 | Next Monday payout |
| Perfect week (0 cancels, 5.0 rating) | +$15.00 | Next Monday |
| 4.9+ avg over 30 trips | +$20.00 | Next Monday |
| 10 airport trips | +$12.00 | Next Monday |

**Weekly challenges:** Rotate every Monday, 3 active at a time. Reward paid same week if completed.
**Analytics events:** `milestone_viewed`, `milestone_achieved { milestone, reward_amount }`, `weekly_challenge_progress { challenge_id, trips_completed }`

---

### DS-040 · Driver Settings

**Purpose:** App-wide preferences. Minimal — most critical settings are surfaced on dedicated screens.

```
╔══════════════════════════════════════════╗
║  ← Back   Settings                       ║
╠══════════════════════════════════════════╣
║  NOTIFICATIONS                           ║
║  Ride Requests         [ON toggle]       ║
║  Earnings Updates      [ON toggle]       ║
║  Rewards & Milestones  [ON toggle]       ║
║  Safety Alerts         [ON — locked]     ║
║  text-muted "(cannot be disabled)"       ║
║                                          ║
║  NAVIGATION                              ║
║  App: ○ Google Maps  ● Waze  ○ Apple    ║
║                                          ║
║  LANGUAGE                                ║
║  ● English   ○ Spanish   ○ Portuguese   ║
║                                          ║
║  ACCOUNT                                 ║
║  [ Change Password ]   text-teal link    ║
║  [ Delete Account ]    text-red link     ║
║  (confirmation + 30-day hold required)   ║
║                                          ║
║  App version: 1.0.0 · BidiRide for Drivers║
║  text-caption / text-muted               ║
╚══════════════════════════════════════════╝
```

**Security requirement:** Safety alerts notification cannot be disabled. Toggle is rendered in a disabled/locked state with explanatory label.

---

## §4 — Documents & Performance

### DS-041 · Driver Documents & Compliance

**Purpose:** Central view of all submitted documents, expiry dates, and renewal status. Prevents compliance failures that could deactivate the account.

```
╔══════════════════════════════════════════╗
║  ← Back   My Documents                   ║
╠══════════════════════════════════════════╣
║  ┌──────────────────────────────────┐    ║
║  │  🪪 Driver's License             │    ║
║  │  NJ · D12345678 · Exp Mar 2029  │    ║
║  │  ✓ Verified  [ View ]           │    ║
║  ├──────────────────────────────────┤    ║
║  │  📋 Auto Insurance               │    ║
║  │  Policy #882-44-X · Exp Dec 2026 │    ║
║  │  ✓ Verified  [ Update ]         │    ║
║  ├──────────────────────────────────┤    ║
║  │  🚗 Vehicle Registration         │    ║
║  │  NJA-1234 · Exp Apr 2027        │    ║
║  │  ✓ Verified  [ View ]           │    ║
║  ├──────────────────────────────────┤    ║
║  │  ✅ Background Check             │    ║
║  │  Cleared Jun 1, 2026  (Checkr)  │    ║
║  │  Annual renewal: Jun 2027        │    ║
║  ├──────────────────────────────────┤    ║
║  │  📸 Vehicle Inspection           │    ║
║  │  Passed Jun 1, 2026             │    ║
║  │  Next: Dec 2026  [ Re-inspect ] │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  ⚠  Insurance expires in 28 days        ║
║  Update before Dec 1 to keep driving.   ║
║  text-amber / bg: amber-10%             ║
╚══════════════════════════════════════════╝
```

**Expiry alerts:** Push at 60d, 30d, 7d. In-app banner at 30 days. Account suspended (not deleted) on expiry — reactivates after re-upload and admin approval. Re-uploads trigger full AI authenticity review.

---

### DS-042 · Driver Performance Dashboard

**Purpose:** Full transparency into the driver's performance metrics. Shows rating, acceptance rate, completion rate, and how they compare to the platform average. Supports driver improvement and retention.

```
╔══════════════════════════════════════════╗
║  ← Back   Performance                    ║
╠══════════════════════════════════════════╣
║  THIS MONTH  (Jun 2026)                  ║
║                                          ║
║  ┌────────────┬────────────┬──────────┐  ║
║  │  ⭐ 4.91   │  ✓ 98.7%  │  ⚡ 87%  │  ║
║  │  Rating    │ Completion │ Accept.  │  ║
║  └────────────┴────────────┴──────────┘  ║
║  Metric cards / bg-secondary             ║
║                                          ║
║  HOW YOU COMPARE                         ║
║  type-label / uppercase / text-muted     ║
║  Rating:       4.91  (avg 4.74) ▲       ║
║  Completion:  98.7%  (avg 96.1%) ▲      ║
║  Acceptance:   87%   (avg 78%) ▲        ║
║  text-teal upward arrow = above avg      ║
║                                          ║
║  STATUS: Good Standing ✓                 ║
║  text-teal / type-body                   ║
║                                          ║
║  REQUIREMENTS TO MAINTAIN                ║
║  type-label / uppercase / text-muted     ║
║  Acceptance ≥ 70%  ✓  87% met           ║
║  Completion  ≥ 95%  ✓  98.7% met        ║
║  Rating      ≥ 4.5   ✓  4.91 met        ║
║  text-teal checkmarks                    ║
║                                          ║
║  RECENT RATINGS FROM RIDERS              ║
║  ⭐⭐⭐⭐⭐  "Very smooth ride"            ║
║  ⭐⭐⭐⭐⭐  "On time, professional"       ║
║  ⭐⭐⭐⭐    (no comment)                 ║
║  text-secondary / type-caption           ║
╚══════════════════════════════════════════╝
```

**Standing:** Good (accept ≥ 70%, completion ≥ 95%, rating ≥ 4.5) → Watch (10% below, banner shown) → At Risk (at threshold, dispatch deprioritized) → Suspended (rating < 4.0 / completion < 90% over 30 trips — admin review).

**Analytics events:** `performance_dashboard_viewed`, `rating_detail_opened`

---

## §5 — Support & Notifications

### DS-043 · Driver Support Center

```
╔══════════════════════════════════════════╗
║  ← Back   Support                        ║
╠══════════════════════════════════════════╣
║  ┌────────────────────────────────────┐  ║
║  │  🔍  Search help articles...       │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  QUICK HELP                              ║
║  [ Report a trip issue ]    → form       ║
║  [ Report unsafe rider ]    → safety Q  ║
║  [ Dispute a rating ]       → form       ║
║  [ Earnings question ]      → FAQ        ║
║  [ Document help ]          → FAQ        ║
║                                          ║
║  CONTACT                                 ║
║  📞  1-800-BID-SAFE  (safety only)      ║
║  💬  In-app chat  (2 min avg response)  ║
║  📧  driver-support@bidiride.com          ║
║  text-secondary / type-body              ║
╚══════════════════════════════════════════╝
```

**Trip issue report:** Pre-fills trip_id + driver_id. Categories: earnings, rider behavior, route, app bug. SLA: 24h for earnings disputes, 4h for safety reports.
**Rating dispute:** 1 flag per 30-day period. Admin reviews — confirmed fake/retaliatory ratings removed from average.

---

### DS-044 · Driver Notifications Center

```
╔══════════════════════════════════════════╗
║  ← Back   Notifications                  ║
╠══════════════════════════════════════════╣
║  ┌──────────────────────────────────┐    ║
║  │  ⚡  Surge Alert — Newark Penn  │    ║
║  │  High demand  ·  2 min ago      │    ║
║  ├──────────────────────────────────┤    ║
║  │  💰  Weekly payout: $247.80     │    ║
║  │  Deposited to Chase ····4812    │    ║
║  │  Mon Jun 2  ·  9:03 AM          │    ║
║  ├──────────────────────────────────┤    ║
║  │  🏅  Milestone unlocked!        │    ║
║  │  100 Trips — +$10 added to      │    ║
║  │  your next payout               │    ║
║  ├──────────────────────────────────┤    ║
║  │  ⚠  Insurance expires in 28d   │    ║
║  │  Update before Dec 1            │    ║
║  └──────────────────────────────────┘    ║
║  Unread: bold weight. Tap → deep link.   ║
║  [ Clear all ]  text-muted link          ║
╚══════════════════════════════════════════╝
```

**Notification categories:** ride_request · earnings · payout · safety · milestone · compliance · system
**Safety notifications cannot be cleared** — they remain pinned until acknowledged.

---

## §6 — Flow Diagrams

### DS-045 · Full Driver Flow Diagrams

**Flow 1 — Onboarding to First Trip:**
```
Install App
  → DS-001 Splash → DS-002 Carousel → DS-003 Create Account
  → DS-004 OTP → DS-005 Email Verify → DS-006 Personal Info
  → DS-007 License Upload → DS-008 AI Review
  → DS-009 BG Check Consent → DS-010 Insurance → DS-011 Registration
  → DS-012 Vehicle Details → DS-013/DS-014 Inspection + Photos
  → DS-015 Profile Photo → DS-016 Bank Account
  → DS-017 Pending Review ←→ [Admin reviews — 3–7 days]
  → DS-018 Approved → DS-019 Driver Home (Offline)
  → DS-021 Shift Settings → DS-020 Online Map → DS-022 First Request
```

**Flow 2 — Standard Trip:**
```
DS-020 Online
  → DS-022 Request received (15s countdown)
  → [Accept] → DS-025 Navigate to Pickup
  → DS-026 Arrived (wait timer starts)
  → [Start Trip] → DS-027 In-Trip Navigation
  → [End Trip within 0.2mi] → DS-028 Trip Complete + Rate Rider
  → DS-020 Online (ready for next request)
```

**Flow 3 — Bid Request:**
```
DS-020 Online
  → DS-023 Bid Request received (20s countdown)
  → [Accept] → DS-025      [Decline] → DS-020
  → [Counter] → DS-024 Counter Offer
    → [Send] → rider has 60s
      → rider accepts → DS-025
      → rider declines → DS-020
      → rider re-counters → DS-023 again (max 2 rounds)
```

**Flow 4 — Airport Queue (EWR):**
```
DS-021 Shift Settings → enable Airport Queue
  → DS-034 Airport Mode Entry → join queue (position assigned)
  → [10 min before dispatch] → push + DS-034 advance notice
  → [Dispatched] → DS-035 State B (airport request card)
  → [Accept] → DS-035 State C (terminal navigation)
  → DS-026 Arrived at TNC Zone → DS-027 In-Trip → DS-028 Complete
  → [Rejoin queue at boosted position]
```

**Flow 5 — SOS Activation (Driver):**
```
DS-027 → [SOS tap] → 5s countdown → SOS Active (DS-036 / 00d §4)
  → audio recording · trusted contacts notified · admin P0 alert (90s SLA) · 911 CTA
  → [safe confirmed] → DS-027 | [admin resolves] → DS-028
Alternate: triple-tap shield → PANIC_ACTIVE (silent, no visual) → admin 3-min check
```

**Flow 6 — Earnings & Payout:**
```
DS-028 Trip Complete
  → earnings credited to wallet balance
  → DS-029 Earnings Dashboard (today tab updated)
  → [Monday 9AM] → DS-032 Weekly Payout auto-processes
  → OR [Instant Payout] → DS-031 → confirm → Stripe → 15–30 min
  → DS-033 Bank Account if payout fails → update account
```

---

## State Machines

**Driver account (`drivers.status`):** `pending → under_review → approved | action_required → under_review | declined`; `approved → suspended → under_review`

**Shift state (Redis):** `offline → online_idle → request_pending → navigating_pickup → at_pickup → in_trip → post_trip → online_idle`. Any active state → `offline` on go-offline. Post-trip "take break" = `online_idle` with 5-min dispatch pause.

---

## Database Additions

**`driver_rewards`**:
`id · driver_id · reward_type ENUM(milestone,weekly_challenge,performance) · milestone_key VARCHAR · reward_amount DECIMAL · earned_at TIMESTAMP · payout_id UUID NULLABLE`

**`driver_performance_snapshots`** (monthly):
`id · driver_id · month DATE · avg_rating · acceptance_rate · completion_rate · trips_completed · standing ENUM(good,watch,at_risk,suspended) · created_at`

**`driver_notifications`**:
`id · driver_id · category ENUM(ride,earnings,payout,safety,milestone,compliance,system) · title · body · deep_link · is_read BOOLEAN · is_clearable BOOLEAN DEFAULT TRUE · created_at`

---

## API Endpoints

```
-- Safety
GET  /driver/safety/status
POST /driver/safety/trusted-contacts        { name, phone, relationship }
PUT  /driver/safety/trusted-contacts/:id
DEL  /driver/safety/trusted-contacts/:id
POST /driver/safety/sos/activate            { trip_id, trigger_source }
POST /driver/safety/panic/activate          { trip_id, method }

-- Performance
GET  /driver/performance?period=month
GET  /driver/performance/ratings?limit=20
POST /driver/performance/ratings/:id/dispute { reason }

-- Rewards
GET  /driver/rewards/milestones
GET  /driver/rewards/weekly-challenges
GET  /driver/rewards/history

-- Documents
GET  /driver/documents
POST /driver/documents/upload               { file, document_type }
GET  /driver/documents/:id/status

-- Notifications
GET  /driver/notifications?page=1
POST /driver/notifications/:id/read
POST /driver/notifications/clear-all
```

---

## Security & Fraud Prevention

| Control | Rule |
|---|---|
| Panic mode gesture | Raw touch events only — not in accessibility tree, not discoverable via UI inspection |
| SOS audio | AES-256 at rest · admin dual-auth to play · legal hold protocol (00d §7) |
| Document re-upload | AI authenticity check + EXIF metadata analysis on every re-upload |
| GPS spoofing | Server-side speed/position validation against cell tower data; impossible movement → flag |
| Rating disputes | 1 per 30 days; AI flags sudden drop patterns for admin review |
| Instant payout | 2-hour hold on recent earnings · $500 daily cap · Stripe velocity rules |
| Account sharing | Device fingerprinting (00c §7) · one active session enforced per driver_id |
| Vehicle switch | Timestamped audit log · insurance period re-validated per switch |

---

## Analytics Events Summary

`safety_center_viewed` · `trusted_contact_added { count }` · `profile_photo_changed` · `vehicle_switched { vehicle_id }` · `milestone_achieved { milestone, reward_amount }` · `weekly_challenge_completed { challenge_id, reward }` · `document_expiry_warning_viewed { type, days_remaining }` · `performance_dashboard_viewed { period, standing }` · `support_ticket_submitted { category }` · `rating_dispute_filed { rating_id }`

---

## Driver App Complete — Screen Inventory

**44 screens + 6 flow diagrams across 4 parts:**
Part 1 (DS-001–018): Onboarding · Part 2 (DS-019–028): Home, Requests, Trips · Part 3 (DS-029–035): Earnings, Payouts, Airport · Part 4 (DS-036–044): Safety, Profile, Rewards · DS-045: Flow diagrams

---

*BidiRide Driver App UI — Part 4 of 4 — COMPLETE — Confidential · Delaware LLC*
