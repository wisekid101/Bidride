# BidRide — Component Library v1.0

**Status:** Draft — Pending Founder Approval
**Document:** 04 of 10
**Prepared by:** Claude Code (Senior UX Architect / Senior Systems Architect)
**Date:** June 5, 2026
**Reference:** /design/03-design-system.md

> All components reference the Design System (03-design-system.md) for colors,
> typography, spacing, and tokens. No component overrides the Design System.
> No code. Architecture and UI specification only.

---

## Table of Contents

1. [Shared / Universal Components](#1-shared--universal-components)
2. [Fare Components](#2-fare-components)
3. [Bid Components](#3-bid-components)
4. [Driver Components](#4-driver-components)
5. [Rider Components](#5-rider-components)
6. [Airport Queue Components](#6-airport-queue-components)
7. [Earnings Components](#7-earnings-components)
8. [Safety Components](#8-safety-components)
9. [Heatmap Components](#9-heatmap-components)
10. [AI Recommendation Components](#10-ai-recommendation-components)
11. [Marketplace Metrics Components](#11-marketplace-metrics-components)
12. [Founder Command Center Components](#12-founder-command-center-components)
13. [Admin Components](#13-admin-components)
14. [Component Inventory Table](#14-component-inventory-table)

---

## 1. Shared / Universal Components

These components appear across Rider App, Driver App, and/or Admin Dashboard.

---

### C-001 · Avatar

**Purpose:** Display a user's profile photo with fallback initials.

```
╔══════════════════════════════════════════╗
║  SIZE VARIANTS:                          ║
║                                          ║
║  XS (24px)   SM (36px)   MD (48px)      ║
║   [JD]        [JD]        [JD]           ║
║                                          ║
║  LG (64px)              XL (96px)        ║
║    [JD]                   [JD]           ║
║                                          ║
║  WITH STATUS DOT (MD):                   ║
║   [Photo]                                ║
║         ●  ← status dot, 10px           ║
║             bottom-right corner          ║
╚══════════════════════════════════════════╝
```

**Variants:**
- Photo: displays user's profile image, cropped to circle
- Initials: 2-letter fallback (First + Last initial), `text-primary` on `bg-secondary`
- With status dot: overlaid 10px dot at bottom-right

**States:**
- Default: static photo or initials
- Online (driver): `status-online` green dot
- On trip (driver): `status-on-trip` gold dot
- Offline (driver): `status-offline` gray dot, image desaturated

**Data Fields:**
- `photo_url` (string | null)
- `full_name` (string — used for initials fallback)
- `status` (online | on_trip | offline | null)

**Sizes:** XS 24px · SM 36px · MD 48px · LG 64px · XL 96px

**Behavior — All Breakpoints:** Fixed size, never scales. Used inline or as standalone.

---

### C-002 · Star Rating

**Purpose:** Display a numeric rating as stars with a numeric label.

```
╔══════════════════════════════════════════╗
║                                          ║
║  DISPLAY (read-only):                    ║
║  ★★★★★  4.92                            ║
║  Gold filled stars / gray empty stars    ║
║                                          ║
║  INTERACTIVE (rate driver/rider):        ║
║  ☆ ☆ ☆ ☆ ☆   Tap to rate              ║
║  ★ ★ ★ ★ ☆   4 stars selected          ║
║                                          ║
║  Star size: 20px (display) / 36px (input)║
║  Color: #F4B400 filled / #3A6490 empty  ║
╚══════════════════════════════════════════╝
```

**Variants:**
- Display: static, shows score with number (e.g., "★ 4.92")
- Input: interactive tap-to-rate, large stars
- Compact: single star + number only (e.g., "★ 4.9") for space-constrained contexts

**States:**
- Default (display): full or partial fill
- Hover (input): stars fill progressively left to right
- Selected (input): filled through selected star, empty after
- Submitted: returns to display variant with locked value

**Data Fields:**
- `score` (decimal 1.0–5.0)
- `total_ratings` (integer — shown in parentheses on profile screens)
- `interactive` (boolean)

---

### C-003 · Status Chip

**Purpose:** Compact status badge for accounts, trips, documents, and alerts.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ● Active        ● Online               ║
║  ● On Trip       ○ Offline              ║
║  ● Pending       ✕ Suspended            ║
║  ✓ Verified      ⚠ Flagged             ║
║                                          ║
║  Pill shape: radius-pill                 ║
║  Height: 24px  Padding: 6px 10px        ║
║  Font: type-label-s                      ║
║                                          ║
║  COLOR MAP:                              ║
║  Active/Online:  bg-teal/10  text-teal   ║
║  On Trip:        bg-gold/10  text-gold   ║
║  Pending:        bg-warning/10 text-warn ║
║  Flagged:        bg-warning/10 text-warn ║
║  Suspended/Error:bg-error/10  text-error ║
║  Offline:        bg-border    text-muted ║
║  Verified:       bg-success/10 text-succ ║
╚══════════════════════════════════════════╝
```

**Variants:** Active · Online · On Trip · Offline · Pending · Verified · Flagged · Suspended · Banned · Expired · Approved · Rejected

**Data Fields:**
- `status` (string — maps to variant)
- `label_override` (string | null — custom label)

**Behavior — All Breakpoints:** Inline element. Never wraps. Truncates label with ellipsis if > 12 characters.

---

### C-004 · Divider

**Purpose:** Separate content sections.

```
╔══════════════════════════════════════════╗
║                                          ║
║  HORIZONTAL:                             ║
║  ─────────────────────────────           ║
║  color: border-subtle  height: 1px       ║
║                                          ║
║  WITH LABEL:                             ║
║  ────────  or  ────────                  ║
║  color: border-subtle                    ║
║  label: type-caption / text-muted        ║
║                                          ║
║  VERTICAL (inline):                      ║
║  Item 1  │  Item 2  │  Item 3            ║
║  color: border-subtle  width: 1px        ║
╚══════════════════════════════════════════╝
```

**Variants:** Horizontal · Horizontal with label · Vertical

---

### C-005 · Empty State

**Purpose:** Inform the user when a list or section has no content.

```
╔══════════════════════════════════════════╗
║                                          ║
║              [Icon 48px]                 ║
║                                          ║
║           No rides yet                   ║
║    type-h3 / text-primary                ║
║                                          ║
║    Book your first ride to get           ║
║    started with BidRide.                 ║
║    type-body / text-secondary            ║
║                                          ║
║         [ Book a Ride ]                  ║
║         Primary button (optional)        ║
╚══════════════════════════════════════════╝
```

**Data Fields:**
- `icon` (icon name)
- `title` (string)
- `description` (string)
- `cta_label` (string | null)
- `cta_action` (navigation action | null)

---

### C-006 · Bottom Sheet

**Purpose:** Slide-up panel for contextual actions and information without leaving the current screen.

```
╔══════════════════════════════════════════╗
║                                          ║
║  [Map or background screen behind]       ║
║                                          ║
║  ╔════════════════════════════════════╗  ║
║  ║     ─────  ← drag handle          ║  ║
║  ║                                   ║  ║
║  ║  Sheet Title                      ║  ║
║  ║                                   ║  ║
║  ║  Content area (scrollable)        ║  ║
║  ║                                   ║  ║
║  ║  [ Primary Action ]               ║  ║
║  ║  [ Secondary Action ]             ║  ║
║  ╚════════════════════════════════════╝  ║
║                                          ║
║  bg: elevation-overlay (#132E52)         ║
║  radius: radius-xl on top corners only   ║
║  shadow: shadow-xl                        ║
║  drag handle: 36×4px, bg-border, centered║
╚══════════════════════════════════════════╝
```

**Variants:**
- Fixed: set height, no scroll
- Scrollable: full content scrolls within sheet
- Full-screen: extends to top of safe area (e.g., bid screen)

**States:**
- Closed: offscreen below viewport
- Half: peeks at 50% screen height
- Full: 90% screen height
- Drag: follows finger velocity with snap points

**Behavior:**
- Mobile: slide up, swipe down to dismiss
- Tablet: slide up or render as modal dialog (centered)
- Desktop: renders as modal dialog centered on screen

---

### C-007 · Modal Dialog

**Purpose:** Require user acknowledgment or a decision before proceeding.

```
╔══════════════════════════════════════════╗
║  [Dimmed background overlay]             ║
║                                          ║
║       ┌──────────────────────┐           ║
║       │  Cancel this ride?   │           ║
║       │                      │           ║
║       │  You may be charged  │           ║
║       │  a $2.00 cancellation│           ║
║       │  fee.                │           ║
║       │                      │           ║
║       │  [ Cancel Ride ]     │           ║
║       │  [ Keep Ride ]       │           ║
║       └──────────────────────┘           ║
║  bg: elevation-modal  radius: radius-lg  ║
║  max-width: 320px  padding: space-6      ║
║  Overlay: bg-overlay 85% opacity         ║
╚══════════════════════════════════════════╝
```

**Variants:**
- Confirmation: 2 actions (confirm + cancel)
- Alert: 1 action (acknowledge)
- Input: form field inside modal
- Full-screen modal: used for legal content (ToS, Privacy Policy)

**Behavior:**
- Mobile: centers over screen, keyboard-aware
- Tablet/Desktop: always centered modal, not bottom sheet

---

### C-008 · Loading Spinner

**Purpose:** Indicate background processing.

```
╔══════════════════════════════════════════╗
║                                          ║
║  SM (20px)   MD (32px)   LG (48px)      ║
║    ◌             ◌             ◌          ║
║                                          ║
║  Color: teal (#00D4C6)                   ║
║  Animation: 1.2s linear rotation         ║
║  Stroke: 2.5px (SM) / 3px (MD) / 4px(LG)║
╚══════════════════════════════════════════╝
```

**Variants:** SM · MD · LG · Inline (replaces button label) · Overlay (centered on screen with dimming)

---

### C-009 · Progress Bar

**Purpose:** Show completion progress for multi-step flows (onboarding, verification, trip).

```
╔══════════════════════════════════════════╗
║                                          ║
║  STEP PROGRESS (onboarding):             ║
║  ● ─── ● ─── ○ ─── ○                    ║
║  Completed  Active    Upcoming           ║
║  teal dot   teal dot  gray dot           ║
║                                          ║
║  LINEAR PROGRESS (trip):                 ║
║  ████████████░░░░░░░░  60%               ║
║  bg-teal filled / bg-border track        ║
║  height: 4px  radius: radius-pill        ║
╚══════════════════════════════════════════╝
```

**Variants:**
- Step dots: for onboarding, verification multi-step flows
- Linear bar: for trip progress, upload progress
- Circular: for earnings targets, rewards tier progress

**Data Fields:**
- `current_step` (integer)
- `total_steps` (integer)
- `percentage` (0–100, for linear)

---

### C-010 · Tab Bar (Mobile Navigation)

**Purpose:** Primary navigation for Rider and Driver apps.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  🏠     🚗     💰     👤     🛡  │    ║
║  │ Home  Rides  Wallet Profile Safety│    ║
║  │                                  │    ║
║  │  Active tab: teal icon + label   │    ║
║  │  Inactive: gray icon, no label   │    ║
║  └──────────────────────────────────┘    ║
║  bg: bg-primary (#0A2342)                ║
║  height: 56px + safe area                ║
║  border-top: 1px border-subtle           ║
║  icon: 24px  label: type-label-s         ║
║  notification badge: red dot, top-right  ║
╚══════════════════════════════════════════╝
```

**Rider Tabs:** Home · Rides · Wallet · Profile · Safety
**Driver Tabs:** Home · Earnings · Map · Profile · Safety

**States:**
- Active: teal icon + teal label below
- Inactive: gray icon, no label
- Badge: red notification dot (top-right of icon)

**Behavior:**
- Mobile only — hidden on tablet/desktop (side navigation used instead)
- Tap selects tab, highlights icon, navigates to screen
- Long-press on Home: no action (avoids accidental)

---

### C-011 · Navigation Header

**Purpose:** Screen-level header with title and contextual actions.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ← Earnings          [Filter]  [Export] ║
║  type-h2 / text-primary                  ║
║                                          ║
║  bg: bg-primary or transparent (map)     ║
║  height: 56px                            ║
║  Back: 44×44px touch target, left        ║
║  Actions: right-aligned, up to 2         ║
╚══════════════════════════════════════════╝
```

**Variants:**
- Standard: title + optional back + optional 1–2 right actions
- Transparent: no background (floats over map)
- Large title: title below header bar (iOS-style collapse on scroll)

---

## 2. Fare Components

---

### C-020 · Fare Preview Card

**Purpose:** Display the AI-recommended fare to a rider before they commit to a ride.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ◈ BidRide AI Fare               │    ║
║  │  ─────────────────────────────── │    ║
║  │                                  │    ║
║  │         $14.80                   │    ║
║  │   type-mono-l / text-primary     │    ║
║  │                                  │    ║
║  │  8.2 mi  ·  Est. 19 min  · ↑ EWR│    ║
║  │  type-body-s / text-secondary    │    ║
║  │                                  │    ║
║  │  ▼ See fare breakdown            │    ║
║  │    type-caption / text-teal      │    ║
║  │  ─────────────────────────────── │    ║
║  │  ◈ Driver earnings protected     │    ║
║  │    type-caption / text-teal      │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-surface (white)           ║
║  border-top: 4px solid #00D4C6           ║
║  shadow: shadow-lg                        ║
║  radius: radius-md (bottom corners only) ║
╚══════════════════════════════════════════╝
```

**Variants:**
- Standard: AI fare, no active bid
- With accepted bid: shows original AI fare struck through, accepted bid in teal
- Priority: gold accent, "Priority Pickup" badge
- Premium: navy badge "Premium Vehicle"

**States:**
- Loading: skeleton shimmer while AI calculates
- Active: full display, countdown timer if fare expires
- Expired: blur overlay, "Fare updated — tap to refresh"
- Locked: after rider accepts, shows confirmed checkmark

**Data Fields:**
- `ai_fare` (decimal — formatted as currency)
- `distance_miles` (decimal)
- `estimated_minutes` (integer)
- `pickup_eta_minutes` (integer — driver ETA to pickup)
- `fare_breakdown` (object: base, per_mile, per_minute, adjustments)
- `ride_type` (standard | priority | premium)
- `expires_at` (timestamp — fare validity window, 60s)
- `floor_applied` (boolean — show "Driver earnings protected" indicator)

**Mobile Behavior:** Bottom sheet card anchored to bottom of map screen. Expandable breakdown on tap.
**Tablet/Desktop Behavior:** Side panel card next to map.

---

### C-021 · Fare Breakdown Panel

**Purpose:** Transparent itemization of how the fare was calculated. Expands from C-020.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Fare Breakdown            [×]   │    ║
║  │  ─────────────────────────────── │    ║
║  │  Base fare             $3.00     │    ║
║  │  Distance (8.2 mi)     $6.89     │    ║
║  │  Time (19 min)         $4.18     │    ║
║  │  Airport demand adj.   +$0.73    │    ║
║  │  ─────────────────────────────── │    ║
║  │  Total fare            $14.80    │    ║
║  │                                  │    ║
║  │  Driver receives:      $11.10    │    ║
║  │  (75% — BidRide standard)        │    ║
║  │  type-caption / text-gold        │    ║
║  └──────────────────────────────────┘    ║
║  Appears as: bottom sheet or inline      ║
║  expand under Fare Preview Card          ║
╚══════════════════════════════════════════╝
```

**Design Rule:** Driver earnings line is always shown in `text-gold`. Rider sees what driver makes — this is BidRide's transparency promise. Never hide or remove this line.

**Data Fields:**
- `line_items` (array: label, amount, type: base|distance|time|adjustment)
- `total_fare` (decimal)
- `driver_earnings` (decimal)
- `driver_payout_pct` (integer — displayed as percentage)

---

### C-022 · Ride Type Selector

**Purpose:** Allow rider to choose between Standard, Priority, and Premium ride options.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌────────┐  ┌────────┐  ┌────────┐     ║
║  │  🚗    │  │  ⚡    │  │  ⭐    │     ║
║  │Standard│  │Priority│  │Premium │     ║
║  │ $14.80 │  │ $18.60 │  │ $22.40 │     ║
║  │ 4 min  │  │ 2 min  │  │ 4 min  │     ║
║  └────────┘  └────────┘  └────────┘     ║
║                                          ║
║  SELECTED state (Standard):              ║
║  ┌────────┐                              ║
║  │  🚗    │  border: 2px teal            ║
║  │Standard│  bg: rgba(0,212,198,0.08)   ║
║  │ $14.80 │  label: teal                 ║
║  │ ✓      │                              ║
║  └────────┘                              ║
║                                          ║
║  Each card: ~110px wide, radius-md       ║
║  Scrollable horizontally if > 3 options  ║
╚══════════════════════════════════════════╝
```

**Variants:**
- Standard: default AI fare, standard ETA
- Priority: premium for front-of-queue dispatch, faster ETA, higher fare
- Premium: premium vehicle tier, higher fare
- BidRide XL (Phase 3): large vehicle option

**States per card:**
- Default: unselected, border-subtle
- Selected: teal border + teal checkmark + teal label + subtle teal bg
- Unavailable (no drivers): grayed out, "Not available" label

**Data Fields per option:**
- `type` (standard | priority | premium)
- `fare` (decimal)
- `eta_minutes` (integer)
- `available` (boolean)
- `icon` (icon name)

**Mobile Behavior:** 3 cards in horizontal row. Scrollable if > 3.
**Tablet/Desktop:** All options visible, no scroll.

---

### C-023 · Fare Confirmation Banner

**Purpose:** Show accepted fare prominently during matching and en-route phases.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ✓ Fare confirmed  ·  $14.80     │    ║
║  │  Standard  ·  Driver earnings:   │    ║
║  │  $11.10 (75%)     type-gold      │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-raised                    ║
║  border-left: 4px status-success         ║
║  Fixed at top of screen during matching  ║
╚══════════════════════════════════════════╝
```

**States:** Confirmed · Processing · Cancelled

---

## 3. Bid Components

---

### C-030 · Bid Input Card

**Purpose:** Allow riders to submit a lower fare offer. Never shown by default — only on explicit "Make an Offer" tap.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Make an Offer                   │    ║
║  │  ─────────────────────────────── │    ║
║  │  AI recommends: $14.80           │    ║
║  │  type-body-s / text-secondary    │    ║
║  │                                  │    ║
║  │        $ [  12.00  ]             │    ║
║  │        type-mono-l / centered    │    ║
║  │                                  │    ║
║  │  ←─────────────────────→         │    ║
║  │  $10.50 (min)       $14.80 (AI)  │    ║
║  │  Slider: teal thumb, navy track  │    ║
║  │                                  │    ║
║  │  ⚠ Minimum fare to protect       │    ║
║  │    driver earnings: $10.50       │    ║
║  │    type-caption / text-warning   │    ║
║  │                                  │    ║
║  │  Offers near AI fare are         │    ║
║  │  accepted 3× faster.             │    ║
║  │  type-caption / text-secondary   │    ║
║  │                                  │    ║
║  │  [ Submit Offer — $12.00 ]       │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**States:**
- Default: slider at AI-recommended fare
- Below floor: slider stops at floor minimum, warning visible
- At floor: warning shows, submit allowed
- Above AI fare: not possible (slider caps at AI fare)
- Submitted: loading state, then transitions to matching screen

**Data Fields:**
- `ai_fare` (decimal — slider maximum)
- `floor_minimum` (decimal — slider minimum, AI-enforced)
- `rider_offer` (decimal — current slider/input value)
- `floor_label` (string — "Minimum fare to protect driver earnings")
- `acceptance_likelihood` (string — "faster / slower" hint)

**Mobile Behavior:** Full-screen bottom sheet. Slider or numeric input (toggle between).
**Tablet/Desktop:** Side panel or modal.

**Critical Rule:** The floor minimum enforced here must match the value enforced server-side. The UI cannot accept a value the API will reject. Floor must be computed from the same formula.

---

### C-031 · Bid Status Card

**Purpose:** Show the rider the status of their submitted offer while waiting for a driver response.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Your offer: $12.00              │    ║
║  │  type-mono / text-teal           │    ║
║  │                                  │    ║
║  │  ○ ─── Waiting for driver...     │    ║
║  │  Animated pulse on circle        │    ║
║  │                                  │    ║
║  │  AI fare ($14.80) is standing by │    ║
║  │  type-caption / text-secondary   │    ║
║  │                                  ║    ║
║  │  [ Accept AI Fare Instead ]      │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**States:**
- Pending: pulsing wait indicator, escape hatch to accept AI fare
- Accepted: success animation, transitions to matching screen
- Declined: "Driver declined your offer" — show AI fare accept button
- Counter-offer received: transitions to C-032

---

### C-032 · Counter-Offer Card

**Purpose:** Show the rider a driver's counter-offer for their decision.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Driver Counter-Offer            │    ║
║  │  ─────────────────────────────── │    ║
║  │  Your offer:           $12.00    │    ║
║  │  Driver asks:          $13.50    │    ║
║  │  type-mono / text-gold           │    ║
║  │                                  │    ║
║  │  AI recommended:       $14.80    │    ║
║  │  type-body-s / text-secondary    │    ║
║  │                                  │    ║
║  │  ⏱  Expires in 24s              │    ║
║  │  type-caption / text-warning     │    ║
║  │                                  │    ║
║  │  [ Accept $13.50 ]               │    ║
║  │  [ Decline — find next driver ]  │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**States:**
- Active: countdown timer running
- Accepted: confirmation, transitions to matching
- Expired: "Offer expired — searching next driver"
- Declined: next driver dispatched

**Data Fields:**
- `rider_original_offer` (decimal)
- `driver_counter` (decimal)
- `ai_fare` (decimal — reference anchor)
- `expires_at` (timestamp — countdown)

---

### C-033 · Driver Incoming Request Card (Driver-side bidding)

**Purpose:** Show the driver the ride request with fare details and options to accept, decline, or counter.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  New Ride Request         ⏱ 28s  │    ║
║  │  ─────────────────────────────── │    ║
║  │  [★ 4.8]  James R.               │    ║
║  │                                  │    ║
║  │  📍 Terminal C, EWR   ← 0.8 mi   │    ║
║  │  ↓                               │    ║
║  │  📍 Hoboken PATH Station          │    ║
║  │     12.4 mi  ·  Est. 24 min      │    ║
║  │                                  │    ║
║  │  Fare offered:        $22.40     │    ║
║  │  type-mono / text-gold           │    ║
║  │  Your earnings:       $16.80     │    ║
║  │  Est. hourly rate:    $38/hr     │    ║
║  │  type-body-s / text-secondary    │    ║
║  │                                  │    ║
║  │  [✓ Accept]  [✕ Decline]         │    ║
║  │                                  │    ║
║  │  [ Counter-Offer ]               │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-overlay                   ║
║  border-top: 4px text-gold (earnings)    ║
║  Animation: slides up from bottom        ║
╚══════════════════════════════════════════╝
```

**States:**
- Incoming: full display, countdown timer
- Timer < 10s: timer turns red, pulses
- Expired: card dismisses, "Request expired" toast
- Rider bid active: label shows "Rider offer:" instead of "Fare offered:"

**Data Fields:**
- `rider_first_name` (string)
- `rider_rating` (decimal)
- `pickup_address` (string)
- `pickup_distance_miles` (decimal — driver to pickup)
- `destination_address` (string)
- `trip_distance_miles` (decimal)
- `trip_duration_minutes` (integer)
- `fare_offered` (decimal)
- `driver_earnings` (decimal — pre-calculated)
- `estimated_hourly_rate` (decimal — AI-calculated)
- `is_rider_bid` (boolean)
- `expires_at` (timestamp)

**Mobile Behavior:** Slides up as bottom sheet with haptic feedback. Full-width.
**Audio:** Notification sound + vibration on receipt.

---

## 4. Driver Components

---

### C-040 · Driver Online/Offline Toggle

**Purpose:** Primary control for driver availability. High-stakes — requires confirmation.

```
╔══════════════════════════════════════════╗
║                                          ║
║  OFFLINE STATE:                          ║
║  ┌──────────────────────────────────┐    ║
║  │  You are offline                 │    ║
║  │  text-muted                      │    ║
║  │                                  │    ║
║  │        [ Go Online ]             │    ║
║  │        Gold button, large        │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  ONLINE STATE:                           ║
║  ┌──────────────────────────────────┐    ║
║  │  ● You are online                │    ║
║  │  Green dot, text-success         │    ║
║  │                                  │    ║
║  │  Waiting for requests...         │    ║
║  │  text-secondary                  │    ║
║  │                                  │    ║
║  │        [ Go Offline ]            │    ║
║  │        Ghost button, medium      │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**States:**
- Offline: gold "Go Online" button (prominent)
- Selfie required: triggers selfie verification before going online
- Going online: loading spinner while selfie processes
- Online: green status, ghost "Go Offline" button
- On trip: toggle hidden (cannot go offline mid-trip)

**Behavior:**
- Go Online → triggers pre-shift selfie (C-041) if required
- Selfie pass → status set to online, map activates
- Selfie fail → returns to offline state, error shown
- Go Offline while waiting → immediate, no confirmation needed
- Go Offline while on trip → blocked, tooltip "Complete your current trip first"

---

### C-041 · Pre-Shift Selfie Component

**Purpose:** Capture and biometrically verify the driver before each shift.

```
╔══════════════════════════════════════════╗
║                                          ║
║  Take your pre-shift selfie              ║
║  type-h2 / centered                      ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │                                  │    ║
║  │    ┌──────────────────────┐      │    ║
║  │    │                      │      │    ║
║  │    │   [Camera Preview]   │      │    ║
║  │    │                      │      │    ║
║  │    │    ○  face guide     │      │    ║
║  │    └──────────────────────┘      │    ║
║  │                                  │    ║
║  │  Position your face in the oval  │    ║
║  │  type-body-s / text-secondary    │    ║
║  │                                  │    ║
║  │        [ Take Photo ]            │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  VERIFYING STATE:                        ║
║  ◐ Verifying identity...                 ║
║  Spinner + message                       ║
║                                          ║
║  PASS STATE:                             ║
║  ✓ Identity confirmed. Going online.     ║
║  Green checkmark animation               ║
║                                          ║
║  FAIL STATE:                             ║
║  ✕ Unable to verify. Try again.          ║
║  [ Retry ] [ Contact Support ]           ║
╚══════════════════════════════════════════╝
```

**States:** Camera ready · Capturing · Verifying · Pass · Fail · Max retries exceeded

**Data Fields:**
- `photo_captured` (base64 image — not stored, sent for biometric check)
- `verification_status` (pending | pass | fail)
- `retry_count` (integer — max 3 retries before lockout)

**Privacy Note:** Selfie image is used only for biometric comparison. Not stored after verification. Display this note in the UI below the camera.

---

### C-042 · Driver Trip Summary Card

**Purpose:** Show driver a compact summary of a completed trip and earnings.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Trip Complete  ·  Mon 9:41 AM   │    ║
║  │  ─────────────────────────────── │    ║
║  │  📍 EWR Terminal C               │    ║
║  │  ↓   12.4 mi  ·  24 min          │    ║
║  │  📍 Hoboken PATH Station          │    ║
║  │  ─────────────────────────────── │    ║
║  │  Fare:          $22.40            │    ║
║  │  Platform fee:  – $5.60  (25%)   │    ║
║  │  Your earnings: $16.80           │    ║
║  │                 type-gold        │    ║
║  │  Tip:           $2.00            │    ║
║  │  ─────────────────────────────── │    ║
║  │  Total earned:  $18.80           │    ║
║  │                 type-mono-l/gold │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**Data Fields:**
- `trip_date` (timestamp)
- `pickup_address` (string)
- `destination_address` (string)
- `distance_miles` (decimal)
- `duration_minutes` (integer)
- `gross_fare` (decimal)
- `platform_fee` (decimal)
- `platform_fee_pct` (integer)
- `driver_earnings` (decimal)
- `tip_amount` (decimal)
- `total_earned` (decimal)

---

### C-043 · Driver Verification Status Tracker

**Purpose:** Show driver their onboarding verification progress step by step.

```
╔══════════════════════════════════════════╗
║                                          ║
║  Application Progress                    ║
║  type-h3                                 ║
║                                          ║
║  ✓  Identity Verified                    ║
║     type-body-s / text-success           ║
║                                          ║
║  ✓  Driver License                       ║
║     Approved                             ║
║                                          ║
║  ✓  Vehicle Registration                 ║
║     Approved                             ║
║                                          ║
║  ⟳  Background Check                    ║
║     In progress · Est. 24–48 hrs         ║
║     text-warning                         ║
║                                          ║
║  ○  Insurance Document                   ║
║     Action required                      ║
║     [ Upload Insurance ]                 ║
║     text-error / teal button             ║
║                                          ║
║  ○  Vehicle Photos                       ║
║     Pending                              ║
║     text-muted                           ║
╚══════════════════════════════════════════╝
```

**States per step:**
- Complete: teal checkmark, "Approved" label
- In Progress: spinning indicator, estimated time
- Action Required: red circle, descriptive error, CTA button
- Pending: gray empty circle, "Pending" label
- Failed: red X, reason + retry CTA

**Data Fields:**
- `steps` (array): `{ id, label, status, reason, cta_label, cta_action }`

---

## 5. Rider Components

---

### C-050 · Rider Safety Banner

**Purpose:** Persistent but non-intrusive safety reminder during active trips.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  🛡  Trip being monitored by AI  │    ║
║  │     Tap SOS anytime for help     │    ║
║  └──────────────────────────────────┘    ║
║  bg: rgba(0,212,198,0.08)                ║
║  border: 1px border-teal                 ║
║  radius: radius-sm                       ║
║  height: 44px (compact, non-blocking)    ║
╚══════════════════════════════════════════╝
```

**Variants:**
- Standard: teal AI monitoring message
- Trusted contact notified: "Marcus has been sent your trip link"
- Alert: amber if AI detects soft anomaly
- Hidden: dismissed by rider for this trip (remembered per session)

---

### C-051 · Live ETA Chip

**Purpose:** Show dynamic ETA during driver en-route and in-ride phases.

```
╔══════════════════════════════════════════╗
║                                          ║
║  EN ROUTE TO PICKUP:                     ║
║  ┌────────────────────────┐              ║
║  │  🚗  Marcus · 4 min   │              ║
║  └────────────────────────┘              ║
║                                          ║
║  IN RIDE — TO DESTINATION:               ║
║  ┌────────────────────────┐              ║
║  │  📍  Hoboken · 11 min  │              ║
║  └────────────────────────┘              ║
║                                          ║
║  Pill shape: radius-pill                 ║
║  bg: elevation-raised                    ║
║  shadow: shadow-md                        ║
║  Updates every 15–30 seconds             ║
║  Floats over map, top of screen          ║
╚══════════════════════════════════════════╝
```

**States:** En route to pickup · In ride · Arriving · Arrived

**Data Fields:**
- `phase` (en_route | in_ride | arriving | arrived)
- `eta_minutes` (integer — updates via WebSocket)
- `driver_name` (string — en route phase only)
- `destination_label` (string — in ride phase)

---

### C-052 · Rewards Points Badge

**Purpose:** Persistent display of rider's rewards balance and tier in the app header.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌─────────────┐                         ║
║  │  ⭐  2,840  │                         ║
║  │   GOLD      │                         ║
║  └─────────────┘                         ║
║  Pill shape, gold border                 ║
║  bg: rgba(244,180,0,0.10)               ║
║  text-gold / type-label-s                ║
║  Tier label below points: type-caption   ║
║  Tappable → routes to Rewards screen     ║
╚══════════════════════════════════════════╝
```

**Tier Color Mapping:**
- Silver: `#C0C0C0` border/text
- Gold: `#F4B400` border/text
- Platinum: `#E5E4E2` border/text (platinum shimmer)
- Elite: `#00D4C6` border/text (teal — exclusive)

---

### C-053 · Rider Trip Card (History)

**Purpose:** Compact trip record in the ride history list.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Mon Jun 2  ·  9:41 AM     $14.80│    ║
║  │  ─────────────────────────────── │    ║
║  │  📍 EWR Terminal C               │    ║
║  │  ↓                               │    ║
║  │  📍 Hoboken PATH Station          │    ║
║  │                          ★ 5.0 > │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-raised  radius: radius-md ║
║  border-left: 3px border-teal            ║
║  Entire card tappable → trip detail      ║
╚══════════════════════════════════════════╝
```

**Variants:**
- Standard: completed ride
- Cancelled: border-left in `border-error`, "Cancelled" chip
- Corporate: company name chip on card
- Bid accepted: "Bid" chip showing rider's accepted offer

**Data Fields:**
- `date` (formatted string)
- `time` (formatted string)
- `pickup_address` (string)
- `destination_address` (string)
- `final_fare` (decimal)
- `rating_given` (decimal | null)
- `status` (completed | cancelled)
- `is_bid` (boolean)
- `corporate_account_name` (string | null)

---

## 6. Airport Queue Components

---

### C-060 · Airport Queue Status Card

**Purpose:** Show driver their position in the EWR virtual queue and live demand context.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ✈  EWR Airport Queue            │    ║
║  │  ─────────────────────────────── │    ║
║  │                                  │    ║
║  │  Queue Position                  │    ║
║  │        #7                        │    ║
║  │  type-display / text-gold        │    ║
║  │                                  │    ║
║  │  Est. wait:  ~18 min             │    ║
║  │  Next flight: UA 447 · 12 min    │    ║
║  │  Terminal C · 187 passengers     │    ║
║  │                                  │    ║
║  │  Projected earnings:  $22–$28    │    ║
║  │  type-mono / text-gold           │    ║
║  │                                  │    ║
║  │  ─────────────────────────────── │    ║
║  │  [ Leave Queue ]                 │    ║
║  │  Ghost button / no penalty       │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-raised                    ║
║  border: 1px border-gold                 ║
╚══════════════════════════════════════════╝
```

**States:**
- Queued: shows position, estimated wait, flight data
- Moving up: position updates with animation
- Next up (#1): "You're next!" gold highlight, pulse animation
- Assigned: "Ride incoming — Terminal C, Door 4" alert
- Left queue: card dismissed

**Data Fields:**
- `queue_position` (integer)
- `estimated_wait_minutes` (integer)
- `next_flight` (object: flight_number, airline, terminal, eta_minutes, passenger_estimate)
- `projected_earnings_min` (decimal)
- `projected_earnings_max` (decimal)
- `terminal_assignment` (string | null — set when assigned)

**Mobile Behavior:** Full-width card in driver home screen when in airport zone. Replaces standard waiting state.
**Tablet/Desktop:** Not applicable (driver-only mobile component).

---

### C-061 · Terminal Pickup Guide Card

**Purpose:** Direct driver to exact pickup location at EWR after being matched with an airport rider.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ✈  Airport Pickup               │    ║
║  │  ─────────────────────────────── │    ║
║  │                                  │    ║
║  │  Terminal C                      │    ║
║  │  type-h1 / text-gold             │    ║
║  │                                  │    ║
║  │  Arrivals Level · Door 4         │    ║
║  │  TNC Rideshare Lane 2            │    ║
║  │  type-body / text-primary        │    ║
║  │                                  │    ║
║  │  📍 Rider: James R.              │    ║
║  │     Look for: Blue BidRide sign  │    ║
║  │                                  │    ║
║  │  ⚠ Stay in lane. EWR officers    │    ║
║  │    monitor rideshare pickup area.│    ║
║  │  type-caption / text-warning     │    ║
║  │                                  │    ║
║  │  [ Navigate to Terminal C ]      │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**Data Fields:**
- `terminal` (string: A | B | C)
- `level` (string: Arrivals | Departures)
- `door_number` (string)
- `lane_number` (string | null)
- `rider_first_name` (string)
- `navigation_coordinates` (lat/lng)

---

### C-062 · Flight Demand Strip

**Purpose:** Show condensed upcoming flight arrivals to help drivers time their airport positioning.

```
╔══════════════════════════════════════════╗
║                                          ║
║  EWR Arrivals — Next 90 min             ║
║                                          ║
║  ┌──────┬───────┬──────┬────────────┐   ║
║  │ ETA  │Flight │ Term │ Passengers │   ║
║  ├──────┼───────┼──────┼────────────┤   ║
║  │ 8min │UA 447 │  C   │ ●●● 187    │   ║
║  │12min │AA 821 │  A   │ ●● 142     │   ║
║  │31min │DL 334 │  B   │ ●●●● 220   │   ║
║  │47min │UA 112 │  C   │ ●● 156     │   ║
║  └──────┴───────┴──────┴────────────┘   ║
║                                          ║
║  Passenger dots: 1 dot = ~50 passengers  ║
║  bg: elevation-raised  radius: radius-md ║
║  Scrollable if > 4 rows                  ║
╚══════════════════════════════════════════╝
```

**Data Fields per row:**
- `eta_minutes` (integer)
- `flight_number` (string)
- `terminal` (string)
- `passenger_estimate` (integer)
- `status` (on_time | delayed | arrived)

**Mobile Behavior:** Scrollable horizontal strip in driver heat map screen.
**Admin/Founder:** Full table in Airport Operations panel.

---

### C-063 · Airport Demand Forecast Card (Admin/Founder)

**Purpose:** Show current and forecast demand at EWR for operational planning.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ✈  EWR Demand Forecast          │    ║
║  │  ─────────────────────────────── │    ║
║  │  Now:     ●●●● Very High         │    ║
║  │           text-error             │    ║
║  │  +30 min: ●●● High               │    ║
║  │           text-warning           │    ║
║  │  +60 min: ●● Moderate            │    ║
║  │           text-teal              │    ║
║  │  +90 min: ● Low                  │    ║
║  │           text-muted             │    ║
║  │  ─────────────────────────────── │    ║
║  │  Drivers at airport:    14       │    ║
║  │  Drivers needed:        22       │    ║
║  │  Gap:                   ▼ 8      │    ║
║  │                   text-error     │    ║
║  │                                  │    ║
║  │  Reposition nudges sent: 12      │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**Data Fields:**
- `demand_now` (low | moderate | high | very_high)
- `demand_30min` (same enum)
- `demand_60min` (same enum)
- `demand_90min` (same enum)
- `drivers_at_airport` (integer)
- `drivers_needed` (integer)
- `nudges_sent` (integer)

---

## 7. Earnings Components

---

### C-070 · Earnings Summary Card

**Purpose:** Primary earnings overview for a driver — top of earnings dashboard.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Today's Earnings                │    ║
║  │  ─────────────────────────────── │    ║
║  │                                  │    ║
║  │         $127.40                  │    ║
║  │   type-mono-l / text-gold        │    ║
║  │   after BidRide fee              │    ║
║  │   type-caption / text-muted      │    ║
║  │                                  │    ║
║  │  ─────────────────────────────── │    ║
║  │  12 trips  ·  6.2 hrs  ·  $20/hr │    ║
║  │  type-body-s / text-secondary    │    ║
║  │                                  │    ║
║  │  [    Payout Now — $127.40    ]  │    ║
║  │  Gold button                     │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-raised                    ║
║  border: 1px border-gold                 ║
║  radius: radius-md                       ║
╚══════════════════════════════════════════╝
```

**Tabs:** Today · This Week · This Month

**Data Fields:**
- `period` (today | week | month)
- `net_earnings` (decimal)
- `trip_count` (integer)
- `hours_online` (decimal)
- `hourly_rate` (decimal)
- `available_balance` (decimal — for payout button)

---

### C-071 · Earnings Protection Indicator

**Purpose:** Inform driver that BidRide's earnings floor protected their rate on a specific trip.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  🛡  Earnings Protected          │    ║
║  │                                  │    ║
║  │  BidRide raised this fare to     │    ║
║  │  protect your minimum earnings.  │    ║
║  │                                  │    ║
║  │  Floor guaranteed:  $10.80       │    ║
║  │  Final earnings:    $10.80       │    ║
║  │  type-mono-s / text-gold         │    ║
║  └──────────────────────────────────┘    ║
║  bg: rgba(244,180,0,0.06)                ║
║  border-left: 3px #F4B400               ║
║  radius: radius-sm                       ║
╚══════════════════════════════════════════╝
```

**When shown:** On trip detail screen when `floor_applied = true`.
**Purpose:** Transparency. Driver should understand BidRide enforced the floor on their behalf.

---

### C-072 · Instant Payout Panel

**Purpose:** Full payout control panel — balance, method, and transfer action.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Available Balance               │    ║
║  │                                  │    ║
║  │         $127.40                  │    ║
║  │   type-mono-l / text-gold        │    ║
║  │                                  │    ║
║  │  Payout to:                      │    ║
║  │  🏦 Chase ···· 4821              │    ║
║  │  type-body / text-primary        │    ║
║  │  [ Change method ]               │    ║
║  │  type-caption / text-teal        │    ║
║  │                                  │    ║
║  │  ✓ No payout fee                 │    ║
║  │  ✓ Arrives within minutes        │    ║
║  │                                  │    ║
║  │  [  Transfer $127.40 Now  ]      │    ║
║  │  Gold button                     │    ║
║  │                                  │    ║
║  │  Pending: $8.40  (2 trips)       │    ║
║  │  type-caption / text-muted       │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**States:**
- Default: balance ready to transfer
- No balance: "No earnings to pay out yet" empty state
- Transferring: spinner on button, balance grayed
- Success: checkmark animation, balance resets to $0 + pending
- No payout method: CTA to set up bank/debit card

**Data Fields:**
- `available_balance` (decimal)
- `pending_balance` (decimal)
- `pending_trip_count` (integer)
- `payout_method_type` (bank_account | debit_card)
- `payout_method_last4` (string)
- `payout_method_bank_name` (string)

---

### C-073 · Earnings Chart

**Purpose:** Visual earnings trend by day/week/month.

```
╔══════════════════════════════════════════╗
║                                          ║
║  This Week                               ║
║                                          ║
║  $200 │         ████                    ║
║  $150 │    ████ ████ ████               ║
║  $100 │ ██ ████ ████ ████ ███           ║
║   $50 │ ██ ████ ████ ████ ███ ██        ║
║       └──────────────────────────        ║
║        M   T   W   T   F   S   S        ║
║                                          ║
║  Bar color: text-gold / bg-gold/20       ║
║  Today bar: text-gold / bg-gold (solid)  ║
║  Selected bar: teal border               ║
║  Tap bar → shows day total in tooltip    ║
╚══════════════════════════════════════════╝
```

**Variants:** Daily bars (week view) · Weekly bars (month view) · Monthly line (year view)

**Data Fields:**
- `period` (week | month | year)
- `data_points` (array: `{ label, amount, is_current }`)
- `total` (decimal — period total)
- `average` (decimal — average per period)

---

## 8. Safety Components

---

### C-080 · SOS Button

**Purpose:** Emergency activation control. Must be instantly accessible during any active trip. Most critical UI component in the platform.

```
╔══════════════════════════════════════════╗
║                                          ║
║  RESTING STATE:                          ║
║  ┌─────┐                                 ║
║  │ SOS │  40×40px  radius-circle         ║
║  │     │  bg: #EF4444                    ║
║  └─────┘  shadow: 0 0 0 4px rgba(EF4444)║
║           Pulsing ring animation         ║
║           Floats: bottom-right corner    ║
║                                          ║
║  TAPPED — CONFIRMATION (5 second hold):  ║
║  ┌──────────────────────────────────┐    ║
║  │  🔴  Sending emergency alert     │    ║
║  │      Sending in 4 seconds...     │    ║
║  │  ─────────────────────────────── │    ║
║  │  [ Cancel ]                      │    ║
║  └──────────────────────────────────┘    ║
║  Overlay modal, high contrast            ║
║                                          ║
║  ACTIVE STATE (after confirmation):      ║
║  ┌──────────────────────────────────┐    ║
║  │  🔴  HELP IS ON THE WAY          │    ║
║  │  Contacts notified               │    ║
║  │  Admin alerted                   │    ║
║  │  ─────────────────────────────── │    ║
║  │  [ Call 911 ]                    │    ║
║  │  One-tap to dial emergency svc.  │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**States:**
- Resting: visible pulsing red circle in corner
- Confirming: modal with countdown (cancel available)
- Active: full SOS screen, 911 button prominent
- Accidental activation guard: 5-second cancel window — if user taps Cancel, no alert sent

**Critical Design Rules:**
- Always visible during in-ride screen — no other UI can cover the SOS button
- Never requires more than 2 taps to activate (tap SOS → confirm)
- Never requires unlocking the phone to see the confirmation screen
- Color is always `#EF4444` — no variant, no override
- Size never below 40×40px — 44×44px minimum touch target

**Data Fields:**
- `trip_id` (string — sent with SOS event)
- `user_type` (rider | driver)
- `trusted_contacts_count` (integer — shown in active state)

---

### C-081 · Safety Alert Card (Admin — Active Incident)

**Purpose:** High-priority card in admin Safety Command Center for active SOS or anomaly events.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │ 🔴  SOS ACTIVE          2m 14s   │    ║
║  │     Pulsing border animation     │    ║
║  │  ─────────────────────────────── │    ║
║  │  Trip #BR-48821                  │    ║
║  │  Rider: James R.                 │    ║
║  │  Driver: Marcus T.  ★ 4.92      │    ║
║  │  📍 NJ Turnpike · Exit 14E       │    ║
║  │  Last GPS: 22 sec ago            │    ║
║  │  ─────────────────────────────── │    ║
║  │  Trusted contacts: ✓ Notified    │    ║
║  │  Admin: ○ Unassigned             │    ║
║  │                                  │    ║
║  │  [ Assign to Me ]                │    ║
║  │  [ View Live Trip ]              │    ║
║  │  [ Call 911 ]                    │    ║
║  └──────────────────────────────────┘    ║
║  bg: status-error-bg (#3B0000)           ║
║  border: 2px status-error                ║
║  animation: border-pulse 1s infinite     ║
╚══════════════════════════════════════════╝
```

**States:**
- SOS Active: pulsing red border, unassigned
- Assigned: shows admin name, stops pulsing, assigned indicator
- GPS Lost: orange warning, "No GPS · Last known location" fallback
- Resolved: card moves to resolved queue, green status

**Data Fields:**
- `incident_type` (sos | anomaly | driver_report | rider_report)
- `trip_id` (string)
- `rider_name` (string)
- `driver_name` (string)
- `driver_rating` (decimal)
- `location_label` (string — human-readable)
- `last_gps_seconds_ago` (integer)
- `trusted_contacts_notified` (boolean)
- `assigned_admin` (string | null)
- `created_at` (timestamp)
- `duration_seconds` (integer — for "2m 14s" display)

---

### C-082 · Trip Anomaly Indicator (In-Ride)

**Purpose:** Non-alarming notification to rider when AI detects a route deviation.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ◈  Route updated                │    ║
║  │     Your trip is being monitored │    ║
║  └──────────────────────────────────┘    ║
║  bg: rgba(0,212,198,0.08)                ║
║  border: 1px border-teal                 ║
║  icon: teal, 16px                        ║
║  Appears: in-ride screen, below ETA chip ║
║  Auto-dismisses after 8 seconds          ║
╚══════════════════════════════════════════╝
```

**Design Rule:** Soft anomalies show this calm message — not alarming language. Hard anomalies trigger the full SOS prompt only if unresolved.

---

### C-083 · Trusted Contact Notification Preview

**Purpose:** Confirm to rider/driver that their trusted contacts have been notified of a trip.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  👤 Marcus has your trip link    │    ║
║  │     + 1 other contact notified  │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-raised                    ║
║  border-left: 3px text-teal             ║
║  Appears at trip start, auto-dismisses   ║
╚══════════════════════════════════════════╝
```

---

## 9. Heatmap Components

---

### C-090 · Demand Heatmap Layer

**Purpose:** Visualize real-time rider demand intensity across the service area on a map.

```
╔══════════════════════════════════════════╗
║                                          ║
║  LEGEND:                                 ║
║  ████  Very High demand  (dark red)       ║
║  ████  High demand       (orange-red)    ║
║  ████  Moderate demand   (amber)         ║
║  ████  Low demand        (teal/cool)     ║
║  ░░░░  No data           (transparent)   ║
║                                          ║
║  Opacity: 65% over map                   ║
║  Update: every 90 seconds                ║
║  Smooth transition: 800ms on update      ║
║  Tap on zone: shows demand level tooltip ║
║                                          ║
║  LEGEND CHIP (floats bottom-left):       ║
║  ┌─────────────────┐                     ║
║  │ ■ ■ ■ ■ ■       │                     ║
║  │ Low      High   │                     ║
║  └─────────────────┘                     ║
╚══════════════════════════════════════════╝
```

**Zones defined by:**
- Active ride request density per square km (last 5 minutes)
- AI demand forecast overlay (next 15 minutes)
- Airport activity zones (fixed — EWR terminal areas)

**Toggles:**
- Live demand: toggle on/off
- Forecast overlay: toggle on/off (shows predicted 15-min demand)
- Airport zones: always-on overlay

---

### C-091 · Zone Demand Tooltip

**Purpose:** Context popup when driver taps a zone on the heat map.

```
╔══════════════════════════════════════════╗
║                                          ║
║       ┌──────────────────────┐           ║
║       │  Hoboken Waterfront  │           ║
║       │  ─────────────────── │           ║
║       │  Demand:  ●●● High   │           ║
║       │  Drivers: 3 nearby   │           ║
║       │  Avg ETA: 4 min      │           ║
║       │  ─────────────────── │           ║
║       │  ◈ AI: Profitable     │           ║
║       │    zone right now    │           ║
║       └──────────────────────┘           ║
║  bg: elevation-modal  radius: radius-md  ║
║  shadow: shadow-lg                        ║
║  Dismiss: tap anywhere on map            ║
╚══════════════════════════════════════════╝
```

**Data Fields:**
- `zone_name` (string)
- `demand_level` (low | moderate | high | very_high)
- `driver_count_nearby` (integer)
- `avg_eta_minutes` (integer)
- `ai_recommendation` (string | null — "Profitable zone" etc.)

---

### C-092 · AI Positioning Recommendation Strip

**Purpose:** Non-intrusive AI tip at the top or bottom of heat map screen directing driver toward high-demand areas.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ◈  Move to Hoboken for more     │    ║
║  │     earnings · 8 min away        │    ║
║  │                     [Navigate]   │    ║
║  └──────────────────────────────────┘    ║
║  bg: rgba(0,212,198,0.10)                ║
║  border: 1px border-teal                 ║
║  height: 56px  fixed bottom              ║
║  [Navigate]: teal text link, routes to   ║
║  maps navigation for the zone            ║
╚══════════════════════════════════════════╝
```

**States:**
- Visible: recommendation active
- Dismissed: driver taps X, hidden for 15 minutes
- Expired: auto-hides when demand changes or driver moves

---

## 10. AI Recommendation Components

---

### C-100 · AI Insight Panel

**Purpose:** Surface personalized AI recommendations for when and where to drive.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ◈  AI Insights for You          │    ║
║  │  ─────────────────────────────── │    ║
║  │                                  │    ║
║  │  Best time to drive today:       │    ║
║  │  4:00 PM – 7:30 PM               │    ║
║  │  type-body / text-primary        │    ║
║  │  Est. $28–$35/hr                 │    ║
║  │  type-mono-s / text-gold         │    ║
║  │                                  │    ║
║  │  ─────────────────────────────── │    ║
║  │                                  │    ║
║  │  Top zones this evening:         │    ║
║  │  1. EWR Airport        ●●●●      │    ║
║  │  2. Hoboken Waterfront ●●●       │    ║
║  │  3. Downtown Newark    ●●        │    ║
║  │                                  │    ║
║  │  ─────────────────────────────── │    ║
║  │  Updated 12 min ago              │    ║
║  │  type-caption / text-muted       │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**Data Fields:**
- `best_drive_window_start` (time)
- `best_drive_window_end` (time)
- `projected_hourly_min` (decimal)
- `projected_hourly_max` (decimal)
- `top_zones` (array: `{ name, demand_level }`)
- `last_updated_minutes` (integer)

---

### C-101 · AI Pricing Badge

**Purpose:** Visual indicator that a fare was generated by BidRide's AI system. Builds rider trust.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌────────────────────────────┐          ║
║  │  ◈  BidRide AI Fare        │          ║
║  └────────────────────────────┘          ║
║                                          ║
║  Pill chip: bg-teal/10, border-teal      ║
║  Icon: ◈ (AI/intelligence icon) in teal  ║
║  text: type-label-s / text-teal          ║
║  height: 24px                            ║
║                                          ║
║  Tappable: opens fare explanation modal  ║
╚══════════════════════════════════════════╝
```

**Tap action — Fare Explanation Modal:**
"BidRide AI analyzes demand, traffic, weather, and driver supply to generate the fairest possible fare — protecting driver earnings while keeping costs low for riders."

---

### C-102 · Marketplace Health Gauge

**Purpose:** Visual representation of overall marketplace balance — used in Admin and Founder dashboards.

```
╔══════════════════════════════════════════╗
║                                          ║
║  Marketplace Health                      ║
║                                          ║
║         ╭──────────────╮                 ║
║        ╱                ╲                ║
║       ╱   ████░░░░░░░░   ╲               ║
║      │     73 / 100       │              ║
║      │      GOOD          │              ║
║       ╲   text-success   ╱               ║
║        ╲                ╱                ║
║         ╰──────────────╯                 ║
║                                          ║
║  Score bands:                            ║
║  0–39:   Critical  (red)                 ║
║  40–59:  At Risk   (amber)               ║
║  60–79:  Good      (teal)                ║
║  80–100: Excellent (green)               ║
║                                          ║
║  Gauge: semicircle, animated fill        ║
║  Score: type-h1 / center                 ║
║  Label: type-h3 / status color           ║
╚══════════════════════════════════════════╝
```

**Data Fields:**
- `score` (0–100)
- `band` (critical | at_risk | good | excellent)
- `primary_factor` (string — "What's driving this score")
- `trend` (improving | stable | declining)

---

## 11. Marketplace Metrics Components

---

### C-110 · KPI Stat Widget

**Purpose:** Single metric display used across admin and founder dashboards.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌─────────────────────┐                 ║
║  │  Active Rides        │                 ║
║  │  type-caption/muted  │                 ║
║  │                      │                 ║
║  │     247              │                 ║
║  │  type-h1/primary     │                 ║
║  │                      │                 ║
║  │  ▲ +12% vs yesterday │                 ║
║  │  type-label-s/success│                 ║
║  └─────────────────────┘                 ║
║                                          ║
║  Variants by metric type:                ║
║  Revenue: amount in type-mono, gold text ║
║  Count: integer in type-h1               ║
║  Percentage: % in type-h1               ║
║  Duration: time in type-h1               ║
║                                          ║
║  Delta colors:                           ║
║  Positive: text-success ▲                ║
║  Negative: text-error ▼                  ║
║  Neutral: text-muted →                   ║
╚══════════════════════════════════════════╝
```

**Variants:**
- Revenue: gold type-mono for amount
- Ride count: standard type-h1
- Percentage metric: includes % symbol
- Duration: formatted as "4m 12s" or "2h 14m"
- Alert metric: red background if value exceeds threshold

**Data Fields:**
- `label` (string)
- `value` (string — pre-formatted)
- `value_type` (currency | count | percentage | duration)
- `delta_pct` (decimal | null)
- `delta_direction` (up | down | neutral)
- `alert_threshold` (decimal | null)
- `is_alert` (boolean — red state)

---

### C-111 · Revenue Ticker

**Purpose:** Real-time revenue counter that updates live in the Founder Command Center.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Revenue Today                   │    ║
║  │                                  │    ║
║  │    $  8 , 4 2 1 . 6 0            │    ║
║  │    type-mono-l / text-gold       │    ║
║  │    Each digit slot animated       │    ║
║  │                                  │    ║
║  │  ▲ $420 since last hour          │    ║
║  │  type-caption / text-success     │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-raised                    ║
║  border: 1px border-gold                 ║
║  Live update: WebSocket-driven           ║
║  Animation: digit slot machine roll      ║
╚══════════════════════════════════════════╝
```

---

### C-112 · Live Activity Feed

**Purpose:** Scrolling real-time log of platform events — used in Founder and Admin dashboards.

```
╔══════════════════════════════════════════╗
║                                          ║
║  Live Activity                           ║
║  ┌──────────────────────────────────┐    ║
║  │  ✓ Ride completed · EWR → Hobo. │    ║
║  │    $22.40 · just now             │    ║
║  ├──────────────────────────────────┤    ║
║  │  🚗 New driver online · Newark   │    ║
║  │    Marcus T. · 2 sec ago         │    ║
║  ├──────────────────────────────────┤    ║
║  │  💰 Payout: $127.40 to driver   │    ║
║  │    Marcus T. · 14 sec ago        │    ║
║  ├──────────────────────────────────┤    ║
║  │  ⚠ Fraud flag cleared           │    ║
║  │    Account #R-4821 · 1 min ago   │    ║
║  └──────────────────────────────────┘    ║
║  Max 5 visible rows                      ║
║  Auto-scrolls as new events arrive       ║
║  Pause on hover/tap                      ║
║  Tap row → deep link to relevant screen  ║
╚══════════════════════════════════════════╝
```

**Event types and icons:**
- Ride completed: ✓ teal
- Driver online: 🚗 teal
- Payout sent: 💰 gold
- Fraud flag: ⚠ amber
- SOS event: 🔴 red (always top of feed)
- New rider: 👤 teal
- Ride cancelled: ✕ gray

---

### C-113 · Supply vs Demand Chart

**Purpose:** Show the balance between driver supply and rider demand over time.

```
╔══════════════════════════════════════════╗
║                                          ║
║  Supply vs Demand — Last 6 Hours         ║
║                                          ║
║  60 │  Demand ━━━━━━━━━━━━━━━━          ║
║  50 │         ╱╲      ╱╲                ║
║  40 │        ╱  ╲    ╱  ╲               ║
║  30 │  Supply ───────────────────       ║
║  20 │       ─────────────────────       ║
║  10 │                                   ║
║     └─────────────────────────────      ║
║      6pm  7pm  8pm  9pm  10pm  Now      ║
║                                          ║
║  Demand line: text-teal, 2px            ║
║  Supply line: text-gold, 2px dashed     ║
║  Gap fill: teal/10 (surplus)            ║
║           or error/10 (shortage)        ║
╚══════════════════════════════════════════╝
```

**Data Fields:**
- `time_labels` (array of strings)
- `demand_series` (array of integers)
- `supply_series` (array of integers)
- `period` (last_hour | last_6h | today | week)

---

## 12. Founder Command Center Components

---

### C-120 · Founder Dashboard Header

**Purpose:** Private, locked header for founder-only access.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  🔑  Founder Command Center      │    ║
║  │  Marq Brown · Private Access     │    ║
║  │                                  │    ║
║  │  Thu Jun 5, 2026  ·  4:18 PM     │    ║
║  │                  [ 🔴 Live ] [≡] │    ║
║  └──────────────────────────────────┘    ║
║  bg: bg-charcoal (#0F1923)              ║
║  border-bottom: 1px border-gold         ║
║  "Founder Command Center" in type-h2    ║
║  "🔴 Live" pulse indicator: real-time   ║
╚══════════════════════════════════════════╝
```

**Access:** Biometric authentication required. No shared access. Session expires after 30 minutes of inactivity. All sessions logged.

---

### C-121 · Growth Metrics Panel

**Purpose:** High-level business growth metrics for founder review.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Growth                          │    ║
║  │  ─────────────────────────────── │    ║
║  │  Total Rides (all time)  2,841   │    ║
║  │  Rides today              247    │    ║
║  │  Rides this week         1,204   │    ║
║  │  ─────────────────────────────── │    ║
║  │  Total Riders (all time) 1,192   │    ║
║  │  Active today              318   │    ║
║  │  New this week              44   │    ║
║  │  ─────────────────────────────── │    ║
║  │  Total Drivers (all time)   84   │    ║
║  │  Online now                 22   │    ║
║  │  New this week               3   │    ║
║  │  ─────────────────────────────── │    ║
║  │  Retention (30d rider)    68.2%  │    ║
║  │  Retention (30d driver)   81.4%  │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

---

### C-122 · Cash Flow Summary Panel

**Purpose:** Founder-level financial overview — revenue, payouts, and platform net.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Cash Flow                       │    ║
║  │  ─────────────────────────────── │    ║
║  │  Gross Revenue Today   $8,421    │    ║
║  │                  type-mono/gold  │    ║
║  │  Driver Payouts       – $6,316   │    ║
║  │                  type-mono/muted │    ║
║  │  Platform Net Today   $2,105     │    ║
║  │                  type-mono/teal  │    ║
║  │  ─────────────────────────────── │    ║
║  │  Gross Revenue Week  $41,840     │    ║
║  │  Platform Net Week   $10,460     │    ║
║  │  ─────────────────────────────── │    ║
║  │  Avg Driver Payout %     75.0%   │    ║
║  │  (Target: 70–80% ✓)             │    ║
║  │  text-success                    │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**Design Rule:** "Avg Driver Payout %" must always show target range and compliance indicator (✓ or ✕). This is a Founder Control Principle — payout rate is always visible.

---

### C-123 · Rider Savings Panel

**Purpose:** Show founder how much riders have saved compared to estimated competitor pricing.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Rider Savings                   │    ║
║  │  vs. estimated competitor fare   │    ║
║  │  ─────────────────────────────── │    ║
║  │  Avg BidRide fare    $14.20      │    ║
║  │  Avg market fare     $18.40      │    ║
║  │  Avg rider savings   $4.20/ride  │    ║
║  │                      text-teal   │    ║
║  │  ─────────────────────────────── │    ║
║  │  Total saved today   $1,037      │    ║
║  │  Total saved (week)  $5,040      │    ║
║  │  Total saved (all)   $11,882     │    ║
║  │                      text-teal   │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

---

### C-124 · Driver Earnings Performance Panel

**Purpose:** Show founder how well the platform is delivering on its driver earnings promise.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Driver Earnings Performance     │    ║
║  │  ─────────────────────────────── │    ║
║  │  Avg hourly (today)    $27.40    │    ║
║  │  Avg hourly (week)     $26.10    │    ║
║  │  Target: $25–$40/hr   ✓          │    ║
║  │  text-success                    │    ║
║  │  ─────────────────────────────── │    ║
║  │  Floor enforced today   3 trips  │    ║
║  │  Platform absorbed     $12.40    │    ║
║  │  (BidRide covered floor gap)     │    ║
║  │  text-muted                      │    ║
║  │  ─────────────────────────────── │    ║
║  │  Drivers above $25/hr   87.4%    │    ║
║  │  Drivers below $25/hr   12.6%    │    ║
║  │  ⚠ 2 drivers at risk             │    ║
║  │  text-warning                    │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

---

### C-125 · AI Performance Summary Panel

**Purpose:** Show founder how well BidRide's AI systems are performing.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ◈  AI Performance               │    ║
║  │  ─────────────────────────────── │    ║
║  │  Pricing accuracy      94.2%     │    ║
║  │  (fare accepted w/out bid)       │    ║
║  │                                  │    ║
║  │  ETA accuracy          91.8%     │    ║
║  │  (within 2 min of estimate)      │    ║
║  │                                  │    ║
║  │  Match efficiency      88.4%     │    ║
║  │  (first-driver acceptance rate)  │    ║
║  │                                  │    ║
║  │  Demand forecast acc.  86.1%     │    ║
║  │                                  │    ║
║  │  All engines: ● Healthy          │    ║
║  │  text-success                    │    ║
║  │  ─────────────────────────────── │    ║
║  │  Marketplace Health Score: 73    │    ║
║  │  ██████████░░░░░░  GOOD          │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

---

## 13. Admin Components

---

### C-130 · Admin Sidebar Navigation

**Purpose:** Primary navigation for the admin web dashboard.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────┐                ║
║  │  BidRide Admin       │                ║
║  │  ──────────────────  │                ║
║  │  ▣  Overview         │ ← active       ║
║  │  🗺  Live Map        │                ║
║  │  🚗  Drivers         │                ║
║  │  👤  Riders          │                ║
║  │  🚘  Trips           │                ║
║  │  💳  Payments        │                ║
║  │  ✈  Airport         │                ║
║  │  🛡  Safety          │                ║
║  │  ⚠  Fraud           │                ║
║  │  ◈  AI Pricing      │                ║
║  │  ⭐  Rewards         │                ║
║  │  🏢  Corporate       │                ║
║  │  ──────────────────  │                ║
║  │  ⚙  Settings        │                ║
║  │  [Admin Name]  Logout│                ║
║  └──────────────────────┘                ║
║  Width: 240px (expanded) / 64px (mini)   ║
║  bg: bg-charcoal                         ║
║  Active item: bg-secondary, teal border  ║
║  Hover: bg-secondary                     ║
╚══════════════════════════════════════════╝
```

---

### C-131 · Data Table

**Purpose:** Paginated, sortable, filterable table for admin data management.

```
╔══════════════════════════════════════════╗
║                                          ║
║  [ 🔍 Search... ]  [Filter ▼] [Export]  ║
║                                          ║
║  ┌────┬──────────┬────────┬────────────┐ ║
║  │ ID │ Name     │ Status │ Actions    │ ║
║  ├────┼──────────┼────────┼────────────┤ ║
║  │ 01 │ James R. │●Active │ [View] [⋮] │ ║
║  │ 02 │ Sarah M. │●Active │ [View] [⋮] │ ║
║  │ 03 │ Tom K.   │⚠ Flagg.│ [View] [⋮] │ ║
║  │ 04 │ Ana P.   │✕ Susp. │ [View] [⋮] │ ║
║  └────┴──────────┴────────┴────────────┘ ║
║                                          ║
║  Showing 1–25 of 1,192  [< 1 2 3 ... >] ║
║                                          ║
║  Row hover: bg-secondary                 ║
║  Sorted column: caret icon, teal header  ║
║  [⋮] opens: Edit / Suspend / Ban menu    ║
╚══════════════════════════════════════════╝
```

**Features:**
- Column sort (click header): ascending → descending → default
- Multi-column filter: status chips as filter toggles
- Search: debounced, 300ms delay, server-side
- Pagination: cursor-based, 25 rows default (10/25/50/100 selector)
- Export: CSV, filtered to current view
- Row actions: View, Edit (role-dependent), destructive actions in [⋮] menu

---

### C-132 · Admin Action Menu

**Purpose:** Contextual action menu for admin operations on a driver or rider.

```
╔══════════════════════════════════════════╗
║                                          ║
║         ┌──────────────────┐             ║
║         │  View Profile    │             ║
║         │  Edit Details    │             ║
║         │  Send Message    │             ║
║         │  ─────────────── │             ║
║         │  Suspend Account │ ← amber     ║
║         │  ─────────────── │             ║
║         │  Ban Account     │ ← red       ║
║         └──────────────────┘             ║
║                                          ║
║  bg: elevation-modal  radius: radius-md  ║
║  shadow: shadow-xl                        ║
║  Dismiss: click outside                  ║
║  Destructive actions: always last, red   ║
║  Destructive actions: require confirm    ║
╚══════════════════════════════════════════╝
```

---

### C-133 · Trip Route Replay

**Purpose:** Allow admin to replay the GPS route of a completed or flagged trip for audit purposes.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  [MAP — Route displayed]         │    ║
║  │  Pickup: ● Green pin             │    ║
║  │  Destination: ● Red pin          │    ║
║  │  Actual route: teal line         │    ║
║  │  Expected route: navy dashed     │    ║
║  │  Deviation: orange highlight     │    ║
║  │                                  │    ║
║  │  ─────────────────────────────── │    ║
║  │  ◀◀  ▶  ▶▶           ━━━━●────  │    ║
║  │  Playback controls   Scrubber    │    ║
║  │                                  │    ║
║  │  9:41 AM — Pickup               │    ║
║  │  9:43 AM — Started              │    ║
║  │  9:51 AM ⚠ Route deviation      │    ║
║  │  10:04 AM — Completed           │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**Controls:**
- Play / Pause
- Speed selector (1× / 2× / 4×)
- Scrubber (drag to any point in the trip)
- Timeline event markers (pickup, start, anomalies, completion)
- Deviation zones highlighted in amber on route

---

## 14. Rider Additions

---

### C-054 · Ride History Card (Enhanced)

**Purpose:** Richer trip record card showing savings, bid outcome, and corporate tag — used in the ride history list and profile summary.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Mon Jun 2  ·  9:41 AM           │    ║
║  │  [Standard]  [Bid Accepted]      │    ║
║  │  ─────────────────────────────── │    ║
║  │  📍 EWR Terminal C               │    ║
║  │  ↓  8.2 mi  ·  19 min            │    ║
║  │  📍 Hoboken PATH Station          │    ║
║  │  ─────────────────────────────── │    ║
║  │  Fare paid:      $12.00          │    ║
║  │  AI fare was:    $14.80          │    ║
║  │  You saved:      $2.80  ✓        │    ║
║  │                  text-teal       │    ║
║  │  Driver rating:  ★★★★★           │    ║
║  │                          [ > ]   │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-raised  radius: radius-md ║
║  border-left: 3px border-teal            ║
║  Bid trip: border-left gold              ║
║  Cancelled: border-left error, muted bg  ║
╚══════════════════════════════════════════╝
```

**Variants:** Standard · Bid accepted · Corporate ride · Cancelled
**Data Fields:** `trip_date`, `trip_time`, `pickup_address`, `destination_address`, `distance_miles`, `duration_minutes`, `final_fare`, `ai_fare`, `savings_amount`, `ride_type`, `is_bid`, `rating_given`, `status`, `corporate_name`
**Mobile:** Full-width card, tappable entire surface → trip detail.
**Tablet/Desktop:** Card in 2-column grid.

---

### C-055 · Favorite Locations Card

**Purpose:** Display and manage a rider's saved locations (Home, Work, Favorites) for one-tap ride booking.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Saved Places                    │    ║
║  │  ─────────────────────────────── │    ║
║  │  🏠  Home                        │    ║
║  │      123 Market St, Newark NJ   │    ║
║  │      Last used: Today  [ Edit ] │    ║
║  │  ─────────────────────────────── │    ║
║  │  💼  Work                        │    ║
║  │      One Penn Plaza, NYC         │    ║
║  │      Last used: Mon  [ Edit ]   │    ║
║  │  ─────────────────────────────── │    ║
║  │  ★   Hoboken PATH Station        │    ║
║  │      Last used: Fri  [ Edit ]   │    ║
║  │  ─────────────────────────────── │    ║
║  │  +  Add New Place                │    ║
║  │     text-teal link               │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-raised  radius: radius-md ║
║  Tap location row → pre-fills home map   ║
╚══════════════════════════════════════════╝
```

**States per location:** Set · Unset (placeholder with dashed border + "Add" CTA) · Editing
**Data Fields:** `places` array: `{ type: home|work|favorite, label, address, last_used_date }`
**Mobile:** Vertical list. Swipe-left on any row → Delete.
**Tablet/Desktop:** Same vertical list, narrower column.

---

### C-056 · Ride Savings Tracker

**Purpose:** Show the rider how much they have saved on BidRide vs estimated competitor pricing — reinforces the core value proposition.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Your BidRide Savings            │    ║
║  │  ─────────────────────────────── │    ║
║  │                                  │    ║
║  │       $84.20                     │    ║
║  │  type-mono-l / text-teal         │    ║
║  │  saved vs. other apps            │    ║
║  │  type-caption / text-muted       │    ║
║  │                                  │    ║
║  │  This month:  $84.20  (24 rides) │    ║
║  │  All time:   $312.40  (89 rides) │    ║
║  │  type-body-s / text-secondary    │    ║
║  │                                  │    ║
║  │  Avg savings per ride:  $3.50    │    ║
║  │  ─────────────────────────────── │    ║
║  │  ◈ Powered by BidRide AI         │    ║
║  │  type-caption / text-teal        │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-raised                    ║
║  border: 1px border-teal                 ║
╚══════════════════════════════════════════╝
```

**Data Fields:** `savings_this_month`, `savings_all_time`, `rides_this_month`, `rides_all_time`, `avg_savings_per_ride`
**Note:** Savings computed as (estimated_competitor_fare – bidride_fare) per trip, aggregated. Competitor fare is an AI estimate, not a real-time lookup — labeled as "estimated" in UI.
**Mobile/Tablet/Desktop:** Card expands to show monthly bar chart on tap.

---

### C-057 · Referral Rewards Card

**Purpose:** Display rider's referral code, referral progress, and bonus earnings — drives word-of-mouth growth.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Refer Friends · Earn More       │    ║
║  │  ─────────────────────────────── │    ║
║  │  Your code:                      │    ║
║  │  ┌──────────────────────────┐    │    ║
║  │  │  MARQ-RIDE-2026          │    │    ║
║  │  └──────────────────────────┘    │    ║
║  │  type-mono / text-gold / centered│    │    ║
║  │  [ Copy Code ]  [ Share ]        │    │    ║
║  │  ─────────────────────────────── │    ║
║  │  Referrals this month:  3        │    ║
║  │  Points earned:         600 pts  │    ║
║  │                  text-gold       │    ║
║  │  ─────────────────────────────── │    ║
║  │  Pending (signed up, not ridden):│    ║
║  │  Sarah M. · Alex K.              │    ║
║  │  type-body-s / text-muted        │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**States:** Active (code + progress) · No referrals yet (code + explainer only)
**Data Fields:** `referral_code`, `referrals_this_month`, `points_earned_referrals`, `pending_referrals` (array of first names), `completed_referrals_total`
**Actions:** Copy code (clipboard) · Share (native OS share sheet)
**Mobile/Tablet/Desktop:** Full-width card. Share opens native OS share sheet on mobile; copies link on desktop.

---

## 15. Driver Additions

---

### C-044 · Driver Acceptance Rate Card

**Purpose:** Show driver their acceptance rate with context, trend, and impact on standing — framed constructively, never punitively.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Acceptance Rate                 │    ║
║  │  ─────────────────────────────── │    ║
║  │                                  │    ║
║  │     82%                          │    ║
║  │  type-h1 / text-primary          │    ║
║  │  Last 30 days                    │    ║
║  │  type-caption / text-muted       │    ║
║  │                                  │    ║
║  │  ████████████░░░░  82 / 100      │    ║
║  │  bar: teal fill / border track   │    ║
║  │                                  │    ║
║  │  ▲ +4% from last month           │    ║
║  │  text-success                    │    ║
║  │  ─────────────────────────────── │    ║
║  │  Standing:  ● Good               │    ║
║  │  Below 70%: AI match priority    │    ║
║  │  may be reduced.                 │    ║
║  │  type-caption / text-muted       │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**Standing thresholds:** Excellent ≥ 90% · Good 70–89% · At Risk 50–69% · Review < 50%
**Data Fields:** `acceptance_rate_pct`, `period`, `delta_pct`, `standing`, `top_decline_reasons` (array)
**Mobile:** Card in driver performance screen. Tap → expands decline reason breakdown.
**Tablet/Desktop:** Panel in admin driver detail view (read-only for admin).

---

### C-045 · Driver Earnings Goal Tracker

**Purpose:** Let driver set a daily or weekly earnings goal and track progress in real time — motivational, not pressure-based.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Today's Goal                    │    ║
║  │  ─────────────────────────────── │    ║
║  │                                  │    ║
║  │  $127.40  of  $200.00            │    ║
║  │  type-mono / text-gold           │    ║
║  │                                  │    ║
║  │  ████████████░░░░░░░░  63.7%     │    ║
║  │  bar: gold fill / border track   │    ║
║  │  radius-pill                     │    ║
║  │                                  │    ║
║  │  $72.60 to go  ·  Est. 4–5 trips │    ║
║  │  type-body-s / text-secondary    │    ║
║  │                                  │    ║
║  │  [ Change Goal ]                 │    ║
║  │  type-caption / text-teal link   │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-raised                    ║
║  border: 1px border-gold                 ║
╚══════════════════════════════════════════╝
```

**States:** On track · Goal reached (gold celebration animation) · No goal set (CTA to set one)
**Data Fields:** `goal_amount`, `earned_today`, `remaining_amount`, `estimated_trips_remaining`, `goal_period` (today | week)
**Behavior:** Driver sets goal in settings. Progress updates live after each trip. Goal resets at midnight (daily) or Monday (weekly).

---

### C-046 · Driver Airport Queue Position Card (Compact)

**Purpose:** Compact version of the airport queue status, used in the driver dashboard summary strip when driver is queued but not actively viewing the airport screen.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  ✈  EWR Queue  ·  Position #7   │    ║
║  │  ─────────────────────────────── │    ║
║  │  Est. wait: ~18 min              │    ║
║  │  Next flight in: 12 min  (C)     │    ║
║  │  Proj. earnings: $22–$28         │    ║
║  │                  text-gold       │    ║
║  │                  [ View Queue ]  │    ║
║  └──────────────────────────────────┘    ║
║  Compact: 80px tall                      ║
║  bg: elevation-raised, border-gold       ║
║  Floats as persistent banner when queued ║
╚══════════════════════════════════════════╝
```

**Distinction from C-060:** C-060 is the full-screen queue card shown when driver is actively viewing the airport queue. C-046 is the compact persistent banner visible from any driver screen when in queue.
**Data Fields:** `queue_position`, `estimated_wait_minutes`, `next_flight_eta_minutes`, `next_flight_terminal`, `proj_earnings_min`, `proj_earnings_max`
**Mobile:** Fixed banner beneath the navigation header while queued. Tappable → navigates to full C-060 airport queue screen.

---

### C-047 · Driver Heatmap Earnings Predictor

**Purpose:** Overlay on the heat map showing predicted earnings per zone — not just demand intensity, but estimated dollar value of moving to that zone.

```
╔══════════════════════════════════════════╗
║                                          ║
║  [MAP with heatmap overlay]              ║
║                                          ║
║  Zone label chips (float over map):      ║
║                                          ║
║  ┌──────────────┐  ┌──────────────┐      ║
║  │  EWR         │  │  Hoboken     │      ║
║  │  $28–$35/hr  │  │  $22–$28/hr  │      ║
║  │  ●●●● Hot    │  │  ●●● High    │      ║
║  └──────────────┘  └──────────────┘      ║
║                                          ║
║  ┌──────────────┐                        ║
║  │  Downtown NWK│                        ║
║  │  $18–$22/hr  │                        ║
║  │  ●● Moderate │                        ║
║  └──────────────┘                        ║
║                                          ║
║  Chip colors match demand level          ║
║  Tap chip → C-091 Zone Tooltip           ║
║  Earnings range: gold text               ║
║  Demand badge: demand color              ║
╚══════════════════════════════════════════╝
```

**How earnings are predicted:** AI combines demand level, driver count in zone, historical fare data for routes originating in that zone, and time-of-day patterns to generate an estimated hourly rate range.
**Data Fields per zone:** `zone_name`, `zone_coords`, `demand_level`, `predicted_hourly_min`, `predicted_hourly_max`, `driver_count`, `avg_fare_from_zone`
**Toggle:** Driver can switch between "Demand view" (standard heatmap) and "Earnings view" (this predictor) via toggle above the map.

---

## 16. Founder Dashboard Additions

---

### C-126 · Market Expansion Dashboard Panel

**Purpose:** Give founder a strategic view of expansion readiness — which markets are next, what's needed to launch, and current market performance.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Market Expansion                │    ║
║  │  ─────────────────────────────── │    ║
║  │  ACTIVE MARKETS                  │    ║
║  │  ● Newark, NJ        ████ Healthy│    ║
║  │    247 rides today               │    ║
║  │  ─────────────────────────────── │    ║
║  │  NEXT MARKETS (Phase 2)          │    ║
║  │  ○ Jersey City, NJ   Planned     │    ║
║  │    Readiness: ██████░░░░ 62%     │    ║
║  │  ○ Hoboken, NJ       Planned     │    ║
║  │    Readiness: ████░░░░░░ 44%     │    ║
║  │  ─────────────────────────────── │    ║
║  │  Readiness criteria:             │    ║
║  │  ✓ Legal compliance              │    ║
║  │  ✓ Insurance coverage            │    ║
║  │  ○ Driver supply (min 20)        │    ║
║  │  ○ Marketing plan approved       │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**Data Fields:** `active_markets` array, `planned_markets` array (each with `readiness_pct`, `readiness_checklist`), `target_launch_dates`
**Behavior:** Tapping a market → drill-down showing full readiness checklist, driver pipeline, and legal status.

---

### C-127 · Competitor Pricing Dashboard Panel

**Purpose:** Show founder how BidRide fares compare to estimated competitor pricing in the same market — validates the "riders pay less" promise.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Competitor Pricing              │    ║
║  │  Newark market · Est. today      │    ║
║  │  ─────────────────────────────── │    ║
║  │  Route Type    BidRide  Market   │    ║
║  │  ─────────────────────────────── │    ║
║  │  Airport (EWR) $22.40   $28.90   │    ║
║  │  City rides    $11.20   $14.80   │    ║
║  │  Avg all rides $14.20   $18.40   │    ║
║  │  ─────────────────────────────── │    ║
║  │  BidRide advantage: –22.8%      │    ║
║  │  type-mono / text-teal           │    ║
║  │  ─────────────────────────────── │    ║
║  │  ⚠ Data is estimated via AI      │    ║
║  │    market analysis, not live     │    ║
║  │    competitor API data.          │    ║
║  │    type-caption / text-muted     │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**Data Fields:** `route_comparisons` array, `avg_bidride_fare`, `avg_market_fare`, `price_advantage_pct`, `data_freshness_date`
**Important:** Always show the "estimated" disclaimer. BidRide does not have access to live competitor APIs — this is AI-modeled market pricing.

---

### C-128 · Revenue Forecast Dashboard Panel

**Purpose:** Show founder projected revenue trajectory based on current growth rate, AI demand modeling, and expansion plans.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Revenue Forecast                │    ║
║  │  ─────────────────────────────── │    ║
║  │  This Month (projected)          │    ║
║  │  $128,400                        │    ║
║  │  type-mono-l / text-gold         │    ║
║  │  Confidence: High (87%)          │    ║
║  │  type-caption / text-teal        │    ║
║  │  ─────────────────────────────── │    ║
║  │  Q3 Forecast (Jul–Sep)           │    ║
║  │  $412,000 – $490,000             │    ║
║  │  type-mono / text-primary        │    ║
║  │  ─────────────────────────────── │    ║
║  │  Forecast chart (line)           │    ║
║  │  ─ Actual  ┄ Forecast            │    ║
║  │   $200k│        ┄┄┄┄┄┄┄         │    ║
║  │   $100k│   ─────┄               │    ║
║  │        └────────────────         │    ║
║  │         Jun  Jul  Aug  Sep       │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**Data Fields:** `forecast_current_month`, `forecast_confidence_pct`, `forecast_q3_min`, `forecast_q3_max`, `actual_series` (array), `forecast_series` (array), `key_assumptions` (array of strings)
**Behavior:** Tapping a forecast point shows the AI's key assumptions driving that projection (ride volume, driver supply, expansion events).

---

### C-129 · Unit Economics Dashboard Panel

**Purpose:** Show founder the per-ride economics of the platform — the core profitability metrics that determine long-term sustainability.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Unit Economics                  │    ║
║  │  Per completed ride · This month │    ║
║  │  ─────────────────────────────── │    ║
║  │  Avg gross fare          $14.20  │    ║
║  │  Avg driver payout     – $10.65  │    ║
║  │  Avg platform gross      $3.55   │    ║
║  │  ─────────────────────────────── │    ║
║  │  Payment processing    – $0.44   │    ║
║  │  Instant payout cost   – $0.18   │    ║
║  │  AI infrastructure     – $0.12   │    ║
║  │  Mapping API cost      – $0.09   │    ║
║  │  ─────────────────────────────── │    ║
║  │  Contribution margin     $2.72   │    ║
║  │  per ride  (19.2%)               │    ║
║  │  type-mono / text-teal           │    ║
║  │  ─────────────────────────────── │    ║
║  │  Driver payout %:        75.0%   │    ║
║  │  Target: 70–80%  ✓  text-success │    ║
║  └──────────────────────────────────┘    ║
╚══════════════════════════════════════════╝
```

**Data Fields:** `avg_gross_fare`, `avg_driver_payout`, `avg_platform_gross`, `cost_items` (array: label + amount), `contribution_margin`, `contribution_margin_pct`, `driver_payout_pct`
**Design Rule:** Driver payout % with target compliance indicator (✓/✕) is mandatory — Founder Control Principle.
**Behavior:** Expandable cost items. Tapping any cost line shows 30-day trend for that cost.

---

## 17. Component Inventory Table

| ID | Component Name | App | Category | Status |
|---|---|---|---|---|
| C-001 | Avatar | All | Shared | Defined |
| C-002 | Star Rating | All | Shared | Defined |
| C-003 | Status Chip | All | Shared | Defined |
| C-004 | Divider | All | Shared | Defined |
| C-005 | Empty State | All | Shared | Defined |
| C-006 | Bottom Sheet | Mobile | Shared | Defined |
| C-007 | Modal Dialog | All | Shared | Defined |
| C-008 | Loading Spinner | All | Shared | Defined |
| C-009 | Progress Bar | All | Shared | Defined |
| C-010 | Tab Bar | Mobile | Navigation | Defined |
| C-011 | Navigation Header | Mobile | Navigation | Defined |
| C-020 | Fare Preview Card | Rider | Fare | Defined |
| C-021 | Fare Breakdown Panel | Rider | Fare | Defined |
| C-022 | Ride Type Selector | Rider | Fare | Defined |
| C-023 | Fare Confirmation Banner | Rider | Fare | Defined |
| C-030 | Bid Input Card | Rider | Bid | Defined |
| C-031 | Bid Status Card | Rider | Bid | Defined |
| C-032 | Counter-Offer Card | Rider | Bid | Defined |
| C-033 | Driver Incoming Request Card | Driver | Bid | Defined |
| C-040 | Driver Online/Offline Toggle | Driver | Driver | Defined |
| C-041 | Pre-Shift Selfie Component | Driver | Driver | Defined |
| C-042 | Driver Trip Summary Card | Driver | Driver | Defined |
| C-043 | Driver Verification Tracker | Driver | Driver | Defined |
| C-044 | Driver Acceptance Rate Card | Driver | Driver | Defined |
| C-045 | Driver Earnings Goal Tracker | Driver | Driver | Defined |
| C-046 | Driver Airport Queue Position (Compact) | Driver | Driver | Defined |
| C-047 | Driver Heatmap Earnings Predictor | Driver | Driver | Defined |
| C-050 | Rider Safety Banner | Rider | Rider | Defined |
| C-051 | Live ETA Chip | Rider | Rider | Defined |
| C-052 | Rewards Points Badge | Rider | Rider | Defined |
| C-053 | Rider Trip Card | Rider | Rider | Defined |
| C-054 | Ride History Card (Enhanced) | Rider | Rider | Defined |
| C-055 | Favorite Locations Card | Rider | Rider | Defined |
| C-056 | Ride Savings Tracker | Rider | Rider | Defined |
| C-057 | Referral Rewards Card | Rider | Rider | Defined |
| C-060 | Airport Queue Status Card | Driver | Airport | Defined |
| C-061 | Terminal Pickup Guide Card | Driver | Airport | Defined |
| C-062 | Flight Demand Strip | Driver/Admin | Airport | Defined |
| C-063 | Airport Demand Forecast Card | Admin/Founder | Airport | Defined |
| C-070 | Earnings Summary Card | Driver | Earnings | Defined |
| C-071 | Earnings Protection Indicator | Driver | Earnings | Defined |
| C-072 | Instant Payout Panel | Driver | Earnings | Defined |
| C-073 | Earnings Chart | Driver | Earnings | Defined |
| C-080 | SOS Button | Rider/Driver | Safety | Defined |
| C-081 | Safety Alert Card | Admin | Safety | Defined |
| C-082 | Trip Anomaly Indicator | Rider | Safety | Defined |
| C-083 | Trusted Contact Notification | Rider/Driver | Safety | Defined |
| C-090 | Demand Heatmap Layer | Driver | Heatmap | Defined |
| C-091 | Zone Demand Tooltip | Driver | Heatmap | Defined |
| C-092 | AI Positioning Strip | Driver | Heatmap | Defined |
| C-100 | AI Insight Panel | Driver | AI | Defined |
| C-101 | AI Pricing Badge | Rider | AI | Defined |
| C-102 | Marketplace Health Gauge | Admin/Founder | AI | Defined |
| C-110 | KPI Stat Widget | Admin/Founder | Metrics | Defined |
| C-111 | Revenue Ticker | Founder | Metrics | Defined |
| C-112 | Live Activity Feed | Admin/Founder | Metrics | Defined |
| C-113 | Supply vs Demand Chart | Admin/Founder | Metrics | Defined |
| C-120 | Founder Dashboard Header | Founder | Command Center | Defined |
| C-121 | Growth Metrics Panel | Founder | Command Center | Defined |
| C-122 | Cash Flow Summary Panel | Founder | Command Center | Defined |
| C-123 | Rider Savings Panel | Founder | Command Center | Defined |
| C-124 | Driver Earnings Performance Panel | Founder | Command Center | Defined |
| C-125 | AI Performance Summary Panel | Founder | Command Center | Defined |
| C-126 | Market Expansion Dashboard Panel | Founder | Command Center | Defined |
| C-127 | Competitor Pricing Dashboard Panel | Founder | Command Center | Defined |
| C-128 | Revenue Forecast Dashboard Panel | Founder | Command Center | Defined |
| C-129 | Unit Economics Dashboard Panel | Founder | Command Center | Defined |
| C-130 | Admin Sidebar Navigation | Admin | Admin | Defined |
| C-131 | Data Table | Admin | Admin | Defined |
| C-132 | Admin Action Menu | Admin | Admin | Defined |
| C-133 | Trip Route Replay | Admin | Admin | Defined |

**Total Components Defined: 67**

---

## Document Status

**Document:** 04-component-library.md
**Version:** 1.1 — Revised per Founder Approval
**Status:** v1.0 Approved · v1.1 additions pending approval

**v1.0 (55 components — Approved):**
- [x] 11 Shared / Universal · 4 Fare · 4 Bid · 4 Driver · 4 Rider
- [x] 4 Airport Queue · 4 Earnings · 4 Safety · 3 Heatmap
- [x] 3 AI · 4 Metrics · 6 Founder Command Center · 4 Admin

**v1.1 Additions (12 components — Pending Approval):**
- [x] Rider: Ride History Card (Enhanced), Favorite Locations Card, Ride Savings Tracker, Referral Rewards Card
- [x] Driver: Acceptance Rate Card, Earnings Goal Tracker, Airport Queue Compact, Heatmap Earnings Predictor
- [x] Founder: Market Expansion, Competitor Pricing, Revenue Forecast, Unit Economics panels

**Next document:**
`05-rider-app-ui.md` — Every rider screen with wireframes and user flows

---

*BidRide Component Library — Confidential*
*Delaware LLC — All rights reserved*
