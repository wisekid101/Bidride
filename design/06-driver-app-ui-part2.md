# BidiRide — Driver App UI v1.0 · Part 2: Home, Requests & Trip Lifecycle

**Status:** Draft — Pending Founder Approval
**Document:** 06-B of 10 · Part 2 of 4
**References:** 06-driver-app-ui-part1.md · 03-design-system.md · 00d-safety-shield-system.md

---

## Screen Index

| ID | Screen | Section |
|---|---|---|
| DS-019 | Driver Home — Offline | §1 |
| DS-020 | Driver Home — Online (Demand Map) | §1 |
| DS-021 | Availability Preferences | §1 |
| DS-022 | Incoming Ride Request (AI Fare) | §2 |
| DS-023 | Incoming Bid Request | §2 |
| DS-024 | Counter-Offer Screen | §2 |
| DS-025 | Navigating to Pickup | §3 |
| DS-026 | Arrived at Pickup + Rider Contact | §3 |
| DS-027 | In-Trip Navigation | §3 |
| DS-028 | Dropoff + Trip Complete | §3 |

---

## §1 — Driver Home & Availability

### DS-019 · Driver Home — Offline

**Purpose:** Default state when driver opens the app. Shows earnings summary and Go Online toggle. Driver is invisible to riders.

```
╔══════════════════════════════════════════╗
║  9:41               ●  OFFLINE    ███    ║
║                     (red dot / text-red) ║
╠══════════════════════════════════════════╣
║  Good morning, Marcus. 👋                ║
║  type-h2 / text-primary                  ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  TODAY'S EARNINGS                │    ║
║  │  $0.00          0 trips          │    ║
║  │  text-gold / JetBrains Mono      │    ║
║  │  This week: $0.00  ·  Mon payout │    ║
║  │  text-caption / text-muted       │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / radius-card              ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ⚡ HIGH DEMAND  Newark Penn Sta │    ║
║  │  Surge active · [View heatmap]   │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / border-l: gold           ║
║                                          ║
║        [ GO ONLINE ]                     ║
║        Primary button — full width       ║
║        bg-teal / text-navy / type-h3     ║
║                                          ║
║  [🗺 Map] [💰 Earnings] [🏅 Rewards] [👤]║
║           Bottom Tab Bar — 4 tabs        ║
╚══════════════════════════════════════════╝
```

**Components:** C-045 (Earnings Goal Tracker), C-047 (Heatmap Predictor), C-001 (Primary Button)
**"GO ONLINE":** If driver has multiple vehicles → vehicle selector modal before going live. Single vehicle → immediate.

---

### DS-020 · Driver Home — Online

**Purpose:** Active state. Driver visible to dispatch. Full-screen demand heatmap with live stats.

```
╔══════════════════════════════════════════╗
║  9:41               ● ONLINE     ███     ║
║                     (teal dot)           ║
╠══════════════════════════════════════════╣
║  [🛡 Safety]                      [≡]    ║
║                                          ║
║  [FULL-SCREEN LIVE MAP]                  ║
║  Driver position: blue arrow             ║
║  Demand heatmap: teal glow = high demand ║
║  Rider request pins hidden (privacy)     ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Today  $47.20  ·  3 trips       │    ║
║  │  text-gold / JetBrains Mono      │    ║
║  │  Acceptance  87%  ·  Rating 4.91 │    ║
║  │  text-caption / text-secondary   │    ║
║  └──────────────────────────────────┘    ║
║  Bottom card / bg-secondary              ║
║                                          ║
║  [ GO OFFLINE ]   Ghost / text-red       ║
╚══════════════════════════════════════════╝
```

**Components:** C-044 (Acceptance Rate Card compact), C-046 (Airport Queue Compact — visible if airport mode on), C-047 (Heatmap)
**Go Offline:** Confirmation modal: "End your shift? Today's earnings: **$47.20**" → [End Shift] [Keep Driving]

---

### DS-021 · Availability Preferences

**Purpose:** Pre-shift settings: ride types, earnings goal, max pickup distance.

```
╔══════════════════════════════════════════╗
║  ← Back         Shift Settings           ║
╠══════════════════════════════════════════╣
║  RIDE TYPES                              ║
║  ☑  BidiRide Standard  (always on)       ║
║  ☑  Bid Requests      (toggle)          ║
║  ☐  Airport Queue     (EWR only)        ║
║                                          ║
║  EARNINGS GOAL  (optional)               ║
║  $  [ 150.00 ]  JetBrains Mono / gold   ║
║  Shows progress ring on DS-020 card      ║
║                                          ║
║  MAX DISTANCE TO PICKUP                  ║
║  ○ Any   ●  Up to 5 mi   ○ Up to 10 mi  ║
║                                          ║
║  [ Save & Go Online ]  Primary button    ║
╚══════════════════════════════════════════╝
```

---

## §2 — Incoming Requests

### DS-022 · Incoming Ride Request — AI Fare

**Purpose:** Driver receives an AI-dispatched request. Must accept or decline within 15 seconds. Highest-stakes screen: information density and readability at arm's length are critical.

```
╔══════════════════════════════════════════╗
║  ⚡ NEW RIDE REQUEST          [ 11 ]     ║
║  type-label / text-teal  countdown ring  ║
║  (ring turns red at ≤ 5s)  JetBrains    ║
╠══════════════════════════════════════════╣
║                                          ║
║  $14.80                 4.2 mi           ║
║  YOUR EARNINGS          TRIP DIST        ║
║  text-gold/JetBrains    text-primary     ║
║  type-h1                type-h3          ║
║                                          ║
║  ─────────────────────────────────────   ║
║  📍 PICKUP   1.2 mi away · ~4 min       ║
║  847 Broad St, Newark NJ                 ║
║                                          ║
║  🏁 DROPOFF                              ║
║  Newark Penn Station                     ║
║  text-secondary / type-body              ║
║  ─────────────────────────────────────   ║
║                                          ║
║  👤 Verified Rider   ⭐ 4.8  · 42 trips ║
║  text-teal badge     text-secondary      ║
║  ⏱  Est. 14 min  ·  🛣 Via McCarter Hwy ║
║                                          ║
║  ─────────────────────────────────────   ║
║  [ ACCEPT ]              [ DECLINE ]     ║
║  Primary / bg-teal       Ghost / text-red║
╚══════════════════════════════════════════╝
```

**Components:** C-031 (Rider Badge chip — Verified/Trusted/Business/VIP label only, no score), C-001 (Accept), C-003 (Decline)

**Earnings shown = driver take-home after BidiRide fee. Gross fare never leads.**

**Countdown:** Audible alert + vibration on arrival. At 0: request expires, "Request expired" toast, returns to DS-020.

**After 3 consecutive declines without a completed trip:** soft push: "Your acceptance rate may affect dispatch priority."

**Edge cases:**
- Rider cancels before driver responds → "Rider cancelled — request withdrawn" toast
- No data connection at dispatch moment → request held 5s in queue, then re-dispatched to next driver

---

### DS-023 · Incoming Bid Request

**Purpose:** Rider submitted a custom fare offer. Driver has 20 seconds to accept, counter, or decline.

```
╔══════════════════════════════════════════╗
║  💬 BID REQUEST               [ 18 ]    ║
║  type-label / text-gold       countdown  ║
╠══════════════════════════════════════════╣
║  RIDER OFFER                             ║
║  $11.50                                  ║
║  text-gold / JetBrains Mono / type-h1   ║
║                                          ║
║  AI fare was  $14.80                    ║
║  text-secondary / JetBrains Mono         ║
║                                          ║
║  YOUR TAKE-HOME AT THIS OFFER            ║
║  $9.20   (80% of $11.50)               ║
║  text-gold / JetBrains Mono             ║
║  ─────────────────────────────────────   ║
║  📍  847 Broad St · 1.2 mi away         ║
║  🏁  Newark Penn Station · 4.2 mi trip  ║
║  ⏱  14 min  ·  Trusted Rider            ║
║  ─────────────────────────────────────   ║
║  [ ACCEPT OFFER ]    [ COUNTER ]         ║
║  bg-teal / text-navy  Secondary button   ║
║  [ DECLINE ]  text-red link / center     ║
╚══════════════════════════════════════════╝
```

**20-second countdown** (5 more than standard — bid evaluation takes longer).
Take-home shown so driver never has to calculate the 80% split mentally.

---

### DS-024 · Counter-Offer Screen

**Purpose:** Driver proposes a different fare. Floor: rider's offer. Ceiling: AI fare + 10% (anti-gouging rule).

```
╔══════════════════════════════════════════╗
║  ← Back        Make a Counter Offer      ║
╠══════════════════════════════════════════╣
║  Rider offered  $11.50                  ║
║  AI fare was    $14.80                  ║
║  text-secondary / JetBrains Mono         ║
║                                          ║
║  YOUR COUNTER OFFER                      ║
║  $  [ 13.00 ]                            ║
║     JetBrains Mono / text-gold / large   ║
║                                          ║
║  Your take-home:  $10.40  (80%)         ║
║  text-gold / JetBrains Mono / live calc  ║
║                                          ║
║  Min $11.50  ──●────────────  Max $16.28 ║
║  [slider: teal fill / gold thumb]        ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  💡 Offers near the AI fare are  │    ║
║  │     accepted ~3× faster.         │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / text-muted               ║
║                                          ║
║  [ SEND COUNTER OFFER ]  Primary button  ║
╚══════════════════════════════════════════╝
```

**Live calculation:** Take-home updates in real time as driver adjusts the slider or input.
**Counter sent:** Rider has 60 seconds to accept/decline/re-counter. Max 2 counter rounds — after that, driver sees only Accept/Decline.
**Counter accepted →** DS-025. **Counter declined →** "Rider declined" toast → DS-020.

---

## §3 — Trip Lifecycle

### DS-025 · Navigating to Pickup

**Purpose:** Turn-by-turn navigation to the rider. Designed for a phone mounted while driving: large type, one-tap controls, no interaction needed to follow the route.

```
╔══════════════════════════════════════════╗
║  ● NAVIGATING TO PICKUP         [SOS]    ║
║  text-teal                      C-080   ║
╠══════════════════════════════════════════╣
║  TURN LEFT ON                            ║
║  McCarter Hwy                            ║
║  type-h1 / text-primary / 36sp           ║
║                                          ║
║  in  0.3 mi                              ║
║  type-h3 / text-teal                     ║
║                                          ║
║  [LIVE MAP — full width, teal route]     ║
║  Driver pin: arrow  ·  Pickup: pulse     ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  📍 847 Broad St  ·  ETA 4 min     │  ║
║  │  [📞 Call]  [💬 Msg]  [✕ Cancel]  │  ║
║  └────────────────────────────────────┘  ║
║  Bottom card / bg-secondary              ║
╚══════════════════════════════════════════╝
```

**Components:** C-080 (SOS — top right, red, z-max), C-082 (Route Deviation Alert chip — appears if off-route)

**Cancel policy:** < 2 min from acceptance = no penalty. > 2 min = acceptance rate decrement. Post-arrival = no-show fee applies to rider.

**Call / Message:** Both use masked numbers — neither party sees real phone numbers.

---

### DS-026 · Arrived at Pickup + Rider Contact

**Purpose:** Driver marks arrival. Starts free-wait timer. Shows rider contact and start-trip controls.

```
╔══════════════════════════════════════════╗
║  ● ARRIVED AT PICKUP            [SOS]    ║
╠══════════════════════════════════════════╣
║  You've arrived.                         ║
║  type-h2 / text-primary                  ║
║                                          ║
║  [rider photo 56px]  Jess T.             ║
║                       Trusted Rider      ║
║                       text-teal badge    ║
║                                          ║
║  ⏱  Wait timer:  0:42                   ║
║  JetBrains Mono / text-secondary         ║
║  Free: 2 min · then $0.25/min           ║
║  text-caption / text-muted               ║
║                                          ║
║  [ 📞 Call Rider ]   [ 💬 Message ]     ║
║  Secondary            Ghost button        ║
║                                          ║
║  [ START TRIP ]                          ║
║  Primary — full width — bg-teal          ║
║                                          ║
║  [Report no-show]   text-red link        ║
║  Appears after 5 min wait only           ║
╚══════════════════════════════════════════╝
```

**Wait timer:** Starts on driver arrival. Free window: 2 minutes. After 2 min: $0.25/min charged to rider (shown on their app, not driver's — prevents awkwardness).
**Report no-show:** Appears at 5 minutes. Filing it: driver receives no-show fee, no acceptance rate penalty. Requires confirmation tap.
**START TRIP:** Active immediately — driver can start before wait timer expires.

---

### DS-027 · In-Trip Navigation

**Purpose:** Primary screen during the trip. Navigation to dropoff. Minimum interaction while driving.

```
╔══════════════════════════════════════════╗
║  ● IN RIDE · Jess T.            [SOS]   ║
║  text-teal / type-caption       C-080   ║
╠══════════════════════════════════════════╣
║  TURN RIGHT ON                           ║
║  Market St                               ║
║  type-h1 / text-primary / 36sp           ║
║                                          ║
║  in  0.6 mi                              ║
║  type-h3 / text-teal                     ║
║                                          ║
║  [LIVE MAP — full width]                 ║
║  Route: teal  ·  Dropoff: flag pin       ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  🏁 Newark Penn Station            │  ║
║  │  ETA: 11 min  ·  3.0 mi remaining │  ║
║  │  YOUR FARE: $14.80                 │  ║
║  │  text-gold / JetBrains Mono        │  ║
║  │  [📞] [💬]           [END TRIP]   │  ║
║  └────────────────────────────────────┘  ║
║  Bottom card / bg-secondary              ║
╚══════════════════════════════════════════╝
```

**SOS:** Top-right, red, z-index max. → DS-054 (SOS Active — Part 4).
**Panic mode:** Triple-tap the shield icon → silent escalation, no visual change (00d-safety-shield-system.md §8).
**Route Deviation Alert (C-082):** Chip appears if deviation > 0.3 mi (night) / 0.5 mi (day).
**END TRIP:** Active only within 0.2 miles of destination — prevents premature trip end.

---

### DS-028 · Dropoff + Trip Complete

**Purpose:** Driver ends the trip. Immediate earnings breakdown. Rider rating. Back to online map.

```
╔══════════════════════════════════════════╗
║  ● TRIP COMPLETE                         ║
╠══════════════════════════════════════════╣
║       ✓  You've arrived!                 ║
║       type-h2 / text-teal                ║
║                                          ║
║  ── TRIP EARNINGS ──────────────────     ║
║  Gross Fare          $18.50             ║
║  BidiRide Fee (20%)  − $3.70             ║
║                      ──────────         ║
║  YOUR EARNINGS        $14.80            ║
║  text-gold / JetBrains Mono / type-h2   ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ✓ Earnings Floor: Met           │    ║
║  │  Your earnings exceed the        │    ║
║  │  guaranteed minimum.             │    ║
║  └──────────────────────────────────┘    ║
║  bg: teal-10% / text-teal / type-caption ║
║                                          ║
║  Today total   $62.00  ·  4 trips       ║
║  text-gold / JetBrains Mono              ║
║                                          ║
║  ── RATE YOUR RIDER ────────────────     ║
║  How was Jess T.?                        ║
║  ★ ★ ★ ★ ★  (tap to rate — teal)       ║
║                                          ║
║  [ SUBMIT & FIND NEXT RIDE ]             ║
║  Primary button / bg-teal / full width   ║
║                                          ║
║  [ Take a break ]   text-secondary link  ║
╚══════════════════════════════════════════╝
```

**Earnings Floor — if triggered (replaces "Met" card):**
```
  ┌──────────────────────────────────┐
  │  ⚡ Earnings Floor Applied       │
  │  Minimum guaranteed:  $12.00    │
  │  Trip earned:         $10.40    │
  │  BidiRide supplement:  +$1.60   │
  │  Total paid to you:   $12.00   │
  │  text-gold / JetBrains Mono     │
  └──────────────────────────────────┘
  bg: gold-10% / border-l: gold
```

**Submit:** Rating stored, trip closed, dispatch resumes.
**"Take a break":** Driver stays online but dispatch paused 5 minutes.

---

## State Management

**Trip status (`trips.status` — PostgreSQL ENUM):**
`accepted → driver_en_route → driver_arrived → in_progress → completed`
Also: `cancelled` (pre-start) · `no_show` (rider absent)

**Driver dispatch state (Redis, TTL = shift duration):**
`offline → online_idle → request_pending → on_trip → post_trip_rating`

**Bid status (`bids.status`):**
`rider_submitted → driver_notified → accepted | declined | countered → [rider responds] → resolved`
Max 2 counter rounds enforced server-side.

---

## Database Fields

**`trips` additions (beyond PRD baseline):**
```sql
bid_id                UUID REFERENCES bids(id) NULLABLE
pickup_wait_seconds   INTEGER DEFAULT 0
wait_fee_charged      DECIMAL(8,2) DEFAULT 0.00
earnings_floor_met    BOOLEAN DEFAULT TRUE
earnings_supplement   DECIMAL(8,2) DEFAULT 0.00
driver_rating_rider   SMALLINT NULLABLE        -- 1–5
route_deviation_count INTEGER DEFAULT 0
```

**`bids` table:**
```sql
id              UUID PRIMARY KEY
trip_id         UUID REFERENCES trips(id)
rider_id        UUID REFERENCES riders(id)
driver_id       UUID REFERENCES drivers(id) NULLABLE
ai_fare         DECIMAL(8,2)
rider_offer     DECIMAL(8,2)
counter_offer   DECIMAL(8,2) NULLABLE
final_fare      DECIMAL(8,2) NULLABLE
status          ENUM(pending,accepted,declined,countered,expired,withdrawn)
expires_at      TIMESTAMP
created_at      TIMESTAMP
resolved_at     TIMESTAMP NULLABLE
```

---

## API Endpoints

```
POST /driver/dispatch/accept/:trip_id
POST /driver/dispatch/decline/:trip_id   { reason }
POST /driver/bids/:bid_id/accept
POST /driver/bids/:bid_id/decline
POST /driver/bids/:bid_id/counter        { counter_amount }
POST /driver/trips/:trip_id/arrived
POST /driver/trips/:trip_id/start
POST /driver/trips/:trip_id/end          { final_lat, final_lng }
POST /driver/trips/:trip_id/call-rider
POST /driver/trips/:trip_id/message-rider { message }
POST /driver/trips/:trip_id/no-show      { waited_seconds }
```

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| App crashes mid-trip | On relaunch: trip state restored from server, nav resumes, SOS re-rendered |
| Driver GPS lost | C-082 alert → SOFT_ALERT at 60s → MODERATE_ALERT at 180s |
| Rider cancels after driver arrives | No-show fee credited if > 2 min wait; toast confirms credit amount |
| END TRIP outside radius | Warning modal — second tap required to override |
| Counter expires (no rider response in 60s) | Toast: "Offer expired" → DS-020; not counted as decline |
| Earnings floor triggered | Supplement logged to `earnings_floor_logs`; shown on DS-028 and weekly payout |

---

## Continuation Notes — Part 3 Covers

- DS-029 · Earnings Dashboard (today / week / history)
- DS-030 · Earnings Floor Protection detail
- DS-031 · Driver Wallet + Instant Payout
- DS-032 · Weekly Payout Center
- DS-033 · Bank Account Management
- DS-034 · Airport Mode Entry + EWR Queue Position
- DS-035 · Airport Queue Dispatch + Terminal Navigation
- All earnings/payout DB schema and API endpoints

---

*BidiRide Driver App UI — Part 2 of 4 — Confidential · Delaware LLC*
