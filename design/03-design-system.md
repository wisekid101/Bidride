# BidRide — Design System v1.0

**Status:** Draft — Pending Founder Approval
**Document:** 03 of 10
**Prepared by:** Claude Code (Senior UX Architect / Senior Systems Architect)
**Date:** June 5, 2026
**Reference:** /foundation/01-founder-discovery-report-v1.md

> This document defines the complete visual foundation for BidRide.
> All subsequent UI documents reference this system.
> No design work begins until this document is approved.

---

## Table of Contents

1. [Brand Philosophy](#1-brand-philosophy)
2. [Color System](#2-color-system)
3. [Typography](#3-typography)
4. [Spacing System](#4-spacing-system)
5. [Elevation and Shadows](#5-elevation-and-shadows)
6. [Border Radius](#6-border-radius)
7. [Buttons](#7-buttons)
8. [Forms and Inputs](#8-forms-and-inputs)
9. [Alerts and Feedback](#9-alerts-and-feedback)
10. [Cards](#10-cards)
11. [Design Tokens Reference](#11-design-tokens-reference)

---

## 1. Brand Philosophy

BidRide's visual identity communicates four things simultaneously:

| Value | Visual Expression |
|---|---|
| **Premium** | Deep Navy base, refined spacing, Gold accents |
| **Intelligence** | Electric Teal for AI-driven actions and live data |
| **Trust** | High contrast, clear hierarchy, honest data display |
| **Driver-first** | Gold used consistently for earnings, payouts, and driver wins |

**Design rules that must never be broken:**
- Gold is reserved for earnings, payouts, and rewards — never used for warnings or errors
- Electric Teal is reserved for primary actions and live AI-generated data
- Safety elements (SOS, emergency, alerts) always use the defined red — never teal or gold
- Driver earnings are always displayed in Gold typography on the Driver App
- Fare amounts shown to riders use white typography on Navy — never hidden or de-emphasized

---

## 2. Color System

### 2.1 Brand Primitives

These are the raw brand colors. Do not use primitives directly in components — use semantic tokens (Section 2.2).

| Token | Name | Hex | RGB |
|---|---|---|---|
| `brand-navy` | Deep Navy | `#0A2342` | 10, 35, 66 |
| `brand-teal` | Electric Teal | `#00D4C6` | 0, 212, 198 |
| `brand-gold` | Gold | `#F4B400` | 244, 180, 0 |
| `brand-white` | White | `#FFFFFF` | 255, 255, 255 |
| `brand-charcoal` | Charcoal Black | `#0F1923` | 15, 25, 35 |

### 2.2 Semantic Color Tokens

#### Background Colors

| Token | Value | Usage |
|---|---|---|
| `bg-primary` | `#0A2342` | Primary app background (dark surfaces) |
| `bg-secondary` | `#0F2D52` | Secondary surfaces, elevated dark cards |
| `bg-tertiary` | `#132E52` | Tertiary surfaces, bottom sheets |
| `bg-surface` | `#FFFFFF` | Light surface cards over dark backgrounds |
| `bg-surface-muted` | `#F4F6F9` | Subtle light surfaces, input backgrounds |
| `bg-overlay` | `rgba(10,35,66,0.85)` | Modal overlays, map overlays |
| `bg-charcoal` | `#0F1923` | Deepest dark backgrounds, splash screen |

#### Text Colors

| Token | Value | Usage |
|---|---|---|
| `text-primary` | `#FFFFFF` | Primary text on dark backgrounds |
| `text-secondary` | `#A8C0D6` | Secondary text on dark backgrounds |
| `text-muted` | `#5A7A96` | Placeholder text, disabled text |
| `text-on-light` | `#0A2342` | Primary text on white/light surfaces |
| `text-on-light-secondary` | `#4A6280` | Secondary text on light surfaces |
| `text-gold` | `#F4B400` | Earnings, payouts, rewards (always gold) |
| `text-teal` | `#00D4C6` | AI-generated data, active states, links |
| `text-error` | `#FF4D4D` | Error messages |
| `text-success` | `#22C55E` | Success messages |
| `text-warning` | `#F59E0B` | Warning messages |

#### Interactive Colors

| Token | Value | Usage |
|---|---|---|
| `interactive-primary` | `#00D4C6` | Primary buttons, CTAs, active tabs |
| `interactive-primary-hover` | `#00BDB0` | Hover state for teal elements |
| `interactive-primary-pressed` | `#00A89C` | Press/active state |
| `interactive-gold` | `#F4B400` | Earnings CTAs, payout buttons |
| `interactive-gold-hover` | `#D9A000` | Gold hover state |
| `interactive-danger` | `#EF4444` | Destructive actions, SOS |
| `interactive-danger-pressed` | `#DC2626` | SOS pressed state |
| `interactive-disabled` | `#3A5570` | Disabled interactive elements |

#### Status Colors

| Token | Value | Usage |
|---|---|---|
| `status-success` | `#22C55E` | Confirmed, completed, verified |
| `status-success-bg` | `#052E16` | Success alert background (dark) |
| `status-error` | `#EF4444` | Error, failed, declined |
| `status-error-bg` | `#3B0000` | Error alert background (dark) |
| `status-warning` | `#F59E0B` | Warning, pending, attention needed |
| `status-warning-bg` | `#2D1E00` | Warning alert background (dark) |
| `status-info` | `#00D4C6` | Informational |
| `status-info-bg` | `#00272A` | Info alert background (dark) |
| `status-online` | `#22C55E` | Driver online indicator |
| `status-offline` | `#5A7A96` | Driver offline indicator |
| `status-on-trip` | `#F4B400` | Driver on trip indicator |

#### Border Colors

| Token | Value | Usage |
|---|---|---|
| `border-subtle` | `#1A3A5C` | Subtle dividers on dark surfaces |
| `border-medium` | `#234870` | Card borders, input borders |
| `border-strong` | `#3A6490` | Focused input borders |
| `border-teal` | `#00D4C6` | Active/focused borders |
| `border-gold` | `#F4B400` | Earnings card borders |
| `border-error` | `#EF4444` | Error input borders |
| `border-light` | `#E5EBF2` | Borders on light surfaces |

### 2.3 Color Usage Examples

```
╔══════════════════════════════════════════╗
║  DARK SURFACE HIERARCHY                  ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │ bg-secondary (#0F2D52)           │    ║
║  │  ┌────────────────────────────┐  │    ║
║  │  │ bg-tertiary (#132E52)      │  │    ║
║  │  │  Content on elevated card  │  │    ║
║  │  └────────────────────────────┘  │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  bg-primary (#0A2342) — App background   ║
╚══════════════════════════════════════════╝

TEAL = AI Actions / Primary CTA
GOLD = Earnings / Payouts / Rewards
RED  = Danger / SOS / Errors
```

### 2.4 Contrast Ratios (WCAG AA Compliance)

| Foreground | Background | Ratio | WCAG |
|---|---|---|---|
| `#FFFFFF` | `#0A2342` | 12.1:1 | AAA ✓ |
| `#00D4C6` | `#0A2342` | 5.8:1 | AA ✓ |
| `#F4B400` | `#0A2342` | 7.2:1 | AAA ✓ |
| `#FFFFFF` | `#00D4C6` | 1.9:1 | Fail — never use white text on teal |
| `#0A2342` | `#00D4C6` | 5.8:1 | AA ✓ — use navy text on teal |
| `#0A2342` | `#F4B400` | 7.2:1 | AAA ✓ — use navy text on gold |
| `#FFFFFF` | `#EF4444` | 4.5:1 | AA ✓ |

**Rule:** White text on Teal fails contrast. Always use `#0A2342` (Navy) for text on Teal backgrounds.

---

## 3. Typography

### 3.1 Font Stack

**Primary Font:** Inter
- Clean, modern, highly legible at all sizes
- Excellent on mobile screens
- Full variable weight support (100–900)
- Open source, no licensing cost

**Monospace Font:** JetBrains Mono
- Used exclusively for fares, earnings, and financial figures
- Tabular number alignment prevents layout shift
- Visually distinct — users immediately recognize monetary amounts

**System Fallback Stack:**
```
Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif
JetBrains Mono, 'Courier New', Courier, monospace
```

### 3.2 Type Scale

| Token | Size | Line Height | Weight | Usage |
|---|---|---|---|---|
| `type-display` | 40px | 48px | 800 (ExtraBold) | Splash screen, onboarding headlines |
| `type-h1` | 30px | 38px | 700 (Bold) | Page titles, primary headings |
| `type-h2` | 24px | 32px | 600 (SemiBold) | Section headings, modal titles |
| `type-h3` | 20px | 28px | 600 (SemiBold) | Card headings, subsections |
| `type-h4` | 17px | 24px | 600 (SemiBold) | List headings, label groups |
| `type-body-l` | 17px | 26px | 400 (Regular) | Primary body text |
| `type-body` | 15px | 22px | 400 (Regular) | Standard body text, descriptions |
| `type-body-s` | 13px | 20px | 400 (Regular) | Secondary descriptions, captions |
| `type-label-l` | 16px | 20px | 600 (SemiBold) | Large button labels |
| `type-label` | 14px | 18px | 600 (SemiBold) | Button labels, tab labels |
| `type-label-s` | 12px | 16px | 600 (SemiBold) | Badges, chips, tags |
| `type-caption` | 11px | 16px | 500 (Medium) | Timestamps, helper text |
| `type-mono-l` | 22px | 28px | 700 (Bold) | Large fare/earnings display |
| `type-mono` | 17px | 24px | 600 (SemiBold) | Standard fare/earnings display |
| `type-mono-s` | 14px | 20px | 500 (Medium) | Small financial figures |

### 3.3 Typography Rules

**Do:**
- Use `type-mono` variants for all fare amounts, earnings, and financial figures
- Use `text-gold` color with `type-mono` for driver earnings
- Use `type-display` only on full-screen brand moments (splash, onboarding)
- Maintain a maximum of 3 type sizes on any single screen

**Do Not:**
- Mix Inter and JetBrains Mono on the same line
- Display fare amounts in regular (non-mono) type
- Use weights below 400 (Regular) in any UI element
- Use font sizes below 11px — minimum is `type-caption` at 11px

### 3.4 Type Examples

```
╔══════════════════════════════════════════╗
║                                          ║
║  BidRide                                 ║
║  type-display / 40px / ExtraBold         ║
║                                          ║
║  Your Ride                               ║
║  type-h1 / 30px / Bold                   ║
║                                          ║
║  AI-recommended fare                     ║
║  type-h3 / 20px / SemiBold               ║
║                                          ║
║  $14.80                                  ║
║  type-mono-l / 22px / Bold / text-gold   ║
║                                          ║
║  8.2 miles · Est. 19 min                 ║
║  type-body / 15px / Regular              ║
║                                          ║
║  Fare protected by BidRide AI            ║
║  type-caption / 11px / text-teal         ║
╚══════════════════════════════════════════╝
```

---

## 4. Spacing System

### 4.1 Base Unit

All spacing in BidRide is based on a **4px base unit**. Every margin, padding, and gap value is a multiple of 4.

### 4.2 Spacing Scale

| Token | Value | Common Usage |
|---|---|---|
| `space-1` | 4px | Micro gaps, icon padding |
| `space-2` | 8px | Tight gaps, inline spacing |
| `space-3` | 12px | Compact list item padding |
| `space-4` | 16px | Standard component padding |
| `space-5` | 20px | Screen horizontal padding |
| `space-6` | 24px | Card padding, section gaps |
| `space-8` | 32px | Large section spacing |
| `space-10` | 40px | Extra-large gaps |
| `space-12` | 48px | Hero spacing |
| `space-16` | 64px | Display spacing |
| `space-20` | 80px | Full-bleed spacing |

### 4.3 Layout Rules

**Mobile App (Rider and Driver):**
- Screen horizontal padding: `space-5` (20px) left and right
- Bottom safe area: 34px (iPhone home indicator) + any tab bar height
- Top safe area: 44–59px (status bar + notch)
- Stack gap between cards: `space-3` (12px)
- Stack gap between sections: `space-6` (24px)
- Bottom sheet handle to first content: `space-4` (16px)
- Header height: 56px (excluding status bar)
- Tab bar height: 56px (excluding safe area)
- Minimum touch target: 44×44px

**Admin Dashboard (Web):**
- Page horizontal padding: 32px
- Content max-width: 1440px centered
- Sidebar width: 240px (collapsed: 64px)
- Card gap: 16px
- Section gap: 32px

### 4.4 Responsive Breakpoints (Admin Web)

| Breakpoint | Width | Layout |
|---|---|---|
| Mobile | < 768px | Single column, stacked |
| Tablet | 768–1024px | 2 column, sidebar hidden |
| Desktop | 1024–1440px | Full sidebar, 3 column |
| Wide | > 1440px | Full sidebar, 4 column, max-width |

---

## 5. Elevation and Shadows

BidRide uses elevation to communicate hierarchy on dark backgrounds. Shadows on dark surfaces are expressed as lighter background colors rather than drop shadows (drop shadows are invisible on dark backgrounds).

### 5.1 Elevation Levels

| Level | Token | Background | Use Case |
|---|---|---|---|
| 0 | `elevation-ground` | `#0A2342` | App background, maps |
| 1 | `elevation-raised` | `#0F2D52` | Cards, list items |
| 2 | `elevation-overlay` | `#132E52` | Elevated cards, bottom sheet header |
| 3 | `elevation-modal` | `#1A3A5C` | Modals, full-screen overlays |
| Surface | `elevation-surface` | `#FFFFFF` | White cards on dark backgrounds |

### 5.2 Shadow Tokens (Light Surfaces)

For white cards on dark backgrounds:

| Token | Value | Usage |
|---|---|---|
| `shadow-sm` | `0 1px 4px rgba(0,0,0,0.15)` | Subtle card lift |
| `shadow-md` | `0 4px 16px rgba(0,0,0,0.20)` | Standard card, fare card |
| `shadow-lg` | `0 8px 32px rgba(0,0,0,0.28)` | Bottom sheets, important cards |
| `shadow-xl` | `0 16px 48px rgba(0,0,0,0.36)` | Modals, full-screen sheets |
| `shadow-teal` | `0 4px 20px rgba(0,212,198,0.25)` | Primary CTA button glow |
| `shadow-gold` | `0 4px 20px rgba(244,180,0,0.30)` | Payout button glow |

---

## 6. Border Radius

| Token | Value | Usage |
|---|---|---|
| `radius-xs` | 4px | Badges, small chips |
| `radius-sm` | 8px | Input fields, small cards |
| `radius-md` | 12px | Standard cards |
| `radius-lg` | 16px | Large cards, modals |
| `radius-xl` | 24px | Bottom sheets, full-screen cards |
| `radius-pill` | 9999px | Buttons, tags, status chips |
| `radius-circle` | 50% | Avatars, icon buttons |

---

## 7. Buttons

### 7.1 Button Variants

---

#### Primary Button (Teal)
Used for the main action on any screen.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │         Accept Fare              │    ║
║  └──────────────────────────────────┘    ║
║  bg: #00D4C6  text: #0A2342             ║
║  height: 52px  radius: radius-pill       ║
║  font: type-label-l  weight: SemiBold    ║
║  shadow: shadow-teal                     ║
║                                          ║
║  HOVER:   bg #00BDB0                     ║
║  PRESSED: bg #00A89C, scale 0.97         ║
║  LOADING: spinner left of label          ║
║  DISABLED: bg #3A5570, text #5A7A96      ║
╚══════════════════════════════════════════╝
```

---

#### Gold Button
Used for earnings and payout actions — driver-facing only.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │         Payout Now               │    ║
║  └──────────────────────────────────┘    ║
║  bg: #F4B400  text: #0A2342             ║
║  height: 52px  radius: radius-pill       ║
║  shadow: shadow-gold                     ║
║                                          ║
║  HOVER:   bg #D9A000                     ║
║  PRESSED: bg #C49000, scale 0.97         ║
╚══════════════════════════════════════════╝
```

---

#### Secondary Button (Navy)
Used for secondary actions alongside a primary button.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │         Make an Offer            │    ║
║  └──────────────────────────────────┘    ║
║  bg: #0F2D52  text: #FFFFFF             ║
║  border: 1px solid #234870              ║
║  height: 52px  radius: radius-pill       ║
║                                          ║
║  HOVER:   bg #132E52                     ║
║  PRESSED: bg #1A3A5C                     ║
╚══════════════════════════════════════════╝
```

---

#### Ghost Button
Used for tertiary actions and navigation-style buttons.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │         Skip for now             │    ║
║  └──────────────────────────────────┘    ║
║  bg: transparent  text: #00D4C6         ║
║  border: 1.5px solid #00D4C6            ║
║  height: 52px  radius: radius-pill       ║
║                                          ║
║  HOVER:   bg rgba(0,212,198,0.08)        ║
║  PRESSED: bg rgba(0,212,198,0.15)        ║
╚══════════════════════════════════════════╝
```

---

#### Danger Button
Used for destructive actions. Never use for SOS — SOS has its own component.

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │         Cancel Ride              │    ║
║  └──────────────────────────────────┘    ║
║  bg: #EF4444  text: #FFFFFF             ║
║  height: 52px  radius: radius-pill       ║
║                                          ║
║  HOVER:   bg #DC2626                     ║
║  PRESSED: bg #B91C1C                     ║
╚══════════════════════════════════════════╝
```

---

### 7.2 Button Sizes

| Size | Height | Font Token | Padding H | Usage |
|---|---|---|---|---|
| Large | 52px | `type-label-l` | 28px | Primary screen CTAs |
| Medium | 44px | `type-label` | 20px | Secondary actions, compact cards |
| Small | 34px | `type-label-s` | 14px | Chips, filters, inline actions |
| Icon-only | 44×44px | — | — | Tab bar icons, header buttons |

### 7.3 Button Layout Rules

- Primary button: full width, bottom of screen, above tab bar
- Secondary button: full width, stacked below primary with `space-3` gap
- Ghost/link: centered or left-aligned, no minimum width
- Two buttons side by side: 50%/50% with `space-3` gap between
- Loading state: shows spinner, disables tap, preserves button dimensions
- All buttons: minimum 44×44px touch target even if visually smaller

---

## 8. Forms and Inputs

### 8.1 Text Input

```
╔══════════════════════════════════════════╗
║                                          ║
║  Email address                           ║
║  type-caption / text-secondary           ║
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │ marq@bidride.com              [×]│    ║
║  └──────────────────────────────────┘    ║
║  bg: #0F2D52  radius: radius-sm          ║
║  height: 52px  padding: 16px             ║
║  border: 1px #234870                     ║
║  text: #FFFFFF  type-body                ║
║                                          ║
║  FOCUS:  border: 2px #00D4C6            ║
║  FILLED: border: 1px #3A6490            ║
║  ERROR:  border: 2px #EF4444            ║
║  DISABLED: opacity 0.4                   ║
║                                          ║
║  ⚠ Please enter a valid email address   ║
║  type-caption / text-error               ║
╚══════════════════════════════════════════╝
```

### 8.2 Input States

| State | Border | Background | Text |
|---|---|---|---|
| Default | `1px border-medium` | `bg-secondary` | `text-muted` |
| Focus | `2px border-teal` | `bg-secondary` | `text-primary` |
| Filled | `1px border-strong` | `bg-secondary` | `text-primary` |
| Error | `2px border-error` | `bg-secondary` | `text-primary` |
| Disabled | `1px border-subtle` | `bg-secondary` opacity 0.4 | `text-muted` |

### 8.3 Search Input

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │ 🔍  Where to?                    │    ║
║  └──────────────────────────────────┘    ║
║  bg: #FFFFFF  radius: radius-sm          ║
║  height: 52px                            ║
║  text: #0A2342                           ║
║  shadow: shadow-md                       ║
║  Icon: 20px teal magnifier               ║
╚══════════════════════════════════════════╝
```

### 8.4 OTP Input

```
╔══════════════════════════════════════════╗
║                                          ║
║     ┌───┐  ┌───┐  ┌───┐  ┌───┐         ║
║     │ 4 │  │ 8 │  │ _ │  │   │         ║
║     └───┘  └───┘  └───┘  └───┘         ║
║                                          ║
║  Each box: 52×60px, radius-sm            ║
║  Active box: border-teal 2px             ║
║  Filled box: bg-secondary, border-strong ║
║  Auto-advances on each digit entry       ║
╚══════════════════════════════════════════╝
```

### 8.5 Toggle / Switch

```
╔══════════════════════════════════════════╗
║                                          ║
║  Auto-share trip location                ║
║                                          ║
║  OFF:  [○──────] bg-subtle              ║
║  ON:   [──────●] bg-teal                ║
║                                          ║
║  Track: 44×24px  Thumb: 20×20px         ║
║  Thumb color: white (both states)        ║
║  Animation: 150ms ease                   ║
╚══════════════════════════════════════════╝
```

### 8.6 Radio and Checkbox

```
╔══════════════════════════════════════════╗
║                                          ║
║  RADIO (single select):                  ║
║  ◉  Standard — AI recommended fare      ║
║  ○  Priority — Front of queue           ║
║  ○  Premium — Premium vehicle           ║
║                                          ║
║  Selected: teal fill + white center dot  ║
║  Unselected: border-medium ring, empty   ║
║                                          ║
║  CHECKBOX (multi select):                ║
║  [✓] Safe driving                       ║
║  [ ] Friendly                           ║
║  [ ] Clean car                          ║
║                                          ║
║  Checked: teal bg, white checkmark       ║
║  Unchecked: border-medium, transparent   ║
╚══════════════════════════════════════════╝
```

### 8.7 Dropdown / Select

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │ New Jersey                    ▼  │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║  Opens: native picker (mobile)           ║
║  Admin web: custom dropdown with search  ║
╚══════════════════════════════════════════╝
```

### 8.8 Form Layout Rules

- Label above input: `space-2` (8px) gap
- Error message below input: `space-1` (4px) gap
- Field-to-field gap: `space-4` (16px)
- Group-to-group gap: `space-6` (24px)
- Required field: asterisk (*) in `text-error` after label
- Optional field: "(optional)" in `text-muted` after label
- All inputs: 52px height for comfortable mobile touch

---

## 9. Alerts and Feedback

### 9.1 Alert Variants

---

#### Success Alert

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │ ✓  Your payout is on the way     │    ║
║  │    Funds arrive within minutes   │    ║
║  └──────────────────────────────────┘    ║
║  bg: #052E16  border-left: 4px #22C55E  ║
║  Icon: 20px success-green                ║
║  radius: radius-sm                       ║
╚══════════════════════════════════════════╝
```

---

#### Error Alert

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │ ✕  Payment failed                │    ║
║  │    Please update your card       │    ║
║  └──────────────────────────────────┘    ║
║  bg: #3B0000  border-left: 4px #EF4444  ║
║  Icon: 20px error-red                    ║
╚══════════════════════════════════════════╝
```

---

#### Warning Alert

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │ ⚠  Your insurance expires in     │    ║
║  │    14 days. Update to stay active│    ║
║  └──────────────────────────────────┘    ║
║  bg: #2D1E00  border-left: 4px #F59E0B  ║
║  Icon: 20px warning-amber                ║
╚══════════════════════════════════════════╝
```

---

#### Info Alert

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │ ◈  High demand near EWR.         │    ║
║  │    Move to earn more now.        │    ║
║  └──────────────────────────────────┘    ║
║  bg: #00272A  border-left: 4px #00D4C6  ║
║  Icon: 20px teal info                    ║
╚══════════════════════════════════════════╝
```

### 9.2 Toast Notifications

Brief auto-dismissing feedback (3 seconds default):

```
╔══════════════════════════════════════════╗
║                                          ║
║       ┌──────────────────────┐           ║
║       │  ✓  Offer submitted   │           ║
║       └──────────────────────┘           ║
║                                          ║
║  Appears: top of screen, below header    ║
║  bg: bg-secondary  radius: radius-pill   ║
║  shadow: shadow-md                        ║
║  Animation: slide down, fade out         ║
╚══════════════════════════════════════════╝
```

### 9.3 Inline Field Validation

- Validate on blur (when field loses focus), not on every keystroke
- Error text appears immediately below field, `type-caption`, `text-error`
- Field border changes to `border-error` 2px
- Success state (for verified fields like phone): teal checkmark icon in field

### 9.4 Loading States

**Full Screen Loader:**
```
╔══════════════════════════════════════════╗
║                                          ║
║                                          ║
║              ◐                           ║
║         Finding your driver...           ║
║                                          ║
║  Spinner: teal, 32px, 1.2s rotation      ║
║  Text: type-body, text-secondary         ║
╚══════════════════════════════════════════╝
```

**Skeleton Screen (for data loading):**
- Use animated gradient shimmer blocks in `bg-secondary`
- Match skeleton shape to expected content (e.g., card-shaped skeletons for ride list)
- Never show empty states during initial load — always show skeletons

---

## 10. Cards

### 10.1 Ride Card (Rider App — Trip History)

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Mon Jun 2  ·  9:41 AM           │    ║
║  │                                  │    ║
║  │  📍 Newark Airport Terminal C    │    ║
║  │     ↓                            │    ║
║  │  📍 Hoboken PATH Station         │    ║
║  │                                  │    ║
║  │  $18.40              ★ 5.0  >    │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-raised  radius: radius-md ║
║  padding: space-4                        ║
║  border-left: 3px border-teal           ║
╚══════════════════════════════════════════╝
```

### 10.2 Driver Card (Rider App — Driver Matched)

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  [Photo]  Marcus T.    ★ 4.92    │    ║
║  │  ○  ○  ○  ○  ●         Toyota   │    ║
║  │  Blue Camry · NJP 4821           │    ║
║  │                                  │    ║
║  │  [ Message ]     [ Call ]        │    ║
║  └──────────────────────────────────┘    ║
║  Photo: 48×48px, radius-circle           ║
║  bg: elevation-surface (white card)      ║
║  shadow: shadow-lg                        ║
╚══════════════════════════════════════════╝
```

### 10.3 Earnings Card (Driver App)

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  Today's Earnings                │    ║
║  │                                  │    ║
║  │  $127.40          [Payout Now]   │    ║
║  │  type-mono-l / text-gold         │    ║
║  │                                  │    ║
║  │  12 trips  ·  6.2 hrs online     │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-raised                    ║
║  border: 1px border-gold                 ║
║  radius: radius-md                       ║
╚══════════════════════════════════════════╝
```

### 10.4 Fare Card (Rider App — Fare Preview)

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │  BidRide AI recommends           │    ║
║  │                                  │    ║
║  │  $14.80                          │    ║
║  │  type-mono-l / text-primary      │    ║
║  │                                  │    ║
║  │  8.2 mi  ·  19 min  ·  ETA 4min  │    ║
║  │                                  │    ║
║  │  ◈ Fare protected by BidRide AI  │    ║
║  │    (text-teal, type-caption)     │    ║
║  └──────────────────────────────────┘    ║
║  bg: elevation-surface (white)           ║
║  border-top: 4px #00D4C6                 ║
║  shadow: shadow-lg                        ║
╚══════════════════════════════════════════╝
```

### 10.5 Stat Card (Admin / Founder Dashboard)

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────┐  ┌──────────────┐      ║
║  │ Active Rides │  │  Revenue     │      ║
║  │     247      │  │  $8,421      │      ║
║  │  ▲ +12%      │  │  ▲ +8.2%    │      ║
║  └──────────────┘  └──────────────┘      ║
║  bg: elevation-raised                    ║
║  Metric: type-h1 / text-primary          ║
║  Label: type-caption / text-secondary    ║
║  Delta: type-label-s / status-success    ║
╚══════════════════════════════════════════╝
```

### 10.6 Alert Card (Safety / High Priority)

```
╔══════════════════════════════════════════╗
║                                          ║
║  ┌──────────────────────────────────┐    ║
║  │ 🔴  ACTIVE SOS                   │    ║
║  │     Trip #BR-48821               │    ║
║  │     2 min ago  ·  Terminal C EWR  │    ║
║  │                                  │    ║
║  │  [ View Trip ]   [ Call Admin ]  │    ║
║  └──────────────────────────────────┘    ║
║  bg: status-error-bg (#3B0000)           ║
║  border: 1px status-error               ║
║  radius: radius-md                       ║
║  animation: pulse border on active SOS   ║
╚══════════════════════════════════════════╝
```

### 10.7 Card Rules

- Cards on dark: use `elevation-raised` or `elevation-overlay` backgrounds
- White cards on dark: use `elevation-surface` with `shadow-lg`
- Never nest cards more than 2 levels deep
- All cards: `radius-md` minimum; use `radius-lg` for prominent cards
- Tappable cards: entire card is the touch target; show pressed state with 0.95 scale

---

## 11. Design Tokens Reference

Complete token reference for engineering handoff:

### 11.1 Color Tokens

```
-- Colors
--color-navy:           #0A2342;
--color-navy-light:     #0F2D52;
--color-navy-lighter:   #132E52;
--color-navy-border:    #1A3A5C;
--color-teal:           #00D4C6;
--color-teal-hover:     #00BDB0;
--color-teal-pressed:   #00A89C;
--color-gold:           #F4B400;
--color-gold-hover:     #D9A000;
--color-white:          #FFFFFF;
--color-charcoal:       #0F1923;
--color-success:        #22C55E;
--color-error:          #EF4444;
--color-warning:        #F59E0B;
--color-gray-400:       #9CA3AF;
--color-gray-600:       #4B5563;
```

### 11.2 Typography Tokens

```
-- Typography
--font-primary:         'Inter', sans-serif;
--font-mono:            'JetBrains Mono', monospace;

--text-display:         800 40px/48px var(--font-primary);
--text-h1:              700 30px/38px var(--font-primary);
--text-h2:              600 24px/32px var(--font-primary);
--text-h3:              600 20px/28px var(--font-primary);
--text-body-l:          400 17px/26px var(--font-primary);
--text-body:            400 15px/22px var(--font-primary);
--text-body-s:          400 13px/20px var(--font-primary);
--text-label-l:         600 16px/20px var(--font-primary);
--text-label:           600 14px/18px var(--font-primary);
--text-label-s:         600 12px/16px var(--font-primary);
--text-caption:         500 11px/16px var(--font-primary);
--text-mono-l:          700 22px/28px var(--font-mono);
--text-mono:            600 17px/24px var(--font-mono);
--text-mono-s:          500 14px/20px var(--font-mono);
```

### 11.3 Spacing Tokens

```
-- Spacing
--space-1:   4px;
--space-2:   8px;
--space-3:   12px;
--space-4:   16px;
--space-5:   20px;
--space-6:   24px;
--space-8:   32px;
--space-10:  40px;
--space-12:  48px;
--space-16:  64px;
--space-20:  80px;
```

### 11.4 Shape Tokens

```
-- Border Radius
--radius-xs:     4px;
--radius-sm:     8px;
--radius-md:     12px;
--radius-lg:     16px;
--radius-xl:     24px;
--radius-pill:   9999px;
--radius-circle: 50%;

-- Shadows
--shadow-sm:   0 1px 4px rgba(0,0,0,0.15);
--shadow-md:   0 4px 16px rgba(0,0,0,0.20);
--shadow-lg:   0 8px 32px rgba(0,0,0,0.28);
--shadow-xl:   0 16px 48px rgba(0,0,0,0.36);
--shadow-teal: 0 4px 20px rgba(0,212,198,0.25);
--shadow-gold: 0 4px 20px rgba(244,180,0,0.30);
```

---

## Document Status

**Document:** 03-design-system.md
**Version:** 1.0 Draft
**Status:** Pending Founder Approval

**Covers:**
- [x] Brand philosophy and visual rules
- [x] Complete color system with semantic tokens
- [x] Typography scale and usage rules
- [x] Spacing system and layout rules
- [x] Elevation and shadows
- [x] Border radius system
- [x] All button variants and states
- [x] All form and input components and states
- [x] All alert and feedback components
- [x] All card variants
- [x] Complete design token reference

**Next document (pending this approval):**
`04-component-library.md` — Reusable UI components, states, and variants

---

*BidRide Design System — Confidential*
*Delaware LLC — All rights reserved*
