# Feature Architecture Addendum — Part 3 of 4
## Privacy · Safety · Regulatory · Airport Ops · Corporate Compliance · Revenue · Roadmap

**Status:** Draft — Pending Founder Approval
**Continues from:** Part 2 — Database, Prisma Models, API, Matching Engine, Screen Inventory

---

## 12. Privacy Review

### 12.1 Data Exposure Matrix

| Data Point | Visible To | Blocked From | Enforcement Layer |
|------------|-----------|--------------|------------------|
| Preferred driver list | Rider only | Driver, admin (except audit) | relationship-service auth guard |
| Follower count | Driver (count only) | Driver cannot see WHO follows them | API returns `{ count: N }` only |
| Preferred-by count | Driver (count only) | Driver cannot see WHO prefers them | Same — count only |
| Connection identity | Both parties (mutual consent) | Third parties | ConnectionStatus=active required |
| Corporate employee roster | Corp admin only | Employees cannot see each other | CorporateEmployee query scoped to adminUserId |
| Corporate trip history | Corp admin + rider (own trips) | Employees cannot see peer trips | Trip query filtered by riderId |
| Driver public profile | Rider with ≥1 completed trip together | General public, unauthenticated | trip-service shared-trip verification gate |
| Driver bio | Rider with access to profile | N/A | Same gate as profile |
| Subscription tier | Driver only + admin | Riders see only badge label (Elite Partner), not tier name | driver-service maps tier → badge |

### 12.2 Key Privacy Decisions

**Following is anonymous to the driver.** A driver who disables following can stop new follows, but cannot see who followed them before they disabled it. Existing followers are silently deactivated.

**Corporate tracking of employees.** Corporate admins can see which employee took which trip (time, pickup zone, dropoff zone, fare). They cannot see real-time location during trip. This must be disclosed in the corporate employee onboarding flow — employees accept a data sharing addendum before their rider account is linked to the corporate account.

**Preferred driver data retention.** If a rider deletes their account, all `PreferredDriver` records are hard-deleted. Driver's preferred-by count decreases. No rider identity is ever stored on the driver side.

**Connection disconnect.** On disconnect, both parties lose visibility to each other's profile and direct booking access. Trip history is retained (both parties retain their own trip records, no shared view is preserved post-disconnect).

**CCPA/GDPR.** `preferred_drivers`, `driver_followers`, `driver_connections`, and `corporate_employees` tables all contain personal relationship data subject to deletion requests. The existing data deletion pipeline (currently in rider-service) must be extended to cascade deletions across all new tables.

### 12.3 Privacy Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Driver infers who prefers them via trip pattern correlation | Medium | Low | Counts only; no name/identifier exposed |
| Corporate admin surveils employee location | Low | High | Pickup/dropoff zone (not GPS trace) in reports; no live tracking |
| Follower notification reveals rider location to driver | Low | High | Notification is one-way (rider learns driver is near them, not vice versa) |
| Connect Direct used to arrange off-platform trips | Medium | High | All Connect Direct trips must be created in-app; payment enforced by platform |
| Subscription tier used as proxy for trust/income by riders | Low | Medium | Only badge label shown to riders, not tier name or dollar amount |

---

## 13. Safety Review

### 13.1 Interaction with Existing Safety Systems

| Existing System | Impact of New Features | Decision |
|----------------|----------------------|---------|
| SOS 3-state machine | No change — SOS overrides all dispatch layers | Unchanged |
| Panic gesture (triple-tap) | No change | Unchanged |
| Driver block | A blocked driver is excluded from ALL dispatch layers including preferred and corporate roster | Block list checked first in every layer |
| Rider block (driver blocks rider) | Removes rider from driver's preferred-by list; terminates any active Connect | Enforced at relationship-service on block event |
| Safety Admin incident response | Corporate trips get same SOS/incident handling as standard trips | No special corporate override of safety |
| Audio recording (SOS-triggered) | No change — recording is SOS-only regardless of dispatch type | Unchanged |
| Panic admin payload | No change — riderId/riderName/riderPhone still excluded | Unchanged |

### 13.2 New Attack Surfaces and Mitigations

**Connect Direct Coercion**
Risk: A driver uses Connect relationship to pressure a rider into accepting rides they don't want.
Mitigation: Rider can disconnect at any time with no explanation required. Disconnect is immediate. Disconnected driver cannot request reconnection for 30 days.

**Corporate Roster Power Imbalance**
Risk: A corporate account adds a driver to roster without adequate driver consent; driver feels pressured to accept corporate trips.
Mitigation: Driver must explicitly opt-in to each corporate roster. A driver can remove themselves from any roster at any time with no platform penalty.

**Preferred Driver Priority Abuse**
Risk: A driver cultivates preferred status to bypass trust evaluation — becomes preferred before bad behavior surfaces.
Mitigation: Fraud auto-hold and safety flags override preferred dispatch; preferred status does not reduce trust score weighting. If a driver's trust score crosses internal alert threshold, preferred dispatch is suspended even if no public action is taken.

**Follower Notification Stalking Vector**
Risk: A bad actor repeatedly follows and unfollows a driver to track their location from online-notification patterns.
Mitigation: Online notification fires once per driver online session (not on every subsequent ping). Rate limit: max 3 notifications per rider per driver per 24-hour window. Follow/unfollow rate limit: max 10 changes per day.

**Direct Booking Time Manipulation**
Risk: A rider or driver manipulates Connect Direct booking timing to game surge pricing.
Mitigation: Direct bookings use the same fare engine as standard trips. No rider-visible fare until trip is confirmed. Surge cap remains 2.5× for airport trips regardless of dispatch type.

### 13.3 Safety Non-Negotiables (Unchanged)

- Safety decisions override subscription tier, corporate status, preferred status, and Connect status.
- A driver under safety investigation is removed from all dispatch layers automatically.
- No new feature may add rider or driver PII to the panic admin payload.
- Elite badge is not shown during an active SOS event (safety UI takes full screen).

---

## 14. Regulatory Review

### 14.1 Worker Classification (Critical)

**Risk:** Driver Subscription Plans may be interpreted as evidence of an employment relationship under New Jersey ABC Test (N.J.S.A. 43:21-19(i)(6)).

NJ ABC Test requires all three:
- A: Worker is free from control
- B: Work is outside usual course of business
- C: Worker is customarily engaged in independently established trade

**Subscription concern:** Charging drivers for platform access (Pro/Elite tiers) reinforces independence — drivers are purchasing a service, not being paid wages. This supports factor C. However, if subscription benefits include dispatch priority, NJ may argue this constitutes control (factor A risk).

**Recommendation:** Legal counsel must review subscription benefit language. Priority dispatch framed as "subscription benefit" rather than "platform assignment control." Driver agreement must explicitly state subscription is optional and Basic tier provides full platform access.

### 14.2 Corporate Account Classification

**Risk:** Corporate Preferred Driver Program creates a de-facto employer-employee relationship between the corporate client and roster drivers if corporate client has too much control over driver assignment.

**Mitigation architecture decisions (already reflected in design):**
- Driver must opt-in to each roster — they are not assigned.
- Driver can decline any corporate trip without penalty.
- Corporate client sets a preferred pool, not a guaranteed assignment.
- Platform (BidiRide) remains the contracting party — corporate client is a customer of BidiRide, not employer of drivers.

### 14.3 FCRA Compliance

No new background check triggers are introduced by these features. Existing FCRA adverse action letter flow (notification-service) is unchanged. Corporate roster addition does not trigger a new background check — driver is already approved by BidiRide.

### 14.4 NJ Consumer Fraud Act

Subscription pricing must clearly disclose:
- Auto-renewal terms at signup
- Cancellation process (must be as easy as signup — NJ P.L. 2023, c. 216)
- Trial-to-paid conversion timing with advance notice (7-day email before trial ends)

### 14.5 Stripe / Payment Regulations

- Subscription charges are processed by Stripe — PCI DSS compliance is inherited.
- Corporate net-30 invoicing requires a separate Stripe Billing setup (invoices, not subscriptions).
- Refund policy for subscriptions must be stated at purchase: no prorated refund on downgrade; upgrade is prorated.

---

## 15. Airport Operations Impact

### 15.1 EWR FIFO Queue Integrity

The EWR virtual queue is implemented as a Redis sorted set with timestamp as score — pure FIFO. **New dispatch layers must not corrupt this queue.**

**Decision: Preferred, Connect, and Corporate dispatch do NOT pull drivers out of the EWR queue.**

Rationale: A driver who entered the EWR queue accepted the queue contract. Pulling them out for a preferred rider from Manhattan would violate that contract, create queue gaming incentives, and undermine the FIFO fairness that NJ regulators may scrutinize.

**Enforcement:**

```
Before executing Layer 1–3 dispatch:
  IF driver.currentQueue == 'EWR_FIFO':
    SKIP this driver in preferred/corporate/connect layer
    (driver remains in EWR queue, serves EWR trips in order)

Exception:
  Connect Direct booking where the driver is NOT in EWR queue
  AND the booking is for an EWR pickup (driver is nearby but not queued)
  → Allowed. Driver handles the Connect Direct EWR trip,
    then may re-enter EWR queue at back of line.
```

### 15.2 Subscription Tier at Airport

Elite/Pro boost (1.15× / 1.30× score) applies in standard pool dispatch **only**. It does not affect EWR queue position — queue position is timestamp-only.

**Elite drivers who are in EWR queue:** serve queue normally. Their Elite badge is visible to the rider when the queue match fires (driver assignment notification).

### 15.3 Corporate Trips at EWR

If a corporate employee requests a trip from EWR arrivals:
- Layer 2 (corporate roster) fires first.
- Roster drivers who are in EWR queue are skipped (see §15.1).
- Roster drivers who are near EWR but NOT in queue are eligible.
- If no eligible roster driver → Layer 4 standard pool, which may include queued EWR drivers (normal queue dispatch).

### 15.4 Surge Cap Unchanged

Airport surge cap remains **2.5× maximum**. Admin confirmation required above 1.5×. Subscription tier, corporate status, and preferred status do not affect fare calculation — only dispatch priority.

---

## 16. Corporate Compliance Review

### 16.1 Expense Reporting Requirements

Corporate clients will need trip data in formats compatible with expense management systems (Concur, Expensify, SAP). The corporate-service invoice endpoint must support:

| Format | Required By | Notes |
|--------|------------|-------|
| PDF invoice | All corporate clients | Monthly, itemized by employee |
| CSV export | Concur, Expensify integrations | Trip date, employee, pickup zone, dropoff zone, fare, corporate ID |
| IRS-compliant mileage record | Any client reimbursing employees | Requires distance field on export |

These are **Phase 2** deliverables — MVP launches with PDF only.

### 16.2 Data Processing Agreement (DPA)

Corporate accounts processing employee trip data requires a signed DPA (GDPR Article 28 / CCPA §1798.100). BidiRide is the data processor; the corporate client is the data controller for employee records.

DPA must specify:
- What trip data corporate admin can access (zone-level, not GPS trace)
- Retention period (BidiRide retains 7 years per FCRA; corporate export copies are client's responsibility)
- Sub-processor disclosure (Stripe, AWS, Twilio)

DPA acceptance must be a required step in corporate account activation — enforced by `CorporateAccount.founderApproved` gate.

### 16.3 Minimum Monthly Commitment — Securities Note

The $500/month minimum commitment with net-30 invoicing creates a receivable. If corporate accounts exceed 10 clients, BidiRide may need to evaluate whether the receivables portfolio requires any additional financial reporting. **Flag for accountant review at 10 corporate accounts.**

---

## 17. Subscription Revenue Modeling

### 17.1 Assumptions

| Variable | Conservative | Base Case | Optimistic |
|----------|-------------|-----------|-----------|
| Active drivers at month 12 | 400 | 750 | 1,200 |
| Pro conversion rate | 15% | 25% | 35% |
| Elite conversion rate | 3% | 7% | 12% |
| Corporate accounts at month 12 | 5 | 15 | 30 |
| Avg corporate monthly spend | $500 | $1,200 | $2,500 |

### 17.2 Monthly Recurring Revenue Projections (Month 12)

| Stream | Conservative | Base Case | Optimistic |
|--------|-------------|-----------|-----------|
| Pro subscriptions | $1,740 | $5,438 | $15,120 |
| Elite subscriptions | $948 | $4,148 | $11,376 |
| Corporate accounts | $2,500 | $18,000 | $75,000 |
| **Total SaaS MRR** | **$5,188** | **$27,586** | **$101,496** |
| **Annualized (ARR)** | **$62K** | **$331K** | **$1.22M** |

*SaaS MRR is additive to trip-based platform fee revenue.*

### 17.3 Platform Fee Impact of Subscriptions

Pro and Elite drivers pay lower platform fees (15% / 10% vs. 20%). This reduces per-trip revenue but is offset by:
1. Subscription MRR (direct)
2. Higher driver retention (subscribed drivers churn 60–70% less in comparable platforms)
3. Higher acceptance rates from engaged drivers → lower rider wait times → higher rider retention

**Net fee impact at base case (month 12):**
- 188 Pro drivers × avg $120 gross/week × 15% fee = $3,384/wk vs. 20% = $4,512/wk → loss of $1,128/wk
- 53 Elite drivers × avg $180 gross/week × 10% fee = $954/wk vs. 20% = $1,908/wk → loss of $954/wk
- Weekly fee reduction: ~$2,082
- Monthly fee reduction: ~$9,000
- Monthly subscription gain: $9,586
- **Net monthly gain from subscription model: ~$586 at base case (month 12, break-even range)**
- **Corporate MRR ($18,000) is pure upside with no fee reduction impact**

### 17.4 Investor Narrative

Subscription model transforms BidiRide from a pure transaction marketplace into a **SaaS + marketplace hybrid**:
- Predictable MRR independent of trip volume
- Driver NPS improvement from investment in their success (Business Center)
- Corporate accounts provide enterprise sales motion and reference customers
- Investor-visible ARR metric alongside GMV

---

## 18. MVP vs Phase 2 vs Phase 3 Roadmap

### 18.1 MVP (Launch — Months 1–3)

Ship with core platform. Relationship features launch **after** 500 completed trips are on the platform (ensures there is a network to build relationships within).

| Feature | MVP Scope | Excluded from MVP |
|---------|----------|------------------|
| Preferred Driver Network | Full — add/remove preferred, 45s exclusive window | — |
| BidiRide Connect | Request + accept + direct booking | Connect calendar (Phase 2) |
| Driver Following | Follow/unfollow, online notification | Follower analytics dashboard (Phase 2) |
| Driver Subscription Plans | All 3 tiers, Stripe billing, tier badge | — |
| Driver Business Center | Earnings detail, CSV export, performance screen | Tax summary, airport analytics, Connect calendar |
| Corporate Preferred Driver | Account creation, roster, employee linking, PDF invoice | CSV export, Concur/Expensify integration |

### 18.2 Phase 2 (Months 4–8)

| Feature | Deliverable |
|---------|------------|
| Business Center — Tax | Mileage tracker, quarterly tax estimate, IRS rate table |
| Business Center — Airport | EWR earnings/hr heat map, queue history, flight delay overlay |
| Connect Calendar | Driver sets weekly availability for direct bookings |
| Follower Analytics | Pro/Elite: follower count growth chart, engagement rate |
| Corporate CSV Export | Concur/Expensify-compatible format |
| Corporate DPA Flow | In-app DPA acceptance with audit trail |
| Subscription Pause | Auto-pause on 30d+ inactivity, manual resume |
| Driver Bio Moderation | NLP flag + admin review queue for driver-written bios |

### 18.3 Phase 3 (Months 9–18)

| Feature | Deliverable | Dependency |
|---------|------------|-----------|
| Multi-vehicle management | Elite drivers register 2nd+ vehicle | Phase 2 Business Center stable |
| Corporate API | REST API for corporate clients to pull trip data into their own systems | Corporate CSV stable |
| Driver referral program | Drivers earn credit for referring other drivers | Subscription billing stable |
| Rider gifting | Rider tips a preferred driver outside of trip (regulated carefully) | Legal review required |
| Fleet accounts | A company owns a vehicle fleet; individual drivers operate under fleet | Corporate + subscription stable |
| Preferred Network analytics | Admin sees network density, cluster maps (anonymous) | 10K+ relationship records |
| SageMaker demand prediction per zone | ML model trained on preferred/corporate demand patterns | 6 months of relationship data |

### 18.4 Feature Dependency Graph

```
Core Platform (Live)
      │
      ├── Preferred Driver Network ──────────────────────────────┐
      │         │                                                │
      ├── BidiRide Connect ← (requires ≥1 shared trip)           │
      │         │                                                │
      ├── Driver Following                                       │
      │         │                                                ▼
      ├── Driver Subscription Plans ──── Driver Business Center (Phase 2+)
      │         │                              │
      │         └── Elite badge / priority ────┤
      │                                        │
      └── Corporate Preferred Driver ──────────┘
                │
                └── Corporate API (Phase 3)
                └── Fleet Accounts (Phase 3)
```

---

*Part 3 of 4 complete.*
*Part 4 (final): Rider Flows · Driver Flows · Admin Flows · Corporate Account Flows*
*All four parts together constitute the complete Feature Architecture Addendum.*
*Awaiting founder approval to continue to Part 4 or to direct revisions.*
