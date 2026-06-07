# BidRide — Founder Gap Analysis v1.0

**Status:** For Founder Review — Action Required Before Proceeding
**Document:** Pre-06 Analysis
**Prepared by:** Claude Code (CSO / PM / Technical Architect)
**Date:** June 5, 2026
**Scope:** Documents 01–05 reviewed against national rideshare competitive standard

> This is a founder-level gap analysis. Every gap listed is a real risk to
> launch, safety, legal compliance, or competitive position.
> Each gap is classified by severity and assigned a resolution path.

---

## Executive Summary

**Documents reviewed:** 01 (Founder Discovery) · 02 (PRD v1.1) · 03 (Design System) · 04 (Component Library v1.1) · 05 (Rider App UI)

**Overall assessment:** The BidRide blueprint is exceptionally strong relative to what typically exists at this stage. The core product — AI pricing, driver economics, trip lifecycle, safety architecture, and rider experience — is well-defined. However, a systematic review against the six areas specified by the founder reveals **23 confirmed gaps** ranging from critical safety requirements to missing founder intelligence tools.

**Critical gaps (must resolve before any public launch):** 9
**High gaps (must resolve before Phase 2 / beta):** 8
**Medium gaps (should resolve; planned document covers most):** 6

---

## Gap Analysis by Category

---

## 1. Driver Safety System

### ✓ What is defined

| Item | Where defined |
|---|---|
| Driver SOS button (concept) | PRD D-35, PRD Section 12.2 |
| Pre-shift selfie verification | PRD D-16 (full screen definition) |
| Report unsafe rider | PRD D-23 (issue flags), D-35 |
| AI route anomaly detection (affects driver) | PRD Section 12.1, 19.3 |
| Driver Safety Center screen (concept) | PRD D-35 |
| Incident management workflow | PRD Section 19.5 |
| Annual background check, ongoing MVR monitoring | PRD Section 6.2 |

### △ What is partially defined

| Item | Gap | Severity |
|---|---|---|
| Driver SOS | Mentioned as "same as R-28" in PRD D-35. **No wireframe exists** for the driver SOS. The rider SOS was fully designed with 3-state wireframe (RS-013). The driver SOS must be equally complete — the stakes are identical. | CRITICAL |
| Driver trusted contacts | Trusted contacts are fully designed for riders (RS-012t, PRD R-27, `trusted_contacts` table). Drivers have no equivalent. A driver in danger has no one auto-notified. | CRITICAL |
| Audio recording | PRD R-26 mentions an "Audio Recording option (consent toggle)" for riders. For drivers, D-35 Safety Center exists but audio recording is not mentioned as available. Uber and Lyft both offer audio recording for drivers. | HIGH |

### ✗ What is missing entirely

| Gap | Description | Severity |
|---|---|---|
| **Video recording** | Not mentioned in any document — not for riders, not for drivers. Uber and Lyft both offer audio + video recording in some markets. This is a safety and legal evidence tool. A decision needs to be made: include or explicitly exclude with documented reasoning. | HIGH |
| **Rider risk score visible to driver** | The `riders.risk_score` field is defined in the database. AI calculates it. But there is no UI element in the ride request screen (D-18) or anywhere else that surfaces this score to the driver before or after accepting a ride. Drivers make acceptance decisions blind to rider risk signals. | HIGH |
| **Driver panic mode (discrete)** | Uber has a "discreet mode" — driver can trigger safety check without alerting the rider. If a driver feels unsafe but does not want to escalate visibly, there is no silent escalation option. A driver cannot text "Are you OK?" back to BidRide without the rider potentially noticing. | HIGH |
| **Pre-trip vehicle safety checklist** | PRD Section 16.2 defers this to Phase 2. But Uber and Lyft both require this before shifts. It confirms: brakes, seat belts, lights, no damage. This is also a liability protection for BidRide — if a driver says their brakes failed, BidRide has no pre-trip record. | MEDIUM |
| **Driver incident history accessible to driver** | PRD D-35 mentions "Incident history" as a safety center element. No screen is designed. Drivers cannot see their own safety record. | MEDIUM |

---

## 2. Rider Safety System

### ✓ What is defined

| Item | Where defined |
|---|---|
| Rider SOS — full 3-state wireframe | RS-013 (complete) |
| Trusted contacts — full screen and workflow | RS-012t, PRD R-27, database |
| Share trip link | RS-009a, RS-010, RS-011, PRD R-13 |
| Real-time trip monitoring (AI anomaly) | PRD Sections 12.1, 19.3 |
| Driver verification displayed to rider | PRD R-13, RS-009a (name, photo, plate, rating) |
| Emergency SOS workflow | PRD Section 12.2, RS-013 |
| Safety Center hub screen | RS-012s |

### △ What is partially defined

| Item | Gap | Severity |
|---|---|---|
| Family safety tracking | PRD R-26 Safety Center lists "Family Safety Tracking (linked accounts)" as a feature. There is no screen for it, no data model for it, no workflow defined. It is mentioned and then orphaned. | HIGH |
| Emergency dispatch integration | PRD defers to Phase 2. But no specification exists for what Phase 2 dispatch looks like — no API contract, no UI stub. When the time comes this will require a complete design pass. | MEDIUM |
| Shareable live trip link | The link is sent to trusted contacts and can be manually shared. But the actual link format, expiry (does it die when the trip ends?), privacy controls (who can view?), and the public-facing "trip viewer" page are not designed anywhere. | HIGH |

### ✗ What is missing entirely

| Gap | Description | Severity |
|---|---|---|
| **"Are you OK?" passive check screen** | PRD Section 12.1 mentions that AI sends a push notification asking "Is everything okay?" with an SOS button during a hard anomaly. This is a critical in-app screen — but it was never designed in RS-005 through RS-020. The rider needs a clear, calm screen at this moment, not just a push notification that might be missed. | CRITICAL |
| **Audio recording consent screen and workflow** | PRD R-26 mentions a toggle. But in-ride audio recording has state-specific consent laws (NJ is one-party consent; NY is one-party consent; other expansion states may differ). The actual flow — when consent is obtained, what the rider sees when a session is recorded, how recordings are stored and who can access them — is completely undefined. | CRITICAL |
| **Driver "verified" badge detail for rider** | Rider sees name, photo, rating. But there is no "BidRide Verified" indicator that communicates the driver passed background check, ID verification, vehicle inspection. This is a trust signal that both Uber and Lyft display prominently. Riders cannot distinguish a BidRide-verified driver from an unverified one in the UI. | HIGH |

---

## 3. Fraud Prevention

### ✓ What is defined

| Item | Where defined |
|---|---|
| Fraud Detection Dashboard (admin view) | PRD A-14 |
| Fraud Detection Engine (AI — one of 7 engines) | PRD Section 15 AI Strategy |
| Elevated verification flow (high-risk riders) | PRD Section 5.2 |
| Risk score field on riders table | PRD Section 13 database |
| Fraud types identified: GPS spoofing, fake trips, payment fraud, account takeover, referral abuse, chargeback pattern | PRD A-14 |
| Chargeback handling (Stripe webhooks) | PRD Section 11.1 |
| 5-failed-attempts lockout (auth) | RS-004 (login), RS-003a (OTP) |

### △ What is partially defined

| Item | Gap | Severity |
|---|---|---|
| GPS spoofing detection | Listed as a fraud type in A-14 but zero technical specification. How does the system detect mock GPS apps? What signals trigger the flag? No definition. | HIGH |
| Referral fraud detection | "Referral abuse" is listed as a fraud type. No detection rules defined — no limit on referral bonuses per device, no velocity rules, no device fingerprint check on referral chains. A single person could create 50 accounts and harvest referral bonuses. | HIGH |
| Payment fraud prevention | Stripe webhooks are defined for `payment_intent.succeeded` and `payment_intent.payment_failed`. But there is no chargeback response workflow UI, no admin screen for managing Stripe disputes, no card velocity monitoring, no bin-list checking for stolen cards. | HIGH |

### ✗ What is missing entirely

| Gap | Description | Severity |
|---|---|---|
| **Device fingerprinting** | Not mentioned in any document. Device fingerprinting is the primary defense against multi-account creation and account takeover. Without it, a fraudster can create unlimited accounts with new email addresses. No `device_fingerprints` table, no API for registration of device identifiers, no integration with a fingerprinting service (e.g., Fingerprint.js, Branch, or native device ID). | CRITICAL |
| **Multi-account detection** | Directly related to above. No mechanism exists to detect when one person has created multiple rider or driver accounts — same phone number used across devices, same bank account, same device ID. This is a fundamental fraud vector. | CRITICAL |
| **Fake driver detection** | Fraudulent driver accounts can manipulate: trip completion without actually completing the trip, GPS spoofing to fake pickup and dropoff, collusion with a fake rider account to generate fraudulent earnings. No detection system is defined for these patterns. | CRITICAL |
| **Document fraud detection** | Driver license OCR is defined. But OCR does not verify document authenticity — a high-quality fake license scans fine. No integration with a document authentication service (e.g., Persona, Onfido, Jumio) is mentioned for document liveness and authenticity. | HIGH |
| **Velocity rules for ride requests** | No rules defined for: a rider requesting and cancelling 10 rides in an hour (abuse), a driver declining 95% of rides (gaming the system without penalty), a new account booking 20 rides in the first 24 hours (bot behavior). These need defined thresholds and automatic flags. | MEDIUM |

---

## 4. Compliance

### ✓ What is defined

| Item | Where defined |
|---|---|
| NJ TNC license requirement | PRD Section 21 (legal checklist) |
| Rideshare commercial insurance requirement | PRD Section 21, D-09 |
| Driver background check (Checkr) | PRD D-12, Section 6.1 |
| NJ MVR (Motor Vehicle Record) check | PRD Section 6.1 |
| Driver license, registration, insurance documents | PRD D-07, D-08, D-09 |
| 30-day document expiry alerts | PRD D-33 (Vehicle Management) |
| Annual background check renewal | PRD Section 6.2 |
| Stripe 1099 tax documentation | PRD D-34, Section 11.3 |
| Audio recording consent framework (flagged) | PRD R-26 (incomplete) |
| Multi-state expansion legal framework | Foundation doc (checklist item) |

### △ What is partially defined

| Item | Gap | Severity |
|---|---|---|
| Driver document expiry → suspension workflow | PRD mentions 30-day alerts and "expired documents suspend driver." The actual workflow — grace period? Immediate suspension? What the driver sees? How they resubmit? — is not designed as a screen flow. | HIGH |
| Insurance gap coverage periods | PRD requires rideshare endorsement but does not define how BidRide's platform-level insurance covers Period 1 (app on, no ride matched), Period 2 (ride accepted, en route to pickup), and Period 3 (passenger in vehicle). These are legally distinct coverage periods. | CRITICAL |

### ✗ What is missing entirely

| Gap | Description | Severity |
|---|---|---|
| **EWR/Port Authority compliance** | Newark Airport (EWR) is operated by the Port Authority of NY and NJ (PANYNJ). TNC operations at EWR require: a specific PANYNJ TNC permit, per-trip fees paid to PANYNJ, AVI (Automated Vehicle Identification) transponder stickers on approved vehicles, and operations only in designated TNC zones. None of this is defined in any document — not the permit workflow, not the per-trip fee pass-through, not the vehicle sticker requirement. This is a launch blocker for the EWR anchor market. | CRITICAL |
| **Insurance period workflow (driver-facing)** | Drivers need to understand what insurance applies when. The app should display which coverage period is active: "You are in Period 1 (app on, waiting for a ride)" → "You are now in Period 2 (trip accepted)" → "You are in Period 3 (rider aboard)." No UI for this exists. | HIGH |
| **Data retention and deletion policy** | Foundation mentions "privacy policy" as a legal requirement. But no data retention schedule is defined (how long GPS tracks are stored, how long trip audio recordings are kept, when user data is purged after account deletion). CCPA (California) and future state expansion will require this. | HIGH |
| **Anti-discrimination AI audit** | The AI pricing engine takes neighborhood, time of day, and area as inputs. No mechanism is defined to audit whether the AI's pricing or matching behavior creates discriminatory outcomes — systematically higher fares in certain zip codes, systematically fewer driver offers in certain areas. This is a civil rights and FTC compliance issue. | HIGH |
| **Accessibility compliance workflow** | Document 10 (Accessibility Standards) is planned but not yet written. ADA compliance for a TNC in New Jersey requires a plan for wheelchair-accessible vehicle access. No WAV (Wheelchair Accessible Vehicle) policy is defined anywhere. | MEDIUM |

---

## 5. Founder Dashboard

### ✓ What is defined

| Item | Where defined |
|---|---|
| Admin KPI Dashboard (A-02) | PRD Section 3 |
| Live Map (A-03) | PRD Section 3 |
| AI Engine Monitor (A-11) | PRD Section 3 |
| Safety Command Center (A-25, A-26, A-27) | PRD Section 19 |
| Fraud Detection Dashboard (A-14) | PRD Section 3 |
| Financial Dashboard (A-15) | PRD Section 3 |
| Founder dashboard components (C-126 through C-129) | Component Library v1.1 |
| Marketplace Metrics components (C-110 through C-125) | Component Library v1.0 |

### △ What is partially defined

| Item | Gap | Severity |
|---|---|---|
| Market Expansion Dashboard (C-126) | Component is defined in component library but no screen in any document defines what data it shows, what criteria trigger expansion readiness, or how the founder acts on it. | MEDIUM |
| Competitor Pricing Dashboard (C-127) | Component is defined but no screen or data source is specified. How does BidRide collect competitor pricing? Manual entry? API? Scraping? None defined. | MEDIUM |
| Revenue Forecast Dashboard (C-128) | Component is defined but no screen. | MEDIUM |
| Unit Economics Dashboard (C-129) | Component is defined but no screen. | MEDIUM |

### ✗ What is missing entirely

| Gap | Description | Severity |
|---|---|---|
| **CAC (Customer Acquisition Cost) tracking** | Not mentioned in any document. A founder running a marketplace needs to know the cost to acquire each rider and each driver — by channel, by cohort. No marketing channel tracking, no CAC calculation, no CAC vs. LTV dashboard. | HIGH |
| **LTV (Lifetime Value) per user** | Not mentioned in any document. No model for projecting how much revenue a rider or driver generates over their relationship with BidRide. Without LTV, CAC optimization is impossible. | HIGH |
| **Driver retention cohort analysis** | A-04 shows driver status (Active/Suspended/Banned). But no chart shows: of drivers who joined in month X, what % are still active in month X+3? This is the key leading indicator for marketplace health. | HIGH |
| **Rider retention cohort analysis** | Same gap as driver retention. The financial model depends on repeat riders. No cohort retention screen exists. | HIGH |
| **Founder Command Center screen** | Document 08 (Founder Command Center UI) is planned. But the founder-specific data requirements — beyond what's in the admin dashboard — have not been scoped. What does the founder see that a Platform Admin does not? No spec exists yet. This entire document needs creation. | MEDIUM |
| **Daily/weekly founder digest** | No automated summary report (email or in-app) that gives the founder a health snapshot: rides yesterday, revenue, new drivers, new riders, safety incidents, fraud flags. Admin must actively visit the dashboard to see this. | MEDIUM |

---

## 6. AI Systems

### ✓ What is defined

| Item | Where defined |
|---|---|
| Dynamic Pricing Engine — full workflow | PRD Section 8 (complete 8-step workflow) |
| Driver Earnings Floor Enforcement | PRD Section 18 (complete) |
| Airport Demand Forecasting Engine | PRD Section 17 (complete) |
| All 7 AI engine names and functions | PRD Section 15, Foundation doc |
| AI Pricing Logs (database) | PRD Section 13 (`ai_pricing_logs`) |
| Earnings Floor Logs (database) | PRD Section 18 (`earnings_floor_logs`) |
| Fraud Detection Engine (concept) | PRD Section 15 |
| AI Engine Monitor (admin screen) | PRD A-11 |
| Learning flywheel concept | Foundation doc |
| AI anomaly detection rules (all thresholds) | PRD Section 19.3 (complete table) |

### △ What is partially defined

| Item | Gap | Severity |
|---|---|---|
| Matching Algorithm | Matching Service is defined as internal. Selection criteria listed: proximity, rating, acceptance rate, vehicle type, route efficiency. But: no matching latency target, no tie-breaking rules, no definition of "best match" when multiple criteria conflict, no fallback priority when zero drivers are available. | HIGH |
| Driver Prediction Engine (positioning) | Named in PRD Section 15. Heatmap screen D-28 exists in PRD. But the actual algorithm — how does it decide which zone to recommend to which driver? — is not specified. | MEDIUM |
| Surge Forecasting Engine | Named in Section 15. Never described beyond "predicts demand spikes from events, weather, time patterns." No data model, no output format, no integration with rider-facing UX (do riders see surge warnings? When?). | MEDIUM |

### ✗ What is missing entirely

| Gap | Description | Severity |
|---|---|---|
| **AI model training pipeline** | The flywheel is described as a concept. But how does data flow from completed trips back into model retraining? No data pipeline specification, no training frequency, no model versioning policy, no A/B testing framework for fare model changes. This is needed before the first AI model can be deployed. | HIGH |
| **AI explainability screen (admin)** | PRD states "AI recommendations must be explainable and auditable." But no admin screen exists to inspect *why* a specific fare was calculated — which inputs dominated, what the demand multiplier was, whether the floor was applied. The `ai_pricing_logs` table captures this but no UI surfaces it to admins or the founder. | HIGH |
| **AI bias audit mechanism** | No system defined to detect whether AI pricing or matching decisions produce discriminatory outcomes. Required for FTC compliance in an expansion market. | HIGH |
| **Rider Prediction Engine** | Named in PRD Section 15. Phase 2 feature. Zero specification beyond the name. No inputs, no outputs, no screen, no data model. Anticipated demand is the core of the learning flywheel — this needs at minimum a specification before Phase 2. | MEDIUM |
| **Rating manipulation detection** | No AI system or rule set defined to detect: coordinated review bombing of a driver, a driver with suspiciously uniform 5-star ratings, a rider who always gives 1-star ratings. Ratings drive matching priority and platform standing — without fraud protection they are exploitable. | MEDIUM |
| **Predictive cancellation risk** | No AI system defined that identifies, at matching time, which driver-rider combinations have high cancellation probability. Uber and Lyft both use this to optimize matching. | MEDIUM |

---

## Consolidated Gap Register

| # | Category | Gap | Severity | Resolution Path |
|---|---|---|---|---|
| G-01 | Driver Safety | Driver SOS — no wireframe exists | CRITICAL | Design in 06-driver-app-ui.md |
| G-02 | Driver Safety | Driver trusted contacts — not designed | CRITICAL | Add to 06-driver-app-ui.md + DB |
| G-03 | Rider Safety | "Are you OK?" passive check — no screen | CRITICAL | Add to 05-rider-app-ui.md (addendum) |
| G-04 | Rider Safety | Audio recording consent workflow | CRITICAL | Define before MVP build |
| G-05 | Compliance | EWR/PANYNJ TNC permit and fee compliance | CRITICAL | Separate compliance spec |
| G-06 | Compliance | Insurance coverage period workflow | CRITICAL | Define in 06 + compliance spec |
| G-07 | Fraud | Device fingerprinting | RESOLVED | 00c-trust-score-engine.md — device_fingerprints table + scoring input |
| G-08 | Fraud | Multi-account detection | RESOLVED | 00c-trust-score-engine.md — multi_account_links table + admin review flow |
| G-09 | Fraud | Fake driver detection | PARTIAL | 00c-trust-score-engine.md covers earnings/GPS/selfie patterns. Coordinated fake pair detection needs separate fraud rule spec. |
| G-10 | Driver Safety | Video recording — no decision made | HIGH | Founder decision required |
| G-11 | Driver Safety | Rider trust label on driver request screen | RESOLVED | Decided Jun 5: show Verified / Business / Frequent / New label only. No score. Design in 06. |
| G-12 | Driver Safety | Driver panic/discreet mode | HIGH | Add to 06-driver-app-ui.md |
| G-13 | Rider Safety | Family safety tracking — orphaned feature | HIGH | Design in 05 addendum |
| G-14 | Rider Safety | Shareable live trip link — public page undefined | HIGH | Define before MVP |
| G-15 | Rider Safety | Driver "BidRide Verified" badge | HIGH | Add to 06 + RS-009a |
| G-16 | Fraud | GPS spoofing detection — no specification | HIGH | Add to PRD |
| G-17 | Fraud | Referral fraud rules — none defined | HIGH | Add to PRD rewards workflow |
| G-18 | Fraud | Payment fraud / chargeback workflow | HIGH | Add to PRD + admin UI |
| G-19 | Fraud | Document authenticity checking | HIGH | Add to PRD driver verification |
| G-20 | Compliance | Data retention and deletion policy | HIGH | Define before launch |
| G-21 | Compliance | Anti-discrimination AI audit | HIGH | Define before national expansion |
| G-22 | Founder | CAC and LTV tracking | HIGH | Define in 08-founder-command-center |
| G-23 | Founder | Driver and rider retention cohorts | HIGH | Define in 08-founder-command-center |
| G-24 | AI | AI model training pipeline specification | HIGH | Define before backend build |
| G-25 | AI | AI explainability admin screen | HIGH | Define in 07-admin-dashboard-ui |
| G-26 | Driver Safety | Audio recording for drivers | HIGH | Define in 06-driver-app-ui.md |
| G-27 | Compliance | Document expiry → suspension workflow | HIGH | Design in 06-driver-app-ui.md |
| G-28 | Fraud | Velocity rules (request/cancel patterns) | MEDIUM | Add to PRD |
| G-29 | AI | Surge Forecasting Engine specification | MEDIUM | Add to PRD Section 15 |
| G-30 | AI | Rating manipulation detection | MEDIUM | Add to PRD AI section |

---

## Resolution Priority Map

### Before starting 06-driver-app-ui.md
These gaps directly affect what screens must be designed in the driver app:

| Gap | Action needed |
|---|---|
| G-01 · Driver SOS wireframe | Design the full driver SOS as a first-class screen in 06 — do not defer to "same as rider" |
| G-02 · Driver trusted contacts | Design the driver trusted contacts screen in 06 (equivalent of RS-012t) |
| G-10 · Video recording | Founder decision: include or explicitly exclude. This affects both driver and rider app design. |
| G-11 · Rider trust label | Design the trust label (Verified / Business / Frequent / New) on D-18. No score shown. |
| G-12 · Driver panic mode | Design the discreet emergency escalation in 06 |
| G-26 · Driver audio recording | Define availability in driver app |
| G-27 · Document expiry workflow | Design the document expiry → suspension → re-upload flow in 06 |
| G-05 · EWR compliance | EWR is central to 06's airport queue screens — PANYNJ compliance affects what drivers see and do |
| G-06 · Insurance period | Design the Period 1/2/3 indicator in 06 |

### During 07-admin-dashboard-ui.md
| Gap | Action needed |
|---|---|
| G-25 · AI explainability | Design the AI decision audit screen |
| G-17 · Referral fraud | Design the referral fraud monitoring view |
| G-18 · Payment fraud | Design chargeback management screen |

### During 08-founder-command-center-ui.md
| Gap | Action needed |
|---|---|
| G-22 · CAC/LTV | Design both dashboards |
| G-23 · Retention cohorts | Design rider and driver cohort screens |
| G-21 · AI bias audit | Design audit summary for founder |

### Addendum to 05-rider-app-ui.md (before 06 approval)
| Gap | Action needed |
|---|---|
| G-03 · "Are you OK?" check screen | Add RS-011a (new screen) |
| G-13 · Family safety tracking | Add RS-012f (new screen) |
| G-15 · Driver verified badge | Update RS-009a wireframe |

### Separate compliance specification (before MVP build)
| Gap | Action needed |
|---|---|
| G-04 · Audio recording consent workflow | Write consent flow by state |
| G-05 · EWR/PANYNJ compliance | Write airport TNC compliance spec |
| G-07 · Device fingerprinting | Add to PRD Section 13 (DB + API) |
| G-08 · Multi-account detection | Add to PRD fraud section |
| G-09 · Fake driver detection | Add to PRD fraud section |
| G-20 · Data retention policy | Write data retention schedule |
| G-24 · AI training pipeline | Add to PRD Section 15 |

---

## Founder Decisions Required

Before 06-driver-app-ui.md can begin, the founder must decide:

### Decision 1 — Video Recording
**Question:** Should BidRide offer optional in-vehicle video recording (driver-facing camera or cabin camera)?

**Options:**
- A: Include video recording (driver-only camera, records trip, stored 72 hours, accessible on safety dispute)
- B: Audio-only (already partially defined)
- C: Neither for MVP; revisit after launch

**Implication:** If video is included, it requires camera hardware specifications, consent workflow, storage architecture, and legal review in every market. If excluded, document the decision so it is not relitigated.

---

### Decision 2 — EWR PANYNJ Compliance Approach
**Question:** The Port Authority charges per-trip fees and requires TNC permits for EWR operations. How does BidRide handle the PANYNJ fee?

**Options:**
- A: Build into fare (PANYNJ fee is part of AI fare calculation, transparent to rider)
- B: Pass through as a separate line item on receipt (rider sees "EWR Airport Fee: $X")
- C: Absorb into platform commission (reduces margin on airport rides)

**Implication:** This affects the fare breakdown screen, the AI pricing formula, the receipt, and the driver earnings calculation for every airport ride.

---

### Decision 3 — Rider Risk Score Visibility to Drivers
**STATUS: DECIDED — June 5, 2026**

**Decision:** Internal AI risk scores are never shown to drivers. Numerical scores, color tiers (Green/Yellow/Red), and any risk language are hidden.

Drivers see one of four trust labels on the ride request screen (D-18):
- **Verified Rider** — standard verified account
- **Verified Business Rider** — enrolled in BidRide Business
- **Frequent Rider** — established ride history on platform
- **New Rider** — first or early rides on platform

**Rationale:** Numerical risk scores create discrimination concerns and legal exposure. A driver who sees a "high risk" flag may decline based on criteria that correlate with protected class characteristics. BidRide handles elevated-risk riders at the platform level (elevated verification, account holds) before they reach the matching queue. The driver's decision frame is trust and familiarity — not a score.

**Implementation:** Design in 06-driver-app-ui.md (D-18 ride request screen). Label logic is computed server-side from account history. Drivers never see the underlying score. The `riders.risk_score` field remains internal to the fraud and safety systems only.

---

### Decision 4 — Driver Trusted Contacts
**Question:** Should drivers have an equivalent to rider trusted contacts — people auto-notified when a driver starts a shift or is in an SOS event?

**Options:**
- A: Yes — drivers get up to 5 trusted contacts, notified on SOS activation
- B: Partial — drivers can set an emergency contact (1 person) notified on SOS only
- C: No — BidRide Safety Admin is the driver's emergency response; personal contacts are separate

**Implication:** Affects database schema (add trusted contacts for driver user type), driver safety center design in 06, and SMS notification volume.

---

## What This Analysis Confirms Is Solid

To be explicit: the following areas are well-built and do not need re-work:

| Area | Status |
|---|---|
| Core AI pricing engine (PRD Section 8) | Complete and production-grade specification |
| Driver earnings floor enforcement (PRD Section 18) | Exceptional — exceeds industry standard |
| Airport Queue Intelligence System (PRD Section 17) | Complete, differentiated, buildable |
| Trip lifecycle workflow (PRD Section 7) | Complete end-to-end |
| Rider SOS (RS-013) | Complete — 3-state machine, correct UX |
| Rider trusted contacts (RS-012t) | Complete |
| Design system (03) | Production-grade, consistent |
| Component library (04) | Comprehensive — 67 components |
| Rider app UI (05) | 34 screens, all flows covered |
| Database schema (PRD Section 13) | Solid foundation, 17 tables |
| Admin safety infrastructure (PRD Sections 12, 19) | Thorough |
| Fraud detection dashboard (A-14) | Defined — needs fraud detection rules added |
| Payment and payout workflow (PRD Section 11) | Complete |

---

## Recommended Path Forward

**Step 1 — Founder decisions:** Answer the 4 decisions above.

**Step 2 — 05 addendum:** Before 06 begins, add 3 missing screens to the rider app UI (RS-011a passive check, RS-012f family tracking, RS-009a driver verified badge update). These are small additions, not a rewrite.

**Step 3 — PRD addendum:** Add fraud detection specifications to PRD Section 14 (device fingerprinting API, multi-account rules, velocity rules). These affect the backend build — the earlier they are defined, the better.

**Step 4 — 06-driver-app-ui.md:** Proceed with full awareness that 9 driver-specific screens from this gap analysis must be included (driver SOS, driver trusted contacts, driver discreet mode, insurance period indicator, EWR compliance screens, document expiry flow, rider risk indicator on request screen, driver incident history, audio recording consent for drivers).

**Step 5 — Airport compliance spec:** Before any public launch, a dedicated EWR/PANYNJ compliance document is required. This is a launch blocker for the primary market.

---

## Document Status

**Document:** 00-gap-analysis-v1.md
**Version:** 1.0
**Status:** Pending Founder Review
**Action required:** Founder decisions on items D1–D4 before 06-driver-app-ui.md proceeds

---

*BidRide Gap Analysis — Confidential*
*Delaware LLC — All rights reserved*
