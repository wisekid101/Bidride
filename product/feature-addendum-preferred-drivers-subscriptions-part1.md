# Feature Architecture Addendum — Part 1 of 4
## Preferred Driver Network, BidRide Connect, Driver Following,
## Driver Subscription Plans, Driver Business Center, Corporate Preferred Driver Program

**Status:** Draft — Pending Founder Approval  
**Author:** Architecture Review  
**Date:** 2026-06-07  
**Repo:** wisekid101/Bidride  

---

## Table of Contents (Full Document — 4 Parts)

| Part | Sections |
|------|---------|
| **Part 1** (this file) | Executive Summary · Feature Descriptions · Architecture Overview · ERD Updates |
| **Part 2** | Database Schema Changes · API Changes |
| **Part 3** | Matching Engine Changes · Rider Flows · Driver Flows · Admin Flows · Corporate Flows |
| **Part 4** | Privacy Review · Safety Review · Legal Review · Revenue Analysis · MVP vs Phase 2 |

---

## 1. Executive Summary

Six interconnected features form a **relationship layer** on top of BidRide's existing trip marketplace. Together they shift BidRide from a pure price-matching platform toward a trusted-network platform — where repeat relationships between riders and drivers create stickiness, loyalty, and premium revenue streams.

| Feature | Core Value | Revenue Impact |
|---------|-----------|----------------|
| Preferred Driver Network | Rider retains trusted drivers; driver earns repeat business | Retention; reduced churn |
| BidRide Connect | Formal rider↔driver professional relationship | Premium matching; Connect subscription |
| Driver Following | Rider discovers and tracks drivers they like | Notification engagement; Pro tier gating |
| Driver Subscription Plans | Driver pays for platform benefits (reduced fee, priority) | Direct SaaS revenue from drivers |
| Driver Business Center | Analytics, tax tools, fleet management for drivers | Pro/Elite subscription value driver |
| Corporate Preferred Driver Program | Enterprise accounts dedicate drivers to employee travel | B2B contract revenue; high-margin |

**Design Constraint:** All six features must respect existing trust score privacy rules. Numerical trust scores remain internal. Driver identity exposed only at rider's explicit request post-trip.

---

## 2. Feature Descriptions

### 2.1 Preferred Driver Network

A rider can mark up to **10 drivers** as "preferred." When the rider requests a trip:

- The matching engine checks if any preferred drivers are online and within dispatch radius.
- If ≥1 preferred driver is available, they receive the request **first** with a 45-second exclusive window.
- If no preferred driver accepts within 45s, the request opens to the full driver pool.
- Riders see their preferred list with last-active date and trip count.
- Drivers see a "You have preferred riders" badge (count only — no rider identity exposed).

**Key constraint:** Preferred status is one-directional. The rider preferres the driver; the driver does not explicitly opt in. However, a driver may **block** a specific rider (existing safety feature), which also removes them from that rider's preferred list.

### 2.2 BidRide Connect

Connect is a **mutual, opt-in professional relationship** between a rider and driver, established after ≥1 completed trip together.

- After trip completion, rider may send a "Connect Request" to the driver.
- Driver receives in-app notification and has 72 hours to accept or decline.
- If accepted: both parties see each other in a "My Network" section.
- Connected riders can request their Connected driver **directly** (bypassing the bid pool) — the driver gets a direct booking notification.
- Connected drivers may set their own availability window for direct bookings (e.g., Mon–Fri 6am–10am).
- Direct bookings use the standard fare engine — no price negotiation between parties.
- Either party may disconnect at any time; the trip history is preserved.

**Connect does NOT allow:**
- Off-platform payment (enforced by trip creation requiring app flow)
- Sharing contact information (phone/email) through the platform
- Pre-arranged cash deals

### 2.3 Driver Following

A lighter-weight, one-sided version of Connect. Riders can **follow** a driver after any completed trip.

- No driver approval required (unlike Connect).
- Follower receives a push notification when followed driver comes online within 10 miles.
- Follower can see driver's public profile: photo, first name, vehicle, aggregate rating, badge, bio (optional, driver-written, max 200 chars).
- Drivers can disable following in settings (opt-out).
- Driver sees follower count (not who is following — privacy).
- Following does **not** give priority in matching; it is a notification/discovery feature only.
- Following is gated behind **Pro subscription** for drivers (unlocks follower analytics).

### 2.4 Driver Subscription Plans

Three tiers replacing the current flat 20% platform fee model for subscribing drivers:

| Tier | Monthly Price | Platform Fee | Priority Dispatch | Analytics | Direct Bookings | Follower Analytics |
|------|--------------|--------------|-------------------|-----------|-----------------|-------------------|
| **Basic** | $0 | 20% | No | None | No | No |
| **Pro** | $29/mo | 15% | Standard queue | Basic (30-day) | Yes (via Connect) | Follower count |
| **Elite** | $79/mo | 10% | Elevated | Advanced (90-day, export) | Yes + calendar | Full analytics |

- Billing via Stripe Subscription (monthly, auto-renew).
- Trial: 14-day free Pro trial for newly approved drivers.
- Downgrade: takes effect at end of billing cycle; no proration refund.
- Upgrade: takes effect immediately; prorated charge.
- Paused account (driver goes inactive >30 days): subscription pauses automatically, resumes on return.
- Elite drivers earn a visible **"Elite Partner"** badge (displayed to riders during matching — before acceptance).

### 2.5 Driver Business Center

A dedicated section of the Driver App / web portal with:

**Earnings & Finance**
- Daily, weekly, monthly, YTD earnings breakdown
- Per-trip breakdown: gross fare, platform fee, supplement, net
- Downloadable CSV for tax filing (1099-K compatible)
- Mileage tracker (IRS standard rate calculation)
- Estimated quarterly tax liability (simple: net earnings × 25.3%)

**Performance**
- Acceptance rate, completion rate, cancellation rate
- Rating trend (30/60/90-day)
- Comparison to market average (anonymized)
- Peak hours heat map for Newark / EWR area

**Airport Operations** (EWR-specific)
- Current queue position
- Estimated wait time
- Historical EWR earnings per hour
- Flight delay feed (FlightAware integration — already built)

**Business Settings**
- Connect availability calendar
- Preferred rider notes (private, driver-only — e.g., "prefers quiet ride")
- Vehicle management (multi-vehicle for Elite)
- Tax documents (W-9 on file status)

### 2.6 Corporate Preferred Driver Program

Enterprise accounts (companies with 5+ employee riders) can:

- Maintain a **Preferred Driver Roster** of 1–20 approved drivers.
- Any employee trip request is first offered exclusively to the roster (60-second window).
- If no roster driver accepts, the trip opens to the standard pool.
- Corporate admin dashboard: manage roster, view all employee trips, download reports.
- Billing: monthly invoice (net-30) instead of per-ride card charge; minimum $500/month commitment.
- Drivers on a Corporate Roster receive a **Corporate Partner** badge.
- Corporate accounts negotiate custom platform fee (floor: 12%) — Founder approval required for any rate below 15%.

---

## 3. Architecture Overview

### 3.1 New Service: `relationship-service` (port 3012)

All six features share relationship state (preferred, connected, following, corporate roster). Rather than distributing this across existing services, a dedicated `relationship-service` is the correct boundary.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BidRide Platform                             │
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │  Rider App   │    │  Driver App  │    │    Admin Portal      │  │
│  │  (React RN)  │    │  (React RN)  │    │    (Next.js)         │  │
│  └──────┬───────┘    └──────┬───────┘    └──────────┬───────────┘  │
│         │                  │                        │               │
│  ┌──────▼──────────────────▼────────────────────────▼───────────┐  │
│  │                     API Gateway / ALB                         │  │
│  └──┬──────────┬───────────┬──────────┬────────────┬────────────┘  │
│     │          │           │          │            │                │
│  ┌──▼──┐  ┌───▼───┐  ┌────▼───┐  ┌───▼────┐  ┌───▼──────────┐    │
│  │auth │  │ trip  │  │pricing │  │payment │  │relationship  │    │
│  │:3001│  │ :3002 │  │ :3005  │  │ :3007  │  │   :3012 NEW  │    │
│  └─────┘  └───┬───┘  └────────┘  └───┬────┘  └──────┬───────┘    │
│               │                      │               │             │
│               └──────────────────────┼───────────────┘             │
│                                      │                             │
│  ┌────────────────────────────────────▼────────────────────────┐   │
│  │              Matching Engine (within trip-service)           │   │
│  │   Reads preferred/roster/subscription tier from             │   │
│  │   relationship-service via internal HTTP on dispatch         │   │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────┐    ┌─────────────────────────────────────┐  │
│  │   PostgreSQL      │    │   Redis                             │  │
│  │   (new tables —  │    │   New keys:                         │  │
│  │   see Part 2)     │    │   preferred:dispatch:<tripId>       │  │
│  │                   │    │   connect:notify:<driverId>         │  │
│  │                   │    │   corporate:roster:<corpId>         │  │
│  └───────────────────┘    └─────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 New Service: `corporate-service` (port 3013)

Corporate account management, billing, and roster administration is complex enough to warrant its own service boundary — separating B2B concerns from B2C rider/driver flows.

```
┌─────────────────────────────────────────────────────────┐
│              Corporate Account Flow                     │
│                                                         │
│  Corp Admin Browser                                     │
│       │                                                 │
│       ▼                                                 │
│  corporate-service:3013                                 │
│  ┌──────────────────────────────────────────────────┐  │
│  │  - CorporateAccount CRUD                         │  │
│  │  - DriverRoster management                       │  │
│  │  - Employee management (invite, deactivate)      │  │
│  │  - Monthly invoice generation                    │  │
│  │  - Trip report exports                           │  │
│  │  - Custom fee negotiation (Founder JWT required) │  │
│  └──────────────────────────────────────────────────┘  │
│       │                                                 │
│       ├──── relationship-service (roster lookup)        │
│       ├──── payment-service (invoice, net-30)           │
│       ├──── trip-service (trip history query)           │
│       └──── admin-service (audit log)                   │
└─────────────────────────────────────────────────────────┘
```

### 3.3 Subscription Billing Flow

```
Driver opens subscription upgrade
        │
        ▼
payment-service: create Stripe Subscription
        │
        ├── Stripe webhook: invoice.payment_succeeded
        │         │
        │         ▼
        │   relationship-service: set driver tier = Pro/Elite
        │   trip-service: update dispatch priority weight
        │
        └── Stripe webhook: invoice.payment_failed
                  │
                  ▼
            relationship-service: downgrade to Basic after 7-day grace
            notification-service: alert driver
```

---

## 4. ERD Updates (Conceptual — New Entities Only)

The following entities are **additions** to the existing 40+ model schema. No existing models are modified in Part 1; modifications are detailed in Part 2.

```
┌─────────────────────────┐      ┌──────────────────────────────┐
│    PreferredDriver      │      │       DriverConnection        │
├─────────────────────────┤      ├──────────────────────────────┤
│ id          UUID PK     │      │ id            UUID PK        │
│ riderId     FK→Rider    │      │ riderId        FK→Rider      │
│ driverId    FK→Driver   │      │ driverId       FK→Driver     │
│ createdAt   DateTime    │      │ status  enum(pending/active/ │
│ tripCount   Int         │      │          declined/removed)   │
│             (denorm)    │      │ requestedAt    DateTime      │
│ lastTripAt  DateTime?   │      │ respondedAt    DateTime?     │
│                         │      │ initiatedBy    FK→User       │
│ UNIQUE(riderId,driverId)│      │ calendarRules  Json?         │
└─────────────────────────┘      │                              │
                                 │ UNIQUE(riderId,driverId)     │
                                 └──────────────────────────────┘

┌─────────────────────────┐      ┌──────────────────────────────┐
│    DriverFollower       │      │    DriverSubscription        │
├─────────────────────────┤      ├──────────────────────────────┤
│ id          UUID PK     │      │ id            UUID PK        │
│ riderId     FK→Rider    │      │ driverId      FK→Driver      │
│ driverId    FK→Driver   │      │ tier  enum(basic/pro/elite)  │
│ createdAt   DateTime    │      │ stripeSubId   String?        │
│ notifyOnline Boolean    │      │ status enum(active/paused/   │
│                         │      │        cancelled/trialing)   │
│ UNIQUE(riderId,driverId)│      │ currentPeriodStart DateTime  │
└─────────────────────────┘      │ currentPeriodEnd   DateTime  │
                                 │ trialEndsAt        DateTime? │
                                 │ cancelledAt        DateTime? │
┌─────────────────────────┐      │ UNIQUE(driverId)             │
│   CorporateAccount      │      └──────────────────────────────┘
├─────────────────────────┤
│ id          UUID PK     │      ┌──────────────────────────────┐
│ companyName String      │      │    CorporateDriverRoster     │
│ adminUserId FK→User     │      ├──────────────────────────────┤
│ platformFee Decimal     │      │ id            UUID PK        │
│ billingEmail String     │      │ corporateId   FK→Corporate   │
│ invoiceDue  Int (days)  │      │ driverId      FK→Driver      │
│ minMonthly  Decimal     │      │ addedBy       FK→User        │
│ status enum(active/     │      │ addedAt       DateTime       │
│         suspended/      │      │ removedAt     DateTime?      │
│         pending)        │      │ UNIQUE(corporateId,driverId) │
│ stripeCustomerId String?│      └──────────────────────────────┘
│ founderApproved Boolean │
│ createdAt   DateTime    │      ┌──────────────────────────────┐
└─────────┬───────────────┘      │   CorporateEmployee          │
          │                      ├──────────────────────────────┤
          │                      │ id            UUID PK        │
          │                      │ corporateId   FK→Corporate   │
          ▼                      │ riderId       FK→Rider       │
┌─────────────────────────┐      │ invitedAt     DateTime       │
│  CorporateTrip (view)   │      │ activatedAt   DateTime?      │
│  (materialized for      │      │ deactivatedAt DateTime?      │
│   billing reports)      │      │ UNIQUE(corporateId,riderId)  │
└─────────────────────────┘      └──────────────────────────────┘
```

**Relationships to existing models:**

```
Driver  ──── 1:0..1 ──── DriverSubscription
Driver  ──── 1:N   ──── PreferredDriver  (as the preferred driver)
Driver  ──── 1:N   ──── DriverFollower   (as the followed driver)
Driver  ──── 1:N   ──── DriverConnection (as participant)
Driver  ──── M:N   ──── CorporateAccount (via CorporateDriverRoster)
Rider   ──── 1:N   ──── PreferredDriver  (as the rider with preferences)
Rider   ──── 1:N   ──── DriverFollower   (as the follower)
Rider   ──── 1:N   ──── DriverConnection (as participant)
Rider   ──── M:N   ──── CorporateAccount (via CorporateEmployee)
Trip    ──── 1:1?  ──── (dispatched via preferred/corporate logic, flag on Trip)
```

**New field on existing `Trip` model** (the only existing model touched):
```
dispatchType  enum(standard / preferred / corporate / connect_direct)
corporateId   FK→CorporateAccount?  (null for non-corporate trips)
```

---

*Part 1 of 4 complete.*  
*Proceed to Part 2: Database Schema Changes · API Changes*  
*Awaiting founder direction to continue.*
