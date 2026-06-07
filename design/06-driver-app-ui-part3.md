# BidRide — Driver App UI v1.0 · Part 3: Earnings, Payouts & Airport Queue

**Status:** Draft — Pending Founder Approval
**Document:** 06-C of 10 · Part 3 of 4
**References:** 06-driver-app-ui-part1.md · 06-driver-app-ui-part2.md · 00d-safety-shield-system.md §13

> Driver take-home pay leads every earnings display.
> Gross fare is secondary. BidRide's transparency promise is non-negotiable.

---

## Screen Index

| ID | Screen | Section |
|---|---|---|
| DS-029 | Earnings Dashboard | §1 |
| DS-030 | Earnings Floor Protection Detail | §1 |
| DS-031 | Driver Wallet + Instant Payout | §2 |
| DS-032 | Weekly Payout Center | §2 |
| DS-033 | Bank Account Management | §2 |
| DS-034 | Airport Mode Entry + EWR Queue | §3 |
| DS-035 | Airport Queue Dispatch + Terminal Nav | §3 |

---

## §1 — Earnings

### DS-029 · Earnings Dashboard

**Purpose:** Single source of truth for all driver earnings. Shows today, this week, and history. Earnings Floor status prominently displayed. Accessible from the bottom tab bar at all times.

```
╔══════════════════════════════════════════╗
║  9:41  💰 Earnings              ███      ║
╠══════════════════════════════════════════╣
║  ┌──────────┬──────────┬──────────────┐  ║
║  │  Today   │  Week    │   History    │  ║
║  │ (active) │          │              │  ║
║  └──────────┴──────────┴──────────────┘  ║
║  Tab bar — teal underline on active      ║
║                                          ║
║  TODAY — Friday, June 6                  ║
║  type-label / text-muted / uppercase     ║
║                                          ║
║  $62.00                                  ║
║  YOUR TAKE-HOME                          ║
║  text-gold / JetBrains Mono / type-h1   ║
║  4 trips completed                       ║
║  text-caption / text-secondary           ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ✓  Earnings Floor: Guaranteed  │    ║
║  │     All trips met minimum.       │    ║
║  │     [ View Details ]             │    ║
║  └──────────────────────────────────┘    ║
║  bg: teal-10% / border-l: teal           ║
║                                          ║
║  TRIP BREAKDOWN                          ║
║  type-label / text-muted / uppercase     ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  9:14 AM  ·  Standard            │    ║
║  │  $14.80 take-home  · 4.2 mi     │    ║
║  │  text-gold/JetBrains · secondary │    ║
║  ├──────────────────────────────────┤    ║
║  │  10:52 AM  ·  Bid accepted       │    ║
║  │  $12.40 take-home  · 3.1 mi     │    ║
║  ├──────────────────────────────────┤    ║
║  │  1:37 PM  ·  Airport (EWR→Nwk)  │    ║
║  │  $21.60 take-home  · 9.8 mi     │    ║
║  ├──────────────────────────────────┤    ║
║  │  3:05 PM  ·  Standard            │    ║
║  │  $13.20 take-home  · 3.7 mi     │    ║
║  └──────────────────────────────────┘    ║
║  Each row tap → trip detail modal        ║
║                                          ║
║  ONLINE TIME: 4h 22m                     ║
║  AVG PER TRIP: $15.50                   ║
║  text-caption / text-secondary / row     ║
╚══════════════════════════════════════════╝
```

**Week Tab:**
```
  THIS WEEK (Mon Jun 2 – Fri Jun 6)
  $247.80  YOUR TAKE-HOME
  text-gold / JetBrains Mono / type-h1

  ┌─ Bar chart: Mon–Sun ──────────────────┐
  │  Mon ██████ $61.20                   │
  │  Tue ████   $42.40                   │
  │  Wed ███████$78.00                   │
  │  Thu ████   $43.80                   │
  │  Fri ██     $22.40 (in progress)     │
  │  Sat ·· (not yet)                    │
  │  Sun ·· (not yet)                    │
  │  Bars: gold fill / teal active bar   │
  └──────────────────────────────────────┘

  PAYOUT SCHEDULE
  $247.80  →  Chase ····4812
  Monday, June 9  ·  Auto deposit
  text-caption / text-secondary

  [ Instant Payout — $0.99 fee ]
  text-teal link → DS-031
```

**Components:** C-045 (Earnings Goal Tracker), C-011 (Tab Bar)
**Analytics events:** `earnings_dashboard_viewed { tab, driver_id, date }`

**Acceptance criteria:**
- Driver take-home is the first and largest number shown on every tab
- Gross fare is never displayed on this screen — only on individual trip detail modals
- Earnings Floor status always visible without scrolling on Today tab
- Bar chart renders within 300ms of tab activation

---

### DS-030 · Earnings Floor Protection Detail

**Purpose:** Explain the earnings floor guarantee in plain language. Show per-trip floor calculations and any supplements paid. Builds driver trust in BidRide's core promise.

```
╔══════════════════════════════════════════╗
║  ← Back   Earnings Floor Guarantee       ║
╠══════════════════════════════════════════╣
║                                          ║
║  🛡  BidRide guarantees your earnings.  ║
║  type-h2 / text-primary                  ║
║                                          ║
║  Every trip has a minimum take-home.     ║
║  If a fare falls below that floor,       ║
║  BidRide pays the difference.            ║
║  type-body / text-secondary              ║
║                                          ║
║  ── HOW IT'S CALCULATED ───────────     ║
║                                          ║
║  Your floor = (distance × $1.10)         ║
║               + (time × $0.22/min)       ║
║               + $2.50 base               ║
║  text-caption / text-secondary           ║
║  JetBrains Mono for the figures          ║
║                                          ║
║  ── YOUR TRIPS TODAY ───────────────     ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  9:14 AM  Standard  4.2 mi      │    ║
║  │  Floor:     $9.62               │    ║
║  │  Earned:   $14.80  ✓ Met        │    ║
║  │  text-secondary / text-teal      │    ║
║  ├──────────────────────────────────┤    ║
║  │  10:52 AM  Bid  3.1 mi          │    ║
║  │  Floor:     $8.11               │    ║
║  │  Earned:   $12.40  ✓ Met        │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  SUPPLEMENTS PAID THIS WEEK              ║
║  type-label / uppercase / text-muted     ║
║  $0.00  (no supplement needed)          ║
║  text-gold / JetBrains Mono              ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Floor supplements are paid on   │    ║
║  │  your regular Monday schedule    │    ║
║  │  along with your trip earnings.  │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / text-caption / muted     ║
╚══════════════════════════════════════════╝
```

**Business rules:**
- Floor formula: `(trip_distance_miles × 1.10) + (trip_duration_min × 0.22) + 2.50`
- Floor calculated server-side at trip completion — driver never calculates it manually
- If `driver_earnings < floor`: `supplement = floor - driver_earnings`, stored in `earnings_floor_logs`
- Floor supplements are included in the weekly payout — never delayed separately
- Floor cannot be waived, reduced, or overridden by any admin short of Founder authorization

**Analytics events:** `earnings_floor_detail_viewed`, `floor_supplement_reviewed { supplement_amount }`

**Acceptance criteria:**
- Floor calculation shown for every trip with clear "Met" / "Supplement Applied" status
- Total supplements paid this week shown at bottom with zero-state message if none
- Formula displayed in plain English — not algorithm notation

---

## §2 — Wallet & Payouts

### DS-031 · Driver Wallet + Instant Payout

**Purpose:** Shows current available balance and provides the instant payout flow. The wallet balance = earnings since last Monday payout that have cleared.

```
╔══════════════════════════════════════════╗
║  9:41  💳 Wallet                ███      ║
╠══════════════════════════════════════════╣
║                                          ║
║  AVAILABLE BALANCE                       ║
║  type-label / text-muted / uppercase     ║
║                                          ║
║  $247.80                                 ║
║  text-gold / JetBrains Mono / type-h1   ║
║                                          ║
║  Payout to: Chase ····4812              ║
║  Next auto-payout: Mon Jun 9, 9:00 AM   ║
║  text-caption / text-secondary           ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ⚡  GET PAID NOW                │    ║
║  │                                  │    ║
║  │  Instant Payout  ·  $0.99 fee   │    ║
║  │  Funds arrive in 15–30 min       │    ║
║  │                                  │    ║
║  │  [ Instant Payout ]              │    ║
║  │  Primary button / bg-teal        │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / radius-card              ║
║                                          ║
║  ── RECENT TRANSACTIONS ────────────     ║
║  type-label / text-muted / uppercase     ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Jun 6 · Trip #8821   +$14.80  │    ║
║  │  Jun 6 · Trip #8819   +$12.40  │    ║
║  │  Jun 6 · Trip #8817   +$21.60  │    ║
║  │  Jun 2 · Weekly payout −$183.40│    ║
║  │  (withdrawals in muted red)     │    ║
║  └──────────────────────────────────┘    ║
║  Tap any row → transaction detail        ║
╚══════════════════════════════════════════╝
```

**Instant Payout flow (modal after tapping button):**
```
╔══════════════════════════════════════════╗
║  ⚡ Instant Payout                       ║
╠══════════════════════════════════════════╣
║  You'll receive:  $246.81               ║
║  ($247.80 − $0.99 fee)                  ║
║  text-gold / JetBrains Mono              ║
║                                          ║
║  To: Chase ····4812                     ║
║  Est. arrival: 15–30 minutes             ║
║  text-secondary                          ║
║                                          ║
║  [ Confirm Instant Payout ]              ║
║  Primary / bg-teal / full width          ║
║  [ Cancel ]  Ghost button                ║
╚══════════════════════════════════════════╝
```

**States:** idle → confirming → processing → success | error

**Business rules:**
- Minimum balance for instant payout: $10.00
- Maximum single instant payout: $500.00 (Stripe limit)
- Fee: flat $0.99 — deducted from payout, never added to balance
- Earnings from trips in the last 2 hours are "pending" and excluded from instant payout (fraud prevention)
- Instant payout available 24/7 including weekends

**Analytics events:** `instant_payout_initiated { amount }`, `instant_payout_confirmed { amount, fee }`, `instant_payout_success`, `instant_payout_failed { reason }`

**Edge cases:**
- Balance below $10: button disabled, tooltip "Minimum $10.00 required for instant payout"
- Bank account not verified: button disabled, "Verify your bank account to enable payouts → [Verify]"
- Stripe instant payout failure: "Transfer failed — your bank may not support instant deposits. Try again or wait for Monday payout."

---

### DS-032 · Weekly Payout Center

**Purpose:** Full view of the weekly payout schedule, current period earnings, and payout history.

```
╔══════════════════════════════════════════╗
║  ← Back   Weekly Payout Center           ║
╠══════════════════════════════════════════╣
║                                          ║
║  CURRENT PERIOD                          ║
║  type-label / text-muted / uppercase     ║
║  Mon Jun 2 – Sun Jun 8                   ║
║                                          ║
║  $247.80   earnings                     ║
║  +$0.00    floor supplements            ║
║  ─────────────────                       ║
║  $247.80   PAYOUT TOTAL                 ║
║  text-gold / JetBrains Mono              ║
║                                          ║
║  Paid to Chase ····4812                 ║
║  Monday, June 9 at 9:00 AM               ║
║  text-secondary                          ║
║                                          ║
║  ── PAYOUT HISTORY ─────────────────     ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Jun 2  $183.40  ✓ Deposited   │    ║
║  │  May 26 $221.00  ✓ Deposited   │    ║
║  │  May 19 $196.80  ✓ Deposited   │    ║
║  │  May 12 $158.60  ✓ Deposited   │    ║
║  └──────────────────────────────────┘    ║
║  Each row tap → payout detail sheet      ║
║                                          ║
║  [ Download Tax Summary (2026) ]         ║
║  text-teal link / type-caption           ║
║  → PDF: all payouts, floor supplements,  ║
║    gross fares for 1099 reporting        ║
╚══════════════════════════════════════════╝
```

**Payout detail (row tap → bottom sheet):** Period dates · trip count · take-home · floor supplements · instant fees · net deposited · bank confirmation timestamp · [Download Receipt].

**Business rules:**
- Payout period: Monday 12:00 AM – Sunday 11:59 PM (Eastern)
- Auto-payout: Monday 9:00 AM if balance ≥ $1.00
- 1099-NEC issued for drivers earning ≥ $600 in a calendar year (generated January, available in-app)
- Drivers are independent contractors — no tax withholding on payouts

**Analytics events:** `payout_history_viewed`, `payout_detail_opened { payout_id }`, `tax_summary_downloaded { year }`

---

### DS-033 · Bank Account Management

**Purpose:** View, replace, or verify the payout bank account. Form fields are identical to DS-016 (onboarding bank setup) — see Part 1.

```
╔══════════════════════════════════════════╗
║  ← Back   Payout Bank Account            ║
╠══════════════════════════════════════════╣
║  CURRENT ACCOUNT                         ║
║  Chase Bank  ····4812  ✓ Verified       ║
║  text-primary / teal checkmark           ║
║                                          ║
║  [ Replace Bank Account ]                ║
║  Secondary → opens DS-016 form pattern   ║
║                                          ║
║  🔒  Secured by Stripe.                  ║
║      BidRide never stores account nums.  ║
║  text-caption / text-muted               ║
╚══════════════════════════════════════════╝
```

**Replacement flow:** New account requires micro-deposit verification (1–2 business days). Payouts continue to old account until new one is confirmed. Old account deactivated only after new account verified.
**Edge case:** Name mismatch between bank account and driver profile → admin review flag, payouts held until confirmed.

---

## §3 — Airport Queue System

### DS-034 · Airport Mode Entry + EWR Queue Position

**Purpose:** Driver opts into the EWR airport dispatch queue. System assigns a virtual queue position and shows estimated dispatch time. Driver can wait anywhere — they do not need to be physically at the airport to hold their queue position until notified.

```
╔══════════════════════════════════════════╗
║  9:41  ✈ Airport Mode           ███      ║
╠══════════════════════════════════════════╣
║                                          ║
║  NEWARK LIBERTY (EWR)                    ║
║  type-h2 / text-primary                  ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  YOUR QUEUE POSITION             │    ║
║  │  47  of  203 drivers             │    ║
║  │  type-h1 / text-teal / centered  │    ║
║  │                                  │    ║
║  │  Est. dispatch in  ~22 min       │    ║
║  │  JetBrains Mono / text-secondary │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / radius-card              ║
║                                          ║
║  FLIGHT ARRIVALS (next 30 min)           ║
║  type-label / uppercase / text-muted     ║
║  ┌──────────────────────────────────┐    ║
║  │  UA 447  Term C  ✓ Landed       │    ║
║  │  AA 271  Term A  On time ETA 9:58│    ║
║  │  DL 834  Term B  Delayed +18 min │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / text-caption             ║
║                                          ║
║  SURGE PRICING AT EWR                    ║
║  +$4.10 airport surge active            ║
║  text-gold / JetBrains Mono              ║
║                                          ║
║  [🗺 Staging Map]   [🔔 Notify me 10min]║
║  Secondary button    Ghost button        ║
║                                          ║
║  [ LEAVE QUEUE ]   text-red link         ║
╚══════════════════════════════════════════╝
```

**Queue position rules:**
- Queue is virtual — driver's position is held regardless of physical location
- Position advances as drivers in front complete trips or leave the queue
- Position is lost if driver goes offline or leaves the queue manually
- Driver with higher trust badge (VIP > Trusted > Verified) gets +3 position boost on queue entry
- Drivers who complete an airport trip rejoin at a boosted position (back 10 spots, not back of line)

**"Notify me 10 min" toggle:** Driver receives push notification 10 minutes before estimated dispatch. They should begin heading to the TNC staging area (Lot P4 at EWR) at this point.

**Staging Map:** Opens a static map overlay showing:
- Lot P4 staging area (green zone)
- Terminal A, B, C TNC pickup zones
- Current wait zones to avoid (red — airport authority restricted)

**Flight data:** Pulled from flight data cache (30-second refresh). Delayed flights update estimated dispatch time dynamically.

**Analytics events:** `airport_mode_enabled`, `airport_queue_joined { position, queue_size }`, `airport_surge_viewed { surge_amount }`

**Acceptance criteria:**
- Queue position visible without scrolling
- Estimated dispatch time recalculates every 60 seconds
- Flight arrivals show correct terminal assignment
- Surge amount displayed in gold/JetBrains Mono

---

### DS-035 · Airport Queue Dispatch + Terminal Navigation

**Purpose:** Driver is dispatched from the airport queue. Shows the assigned terminal, TNC pickup zone, and navigation to reach it. Designed for the critical handoff moment when the driver gets a rider.

**State A — Advance notice (10 minutes before dispatch):**
```
╔══════════════════════════════════════════╗
║  🔔 HEAD TO THE AIRPORT NOW              ║
║  type-h2 / text-teal                     ║
║                                          ║
║  You're position 3 in the queue.         ║
║  Head to Lot P4 — you'll be dispatched  ║
║  within the next 10 minutes.             ║
║  type-body / text-secondary              ║
║                                          ║
║  [ Navigate to Lot P4 ]  Primary button  ║
║  bg-teal / text-navy                     ║
║                                          ║
║  [ I'm already there ]  Ghost button     ║
╚══════════════════════════════════════════╝
```

**State B — Dispatched (ride request with airport context):**
```
╔══════════════════════════════════════════╗
║  ✈  AIRPORT RIDE REQUEST      [ 15 ]    ║
║  text-teal                    countdown  ║
╠══════════════════════════════════════════╣
║  $21.60                 9.8 mi           ║
║  YOUR EARNINGS          TRIP DIST        ║
║  text-gold / JetBrains Mono / type-h1   ║
║                                          ║
║  PICKUP: Terminal C — TNC Zone          ║
║  Newark Liberty International           ║
║  📍 0.3 mi from your current position   ║
║                                          ║
║  DROPOFF: Downtown Newark               ║
║  Rider: Trusted  ·  ⭐ 4.7  · 89 trips  ║
║  ⏱  Est. 18 min trip                    ║
║                                          ║
║  ✈  Flight UA 447 — just landed         ║
║  Rider expects 10–15 min walk from gate  ║
║  text-caption / text-muted               ║
║                                          ║
║  [ ACCEPT ]              [ DECLINE ]     ║
╚══════════════════════════════════════════╝
```

**State C — Navigating to terminal TNC zone:**
```
╔══════════════════════════════════════════╗
║  ✈ NAVIGATING TO PICKUP         [SOS]   ║
╠══════════════════════════════════════════╣
║  ENTER TERMINAL C                        ║
║  TNC PICKUP ZONE                         ║
║  type-h1 / text-primary / 36sp           ║
║                                          ║
║  [MAP: Airport terminal layout]          ║
║  Blue route: driver to TNC zone          ║
║  Green zone: TNC pickup area             ║
║  Red zones: no-stop areas                ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  ✈ Terminal C TNC Zone  ·  0.3 mi  │  ║
║  │  [📞 Call Rider] [💬 Message]      │  ║
║  │                                    │  ║
║  │  🛡 Safety: Your location is being │  ║
║  │     shared with BidRide Safety.    │  ║
║  └────────────────────────────────────┘  ║
║  Bottom card / bg-secondary              ║
╚══════════════════════════════════════════╝
```

**Airport-specific safety overlay (from 00d §13):**
- "Airport Pickup Tips" chip displayed on first airport trip per shift
- Zone violation alert if driver enters a non-TNC airport zone
- If rider hasn't boarded within 10 minutes of driver arrival → admin soft alert

**Analytics events:** `airport_dispatch_received`, `airport_dispatch_accepted`, `airport_pickup_completed { terminal, wait_seconds }`

**Acceptance criteria:**
- Terminal letter (A/B/C) displayed in ≥ 36sp type — readable while walking
- TNC zone shown on map with distinct green highlight
- Flight status shown on dispatch card (just landed / estimated arrival)
- Safety note visible on navigation screen without scrolling

---

## Database Fields

**`airport_queue_entries`** (extends PRD §17): `id · driver_id · queue_position · joined_at · dispatched_at · left_at · trip_id · terminal_assigned ENUM(A,B,C) · rejoin_position · status ENUM(waiting,notified,dispatched,completed,left)`

**`payouts`**: `id · driver_id · period_start · period_end · trip_earnings · floor_supplements · instant_fees · total_payout · stripe_transfer_id · status ENUM(pending,processing,paid,failed) · paid_at · created_at`

**`earnings_floor_logs`** (extends PRD §18): `id · trip_id · driver_id · floor_amount · earned_amount · supplement_amount · formula_inputs JSONB · payout_id · created_at`

---

## API Endpoints

```
-- Earnings
GET  /driver/earnings/today
GET  /driver/earnings/week?start=2026-06-02
GET  /driver/earnings/history?page=1&limit=20
GET  /driver/earnings/floor-details?date=2026-06-06

-- Payouts
GET  /driver/payouts
GET  /driver/payouts/:payout_id
POST /driver/payouts/instant          { confirm: true }
GET  /driver/payouts/tax-summary/:year   → PDF stream

-- Bank account
GET  /driver/bank-account
POST /driver/bank-account             { stripe_token }
POST /driver/bank-account/verify      { amounts: [0.32, 0.18] }

-- Airport queue
POST /driver/airport/queue/join       { airport: "EWR" }
POST /driver/airport/queue/leave
GET  /driver/airport/queue/status
GET  /driver/airport/flights?airport=EWR&window_minutes=30
```

---

## Continuation Notes — Part 4 Covers

- DS-036 · Safety Center (driver-specific)
- DS-037 · SOS Active (driver)
- DS-038 · Panic Mode (discreet — links to 00d §8)
- DS-039 · Trusted Contacts management
- DS-040 · Post-Trip Safe Check-In
- DS-041 · Driver Profile + Badge display
- DS-042 · Vehicle Management + Document Renewal
- DS-043 · Driver Settings + Notifications
- DS-044 · Driver Milestones (Rewards)
- DS-045 · Full user flow diagrams + screen inventory

---

*BidRide Driver App UI — Part 3 of 4 — Confidential · Delaware LLC*
