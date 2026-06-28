# BidiRide — Admin Command Center v1.0 · Part 3

**Status:** Draft — Pending Founder Approval
**Document:** 07-C · Part 3 of 3 · Admin Command Center COMPLETE
**References:** 07-admin-command-center-part1.md · 07-admin-command-center-part2.md

---

## Screen Index

| ID | Screen | Section |
|---|---|---|
| A-11 | Fraud Detection Center | §1 |
| A-12 | Earnings Floor Monitoring | §2 |
| A-13 | Airport Queue Management | §2 |
| A-14 | Support Ticket Management | §3 |
| A-15 | Rating Dispute Resolution | §3 |
| A-16 | Refund Management | §3 |
| A-17 | Analytics Dashboard | §4 |

---

## §1 — Fraud Detection

### A-11 · Fraud Detection Center

**Purpose:** AI-generated fraud alerts reviewed by Safety Admin or Platform Admin. Each alert has a fraud category, confidence score, evidence, and recommended action. No automated account action is taken without human approval.

```
┌──────────────────────────────────────────────────────────────────────┐
│  🚨 Fraud Detection Center                   14 open alerts          │
│  [ All ] [ High Risk ] [ GPS Spoof ] [ Payment ] [ Multi-Account ]  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┬─────────────────┬──────────┬──────────┬────────────┐  │
│  │ User     │ Fraud Type      │ AI Score │ Status   │ Action     │  │
│  ├──────────┼─────────────────┼──────────┼──────────┼────────────┤  │
│  │ Bob T.   │ GPS Spoofing    │  91%  🔴 │ Open     │ [Investigate]│ │
│  │ Anon #47 │ Payment Fraud   │  87%  🔴 │ Open     │ [Investigate]│ │
│  │ Dana L.  │ Multi-Account   │  74%  ⚠  │ Open     │ [Investigate]│ │
│  │ Mark Z.  │ Fake Rating     │  68%  ⚠  │ Reviewing│ [View]     │  │
│  └──────────┴─────────────────┴──────────┴──────────┴────────────┘  │
│  AI Score: JetBrains Mono · 🔴 ≥ 85% · ⚠ 60–84% · — < 60%        │
└──────────────────────────────────────────────────────────────────────┘
```

**Investigation Panel:**
```
┌────────────────────────────────────────────────────────────────────┐
│  Fraud Investigation — Bob T. (Rider #R-04821)           ×        │
├──────────────────────────────────────────────────────────────────────┤
│  FRAUD TYPE: GPS Spoofing          AI FRAUD SCORE: 91%            │
│  JetBrains Mono · admin-only                                       │
│                                                                     │
│  EVIDENCE                                                           │
│  ● GPS reported location: Downtown Newark                          │
│  ● Cell tower triangulation: Bayonne, NJ (3.2 mi discrepancy)     │
│  ● Speed pattern: 0→68 mph in 1.2 seconds (physically impossible)  │
│  ● 4 trips affected · $71.40 total                                 │
│                                                                     │
│  AI RECOMMENDATION: Suspend + chargeback review                    │
│                                                                     │
│  ADMIN DECISION                                                     │
│  ○ No action — dismiss alert      ○ Warning — notify user          │
│  ● Suspend account (7 days)       ○ Permanent ban                  │
│  ☑ Flag affected trips for refund review                          │
│  ☑ Block device fingerprint                                        │
│                                                                     │
│  Internal note: ─────────────────────────────────────────────────  │
│  [ Submit ]  Platform Admin required for suspend/ban               │
└────────────────────────────────────────────────────────────────────┘
```

**Fraud categories and evidence sources:**

| Category | AI signals used |
|---|---|
| GPS Spoofing | Cell tower vs. reported GPS discrepancy · impossible speed changes |
| Payment Fraud | Chargeback history · card velocity · BIN mismatch |
| Multi-Account | Device fingerprint match · phone/email graph · IP clustering |
| Fake Rating | Rating timing patterns · driver-rider interaction frequency · sentiment mismatch |
| Referral Fraud | Referral graph cycles · device fingerprint clusters · same bank account |

**Rule:** AI score ≥ 90% → account auto-placed on hold (not suspended) pending admin review within 2 hours. Admin must confirm or lift the hold. No permanent action is automated.

---

## §2 — Operations

### A-12 · Earnings Floor Monitoring

**Purpose:** Finance Admin tracks earnings floor utilization, total supplements paid, and individual trip floor calculations. Founder has authority to adjust the floor formula parameters.

```
┌──────────────────────────────────────────────────────────────────────┐
│  💰 Earnings Floor Monitoring                                        │
├──────────────────────────────────────────────────────────────────────┤
│  THIS WEEK (Jun 2 – Jun 8)                                          │
│                                                                      │
│  ┌─────────────────┬─────────────────┬─────────────────────────┐   │
│  │ TRIPS WITH FLOOR│ TOTAL SUPPLEMENT│ AVG SUPPLEMENT/TRIP     │   │
│  │    47 / 1,284   │    $312.40      │      $6.65              │   │
│  │    (3.7%)       │   text-gold     │     text-gold           │   │
│  └─────────────────┴─────────────────┴─────────────────────────┘   │
│  JetBrains Mono throughout                                          │
│                                                                      │
│  FLOOR FORMULA (current — Founder authority to change)              │
│  (distance × $1.10) + (duration_min × $0.22) + $2.50 base          │
│  Last changed: Jun 1, 2026 · Changed by: Founder                   │
│  [ Request Formula Change ]  Founder token required                 │
│                                                                      │
│  TRIPS WHERE FLOOR WAS TRIGGERED (this week)                        │
│  ┌──────────┬────────────┬──────────┬───────────┬──────────────┐   │
│  │ Trip #   │ Driver     │ Earned   │ Floor     │ Supplement   │   │
│  ├──────────┼────────────┼──────────┼───────────┼──────────────┤   │
│  │  #8741   │ James T.   │ $8.20   │ $10.40   │ +$2.20      │   │
│  │  #8698   │ Sara L.    │ $9.10   │ $11.80   │ +$2.70      │   │
│  └──────────┴────────────┴──────────┴───────────┴──────────────┘   │
│  All amounts: JetBrains Mono / text-gold                            │
└──────────────────────────────────────────────────────────────────────┘
```

**Business rule:** Floor formula parameters are stored in a `platform_config` table. Updates require a Founder-signed JWT in the request header. Any change is logged in `audit_logs` with before/after formula values.

---

### A-13 · Airport Queue Management

**Purpose:** Operations Admin manages the EWR airport queue — adjusts queue capacity, monitors driver positions, controls surge settings, and handles exceptions.

```
┌──────────────────────────────────────────────────────────────────────┐
│  ✈ Airport Queue Management — EWR                   ● Live          │
├──────────────────────────────────────────────────────────────────────┤
│  ┌────────────────┬────────────────┬────────────────┬─────────────┐ │
│  │ QUEUE SIZE     │ DISPATCHED     │ SURGE ACTIVE   │ FLIGHTS     │ │
│  │    203 drivers │  47 today      │ +$4.10  ████   │ 8 landing   │ │
│  │ text-teal      │ text-teal      │ text-gold      │ next 30 min │ │
│  └────────────────┴────────────────┴────────────────┴─────────────┘ │
│                                                                      │
│  QUEUE  (showing positions 1–10)        [ View all 203 ]            │
│  Pos 1: Omar F.  (Trusted)  ·  Waiting 28 min  ·  [ Move ] [ Remove]│
│  Pos 2: Kevin R. (Verified) ·  Waiting 24 min  ·  [ Move ] [ Remove]│
│  Pos 3: Sara L.  (Verified) ·  Waiting 19 min  ·  [ Move ] [ Remove]│
│                                                                      │
│  FLIGHT ARRIVALS (30-min window)                                     │
│  ┌──────────────┬──────────┬─────────────┬──────────────────────┐  │
│  │ Flight       │ Terminal │ ETA         │ Passengers           │  │
│  ├──────────────┼──────────┼─────────────┼──────────────────────┤  │
│  │ UA 447       │ C        │ Landed      │ 189 (est. 40 TNC)    │  │
│  │ AA 271       │ A        │ 9:58 AM     │ 142 (est. 28 TNC)    │  │
│  │ DL 834       │ B        │ 10:22 +18   │ 201 (est. 51 TNC)    │  │
│  └──────────────┴──────────┴─────────────┴──────────────────────┘  │
│                                                                      │
│  SURGE CONTROLS                                                      │
│  Current: +$4.10  [ Adjust ]  Finance Admin+  [ Remove surge ]      │
│  Auto-surge: ON (AI-controlled · threshold: > 150 queue requests)   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## §3 — Support & Finance

### A-14 · Support Ticket Management

**Purpose:** Support Admin works the ticket queue. Tickets are categorized, prioritized by SLA, and linked to trip/driver/rider records.

```
┌──────────────────────────────────────────────────────────────────────┐
│  🎫 Support Tickets          43 open  ·  7 urgent  ·  Avg 3.2h     │
├──────────────────────────────────────────────────────────────────────┤
│  [Category ▾] [SLA ▾] [Assigned ▾]  [ 🔍 Search ]                  │
│                                                                      │
│  ┌─────┬──────────────────────┬───────────┬────────┬─────────────┐  │
│  │ #   │ Subject              │ Category  │ SLA    │ Action      │  │
│  ├─────┼──────────────────────┼───────────┼────────┼─────────────┤  │
│  │ 901 │ Missing payout $47   │ Earnings  │ 🔴 2h  │ [View]      │  │
│  │ 898 │ Driver was rude      │ Conduct   │ ⚠ 18h  │ [View]      │  │
│  │ 895 │ App crashed mid-trip │ Tech      │ ● 3d   │ [View]      │  │
│  └─────┴──────────────────────┴───────────┴────────┴─────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

**SLA tiers:**
| Category | SLA | Escalation |
|---|---|---|
| Safety report | 4 hours | Safety Admin |
| Earnings dispute | 24 hours | Finance Admin |
| Conduct complaint | 48 hours | Operations Admin |
| Tech/App bug | 72 hours | Platform Admin |
| General | 5 days | Support lead |

**Ticket response:** Templated replies for common issues (editable by admin). All external communications logged on ticket. Ticket closure requires customer confirmation or 48-hour auto-close after final reply.

---

### A-15 · Rating Dispute Resolution

**Purpose:** Support Admin reviews driver-flagged rider ratings. One dispute allowed per driver per 30 days.

```
┌────────────────────────────────────────────────────────────────────┐
│  Rating Dispute #47 — Driver: Marcus B.                    ×       │
├────────────────────────────────────────────────────────────────────┤
│  Disputed rating: ⭐⭐ (1 star)  — Trip #8741  Jun 3, 2026         │
│  Rider: Anonymous (rider identity hidden from driver)              │
│                                                                     │
│  Rider comment: "Driver was rude"                                   │
│                                                                     │
│  DRIVER'S DISPUTE REASON                                            │
│  "I was polite throughout. Rider was on phone entire trip.          │
│   I believe this is retaliatory for not waiting longer."            │
│                                                                     │
│  ADMIN REVIEW DATA                                                  │
│  Trip duration: 14 min  ·  No safety events  ·  No prior reports   │
│  Driver rating history: 4.91 avg over 247 trips                    │
│  This rider's rating history: avg 3.8 given (low-rater pattern)    │
│  AI pattern flag: This rider gave 1-star 4 times in 30 days ⚠      │
│                                                                     │
│  DECISION                                                           │
│  ○ Keep rating — dismiss dispute                                    │
│  ● Remove rating — retaliatory / unfounded pattern confirmed        │
│  ○ Remove rating + warn rider                                       │
│  Internal note (required): ─────────────────────────────────────   │
│  [ Submit ]  — driver NOT told the outcome source                  │
└────────────────────────────────────────────────────────────────────┘
```

**Business rule:** If rating is removed, it is excluded from driver's average permanently. Driver is notified: "A recent rating has been reviewed and removed from your average." Rider identity is never disclosed.

---

### A-16 · Refund Management

**Purpose:** Finance Admin processes refund requests from riders. Tiered approval based on refund amount.

```
┌──────────────────────────────────────────────────────────────────────┐
│  💳 Refund Management          12 pending                            │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────┬──────────────────┬──────────┬──────────┬───────────────┐  │
│  │ #    │ Rider            │ Amount   │ Reason   │ Action        │  │
│  ├──────┼──────────────────┼──────────┼──────────┼───────────────┤  │
│  │  441 │ Lisa M.          │ $18.50  │ No driver│ [Review]      │  │
│  │  439 │ Mike P.          │ $82.00  │ Safety   │ [Review] ⚠    │  │
│  │  435 │ Dana L.          │ $12.20  │ App bug  │ [Review]      │  │
│  └──────┴──────────────────┴──────────┴──────────┴───────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

**Refund approval tiers:**

| Amount | Approver | Auto-approve conditions |
|---|---|---|
| ≤ $15 | Support Admin | Cancellation before match, app error confirmed |
| $15–$50 | Finance Admin | Manual review required |
| $50–$200 | Finance Admin + manager | Two-admin confirmation |
| > $200 | Platform Admin | Manual + audit log entry |
| Any safety-related | Finance Admin | Immediate, no cap — safety refunds are never delayed |

**Driver impact:** Standard refunds do not affect driver earnings (BidiRide absorbs the cost). Fraud-related refunds flag the associated driver account for review.

---

## §4 — Analytics

### A-17 · Analytics Dashboard

**Purpose:** Founder and Platform Admin view of all marketplace KPIs. Read-only for Analytics Admin. Data updates hourly; daily export available.

```
┌──────────────────────────────────────────────────────────────────────┐
│  📊 Analytics Dashboard           Jun 2026 ▾   [ Export CSV ]       │
├──────────────────────────────────────────────────────────────────────┤
│  MARKETPLACE HEALTH                                                  │
│  ┌────────────┬────────────┬────────────┬────────────┬────────────┐ │
│  │ GMV        │ Take Rate  │ Trips/Day  │Driver Util │ Match Rate │ │
│  │ $48,210    │  20.4%     │  1,284     │   67%      │  94.2%     │ │
│  │ text-gold  │ text-teal  │ text-teal  │ text-teal  │ text-teal  │ │
│  │ JetBrains  │            │            │            │            │ │
│  └────────────┴────────────┴────────────┴────────────┴────────────┘ │
│                                                                      │
│  DRIVER RETENTION            RIDER RETENTION                        │
│  Week 1:   100%              Week 1:   100%                         │
│  Week 4:    78%              Week 4:    61%                         │
│  Week 12:   54%              Week 12:   43%                         │
│  [Cohort retention chart — bar/line hybrid — gold drivers, teal riders]│
│                                                                      │
│  SAFETY METRICS              EARNINGS FLOOR                         │
│  SOS this month: 4           Trips with supplement: 3.7%           │
│  SLA met: 100%               Total supplements: $312.40            │
│  Avg resolution: 4m 12s      Avg supplement: $6.65                 │
│                                                                      │
│  AIRPORT (EWR)               AI PERFORMANCE                        │
│  Airport trips: 287          Pricing accuracy: 94.1%               │
│  Avg queue time: 22 min      Demand forecast error: ±8.2%          │
│  Airport revenue: $8,412     Fraud catch rate: 89.3%               │
└──────────────────────────────────────────────────────────────────────┘
```

**Analytics sections available (tab navigation within screen):**
- Overview (shown above)
- Driver KPIs: acceptance rate distribution, earning per hour, churn cohorts
- Rider KPIs: CAC, LTV, booking funnel drop-off, ride frequency distribution
- Safety: incident rates, SLA performance, alert type breakdown
- Finance: GMV, take rate, payouts, floor supplement cost, refund rate
- Airport: queue metrics, terminal utilization, surge frequency

---

## Admin Command Center — Complete Screen Inventory

| Screen | Name | Part | Primary Role |
|---|---|---|---|
| A-01 | Login + MFA | 1 | All |
| A-02 | Live Operations Dashboard | 1 | All |
| A-03 | Ride Monitoring | 1 | Platform Admin+ |
| A-04 | Driver Management | 1 | Operations Admin+ |
| A-05 | Driver Profile (Admin) | 1 | Operations Admin+ |
| A-06 | Driver Approval Queue | 2 | Operations Admin |
| A-07 | Driver Suspension System | 2 | Platform Admin |
| A-08 | Rider Management | 2 | Support Admin+ |
| A-09 | Rider Profile (Admin) | 2 | Support Admin+ |
| A-10 | Safety Incident Center | 2 | Safety Admin+ |
| A-11 | Fraud Detection Center | 3 | Platform Admin+ |
| A-12 | Earnings Floor Monitoring | 3 | Finance Admin+ |
| A-13 | Airport Queue Management | 3 | Operations Admin+ |
| A-14 | Support Ticket Management | 3 | Support Admin+ |
| A-15 | Rating Dispute Resolution | 3 | Support Admin+ |
| A-16 | Refund Management | 3 | Finance Admin+ |
| A-17 | Analytics Dashboard | 3 | Analytics Admin+ |
| A-28 | Trust Score Dashboard | 00c | Super Admin |
| A-29 | Safety Recordings Archive | 00d | Super Admin |
| A-30 | Safety Metrics (Founder) | 00d | Founder |

**Total: 20 admin screens across 3 parts + 3 supplement screens from specialist specs.**

---

## Final API Reference

```
-- Fraud
GET  /admin/fraud/alerts?category=&risk_level=&page=
GET  /admin/fraud/alerts/:id
POST /admin/fraud/alerts/:id/investigate { decision, block_device, flag_trips }

-- Earnings floor
GET  /admin/finance/earnings-floor?week=
GET  /admin/finance/earnings-floor/trips?week=&page=
PUT  /admin/config/earnings-floor-formula  Founder token required

-- Airport
GET  /admin/airport/queue?airport=EWR
POST /admin/airport/queue/:driver_id/move  { new_position }
POST /admin/airport/queue/:driver_id/remove { reason }
PUT  /admin/airport/surge                  { amount }

-- Support
GET  /admin/support/tickets?category=&status=&page=
GET  /admin/support/tickets/:id
POST /admin/support/tickets/:id/reply      { message }
POST /admin/support/tickets/:id/close      { resolution }
POST /admin/support/rating-disputes/:id/resolve { decision, note }

-- Refunds
GET  /admin/finance/refunds?status=&page=
POST /admin/finance/refunds/:id/approve   { note }
POST /admin/finance/refunds/:id/deny      { reason }

-- Analytics
GET  /admin/analytics/overview?period=
GET  /admin/analytics/drivers?period=
GET  /admin/analytics/riders?period=
GET  /admin/analytics/safety?period=
GET  /admin/analytics/finance?period=
GET  /admin/analytics/airport?period=
```

---

*BidiRide Admin Command Center — Part 3 of 3 — COMPLETE — Confidential · Delaware LLC*
