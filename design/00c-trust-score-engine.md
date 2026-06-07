# BidRide — Trust Score Engine v1.0

**Status:** Draft — Pending Founder Approval
**Document:** Supplement to PRD v1.1 + Gap Analysis v1.0
**Prepared by:** Claude Code (AI Systems Architect)
**Date:** June 5, 2026
**Founder Requirement:** Implement and expand BidRide Trust Score Engine

> The Trust Score Engine is an internal AI system that continuously evaluates
> every user on the platform. Scores are never shown publicly.
> Only four trust badges are visible: Verified · Trusted · Business · VIP.

---

## Table of Contents

1. [Philosophy and Governance](#1-philosophy-and-governance)
2. [Engine Architecture](#2-engine-architecture)
3. [Inputs — Rider Trust Model](#3-inputs--rider-trust-model)
4. [Inputs — Driver Trust Model](#4-inputs--driver-trust-model)
5. [Internal Score Definitions](#5-internal-score-definitions)
6. [Scoring Model — Rider](#6-scoring-model--rider)
7. [Scoring Model — Driver](#7-scoring-model--driver)
8. [Badge Thresholds and Logic](#8-badge-thresholds-and-logic)
9. [Badge UI Specification](#9-badge-ui-specification)
10. [Score Lifecycle and Decay](#10-score-lifecycle-and-decay)
11. [Anti-Gaming Protections](#11-anti-gaming-protections)
12. [Database Schema](#12-database-schema)
13. [API Endpoints](#13-api-endpoints)
14. [Admin Interface](#14-admin-interface)
15. [Integration Map](#15-integration-map)
16. [Gap Resolution Index](#16-gap-resolution-index)

---

## 1. Philosophy and Governance

### 1.1 Core Principle

The Trust Score Engine exists to protect three parties simultaneously:
- **Drivers** — from riders who are unsafe, fraudulent, or unreliable
- **Riders** — from drivers who are unsafe or unverified
- **The marketplace** — from bad actors who exploit the platform

Trust is earned through consistent behavior over time. It is not bought, gamed, or bypassed.

### 1.2 What the Engine Is Not

- It is **not** a credit score
- It is **not** a social ranking
- It is **not** visible to other users in numerical form
- It is **not** used to price-discriminate between users
- It is **not** used to deny service based on protected class characteristics

### 1.3 Founder Control Principles Applied

- All scoring weights are configurable by Super Admin only
- Any change to badge thresholds requires Founder authorization
- The engine is auditable — every score has a full input log
- AI bias reviews are conducted quarterly against geographic and demographic distributions
- Scores never appear in any external-facing communication

---

## 2. Engine Architecture

```
╔══════════════════════════════════════════════════════════════════╗
║                  TRUST SCORE ENGINE                              ║
║                                                                  ║
║  DATA COLLECTION LAYER                                           ║
║  ┌─────────────────────────────────────────────────────────┐    ║
║  │ Identity    Payment    Behavioral    Device    History  │    ║
║  │ Signals     Signals    Signals       Signals   Signals  │    ║
║  └─────────────────────────────────────────────────────────┘    ║
║                         │                                        ║
║  SCORING ENGINE                                                  ║
║  ┌─────────────────────────────────────────────────────────┐    ║
║  │  Trust Score          Fraud Probability    Verification  │    ║
║  │  (0 – 1000)           Score (0 – 100%)    Confidence    │    ║
║  │  Internal             Internal             (0 – 100%)   │    ║
║  │                                            Internal      │    ║
║  └─────────────────────────────────────────────────────────┘    ║
║                         │                                        ║
║  BADGE ASSIGNMENT ENGINE                                         ║
║  ┌─────────────────────────────────────────────────────────┐    ║
║  │  Verified    Trusted    Business    VIP                  │    ║
║  │  (Public badge — no score revealed)                     │    ║
║  └─────────────────────────────────────────────────────────┘    ║
║                         │                                        ║
║  ACTION LAYER                                                    ║
║  ┌─────────────────────────────────────────────────────────┐    ║
║  │  Badge displayed in app    Admin alerts    Safety flags  │    ║
║  │  Matching priority         Fraud queue     Account holds │    ║
║  └─────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════╝
```

### 2.1 Evaluation Frequency

| Event | Trust Engine Re-evaluates |
|---|---|
| Account created | Initial score calculated |
| Trip completed | Full re-evaluation within 60 seconds |
| Trip cancelled | Partial re-evaluation (cancellation signals only) |
| Complaint received | Full re-evaluation within 5 minutes |
| Payment event (chargeback, failure) | Immediate re-evaluation |
| Fraud flag raised | Immediate re-evaluation + admin alert if score drops below threshold |
| Document approved or rejected | Re-evaluation of verification confidence only |
| Daily scheduled job | Full re-evaluation for all accounts with pending signals |

### 2.2 Score Propagation

Score changes propagate to three consumers:
1. **Badge assignment** — visible badge may update immediately or on next session open
2. **Matching engine** — matching priority adjusts in real time
3. **Safety system** — fraud probability score above threshold triggers admin alert

---

## 3. Inputs — Rider Trust Model

### Category A: Identity Signals

| Input | Description | Source |
|---|---|---|
| Phone verification | Phone number confirmed via OTP | Auth service |
| Email verification | Email address confirmed via link | Auth service |
| Government ID verified | ID document uploaded and authenticated | Document service + third-party ID verification |
| Identity match confidence | Biometric selfie match score vs. ID photo (0–100%) | Identity verification provider (e.g., Persona, Onfido) |
| Device reputation | Device fingerprint scored against fraud database | Device intelligence service |
| Multi-account flag | Same device or phone linked to other accounts | Internal fraud service |

### Category B: Payment Signals

| Input | Description | Source |
|---|---|---|
| Payment method verified | Card successfully pre-authorized or used | Stripe |
| Payment method type | Card / Apple Pay / Google Pay (lower fraud on wallet payments) | Stripe |
| Chargeback history | Total chargebacks filed on this account | Stripe dispute data |
| Chargeback streak | Consecutive rides resulting in chargeback | Payment service |
| Payment failure rate | Failed payment attempts / total attempts | Payment service |
| Corporate account enrollment | Verified corporate employee (billing to employer) | Corporate service |

### Category C: Behavioral Signals — Ride History

| Input | Description | Source |
|---|---|---|
| Total completed rides | Lifetime completed trips | Trip service |
| Ride completion rate | Completed / (requested − cancelled before match) | Trip service |
| Cancellation rate | Rider-initiated cancellations / total requested | Trip service |
| Cancellation streak | Consecutive rides cancelled before driver arrives | Trip service |
| No-show rate | Driver reports rider did not arrive (late-cancel or abandon) | Trip service |
| Account age | Days since first account verification completed | User service |
| Successful ride streak | Consecutive rides completed without issue | Trip service |
| Airport trip history | Completed EWR pickups/dropoffs (signals established traveler) | Trip service + airport service |

### Category D: Reputation Signals — Ratings and Complaints

| Input | Description | Source |
|---|---|---|
| Average driver rating of rider | How drivers rate this rider across all trips | Ratings service |
| Rating count | Number of ratings received (low count = less reliable signal) | Ratings service |
| Driver complaints | Formal complaints filed by drivers about this rider | Safety service |
| Driver complaint categories | Type: rude behavior / mess / harassment / no-show / other | Safety service |
| Complaint streak | Complaints from consecutive or recent drivers | Safety service |
| Rider reports filed | Reports submitted by this rider (used for manipulation detection) | Safety service |

### Category E: Fraud Signals

| Input | Description | Source |
|---|---|---|
| Active fraud flag | AI fraud detection has flagged this account | Fraud detection engine |
| Fraud investigation history | Number of past investigations, outcomes | Safety service |
| Referral fraud signals | Unusual referral chain (self-referral patterns, device overlap) | Rewards service |
| GPS spoofing signal | Device GPS inconsistent with pickup/dropoff patterns | Trip monitoring |
| Velocity anomaly | Ride request patterns inconsistent with human behavior | Fraud engine |

---

## 4. Inputs — Driver Trust Model

### Category A: Identity and Verification Signals

| Input | Description | Source |
|---|---|---|
| Identity verified | Government ID authenticated | Document service |
| Identity match confidence | Biometric selfie vs. ID photo score | Identity provider |
| Pre-shift selfie match | Daily selfie biometric match score | Driver service |
| License verified | Driver license authenticated and not expired | Document service |
| License expiry distance | Days until license expires (freshness signal) | Document service |
| Vehicle registration verified | Registration authenticated and current | Document service |
| Insurance verified | Rideshare endorsement or commercial coverage confirmed | Document service |
| Background check outcome | Clear / Consider / Adverse | Background check provider |
| Device reputation | Device fingerprint against fraud database | Device intelligence service |
| Multi-account flag | Driver phone or device linked to other accounts | Fraud service |

### Category B: Performance Signals

| Input | Description | Source |
|---|---|---|
| Total completed trips | Lifetime trips completed | Trip service |
| Acceptance rate | Accepted / total requests received (last 30 days) | Driver service |
| Completion rate | Completed / accepted (last 30 days) | Driver service |
| Cancellation rate | Driver-cancelled trips / accepted trips | Trip service |
| Cancellation streak | Consecutive driver cancellations | Trip service |
| Account age | Days since driver approval | User service |
| Successful trip streak | Consecutive completed trips without incident | Trip service |
| Airport trip history | Completed EWR airport pickups (specialized operator signal) | Airport service |

### Category C: Reputation Signals

| Input | Description | Source |
|---|---|---|
| Average rider rating | Rider ratings of this driver across all trips | Ratings service |
| Rating count | Number of ratings received | Ratings service |
| Rating trend | Is the average improving, stable, or declining? | Ratings service |
| Rider complaints | Formal complaints filed by riders about this driver | Safety service |
| Rider complaint categories | Type: unsafe driving / harassment / route deviation / other | Safety service |
| Complaint streak | Complaints from consecutive or recent riders | Safety service |

### Category D: Financial Signals

| Input | Description | Source |
|---|---|---|
| Payout history | Successful payouts vs. failed or disputed | Payout service |
| Fraud investigation history | Number of past fraud reviews, outcomes | Safety service |
| Earnings pattern consistency | Is earning pattern consistent with stated driving behavior? | Fraud engine |

---

## 5. Internal Score Definitions

### 5.1 Trust Score (0 – 1000)

**What it measures:** Overall trustworthiness of the user on the platform.

Higher is more trusted. The score compounds over time — a long-standing user with clean history can absorb occasional negative signals without dropping badge tier. A new user must build trust through consistent behavior.

**Score bands (internal only — never revealed):**

| Band | Range | Internal meaning |
|---|---|---|
| Unscored | N/A | Account too new for reliable scoring |
| Low | 0 – 299 | High caution: multiple negative signals |
| Building | 300 – 499 | Normal for new users; limited history |
| Established | 500 – 699 | Solid platform participant |
| Trusted | 700 – 849 | Consistently positive behavior |
| Elite | 850 – 1000 | Exceptional — top percentile of platform |

---

### 5.2 Fraud Probability Score (0.0 – 100.0%)

**What it measures:** Probability that this account is engaged in fraudulent activity.

Lower is better. This score is the primary trigger for automated and manual fraud intervention.

**Threshold actions (internal):**

| Score | Action |
|---|---|
| 0.0 – 14.9% | No action — normal platform use |
| 15.0 – 29.9% | Soft monitoring — elevated logging, no restriction |
| 30.0 – 49.9% | Elevated flag — admin review queue within 24 hours |
| 50.0 – 74.9% | Account hold — verification required before next action |
| 75.0 – 89.9% | Automatic account restriction — admin review required within 2 hours |
| 90.0 – 100.0% | Immediate account suspension pending full investigation |

---

### 5.3 Verification Confidence Score (0.0 – 100.0%)

**What it measures:** How confident the system is that the person using this account is who they claim to be.

This is distinct from trust — a fully verified new account has high verification confidence but a low trust score (no history yet). An account with long history but weak identity verification has lower confidence.

**Threshold actions (internal):**

| Score | Action |
|---|---|
| 0 – 49% | Elevated verification required before booking |
| 50 – 69% | Standard use; identity signals flagged for review |
| 70 – 84% | Good — standard platform access |
| 85 – 100% | Strong — identity highly confirmed |

---

## 6. Scoring Model — Rider

### 6.1 Trust Score Components (Max: 1000)

---

#### Module A: Identity (Max: 250 points)

| Signal | Points |
|---|---|
| Phone verified | +40 |
| Email verified | +25 |
| Government ID verified | +100 |
| Identity match confidence 90–100% | +60 |
| Identity match confidence 75–89% | +40 |
| Identity match confidence 60–74% | +20 |
| Identity match confidence < 60% | +0 (triggers verification confidence penalty) |
| Device reputation: clean (no fraud signals) | +25 |
| Device reputation: neutral | +0 |
| Device reputation: flagged | −50 |
| Multi-account flag: confirmed | −150 |

---

#### Module B: Payment (Max: 175 points)

| Signal | Points |
|---|---|
| Payment method successfully used at least once | +60 |
| Zero chargebacks (lifetime) | +75 |
| One chargeback (resolved in rider's favor) | +20 |
| One chargeback (unresolved or reversed) | −40 |
| Two or more chargebacks | −100 |
| Chargeback streak (2+ consecutive rides) | −150 |
| Zero payment failures in last 30 days | +25 |
| Corporate account enrollment (verified) | +40 |
| Payment method: digital wallet (Apple/Google Pay) | +15 |

---

#### Module C: Ride History (Max: 250 points)

| Signal | Points |
|---|---|
| 1–5 completed rides | +30 |
| 6–20 completed rides | +70 |
| 21–50 completed rides | +120 |
| 51–100 completed rides | +175 |
| 100+ completed rides | +250 |
| Completion rate ≥ 95% | +25 bonus |
| Cancellation rate 0–5% | +30 |
| Cancellation rate 6–15% | +10 |
| Cancellation rate 16–30% | −20 |
| Cancellation rate > 30% | −60 |
| Cancellation streak (3+ consecutive) | −40 |
| No-show history (driver reports no-show) | −30 per event |
| Airport trip history (5+ completed EWR trips) | +20 |
| Airport trip history (20+ completed EWR trips) | +40 |

---

#### Module D: Account Age (Max: 100 points)

| Signal | Points |
|---|---|
| Account age 7–30 days | +20 |
| Account age 31–90 days | +45 |
| Account age 91–180 days | +70 |
| Account age 181–365 days | +90 |
| Account age > 365 days | +100 |
| Successful ride streak (10+ consecutive clean rides) | +15 bonus |
| Successful ride streak (25+ consecutive clean rides) | +25 bonus |

---

#### Module E: Reputation (Max: 225 points)

| Signal | Points |
|---|---|
| Average driver rating 4.8–5.0 (10+ ratings) | +175 |
| Average driver rating 4.5–4.79 (10+ ratings) | +140 |
| Average driver rating 4.0–4.49 (10+ ratings) | +100 |
| Average driver rating 3.5–3.99 (10+ ratings) | +50 |
| Average driver rating < 3.5 (10+ ratings) | +0 |
| Less than 10 ratings (unscored for reputation) | +60 (neutral) |
| Zero driver complaints (lifetime) | +50 |
| One driver complaint (resolved, no action) | +20 |
| One driver complaint (action taken) | −30 |
| Two driver complaints | −80 |
| Three or more driver complaints | −150 |
| Complaint streak (complaints from last 3 drivers) | −100 additional |

---

#### Module F: Fraud Signals (Penalty only — applied after base score)

| Signal | Adjustment |
|---|---|
| Active fraud flag from AI engine | −200 |
| One prior fraud investigation (cleared) | −25 |
| One prior fraud investigation (unresolved) | −75 |
| Two or more fraud investigations | −150 |
| Confirmed fraud (account compromised, not user fault) | −0 (flags cleared on resolution) |
| Referral fraud detected | −100 |
| Velocity anomaly detected | −50 |
| GPS spoofing signal | −75 |

---

### 6.2 Fraud Probability Score — Rider Inputs

The fraud probability score is calculated independently of the trust score using a weighted model:

| Signal | Weight |
|---|---|
| Device flagged in fraud database | +35% |
| Multi-account confirmed on same device | +30% |
| Chargeback streak (2+) | +25% |
| Fraud investigation history (each) | +20% |
| Chargeback history (each) | +12% |
| Identity match confidence < 60% | +18% |
| Velocity anomaly (bot-like pattern) | +15% |
| Referral fraud chain signal | +12% |
| GPS spoofing detected | +15% |
| No-show history (each event) | +5% |
| Payment failure rate > 50% | +10% |
| Account age < 7 days with 10+ rides | +20% |

Fraud probability is capped at 100%. The score is the sum of applicable weights, not additive beyond the cap.

---

### 6.3 Verification Confidence Score — Rider Inputs

| Signal | Weight |
|---|---|
| Phone verified | +15% |
| Email verified | +10% |
| Government ID verified | +35% |
| Identity match confidence (scaled, 0.01× multiplier of match %) | Up to +30% |
| Device reputation: clean | +5% |
| Account age > 90 days | +5% |
| Successful corporate enrollment (verified employer) | +5% |

Starting base: 0%. Theoretical maximum: 100%.

---

## 7. Scoring Model — Driver

Driver trust scoring follows the same three-score architecture. Driver scoring places greater weight on verification (drivers are more thoroughly vetted) and performance consistency.

### 7.1 Trust Score Components (Max: 1000)

---

#### Module A: Verification (Max: 300 points — higher weight than rider)

| Signal | Points |
|---|---|
| Government ID verified | +60 |
| Identity match confidence 90–100% | +50 |
| Identity match confidence 75–89% | +35 |
| Identity match confidence < 75% | +0 |
| Driver license verified and current | +60 |
| Vehicle registration verified and current | +40 |
| Insurance verified (rideshare endorsement or commercial) | +50 |
| Background check: Clear | +60 |
| Background check: Consider (minor) | +20 |
| Background check: Adverse | −200 |
| Vehicle photos verified | +20 |
| Pre-shift selfie: consistent match (last 30 days) | +20 |
| Device reputation: clean | +20 |
| Device reputation: flagged | −50 |
| Multi-account flag: confirmed | −200 |

---

#### Module B: Performance (Max: 300 points)

| Signal | Points |
|---|---|
| 1–10 completed trips | +40 |
| 11–50 completed trips | +100 |
| 51–100 completed trips | +160 |
| 101–250 completed trips | +220 |
| 250+ completed trips | +300 |
| Acceptance rate ≥ 90% (30-day) | +30 bonus |
| Acceptance rate 80–89% | +15 bonus |
| Acceptance rate 70–79% | +0 |
| Acceptance rate < 70% | −20 |
| Completion rate ≥ 98% | +30 bonus |
| Completion rate 95–97% | +15 bonus |
| Completion rate < 90% | −30 |
| Cancellation rate 0–2% | +25 |
| Cancellation rate 3–5% | +10 |
| Cancellation rate 6–10% | −20 |
| Cancellation rate > 10% | −60 |
| Cancellation streak (3+ consecutive) | −50 |
| Airport trip history (20+ EWR pickups) | +20 |
| Airport trip history (50+ EWR pickups) | +40 |
| Successful trip streak (20+ clean trips) | +20 bonus |
| Successful trip streak (50+ clean trips) | +35 bonus |

---

#### Module C: Account Age (Max: 100 points)

| Signal | Points |
|---|---|
| Account age 30–60 days (post-approval) | +25 |
| Account age 61–120 days | +55 |
| Account age 121–180 days | +75 |
| Account age 181–365 days | +90 |
| Account age > 365 days | +100 |

---

#### Module D: Reputation (Max: 200 points)

| Signal | Points |
|---|---|
| Average rider rating 4.8–5.0 (20+ ratings) | +150 |
| Average rider rating 4.6–4.79 (20+ ratings) | +120 |
| Average rider rating 4.3–4.59 (20+ ratings) | +90 |
| Average rider rating 4.0–4.29 (20+ ratings) | +50 |
| Average rider rating < 4.0 (20+ ratings) | +0 |
| Less than 20 ratings (unscored) | +60 (neutral) |
| Zero rider complaints (lifetime) | +50 |
| One rider complaint (no action) | +15 |
| One rider complaint (action taken) | −40 |
| Two rider complaints | −100 |
| Three or more rider complaints | −200 |

---

#### Module E: Fraud and Financial Signals (Penalty only)

| Signal | Adjustment |
|---|---|
| Active fraud flag | −200 |
| Fraud investigation history (each unresolved) | −75 |
| Fraud investigation history (each cleared) | −20 |
| Earnings pattern inconsistency (AI flag) | −50 |
| Payout dispute or reversal | −40 |

---

## 8. Badge Thresholds and Logic

### 8.1 Badge Philosophy

Badges communicate trust in plain language — no numbers, no tiers, no scores. A rider seeing a driver's "Trusted" badge needs no explanation. The label says everything.

Badges are assigned to both riders and drivers. They appear in different contexts for each.

### 8.2 Rider Badges

---

#### VERIFIED
**Meaning:** This rider's identity and payment have been confirmed.

**Requirements (ALL must be true):**
- Phone verified: ✓
- Email verified: ✓
- Payment method successfully used at least once: ✓
- Fraud probability score < 30%
- Verification confidence score ≥ 50%
- No active account suspension or hold

**Notes:** This is the baseline badge for all standard riders. A new rider who completes verification gets Verified immediately. It does not require ride history.

---

#### TRUSTED
**Meaning:** This rider has a proven track record on the platform.

**Requirements (ALL must be true):**
- All Verified requirements: ✓
- Trust score ≥ 500
- Total completed rides ≥ 15
- Account age ≥ 45 days
- Average driver rating ≥ 4.2 (if 10+ ratings)
- Cancellation rate < 20% (last 30 days)
- Zero active driver complaints
- Fraud probability score < 20%
- No chargebacks in last 90 days

**Notes:** Trusted is earned — a new rider cannot purchase or game their way to this badge. It requires time plus consistent behavior.

---

#### BUSINESS
**Meaning:** This rider is verified through a corporate BidRide Business account.

**Requirements (ALL must be true):**
- Active enrollment in a BidRide Business corporate account
- Corporate account status: Active (not past-due or suspended)
- Rider's own account: no active suspension

**Notes:** Business badge reflects institutional verification — the employer has vouched for this employee. Business badge can coexist with Trusted or VIP status. If a rider has both Business and VIP, show Business (corporate identity is the primary signal in a business context).

---

#### VIP
**Meaning:** This rider is among BidRide's most valued and consistently positive users.

**Requirements (ALL must be true):**
- All Trusted requirements: ✓
- Trust score ≥ 800
- Total completed rides ≥ 75
- Account age ≥ 180 days
- Average driver rating ≥ 4.7 (minimum 25 ratings)
- Cancellation rate < 10% (last 60 days)
- Zero chargebacks (lifetime)
- Zero driver complaints resulting in action (lifetime)
- Fraud probability score < 10%
- Verification confidence score ≥ 80%

**Notes:** VIP is rare by design. It cannot be purchased or accelerated. Drivers who receive a VIP rider have high confidence the ride will be smooth and the fare will be honored.

---

### 8.3 Driver Badges

---

#### VERIFIED
**Meaning:** This driver has passed BidRide's full verification pipeline.

**Requirements (ALL must be true):**
- Identity verified (government ID + biometric match)
- Driver license verified and current
- Vehicle registration verified and current
- Insurance verified (rideshare endorsement or commercial)
- Background check: Clear or Consider (no Adverse)
- Vehicle photos reviewed and approved
- Verification confidence score ≥ 70%
- Fraud probability score < 30%
- No active account suspension

**Notes:** All approved drivers receive Verified. It cannot be displayed unless all verification steps have passed. If any required document expires, Verified badge is removed until the document is renewed.

---

#### TRUSTED
**Meaning:** This driver has a proven record of safe, reliable service.

**Requirements (ALL must be true):**
- All Verified requirements: ✓
- Trust score ≥ 550
- Total completed trips ≥ 50
- Account age (post-approval) ≥ 60 days
- Average rider rating ≥ 4.5 (minimum 20 ratings)
- Completion rate ≥ 95% (last 30 days)
- Cancellation rate < 5% (last 30 days)
- Zero rider complaints resulting in formal action
- Fraud probability score < 20%

---

#### BUSINESS
**Meaning:** Reserved for future use — BidRide fleet operator accounts and enterprise driver partnerships. Not assigned to individual drivers in Phase 1.

---

#### VIP
**Meaning:** This driver is among BidRide's most elite — exceptional service, proven over time.

**Requirements (ALL must be true):**
- All Trusted requirements: ✓
- Trust score ≥ 850
- Total completed trips ≥ 250
- Account age (post-approval) ≥ 365 days
- Average rider rating ≥ 4.8 (minimum 50 ratings)
- Acceptance rate ≥ 90% (last 60 days)
- Completion rate ≥ 98% (last 60 days)
- Cancellation rate < 2% (lifetime)
- Zero rider complaints resulting in action (lifetime)
- Zero fraud investigations (lifetime)
- Chargeback-free (no disputed fares)
- Pre-shift selfie: consistent match with no failures (last 30 days)

**Notes:** VIP drivers receive priority placement in the matching queue when ride quality signals matter most (premium ride type, VIP rider requests, airport pickups). VIP badge is visible to riders on the matched driver card.

---

### 8.4 Badge Priority Rules (When Multiple Badges Apply)

Riders only ever show one badge at a time. Priority:

```
1. VIP (highest)
2. Business
3. Trusted
4. Verified
5. (no badge — account unverified or restricted)
```

Exception: If a rider is Business + VIP, show Business — corporate context takes precedence.

---

### 8.5 Badge Removal Rules

| Scenario | Badge Impact |
|---|---|
| Trust score drops below tier threshold | Badge downgraded on next daily recalculation |
| Fraud probability crosses 50% | Badge suspended immediately pending review |
| Account suspended by admin | All badges hidden until suspension lifted |
| Required document expires (driver) | Verified badge removed; cascades to all higher badges |
| Background check adverse update | Verified badge removed immediately |
| New driver complaint (action taken) | Trusted / VIP badges placed under 7-day review window |

---

## 9. Badge UI Specification

### 9.1 Badge Visual Design

```
╔══════════════════════════════════════════════════════════════════╗
║  VERIFIED badge:                                                 ║
║  ┌────────────────────────┐                                      ║
║  │  ✓  Verified           │                                      ║
║  └────────────────────────┘                                      ║
║  bg: bg-secondary (#0F2D52)                                      ║
║  border: 1px border-teal (#00D4C6)                               ║
║  icon: checkmark / text-teal                                     ║
║  text: "Verified" / type-label-s / text-teal                    ║
║  pill shape: radius-pill / height: 22px / padding: 4px 10px     ║
║                                                                  ║
║  TRUSTED badge:                                                  ║
║  ┌────────────────────────┐                                      ║
║  │  ◈  Trusted            │                                      ║
║  └────────────────────────┘                                      ║
║  bg: rgba(0, 212, 198, 0.15)                                     ║
║  border: 1px #00D4C6                                             ║
║  icon: BidRide diamond / text-teal                               ║
║  text: "Trusted" / type-label-s / text-teal                     ║
║                                                                  ║
║  BUSINESS badge:                                                 ║
║  ┌────────────────────────┐                                      ║
║  │  💼  Business          │                                      ║
║  └────────────────────────┘                                      ║
║  bg: rgba(10, 35, 66, 0.8)                                       ║
║  border: 1px border-medium (#234870)                             ║
║  icon: briefcase / text-secondary                                ║
║  text: "Business" / type-label-s / text-secondary               ║
║                                                                  ║
║  VIP badge:                                                      ║
║  ┌────────────────────────┐                                      ║
║  │  ★  VIP                │                                      ║
║  └────────────────────────┘                                      ║
║  bg: rgba(244, 180, 0, 0.12)                                     ║
║  border: 1px #F4B400                                             ║
║  icon: star / text-gold                                          ║
║  text: "VIP" / type-label-s / text-gold                         ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

### 9.2 Where Badges Appear

#### Rider Badge — where it shows to drivers

| Context | Location | Size |
|---|---|---|
| D-18 Ride Request Screen | Rider name + badge inline | Compact (22px) |
| D-22 Trip Complete (driver rates rider) | Rider name + badge | Compact |
| D-23 Rate Rider | Badge shown for context | Compact |

#### Rider Badge — where it shows to the rider themselves

| Context | Location | Size |
|---|---|---|
| Rider Profile Screen | Below name | Standard (26px) |
| Rider Home Screen | Optional — near avatar | Compact |
| Rewards Dashboard | Below tier info | Standard |

#### Driver Badge — where it shows to riders

| Context | Location | Size |
|---|---|---|
| RS-009a Driver Matched | Driver name + badge | Standard (26px) |
| RS-010 Driver En Route | Driver info chip | Compact |
| RS-015 Rate Driver | Driver name + badge | Compact |
| RS-018a Trip Detail | Historical driver record | Compact |

#### Driver Badge — where it shows to the driver themselves

| Context | Location | Size |
|---|---|---|
| Driver Profile Screen | Below name | Standard |
| Driver Home Screen | Near avatar | Compact |

### 9.3 What the Badge Tooltip Says (on tap)

Each badge is tappable. Tap opens a brief explainer modal:

**Verified:**
> "This user's identity and payment have been confirmed by BidRide."

**Trusted:**
> "This user has a proven track record of completing rides and positive interactions on BidRide."

**Business:**
> "This rider books through a verified BidRide Business corporate account."

**VIP:**
> "This user is among BidRide's most valued members, with an exceptional history on the platform."

No score, no criteria, no history is revealed in these tooltips.

---

## 10. Score Lifecycle and Decay

### 10.1 Score Decay

Trust scores are not permanent — they require ongoing positive behavior to maintain.

| Signal | Decay Rule |
|---|---|
| No rides in 90 days (rider) | Trust score decays 5% per 30-day period of inactivity |
| No trips in 90 days (driver) | Trust score decays 10% per 30-day period of inactivity |
| Inactivity > 365 days | Account treated as new for scoring purposes — requires re-verification |
| Bad behavior recently vs. long ago | Events older than 18 months contribute 50% of their original weight |
| Events older than 36 months | Contribute 25% of their original weight (except: fraud conviction — permanent) |

### 10.2 Score Recovery

Users who have had badges downgraded can recover them through consistent positive behavior. No manual appeal process for badge tier — behavior is the appeal. This is intentional: the system is forward-looking.

Exception: If a badge was removed due to a data error or false fraud flag (admin confirms), the badge is manually reinstated and the erroneous event is flagged in the audit log.

---

## 11. Anti-Gaming Protections

### 11.1 Things the Engine Resists

| Potential Gaming Attempt | Protection |
|---|---|
| Creating a new account after bad behavior | Device fingerprint links new account to old account's signals |
| Padding ride count with fake trips | AI trip pattern analysis detects abnormal routes, durations, and fare acceptance patterns |
| Self-referrals to boost score | Referral chain analysis detects device and payment overlap |
| Encouraging drivers to leave 5-star ratings in exchange for tips | Rating pattern analysis detects unusual rating-tip correlation |
| Buying a "clean" device | Device reputation scoring combined with behavioral signals — new device alone does not reset score |
| Closing and reopening account | Phone number and payment method linked to prior account history |
| Chargeback immediately after ride | Chargeback pattern analysis distinguishes legitimate disputes from systematic abuse |
| Inflated rides from coordinated fake rider-driver pairs | Earnings pattern analysis + GPS route consistency checks detect this pattern |

### 11.2 Hard Rules

- A rider who has had a fraud conviction (confirmed, not just flagged) can never reach Trusted or VIP status on any account linked by device, phone, or payment
- A driver whose background check returns Adverse can never be Verified
- No admin below Super Admin level can manually grant VIP status
- All manual badge overrides are logged in the audit log with justification

---

## 12. Database Schema

### 12.1 New Table: `trust_scores`

```
id                          UUID PRIMARY KEY
user_id                     UUID REFERENCES users(id)
user_type                   ENUM(rider, driver)

-- Internal scores (never exposed via public API)
trust_score                 DECIMAL(6,2)          -- 0.00 to 1000.00
fraud_probability_score     DECIMAL(5,2)          -- 0.00 to 100.00
verification_confidence     DECIMAL(5,2)          -- 0.00 to 100.00

-- Badge assignment (this is what the app reads)
current_badge               ENUM(verified, trusted, business, vip, none)
badge_eligible              BOOLEAN DEFAULT TRUE  -- false = suspended badge

-- Score component snapshots (for auditability)
identity_module_score       DECIMAL(6,2)
payment_module_score        DECIMAL(6,2)
history_module_score        DECIMAL(6,2)
age_module_score            DECIMAL(6,2)
reputation_module_score     DECIMAL(6,2)
fraud_penalty_applied       DECIMAL(6,2)

-- Metadata
score_version               VARCHAR             -- model version used
last_evaluated_at           TIMESTAMP
evaluation_trigger          ENUM(trip_completed, complaint_received, payment_event, fraud_flag, document_event, daily_job, manual_review)
inputs_snapshot             JSONB               -- full input values at evaluation time

created_at                  TIMESTAMP
updated_at                  TIMESTAMP
```

### 12.2 New Table: `trust_score_history`

Append-only log — every score evaluation is stored, not overwritten.

```
id                          UUID PRIMARY KEY
user_id                     UUID REFERENCES users(id)
trust_score                 DECIMAL(6,2)
fraud_probability_score     DECIMAL(5,2)
verification_confidence     DECIMAL(5,2)
badge_assigned              ENUM(verified, trusted, business, vip, none)
evaluation_trigger          VARCHAR
delta_trust_score           DECIMAL(6,2)    -- change from previous score
inputs_snapshot             JSONB
score_version               VARCHAR
evaluated_at                TIMESTAMP
```

### 12.3 New Table: `device_fingerprints`

Resolves Gap G-07 (device fingerprinting — previously missing entirely).

```
id                          UUID PRIMARY KEY
user_id                     UUID REFERENCES users(id)
device_id                   VARCHAR             -- hashed device identifier
platform                    ENUM(ios, android)
device_model                VARCHAR
os_version                  VARCHAR
app_version                 VARCHAR
ip_address_hash             VARCHAR             -- hashed for privacy
fingerprint_hash            VARCHAR UNIQUE      -- composite device fingerprint
reputation_score            DECIMAL(5,2)        -- from device intelligence provider
reputation_provider         VARCHAR
flagged                     BOOLEAN DEFAULT FALSE
flag_reason                 VARCHAR NULLABLE
first_seen_at               TIMESTAMP
last_seen_at                TIMESTAMP
created_at                  TIMESTAMP
```

### 12.4 New Table: `multi_account_links`

Resolves Gap G-08 (multi-account detection — previously missing entirely).

```
id                          UUID PRIMARY KEY
primary_user_id             UUID REFERENCES users(id)
linked_user_id              UUID REFERENCES users(id)
link_type                   ENUM(device, phone, payment_method, referral_chain, ip_pattern)
confidence                  DECIMAL(5,2)        -- 0-100%: how confident is the match
status                      ENUM(pending_review, confirmed, dismissed)
reviewed_by                 UUID REFERENCES admin_users(id) NULLABLE
review_notes                VARCHAR NULLABLE
detected_at                 TIMESTAMP
reviewed_at                 TIMESTAMP NULLABLE
```

### 12.5 Additions to existing `riders` table

```
-- ADD:
current_badge               ENUM(verified, trusted, business, vip, none) DEFAULT none
trust_score_id              UUID REFERENCES trust_scores(id) NULLABLE
```

### 12.6 Additions to existing `drivers` table

```
-- ADD:
current_badge               ENUM(verified, trusted, business, vip, none) DEFAULT none
trust_score_id              UUID REFERENCES trust_scores(id) NULLABLE
```

---

## 13. API Endpoints

### Trust Score Service (internal — not accessible to riders or drivers)

```
-- Score evaluation
POST /internal/trust/evaluate/:user_id
    Body: { trigger: "trip_completed", context_id: "trip_uuid" }
    Response: { trust_score, fraud_probability, verification_confidence, badge }

-- Score read (internal services only — matching, safety, fraud)
GET  /internal/trust/score/:user_id
    Response: { trust_score, fraud_probability, verification_confidence, badge, last_evaluated_at }

-- Batch evaluation (daily job)
POST /internal/trust/evaluate/batch
    Body: { user_ids: [...], trigger: "daily_job" }
```

### Public Badge Endpoint (app-facing — badge only, no score)

```
-- What the rider app reads for the rider's own badge
GET  /riders/me/badge
    Response: { badge: "trusted" }

-- What the driver app reads when receiving a ride request
GET  /trips/:id/rider/badge
    Response: { badge: "verified" }
    (scoped: driver can only read badge for their active/pending trip)

-- What the rider app reads for the matched driver
GET  /trips/:id/driver/badge
    Response: { badge: "vip" }
    (scoped: rider can only read badge for their active trip)
```

### Admin Trust Endpoints

```
GET  /admin/trust/score/:user_id
    Response: full score + all three internal scores + component breakdown + history
    Auth: Safety Admin, Platform Admin, Super Admin only

GET  /admin/trust/history/:user_id
    Response: paginated score history with inputs snapshots

POST /admin/trust/override/:user_id
    Body: { badge: "trusted", reason: "...", expires_at: null | timestamp }
    Auth: Super Admin only — logged to audit_logs

GET  /admin/trust/fraud-queue
    Response: users with fraud_probability_score ≥ 30%, sorted desc

GET  /admin/trust/multi-account-links
    Response: pending multi-account links awaiting review

POST /admin/trust/multi-account-links/:id/review
    Body: { status: "confirmed" | "dismissed", notes: "..." }
    Auth: Safety Admin and above

GET  /admin/device-fingerprints/:user_id
    Response: all device fingerprints linked to this account

GET  /admin/trust/badge-distribution
    Response: count of users per badge tier (for market health monitoring)
```

---

## 14. Admin Interface

### 14.1 New Admin Screen: A-28 — Trust Score Dashboard

**Purpose:** Founder and Platform Admin visibility into trust score distribution and anomalies.

**Panels:**

```
╔══════════════════════════════════════════════════════════════════╗
║  Trust Score Distribution                                        ║
║  ┌────────────────────────────────────────────────────────┐     ║
║  │  Riders:  None: 12%  Verified: 54%  Trusted: 29%       │     ║
║  │           Business: 3%  VIP: 2%                         │     ║
║  │  Drivers: Verified: 61%  Trusted: 32%  VIP: 7%          │     ║
║  │           [Bar chart by badge tier]                     │     ║
║  └────────────────────────────────────────────────────────┘     ║
║                                                                  ║
║  Fraud Probability Queue                                         ║
║  Users with score ≥ 30% — sorted by score desc                  ║
║  [Table: user, type, score, trigger, last evaluated, action]    ║
║                                                                  ║
║  Multi-Account Links Pending Review                              ║
║  [Table: user A, user B, link type, confidence, action]         ║
║                                                                  ║
║  Score Model Version: v1.0    Last full evaluation: today 3AM   ║
╚══════════════════════════════════════════════════════════════════╝
```

### 14.2 Trust Score Panel in Existing Admin Screens

**A-05 (Driver Detail) — add Trust tab:**
- Current badge + score breakdown (all three scores)
- Score history chart (30 days)
- Top 5 positive signals
- Top 5 negative signals
- Any active fraud flags
- Manual override option (Super Admin only)

**A-07 (Rider Detail) — add Trust tab:**
- Same layout as driver detail trust tab

---

## 15. Integration Map

How the Trust Score Engine connects to every other BidRide system:

| System | Integration |
|---|---|
| **Matching Engine** | Reads `current_badge` — VIP riders get priority match with high-rated drivers; VIP drivers get priority for premium rides |
| **Safety System** | Subscribes to fraud probability score — score ≥ 50% triggers safety review; score ≥ 90% triggers immediate account action |
| **Fraud Detection Engine** | Feeds signals into trust scoring; receives badge status for context |
| **Elevated Verification (PRD 5.2)** | Triggered when verification confidence < 50% or fraud probability ≥ 30% |
| **Rewards System** | VIP riders earn bonus points multiplier (e.g., 1.5× points per dollar) — trust engine confirms eligibility |
| **Airport Queue System** | VIP drivers receive preference in airport queue assignment |
| **Admin Dashboard (A-14 Fraud)** | Fraud probability score feeds fraud queue — trust engine is the primary fraud signal aggregator |
| **Ride Request (D-18)** | Driver sees rider's current badge (not score) — badge pulled at request generation time |
| **Driver Matched (RS-009a)** | Rider sees driver's current badge (not score) |
| **Pricing Engine** | Not integrated with scoring — fares are never adjusted based on trust score. Pricing is marketplace-driven. |

---

## 16. Gap Resolution Index

This document resolves or advances the following gaps from the Gap Analysis (00-gap-analysis-v1.md):

| Gap | Status | Resolution |
|---|---|---|
| G-07 · Device fingerprinting | ✓ RESOLVED | `device_fingerprints` table + device reputation scoring input defined |
| G-08 · Multi-account detection | ✓ RESOLVED | `multi_account_links` table + multi-account flag scoring input + admin review flow |
| G-09 · Fake driver detection | ✓ PARTIALLY RESOLVED | Earnings pattern analysis + GPS consistency + pre-shift selfie streak defined as trust inputs. Fake trip detection (coordinated pairs) flagged as AI engine requirement — needs separate fraud rule specification |
| G-11 · Rider trust label for drivers | ✓ RESOLVED | Defined as 4-badge system per Founder Decision D3: Verified / Trusted / Business / VIP |
| G-19 · Document fraud detection | ✓ PARTIALLY RESOLVED | Verification confidence score penalizes low identity match confidence; document authentication provider (Persona/Onfido) is now specified as a system dependency |

**Remaining open gaps:** G-01 through G-06, G-10, G-12 through G-18, G-20 through G-30 (see Gap Analysis for full list).

---

## Document Status

**Document:** 00c-trust-score-engine.md
**Version:** 1.0
**Status:** Pending Founder Approval

**Decisions made by founder (recorded here):**
- Internal AI risk scores never shown publicly ✓
- Numerical scores never surfaced to drivers ✓
- Four visible badges only: Verified · Trusted · Business · VIP ✓
- Badge design uses BidRide design tokens — no new colors introduced ✓
- Pricing engine is explicitly NOT integrated with trust score ✓

**Pending founder decisions (3 remain from gap analysis):**
- D1: Video recording policy
- D2: EWR PANYNJ fee handling
- D4: Driver trusted contacts

---

*BidRide Trust Score Engine — Confidential*
*Delaware LLC — All rights reserved*
