# BidiRide — Admin Command Center v1.0 · Part 1

**Status:** Draft — Pending Founder Approval
**Document:** 07-A · Part 1 of 3
**Platform:** Web application (not mobile) — responsive, desktop-first
**References:** 02-product-requirements-document-v1.md · 00c-trust-score-engine.md · 00d-safety-shield-system.md

> The Admin Command Center is BidiRide's operational nervous system.
> Every admin action is logged. Every safety decision has an audit trail.
> Founder authority is permanent — no admin role can override founder-level controls.

---

## Document Map

| Part | Screens | File |
|---|---|---|
| **Part 1 (this)** | Login · Live Ops · Ride Monitor · Driver Mgmt · Driver Profile | 07-admin-command-center-part1.md |
| Part 2 | Driver Approval · Suspension · Rider Mgmt · Safety Incident Center | 07-admin-command-center-part2.md |
| Part 3 | Fraud · Earnings Floor · Airport Ops · Support · Disputes · Refunds · Analytics | 07-admin-command-center-part3.md |

---

## Admin Role Hierarchy

| Role | Key Permissions | Cannot |
|---|---|---|
| **Founder** | All access; set AI parameters; override any decision | — |
| **Super Admin** | All access; access recordings; VIP manual grants | Override founder decisions |
| **Platform Admin** | Full ops; suspensions; refunds; payouts | Access recordings; change AI params |
| **Safety Admin** | Safety incidents; SOS; panic; account holds | Financial controls; AI params |
| **Operations Admin** | Driver approval; document review; airport ops | Suspensions; financial; AI |
| **Finance Admin** | Earnings floor; refunds; payouts; payout disputes | Account actions; safety; AI |
| **Support Admin** | Support tickets; rating disputes; basic refunds | Suspensions; financial reports; AI |
| **Analytics Admin** | Read-only dashboards and reports | Any write action |

**Role assignment:** Only Founder and Super Admin can assign or revoke roles. All role changes are audit-logged.

---

## Admin Navigation Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  BidiRide Admin            ● Live     Marcus B. (Super Admin)  [Log out]│
├──────────────┬──────────────────────────────────────────────────────┤
│              │                                                      │
│  🏠 Live Ops │  [Main content area — changes with nav selection]    │
│              │                                                      │
│  🗺  Rides   │                                                      │
│              │                                                      │
│  🚗 Drivers  │                                                      │
│     Approval │                                                      │
│     Active   │                                                      │
│     Suspended│                                                      │
│              │                                                      │
│  👤 Riders   │                                                      │
│              │                                                      │
│  🛡 Safety   │                                                      │
│     SOS Queue│                                                      │
│     Incidents│                                                      │
│              │                                                      │
│  🚨 Fraud    │                                                      │
│              │                                                      │
│  💰 Finance  │                                                      │
│     Payouts  │                                                      │
│     Floor    │                                                      │
│     Refunds  │                                                      │
│              │                                                      │
│  ✈  Airport  │                                                      │
│              │                                                      │
│  🎫 Support  │                                                      │
│              │                                                      │
│  📊 Analytics│                                                      │
│              │                                                      │
│  ⚙  Settings │                                                      │
└──────────────┴──────────────────────────────────────────────────────┘
```

**Tech note:** Sidebar persists across all admin screens. Active nav item highlighted in teal. Unread alert counts shown as red badges on Safety and Fraud nav items.

---

## A-01 · Admin Login + MFA

**Purpose:** Secure admin access. All admin accounts require email + password + TOTP (authenticator app). Hardware key (YubiKey) required for Super Admin and Founder.

```
┌─────────────────────────────────────────┐
│            BidiRide Admin                │
│            type-h1 / centered           │
│                                         │
│  Email  ───────────────────────────┐   │
│                                    │   │
│  Password  ────────────────────────┐   │
│                                    │   │
│  [ Sign In ]  Primary button        │   │
│                                         │
│  ─────── Step 2: Authenticator ───────  │
│                                         │
│  Enter the 6-digit code from your      │
│  authenticator app.                     │
│                                         │
│  [ ─ ─ ─ ─ ─ ─ ]  OTP input          │
│                                         │
│  Code expires in 0:24                   │
│  [ Use backup code ]  link              │
└─────────────────────────────────────────┘
```

**Security controls:**
- Failed login lockout: 5 attempts → 30-minute lockout → alert to Founder email
- Session duration: 8 hours (active) / 30-minute idle timeout
- All login events (success and failure) written to `audit_logs` with IP + user agent
- Super Admin + Founder: YubiKey required (FIDO2/WebAuthn) — TOTP alone is insufficient
- Admin accounts cannot be created from within the app — provisioned via CLI by Super Admin

---

## A-02 · Live Operations Dashboard

**Purpose:** Real-time mission control. The first screen after login. Shows the health of the entire marketplace at a glance. Safety alerts always visible.

```
┌──────────────────────────────────────────────────────────────────────┐
│  🏠 Live Operations                     ● Live  Last updated: 0:03  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ ACTIVE   │ │ ONLINE   │ │ REQUESTS │ │ REVENUE  │ │  SAFETY  │  │
│  │  TRIPS   │ │ DRIVERS  │ │ PENDING  │ │  TODAY   │ │  ALERTS  │  │
│  │          │ │          │ │          │ │          │ │          │  │
│  │   47     │ │  203     │ │    8     │ │$4,821.40 │ │ 🔴 1 SOS │  │
│  │ type-h2  │ │ type-h2  │ │ type-h2  │ │ type-h2  │ │ ⚠ 2 CRIT│  │
│  │ text-teal│ │ text-teal│ │ text-gold│ │ text-gold│ │ type-h3  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│                                                                      │
│  ┌──────────────────────────────┐ ┌──────────────────────────────┐  │
│  │  🛡 SAFETY ALERTS            │ │  LIVE MAP                    │  │
│  │                              │ │                              │  │
│  │  🔴 SOS  Trip #8901          │ │  [Map: Newark area]          │  │
│  │  Rider · 9:41 AM · 0:43 ago │ │  Green pins: normal trips    │  │
│  │  Admin: [Assign to me]      │ │  Orange pins: MODERATE alert │  │
│  │  SLA: 47s remaining ████░   │ │  Red pins: CRITICAL/SOS      │  │
│  │  ──────────────────────     │ │  Blue cluster: drivers online│  │
│  │  ⚠ CRITICAL  Trip #8897     │ │                              │  │
│  │  Route deviation · 4:22 ago │ │  [ Satellite ] [ Traffic ]   │  │
│  │  Admin: Sarah K.            │ │                              │  │
│  │  ──────────────────────     │ │                              │  │
│  │  [ View all safety →]       │ │                              │  │
│  └──────────────────────────────┘ └──────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  RECENT ACTIVITY FEED                              [ Pause ] │   │
│  │  9:41  Driver Marcus B. completed trip #8821  +$14.80       │   │
│  │  9:40  Rider Jane D. cancelled before match                  │   │
│  │  9:39  New driver application: Kevin R. — documents pending  │   │
│  │  9:38  Payout processed: $247.80 → Chase ····4812           │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

**Metric cards:** Auto-refresh every 10 seconds via WebSocket. Manual "Refresh now" on click.
**Safety Alerts panel:** Sorted by severity (SOS first), then by SLA urgency. SLA countdown ring turns red at 60s. Clicking any alert navigates directly to that trip's incident screen.
**Live map:** Clusters drivers/trips by proximity. Clicking a pin opens a side panel with trip detail.
**Activity feed:** WebSocket stream. "Pause" stops auto-scroll for admin review. Earnings always gold/JetBrains Mono.

**Security controls:** Dashboard visible to all admin roles. Financial figures (revenue) hidden from Safety Admin and Support Admin roles — shown as "—" with a lock icon.

---

## A-03 · Ride Monitoring

**Purpose:** Full table of all active and recent trips. Admin can search, filter, sort, and drill into any trip. Primary tool for operational oversight.

```
┌──────────────────────────────────────────────────────────────────────┐
│  🗺 Ride Monitoring                                                  │
├──────────────────────────────────────────────────────────────────────┤
│  [ 🔍 Search trip, driver, rider... ]  [Status ▾] [Date ▾] [Export]│
│                                                                      │
│  47 active  ·  1,284 today  ·  Showing: Active                     │
│                                                                      │
│  ┌──────┬──────────┬────────────┬────────────┬──────────┬────────┐  │
│  │Trip# │ Status   │ Driver     │ Rider      │ Fare     │ Action │  │
│  ├──────┼──────────┼────────────┼────────────┼──────────┼────────┤  │
│  │ 8901 │ 🔴 SOS   │ James T.   │ Lisa M.    │ $18.50  │[View]  │  │
│  │ 8897 │ ⚠ CRIT   │ Marcus B.  │ Jess T.    │ $14.80  │[View]  │  │
│  │ 8895 │ ● Active │ Kevin R.   │ Dana L.    │ $22.40  │[View]  │  │
│  │ 8890 │ ● Active │ Sarah J.   │ Mike P.    │ $ 9.60  │[View]  │  │
│  │ 8882 │ ✓ Done   │ Omar F.    │ Priya K.   │ $31.20  │[View]  │  │
│  └──────┴──────────┴────────────┴────────────┴──────────┴────────┘  │
│  Fares: JetBrains Mono · Red rows = active safety events            │
│  [ ← Prev ]  Page 1 of 27  [ Next → ]                              │
└──────────────────────────────────────────────────────────────────────┘
```

**Trip Detail Side Panel (on [View] click — no full page nav):**
```
┌─────────────────────────────────────────┐
│  Trip #8901  ×                          │
│  ─────────────────────────────────────  │
│  Status: 🔴 SOS_ACTIVE                  │
│  Driver: James T. (Trusted) · 4.91 ⭐  │
│  Rider:  Lisa M.  (Verified) · 4.7 ⭐   │
│  Route:  87 Market St → Penn Station    │
│  Fare:   $18.50  ·  Started: 9:38 AM   │
│  ─────────────────────────────────────  │
│  SAFETY STATE: SOS_ACTIVE               │
│  SLA: 0:47 remaining  ████░            │
│  Contacts notified: 2                   │
│  Recording: 🔴 Active                   │
│  ─────────────────────────────────────  │
│  ADMIN ACTIONS                          │
│  [Assign to me] [Call Driver] [Call Rider]│
│  [View on map] [Dispatch 911]           │
│  [Close incident] (requires reason)     │
└─────────────────────────────────────────┘
```

**Status filter options:** All · Active · SOS · Critical · Moderate · Completed · Cancelled · No-show
**Export:** CSV download of filtered results. Available to Platform Admin + Finance Admin + Analytics Admin.

---

## A-04 · Driver Management

**Purpose:** Searchable directory of all drivers. Filter by status, badge, rating, or location. Primary entry point for driver-level admin actions.

```
┌──────────────────────────────────────────────────────────────────────┐
│  🚗 Driver Management                                                │
├──────────────────────────────────────────────────────────────────────┤
│  [ 🔍 Search by name, email, phone, plate... ]                      │
│  [Status ▾] [Badge ▾] [Rating ▾] [Joined ▾]  [ + Filters ] [Export]│
│                                                                      │
│  1,847 drivers total  ·  203 online  ·  12 pending approval         │
│                                                                      │
│  ┌────────────┬───────────┬──────┬────────┬──────────┬───────────┐  │
│  │ Driver     │ Status    │Badge │ Rating │ Trips    │ Action    │  │
│  ├────────────┼───────────┼──────┼────────┼──────────┼───────────┤  │
│  │ Marcus B.  │ ● Online  │Trust.│ 4.91 ⭐│ 247      │[Profile]  │  │
│  │ James T.   │ ● Online  │Verif.│ 4.74 ⭐│  42      │[Profile]  │  │
│  │ Kevin R.   │ ⏳ Pending │ —    │  —     │   0      │[Review]   │  │
│  │ Sarah J.   │ ⚠ At Risk │Trust.│ 4.12 ⭐│  88      │[Profile]  │  │
│  │ Omar F.    │ 🔴 Suspend │Verif.│  —     │  31      │[Profile]  │  │
│  └────────────┴───────────┴──────┴────────┴──────────┴───────────┘  │
│                                                                      │
│  Quick filters: [ Online ] [ Pending ] [ At Risk ] [ Suspended ]    │
└──────────────────────────────────────────────────────────────────────┘
```

**Status badges:** Online (teal) · Offline (gray) · Pending (yellow) · Under Review (blue) · At Risk (amber) · Suspended (red) · Declined (muted)
**Bulk actions:** Select multiple → bulk message, bulk export. Bulk suspend requires Platform Admin + reason.

---

## A-05 · Driver Profile (Admin View)

**Purpose:** Complete driver record. Admin-only data (internal scores, documents, incident history) that is never visible to the driver or any other app. Primary workspace for driver review and action.

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← Drivers  /  Marcus Brown  (Driver #D-00247)                      │
├────────────────────────────┬─────────────────────────────────────────┤
│  PROFILE                   │  ADMIN ACTIONS                         │
│  [photo]  Marcus Brown     │  [ Message Driver ]                    │
│  Trusted · ⭐ 4.91 · 247 trips│  [ Suspend Account ]   Platform Admin+│
│  Joined: Jan 14, 2026      │  [ Override Badge ]     Super Admin    │
│  Newark, NJ                │  [ Access Recording ]   Super Admin    │
│  marcus@email.com          │  [ Add Internal Note ]                 │
│  +1 (973) 555-0192         │  [ View Audit Trail ]                  │
│                            │                                         │
│  INTERNAL TRUST SCORES     │  CURRENT TRIP                         │
│  (never shown to driver)   │  Trip #8821 — Completed               │
│  Trust Score:        784   │  $14.80 earned · 4.2 mi               │
│  Fraud Probability:  2.1%  │                                         │
│  Verif. Confidence:  94%   │  ACTIVE VEHICLE                       │
│  text: JetBrains Mono      │  2021 Toyota Camry · NJA-1234         │
│                            │  Inspection: ✓ Jun 2027               │
│  DOCUMENTS                 │  Insurance:  ✓ Dec 2026               │
│  License:     ✓ Verified   │                                         │
│  Insurance:   ✓ Verified   │  EARNINGS (this week)                 │
│  Registration:✓ Verified   │  $247.80  text-gold/JetBrains         │
│  BG Check:    ✓ Clear      │  Floor supplements: $0.00             │
│  Inspection:  ✓ Jun 2027   │                                         │
│                            │  SAFETY INCIDENTS                     │
│  PERFORMANCE               │  None on record                        │
│  Acceptance:  87%          │                                         │
│  Completion:  98.7%        │  FRAUD FLAGS                          │
│  Standing:    ✓ Good       │  None                                  │
└────────────────────────────┴─────────────────────────────────────────┘
│  INTERNAL NOTES (admin-only)                            [Add note]  │
│  Jun 1 – Sarah K.: Background check cleared, approved.             │
│  May 28 – Auto: License re-verified, AI confidence 94%.           │
└──────────────────────────────────────────────────────────────────────┘
```

**Internal Trust Scores:** Only visible to Platform Admin and above. Never appear in driver-facing API responses. Displayed with a gray background "Admin Only" watermark label above the section.

**Admin Notes:** Timestamped, author-attributed. Cannot be deleted (only appended). Visible to all admin roles for context during reviews.

**Suspend flow:** Clicking [Suspend Account] requires: (1) reason category, (2) written reason (min 50 chars), (3) second admin confirmation if suspension > 14 days. Suspension immediately ends active trips with safety notification to affected riders.

---

## Business Rules

| Rule | Enforcement |
|---|---|
| All admin actions are audit-logged | Every write action writes to `audit_logs` with admin_id, action, target, timestamp, before/after state |
| Safety alerts cannot be dismissed without action | Closing a SOS/CRITICAL incident requires selecting a resolution reason |
| Suspension > 14 days requires two-admin confirmation | Enforced server-side, not just UI — second admin must call a separate API endpoint |
| Internal trust scores never cross API boundary | Separate admin API routes, not exposed on driver/rider API surface |
| Founder decisions cannot be overridden | AI parameter changes, floor formula changes require Founder token in request |
| Revenue figures hidden from Safety + Support admins | Role-based field filtering in the API response |

---

## Database Additions

**`admin_users`** (from PRD §3, extended):
`id · name · email · role ENUM(founder,super_admin,platform_admin,safety_admin,operations_admin,finance_admin,support_admin,analytics_admin) · mfa_type ENUM(totp,yubikey) · last_login_at · is_active · created_by UUID`

**`audit_logs`** (from PRD §13, extended):
`id · admin_id · action VARCHAR · target_type ENUM(driver,rider,trip,payout,incident,document,admin_user) · target_id UUID · before_state JSONB · after_state JSONB · reason TEXT NULLABLE · ip_address · user_agent · created_at`

**`admin_notes`**:
`id · target_type · target_id UUID · admin_id UUID · note TEXT · created_at` (no update/delete — append-only)

---

## API Endpoints

```
-- Auth
POST /admin/auth/login            { email, password }
POST /admin/auth/mfa              { otp | yubikey_response }
POST /admin/auth/logout

-- Live ops
GET  /admin/ops/dashboard         → { active_trips, online_drivers, ... }
GET  /admin/ops/activity-feed     → WebSocket stream

-- Trips
GET  /admin/trips?status=&page=   → paginated trip list
GET  /admin/trips/:id             → full trip detail (admin fields included)
POST /admin/trips/:id/assign-self → assign safety incident to calling admin

-- Drivers
GET  /admin/drivers?status=&badge=&page=
GET  /admin/drivers/:id           → full driver profile (internal scores included)
POST /admin/drivers/:id/suspend   { reason_category, reason, duration_days }
POST /admin/drivers/:id/reinstate { reason }
POST /admin/drivers/:id/message   { subject, body }
POST /admin/drivers/:id/notes     { note }
```

---

## Security Controls

| Control | Implementation |
|---|---|
| MFA required for all admin accounts | Enforced at login — no session issued without MFA |
| YubiKey for Super Admin + Founder | FIDO2/WebAuthn hardware key — cannot be bypassed |
| Session idle timeout: 30 min | Server-side session invalidation, not just client cookie |
| Admin API separate from driver/rider API | Different base URL, different auth middleware, different rate limits |
| Internal scores never in driver API | Separate DB query path, separate serializer — no shared response object |
| Audit log immutable | `audit_logs` table: no UPDATE or DELETE grants on DB user used by API |
| Role-based field filtering | Response serializer checks admin role before including financial fields |

---

## Continuation Notes — Part 2 Covers

- **A-06** Driver Approval Queue — document review, checklist, approve/decline workflow
- **A-07** Driver Suspension System — suspension types, duration rules, appeal flow
- **A-08** Rider Management — rider list, profile, ban flow
- **A-09** Safety Incident Center — SOS queue, panic queue, incident lifecycle, dispatch
- **A-10** Safety Command Center — A-25/A-26/A-29/A-30 from 00d safety spec

---

*BidiRide Admin Command Center — Part 1 of 3 — Confidential · Delaware LLC*
