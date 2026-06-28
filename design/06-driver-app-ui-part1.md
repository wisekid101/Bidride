# BidiRide — Driver App UI v1.0 · Part 1: Onboarding

**Status:** Draft — Pending Founder Approval
**Document:** 06-A of 10 (Driver App — Part 1 of 4)
**Prepared by:** Claude Code (Senior UX Architect / AI Systems Engineer)
**Date:** June 6, 2026
**References:** 03-design-system.md · 04-component-library.md · 02-product-requirements-document-v1.md · 00c-trust-score-engine.md · 00d-safety-shield-system.md

> Every driver-facing screen in the onboarding flow is defined here with wireframes,
> component references, state management, edge cases, and error states.
> Parts 2–4 cover the full driver operational experience.

---

## Document Map

| Part | Contents | File |
|---|---|---|
| **Part 1 (this file)** | Onboarding · License · Insurance · Vehicle Inspection | 06-driver-app-ui-part1.md |
| Part 2 | Home · Availability · Ride Request · Trip Lifecycle | 06-driver-app-ui-part2.md |
| Part 3 | Earnings · Wallet · Payouts · Airport Queue | 06-driver-app-ui-part3.md |
| Part 4 | Safety Shield · Profile · Vehicle Mgmt · Rewards · Flows | 06-driver-app-ui-part4.md |

---

## Design Constants (Driver App)

All driver screens apply these rules. No exceptions.

| Token | Value | Usage |
|---|---|---|
| `bg-primary` | `#0A2342` | All screen backgrounds |
| `bg-secondary` | `#0F2D52` | Cards, sheets, elevated surfaces |
| `brand-teal` | `#00D4C6` | Primary buttons, online status, AI data |
| `brand-gold` | `#F4B400` | All earnings, payouts, rewards — NOWHERE ELSE |
| `brand-red` | `#EF4444` | SOS, alerts, offline status |
| `text-primary` | `#FFFFFF` | Body text on dark backgrounds |
| `text-secondary` | `#B0BEC5` | Supporting text, labels, placeholders |
| `text-earnings` | `#F4B400` | All currency amounts on driver-facing screens |
| `font-body` | Inter | All non-financial text |
| `font-mono` | JetBrains Mono | Every earnings, fare, and payout figure |
| `spacing-base` | 4px | Minimum spacing unit |
| `radius-button` | 12px | Standard button corners |
| `radius-card` | 16px | Card and sheet corners |

**Critical rules:**
- Gold (`#F4B400`) appears ONLY when displaying money the driver earns or has earned
- White text on Teal FAILS WCAG AA — always use Navy (`#0A2342`) as text color on Teal backgrounds
- The SOS button must be visible at `z-index: max` on every in-trip screen
- Driver earnings amounts are ALWAYS displayed in JetBrains Mono, never Inter

---

## Onboarding Screen Index (Part 1)

| Screen ID | Name | PRD Ref |
|---|---|---|
| DS-001 | Driver Splash | D-01 |
| DS-002 | Driver Value Prop Carousel | D-02 |
| DS-003 | Create Account | D-03 |
| DS-004 | Phone OTP Verification | D-04 |
| DS-005 | Email Verification | D-04 |
| DS-006 | Personal Info Setup | D-05 |
| DS-007 | Driver's License Upload | D-06 |
| DS-008 | License AI Review State | D-06 |
| DS-009 | Background Check Consent | D-09 |
| DS-010 | Insurance Document Upload | D-07 |
| DS-011 | Vehicle Registration Upload | D-08 |
| DS-012 | Vehicle Details Form | D-08 |
| DS-013 | Vehicle Inspection Checklist | D-10 |
| DS-014 | Inspection Photo Capture | D-10 |
| DS-015 | Profile Photo | D-05 |
| DS-016 | Bank Account Setup | D-11 |
| DS-017 | Application Submitted — Pending | D-12 |
| DS-018 | Application Approved | D-13 |

---

## 1. Onboarding Flow

### DS-001 · Driver Splash Screen

**Purpose:** First frame the driver sees. Establishes brand + driver identity while the app initializes.

```
╔══════════════════════════════════════════╗
║                                          ║
║                                          ║
║                                          ║
║                                          ║
║              BidiRide                     ║
║         type-display / text-teal         ║
║                                          ║
║            for Drivers                   ║
║        type-caption / text-gold          ║
║                                          ║
║        ◐  (loading spinner, sm)          ║
║        text-secondary                    ║
║                                          ║
║                                          ║
║  bg: bg-charcoal (#0F1923)               ║
║  Full screen — no status bar content     ║
╚══════════════════════════════════════════╝
```

**Components:** C-008 (Loading Spinner)
**Duration:** 1.5–2.5 seconds (varies with load time)

**Navigation:**
- New user → DS-002 (Value Prop Carousel)
- Returning authenticated driver, approved → DS-019 (Driver Home — Offline)
- Returning authenticated driver, pending → DS-017 (Application Pending)
- Returning unauthenticated → DS-003 Login (same form as Create Account, with tab)

**Edge Cases:**
- No internet connection: show "No connection — check your network" with a Retry button after 5 seconds
- App update required: show "A new version is available" with Update button (deep-links to App Store / Play Store); old version cannot proceed past this screen after a breaking update
- Session expired: clear local auth token, route to DS-003 (login tab active)

---

### DS-002 · Driver Value Prop Carousel

**Purpose:** Communicate BidiRide's four driver-specific promises before asking for any information. Sets expectations for earnings, flexibility, safety, and AI support.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║                    [ Skip ]              ║
║                    text-secondary link   ║
║                                          ║
║  ╔══════════════════════════════════╗    ║
║  ║                                  ║    ║
║  ║   [Illustration: Driver, phone,  ║    ║
║  ║    gold earnings card, premium   ║    ║
║  ║    vehicle — confident posture]  ║    ║
║  ║                                  ║    ║
║  ╚══════════════════════════════════╝    ║
║                                          ║
║       You Keep More.                     ║
║       type-h1 / text-primary             ║
║                                          ║
║  BidiRide AI guarantees you take home     ║
║  70–80% of every fare. Always.           ║
║  type-body / text-secondary / centered   ║
║                                          ║
║          ● ○ ○ ○                         ║
║      progress dots / teal active         ║
║                                          ║
║  ──────────────────────────────────      ║
║                                          ║
║       [ Get Started ]                    ║
║       Primary button / bg-teal           ║
║                                          ║
║       Already driving?  [ Sign In ]      ║
║       text-secondary / text-teal link    ║
╚══════════════════════════════════════════╝
```

**Slides:**

| Slide | Headline | Subtext | Illustration concept |
|---|---|---|---|
| 1 | You Keep More. | BidiRide AI guarantees 70–80% of every fare. Always. | Driver + gold earnings card |
| 2 | Drive on Your Schedule. | Go online when you want. Go offline when you don't. Zero penalties. | Driver with phone toggle |
| 3 | Safety on Every Ride. | SOS, live monitoring, trusted contacts — we watch every trip. | Shield icon, safety features |
| 4 | AI That Works for You. | Surge predictions, airport queues, demand heatmaps — built for drivers. | Phone with demand heatmap |

**Components:** C-009 (Progress Dots), C-001 (Primary Button), C-005 (Text Link)
**Behavior:** Swipeable left/right. Skip routes to DS-003 (Create Account tab). Get Started on any slide routes to DS-003. Sign In tab is present within DS-003.

---

### DS-003 · Create Account

**Purpose:** Create a new driver account. Tab-based form with "Create Account" and "Sign In" tabs so returning drivers don't need a separate screen.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║          BidiRide for Drivers             ║
║          type-h2 / text-primary          ║
║                                          ║
║  ┌──────────────────┬──────────────────┐ ║
║  │  Create Account  │    Sign In       │ ║
║  │  (active/teal)   │ (inactive/muted) │ ║
║  └──────────────────┴──────────────────┘ ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Full Legal Name                   │  ║
║  │  (as it appears on your license)   │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Email Address                     │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Mobile Number  +1 (___) ___-____  │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Password  (min 8 chars)           │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ☐  I agree to the Driver Terms of      ║
║     Service and Privacy Policy           ║
║                                          ║
║  [ Continue ]  Primary button            ║
║                                          ║
║  Already approved?  Drive in NJ?         ║
║  Apply online at bidiride.com/drive       ║
║  text-caption / text-muted               ║
╚══════════════════════════════════════════╝
```

**Sign In Tab (same screen, different content):**

```
  ┌────────────────────────────────────┐
  │  Email or Phone                    │
  └────────────────────────────────────┘

  ┌────────────────────────────────────┐
  │  Password                          │
  └────────────────────────────────────┘

  Forgot password?  →  DS-003a (reset)

  [ Sign In ]  Primary button

  Don't have an account?  [ Create one ]
  → switches to Create Account tab
```

**Components:** C-011 (Tab Navigation), C-019 (Form Input), C-021 (Checkbox), C-001 (Primary Button)

**Validation:**
- Full Name: minimum 2 words, letters only (hyphens allowed)
- Email: RFC-compliant format
- Phone: US format, 10 digits, no VoIP numbers (carrier check)
- Password: minimum 8 characters, at least one number
- Terms checkbox: required — Continue button disabled until checked

**On Submit:**
- Phone OTP dispatched via SMS
- Advance to DS-004 (OTP verification)
- Duplicate email: show inline error "An account with this email exists — sign in instead"
- Duplicate phone: show inline error + link to sign-in

---

### DS-003a · Forgot Password

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Back                                 ║
║                                          ║
║          Reset Password                  ║
║          type-h2 / text-primary          ║
║                                          ║
║  Enter your email and we'll send a       ║
║  link to reset your password.            ║
║  type-body / text-secondary              ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Email Address                     │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  [ Send Reset Link ]  Primary button     ║
║                                          ║
║  Link expires after 30 minutes.          ║
║  text-caption / text-muted               ║
╚══════════════════════════════════════════╝
```

**States:** idle → sending → sent (success: "Check your email") → error

---

### DS-004 · Phone OTP Verification

**Purpose:** Confirm driver's mobile number via one-time passcode. Protects against fake accounts and ensures a real phone number is on file.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║          Verify Your Number              ║
║          type-h2 / text-primary          ║
║                                          ║
║  We sent a 6-digit code to               ║
║  +1 (973) 555-0192                       ║
║  type-body / text-secondary              ║
║                                          ║
║  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ║
║  │    │ │    │ │    │ │    │ │    │ │    │ ║
║  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ ║
║  6-digit OTP input / JetBrains Mono      ║
║  Auto-submits on 6th digit               ║
║                                          ║
║  Resend code in  0:24                    ║
║  text-caption / text-muted               ║
║  (becomes "Resend code" link after 30s)  ║
║                                          ║
║  Wrong number?  [ Change it ]            ║
║  text-teal link → back to DS-003         ║
╚══════════════════════════════════════════╝
```

**Components:** C-022 (OTP Input — 6 digit), C-008 (Loading Spinner for auto-submit)

**States:**

| State | UI |
|---|---|
| Idle | Empty boxes, resend countdown active |
| Entry in progress | Filled boxes, active box has teal border |
| Submitting | Spinner overlay, boxes disabled |
| Success | All boxes teal fill → auto-advance to DS-005 |
| Error (wrong code) | All boxes red border, shake animation, "Incorrect code — try again" below |
| Expired (5 min) | "This code has expired" — resend link active immediately |
| Locked (5 failures) | "Too many attempts. Try again in 10 minutes." — resend disabled |

**Auto-submit:** As soon as the 6th digit is entered, form auto-submits. No manual "Confirm" button needed.

**SMS content:** "Your BidiRide driver verification code is: 847291. Expires in 5 minutes. Do not share this code."

---

### DS-005 · Email Verification

**Purpose:** Confirm the email address. Required before document submission can proceed.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║          Check Your Email                ║
║          type-h2 / text-primary          ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ✉  [Illustration — email icon] │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  We sent a verification link to          ║
║  m.brown@email.com                       ║
║  type-body / text-teal (email address)   ║
║                                          ║
║  Open your email and tap the link        ║
║  to verify your address.                 ║
║  type-body / text-secondary              ║
║                                          ║
║  [ Open Mail App ]  Secondary button     ║
║                                          ║
║  Didn't get it?  [ Resend email ]        ║
║  text-teal link (active after 30s)       ║
║                                          ║
║  ──────────────────────────────────      ║
║                                          ║
║  [ I'll verify later ]                   ║
║  Ghost button / text-secondary           ║
║  (documents cannot be uploaded until     ║
║   email is verified — banner shown)      ║
╚══════════════════════════════════════════╝
```

**Components:** C-001 (Primary), C-002 (Secondary), C-005 (Link)

**Behavior:**
- "I'll verify later" → advances to DS-006 (Personal Info) with a persistent yellow banner: "Verify your email to continue document submission"
- Email verified in background (driver clicked link in another app) → banner clears automatically, deep link returns driver to correct step
- Email deep link format: `bidiride.com/driver/verify-email?token=xxxxx`

---

### DS-006 · Personal Info Setup

**Purpose:** Collect personal details required for background check and driver identity verification.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║  Step 1 of 6                             ║
║  ●●○○○○  progress / teal                 ║
║                                          ║
║       Personal Information               ║
║       type-h2 / text-primary             ║
║                                          ║
║  Required for driver verification        ║
║  and background check.                   ║
║  type-body / text-secondary              ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Legal First Name                  │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Legal Last Name                   │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Date of Birth    MM / DD / YYYY   │  ║
║  └────────────────────────────────────┘  ║
║  Minimum age: 21 years (NJ TNC law)      ║
║  text-caption / text-muted               ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Home Address (Street)             │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ┌──────────────────┐  ┌─────────────┐  ║
║  │  City            │  │  State      │  ║
║  └──────────────────┘  └─────────────┘  ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  ZIP Code                          │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  [ Continue ]  Primary button            ║
╚══════════════════════════════════════════╝
```

**Components:** C-019 (Form Input), C-020 (Date Picker), C-023 (State Selector Dropdown), C-001 (Primary Button)

**Validation rules:**

| Field | Rule |
|---|---|
| First / Last Name | Letters, hyphens, apostrophes only. Must match license (validated later). |
| Date of Birth | Must be ≥ 21 years old (NJ TNC minimum). If under 21: show "BidiRide drivers must be at least 21 years old in New Jersey." |
| Address | Valid US address, ZIP validated against USPS |
| State | Pre-selected to NJ for Newark launch; other states shown but flagged as "Coming soon — not yet available" |

**Edge Cases:**
- Under-21 applicant: cannot proceed — shown a polite rejection message and a "Notify me when BidiRide launches in my area" email capture
- Address entered outside NJ: shown "BidiRide is currently live in Newark, NJ. We'll notify you when we expand to [state]."

---

## 2. Driver's License Verification

### DS-007 · Driver's License Upload

**Purpose:** Collect and verify the driver's license. AI reads license data and pre-fills form fields. Admin performs final review.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║  Step 2 of 6                             ║
║  ●●●○○○  progress / teal                 ║
║                                          ║
║       Driver's License                   ║
║       type-h2 / text-primary             ║
║                                          ║
║  Upload a clear photo of the FRONT       ║
║  and BACK of your driver's license.      ║
║  type-body / text-secondary              ║
║                                          ║
║  ╔══════════════════════════════════╗    ║
║  ║                                  ║    ║
║  ║   [ FRONT ]                      ║    ║
║  ║                                  ║    ║
║  ║   📷  Tap to take photo          ║    ║
║  ║      or upload from camera roll  ║    ║
║  ║                                  ║    ║
║  ║  border-dashed / text-muted      ║    ║
║  ╚══════════════════════════════════╝    ║
║                                          ║
║  ╔══════════════════════════════════╗    ║
║  ║                                  ║    ║
║  ║   [ BACK ]                       ║    ║
║  ║                                  ║    ║
║  ║   📷  Tap to take photo          ║    ║
║  ║      or upload from camera roll  ║    ║
║  ║                                  ║    ║
║  ╚══════════════════════════════════╝    ║
║                                          ║
║  Tips for a good photo:                  ║
║  • Lay license on a flat dark surface   ║
║  • Ensure all 4 corners are visible     ║
║  • No glare or blur                     ║
║  text-caption / text-muted               ║
║                                          ║
║  [ Continue ]  Primary button            ║
║  (disabled until both sides uploaded)    ║
╚══════════════════════════════════════════╝
```

**Components:** C-024 (Document Upload Zone), C-025 (Camera Capture Modal), C-001 (Primary Button)

**Upload States per photo zone:**

| State | Visual |
|---|---|
| Empty | Dashed border, camera icon, upload text |
| Uploading | Progress spinner, "Uploading…" text |
| Uploaded | Photo thumbnail displayed, teal checkmark, "Retake" link |
| Error | Red border, "Upload failed — tap to retry" |

**On Continue:**
- Both images uploaded → advance to DS-008 (AI processing)
- AI service begins OCR + license validation in background

**File requirements:**
- Accepted formats: JPEG, PNG, HEIF
- Maximum size: 10MB per image
- Minimum resolution: 800×500px

---

### DS-008 · License AI Review State

**Purpose:** Show the driver that BidiRide's AI is reviewing their license. Confirm the extracted data before proceeding.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║          Verifying License...            ║
║          type-h2 / text-primary          ║
║                                          ║
║      ◐  (animated spinner — teal)        ║
║                                          ║
║  Our AI is reviewing your license.       ║
║  This takes about 10–30 seconds.         ║
║  type-body / text-secondary / centered   ║
║                                          ║
║  ─────────── (processing) ───────────    ║
║  [animated progress bar, teal fill]      ║
╚══════════════════════════════════════════╝
```

**After AI processing — confirm extracted data:**

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║  ✓  License Read Successfully            ║
║  type-h2 / text-teal                     ║
║                                          ║
║  Confirm your details:                   ║
║  type-body / text-secondary              ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Name:     Marcus A. Brown        │  ║
║  │  License:  NJ · D12345678         │  ║
║  │  DOB:      MM/DD/YYYY             │  ║
║  │  Expiry:   MM/DD/YYYY             │  ║
║  │  Class:    D (standard)           │  ║
║  │  State:    New Jersey             │  ║
║  └────────────────────────────────────┘  ║
║  bg-secondary / text-primary             ║
║                                          ║
║  ⚠  If anything looks wrong, tap        ║
║  "Edit" to correct it.                  ║
║  text-caption / text-amber               ║
║                                          ║
║  [ This looks correct — Continue ]       ║
║  Primary button                          ║
║                                          ║
║  [ Something is wrong — Edit ]           ║
║  Ghost button → opens editable fields   ║
╚══════════════════════════════════════════╝
```

**AI Processing States:**

| Outcome | Next Screen | Admin Action |
|---|---|---|
| High confidence read (≥ 85%) | Show extracted data, driver confirms | Admin spot-checks 10% of confirmed licenses |
| Low confidence (50–84%) | Show "We couldn't read all details" — driver manually enters fields | Admin reviews all low-confidence reads |
| Failed / unreadable (< 50%) | Show "We couldn't read this license — please retake" | Driver re-uploads; after 2 failures, admin manually processes |
| Expired license | Show "Your license is expired. Update it and re-upload." — cannot proceed | N/A |
| License not from recognized US state | Show "We only accept US licenses at this time." | N/A |
| License name mismatch with account name | Flag for admin review; driver notified "We'll verify your details — this may take 1 business day" | Admin compares license name to account name |

**Expiry warning:** If license expires within 60 days, show: "Your license expires soon. You can continue now, but you'll need to re-upload before it expires."

---

### DS-009 · Background Check Consent

**Purpose:** Obtain explicit informed consent for the background check before it is initiated. Required by law.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║  Step 3 of 6                             ║
║  ●●●●○○  progress / teal                 ║
║                                          ║
║       Background Check                   ║
║       type-h2 / text-primary             ║
║                                          ║
║  BidiRide partners with [Checkr] to run   ║
║  a standard background check. This is   ║
║  required for all drivers.               ║
║  type-body / text-secondary              ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  What we check:                  │    ║
║  │  • Criminal history (7 years)    │    ║
║  │  • Motor vehicle record          │    ║
║  │  • Sex offender registry         │    ║
║  │  • Global watchlist screening    │    ║
║  │                                  │    ║
║  │  What we don't use:              │    ║
║  │  • Credit score                  │    ║
║  │  • Medical records               │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / text-secondary           ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Timeline: 3–7 business days     │    ║
║  │  You'll be notified by email     │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / text-secondary           ║
║                                          ║
║  ☐  I consent to a background check     ║
║     and authorize BidiRide and Checkr    ║
║     to access my records.               ║
║                                          ║
║  [ Read Full Disclosure ]               ║
║  text-teal link → modal (FCRA notice)   ║
║                                          ║
║  [ Authorize & Continue ]               ║
║  Primary button (disabled until checked) ║
╚══════════════════════════════════════════╝
```

**Components:** C-021 (Checkbox), C-026 (Info Card), C-001 (Primary Button)

**Legal requirements:**
- FCRA disclosure must be provided in writing before the check is ordered
- Driver must explicitly check the consent box — pre-checked boxes are illegal under FCRA
- Full disclosure document available as a modal (not an external link — must be accessible in-app)
- Consent timestamp and IP address logged to `driver_documents` table

**On Authorize & Continue:**
- Background check order submitted to Checkr API
- Driver advances to DS-010 (Insurance Upload)
- Background check runs asynchronously — does NOT block remaining upload steps
- Driver notified via email and push notification when result is available

**Background check outcomes (handled in DS-017 pending screen):**

| Outcome | Action |
|---|---|
| Clear | Auto-advance to document review queue — admin approves |
| Consider (MVR issues) | Admin manual review required — driver notified it may take longer |
| Adverse action | Admin reviews, driver notified with adverse action letter per FCRA |
| Dispute | Driver may dispute with Checkr — BidiRide holds application |

---

## 3. Insurance Upload

### DS-010 · Insurance Document Upload

**Purpose:** Collect proof of personal auto insurance. Required for all drivers. Commercial rideshare endorsement check is also flagged here.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║  Step 4 of 6                             ║
║  ●●●●●○  progress / teal                 ║
║                                          ║
║       Auto Insurance                     ║
║       type-h2 / text-primary             ║
║                                          ║
║  Upload your current insurance card      ║
║  or declarations page.                   ║
║  type-body / text-secondary              ║
║                                          ║
║  ╔══════════════════════════════════╗    ║
║  ║                                  ║    ║
║  ║   📋  Insurance Card or          ║    ║
║  ║       Declarations Page          ║    ║
║  ║                                  ║    ║
║  ║   📷  Take photo or upload PDF   ║    ║
║  ║                                  ║    ║
║  ╚══════════════════════════════════╝    ║
║  border-dashed / text-muted              ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ⚡ Rideshare Coverage Notice    │    ║
║  │                                  │    ║
║  │  NJ law requires that your       │    ║
║  │  insurer knows you drive for a   │    ║
║  │  TNC. Some policies require a    │    ║
║  │  rideshare endorsement.          │    ║
║  │                                  │    ║
║  │  BidiRide provides coverage       │    ║
║  │  during Period 2 & 3.            │    ║
║  │  [ Learn more ]  text-teal link  │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / border-l: teal           ║
║                                          ║
║  ☐  My insurance is current and         ║
║     covers my vehicle for personal       ║
║     use.                                 ║
║                                          ║
║  [ Continue ]  Primary button            ║
╚══════════════════════════════════════════╝
```

**Components:** C-024 (Document Upload Zone), C-026 (Info Card), C-021 (Checkbox)

**Insurance Coverage Periods (informational — shown in "Learn more" modal):**

| Period | When | Coverage Provider |
|---|---|---|
| Period 1 | App on, no ride accepted | Driver's personal insurance |
| Period 2 | Ride accepted → pickup | BidiRide commercial policy |
| Period 3 | Passenger in vehicle | BidiRide commercial policy |
| Off | App off | Driver's personal insurance |

**AI Insurance Extraction:** AI reads the uploaded document and extracts:
- Insured name (compared to driver name on file)
- Policy number
- Coverage expiry date
- Vehicle covered (compared to registered vehicle)

**Validation outcomes:**

| Check | Pass | Fail |
|---|---|---|
| Name match | Proceeds | Flag for admin review |
| Not expired | Proceeds | Show "Your insurance has expired — renew before continuing" |
| Vehicle match | Proceeds | Flag for admin review |
| Coverage type | Noted (personal vs. commercial) | Not a blocker — informational only |

**Accepted file types:** JPEG, PNG, PDF (max 15MB)

**Expiry warning:** If insurance expires within 30 days: "Your insurance expires soon. You'll need to update it before driving."

---

### DS-011 · Vehicle Registration Upload

**Purpose:** Verify the driver's vehicle registration to confirm ownership and vehicle details.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║  Step 4 of 6 (continued)                 ║
║  ●●●●●○  progress / teal                 ║
║                                          ║
║       Vehicle Registration               ║
║       type-h2 / text-primary             ║
║                                          ║
║  Upload your current vehicle             ║
║  registration.                           ║
║  type-body / text-secondary              ║
║                                          ║
║  ╔══════════════════════════════════╗    ║
║  ║                                  ║    ║
║  ║   📋  Vehicle Registration       ║    ║
║  ║                                  ║    ║
║  ║   📷  Take photo or upload PDF   ║    ║
║  ║                                  ║    ║
║  ╚══════════════════════════════════╝    ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Vehicle must be:                │    ║
║  │  • Model year 2008 or newer      │    ║
║  │  • 4-door sedan, SUV, or minivan │    ║
║  │  • Licensed and registered in NJ │    ║
║  │  • Passing NJ state inspection   │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / text-secondary           ║
║                                          ║
║  [ Continue ]  Primary button            ║
╚══════════════════════════════════════════╝
```

**After registration upload — vehicle details are extracted and shown for confirmation (same pattern as DS-008).**

**Ineligible vehicles:**
- 2-door vehicles → "BidiRide requires a 4-door vehicle for passenger safety"
- Commercial vehicles, trucks → "This vehicle type is not eligible"
- Model year before 2008 → "Your vehicle must be 2008 or newer"
- Salvage title → "Vehicles with salvage titles are not eligible"

---

### DS-012 · Vehicle Details Form

**Purpose:** Confirm vehicle details and fill in any fields the AI couldn't extract from the registration.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║       Confirm Vehicle Details            ║
║       type-h2 / text-primary             ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Make          Toyota              │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Model         Camry               │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Year          2021                │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Color         ▣  Silver           │  ║
║  └────────────────────────────────────┘  ║
║  (color picker — 12 standard options)    ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  License Plate   NJA-1234          │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  VIN  (optional — speeds review)   │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  Ride Types This Vehicle Qualifies For:  ║
║  ✓ BidiRide Standard                     ║
║  ✗ BidiRide Priority (need 2019+)        ║
║  ✗ BidiRide Premium (separate approval)  ║
║  text-caption / green / muted            ║
║                                          ║
║  [ Confirm & Continue ]                  ║
╚══════════════════════════════════════════╝
```

**Components:** C-019 (Form Input), C-027 (Color Picker), C-028 (Ride Type Eligibility Card)

**Ride type eligibility logic:**

| Vehicle requirement | Standard | Priority | Premium |
|---|---|---|---|
| Model year | 2008+ | 2019+ | 2020+ (luxury only) |
| Door count | 4 | 4 | 4 |
| Condition | Good | Good | Excellent |
| Make/model | Any eligible | Any eligible | Pre-approved list |

**Color picker options:** Black, White, Silver, Gray, Blue, Red, Green, Gold, Brown, Orange, Yellow, Other

---

## 4. Vehicle Inspection

### DS-013 · Vehicle Inspection Checklist

**Purpose:** Guide the driver through a structured self-inspection. Drivers take photos and answer checklist questions. Admin reviews the submission.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║  Step 5 of 6                             ║
║  ●●●●●●  progress / teal                 ║
║                                          ║
║       Vehicle Inspection                 ║
║       type-h2 / text-primary             ║
║                                          ║
║  Take photos and answer questions        ║
║  about your vehicle. Our team reviews    ║
║  each submission within 24 hours.        ║
║  type-body / text-secondary              ║
║                                          ║
║  ──────────────────────────────────      ║
║                                          ║
║  EXTERIOR PHOTOS                         ║
║  type-label / text-teal / uppercase      ║
║                                          ║
║  ┌─────────────────────┬──────────────┐  ║
║  │  📷 Front           │ 📷 Back      │  ║
║  │  [ Take photo ]     │ [ Take ]     │  ║
║  └─────────────────────┴──────────────┘  ║
║                                          ║
║  ┌─────────────────────┬──────────────┐  ║
║  │  📷 Driver Side     │ 📷 Pass Side │  ║
║  │  [ Take photo ]     │ [ Take ]     │  ║
║  └─────────────────────┴──────────────┘  ║
║                                          ║
║  INTERIOR PHOTOS                         ║
║  type-label / text-teal / uppercase      ║
║                                          ║
║  ┌─────────────────────┬──────────────┐  ║
║  │  📷 Front Seats     │ 📷 Back Seats│  ║
║  │  [ Take photo ]     │ [ Take ]     │  ║
║  └─────────────────────┴──────────────┘  ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  📷 Dashboard & Odometer           │  ║
║  │  [ Take photo ]                    │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ──────────────────────────────────      ║
║                                          ║
║  SAFETY CHECKLIST                        ║
║  type-label / text-teal / uppercase      ║
║                                          ║
║  Answer Yes or No for each item:         ║
║                                          ║
║  ☐  All 4 seatbelts work correctly      ║
║  ☐  Air conditioning works              ║
║  ☐  Heating works                       ║
║  ☐  All windows open and close          ║
║  ☐  No warning lights on dashboard      ║
║  ☐  Horn works                          ║
║  ☐  All exterior lights work            ║
║                                          ║
║  0 of 7 completed                        ║
║  text-caption / text-muted               ║
║                                          ║
║  [ Submit Inspection ]                   ║
║  Primary button                          ║
║  (disabled until all 7 photos + all      ║
║   checklist items answered)              ║
╚══════════════════════════════════════════╝
```

**Components:** C-024 (Document Upload Zone — 7 zones), C-029 (Checklist Item), C-001 (Primary Button)

**Photo requirements:**

| Photo | Content required |
|---|---|
| Front exterior | Full front bumper, headlights, license plate visible |
| Rear exterior | Full rear, taillights, license plate visible |
| Driver side | Full side profile from front wheel to rear |
| Passenger side | Full side profile |
| Front interior | Both front seats, no major damage, clean |
| Rear interior | Both rear seats, clean, all seatbelts visible |
| Dashboard | Odometer visible, no warning lights |

**AI pre-screening on photo submission:**
- AI checks that photo is of the correct subject (front of car vs. random photo)
- AI detects obvious red flags: airbags deployed, major body damage, salvage car appearance
- Low-confidence or flagged photos are held for admin review with reason

**Checklist item "No warning lights":**
- If driver answers "No" (warning lights ARE present): show "A check engine or other warning light may indicate a safety issue. You can still apply — our team will review your submission and may ask for more information."

---

### DS-014 · Inspection Photo Capture

**Purpose:** In-app camera with overlay guides for each photo type. Reduces bad photo submissions by showing the driver exactly what to frame.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║  ✕  Cancel          Front Exterior       ║
║                   type-h3 / text-primary ║
║                                          ║
║  ╔══════════════════════════════════╗    ║
║  ║  ┌──────────────────────────┐   ║    ║
║  ║  │                          │   ║    ║
║  ║  │   [camera viewfinder]    │   ║    ║
║  ║  │                          │   ║    ║
║  ║  │   ┌──────────────────┐   │   ║    ║
║  ║  │   │  Frame your car  │   │   ║    ║
║  ║  │   │  within the box  │   │   ║    ║
║  ║  │   └──────────────────┘   │   ║    ║
║  ║  │   (dashed box overlay)   │   ║    ║
║  ║  └──────────────────────────┘   ║    ║
║  ╚══════════════════════════════════╝    ║
║                                          ║
║  Position your car so the entire         ║
║  front is visible in the frame.          ║
║  type-caption / text-secondary           ║
║                                          ║
║         [ 📷 Take Photo ]               ║
║         large round button / teal        ║
║                                          ║
║  [ Upload from Camera Roll ]             ║
║  text-teal link                          ║
╚══════════════════════════════════════════╝
```

**Photo taken → preview + confirm:**

```
╔══════════════════════════════════════════╗
║  ←  Retake           Use Photo           ║
╠══════════════════════════════════════════╣
║                                          ║
║  [Full photo preview fills the screen]   ║
║                                          ║
║  ╔══════════════════════════════════╗    ║
║  ║                                  ║    ║
║  ║   [Photo preview]                ║    ║
║  ║                                  ║    ║
║  ╚══════════════════════════════════╝    ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ✓  Photo looks clear           │    ║
║  │     AI pre-check passed         │    ║
║  └──────────────────────────────────┘    ║
║  bg: teal-10% / text-teal                ║
║                                          ║
║  [ Use Photo ]  Primary button           ║
║  [ Retake ]     Ghost button             ║
╚══════════════════════════════════════════╝
```

**AI pre-check feedback on photo capture:**

| Check | Pass | Fail UI |
|---|---|---|
| Subject matches (car front) | "Photo looks clear" | "This doesn't look like the front of a vehicle — try again" |
| Not blurry | Pass | "Photo is blurry — try again in better light" |
| Not too dark | Pass | "Too dark — move to a better-lit area" |
| Plate visible (for front/back) | Pass | "License plate isn't visible — make sure it's in frame" |

---

## 5. Profile, Bank Account & Submission

### DS-015 · Profile Photo

**Purpose:** Driver profile photo. Used on the Rider App to build trust. Required — not skippable.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║  Step 5 of 6 (continued)                 ║
║                                          ║
║       Add a Profile Photo                ║
║       type-h2 / text-primary             ║
║                                          ║
║  Your photo helps riders recognize       ║
║  you when they board.                    ║
║  type-body / text-secondary              ║
║                                          ║
║         ╔════════════╗                   ║
║         ║            ║                   ║
║         ║   [ 👤 ]   ║                   ║
║         ║            ║                   ║
║         ╚════════════╝                   ║
║         128×128px circle avatar          ║
║         border: 2px teal dashed          ║
║                                          ║
║  [ Take Selfie ]  Primary button         ║
║  [ Upload Photo ] Secondary button       ║
║                                          ║
║  Photo requirements:                     ║
║  • Must show your full face              ║
║  • No sunglasses                         ║
║  • Well lit                              ║
║  • No other people in the photo          ║
║  text-caption / text-muted               ║
╚══════════════════════════════════════════╝
```

**Photo approved state (after upload):**

```
  ╔════════════╗
  ║            ║
  ║  [photo]   ║
  ║            ║
  ╚════════════╝
  ✓ Photo received — our team will review it.
  text-teal

  [ Use This Photo ]  Primary button
  [ Change Photo ]    Ghost button
```

**Photo rejection reasons (admin-side — driver notified):**
- Face not clearly visible
- Photo is a photo of a photo / ID card
- Sunglasses, hat obscuring face
- Multiple people in photo
- Explicit or offensive content

**On rejection:** Driver notified by push + email with specific reason, prompt to re-upload.

---

### DS-016 · Bank Account Setup

**Purpose:** Connect a bank account for weekly payouts and instant payouts via Stripe.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║  Step 6 of 6                             ║
║  ●●●●●●  progress / teal                 ║
║                                          ║
║       Payout Account                     ║
║       type-h2 / text-primary             ║
║                                          ║
║  Connect your bank account to receive    ║
║  your weekly earnings.                   ║
║  type-body / text-secondary              ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  💰  Weekly Payout               │    ║
║  │  Every Monday — automatic        │    ║
║  │                                  │    ║
║  │  ⚡  Instant Payout              │    ║
║  │  Available 24/7 for $0.99 fee    │    ║
║  └──────────────────────────────────┘    ║
║  bg-secondary / text-secondary           ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Account Holder Name               │  ║
║  │  Marcus Brown                      │  ║
║  └────────────────────────────────────┘  ║
║  Pre-filled from profile — editable      ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Routing Number  (9 digits)        │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Account Number                    │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ┌────────────────────────────────────┐  ║
║  │  Confirm Account Number            │  ║
║  └────────────────────────────────────┘  ║
║                                          ║
║  ☐  ○ Checking    ○ Savings             ║
║                                          ║
║  🔒  Your banking info is encrypted      ║
║      and stored by Stripe.               ║
║  text-caption / text-muted               ║
║                                          ║
║  [ Connect Bank Account ]                ║
║  Primary button                          ║
║                                          ║
║  [ I'll set this up later ]              ║
║  Ghost / text-secondary                  ║
║  (cannot receive earnings without this)  ║
╚══════════════════════════════════════════╝
```

**Components:** C-019 (Form Input), C-021 (Radio Group), C-001 (Primary Button)

**Stripe integration:**
- BidiRide never stores raw bank account numbers — passed directly to Stripe via Stripe.js tokenization
- Stripe performs micro-deposit verification: two small deposits (< $1.00) within 1–2 business days
- Driver must verify by entering the exact deposit amounts before first payout is released

**"Set up later" consequence:**
- Driver can complete onboarding but cannot receive any payouts until bank account verified
- Persistent banner on Driver Home screen: "Add your payout account to receive earnings → Set up now"
- Earnings accumulate and are released on next Monday after account is verified

**Bank validation:**
- Routing number: validated against ABA routing number format (9 digits)
- Account numbers must match
- Account holder name: if name on account differs significantly from driver profile name → flag for review (not a hard block)

---

### DS-017 · Application Submitted — Pending Review

**Purpose:** Confirm all documents are submitted and set expectations for the review timeline.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║         ✅                               ║
║         (large success icon — teal)      ║
║                                          ║
║       Application Submitted             ║
║       type-h1 / text-primary             ║
║                                          ║
║  We've received everything. Our team     ║
║  will review your application within     ║
║  3–7 business days.                      ║
║  type-body / text-secondary / centered   ║
║                                          ║
║  ──────────────────────────────────      ║
║                                          ║
║  STATUS CHECKLIST                        ║
║  type-label / text-teal / uppercase      ║
║                                          ║
║  ✓  Account created                     ║
║  ✓  Phone verified                      ║
║  ✓  Email verified                      ║
║  ✓  License submitted             →AI▶  ║
║  ✓  Insurance submitted           →▶    ║
║  ✓  Vehicle registration submitted→▶    ║
║  ✓  Vehicle inspection submitted  →▶    ║
║  ✓  Background check ordered            ║
║  ✓  Bank account connected              ║
║  ⏳  Application review in progress     ║
║                                          ║
║  Items with →▶ are being reviewed.       ║
║  text-caption / text-muted               ║
║                                          ║
║  ──────────────────────────────────      ║
║                                          ║
║  We'll notify you at:                    ║
║  m.brown@email.com                       ║
║  +1 (973) 555-0192                       ║
║  text-caption / text-teal                ║
║                                          ║
║  Questions?  [ Contact Support ]         ║
║  text-teal link                          ║
╚══════════════════════════════════════════╝
```

**Components:** C-030 (Status Checklist Card), C-005 (Text Link)

**Application status states:**

| State | Indicator | Description |
|---|---|---|
| Submitted | ⏳ Yellow | All documents received, review in progress |
| Action required | ⚠ Orange | Admin has flagged an issue — driver must re-upload or respond |
| Background check pending | 🔍 Blue | Checkr hasn't returned a result yet |
| Approved | ✅ Green | Driver is cleared to go online |
| Declined | ✗ Red | Application rejected — reason provided |

**"Action required" flow:**
- Push notification + email: "Action required on your BidiRide application"
- Driver opens app → DS-017 shows the specific issue with a CTA to resolve it
- Example: "Your insurance document was unclear — please re-upload a clearer photo"
- Driver corrects → admin re-reviews

**If bank account not connected yet:**
- DS-017 shows a persistent banner: "Add your payout account → [Set up bank account]"

---

### DS-018 · Application Approved

**Purpose:** Celebrate the driver's approval and onboard them into the live app experience.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║                                          ║
║         🎉                               ║
║         (celebration animation)          ║
║                                          ║
║       Welcome to BidiRide!               ║
║       type-display / text-teal           ║
║                                          ║
║  You're approved. Time to earn.          ║
║  type-h3 / text-gold                     ║
║                                          ║
║  ──────────────────────────────────      ║
║                                          ║
║  YOUR DRIVER PROFILE                     ║
║  type-label / uppercase / text-muted     ║
║                                          ║
║  ╔════════════╗  Marcus B.              ║
║  ║ [photo]    ║  type-h3 / text-primary  ║
║  ╚════════════╝                          ║
║  64×64px circle                          ║
║                                          ║
║  🏅 Verified Driver                      ║
║  type-label / text-teal                  ║
║                                          ║
║  Vehicle: 2021 Toyota Camry · Silver     ║
║  Plate: NJA-1234                         ║
║  Eligible: BidiRide Standard              ║
║  text-body / text-secondary              ║
║                                          ║
║  ──────────────────────────────────      ║
║                                          ║
║  PAYOUT: $0.00                          ║
║  type-h3 / text-gold / JetBrains Mono   ║
║  Paid to: Chase ····4812                ║
║  Next payout: Monday, Jun 9             ║
║  text-caption / text-muted               ║
║                                          ║
║  ──────────────────────────────────      ║
║                                          ║
║  [ Start Driving ]                       ║
║  Primary button — full width             ║
║                                          ║
║  Takes you to Driver Home (offline)      ║
║  text-caption / text-muted               ║
╚══════════════════════════════════════════╝
```

**Components:** C-031 (Approval Card), C-001 (Primary Button)

**Celebration animation:** Confetti-style particle animation using gold and teal colors. Duration: 2.5 seconds. Does not loop — fires once.

**"Start Driving" navigates to:** DS-019 (Driver Home — Offline)

**What happens in the background at approval:**
- `drivers` record updated: `status = 'active'`
- `trust_scores` record initialized: trust_score = 200 (new driver baseline), badge = 'Verified'
- `safety_sessions` table ready for first trip
- Welcome email sent with PDF quick-start guide

---

## Onboarding State Machine Summary

```
DS-001 (Splash)
    │
    ├── New user ────────────────────────────────────────────────────────────┐
    │                                                                        ▼
    │                                                                DS-002 (Carousel)
    │                                                                        │
    │                                                                DS-003 (Create Account)
    │                                                                        │
    │                                                                DS-004 (OTP)
    │                                                                        │
    │                                                                DS-005 (Email Verify)
    │                                                                        │
    │                                                                DS-006 (Personal Info)
    │                                                                        │
    │                                                                DS-007 (License Upload)
    │                                                                        │
    │                                                                DS-008 (AI License Review)
    │                                                                        │
    │                                                                DS-009 (BG Check Consent)
    │                                                                        │
    │                                                                DS-010 (Insurance Upload)
    │                                                                        │
    │                                                                DS-011 (Registration Upload)
    │                                                                        │
    │                                                                DS-012 (Vehicle Details)
    │                                                                        │
    │                                                                DS-013 (Inspection Checklist)
    │                                                                        │
    │                                            (repeated per photo)  DS-014 (Photo Capture)
    │                                                                        │
    │                                                                DS-015 (Profile Photo)
    │                                                                        │
    │                                                                DS-016 (Bank Account)
    │                                                                        │
    │                                                                DS-017 (Pending Review)
    │                                                                   ↕  (polls for status)
    │                                                                DS-018 (Approved)
    │                                                                        │
    └── Returning (approved) ─────────────────────────────────────► DS-019 (Driver Home Offline)
        Returning (pending) ──────────────────────────────────────► DS-017
        Returning (action required) ──────────────────────────────► DS-017 with alert
        Returning (declined) ─────────────────────────────────────► Rejection screen
```

---

## Onboarding Database Fields

The following fields in `drivers` are populated during onboarding:

```sql
id                          UUID PRIMARY KEY
user_id                     UUID REFERENCES users(id)
status                      ENUM(pending, under_review, action_required, approved, declined, suspended)
legal_first_name            VARCHAR
legal_last_name             VARCHAR
date_of_birth               DATE
home_address                VARCHAR
home_city                   VARCHAR
home_state                  VARCHAR(2)
home_zip                    VARCHAR(10)

-- License fields
license_number              VARCHAR
license_state               VARCHAR(2)
license_class               VARCHAR(10)
license_expiry              DATE
license_front_doc_id        UUID REFERENCES driver_documents(id)
license_back_doc_id         UUID REFERENCES driver_documents(id)
license_ai_confidence       DECIMAL(5,2)     -- 0–100%

-- Background check
background_check_id         VARCHAR          -- Checkr candidate ID
background_check_status     ENUM(not_started, pending, clear, consider, adverse_action, disputed)
background_check_ordered_at TIMESTAMP
background_check_cleared_at TIMESTAMP NULLABLE

-- Insurance
insurance_policy_number     VARCHAR NULLABLE
insurance_provider          VARCHAR NULLABLE
insurance_expiry            DATE NULLABLE
insurance_doc_id            UUID REFERENCES driver_documents(id) NULLABLE

-- Vehicle (primary vehicle — vehicles table for multiple)
primary_vehicle_id          UUID REFERENCES vehicles(id) NULLABLE

-- Profile
profile_photo_url           VARCHAR NULLABLE
profile_photo_status        ENUM(pending, approved, rejected)

-- Payout
stripe_account_id           VARCHAR NULLABLE    -- Stripe Connect account ID
payout_bank_verified        BOOLEAN DEFAULT FALSE
payout_bank_verified_at     TIMESTAMP NULLABLE

-- Trust / Badge (set at approval — from Trust Score Engine)
current_badge               ENUM(verified, trusted, vip) DEFAULT verified
trust_score_id              UUID REFERENCES trust_scores(id) NULLABLE

-- Ride eligibility
eligible_ride_types         JSONB DEFAULT '["standard"]'   -- ["standard","priority","premium"]

-- Timestamps
applied_at                  TIMESTAMP
approved_at                 TIMESTAMP NULLABLE
declined_at                 TIMESTAMP NULLABLE
decline_reason              TEXT NULLABLE
created_at                  TIMESTAMP
updated_at                  TIMESTAMP
```

**`driver_documents` table:**

```sql
id                  UUID PRIMARY KEY
driver_id           UUID REFERENCES drivers(id)
document_type       ENUM(license_front, license_back, insurance, registration, vehicle_photo_front,
                         vehicle_photo_rear, vehicle_photo_driver_side, vehicle_photo_passenger_side,
                         vehicle_photo_interior_front, vehicle_photo_interior_rear,
                         vehicle_photo_dashboard, profile_photo)
storage_url         VARCHAR              -- S3 private URL
status              ENUM(pending, ai_reviewing, approved, rejected, re_upload_required)
ai_confidence       DECIMAL(5,2) NULLABLE
ai_flags            JSONB DEFAULT '[]'   -- array of flag strings
admin_reviewer_id   UUID REFERENCES admin_users(id) NULLABLE
admin_notes         TEXT NULLABLE
rejection_reason    TEXT NULLABLE
uploaded_at         TIMESTAMP
reviewed_at         TIMESTAMP NULLABLE
expiry_date         DATE NULLABLE        -- for license, insurance, registration
```

---

## Onboarding API Endpoints

```
-- Account creation
POST /driver/auth/register
    Body: { full_name, email, phone, password }
    Response: { driver_id, otp_sent: true }

POST /driver/auth/verify-otp
    Body: { driver_id, otp }
    Response: { verified: true, session_token }

POST /driver/auth/verify-email
    Body: { token }   (from email link)
    Response: { verified: true }

-- Profile setup
PUT  /driver/profile/personal-info
    Body: { first_name, last_name, dob, address, city, state, zip }

-- Document uploads
POST /driver/documents/upload
    Body: FormData { file, document_type }
    Response: { document_id, status: "ai_reviewing" }

GET  /driver/documents/:document_id/status
    Response: { status, ai_confidence, extracted_data, flags }

-- License confirmation (after AI extraction)
POST /driver/documents/license/confirm
    Body: { document_id, confirmed_data: { name, number, state, class, expiry } }

-- Background check
POST /driver/background-check/consent
    Body: { driver_id, consented: true, consent_timestamp, ip_address }
    Response: { check_id, status: "pending" }

-- Vehicle
POST /driver/vehicles
    Body: { make, model, year, color, license_plate, vin }
    Response: { vehicle_id, eligible_ride_types }

-- Bank account (Stripe)
POST /driver/payout/bank-account
    Body: { stripe_token }   (tokenized by Stripe.js on client)
    Response: { account_id, verification_status: "pending_micro_deposits" }

POST /driver/payout/verify-micro-deposits
    Body: { amounts: [0.32, 0.18] }
    Response: { verified: true }

-- Application status
GET  /driver/application/status
    Response: { status, checklist, action_required: [], notes }
```

---

## Part 1 Completion

**Screens defined:** DS-001 through DS-018 (18 screens, including sub-states)
**Flows covered:** Full onboarding → document submission → admin review → approval

**Next:** Part 2 covers Driver Home, Availability Toggle, Ride Request Flow, and Trip Lifecycle.

---

*BidiRide Driver App UI — Part 1 of 4 — Confidential*
*Delaware LLC — All rights reserved*
