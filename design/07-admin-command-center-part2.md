# BidRide — Admin Command Center v1.0 · Part 2

**Status:** Draft — Pending Founder Approval
**Document:** 07-B · Part 2 of 3
**References:** 07-admin-command-center-part1.md · 00d-safety-shield-system.md §15

---

## Screen Index

| ID | Screen | Section |
|---|---|---|
| A-06 | Driver Approval Queue | §1 |
| A-07 | Driver Suspension System | §1 |
| A-08 | Rider Management | §2 |
| A-09 | Rider Profile (Admin View) | §2 |
| A-10 | Safety Incident Center | §3 |

---

## §1 — Driver Approval & Suspension

### A-06 · Driver Approval Queue

**Purpose:** Operations Admin works through pending applications. Each application requires document review, checklist completion, and a final approve/decline decision. Background check results are surfaced inline.

```
┌──────────────────────────────────────────────────────────────────────┐
│  🚗 Driver Approval Queue                    12 pending              │
├──────────────────────────────────────────────────────────────────────┤
│  [Status ▾] [Submitted ▾] [BG Check ▾]  [ 🔍 Search ]              │
│                                                                      │
│  ┌──────────┬───────────────┬──────────────┬────────┬─────────────┐ │
│  │ Driver   │ Submitted     │ BG Check     │ Docs   │ Action      │ │
│  ├──────────┼───────────────┼──────────────┼────────┼─────────────┤ │
│  │ Kevin R. │ Jun 5 (1d)    │ ✓ Clear      │ ✓ All  │ [Review]    │ │
│  │ Diane M. │ Jun 4 (2d)    │ ⏳ Pending   │ ✓ All  │ [Review]    │ │
│  │ Frank L. │ Jun 3 (3d)    │ ⚠ Consider   │ ⚠ Re-up│ [Review]    │ │
│  │ Yolanda B│ Jun 1 (5d)    │ ✓ Clear      │ ✓ All  │ [Review]    │ │
│  └──────────┴───────────────┴──────────────┴────────┴─────────────┘ │
│  ⚠ Applications > 5 days old are highlighted — SLA breach warning   │
└──────────────────────────────────────────────────────────────────────┘
```

**Application Review Panel (on [Review]):**
```
┌────────────────────────────────────────────────────────────────────┐
│  Kevin R. — Application Review                         ×           │
├──────────────────────────┬─────────────────────────────────────────┤
│  DOCUMENTS               │  BACKGROUND CHECK                      │
│  License Front  ✓ [View] │  Provider: Checkr                      │
│  License Back   ✓ [View] │  Status: ✓ Clear                       │
│  Insurance      ✓ [View] │  MVR: Clean                            │
│  Registration   ✓ [View] │  Criminal: None found                  │
│  Inspection     ✓ [View] │  Date cleared: Jun 5, 2026            │
│  Profile Photo  ✓ [View] │                                         │
│                          │  VEHICLE ELIGIBILITY                   │
│  AI CONFIDENCE SCORES    │  2020 Honda Accord · Silver            │
│  License: 94%   ✓        │  NJB-5521 · Eligible: Standard        │
│  Insurance: 88% ✓        │                                         │
│  Registration:91%✓       │  PERSONAL INFO                         │
│  (admin-only)            │  Kevin Robinson · Jun 3, 1990 (35)    │
│                          │  Newark NJ 07102  ·  ✓ Age eligible    │
├──────────────────────────┴─────────────────────────────────────────┤
│  ADMIN DECISION                                                     │
│  ○ Approve    ○ Decline    ○ Request re-upload (specify docs)      │
│                                                                     │
│  Internal note (required on decline):                               │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                                                               │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  [ Submit Decision ]  Primary button — requires radio selection    │
└────────────────────────────────────────────────────────────────────┘
```

**Approval SLA:** 3 business days target. At 4 days → Operations Admin lead notified. At 5 days → Platform Admin notified.

**Decision outcomes:**
- **Approve:** `drivers.status → approved`, trust score initialized at 200 (Verified badge), welcome email + push sent
- **Decline:** `drivers.status → declined`, FCRA adverse action letter generated and emailed if decline is based on background check; decline reason stored in `drivers.decline_reason`
- **Request re-upload:** `drivers.status → action_required`, specific documents flagged in `driver_documents.status = 're_upload_required'`, driver notified with reason

**Business rule:** BG check result = "Consider" requires Operations Admin manager sign-off (second admin approval) before any outcome.

---

### A-07 · Driver Suspension System

**Purpose:** Structured suspension workflow. Different suspension types have different requirements, durations, and driver notification templates.

```
┌────────────────────────────────────────────────────────────────────┐
│  Suspend Driver: Marcus Brown (D-00247)                    ×       │
├────────────────────────────────────────────────────────────────────┤
│  SUSPENSION TYPE                                                    │
│  ○ Warning only (no suspension — note added, driver not notified)  │
│  ● Temporary — specify days:  [ 7  ] days                         │
│  ○ Indefinite — requires Platform Admin  →  pending investigation  │
│  ○ Permanent — requires Platform Admin + Super Admin               │
│                                                                     │
│  REASON CATEGORY                                                    │
│  [▾ Select: Safety violation / Fraud / Document expired /          │
│      Conduct / Background update / Other]                           │
│                                                                     │
│  WRITTEN REASON (min 50 characters, stored in audit log)           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                                                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  DRIVER NOTIFICATION                                                │
│  ○ Notify driver immediately  ● Notify driver (review first)       │
│                                                                     │
│  IMPACT                                                             │
│  Active trip: None (driver offline)                                │
│  Scheduled payouts: Hold until reinstatement? [Yes] [No]          │
│                                                                     │
│  For suspensions > 14 days: second admin confirmation required     │
│  [ Submit ]  Platform Admin required                               │
└────────────────────────────────────────────────────────────────────┘
```

**Suspension state machine:**
`active → suspended → [auto-reinstate after duration] | [admin reinstate] | [permanent]`

**Active trip handling on suspension:** If driver is mid-trip when suspended:
- Suspension takes effect at trip completion (not mid-trip — rider safety)
- If suspension is for safety reason: immediate flag on current trip, Safety Admin notified
- Driver not informed during active trip — notified at trip completion

**Driver notification template (temporary):**
"Your BidRide driver account has been temporarily suspended for [X] days due to [reason category]. If you believe this is in error, contact driver-support@bidride.com. Your account will automatically reactivate on [date]."

**Appeal flow:** Driver can submit one appeal per suspension via support ticket. Appeals assigned to Operations Admin manager (not the suspending admin). Founder has final appeal authority.

---

## §2 — Rider Management

### A-08 · Rider Management

**Purpose:** Searchable directory of all riders. Mirrors driver management structure.

```
┌──────────────────────────────────────────────────────────────────────┐
│  👤 Rider Management                                                 │
├──────────────────────────────────────────────────────────────────────┤
│  [ 🔍 Search name, email, phone... ]  [Badge ▾] [Status ▾] [Export]│
│                                                                      │
│  48,321 riders  ·  1,204 active today  ·  3 banned                 │
│                                                                      │
│  ┌──────────────┬──────────┬────────┬────────────┬────────────────┐ │
│  │ Rider        │ Badge    │ Trips  │ Status     │ Action         │ │
│  ├──────────────┼──────────┼────────┼────────────┼────────────────┤ │
│  │ Lisa M.      │ Trusted  │  87    │ ● Active   │ [Profile]      │ │
│  │ Mike P.      │ Verified │   3    │ ● Active   │ [Profile]      │ │
│  │ Dana L.      │ Business │ 142    │ ● Active   │ [Profile]      │ │
│  │ Bob T.       │ Verified │   1    │ ⚠ Flagged  │ [Profile]      │ │
│  └──────────────┴──────────┴────────┴────────────┴────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

---

### A-09 · Rider Profile (Admin View)

**Purpose:** Full rider record including internal trust scores, payment history, fraud flags, and trip history.

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Riders / Lisa M. (Rider #R-01847)                              │
├──────────────────────┬─────────────────────────────────────────────┤
│  PROFILE             │  ADMIN ACTIONS                             │
│  [photo] Lisa M.     │  [ Message Rider ]                         │
│  Trusted · ⭐ 4.7     │  [ Issue Refund ] Finance Admin+           │
│  87 trips · 6 months │  [ Suspend Account ] Platform Admin+       │
│  Newark, NJ          │  [ Permanently Ban ]  Super Admin          │
│  l.m@email.com       │  [ Add Internal Note ]                     │
│                      │                                             │
│  INTERNAL TRUST SCORES (admin-only)                                │
│  Trust Score:      612   Fraud Probability:  3.4%                 │
│  Verif. Confidence: 91%  text: JetBrains Mono / admin-only label  │
│                                                                     │
│  PAYMENT ON FILE     │  CURRENT TRIP                              │
│  Visa ····4821       │  None active                               │
│  No chargebacks      │                                             │
│                      │  SAFETY INCIDENTS                          │
│  FRAUD FLAGS         │  None on record                            │
│  None                │                                             │
│                                                                     │
│  TRIP HISTORY (last 5)                                             │
│  Jun 6 · Trip #8901 · $18.50 · ✓ Completed                       │
│  Jun 5 · Trip #8842 · $12.20 · ✓ Completed                       │
│  Jun 4 · Trip #8791 · Cancelled (before match — no charge)        │
└────────────────────────────────────────────────────────────────────┘
```

**Rider ban:** Permanent ban requires Super Admin. Banned riders cannot create new accounts (phone + email + device fingerprint all blocked). Existing payment methods are voided.

---

## §3 — Safety Incident Center

### A-10 · Safety Incident Center

**Purpose:** Real-time management of all safety events. Three sub-views: SOS Queue, Panic Queue, Incident History. This is the highest-priority screen in the entire admin system.

**SOS Queue (default view):**
```
┌──────────────────────────────────────────────────────────────────────┐
│  🛡 Safety Incident Center    [ SOS Queue ] [ Panic ] [ History ]   │
│  🔴 1 SOS ACTIVE   ⚠ 2 CRITICAL   ● 3 MODERATE                     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  🔴 SOS ACTIVE  Trip #8901          SLA: 0:43 ████████░░    │   │
│  │  Rider: Lisa M.  ·  Driver: James T. ·  9:41 AM             │   │
│  │  87 Market St, Newark → Penn Station                         │   │
│  │  Contacts notified: 2  ·  🔴 Recording: Active              │   │
│  │  Assigned to: [Assign to me]  [Assign to ▾]                 │   │
│  │                                                              │   │
│  │  [ 📞 Call Rider (masked) ]  [ 📞 Call Driver (masked) ]    │   │
│  │  [ 🗺 View on Map ]  [ 🚨 Request 911 Dispatch ]            │   │
│  │  [ ✓ Mark Resolved ]  (requires resolution category)        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  ⚠ CRITICAL  Trip #8897               Admin: Sarah K.        │   │
│  │  Route deviation 2.1 mi · No rider response · 4:22           │   │
│  │  [ View ] [ Call Rider ] [ Escalate to SOS ]                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  ⚠ CRITICAL  Trip #8893               Unassigned             │   │
│  │  Driver GPS lost 3:45 min · Night ride · Isolated zone       │   │
│  │  [ View ] [ Assign to me ] [ Call Driver ]                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

**Panic Queue tab:**
```
  🔕 PANIC_ACTIVE  Trip #8889  Driver: Kevin R.  7:24 min ago
  Silent escalation. DO NOT CONTACT RIDER.
  [ Send admin check to driver ] [ Call driver (masked) ] [ Escalate ]
  Admin check sent 6:54 ago — no response → auto-escalate to CRITICAL
```

**Incident resolution form:**
```
  Resolve Incident — Trip #8901
  Resolution category: [ ▾ False alarm / Resolved safely / Dispatched 911 /
                          Rider confirmed safe / Driver confirmed safe / Other ]
  Notes (required if "Other"):  [ text area ]
  Recording disposition:  ● Delete after 30 days  ○ Retain 2 years
  [ Submit Resolution ]  — closes incident, notifies contacts: "Update: [Name] is safe."
```

**SLA enforcement (from 00d §15.1):**
- SOS: 90-second acknowledgment. At 60s: all online Safety Admins re-alerted with audio ping.
- CRITICAL: 2-minute action required. At 90s: on-call Safety Lead paged via SMS.
- PANIC: 3-minute response. No response → auto-escalate to CRITICAL.
- SLA breaches written to `audit_logs` and included in monthly safety metrics report.

**Incident History tab:** Full table of all closed incidents with filter by type, date, resolution, admin. Searchable by trip or user.

---

## Database Additions

**`driver_suspensions`:**
`id · driver_id · suspended_by UUID · suspension_type ENUM(temporary,indefinite,permanent) · reason_category VARCHAR · reason_text TEXT · duration_days INT NULLABLE · starts_at TIMESTAMP · ends_at TIMESTAMP NULLABLE · reinstated_by UUID NULLABLE · reinstated_at TIMESTAMP NULLABLE · hold_payouts BOOLEAN · created_at`

**`safety_incident_assignments`:**
`id · incident_id UUID · admin_id UUID · assigned_at TIMESTAMP · resolved_at TIMESTAMP NULLABLE · resolution_category VARCHAR NULLABLE · resolution_notes TEXT NULLABLE · sla_deadline TIMESTAMP · sla_met BOOLEAN NULLABLE`

---

## API Endpoints

```
-- Driver approval
GET  /admin/drivers/approval-queue?page=
POST /admin/drivers/:id/approve
POST /admin/drivers/:id/decline        { reason }
POST /admin/drivers/:id/request-reupload { documents: [] }

-- Suspensions
POST /admin/drivers/:id/suspend        { type, reason_category, reason, duration_days, hold_payouts }
POST /admin/drivers/:id/reinstate      { reason }
POST /admin/drivers/:id/second-confirm-suspend  { suspension_id }

-- Riders
GET  /admin/riders?badge=&status=&page=
GET  /admin/riders/:id
POST /admin/riders/:id/suspend         { reason }
POST /admin/riders/:id/ban             { reason }   Super Admin token required

-- Safety
GET  /admin/safety/sos-queue
GET  /admin/safety/panic-queue
GET  /admin/safety/incidents?status=&page=
POST /admin/safety/incidents/:id/assign { admin_id }
POST /admin/safety/incidents/:id/resolve { category, notes, recording_disposition }
POST /admin/safety/incidents/:id/escalate-to-sos
POST /admin/safety/incidents/:id/request-911
```

---

## Security Controls

| Control | Rule |
|---|---|
| Suspension > 14 days | Second admin must call `/second-confirm-suspend` from a different session |
| Permanent ban | Super Admin token in header — enforced server-side |
| SOS resolution | Cannot be resolved with category "false_alarm" if recording is active — requires admin note |
| 911 dispatch log | Every dispatch request logged with admin_id, timestamp, GPS at time of request |
| Safety incident history | Immutable after resolution — no edits, append-only notes only |

---

## Continuation Notes — Part 3 Covers

- **A-11** Fraud Detection Center — fraud alert queue, GPS spoofing, payment fraud, investigation flow
- **A-12** Earnings Floor Monitoring — floor utilization, supplement tracking, override controls
- **A-13** Airport Queue Management — EWR queue admin, surge controls, driver position management
- **A-14** Support Ticket Management — ticket queue, SLA tiers, escalation
- **A-15** Rating Dispute Resolution — dispute review, removal criteria
- **A-16** Refund Management — refund tiers, approval workflow
- **A-17** Analytics Dashboard — founder-facing KPI views

---

*BidRide Admin Command Center — Part 2 of 3 — Confidential · Delaware LLC*
