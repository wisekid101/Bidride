# Feature Architecture Addendum — Part 2 of 4
## Database · Prisma Models · API · Service Boundaries · Matching Engine · Screen Inventory

**Status:** Draft — Pending Founder Approval
**Continues from:** part1 — Executive Summary, Feature Descriptions, Architecture Overview, ERD

---

## 5. Database Schema Changes

### 5.1 New Tables

| Table | Rows (est. 12mo) | Primary Access Pattern |
|-------|-----------------|----------------------|
| `preferred_drivers` | 50K | riderId + driverId lookup; riderId list |
| `driver_connections` | 20K | riderId list; driverId list; status filter |
| `driver_followers` | 150K | driverId count; riderId list + notifyOnline flag |
| `driver_subscriptions` | 5K | driverId unique lookup; tier filter for dispatch |
| `corporate_accounts` | 200 | id lookup; adminUserId lookup |
| `corporate_driver_rosters` | 2K | corporateId list; driverId lookup |
| `corporate_employees` | 8K | corporateId list; riderId lookup |

### 5.2 Modifications to Existing Tables

**`trips` table — 2 new columns:**

```
dispatchType   VARCHAR(20)  NOT NULL DEFAULT 'standard'
               CHECK (dispatchType IN ('standard','preferred','corporate','connect_direct'))
corporate_id   UUID         NULL  REFERENCES corporate_accounts(id)
```

**`drivers` table — 1 new column:**

```
subscription_tier  VARCHAR(10)  NOT NULL DEFAULT 'basic'
                   CHECK (subscription_tier IN ('basic','pro','elite'))
```
(Denormalized from `driver_subscriptions` for fast dispatch reads. Kept in sync by relationship-service on subscription events.)

### 5.3 Critical Indexes

```sql
-- Preferred driver dispatch (hot path — runs on every trip request)
CREATE UNIQUE INDEX idx_preferred_drivers_rider_driver ON preferred_drivers(rider_id, driver_id);
CREATE INDEX idx_preferred_drivers_driver ON preferred_drivers(driver_id) WHERE active = true;

-- Connection status lookup
CREATE UNIQUE INDEX idx_connections_pair ON driver_connections(rider_id, driver_id);
CREATE INDEX idx_connections_driver_active ON driver_connections(driver_id) WHERE status = 'active';

-- Follower online notification (runs when driver comes online)
CREATE INDEX idx_followers_driver_notify ON driver_followers(driver_id) WHERE notify_online = true;

-- Subscription tier (dispatch weight lookup)
CREATE UNIQUE INDEX idx_subscription_driver ON driver_subscriptions(driver_id);
CREATE INDEX idx_subscription_tier ON driver_subscriptions(tier) WHERE status = 'active';

-- Corporate roster dispatch
CREATE INDEX idx_roster_corporate ON corporate_driver_rosters(corporate_id) WHERE removed_at IS NULL;
CREATE INDEX idx_roster_driver ON corporate_driver_rosters(driver_id) WHERE removed_at IS NULL;

-- Corporate employee lookup
CREATE UNIQUE INDEX idx_corp_employee ON corporate_employees(corporate_id, rider_id);
```

### 5.4 Migration Order (dependency graph)

```
1. driver_subscriptions        (depends on: drivers)
2. preferred_drivers           (depends on: riders, drivers)
3. driver_connections          (depends on: riders, drivers, users)
4. driver_followers            (depends on: riders, drivers)
5. corporate_accounts          (depends on: users)
6. corporate_driver_rosters    (depends on: corporate_accounts, drivers)
7. corporate_employees         (depends on: corporate_accounts, riders)
8. ALTER TABLE trips           (depends on: corporate_accounts)
9. ALTER TABLE drivers         (depends on: driver_subscriptions)
```

---

## 6. Prisma Models (Schema Specification)

```prisma
model PreferredDriver {
  id          String   @id @default(uuid())
  riderId     String
  driverId    String
  active      Boolean  @default(true)
  tripCount   Int      @default(0)
  lastTripAt  DateTime?
  createdAt   DateTime @default(now())

  rider       Rider    @relation(fields: [riderId], references: [id])
  driver      Driver   @relation(fields: [driverId], references: [id])

  @@unique([riderId, driverId])
  @@index([driverId])
  @@map("preferred_drivers")
}

enum ConnectionStatus { pending active declined removed }

model DriverConnection {
  id            String           @id @default(uuid())
  riderId       String
  driverId      String
  status        ConnectionStatus @default(pending)
  initiatedById String
  requestedAt   DateTime         @default(now())
  respondedAt   DateTime?
  calendarRules Json?
  removedAt     DateTime?

  rider         Rider            @relation(fields: [riderId], references: [id])
  driver        Driver           @relation(fields: [driverId], references: [id])
  initiatedBy   User             @relation(fields: [initiatedById], references: [id])

  @@unique([riderId, driverId])
  @@index([driverId, status])
  @@map("driver_connections")
}

model DriverFollower {
  id            String   @id @default(uuid())
  riderId       String
  driverId      String
  notifyOnline  Boolean  @default(true)
  createdAt     DateTime @default(now())

  rider         Rider    @relation(fields: [riderId], references: [id])
  driver        Driver   @relation(fields: [driverId], references: [id])

  @@unique([riderId, driverId])
  @@index([driverId, notifyOnline])
  @@map("driver_followers")
}

enum SubscriptionTier   { basic pro elite }
enum SubscriptionStatus { trialing active paused cancelled }

model DriverSubscription {
  id                  String             @id @default(uuid())
  driverId            String             @unique
  tier                SubscriptionTier   @default(basic)
  status              SubscriptionStatus @default(active)
  stripeSubscriptionId String?
  currentPeriodStart  DateTime
  currentPeriodEnd    DateTime
  trialEndsAt         DateTime?
  cancelledAt         DateTime?
  pausedAt            DateTime?
  updatedAt           DateTime           @updatedAt

  driver              Driver             @relation(fields: [driverId], references: [id])

  @@map("driver_subscriptions")
}

enum CorporateStatus { pending active suspended }

model CorporateAccount {
  id               String          @id @default(uuid())
  companyName      String
  adminUserId      String
  platformFeeRate  Decimal         @default(0.20) @db.Decimal(5,4)
  billingEmail     String
  invoiceDueDays   Int             @default(30)
  minMonthlyCommit Decimal         @default(500.00)
  status           CorporateStatus @default(pending)
  stripeCustomerId String?
  founderApproved  Boolean         @default(false)
  createdAt        DateTime        @default(now())

  adminUser        User            @relation(fields: [adminUserId], references: [id])
  roster           CorporateDriverRoster[]
  employees        CorporateEmployee[]

  @@map("corporate_accounts")
}

model CorporateDriverRoster {
  id            String           @id @default(uuid())
  corporateId   String
  driverId      String
  addedById     String
  addedAt       DateTime         @default(now())
  removedAt     DateTime?

  corporate     CorporateAccount @relation(fields: [corporateId], references: [id])
  driver        Driver           @relation(fields: [driverId], references: [id])
  addedBy       User             @relation(fields: [addedById], references: [id])

  @@unique([corporateId, driverId])
  @@index([corporateId])
  @@map("corporate_driver_rosters")
}

model CorporateEmployee {
  id             String           @id @default(uuid())
  corporateId    String
  riderId        String
  invitedAt      DateTime         @default(now())
  activatedAt    DateTime?
  deactivatedAt  DateTime?

  corporate      CorporateAccount @relation(fields: [corporateId], references: [id])
  rider          Rider            @relation(fields: [riderId], references: [id])

  @@unique([corporateId, riderId])
  @@map("corporate_employees")
}
```

**Additions to existing `Trip` model:**

```prisma
  dispatchType  DispatchType  @default(standard)
  corporateId   String?
  corporate     CorporateAccount? @relation(fields: [corporateId], references: [id])

enum DispatchType { standard preferred corporate connect_direct }
```

**Addition to existing `Driver` model:**

```prisma
  subscriptionTier  SubscriptionTier  @default(basic)   // denorm — sync'd by event
  subscription      DriverSubscription?
  preferredBy       PreferredDriver[]
  followers         DriverFollower[]
  connections       DriverConnection[]
  corporateRosters  CorporateDriverRoster[]
```

---

## 7. API Endpoint Changes

### 7.1 `relationship-service` (NEW — port 3012)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/preferred` | rider JWT | Add driver to preferred list |
| `DELETE` | `/preferred/:driverId` | rider JWT | Remove from preferred list |
| `GET` | `/preferred` | rider JWT | List rider's preferred drivers (max 10) |
| `POST` | `/connect/request` | rider JWT | Send Connect request to driver |
| `POST` | `/connect/:connectionId/respond` | driver JWT | Accept or decline Connect request |
| `DELETE` | `/connect/:connectionId` | either JWT | Disconnect |
| `GET` | `/connect` | either JWT | List active connections |
| `POST` | `/follow/:driverId` | rider JWT | Follow a driver |
| `DELETE` | `/follow/:driverId` | rider JWT | Unfollow |
| `PATCH` | `/follow/:driverId/notify` | rider JWT | Toggle online notification |
| `GET` | `/follow` | rider JWT | List followed drivers |
| `GET` | `/followers/count` | driver JWT | Get follower count (no identities) |
| `PATCH` | `/follow-settings` | driver JWT | Enable/disable being followed |

### 7.2 `corporate-service` (NEW — port 3013)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/corporate` | admin JWT | Create corporate account (Founder approval queue) |
| `GET` | `/corporate/:id` | corp admin JWT | Get account details |
| `PATCH` | `/corporate/:id` | Founder JWT | Approve + set custom fee rate |
| `POST` | `/corporate/:id/roster` | corp admin JWT | Add driver to roster |
| `DELETE` | `/corporate/:id/roster/:driverId` | corp admin JWT | Remove from roster |
| `GET` | `/corporate/:id/roster` | corp admin JWT | List roster |
| `POST` | `/corporate/:id/employees` | corp admin JWT | Invite employee (sends SMS) |
| `DELETE` | `/corporate/:id/employees/:riderId` | corp admin JWT | Deactivate employee |
| `GET` | `/corporate/:id/trips` | corp admin JWT | Trip history (paginated, filterable) |
| `GET` | `/corporate/:id/invoice/:month` | corp admin JWT | Monthly invoice PDF |
| `GET` | `/corporate` | Founder/SuperAdmin JWT | List all corporate accounts |

### 7.3 Changes to Existing Services

**`payment-service` — new subscription endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/subscriptions/upgrade` | Driver upgrades tier — creates Stripe Subscription |
| `POST` | `/subscriptions/downgrade` | Schedules downgrade at period end |
| `POST` | `/subscriptions/pause` | Pauses subscription (>30d inactivity auto-trigger) |
| `POST` | `/subscriptions/resume` | Reactivates paused subscription |
| `GET` | `/subscriptions/status` | Current tier, period, next billing date |
| `POST` | `/webhooks/stripe` | Extended to handle `customer.subscription.*` events |

**`trip-service` — modified dispatch context:**

| Change | Detail |
|--------|--------|
| `POST /trips` request body | Add optional `connectDriverId` — bypasses pool for direct booking |
| `GET /trips/:id` response | Add `dispatchType`, `corporateId` fields |
| Internal: `dispatchTrip()` | Add preferred/corporate/connect routing logic (see §8) |

**`driver-service` — driver public profile:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/drivers/:id/profile` | Public profile (photo, first name, badge, bio, rating, vehicle). Requires prior completed trip with requester. |
| `PATCH` | `/drivers/profile/bio` | Driver updates bio (200 char max, moderated) |

---

## 8. Service Boundaries

### 8.1 Data Ownership Map

| Data Domain | Owner Service | Read-By |
|-------------|--------------|---------|
| Preferred driver list | relationship-service | trip-service (dispatch) |
| Connection state | relationship-service | trip-service, driver-service |
| Follower list | relationship-service | notification-service |
| Subscription tier | payment-service (source of truth) | relationship-service (sync), trip-service (dispatch) |
| Driver.subscriptionTier | driver-service (denorm replica) | trip-service (fast read) |
| Corporate accounts | corporate-service | admin-service, trip-service |
| Corporate roster | corporate-service (source of truth) | trip-service (dispatch) |
| Corporate trips | trip-service | corporate-service (read-only query) |
| Invoice/billing | payment-service | corporate-service |

### 8.2 Inter-Service Communication

```
Synchronous (HTTP, internal):
  trip-service → relationship-service   GET /preferred?driverId[]=... (dispatch check)
  trip-service → corporate-service      GET /roster?corporateId=...  (dispatch check)
  corporate-service → payment-service   POST /invoices (monthly billing)
  corporate-service → trip-service      GET /trips?corporateId=... (reports)

Asynchronous (SQS events):
  payment-service  →  relationship-service   subscription.upgraded / subscription.downgraded
  relationship-service → notification-service driver.online (fan-out to followers)
  relationship-service → notification-service connect.requested / connect.accepted
  trip-service → relationship-service         trip.completed (increment preferredDriver.tripCount)
```

### 8.3 Redis Key Additions

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `preferred:lock:<tripId>` | 45s | Exclusive preferred driver dispatch window |
| `corporate:lock:<tripId>` | 60s | Exclusive corporate roster window |
| `connect:direct:<driverId>:<riderId>` | 120s | Direct booking notification window |
| `driver:online:<driverId>` | 90s | Presence key (triggers follower notifications) |
| `sub:tier:<driverId>` | 300s | Cached subscription tier for dispatch hot path |

---

## 9. Matching Engine Modifications

### 9.1 Current Algorithm (Baseline)

```
dispatchTrip(trip):
  1. Find drivers online within radius (Redis geo)
  2. Filter: approved, not on trip, passed background check
  3. Score each driver:
       score = (1/distance) × trust_weight × availability_weight
  4. Send to top N drivers simultaneously (current: N=5)
  5. First to accept wins (Redis NX atomic claim)
```

### 9.2 New Dispatch Priority Layers

The existing algorithm becomes the **fallback (Layer 4)**. New layers run first in sequence:

```
Layer 1 — Connect Direct (if trip.connectDriverId set)
  ├── Verify active connection between rider and driver
  ├── Driver must be online + within 15 miles
  ├── Send exclusive notification (120s window)
  └── On timeout/decline → fall to Layer 2

Layer 2 — Corporate Roster (if rider is CorporateEmployee)
  ├── Load roster from Redis cache (key: corporate:roster:<corpId>)
  ├── Filter: online, within radius, not on trip
  ├── Send to ALL eligible roster drivers (60s exclusive window)
  │   Redis key: corporate:lock:<tripId> = rosterId
  └── On timeout/no accept → fall to Layer 3

Layer 3 — Preferred Driver (if rider has preferred drivers)
  ├── Load preferred list (max 10) from relationship-service
  ├── Filter: online, within radius, not on trip
  ├── If ≥1 available: send to all eligible preferred drivers
  │   Redis key: preferred:lock:<tripId> (45s)
  └── On timeout/no accept → fall to Layer 4

Layer 4 — Standard Pool (existing algorithm, modified)
  ├── Score = (1/distance) × trust_weight × availability_weight
  │          × subscription_boost
  ├── subscription_boost:
  │     basic  → 1.00  (no boost)
  │     pro    → 1.15  (15% score boost)
  │     elite  → 1.30  (30% score boost)
  └── Top N = 8 (increased from 5 to compensate for preferred fallthrough)
```

### 9.3 Dispatch Timing Budget

```
Total max dispatch time before rider sees "searching" timeout (120s):
  Layer 1 Connect Direct:   0–120s  (takes full budget if used)
  Layer 2 Corporate Roster:  0–60s
  Layer 3 Preferred:          0–45s
  Layer 4 Standard Pool:    remaining time up to 120s total
```

### 9.4 Driver Score Override Rules (Non-Negotiable)

- Safety-flagged drivers skip ALL layers — standard safety override applies.
- Fraud auto-hold drivers skip ALL layers.
- A driver who has blocked the rider is excluded from ALL layers.
- Trust score thresholds are not exposed to drivers or riders through any dispatch path.

---

## 10. Mobile Screen Inventory

### 10.1 Rider App — New Screens

| Screen | Trigger | Key Elements |
|--------|---------|--------------|
| `PreferredDriversScreen` | Profile → "My Preferred Drivers" | List (max 10), last trip date, remove button |
| `DriverProfileScreen` | Post-trip sheet or preferred list tap | Photo, first name, badge, bio, rating, vehicle. "Add Preferred", "Follow", "Connect" CTAs |
| `ConnectRequestScreen` | DriverProfileScreen → "Connect" | Request confirmation, sets expectation (72h response) |
| `MyNetworkScreen` | Profile → "My Network" | Tabs: Connected · Following · Pending |
| `DirectBookingScreen` | MyNetwork → Connected driver | Select Connected driver, request ride (uses trip creation flow) |
| `CorporateTripScreen` | Auto — if rider is CorporateEmployee | Banner: "Corporate trip — billed to [Company]", roster status |

### 10.2 Driver App — New Screens

| Screen | Trigger | Key Elements |
|--------|---------|--------------|
| `BusinessCenterHomeScreen` | Bottom nav → "Business" | Cards: Earnings, Performance, Airport, Connect Calendar |
| `EarningsDetailScreen` | Business → Earnings | Daily/weekly/monthly chart, per-trip list, CSV export |
| `TaxSummaryScreen` | Business → Tax | YTD net, mileage total, IRS rate calc, estimated quarterly tax |
| `PerformanceScreen` | Business → Performance | Acceptance rate, completion rate, rating trend, market compare |
| `AirportAnalyticsScreen` | Business → Airport | Queue history, $/hr by time-of-day, flight delay overlay |
| `ConnectCalendarScreen` | Business → Connect | Weekly availability grid, direct booking toggle |
| `SubscriptionScreen` | Profile → "My Plan" | Current tier, benefits compare table, upgrade/downgrade CTA |
| `ConnectRequestsScreen` | Notifications → Connect | Pending requests list, accept/decline, 72h countdown |
| `FollowerStatsScreen` | Pro/Elite only — Business → Followers | Follower count, growth chart (no rider identities) |
| `CorporateBadgeScreen` | Profile → badges | Corporate Partner status, which accounts (names only) |

### 10.3 Shared / Modified Screens

| Screen | Change |
|--------|--------|
| `IncomingRequestScreen` | Add dispatch type badge: "Preferred Rider", "Corporate", "Direct Booking" |
| `EarningsDashboardScreen` | Add subscription tier chip; "Upgrade for lower fee" upsell if Basic |
| `DriverHomeScreen` | Add "Business Center" shortcut card |
| `TripCompleteScreen` (rider) | Add "Add [Driver] to preferred" + "Follow [Driver]" CTAs |
| `TripCompleteScreen` (driver) | Add "Connect with [Rider]?" prompt if ≥3 trips with same rider |

---

## 11. Admin Dashboard Inventory

### 11.1 New Admin Pages

| Page | Route | Role Required | Key Functions |
|------|-------|--------------|---------------|
| Subscriptions Overview | `/subscriptions` | Operations Admin | MRR, tier breakdown, churn rate, trial conversions |
| Driver Subscription Detail | `/subscriptions/:driverId` | Operations Admin | Tier history, Stripe link, manual override |
| Corporate Accounts | `/corporate` | Founder / Super Admin | List all accounts, status, MRR, pending approvals |
| Corporate Account Detail | `/corporate/:id` | Operations Admin | Roster, employees, trip volume, invoice history |
| Corporate Approval Queue | `/corporate/pending` | Founder only | Review + approve new corporate accounts, set custom fee |
| Relationship Analytics | `/analytics/relationships` | Analytics Admin | Preferred network density, Connect adoption, Follow growth |
| Dispatch Analytics | `/analytics/dispatch` | Analytics Admin | Layer hit rates (L1/L2/L3/L4), preferred fallthrough %, avg dispatch time |

### 11.2 Modified Admin Pages

| Page | Change |
|------|--------|
| Driver Detail (`/drivers/:id`) | Add Subscription tab: tier, billing period, Stripe subscription ID |
| Driver Detail | Add Relationships tab: preferred by (count), follower count, active connections (count) |
| Driver Approval | Add: "Add to Corporate Roster" action post-approval |
| Earnings Floor | No change — Founder-only lock unchanged |
| Fraud | No change — subscription status visible but fraud logic unchanged |
| Analytics Dashboard | Add MRR widget (subscription + corporate), dispatch layer pie chart |

---

*Part 2 of 4 complete.*
*Continues in Part 3: Rider Flows · Driver Flows · Admin Flows · Corporate Flows · Privacy Review · Safety Review*
*Awaiting founder direction to continue.*
