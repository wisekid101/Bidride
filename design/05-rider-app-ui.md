# BidiRide — Rider App UI v1.0

**Status:** Draft — Pending Founder Approval
**Document:** 05 of 10
**Prepared by:** Claude Code (Senior UX Architect)
**Date:** June 5, 2026
**References:** 03-design-system.md · 04-component-library.md · 02-product-requirements-document-v1.md

> Every rider-facing screen is defined here with wireframes, components, user actions,
> navigation paths, edge cases, error states, and empty states.
> No code. No React Native. UI/UX architecture only.

---

## Table of Contents

1. [Onboarding Flow](#1-onboarding-flow)
2. [Authentication — Sign Up](#2-authentication--sign-up)
3. [Authentication — Login](#3-authentication--login)
4. [ID Verification](#4-id-verification)
5. [Home Screen](#5-home-screen)
6. [Ride Search — Destination Entry](#6-ride-search--destination-entry)
7. [Fare Comparison — Ride Options](#7-fare-comparison--ride-options)
8. [Bid Submission](#8-bid-submission)
9. [Driver Matching](#9-driver-matching)
10. [Driver Tracking — En Route](#10-driver-tracking--en-route)
11. [Trip In Progress](#11-trip-in-progress)
12. [Safety Features](#12-safety-features)
13. [SOS Screen](#13-sos-screen)
14. [Ride Completion](#14-ride-completion)
15. [Ratings and Tips](#15-ratings-and-tips)
16. [Rewards](#16-rewards)
17. [Wallet](#17-wallet)
18. [Ride History](#18-ride-history)
19. [Settings](#19-settings)
20. [Notifications](#20-notifications)
21. [Screen Inventory](#21-screen-inventory)
22. [User Flow Summary](#22-user-flow-summary)

---

## 1. Onboarding Flow

### RS-001 · Splash Screen

**Purpose:** First frame the user sees. Establishes brand identity while the app initializes.

```
╔══════════════════════════════════════════╗
║                                          ║
║                                          ║
║                                          ║
║                                          ║
║              BidiRide                     ║
║         type-display / text-teal         ║
║                                          ║
║        ◐  (loading spinner, sm)          ║
║                                          ║
║                                          ║
║                                          ║
║  bg: bg-charcoal (#0F1923)               ║
║  Full screen, no status bar content      ║
╚══════════════════════════════════════════╝
```

**Components:** C-008 (Loading Spinner)
**Duration:** 1.5–2.5 seconds (varies with load time)
**Navigation:**
- New user → RS-002 (Onboarding Carousel)
- Returning authenticated user → RS-005 (Home Screen)
- Returning unauthenticated user → RS-003 (Login)

**Edge Cases:**
- No internet connection on launch: show "No connection" message with retry button after 5 seconds
- App update required: show update prompt with App Store / Play Store deep link

---

### RS-002 · Onboarding Carousel

**Purpose:** Communicate BidiRide's four core promises to a new user before asking for any information.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║                                          ║
║                                          ║
║  ╔══════════════════════════════════╗    ║
║  ║   [Illustration — Slide 1]       ║    ║
║  ║   Driver + Rider, premium feel   ║    ║
║  ╚══════════════════════════════════╝    ║
║                                          ║
║       Drivers Earn More.                 ║
║       type-h1 / text-primary             ║
║                                          ║
║  BidiRide AI keeps fares fair so          ║
║  drivers take home more of every ride.   ║
║  type-body / text-secondary / centered   ║
║                                          ║
║          ● ○ ○ ○                         ║
║      progress dots / teal active         ║
║                                          ║
║  ──────────────────────────────────      ║
║                                          ║
║       [ Get Started ]                    ║
║       Primary button                     ║
║                                          ║
║       Already have an account?           ║
║       [ Sign In ]  text-teal link        ║
╚══════════════════════════════════════════╝
```

**Slides:**
1. "Drivers Earn More." — Driver-first economics, 70–80% payout message
2. "Riders Pay Less." — AI fare intelligence, transparent pricing
3. "Safety First." — Live monitoring, SOS, trusted contacts
4. "Smarter Rides." — AI marketplace that learns and improves

**Components:** C-009 (Progress Bar — dot variant)
**User Actions:** Swipe left/right between slides · Tap "Get Started" (any slide) · Tap "Sign In"
**Navigation:** Get Started → RS-004 (Sign Up) · Sign In → RS-003a (Login)

**Edge Cases:**
- User taps "Skip" (not shown — intentionally removed): carousel cannot be skipped. All 4 value props must be communicable before sign-up. Skip option considered anti-pattern for trust-first brand.
- User swipes back past slide 1: bounces back (no wrap-around)

---

## 2. Authentication — Sign Up

### RS-003 · Sign Up Screen

**Purpose:** Create a new BidiRide rider account.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Create Account                       ║
╠══════════════════════════════════════════╣
║                                          ║
║  Join BidiRide                            ║
║  type-h1 / text-primary                  ║
║  Riders pay less. Drivers earn more.     ║
║  type-body-s / text-secondary            ║
║                                          ║
║  Full Name                               ║
║  ┌──────────────────────────────────┐    ║
║  │ James Rodriguez                  │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  Email Address                           ║
║  ┌──────────────────────────────────┐    ║
║  │ james@email.com                  │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  Phone Number                            ║
║  ┌──────────────────────────────────┐    ║
║  │ +1  (201) 555-0184               │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  Password                                ║
║  ┌──────────────────────────────────┐    ║
║  │ ••••••••••••              [show] │    ║
║  └──────────────────────────────────┘    ║
║  Min 8 characters · type-caption/muted   ║
║                                          ║
║  [x] I agree to Terms of Service and    ║
║      Privacy Policy  (required)          ║
║                                          ║
║  [ Create Account ]                      ║
║  Primary button                          ║
║                                          ║
║  Already have an account? [ Sign In ]    ║
╚══════════════════════════════════════════╝
```

**Components:** C-008, form inputs from Design System
**User Actions:**
- Fill all required fields
- Toggle password visibility
- Tap Terms of Service / Privacy Policy links (open in-app browser)
- Check ToS agreement checkbox
- Tap "Create Account"

**Validation:**
- Full name: required, min 2 characters
- Email: valid format, unique (server-side check on submit)
- Phone: US format, unique (server-side check)
- Password: min 8 characters, at least 1 number
- ToS checkbox: must be checked

**Navigation on success:** → RS-003a (Phone OTP Verification)

**Error States:**
- Email already registered: "An account with this email already exists. [Sign In instead]"
- Phone already registered: "This phone number is already linked to an account."
- Weak password: inline hint below password field
- Server error: toast "Something went wrong. Please try again."

**Edge Cases:**
- Autofill supported for name and email (iOS/Android autofill)
- Phone field: auto-formats as user types (no manual formatting needed)
- If user navigates back from OTP screen, form data is preserved

---

### RS-003a · Phone OTP Verification

**Purpose:** Confirm the rider's phone number before account is activated.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Verify Phone                         ║
╠══════════════════════════════════════════╣
║                                          ║
║  We sent a code to                       ║
║  type-body / text-secondary              ║
║  (201) 555-0184                          ║
║  type-body / text-primary / bold         ║
║                                          ║
║  ┌───┐  ┌───┐  ┌───┐  ┌───┐  ┌───┐  ┌───┐ ║
║  │ 4 │  │ 8 │  │ _ │  │   │  │   │  │   │ ║
║  └───┘  └───┘  └───┘  └───┘  └───┘  └───┘ ║
║  OTP input — C-004 pattern               ║
║                                          ║
║  Resend code in 0:28                     ║
║  type-caption / text-muted               ║
║                                          ║
║  Wrong number? [ Change number ]         ║
║  type-caption / text-teal                ║
╚══════════════════════════════════════════╝
```

**Components:** OTP input (Design System), C-008
**User Actions:** Enter 6-digit code (auto-advances on each digit) · Resend code · Change number
**Auto-advance:** On correct 6-digit entry → auto-submits, navigates to RS-003b
**Resend:** Available after 30-second countdown. Resend resets timer to 60 seconds.
**Navigation:** Valid OTP → RS-003b (Email Verification) · Change number → back to RS-003 with phone field focused

**Error States:**
- Wrong OTP: "Incorrect code. X attempts remaining."
- 5 failed attempts: account locked for 10 minutes, error shown
- Expired OTP (10 min window): "Code expired. Request a new one." + resend enabled

---

### RS-003b · Email Verification Prompt

**Purpose:** Prompt rider to verify their email. Non-blocking — rider can proceed while email is unverified, but a persistent banner reminds them.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Verify Email                         ║
╠══════════════════════════════════════════╣
║                                          ║
║  Check your inbox                        ║
║  type-h2 / text-primary                  ║
║                                          ║
║  We sent a verification link to:         ║
║  james@email.com                         ║
║  type-body / text-teal                   ║
║                                          ║
║  Click the link in that email to         ║
║  verify your account.                    ║
║  type-body / text-secondary              ║
║                                          ║
║  [ Open Mail App ]                       ║
║  Primary button                          ║
║                                          ║
║  [ Resend Email ]                        ║
║  Ghost button                            ║
║                                          ║
║  ───────────────────────────────         ║
║                                          ║
║  [ Continue to BidiRide ]                 ║
║  Secondary button                        ║
║  (email verification not required now)   ║
╚══════════════════════════════════════════╝
```

**Navigation:** Continue → RS-003c (Profile Setup) · Email verified via link → auto-clears banner on next app open

---

### RS-003c · Profile Setup

**Purpose:** Optional profile photo and date of birth. Keeps onboarding friction low.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ●─────────────────────  Step 3 of 4    ║
╠══════════════════════════════════════════╣
║                                          ║
║  Set up your profile                     ║
║  type-h1 / text-primary                  ║
║                                          ║
║         ┌──────────────┐                 ║
║         │              │                 ║
║         │     [+]      │  ← tap to add  ║
║         │    Photo     │                 ║
║         │              │                 ║
║         └──────────────┘                 ║
║  Optional · type-caption / text-muted    ║
║                                          ║
║  Date of Birth  (optional)               ║
║  ┌──────────────────────────────────┐    ║
║  │ MM / DD / YYYY                   │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  [ Continue ]                            ║
║  Primary button                          ║
║                                          ║
║  [ Skip for now ]                        ║
║  Ghost button                            ║
╚══════════════════════════════════════════╝
```

**Navigation:** Continue or Skip → RS-003d (Add Payment Method)
**Photo:** Camera or gallery. Cropped to circle preview. Not required.
**Edge Cases:** If photo upload fails (network), allow continue without photo and retry from profile settings.

---

### RS-003d · Add Payment Method

**Purpose:** Add a payment method before first ride. Required before booking, but presented here to reduce first-ride friction.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ●●●───────────────────  Step 4 of 4    ║
╠══════════════════════════════════════════╣
║                                          ║
║  Add payment method                      ║
║  type-h1 / text-primary                  ║
║  Required to book your first ride.       ║
║  type-body-s / text-secondary            ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  🍎  Apple Pay                   │    ║
║  └──────────────────────────────────┘    ║
║  ┌──────────────────────────────────┐    ║
║  │  G   Google Pay                  │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  ──────────────  or  ──────────────      ║
║                                          ║
║  Card Number                             ║
║  ┌──────────────────────────────────┐    ║
║  │ 4242  4242  4242  4242      [cc] │    ║
║  └──────────────────────────────────┘    ║
║  ┌─────────────────┐  ┌─────────────┐   ║
║  │ MM / YY         │  │ CVV         │   ║
║  └─────────────────┘  └─────────────┘   ║
║                                          ║
║  [ Add Card ]                            ║
║  Primary button                          ║
║                                          ║
║  [ Add Later ] — limited to viewing only ║
║  Ghost button                            ║
╚══════════════════════════════════════════╝
```

**Components:** Stripe payment element (rendered via Stripe SDK — no card data touches BidiRide servers)
**Navigation:** Add Card success or Apple/Google Pay → RS-005 (Home Screen, onboarding complete)
**Add Later:** User can enter app but cannot book until payment added. Home screen shows persistent banner.

**Error States:**
- Card declined: "Your card was declined. Try a different card."
- Invalid card number: inline validation
- Expired card: "This card has expired."

---

## 3. Authentication — Login

### RS-004 · Login Screen

**Purpose:** Authenticate a returning rider.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Sign In                              ║
╠══════════════════════════════════════════╣
║                                          ║
║  Welcome back                            ║
║  type-h1 / text-primary                  ║
║                                          ║
║  Email or Phone                          ║
║  ┌──────────────────────────────────┐    ║
║  │ james@email.com                  │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  Password                                ║
║  ┌──────────────────────────────────┐    ║
║  │ ••••••••••••              [show] │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  [ Forgot Password? ]                    ║
║  text-teal link, right-aligned           ║
║                                          ║
║  [ Sign In ]                             ║
║  Primary button                          ║
║                                          ║
║  ──────────  or  ──────────              ║
║                                          ║
║  [ Continue with Apple ]                 ║
║  [ Continue with Google ]                ║
║  Secondary buttons with icons            ║
║                                          ║
║  Don't have an account? [ Sign Up ]      ║
╚══════════════════════════════════════════╝
```

**Components:** Form inputs, C-008
**User Actions:** Enter credentials · Toggle password · Forgot password · Social sign-in · Navigate to sign-up
**Navigation:** Success → RS-005 (Home) · Forgot password → RS-004a

**Error States:**
- Wrong credentials: "Email or password is incorrect. [Forgot password?]"
- Account suspended: "Your account has been suspended. Contact support." + support link
- Account banned: "Your account is no longer active." + support link
- 5 failed attempts: "Too many attempts. Try again in 10 minutes." + lockout timer

---

### RS-004a · Forgot Password

**Purpose:** Initiate password reset via email.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Reset Password                       ║
╠══════════════════════════════════════════╣
║                                          ║
║  Reset your password                     ║
║  type-h1 / text-primary                  ║
║  Enter your email and we'll send         ║
║  you a reset link.                       ║
║  type-body / text-secondary              ║
║                                          ║
║  Email Address                           ║
║  ┌──────────────────────────────────┐    ║
║  │ james@email.com                  │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  [ Send Reset Link ]                     ║
║  Primary button                          ║
║                                          ║
║  ─────────────────────────               ║
║  SUCCESS STATE:                          ║
║  ✓ Reset link sent!                      ║
║  Check james@email.com                   ║
║  [ Open Mail App ]                       ║
╚══════════════════════════════════════════╝
```

**Navigation:** After success → back to RS-004 with success toast · Reset link → deep link into new password screen

---

## 4. ID Verification

### RS-005v · Identity Verification (Elevated — Triggered)

**Purpose:** Verify rider identity when AI flags account as elevated risk. Not shown during standard onboarding.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  Identity Verification Required          ║
╠══════════════════════════════════════════╣
║                                          ║
║  ⚠  Action required                      ║
║  text-warning / type-h3                  ║
║                                          ║
║  To continue using BidiRide, please       ║
║  verify your identity. This takes        ║
║  about 2 minutes.                        ║
║  type-body / text-secondary              ║
║                                          ║
║  ─────────────────────────────           ║
║                                          ║
║  STEP 1: Upload ID                       ║
║  ┌──────────────────────────────────┐    ║
║  │  [ Take Photo of Driver's        │    ║
║  │    License or Passport ]         │    ║
║  │    Front · Optional: Back        │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  STEP 2: Selfie                          ║
║  ┌──────────────────────────────────┐    ║
║  │  [ Take Selfie ]                 │    ║
║  │  Face the camera in good light   │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  [ Submit Verification ]                 ║
║  Primary button (active after both done) ║
║                                          ║
║  🔒 Your ID is encrypted and used        ║
║  only for verification.                  ║
║  type-caption / text-muted               ║
╚══════════════════════════════════════════╝
```

**States:** Pre-submission (photo prompts) · Submitting (spinner) · Under review (pending) · Approved (dismiss modal) · Rejected (reason + contact support)
**Navigation:** Verification modal overlays the blocked screen · On approval → modal dismissed, rider continues

**Edge Cases:**
- Camera permission denied: deep link to phone settings
- Photo too dark: "Please retake in better lighting"
- ID not readable: "We couldn't read your ID. Please try again."

---

## 5. Home Screen

### RS-005 · Home Screen (Map View)

**Purpose:** Primary rider screen. All ride booking starts here.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  BidiRide            [⭐ 2,840] [🔔] [👤]║
║  Transparent header over map             ║
╠══════════════════════════════════════════╣
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ↑ Your location detected        │    ║
║  │  4821 Market St, Newark NJ       │    ║
║  └──────────────────────────────────┘    ║
║  Current location chip, top of map       ║
║                                          ║
║  [  ╔══ MAP ══════════════════════╗  ]   ║
║  [  ║                            ║  ]   ║
║  [  ║   🚗  🚗    🚗             ║  ]   ║
║  [  ║                            ║  ]   ║
║  [  ║      ✦ (your location)     ║  ]   ║
║  [  ║                            ║  ]   ║
║  [  ╚════════════════════════════╝  ]   ║
║  Full-screen Google Maps / Mapbox        ║
║  Nearby driver pins (approximate)        ║
║                                          ║
╠══════════════════════════════════════════╣
║  ┌──────────────────────────────────┐    ║
║  │  🔍  Where to?                   │    ║
║  └──────────────────────────────────┘    ║
║  Search input — C-001 Search Input       ║
║                                          ║
║  🏠 Home    💼 Work    ⭐ Hoboken PATH   ║
║  Saved places quick-access chips         ║
║                                          ║
║  ─────────────────────────────────       ║
║                                          ║
║  Recent: EWR Terminal C  >               ║
║  Recent: Penn Station NYC  >             ║
║  type-body / text-secondary              ║
╠══════════════════════════════════════════╣
║  🏠 Home    🚗 Rides    💰 Wallet  👤 Me ║
╚══════════════════════════════════════════╝
```

**Components:** C-052 (Rewards Badge), C-010 (Tab Bar), C-011 (Navigation Header — transparent), C-055 (Favorite Locations shortcuts)
**User Actions:**
- Tap search bar → RS-006 (Destination Entry)
- Tap saved place chip → pre-fills destination → RS-007 (Fare Preview)
- Tap recent destination → same as above
- Tap rewards badge → Rewards screen
- Tap notification bell → Notifications screen
- Tap avatar → Profile screen
- Swipe map: pan and zoom (ride booking paused while panning)

**Persistent Banners (conditional):**
- Email unverified: "Please verify your email. [Resend]" — amber, dismissible
- Payment method missing: "Add a payment method to book rides." — amber, non-dismissible, taps → RS-003d
- Account has active ride: "You have an active ride. [View]" — teal, taps → active trip screen

**Empty State (no drivers nearby):**
- Driver pins disappear from map
- "No drivers available in your area right now. Check back soon."
- Map still functional; user can still submit a request (matched when driver arrives)

**Error States:**
- Location permission denied: "Enable location to book rides." with settings link. Manual address entry available.
- GPS signal lost: show last known location, "Location unavailable — enter pickup manually" prompt

---

## 6. Ride Search — Destination Entry

### RS-006 · Destination Entry Screen

**Purpose:** Let rider search for and select a destination to initiate the booking flow.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ×  Where are you going?                 ║
╠══════════════════════════════════════════╣
║                                          ║
║  PICKUP:                                 ║
║  ┌──────────────────────────────────┐    ║
║  │ 📍 4821 Market St, Newark NJ     │    ║
║  └──────────────────────────────────┘    ║
║  (editable, pre-filled with GPS)         ║
║                                          ║
║  DESTINATION:                            ║
║  ┌──────────────────────────────────┐    ║
║  │ 🔍 Search destination...         │    ║
║  └──────────────────────────────────┘    ║
║  Autofocused on screen open              ║
║                                          ║
║  ─────────────────────────────────       ║
║  SAVED PLACES:                           ║
║  🏠  Home — 123 Market St               ║
║  💼  Work — One Penn Plaza, NYC          ║
║  ⭐  Hoboken PATH Station                ║
║                                          ║
║  ─────────────────────────────────       ║
║  RECENTS:                                ║
║  🕐  EWR Terminal C, Newark             ║
║  🕐  Penn Station, New York             ║
║  🕐  Rutgers Newark — College Ave       ║
║                                          ║
║  ─────────────────────────────────       ║
║  SEARCH RESULTS (as user types):         ║
║  📍 Hoboken Terminal, NJ                 ║
║  📍 Hoboken PATH Station, NJ             ║
║  📍 Hoboken City Hall, NJ                ║
╚══════════════════════════════════════════╝
```

**Components:** Search Input (Design System), C-055 (Favorite Locations), C-008 (loading during search)
**User Actions:**
- Type destination → real-time Google Places autocomplete results
- Tap saved place → pre-fills destination, navigates to RS-007
- Tap recent → pre-fills destination, navigates to RS-007
- Tap search result → pre-fills destination, navigates to RS-007
- Tap pickup field → editable, override GPS with manual address
- Tap × → back to RS-005 (Home Screen)

**Navigation:** Destination selected → RS-007 (Fare Preview)

**Edge Cases:**
- Airport detected in destination: EWR-specific flow surfaces (terminal selector before RS-007)
- No search results: "No results found. Try a different address." — Google Maps pin-drop fallback available
- Pickup location manually overridden: map updates pickup pin on RS-007

---

### RS-006a · Airport Destination — Terminal Selector

**Purpose:** When destination is EWR, ask rider which terminal to ensure accurate pickup/dropoff guidance.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Newark Airport (EWR)                 ║
╠══════════════════════════════════════════╣
║                                          ║
║  Which terminal?                         ║
║  type-h2 / text-primary                  ║
║  We'll direct your driver to the         ║
║  exact pickup zone.                      ║
║  type-body-s / text-secondary            ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ✈  Terminal A                   │    ║
║  │     Departures & Arrivals        │    ║
║  └──────────────────────────────────┘    ║
║  ┌──────────────────────────────────┐    ║
║  │  ✈  Terminal B                   │    ║
║  │     Departures & Arrivals        │    ║
║  └──────────────────────────────────┘    ║
║  ┌──────────────────────────────────┐    ║
║  │  ✈  Terminal C                   │    ║
║  │     Departures & Arrivals        │    ║
║  └──────────────────────────────────┘    ║
║  ┌──────────────────────────────────┐    ║
║  │  ❓  I'm not sure                │    ║
║  │     We'll ask your driver        │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**Navigation:** Terminal selected → RS-007 with terminal metadata attached to trip request

---

## 7. Fare Comparison — Ride Options

### RS-007 · Fare Preview and Ride Options

**Purpose:** Display AI-recommended fare, route preview, and ride type options. The core decision screen.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ×  Your Ride                            ║
╠══════════════════════════════════════════╣
║  ╔══════════════════════════════════╗    ║
║  ║  [MAP — route line shown]        ║    ║
║  ║  📍 Pickup pin                   ║    ║
║  ║  🏁 Destination pin              ║    ║
║  ╚══════════════════════════════════╝    ║
║  Map: ~40% screen height                 ║
╠══════════════════════════════════════════╣
║  ┌──────────────────────────────────┐    ║
║  │  📍 4821 Market St, Newark       │    ║
║  │  ↓                               │    ║
║  │  📍 Hoboken PATH Station          │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  ────  Choose your ride  ────            ║
║                                          ║
║  ┌─────────┐ ┌─────────┐ ┌─────────┐    ║
║  │  🚗     │ │  ⚡     │ │  ⭐     │    ║
║  │Standard │ │Priority │ │Premium  │    ║
║  │ $14.80  │ │ $18.60  │ │ $22.40  │    ║
║  │ 4 min   │ │ 2 min   │ │ 4 min   │    ║
║  └─────────┘ └─────────┘ └─────────┘    ║
║  C-022 Ride Type Selector                ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ◈ BidiRide AI Fare               │    ║
║  │  ─────────────────────────────── │    ║
║  │             $14.80               │    ║
║  │    type-mono-l / text-primary    │    ║
║  │  8.2 mi  ·  Est. 19 min  ·  4min │    ║
║  │  ▼ See fare breakdown            │    ║
║  │  ◈ Driver earnings protected     │    ║
║  └──────────────────────────────────┘    ║
║  C-020 Fare Preview Card                 ║
║                                          ║
║  [ Accept Fare — $14.80 ]                ║
║  Primary button                          ║
║                                          ║
║  [ Make an Offer ]                       ║
║  Secondary button                        ║
╚══════════════════════════════════════════╝
```

**Components:** C-020 (Fare Preview Card), C-021 (Fare Breakdown — expandable), C-022 (Ride Type Selector), C-101 (AI Pricing Badge)
**User Actions:**
- Select ride type (Standard / Priority / Premium)
- Expand fare breakdown (tap "See fare breakdown")
- Accept fare → RS-009 (Driver Matching)
- Make an Offer → RS-008 (Bid Submission)
- Tap × → RS-005 (Home Screen)

**Fare Expiry:** Fare is valid for 60 seconds. Countdown shown in last 15 seconds. If expired, fare refreshes automatically with new market data.

**Navigation:**
- Accept → RS-009
- Make an Offer → RS-008
- Cancel → RS-005

**Error States:**
- No drivers available (all types): "No drivers available right now. Try again in a few minutes." — retry CTA
- Fare calculation failed: "Unable to calculate fare. Check your connection and try again."

**Edge Cases:**
- Rider's payment method is expired: warning banner on fare screen before they can accept
- Very long trip (> 50 miles): "Long trip detected. Fare estimate is higher. Driver acceptance may take longer."
- Surge conditions: AI has already priced this in — no separate "surge" label. Fare shown is the AI-balanced fare. No manipulation language.

---

## 8. Bid Submission

### RS-008 · Bid Submission Screen

**Purpose:** Allow rider to submit a fare offer lower than the AI recommendation. Optional power feature.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Make an Offer                        ║
╠══════════════════════════════════════════╣
║                                          ║
║  AI recommends: $14.80                   ║
║  type-body / text-secondary              ║
║                                          ║
║  Your offer:                             ║
║                                          ║
║        $  [ 12.00 ]                      ║
║        type-mono-l / text-teal           ║
║        Large numeric input               ║
║                                          ║
║  ←──────────────────────────→            ║
║  $10.50 (min)            $14.80 (AI)     ║
║  Slider — teal thumb / navy track        ║
║                                          ║
║  ─────────────────────────────           ║
║  ⚠  Driver earnings minimum: $10.50      ║
║  Offers below this cannot be sent.       ║
║  type-caption / text-warning             ║
║                                          ║
║  ◈ Offers near the AI fare are           ║
║    accepted 3× faster on average.        ║
║  type-caption / text-teal                ║
║                                          ║
║  ─────────────────────────────           ║
║                                          ║
║  [ Submit Offer — $12.00 ]               ║
║  Primary button                          ║
║                                          ║
║  [ Accept AI Fare Instead — $14.80 ]     ║
║  Ghost button                            ║
╚══════════════════════════════════════════╝
```

**Components:** C-030 (Bid Input Card), C-008 (loading on submit)
**User Actions:**
- Adjust slider or tap numeric field to enter offer
- Submit offer
- Accept AI fare instead (escape hatch)
- Back → RS-007

**Validation:**
- Offer cannot go below driver earnings floor (slider physically stops at floor minimum)
- Numeric input: if user types below floor, field highlights red and submit is blocked with message
- Offer cannot exceed AI fare (slider caps there — no reason to offer more)

**Navigation:** Submit offer → RS-008a (Bid Pending) · Accept AI fare → RS-009

**Edge Cases:**
- Floor changes between RS-007 and RS-008 (market shift): floor refreshes on screen load
- Rider submits offer exactly at floor: allowed, clear message that this is the minimum

---

### RS-008a · Bid Pending Screen

**Purpose:** Show rider their offer is submitted and waiting for a driver response.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  Your Offer                              ║
╠══════════════════════════════════════════╣
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Your offer:    $12.00           │    ║
║  │  type-mono / text-teal           │    ║
║  │  ─────────────────────────────── │    ║
║  │  ◌  Waiting for a driver...      │    ║
║  │     Animated pulse indicator     │    ║
║  │                                  │    ║
║  │  AI fare ($14.80) is standing by │    ║
║  │  type-caption / text-secondary   │    ║
║  └──────────────────────────────────┘    ║
║  C-031 Bid Status Card                   ║
║                                          ║
║  Finding drivers near you               ║
║  type-body-s / text-secondary            ║
║                                          ║
║  [ Accept AI Fare Instead — $14.80 ]     ║
║  Primary button                          ║
║                                          ║
║  [ Cancel Offer ]                        ║
║  Ghost button / text-muted               ║
╚══════════════════════════════════════════╝
```

**States:** Pending → Accepted (auto-advance to RS-009) → Declined (show next driver options) → Counter-offer received (RS-008b)
**Timeout:** If no driver responds in 90 seconds, offer is widened to more drivers automatically. After 3 minutes: "No drivers accepted your offer. Accept AI fare or try a higher offer."

---

### RS-008b · Counter-Offer Received

**Purpose:** Show rider a driver's counter-offer for their decision.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  Driver Response                         ║
╠══════════════════════════════════════════╣
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  A driver has a counter-offer    │    ║
║  │  ─────────────────────────────── │    ║
║  │  Your offer:          $12.00     │    ║
║  │  Driver asks:         $13.50     │    ║
║  │                 type-mono/gold   │    ║
║  │  AI recommended:      $14.80     │    ║
║  │                 type-body-s/muted│    ║
║  │  ─────────────────────────────── │    ║
║  │  ⏱  Expires in  18s             │    ║
║  │     text-warning / countdown     │    ║
║  └──────────────────────────────────┘    ║
║  C-032 Counter-Offer Card                ║
║                                          ║
║  [ Accept $13.50 ]                       ║
║  Primary button                          ║
║                                          ║
║  [ Decline — Find another driver ]       ║
║  Ghost button                            ║
╚══════════════════════════════════════════╝
```

**Components:** C-032 (Counter-Offer Card)
**States:** Countdown active → Accept (RS-009) → Decline (back to RS-008a searching) → Expired (auto-decline, next driver)

---

## 9. Driver Matching

### RS-009 · Driver Matching / Finding Screen

**Purpose:** Inform rider that BidiRide is finding their driver. Active loading state.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  Finding Your Driver                     ║
╠══════════════════════════════════════════╣
║                                          ║
║  ╔══════════════════════════════════╗    ║
║  ║  [MAP]                           ║    ║
║  ║  Expanding radius animation      ║    ║
║  ║  Pulsing rings from pickup pin   ║    ║
║  ╚══════════════════════════════════╝    ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ✓ Fare confirmed: $14.80        │    ║
║  │  Standard  ·  Driver earnings:   │    ║
║  │  $11.10 (75%)      text-gold     │    ║
║  └──────────────────────────────────┘    ║
║  C-023 Fare Confirmation Banner          ║
║                                          ║
║  ◐  Finding the best driver for you...  ║
║  type-body / text-secondary / centered   ║
║                                          ║
║  This usually takes under 2 minutes.    ║
║  type-caption / text-muted               ║
║                                          ║
║  [ Cancel ]                              ║
║  Ghost button · cancellation policy note ║
╚══════════════════════════════════════════╝
```

**Components:** C-023 (Fare Confirmation Banner), C-008 (Spinner)
**On Match:** Auto-advances to RS-010 (Driver Matched) with transition animation
**User Actions:** Cancel ride (cancellation policy modal before confirming)
**States:** Searching → Matched (auto-advance) → No drivers (error state after 5 minutes)

**Error States:**
- No drivers after 5 minutes: "We couldn't find a driver. Your card was not charged. [Try Again] [Change Offer]"
- Payment method failed during matching: payment screen prompt

---

### RS-009a · Driver Matched

**Purpose:** Introduce the matched driver to the rider.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  Your Driver is Coming!                  ║
╠══════════════════════════════════════════╣
║                                          ║
║  ╔══════════════════════════════════╗    ║
║  ║  [MAP — driver location pin]     ║    ║
║  ║  🚗  Driver moving toward pickup ║    ║
║  ╚══════════════════════════════════╝    ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  [Photo]  Marcus T.    ★ 4.92    │    ║
║  │  482 trips                       │    ║
║  │  ─────────────────────────────── │    ║
║  │  Blue Toyota Camry               │    ║
║  │  NJ  · ABC-4821                  │    ║
║  │  ─────────────────────────────── │    ║
║  │  ETA:  4 min                     │    ║
║  │  type-h2 / text-teal             │    ║
║  └──────────────────────────────────┘    ║
║  C-040 Driver Card                       ║
║                                          ║
║  [ Message Driver ]  [ Call Driver ]     ║
║  Secondary buttons — masked contact      ║
║                                          ║
║  [ Share Trip ]                          ║
║  Ghost button → native share sheet       ║
║                                          ║
║  [ Cancel Ride ]  text-muted link        ║
╚══════════════════════════════════════════╝
```

**Components:** C-051 (Live ETA Chip — in header), C-050 (Rider Safety Banner — auto-appears)
**User Actions:** Message driver · Call driver (masked) · Share trip link · Cancel (with policy)
**Trusted contacts:** If enabled, trip link SMS sent automatically to trusted contacts at this point

---

## 10. Driver Tracking — En Route

### RS-010 · Driver En Route (Live Tracking)

**Purpose:** Live map view showing driver approaching pickup. Primary screen while waiting.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ┌──────────────────────────────────┐    ║
║  │  🚗 Marcus · 3 min               │    ║
║  └──────────────────────────────────┘    ║
║  C-051 Live ETA Chip — top of screen     ║
╠══════════════════════════════════════════╣
║  ╔══════════════════════════════════╗    ║
║  ║                                  ║    ║
║  ║   [LIVE MAP]                     ║    ║
║  ║   Driver pin updates every ~3s   ║    ║
║  ║   Route line: driver → pickup    ║    ║
║  ║   Your pickup pin (pulsing)      ║    ║
║  ║                                  ║    ║
║  ╚══════════════════════════════════╝    ║
║  Full screen live map                    ║
╠══════════════════════════════════════════╣
║  ┌──────────────────────────────────┐    ║
║  │  [Photo] Marcus T.  Blue Camry   │    ║
║  │  ABC-4821           ★ 4.92       │    ║
║  │  [ Message ]    [ Call ]         │    ║
║  └──────────────────────────────────┘    ║
║  Driver info bottom card                 ║
║                                          ║
║  🛡  Trip being monitored by BidiRide AI  ║
║  C-050 Rider Safety Banner               ║
║                                          ║
║  [🔴 SOS]  ← always visible             ║
║  C-080 SOS Button, bottom-right corner   ║
╚══════════════════════════════════════════╝
```

**Components:** C-051 (ETA Chip), C-050 (Safety Banner), C-080 (SOS Button)
**Live Updates:** Driver GPS updates every 3–5 seconds via WebSocket. ETA recalculates dynamically.
**On Driver Arrival:** Driver taps "Arrived" in driver app → push notification to rider: "Your driver has arrived!" → auto-advances to RS-010a

---

### RS-010a · Driver Arrived

**Purpose:** Confirm driver is at pickup. Help rider identify the vehicle.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  Your Driver Has Arrived                 ║
╠══════════════════════════════════════════╣
║                                          ║
║  Look for:                               ║
║  Blue Toyota Camry                       ║
║  type-h2 / text-primary                  ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  License Plate                   │    ║
║  │                                  │    ║
║  │         ABC-4821                 │    ║
║  │   type-display / text-gold       │    ║
║  └──────────────────────────────────┘    ║
║  Plate displayed large for easy ID       ║
║                                          ║
║  [Photo] Marcus T.  ★ 4.92              ║
║                                          ║
║  [ Message Driver ]                      ║
║  Secondary button                        ║
║                                          ║
║  ⏱ Driver is waiting — free wait: 2:00   ║
║  Wait timer (free window per policy)     ║
║                                          ║
║  [🔴 SOS]                               ║
╚══════════════════════════════════════════╝
```

**Wait Timer:** Free wait period starts when driver taps "Arrived." After free period, cancellation policy applies if rider hasn't boarded. Timer visible to manage expectations.

---

## 11. Trip In Progress

### RS-011 · In-Ride Screen

**Purpose:** Live trip tracking for the rider while in the vehicle.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ┌──────────────────────────────────┐    ║
║  │  📍 Hoboken PATH Station · 11 min│    ║
║  └──────────────────────────────────┘    ║
║  C-051 ETA Chip — destination ETA        ║
╠══════════════════════════════════════════╣
║  ╔══════════════════════════════════╗    ║
║  ║  [LIVE MAP — in-ride view]       ║    ║
║  ║  Vehicle position updating       ║    ║
║  ║  Route: current → destination    ║    ║
║  ║  Progress indicator on route     ║    ║
║  ╚══════════════════════════════════╝    ║
║  Full-screen live map                    ║
╠══════════════════════════════════════════╣
║  ┌──────────────────────────────────┐    ║
║  │  Trip in progress                │    ║
║  │  Marcus T.  ·  Blue Camry        │    ║
║  │  [ Share Trip ]                  │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  🛡  Trip being monitored by BidiRide AI  ║
║  C-050 Rider Safety Banner (dismissible) ║
║                                          ║
║  [🔴 SOS]  ← always visible, bottom-right║
║  C-080 — cannot be covered              ║
╚══════════════════════════════════════════╝
```

**Components:** C-051, C-050, C-080 (SOS — always visible, highest z-index)
**Live Updates:** Vehicle moves on map in real time. ETA decrements.
**AI Monitoring:** Route deviation detection running in background. Soft anomaly → C-082 appears. Hard anomaly → SOS prompt.
**On Arrival:** Driver taps "End Trip" → payment processed → RS-012 (Trip Complete)

---

## 12. Safety Features

### RS-012s · Safety Center

**Purpose:** Hub for all rider safety settings and features. Accessible from Profile and during trips.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Safety Center                        ║
╠══════════════════════════════════════════╣
║                                          ║
║  🛡  Your safety is our priority         ║
║  type-h2 / text-primary                  ║
║                                          ║
║  ─── ACTIVE FEATURES ───                 ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  🛡  AI Trip Monitoring          │    ║
║  │  Every trip is monitored for     │    ║
║  │  route changes and anomalies.    │    ║
║  │  Always on  ●                    │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  👤  Trusted Contacts  (2)       │    ║
║  │  Marcus, Sarah                   │    ║
║  │  Auto-share trip: On  ●          │    ║
║  │                     [ Manage ]   │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  🔴  Emergency SOS               │    ║
║  │  Always accessible during trips  │    ║
║  │  One tap connects to emergency   │    ║
║  │  services and alerts contacts.   │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  🎙  Audio Recording  ○          │    ║
║  │  Optional. Records in-ride audio │    ║
║  │  for safety disputes.            │    ║
║  │  [Learn more] [Enable]           │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  ──────────────────────────────          ║
║  [ Report a Safety Concern ]             ║
║  text-teal link                          ║
╚══════════════════════════════════════════╝
```

**User Actions:** Manage trusted contacts · Toggle auto-share · Enable audio recording · Report concern
**Navigation:** Manage trusted contacts → RS-012t (Trusted Contacts)

---

### RS-012t · Trusted Contacts

**Purpose:** Add, edit, and remove trusted contacts who receive automatic trip notifications.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Trusted Contacts                     ║
╠══════════════════════════════════════════╣
║                                          ║
║  When you take a ride, these people      ║
║  get a live link to your trip.           ║
║  type-body / text-secondary              ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  👤 Marcus Brown                 │    ║
║  │     +1 (201) 555-0100            │    ║
║  │     Partner  ·  Auto-share: On   │    ║
║  │                     [ Edit ]     │    ║
║  └──────────────────────────────────┘    ║
║  ┌──────────────────────────────────┐    ║
║  │  👤 Sarah Rodriguez              │    ║
║  │     +1 (201) 555-0211            │    ║
║  │     Sister  ·  Auto-share: On    │    ║
║  │                     [ Edit ]     │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  + Add Trusted Contact                   ║
║  text-teal, plus icon                    ║
║  (max 5 contacts)                        ║
║                                          ║
║  ──────────────────────────────          ║
║  Swipe a contact left to delete          ║
║  type-caption / text-muted               ║
╚══════════════════════════════════════════╝
```

**Empty State:** "You haven't added any trusted contacts yet. Add someone you trust to receive your trip details automatically."

---

## 13. SOS Screen

### RS-013 · SOS Activation

**Purpose:** Emergency interface. Designed for speed, clarity, and single-handed use under stress.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  RESTING (visible during trip):          ║
║                                          ║
║  Bottom-right corner of any trip screen  ║
║  ┌──────┐                                ║
║  │ SOS  │  40×40px  radius-circle        ║
║  │      │  bg: #EF4444  pulsing ring     ║
║  └──────┘                                ║
╠══════════════════════════════════════════╣
║  AFTER TAP — CONFIRMATION (5 seconds):   ║
╠══════════════════════════════════════════╣
║                                          ║
║  bg: #3B0000 (full screen)               ║
║                                          ║
║        🔴                                ║
║   Sending alert in                       ║
║        4                                 ║
║   seconds...                             ║
║   type-display / text-primary            ║
║                                          ║
║   [ Cancel — I'm okay ]                  ║
║   Large ghost button                     ║
║                                          ║
╠══════════════════════════════════════════╣
║  ACTIVE SOS (after confirmation):        ║
╠══════════════════════════════════════════╣
║                                          ║
║  bg: #3B0000 (full screen)               ║
║                                          ║
║        🔴                                ║
║   HELP IS ON THE WAY                     ║
║   type-h1 / text-primary                 ║
║                                          ║
║   ✓ Marcus notified                      ║
║   ✓ Sarah notified                       ║
║   ✓ BidiRide safety team alerted          ║
║   type-body / text-primary               ║
║                                          ║
║   [ Call 911 ]                           ║
║   Danger button — large — one-tap dial   ║
║                                          ║
║   Stay calm. Help is coming.             ║
║   type-body / text-secondary             ║
╚══════════════════════════════════════════╝
```

**Components:** C-080 (SOS Button — full state machine)
**Critical Design Rules:**
- The 5-second cancel window prevents accidental SOS
- "Cancel — I'm okay" is large and accessible (no small X button)
- "Call 911" is always present on the active SOS screen — BidiRide does not replace emergency services
- Screen stays on and bright (prevent auto-lock during SOS)
- No navigation away from active SOS screen without explicit user action

---

## 14. Ride Completion

### RS-014 · Trip Complete

**Purpose:** Confirm the trip is done, show fare summary, and prompt rating.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  You've Arrived!                         ║
╠══════════════════════════════════════════╣
║                                          ║
║       ✓                                  ║
║  Green checkmark animation               ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Trip Summary                    │    ║
║  │  ─────────────────────────────── │    ║
║  │  📍 Market St, Newark            │    ║
║  │  ↓   8.2 mi  ·  21 min           │    ║
║  │  📍 Hoboken PATH Station          │    ║
║  │  ─────────────────────────────── │    ║
║  │  Fare paid:           $14.80     │    ║
║  │  Driver earned:       $11.10 ✓   │    ║
║  │                  text-gold       │    ║
║  │  ─────────────────────────────── │    ║
║  │  Points earned:  +148 pts  ⭐    │    ║
║  │                  text-gold       │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  [ Rate Your Driver ]                    ║
║  Primary button                          ║
║                                          ║
║  [ Skip ]  text-muted link               ║
╚══════════════════════════════════════════╝
```

**Components:** C-042 (Driver Trip Summary Card — rider-facing variant), C-052 (Rewards badge update)
**Design Rule:** "Driver earned: $X" is always shown on trip complete screen. This is BidiRide's transparency promise — riders see what their driver made.
**Navigation:** Rate → RS-015 (Rating and Tips) · Skip → RS-005 (Home) with deferred rating prompt after next ride

---

## 15. Ratings and Tips

### RS-015 · Rate Your Driver + Tip

**Purpose:** Collect driver rating, optional review, and optional tip.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Rate Your Ride                       ║
╠══════════════════════════════════════════╣
║                                          ║
║  [Photo]  Marcus T.                      ║
║  Blue Toyota Camry  ·  ★ 4.92            ║
║                                          ║
║  How was your ride?                      ║
║  type-h2 / text-primary                  ║
║                                          ║
║  ☆ ☆ ☆ ☆ ☆                              ║
║  C-002 Star Rating (interactive, 36px)   ║
║                                          ║
║  ─── (appears after star selected) ───   ║
║                                          ║
║  What went well?  (optional)             ║
║  ┌────────────┐ ┌────────────┐           ║
║  │ Safe driver│ │  On time   │           ║
║  └────────────┘ └────────────┘           ║
║  ┌────────────┐ ┌────────────┐           ║
║  │ Clean car  │ │  Friendly  │           ║
║  └────────────┘ └────────────┘           ║
║  Compliment tag chips                    ║
║                                          ║
║  Add a comment  (optional)               ║
║  ┌──────────────────────────────────┐    ║
║  │ Great ride! Marcus was...        │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  ─── Leave a Tip ───                     ║
║                                          ║
║  [ $1 ]  [ $2 ]  [ $3 ]  [ $5 ]         ║
║  Tip amount chips — gold accent          ║
║  [ Custom Amount ]  [ No Tip ]           ║
║                                          ║
║  [ Submit ]                              ║
║  Primary button                          ║
╚══════════════════════════════════════════╝
```

**Components:** C-002 (Star Rating), C-008
**Rating Flow:** Stars appear first → on rating selected, compliment tags and comment expand below → tip section always visible
**1–2 Star Rating:** After submit, soft prompt: "We're sorry about your experience. Would you like to tell us more?" → optional incident report
**Tip Handling:** Processed via Stripe immediately. Tips go 100% to driver — never split with platform.
**Navigation:** Submit → RS-005 (Home) with "Feedback submitted" toast

---

## 16. Rewards

### RS-016 · Rewards Dashboard

**Purpose:** Show rider their points balance, tier, history, and redemption options.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  BidiRide Rewards                      ║
╠══════════════════════════════════════════╣
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ⭐  GOLD MEMBER                 │    ║
║  │  type-h2 / text-gold             │    ║
║  │                                  │    ║
║  │     2,840  pts                   │    ║
║  │  type-mono-l / text-gold         │    ║
║  │                                  │    ║
║  │  2,160 more to Platinum          │    ║
║  │  ████████████░░░░░░  56.8%       │    ║
║  │  Progress to Platinum            │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  [ Redeem Points ]                       ║
║  Primary button → RS-016a                ║
║                                          ║
║  ─── How to earn more ───               ║
║  🚗 Complete rides    +1 pt per $0.10   ║
║  👤 Refer a friend    +200 pts          ║
║  ⭐ Write a review    +25 pts           ║
║                                          ║
║  ─── Recent Activity ───               ║
║  ┌──────────────────────────────────┐    ║
║  │  +148 pts  ·  Ride completed     │    ║
║  │  Jun 5  ·  9:41 AM               │    ║
║  ├──────────────────────────────────┤    ║
║  │  +200 pts  ·  Referral: Sarah M. │    ║
║  │  Jun 3  ·  2:15 PM               │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  ─── Refer & Earn ───                    ║
║  C-057 Referral Rewards Card             ║
╚══════════════════════════════════════════╝
```

**Components:** C-052 (Rewards Badge), C-057 (Referral Rewards Card), C-009 (Progress Bar)
**Tabs:** Overview · History · Refer Friends
**Empty State (no points yet):** "Take your first BidiRide to start earning points! Every ride earns points toward free rides."

---

### RS-016a · Redeem Rewards

**Purpose:** Let rider choose and apply a rewards redemption.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Redeem Points                        ║
╠══════════════════════════════════════════╣
║                                          ║
║  Available: 2,840 pts                    ║
║  type-body / text-gold                   ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Free Ride Credit                │    ║
║  │  500 pts = $5.00 off next ride   │    ║
║  │  1,000 pts = $10.00 off          │    ║
║  │  ─────────────────────────────── │    ║
║  │  [ Use 500 pts for $5 off ]      │    ║
║  └──────────────────────────────────┘    ║
║  ┌──────────────────────────────────┐    ║
║  │  Priority Pickup (1 ride)        │    ║
║  │  250 pts                         │    ║
║  │  [ Redeem ]                      │    ║
║  └──────────────────────────────────┘    ║
║  ┌──────────────────────────────────┐    ║
║  │  Premium Upgrade (1 ride)        │    ║
║  │  400 pts                         │    ║
║  │  [ Redeem ]                      │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**Confirm modal before deducting points.** On confirm: points deducted, credit/benefit applied to account, confirmation shown.

---

## 17. Wallet

### RS-017 · Wallet Screen

**Purpose:** Rider payment and financial hub — payment methods, savings tracker, and transaction history.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Wallet                               ║
╠══════════════════════════════════════════╣
║                                          ║
║  C-056 Ride Savings Tracker              ║
║  ┌──────────────────────────────────┐    ║
║  │  Your BidiRide Savings: $84.20    │    ║
║  │  vs. estimated market fares      │    ║
║  │  type-mono / text-teal           │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  ─── Payment Methods ───                 ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  💳 Visa ···· 4242   [Default]  │    ║
║  │                      [ Remove ] │    ║
║  └──────────────────────────────────┘    ║
║  ┌──────────────────────────────────┐    ║
║  │  🍎 Apple Pay         [ Use ]   │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  [ + Add Payment Method ]                ║
║  Ghost button                            ║
║                                          ║
║  ─── Transaction History ───             ║
║                                          ║
║  Jun 5  EWR → Hoboken      – $14.80      ║
║  Jun 3  Newark → NYC       – $28.40      ║
║  Jun 1  Hoboken → Newark   – $11.20      ║
║  type-body / chronological list          ║
║                                          ║
║  [ View All Transactions ]               ║
║  text-teal link                          ║
╚══════════════════════════════════════════╝
```

**Components:** C-056 (Ride Savings Tracker), C-005 (Empty State if no transactions)
**Empty State (no payment method):** Full-screen prompt to add payment method before viewing this screen.

---

## 18. Ride History

### RS-018 · Ride History

**Purpose:** Complete log of all past trips with enhanced details.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Ride History           [ Filter ]    ║
╠══════════════════════════════════════════╣
║                                          ║
║  This Month  ·  24 rides  ·  $338.40     ║
║  type-body / text-secondary              ║
║                                          ║
║  C-054 Ride History Cards (list):        ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Jun 5  ·  9:41 AM  [Bid ✓]     │    ║
║  │  EWR → Hoboken PATH  $12.00     │    ║
║  │  Saved $2.80 vs AI fare ↓ teal  │    ║
║  │                          ★5.0 > │    ║
║  └──────────────────────────────────┘    ║
║  ┌──────────────────────────────────┐    ║
║  │  Jun 3  ·  2:20 PM  [Standard]  │    ║
║  │  Newark → NYC Penn   $28.40     │    ║
║  │                          ★4.0 > │    ║
║  └──────────────────────────────────┘    ║
║  ┌──────────────────────────────────┐    ║
║  │  Jun 1  ·  11:00 AM [Cancelled] │    ║
║  │  Hoboken → EWR       ––         │    ║
║  │  Cancelled by rider  text-muted  │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  [Load More]  text-teal                  ║
╚══════════════════════════════════════════╝
```

**Components:** C-054 (Ride History Card Enhanced)
**Filters:** All · Completed · Cancelled · Bid rides · Corporate
**Empty State:** "You haven't taken any rides yet. Book your first ride to get started." + Book Now CTA
**Tap card → RS-018a (Trip Detail)**

---

### RS-018a · Trip Detail

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Trip Detail                          ║
╠══════════════════════════════════════════╣
║  ┌──────────────────────────────────┐    ║
║  │  [MAP — route taken]             │    ║
║  │  Pickup + destination pins       │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  Mon Jun 5, 2026  ·  9:41 AM            ║
║  8.2 mi  ·  21 min                       ║
║                                          ║
║  📍 EWR Terminal C, Newark              ║
║  📍 Hoboken PATH Station                 ║
║                                          ║
║  ─── Fare Breakdown ───                  ║
║  Fare paid:        $12.00 (bid accepted) ║
║  AI recommended:   $14.80               ║
║  You saved:        $2.80  ↑ text-teal   ║
║  Driver earned:    $9.00  text-gold      ║
║                                          ║
║  ─── Driver ───                          ║
║  [Photo] Marcus T.  ★ 5.0 (your rating) ║
║                                          ║
║  Points earned: +120 pts                 ║
║                                          ║
║  [ Download Receipt ]                    ║
║  [ Report an Issue ]                     ║
╚══════════════════════════════════════════╝
```

---

## 19. Settings

### RS-019 · Settings Screen

**Purpose:** App preferences, account management, and legal.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Settings                             ║
╠══════════════════════════════════════════╣
║                                          ║
║  [Photo]  James Rodriguez                ║
║  james@email.com  ·  ✓ Verified          ║
║  [ Edit Profile ]                        ║
║                                          ║
║  ─── RIDE PREFERENCES ───               ║
║  Default ride type       Standard  >    ║
║  Default tip amount      None      >    ║
║                                          ║
║  ─── NOTIFICATIONS ───                  ║
║  Ride updates            [●] On         ║
║  Driver found            [●] On         ║
║  Promotions              [○] Off        ║
║  Rewards updates         [●] On         ║
║                                          ║
║  ─── PRIVACY & SAFETY ───               ║
║  Safety Center            >             ║
║  Trusted Contacts         >             ║
║  Data & Privacy           >             ║
║                                          ║
║  ─── ACCOUNT ───                        ║
║  Payment Methods          >             ║
║  Referral Code            >             ║
║  Help & Support           >             ║
║  Terms of Service         >             ║
║  Privacy Policy           >             ║
║                                          ║
║  [ Sign Out ]  text-muted               ║
║  [ Delete Account ]  text-error         ║
╚══════════════════════════════════════════╝
```

**Delete Account:** Requires confirmation modal with "Delete" typed. Account deactivated (not immediately purged per data retention policy).

---

## 20. Notifications

### RS-020 · Notifications Screen

**Purpose:** Centralized inbox for all platform alerts and updates.

```
╔══════════════════════════════════════════╗
║  9:41                           ███ ███  ║
╠══════════════════════════════════════════╣
║  ←  Notifications       [ Mark all read ]║
╠══════════════════════════════════════════╣
║                                          ║
║  TODAY                                   ║
║  ┌──────────────────────────────────┐    ║
║  │  ●  Your driver is 2 min away   │    ║
║  │     Marcus T. is almost there   │    ║
║  │     9:38 AM                     │    ║
║  └──────────────────────────────────┘    ║
║  ┌──────────────────────────────────┐    ║
║  │     ⭐ You earned 148 pts!       │    ║
║  │     EWR → Hoboken ride           │    ║
║  │     9:41 AM                     │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  YESTERDAY                               ║
║  ┌──────────────────────────────────┐    ║
║  │     Your referral paid off!      │    ║
║  │     Sarah completed her 1st ride │    ║
║  │     +200 pts credited            │    ║
║  │     Jun 4  3:02 PM              │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  ─── Load Earlier ───                    ║
╚══════════════════════════════════════════╝
```

**Notification Types:** Ride updates (teal dot) · Safety alerts (red dot) · Rewards (gold) · Promotions (gray) · Account (gray)
**Tap behavior:** Each notification navigates to the relevant screen.
**Empty State:** "No notifications yet. You'll see ride updates, rewards, and safety alerts here."

---

## 21. Screen Inventory

| ID | Screen Name | Flow | MVP |
|---|---|---|---|
| RS-001 | Splash Screen | Onboarding | ✓ |
| RS-002 | Onboarding Carousel | Onboarding | ✓ |
| RS-003 | Sign Up | Auth | ✓ |
| RS-003a | Phone OTP Verification | Auth | ✓ |
| RS-003b | Email Verification Prompt | Auth | ✓ |
| RS-003c | Profile Setup | Auth | ✓ |
| RS-003d | Add Payment Method | Auth | ✓ |
| RS-004 | Login Screen | Auth | ✓ |
| RS-004a | Forgot Password | Auth | ✓ |
| RS-005v | Identity Verification (Elevated) | Verification | ✓ |
| RS-005 | Home Screen (Map View) | Core | ✓ |
| RS-006 | Destination Entry | Booking | ✓ |
| RS-006a | Airport Terminal Selector | Booking | ✓ |
| RS-007 | Fare Preview + Ride Options | Booking | ✓ |
| RS-008 | Bid Submission | Bidding | ✓ |
| RS-008a | Bid Pending | Bidding | ✓ |
| RS-008b | Counter-Offer Received | Bidding | ✓ |
| RS-009 | Driver Matching | Trip | ✓ |
| RS-009a | Driver Matched | Trip | ✓ |
| RS-010 | Driver En Route (Live Tracking) | Trip | ✓ |
| RS-010a | Driver Arrived | Trip | ✓ |
| RS-011 | In-Ride Screen | Trip | ✓ |
| RS-012s | Safety Center | Safety | ✓ |
| RS-012t | Trusted Contacts | Safety | ✓ |
| RS-013 | SOS Activation | Safety | ✓ |
| RS-014 | Trip Complete | Post-Trip | ✓ |
| RS-015 | Rate Your Driver + Tip | Post-Trip | ✓ |
| RS-016 | Rewards Dashboard | Rewards | Phase 2 |
| RS-016a | Redeem Rewards | Rewards | Phase 2 |
| RS-017 | Wallet Screen | Wallet | ✓ |
| RS-018 | Ride History | History | ✓ |
| RS-018a | Trip Detail | History | ✓ |
| RS-019 | Settings | Settings | ✓ |
| RS-020 | Notifications | Notifications | ✓ |

**Total Rider Screens: 34**
**MVP: 32 · Phase 2: 2 (Rewards)**

---

## 22. User Flow Summary

### Primary Booking Flow (Standard — No Bid)

```
RS-001 Splash
  → RS-005 Home Screen
    → RS-006 Destination Entry
      → RS-007 Fare Preview
        → RS-009 Matching
          → RS-009a Driver Matched
            → RS-010 Driver En Route
              → RS-010a Driver Arrived
                → RS-011 In-Ride
                  → RS-014 Trip Complete
                    → RS-015 Rate + Tip
                      → RS-005 Home Screen
```

### Bid Flow (Optional)

```
RS-007 Fare Preview
  → RS-008 Bid Submission
    → RS-008a Bid Pending
      → (accepted) RS-009 Matching
      → (counter) RS-008b Counter-Offer
        → (accepted) RS-009 Matching
        → (declined) RS-008a (next driver)
      → (timeout) RS-007 or RS-009 (AI fare)
```

### New Rider Onboarding Flow

```
RS-001 Splash
  → RS-002 Onboarding Carousel
    → RS-003 Sign Up
      → RS-003a Phone OTP
        → RS-003b Email Verification (deferrable)
          → RS-003c Profile Setup
            → RS-003d Add Payment
              → RS-005 Home Screen
```

### Airport Booking Flow (EWR)

```
RS-006 Destination Entry
  → RS-006a Terminal Selector (EWR detected)
    → RS-007 Fare Preview (terminal metadata attached)
      → RS-009 Matching (airport queue driver preferred)
        → RS-009a Driver Matched (terminal-specific pickup shown)
          → RS-010 Driver En Route
```

### Safety Flow (SOS)

```
RS-011 In-Ride Screen (SOS button always visible)
  → RS-013 SOS Confirmation (5-second cancel window)
    → RS-013 Active SOS (contacts notified, admin alerted, 911 CTA)
      → (resolved) → RS-011 In-Ride or RS-005 Home
```

### Post-Trip Issue Flow

```
RS-015 Rating Screen (1–2 star rating submitted)
  → Soft prompt: "Tell us what happened"
    → Optional incident report → admin support queue
      → RS-005 Home Screen
```

---

## Document Status

**Document:** 05-rider-app-ui.md
**Version:** 1.0 Draft
**Status:** Pending Founder Approval

**Coverage:**
- [x] Onboarding (5 screens)
- [x] Sign Up with full OTP + email + profile + payment flow
- [x] Login + Forgot Password
- [x] ID Verification (elevated, triggered)
- [x] Home Screen with all states, banners, edge cases
- [x] Ride Search + Airport Terminal Selector
- [x] Fare Preview with Ride Type Selector
- [x] Bid Submission + Bid Pending + Counter-Offer flow
- [x] Driver Matching + Matched screen
- [x] Driver En Route + Driver Arrived
- [x] In-Ride with AI monitoring and SOS
- [x] Safety Center + Trusted Contacts
- [x] SOS (3-state full machine)
- [x] Trip Complete with driver earnings transparency
- [x] Rating + Tips (with low-rating incident report)
- [x] Rewards Dashboard + Redeem
- [x] Wallet with Savings Tracker
- [x] Ride History (Enhanced) + Trip Detail
- [x] Settings with delete account
- [x] Notifications
- [x] Screen Inventory Table (34 screens)
- [x] User Flow Summary (6 key flows)

**Next document (pending this approval):**
`06-driver-app-ui.md` — Every driver screen with wireframes and flows

---

*BidiRide Rider App UI — Confidential*
*Delaware LLC — All rights reserved*
