# Feature Architecture Addendum — Part 4 of 4 (Final)
## Rider Flows · Driver Flows · Admin Flows · Corporate Flows · MVP Checklist · Founder Approval

**Status:** Draft — Pending Founder Approval
**Continues from:** Part 3 — Privacy, Safety, Regulatory, Airport Ops, Compliance, Revenue, Roadmap
**This part completes the addendum.**

---

## 19. Rider Flows

### 19.1 Adding a Preferred Driver (Post-Trip)

```
Trip ends → TripCompleteScreen shows
  │
  ├── CTA: "Add [Driver First Name] to Preferred"
  │         │
  │         ├── IF preferred list < 10:
  │         │     POST /preferred → 201 Created
  │         │     Toast: "Driver added to your preferred list"
  │         │
  │         └── IF preferred list = 10:
  │               Modal: "You have 10 preferred drivers (max).
  │                       Remove one to add [Driver]."
  │               → Opens PreferredDriversScreen
  │
  └── CTA: "Follow [Driver First Name]"
            POST /follow/:driverId → 201 Created
            Toast: "You'll be notified when [Driver] is nearby"
```

### 19.2 Requesting a Ride with Preferred Driver Priority

```
Rider opens HomeScreen → enters pickup + dropoff
  │
  ▼
POST /trips (trip-service)
  │
  ▼
Dispatch Layer 3 (preferred) fires automatically — no rider action needed
  │
  ├── IF preferred driver available within radius:
  │     Rider sees: "Offering to your preferred drivers first…"
  │     45s countdown indicator
  │     │
  │     ├── Driver accepts → standard trip flow
  │     └── Timeout → "Opening to all nearby drivers"
  │                   → Layer 4 fires, indicator updates
  │
  └── IF no preferred drivers online:
        Silent fallthrough to Layer 4
        Rider sees standard "Finding your driver…"
```

### 19.3 Sending a Connect Request

```
Rider views DriverProfileScreen (requires ≥1 shared completed trip)
  │
  ├── Tap "Connect"
  │     │
  │     ├── Confirmation sheet:
  │     │   "Request a professional connection with [Driver]?
  │     │    They have 72 hours to respond."
  │     │   [Connect] [Cancel]
  │     │
  │     ├── POST /connect/request → 201 Created
  │     │
  │     └── Rider sees connection status: "Pending (72h)"
  │           in MyNetworkScreen → Pending tab
  │
  ├── Driver accepts (within 72h):
  │     Push notification: "[Driver] accepted your connection!"
  │     Status → Active in MyNetworkScreen → Connected tab
  │
  └── Driver declines or 72h expires:
        Push notification: "Connection request expired"
        Status removed from Pending tab (no decline reason shown)
```

### 19.4 Direct Booking via Connect (Layer 1 Dispatch)

```
MyNetworkScreen → Connected tab → tap driver card
  │
  ├── "Book [Driver] directly" button
  │     (only shown if driver has direct bookings enabled)
  │
  ├── Standard pickup/dropoff entry
  │
  ├── Fare estimate shown (same engine, no discount)
  │
  ├── POST /trips with connectDriverId field
  │
  ├── Driver receives dedicated notification (120s window):
  │   "[Rider First Name] is requesting a direct ride"
  │   Accept / Decline
  │
  ├── Driver accepts → standard in-trip flow, dispatchType=connect_direct
  │
  └── Driver declines or 120s timeout:
        Rider notified: "[Driver] isn't available right now"
        Option: "Find another driver" → Layer 4 standard dispatch
```

### 19.5 Corporate Employee Trip Request

```
Rider opens app (linked corporate account)
  │
  ├── Banner: "Corporate trip — billed to [Company Name]"
  │
  ├── Standard pickup/dropoff entry
  │
  ├── POST /trips → trip-service detects corporateId via CorporateEmployee lookup
  │
  ├── Layer 2 fires: corporate roster checked first (60s window)
  │   Rider sees: "Connecting with your company's preferred drivers…"
  │
  ├── Roster driver accepts → dispatchType=corporate
  │   Receipt shows: "Billed to [Company]" — rider's personal card not charged
  │
  └── No roster driver available → standard pool
        Receipt still billed to corporate account
```

---

## 20. Driver Flows

### 20.1 Receiving a Preferred Dispatch

```
Driver is online → eligible preferred dispatch arrives
  │
  ├── IncomingRequestScreen shows badge: "⭐ Preferred Rider"
  │   (same accept/decline UI — badge is informational only)
  │
  ├── Accept → standard trip flow
  │   Trip completes → preferredDriver.tripCount +1 (async, relationship-service)
  │
  └── Decline → no penalty; trip falls to Layer 4
        (declining a preferred dispatch does not affect trust score)
```

### 20.2 Responding to a Connect Request

```
Push notification: "[Rider First Name] wants to Connect"
  │
  ├── Opens ConnectRequestsScreen → request card with:
  │   - Rider first name + badge
  │   - Trips together: N
  │   - 72h countdown
  │
  ├── [Accept]:
  │     PATCH /connect/:id/respond { accepted: true }
  │     Both parties notified
  │     Driver can now configure Connect calendar (optional, Phase 2)
  │
  └── [Decline]:
        PATCH /connect/:id/respond { accepted: false }
        Rider notified (no reason shown)
        Driver cannot be re-requested by same rider for 30 days
```

### 20.3 Upgrading Subscription

```
DriverApp → Profile → "My Plan" → SubscriptionScreen
  │
  ├── Current tier shown with benefit comparison table
  │
  ├── Tap "Upgrade to Pro" or "Upgrade to Elite"
  │     │
  │     ├── Stripe payment sheet (card on file or add new)
  │     │
  │     ├── POST /subscriptions/upgrade → payment-service
  │     │     Creates Stripe Subscription
  │     │     Returns: new tier, next billing date
  │     │
  │     ├── SQS event → relationship-service updates driver tier
  │     │
  │     ├── Driver.subscriptionTier updated (denorm)
  │     │
  │     └── Toast: "You're now a Pro driver! Lower fees start on your next trip."
  │
  └── "14-day free trial" shown for newly approved drivers only
        Trial ends → auto-converts to paid; 7-day advance email notice required
```

### 20.4 Opting into a Corporate Roster

```
Driver receives push: "[Company Name] has added you to their preferred roster"
  │
  ├── Opens CorporateBadgeScreen → roster invitation card:
  │   Company name, estimated weekly trips, no personal employee data shown
  │
  ├── [Join Roster]:
  │     PATCH /corporate/:id/roster/:driverId/confirm
  │     Driver earns "Corporate Partner" badge
  │     Corporate trips now offered at Layer 2 priority
  │
  └── [Decline]:
        Roster entry is removed
        No platform penalty; driver not notified to corporate admin by name
        (admin sees roster slot as "unconfirmed")
```

### 20.5 Driver Business Center — Tax Flow

```
BusinessCenterHomeScreen → Tax Summary card
  │
  ├── YTD net earnings pulled from completed trips
  ├── Total miles: sum of trip_distance_miles (driver must confirm personal miles separately)
  ├── IRS standard mileage rate applied: miles × $0.67 (2025 rate — update annually)
  ├── Estimated deduction: mileage + platform fees paid
  ├── Estimated quarterly tax: (net − deduction) × 25.3%
  │
  ├── [Download 1099-K Compatible CSV]
  │     Requires: driver has ≥$600 net earnings in period (IRS threshold)
  │
  └── Disclaimer shown: "This is an estimate. Consult a tax professional."
```

---

## 21. Admin Flows

### 21.1 Corporate Account Approval (Founder Only)

```
Admin Portal → Corporate → Pending tab
  │
  ├── Card: company name, contact, requested fee rate, estimated volume
  │
  ├── [Review] → Corporate Account Detail page
  │   Fields: company legal name, billing email, invoiceDueDays,
  │            minMonthlyCommit, requested platformFeeRate
  │
  ├── Founder inputs: approved fee rate (floor: 12%)
  │   Any rate < 15% requires Founder JWT to save (same Founder-only lock pattern)
  │
  ├── [Approve] → PATCH /corporate/:id { founderApproved: true, platformFeeRate }
  │   corporate-service sends welcome email to billing contact
  │   Corporate admin can now access their portal
  │
  └── [Reject] → status = suspended; rejection reason stored (internal only)
```

### 21.2 Subscription Monitoring

```
Admin Portal → Subscriptions → Overview
  │
  ├── MRR widget: Pro MRR + Elite MRR (updates daily)
  ├── Tier breakdown: Basic N / Pro N / Elite N / Trialing N
  ├── 30-day churn: drivers who downgraded or cancelled
  ├── Trial conversion rate: trials → paid (rolling 30-day)
  │
  ├── Driver list filterable by tier
  │   Row actions: [View Stripe Dashboard] [Manual Tier Override]
  │
  └── Manual override requires: Operations Admin role + reason field
        Audit log entry created (compliance)
```

### 21.3 Relationship Abuse Investigation

```
Trigger: safety report, fraud flag, or manual escalation
  │
  Admin Portal → Driver Detail → Relationships tab
  │
  ├── Preferred-by count (no rider names)
  ├── Active connections count
  ├── Follower count + follow-rate anomaly flag (>50 follows/day = auto-flag)
  │
  ├── Actions available:
  │   [Suspend Following] — driver cannot be followed; existing followers deactivated
  │   [Suspend Connect]  — all Connect requests blocked; active connections preserved
  │   [Remove from All Corporate Rosters] — removes driver from every roster
  │
  └── All actions create audit log entries
        Requires: Safety Admin role minimum
        Permanent action requires: Super Admin approval
```

---

## 22. Corporate Account Flows

### 22.1 Corporate Account Onboarding

```
Step 1 — Application
  Corporate contact fills web form (corporate-service public endpoint):
  Company name · billing email · estimated monthly trips · contact name

Step 2 — BidiRide Review
  Placed in Pending queue → Founder reviews (§21.1)
  Timeline: 1–3 business days

Step 3 — Approval & DPA
  Corporate admin receives email with portal access link
  First login requires DPA acceptance (in-portal, logged with timestamp)

Step 4 — Setup
  Admin builds driver roster → invites employees
  Each driver receives opt-in notification (§20.4)
  Each employee receives SMS invite with deep link to link their rider account

Step 5 — First Trip
  Corporate account is live when ≥1 roster driver has confirmed + ≥1 employee activated
```

### 22.2 Managing the Driver Roster

```
Corporate Portal → Roster tab
  │
  ├── [Add Driver]
  │     Search by: driver badge code (shared by driver) or full name + vehicle
  │     Driver receives opt-in notification — roster slot = "Pending"
  │     Slot becomes Active when driver confirms (§20.4)
  │
  ├── [Remove Driver]
  │     Immediate — driver no longer receives corporate priority dispatch
  │     Driver notified: "[Company] has removed you from their roster"
  │
  └── Roster cap: 20 drivers max (configurable by Founder)
```

### 22.3 Monthly Invoice Flow

```
1st of month → payment-service cron job runs
  │
  ├── Queries: all trips WHERE corporateId = X AND month = prior month
  ├── Sums: total fare, platform fee, net to BidiRide
  ├── Generates: PDF invoice (itemized by employee, trip date, zone, amount)
  ├── Charges: Stripe invoice created, due in invoiceDueDays
  │
  ├── IF sum < minMonthlyCommit:
  │     Invoice = minMonthlyCommit (minimum enforced)
  │
  ├── Email sent to billingEmail with PDF attached
  │
  └── IF invoice unpaid after due date + 7 days:
        corporate-service → admin-service: alert Operations Admin
        Corporate account status → suspended (roster dispatch paused)
        Employees can still request trips (charged to personal card)
```

---

## 23. Step-by-Step User Journeys

### 23.1 EWR → Manhattan Corporate Trip (Full Journey)

```
[Employee] opens BidiRide at EWR arrivals
      ↓
Corporate banner shown: "Trip billed to Acme Corp"
      ↓
Enters dropoff: One Penn Plaza
      ↓
POST /trips → trip-service detects corporateId
      ↓
Layer 2: corporate roster loaded from Redis
  ├── 3 roster drivers near EWR, none in FIFO queue
  ├── All 3 receive corporate dispatch notification (60s)
  │
Driver #1 accepts (8 seconds)
      ↓
Trip confirmed: dispatchType = corporate
ETA shown. "Corporate Partner" badge visible on driver card.
      ↓
Trip completes. Receipt shows: "Billed to Acme Corp · $0.00 charged to you"
      ↓
Corporate account invoiced at month-end.
```

### 23.2 Connect Direct Booking Journey

```
[Rider] opens MyNetworkScreen → Connected tab
  Driver: James W. · Elite Partner · Available Mon–Fri 6am–10am
      ↓
Tap "Book James directly"
      ↓
Enter pickup + dropoff · Fare estimate: $18.20
      ↓
POST /trips { connectDriverId: "..." }
      ↓
James receives dedicated notification:
  "Maria is requesting a direct ride — EWR to Manhattan"
  [Accept] [Decline] — 120s window
      ↓
James accepts (22 seconds)
      ↓
Standard trip flow: en route → arrived → in progress → complete
dispatchType = connect_direct logged
      ↓
Trip complete: Maria sees "Book James again" CTA on receipt.
```

---

## 24. MVP Approval Checklist

*For each item: ✅ Ready to build · ⚠️ Needs decision · ❌ Blocked*

### Architecture
- ✅ relationship-service (port 3012) — service boundary defined, ERD complete
- ✅ corporate-service (port 3013) — service boundary defined, ERD complete
- ✅ 7 new Prisma models — fully specced (Part 2)
- ✅ 4-layer matching engine — logic defined, EWR queue protection rule set
- ✅ Subscription tiers — Basic/Pro/Elite pricing, Stripe billing flow defined
- ⚠️ Subscription boost weights (Pro 1.15×, Elite 1.30×) — **Founder must confirm percentages**
- ⚠️ Preferred driver cap (10) — **Founder must confirm cap number**
- ⚠️ Corporate fee floor (12%) — **Founder must confirm minimum rate**
- ⚠️ Corporate roster cap (20 drivers) — **Founder must confirm cap**

### Legal / Compliance
- ⚠️ NJ ABC Test — **legal counsel review required before subscription launch**
- ⚠️ Driver DPA template — **legal counsel must draft before corporate launch**
- ⚠️ Consumer auto-renewal disclosure copy — **legal must approve Subscription screen wording**
- ❌ Driver opt-in language for corporate roster — **not yet drafted**

### Privacy
- ✅ Follower anonymity design — count-only, no identity exposed
- ✅ Corporate employee disclosure requirement — DPA gate defined
- ⚠️ CCPA deletion cascade for new tables — **must be added to existing deletion pipeline**

### Safety
- ✅ All safety overrides preserved — verified in Part 3
- ✅ EWR FIFO queue protection — non-override rule defined
- ⚠️ Follower rate-limit values (3 notifications/24h, 10 follow-changes/day) — **Founder must confirm**
- ⚠️ Connect re-request cooldown (30 days) — **Founder must confirm duration**

### Revenue
- ✅ Subscription pricing modeled — base case $331K ARR at month 12
- ✅ Corporate minimum ($500/month) defined
- ⚠️ Pro price ($29) and Elite price ($79) — **Founder must confirm final pricing**
- ⚠️ Trial length (14 days) — **Founder must confirm**

---

## 25. Founder Approval Decision Page

**Document:** Feature Architecture Addendum — Preferred Driver Network, BidiRide Connect, Driver Following, Driver Subscription Plans, Driver Business Center, Corporate Preferred Driver Program

**Parts:** 4 of 4 complete
**Total pages:** ~1,100 lines across 4 files
**GitHub:** `wisekid101/Bidride` — `product/` directory

---

### Decisions Required from Founder Before Build Begins

| # | Decision | Options | Default if No Response |
|---|---------|---------|----------------------|
| 1 | Subscription tier pricing | Pro: $29/mo, Elite: $79/mo · OR set different | Hold — do not build |
| 2 | Preferred driver cap | 10 drivers · OR set different | Hold |
| 3 | Subscription dispatch boost | Pro 1.15×, Elite 1.30× · OR adjust | Hold |
| 4 | Corporate platform fee floor | 12% minimum · OR set different | Hold |
| 5 | Corporate roster cap | 20 drivers · OR set different | Hold |
| 6 | Connect re-request cooldown | 30 days · OR set different | Hold |
| 7 | Follower notification rate limit | 3/24h per driver · OR set different | Hold |
| 8 | Free trial length | 14 days · OR set different | Hold |
| 9 | Legal counsel engaged? | Yes / Not yet | Block corporate launch |
| 10 | MVP feature scope confirmed? | All 6 features · OR subset | Hold all build |

---

### Approval Signature Block

```
┌─────────────────────────────────────────────────────────┐
│                  FOUNDER APPROVAL                       │
│                                                         │
│  I, Marq Brown, Founder of BidiRide LLC, have reviewed  │
│  the Feature Architecture Addendum (Parts 1–4) and     │
│  approve proceeding to implementation planning for      │
│  the features and scope specified herein.              │
│                                                         │
│  Approved features (circle all that apply):            │
│    Preferred Driver Network    BidiRide Connect          │
│    Driver Following            Subscription Plans       │
│    Driver Business Center      Corporate Program        │
│                                                         │
│  Open decisions resolved: ______________________________│
│                                                         │
│  Signature: ____________________  Date: ___________    │
│                                                         │
│  Reply "FOUNDER APPROVAL GRANTED" with decisions        │
│  resolved to proceed to Phase 1 implementation.        │
└─────────────────────────────────────────────────────────┘
```

---

*Part 4 of 4 complete. The Feature Architecture Addendum is now fully drafted.*
*No code has been written. No production architecture has been modified.*
*Awaiting founder approval before any implementation begins.*
