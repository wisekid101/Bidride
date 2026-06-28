# BidiRide — Safety Shield System v1.0

**Status:** Draft — Pending Founder Approval
**Document:** Supplement to PRD v1.1 + Gap Analysis v1.0
**Prepared by:** Claude Code (AI Systems Architect / Safety Systems Engineer)
**Date:** June 5, 2026
**Founder Requirement:** Complete technical specification for BidiRide Safety Shield System

> Safety decisions override growth decisions.
> Every feature in this document is non-negotiable.
> No investor, executive, or growth target can remove or weaken these protections.

---

## Table of Contents

1. [Safety Philosophy and Governance](#1-safety-philosophy-and-governance)
2. [System Architecture](#2-system-architecture)
3. [Trip Safety State Machine](#3-trip-safety-state-machine)
4. [SOS System](#4-sos-system)
5. [Live Location Sharing](#5-live-location-sharing)
6. [Emergency Contacts](#6-emergency-contacts)
7. [Ride Recording — Audio (SOS-Triggered Only)](#7-ride-recording--audio-sos-triggered-only)
8. [Driver Panic Mode](#8-driver-panic-mode)
9. [Rider Panic Mode](#9-rider-panic-mode)
10. [Safe Check-In System](#10-safe-check-in-system)
11. [AI Anomaly Detection](#11-ai-anomaly-detection)
12. [Trip Deviation Alerts](#12-trip-deviation-alerts)
13. [Airport Safety Monitoring](#13-airport-safety-monitoring)
14. [Night Ride Safety Monitoring](#14-night-ride-safety-monitoring)
15. [Admin Response Protocols](#15-admin-response-protocols)
16. [Database Schema](#16-database-schema)
17. [API Endpoints](#17-api-endpoints)
18. [Admin Interface](#18-admin-interface)
19. [Integration Map](#19-integration-map)
20. [Gap Resolution Index](#20-gap-resolution-index)

---

## 1. Safety Philosophy and Governance

### 1.1 Founding Safety Principles

These principles govern every decision in this document and cannot be overridden:

1. **Safety overrides growth.** Any feature that improves safety is implemented regardless of cost or friction added to the booking flow.
2. **Proactive, not reactive.** BidiRide Safety Shield monitors every trip in real time — it does not wait for a report.
3. **Both parties are protected.** Riders and drivers receive identical safety protections. Safety is not one-sided.
4. **Speed is survival.** SOS response SLAs are measured in seconds, not minutes. Every escalation path has a hard time limit.
5. **Transparency without exposure.** Users know they are protected. They never see how the system scores risk internally.
6. **Discretion when needed.** Discreet escalation paths (panic modes) exist for situations where visible SOS activation is not safe.
7. **Humans in the loop.** AI detects. Humans decide. No automated action suspends an account or contacts emergency services without a human in the approval chain — except immediate audio recording during SOS, which is time-critical.

### 1.2 What Safety Shield Never Does

- Uses safety data to increase prices for riders in "high risk" areas
- Penalizes drivers for operating in certain neighborhoods
- Shares safety incident data with advertisers or third parties
- Uses safety flags to discriminate in matching (safety holds are temporary — not permanent exclusions without review)
- Removes a driver from the platform without human review of the evidence

---

## 2. System Architecture

```
╔══════════════════════════════════════════════════════════════════════╗
║                   BIDRIDE SAFETY SHIELD SYSTEM                       ║
║                                                                      ║
║  DATA INPUTS                                                         ║
║  ┌──────────────────────────────────────────────────────────────┐   ║
║  │  GPS Location   Route Engine   Speed    Stops   Time of Day  │   ║
║  │  Device Signals  SOS Button    Panic    Audio   Flight Data  │   ║
║  └──────────────────────────────────────────────────────────────┘   ║
║                             │                                        ║
║  SAFETY AI ENGINE                                                    ║
║  ┌──────────────────────────────────────────────────────────────┐   ║
║  │  Anomaly          Deviation      Night Ride    Airport        │   ║
║  │  Detector         Monitor        Monitor       Monitor        │   ║
║  └──────────────────────────────────────────────────────────────┘   ║
║                             │                                        ║
║  SAFETY STATE MACHINE (per active trip)                              ║
║  ┌──────────────────────────────────────────────────────────────┐   ║
║  │  NORMAL → SOFT_ALERT → MODERATE_ALERT → CRITICAL → SOS_ACTIVE│   ║
║  └──────────────────────────────────────────────────────────────┘   ║
║                             │                                        ║
║  RESPONSE SERVICES                                                   ║
║  ┌──────────────┐ ┌─────────────┐ ┌────────────┐ ┌──────────────┐  ║
║  │  SOS Service │ │  Panic Mode  │ │ Check-In   │ │  Recording   │  ║
║  │  (P0 alert)  │ │  (discreet) │ │  Service   │ │  Service     │  ║
║  └──────────────┘ └─────────────┘ └────────────┘ └──────────────┘  ║
║                             │                                        ║
║  NOTIFICATION SERVICES                                               ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │  Emergency Contacts  Safety Admin  911 Dispatch  In-App     │    ║
║  └─────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 2.1 Core Services

| Service | Responsibility |
|---|---|
| **Safety Monitor Service** | Runs on every active trip. Evaluates all AI anomaly rules every 30 seconds. Manages the trip safety state machine. |
| **SOS Service** | Handles SOS activation (rider or driver). Manages the 5-second confirmation window. Triggers P0 admin alert, emergency contacts, and audio recording. |
| **Panic Service** | Handles discreet panic mode activations. Silent escalation to admin without alerting the other party. |
| **Location Service** | Manages live location sharing — encrypted token-based trip links for emergency contacts. |
| **Recording Service** | SOS-triggered audio recording only. Manages encryption, storage, retention, and access. |
| **Check-In Service** | Post-ride safe check-in prompts and escalation when rider or driver does not respond. |
| **Emergency Contact Service** | Manages trusted contacts for both riders and drivers. Sends real-time SMS with live trip link at trip start (if enabled). |
| **Safety Admin Service** | Manages admin alert queues, SLAs, incident assignment, and escalation to emergency dispatch. |

---

## 3. Trip Safety State Machine

Every active trip exists in exactly one safety state at any moment. States are set by the Safety Monitor Service and escalate automatically based on AI rules.

```
NORMAL
  │
  ├──► SOFT_ALERT (yellow)
  │         │
  │         ├──► NORMAL (AI resolves benign signal)
  │         └──► MODERATE_ALERT (orange)
  │                   │
  │                   ├──► NORMAL (admin dismisses, or AI resolves)
  │                   ├──► SOFT_ALERT (partial resolution)
  │                   └──► CRITICAL (red)
  │                              │
  │                              ├──► NORMAL (admin resolves)
  │                              └──► SOS_ACTIVE (user activates SOS or auto-escalates)
  │
  └──► SOS_ACTIVE (user presses SOS — overrides all other states immediately)
              │
              └──► INCIDENT_CLOSED (admin marks resolved)
```

### 3.1 State Definitions

| State | Color | Meaning | Admin Action |
|---|---|---|---|
| NORMAL | Green | Trip proceeding as expected | None required |
| SOFT_ALERT | Yellow | Minor anomaly — monitoring increased | Logged; admin aware but no action required yet |
| MODERATE_ALERT | Orange | Significant anomaly — human eyes needed | Admin must review within 5 minutes |
| CRITICAL | Red | High-risk situation developing | Admin must act within 2 minutes |
| SOS_ACTIVE | Red pulsing | Emergency activated | Admin must respond within 90 seconds — SLA enforced |
| INCIDENT_CLOSED | Gray | Safety event resolved | No action |
| PANIC_ACTIVE | Red (silent) | Discreet panic escalation | Admin must respond within 3 minutes |

### 3.2 State Persistence

- States are stored in real time in Redis (for sub-second access by the Safety Admin dashboard)
- States are written to the `safety_sessions` table on every transition (durable log)
- A trip can only move to a higher alert state automatically — downgrade requires human admin action
- If a CRITICAL trip completes without SOS, it is placed in the post-trip High-Risk Review Queue (PRD A-27)

---

## 4. SOS System

### 4.1 SOS Trigger Sources

SOS can be activated from multiple entry points:

| Source | Who | How |
|---|---|---|
| In-app SOS button | Rider or Driver | Tap SOS button visible on all in-ride screens |
| Volume button shortcut | Rider or Driver | Hold both volume buttons for 3 seconds (works when phone is locked) |
| Auto-escalation | System | CRITICAL state with no rider/driver response within 60 seconds |
| Admin-triggered | Safety Admin | Admin can mark a trip as SOS from the Safety Command Center |

### 4.2 SOS Confirmation Flow (Rider)

```
╔══════════════════════════════════════════════════════════════════╗
║  STATE 1: SOS BUTTON (resting — always visible during trips)    ║
║                                                                  ║
║  ┌──────┐  Size: 52×52px  Position: bottom-right, z-max         ║
║  │ SOS  │  bg: #EF4444  border-radius: radius-circle            ║
║  └──────┘  Pulsing ring animation: 2s loop                      ║
║            Cannot be covered by any other UI element            ║
╠══════════════════════════════════════════════════════════════════╣
║  STATE 2: CONFIRMATION (5-second countdown)                     ║
║                                                                  ║
║  Full screen takeover                                            ║
║  bg: #1A0000 (deep red-black)                                   ║
║                                                                  ║
║              🔴                                                  ║
║         Sending SOS in                                           ║
║              4                                                   ║
║           seconds...                                             ║
║    type-display / text-primary                                   ║
║                                                                  ║
║    ┌────────────────────────────────────────┐                   ║
║    │         Cancel — I'm okay              │                   ║
║    └────────────────────────────────────────┘                   ║
║    Ghost button — full width — height: 64px                     ║
║    Large and accessible — works one-handed                      ║
║                                                                  ║
║  NOTE: If NO touch detected for 5 seconds → auto-confirms.      ║
║  This protects an incapacitated user who cannot interact.       ║
╠══════════════════════════════════════════════════════════════════╣
║  STATE 3: SOS ACTIVE                                             ║
║                                                                  ║
║  Full screen — bg: #3B0000                                       ║
║                                                                  ║
║              🔴                                                  ║
║        HELP IS ON THE WAY                                        ║
║        type-h1 / text-primary                                   ║
║                                                                  ║
║  ✓  Marcus notified        (trusted contact)                    ║
║  ✓  Sarah notified         (trusted contact)                    ║
║  ✓  BidiRide safety team alerted                                 ║
║  ✓  Your location is being shared                               ║
║  type-body / text-primary / list                                ║
║                                                                  ║
║  ┌────────────────────────────────────────┐                     ║
║  │         📞  Call 911                   │                     ║
║  └────────────────────────────────────────┘                     ║
║  Danger button — opens phone dialer with 911 pre-filled         ║
║  BidiRide never intercepts or replaces 911 contact               ║
║                                                                  ║
║  Stay calm. A BidiRide safety agent has been assigned.           ║
║  type-body / text-secondary                                      ║
║                                                                  ║
║  Audio recording has started for your safety.                   ║
║  type-caption / text-muted                                       ║
╚══════════════════════════════════════════════════════════════════╝
```

### 4.3 SOS Confirmation Flow (Driver)

Identical 3-state flow with driver-specific context:

- State 2: same countdown, same cancel button
- State 3 shows:
  - Trusted contacts notified (driver's contacts)
  - BidiRide safety team alerted
  - Rider has been notified "Your driver needs assistance"
  - Call 911 button
  - "Pull over safely if possible. Help is coming."

### 4.4 SOS Activation Sequence (Backend)

```
User activates SOS (or auto-escalation after countdown)
    │
    ├── T+0s: GPS coordinates captured and locked
    ├── T+0s: Trip state → SOS_ACTIVE
    ├── T+0s: safety_incidents record created (type: sos_rider or sos_driver)
    ├── T+0s: Audio recording begins (encrypted, stored to secure bucket)
    ├── T+0s: All trusted contacts receive SMS:
    │         "🔴 BidiRide Safety Alert: [Name] has activated emergency help.
    │          Live location: https://safe.bidiride.com/t/[token]
    │          This link updates in real time."
    ├── T+0s: Safety Admin dashboard receives P0 alert:
    │         - Audio ping on all online admin screens
    │         - Trip moves to top of SOS queue in A-26
    │         - SLA timer starts: 90 seconds to first admin action
    ├── T+5s: If no admin acknowledges → secondary admin paged
    ├── T+30s: If still no admin → escalation to on-call safety lead (SMS + call)
    ├── T+90s: SLA breach logged — admin who missed SLA flagged for review
    └── T+continuous: GPS updates to trusted contact link every 5 seconds
```

### 4.5 SOS Cancel Flow

If the user cancels during the 5-second window:

```
Cancel tapped
    → "Cancel" confirmed with one additional tap (prevents accidental cancel)
    → Trip returns to previous state (NORMAL / SOFT_ALERT)
    → No contacts notified
    → No admin alert triggered
    → Cancellation logged (silent — not a false SOS report)
    → Audio recording does NOT start
```

If the user accidentally activates SOS after it has confirmed (State 3):

```
"I'm safe" button appears on State 3 screen (secondary, below the 911 button)
    → Tapping "I'm safe" sends a safety check response to admin
    → Admin confirms the user is okay and closes the incident
    → Contacts notified: "Update: [Name] has confirmed they are safe."
    → Audio recording stops and is marked for deletion (or short retention)
    → Trust score is not penalized for accidental SOS
```

### 4.6 Volume Button SOS (Hardware Shortcut)

```
Trigger: Hold both Volume Up + Volume Down for 3 seconds
    → Works when phone is locked (critical — user may not be able to unlock)
    → App intercepts this gesture when in-ride screen is the active background app
    → Proceeds to STATE 2 (5-second countdown) on locked screen
    → If no interaction for 5 seconds → SOS activates

Fallback: If the app is backgrounded and does not intercept:
    → iOS: Native Emergency SOS (hold side button) — always available
    → Android: Emergency SOS (hold power button) — always available
    → BidiRide cannot disable native emergency functions
```

---

## 5. Live Location Sharing

### 5.1 Trip Link Architecture

Every active trip generates a live location link. The link is:
- Created at trip match (RS-009a / D-19 state)
- Token-based — does not expose trip ID or user identity
- Updated every 5 seconds with new GPS coordinates
- Accessible without login — emergency contacts do not need a BidiRide account
- Automatically expires when the trip reaches a terminal state (completed, cancelled, or SOS resolved)

### 5.2 Trip Link Token Format

```
URL:     https://safe.bidiride.com/t/{token}
Token:   32-character cryptographically random string
Example: https://safe.bidiride.com/t/f7x2k9mq3r8p1nv6yw4j5ct0bhe

Token properties:
  - UUID v4 base, re-encoded to URL-safe characters
  - Not predictable, not sequential
  - One token per trip — generated at matching time
  - Invalidated server-side on trip end (link returns "This trip has ended")
```

### 5.3 Live Trip Viewer Page (Public — No Login Required)

```
╔══════════════════════════════════════════════════════════════════╗
║  safe.bidiride.com/t/{token}                                      ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  BidiRide  🛡  Trip Safety View                                   ║
║                                                                  ║
║  ╔════════════════════════════════════════════╗                  ║
║  ║                                            ║                  ║
║  ║   [LIVE MAP — updates every 5 seconds]     ║                  ║
║  ║   Vehicle moving pin                       ║                  ║
║  ║   Route line to destination                ║                  ║
║  ║                                            ║                  ║
║  ╚════════════════════════════════════════════╝                  ║
║                                                                  ║
║  James R. is on a BidiRide                                        ║
║  (First name + last initial only — privacy)                      ║
║                                                                  ║
║  Est. arrival: 14 min                                            ║
║  Destination: Hoboken PATH Station area                          ║
║  (Destination shown as neighborhood, not exact address)          ║
║                                                                  ║
║  ⚡ Live updates active                                           ║
║  Last updated: 3 seconds ago                                     ║
║                                                                  ║
║  ─────────────────────────────                                   ║
║  Concerned? Call them directly or dial 911.                      ║
║  BidiRide safety: 1-800-BID-SAFE                                  ║
║                                                                  ║
║  Powered by BidiRide Safety Shield                                ║
╚══════════════════════════════════════════════════════════════════╝
```

**Privacy rules for the trip viewer:**
- Rider: shows first name + last initial, approximate destination neighborhood (not exact address)
- Driver: not shown on the trip viewer (protects driver from stalking)
- Exact pickup and dropoff addresses are never shown on the public link
- Vehicle make and color are shown (helps contact identify the vehicle in person)
- License plate is NOT shown on the public link

### 5.4 When the Trip Link is Sent

| Event | Who receives | How |
|---|---|---|
| Trip match confirmed | All rider trusted contacts with auto-share enabled | SMS with link |
| Trip match confirmed | All driver trusted contacts with auto-share enabled | SMS with link |
| SOS activated | All trusted contacts immediately | SMS with link + emergency message |
| Rider manually shares | Anyone the rider chooses | Native share sheet → link |
| Admin reviews incident | Safety admin | Link available in A-25 / A-26 |

### 5.5 Link Expiry and Post-Trip

```
Trip completes normally:
    → Trip link remains active for 5 minutes after completion (rider may still be walking)
    → After 5 minutes: link shows "This trip has ended. James arrived safely."
    → After 24 hours: link is fully expired (returns 404)

SOS event resolved:
    → Link remains active until admin marks incident Resolved
    → After resolution: link shows "This trip has ended. Safety incident resolved."

Trip cancelled:
    → Link immediately deactivated
    → Link shows "This trip was cancelled."
```

---

## 6. Emergency Contacts

### 6.1 Unified Emergency Contact System (Rider + Driver)

Emergency contacts are now defined for both riders and drivers. The `trusted_contacts` table already exists for riders. This section expands the system to cover drivers and adds configuration options.

### 6.2 Emergency Contact Configuration — Rider

| Setting | Options | Default |
|---|---|---|
| Maximum contacts | Up to 5 | — |
| Auto-share on every trip | On / Off | On |
| Notify when SOS activated | Always on (cannot be disabled) | On |
| Include in live link | On / Off per contact | On |

### 6.3 Emergency Contact Configuration — Driver

Driver emergency contacts are a new addition (resolving Gap G-02).

| Setting | Options | Default |
|---|---|---|
| Maximum contacts | Up to 5 | — |
| Auto-share at shift start | On / Off | Off (driver choice) |
| Auto-share on every trip | On / Off | Off (driver choice) |
| Notify when SOS activated | Always on (cannot be disabled) | On |
| Notify when panic mode activated | Always on (cannot be disabled) | On |

### 6.4 Emergency Contact SMS Messages

**Trip start (if auto-share enabled):**
```
BidiRide 🛡: [Name] just started a ride.
Live location: https://safe.bidiride.com/t/[token]
Reply STOP to opt out of future notifications.
```

**SOS activated:**
```
🔴 BidiRide SAFETY ALERT: [Name] has activated emergency help.
Live location (updating in real time): https://safe.bidiride.com/t/[token]
If you cannot reach them, call 911.
BidiRide Safety: 1-800-BID-SAFE
```

**Trip ended safely:**
```
BidiRide ✓: [Name] has arrived at their destination safely.
The live location link is no longer active.
```

**SOS resolved (user confirmed safe):**
```
BidiRide ✓: Update — [Name] has confirmed they are safe.
Thank you for being there for them.
```

### 6.5 Contact Opt-Out

Emergency contacts can reply STOP to opt out of BidiRide trip notifications. The user is notified when a contact opts out, so they can update their contacts list. Opted-out contacts are retained in the list but flagged as opted-out — they will still receive SOS messages (safety override).

---

## 7. Ride Recording — Audio (SOS-Triggered Only)

### 7.1 Recording Policy

**Audio recording in BidiRide Safety Shield activates only when SOS is triggered.**

This is a deliberate policy decision:

| Approach considered | Decision |
|---|---|
| Passive audio throughout every ride | Rejected — consent complexity, storage cost, privacy risk |
| Opt-in recording throughout ride | Rejected — creates pressure on riders/drivers to enable, unequal protection |
| SOS-triggered only | ✓ Selected — targeted, proportionate, legally cleaner |

**Legal basis for SOS-triggered recording:**
- NJ: One-party consent state — one party to the conversation (the SOS activator) consents by activating SOS
- SOS activation constitutes explicit consent to recording for safety purposes
- Users are informed during onboarding and in the Safety Center that SOS activates audio recording
- Users are also shown a notification on the SOS Active screen ("Audio recording has started for your safety")

**State law note for expansion:**
All-party consent states (e.g., California, Florida, Pennsylvania) require all parties to consent. As BidiRide expands, the legal team must determine whether SOS-triggered recording under emergency doctrine satisfies consent requirements in each state. This is a Phase 3 legal review item.

### 7.2 Recording Activation

```
SOS Confirmed (countdown completes or auto-confirms)
    → Recording service receives trigger: { trip_id, user_id, trigger: "sos", timestamp }
    → Device microphone access requested (iOS/Android permission — granted at install time)
    → If permission not granted: recording skipped, warning logged
    → Recording begins: continuous audio stream
    → Audio chunked every 60 seconds and uploaded to secure storage
    → Encryption: AES-256 at rest, TLS 1.3 in transit

Recording continues:
    → While SOS_ACTIVE state persists
    → Until user confirms "I'm safe" AND admin marks incident resolved
    → Hard stop: 60 minutes maximum (prevents indefinite recording)
    → If trip ends while SOS active: recording continues for 10 minutes post-trip
```

### 7.3 Recording Storage and Security

```
Storage:
    → AWS S3 bucket (dedicated safety-recordings bucket)
    → Bucket is private — no public access
    → Server-side encryption: AES-256 (SSE-S3)
    → Separate from all other BidiRide data buckets

Retention:
    → Incident open: recording retained until incident closed + 90 days
    → Incident closed (no formal action): retained 30 days, then auto-deleted
    → Incident closed (action taken — suspension/ban/law enforcement): retained 2 years
    → Law enforcement hold: retained indefinitely until hold is lifted

Access:
    → Super Admin: can request access, requires dual admin authorization
    → Safety Admin: can flag recording for legal team review (cannot directly play)
    → Legal team: access granted via signed, expiring URL (72-hour max)
    → Third parties (law enforcement): requires legal process (subpoena or warrant)
    → No automated AI processing of recording content

Deletion:
    → Automated deletion at end of retention period (scheduled job)
    → Deletion is logged in audit_logs with timestamp and authorization chain
    → No manual deletion by any admin without legal team sign-off
```

### 7.4 Recording Metadata Table

See Database Schema Section 16.4 (`safety_recordings`).

### 7.5 User Transparency

**Where users are informed about SOS recording:**

1. **Onboarding:** During Safety Center introduction (first-time walkthrough)
2. **Safety Center screen:** "Audio recording starts automatically when you activate SOS"
3. **SOS Active screen:** "Audio recording has started for your safety" (displayed on screen)
4. **Terms of Service:** Clear statement about SOS-triggered recording
5. **Privacy Policy:** Full retention and access policy disclosed

---

## 8. Driver Panic Mode

### 8.1 Purpose

Driver Panic Mode is a discreet emergency escalation for situations where:
- The driver feels unsafe but cannot visibly press SOS (rider is present and may react)
- The driver wants to alert BidiRide without alarming the rider
- The driver needs a silent check: "Is someone watching this trip right now?"

### 8.2 Activation Method

Discreet by design — the activation gesture is not visible as a button.

**Primary method:**
```
Driver taps the "Safety" icon in the header 3 times in rapid succession
(Triple-tap on the shield icon — not labeled as panic mode anywhere visible)

OR

Driver holds the volume-down button for 5 seconds while in-ride screen is active
(Different from SOS which uses both volume buttons simultaneously)
```

**No visible button labeled "Panic Mode" exists in the UI.**
The gesture is described only in driver onboarding and the Safety Center. Riders cannot discover it by looking at the driver's screen.

### 8.3 Panic Mode Activation Sequence

```
Driver activates Panic Mode
    │
    ├── T+0s: Device gives a single short vibration (silent confirmation)
    │         No visual change on screen visible to rider
    ├── T+0s: Trip state → PANIC_ACTIVE
    ├── T+0s: Safety admin receives SILENT PANIC alert in A-25:
    │         - Driver name + photo
    │         - Live GPS
    │         - Trip ID and rider info
    │         - "Driver has signaled distress — do not contact rider"
    │         - SLA timer: 3 minutes to first admin action
    ├── T+0s: Driver trusted contacts receive discreet SMS:
    │         (Only if driver has trusted contacts configured)
    │         "BidiRide check-in: [Name] is on a trip and wanted you to know.
    │          Live location: [link]"
    │         (No "panic" or "emergency" language — rider may see the notification)
    ├── T+30s: Admin sends discreet in-app message to DRIVER only:
    │         "Is everything okay? Reply 1 for Yes, 2 for No, 3 for Call me."
    │         (Appears as a quiet notification — looks like a system message)
    ├── Driver responds:
    │     1 (Yes) → Admin marks PANIC_ACTIVE as resolved, trips returns to NORMAL
    │     2 (No)  → Admin escalates to CRITICAL / considers SOS protocol
    │     3 (Call)→ Admin calls driver on masked number immediately
    │     No response in 90 seconds → Auto-escalates to CRITICAL
    └── Post-incident: Incident logged, driver's response pattern noted
```

### 8.4 Panic Mode UI

During PANIC_ACTIVE, the driver's screen shows NO visible change to protect them. The only feedback is the single vibration at activation.

Admin-side PANIC_ACTIVE appears in the Safety Command Center (A-25) with:
- Yellow border (not red — distinguishes from SOS)
- Icon: 🔕 (silent bell)
- Tag: "SILENT PANIC — Driver-initiated"
- Reminder: "Do NOT contact rider"

### 8.5 Panic Mode Deactivation

```
Driver resolves (replies 1 to admin)
    → State returns to NORMAL or previous state
    → No notification to rider
    → Incident logged as "Resolved — false alarm" or "Resolved — driver confirmed safe"

Driver confirms distress (replies 2)
    → Admin escalates to CRITICAL
    → Admin decides: escalate to full SOS protocol, contact driver, or dispatch

Trip ends normally while PANIC_ACTIVE
    → Admin sends a post-trip check-in call or message to driver within 10 minutes
    → Incident remains open until driver confirms post-trip
```

---

## 9. Rider Panic Mode

### 9.1 Purpose

Rider Panic Mode is the rider's equivalent of the driver's discreet escalation. Used when the rider cannot safely press SOS.

### 9.2 Activation Method

```
Primary method:
    Hold phone screen-down for 5 seconds while in-ride screen is active
    (Detects via accelerometer: face-down orientation sustained)
    Single vibration confirmation

Secondary method:
    Tap the status bar (time display) 5 times rapidly
    (Not discoverable by looking at the screen)
```

**Shake-to-panic is deliberately excluded.** Shake detection causes too many false activations in moving vehicles.

### 9.3 Rider Panic Mode Activation Sequence

```
Rider activates Panic Mode
    │
    ├── T+0s: Single vibration only
    ├── T+0s: Trip state → PANIC_ACTIVE
    ├── T+0s: Safety admin receives SILENT PANIC alert:
    │         - Rider name + photo
    │         - Live GPS
    │         - Trip ID and driver info
    │         - "Rider has signaled distress — approach with caution"
    │         - SLA: 3 minutes
    ├── T+30s: Admin sends discreet in-app notification to RIDER only:
    │         "Quick BidiRide check: Is everything going well?
    │          Tap ✓ for Yes or ✗ for No"
    │         (Looks like a standard ride update notification)
    ├── Rider responds:
    │     ✓ (Yes) → Resolved, trip returns to NORMAL
    │     ✗ (No)  → Escalates to CRITICAL
    │     No response → Escalates to CRITICAL after 90 seconds
    └── Post-incident logged
```

### 9.4 Combined Panic Mode (Both Parties Signal Simultaneously)

If both driver and rider have PANIC_ACTIVE simultaneously on the same trip:

```
→ Immediate auto-escalation to CRITICAL without waiting for response
→ All available safety admins alerted
→ Full SOS contact tree initiated for both parties
→ Admin considers immediate dispatch
```

---

## 10. Safe Check-In System

### 10.1 Purpose

Safe Check-In is a post-ride wellness feature. After a trip ends, the system verifies that the rider (and optionally the driver) reached safety, not just that the trip status changed to "completed."

This is especially important for:
- Night rides (10pm – 5am)
- Airport arrivals (rider arriving alone, late)
- Riders flagged as traveling solo to unfamiliar areas

### 10.2 Check-In Flow — Rider

```
Trip completes (driver taps End Trip)
    │
    ├── T+0s: Standard trip complete screen appears (RS-014)
    ├── T+2m: If rider has NOT opened the rating/tip screen (indicates possible issue):
    │         Push notification: "Did you arrive safely? Tap to confirm."
    │         One-tap response: [✓ I'm safe]
    │         Secondary: [I need help] → opens SOS flow
    │
    ├── Rider responds ✓:
    │     → Check-in recorded as safe
    │     → Trusted contacts receive optional notification: "[Name] arrived safely."
    │       (Only if rider has "send arrival confirmation" enabled in settings)
    │
    ├── Rider responds "I need help":
    │     → SOS flow opens immediately
    │     → Trip re-activated for safety purposes (safety_incidents created)
    │
    └── No response after 5 minutes (night rides) or 10 minutes (daytime):
            → Check-in escalation triggered:
                [Daytime] → Second push notification: "Checking in — are you okay?"
                             If no response in 10 more minutes → admin soft alert
                [Night ride] → Admin soft alert immediately (no second notification)
                             + Trusted contacts receive:
                               "BidiRide check-in: [Name]'s ride ended. We're checking in."
```

### 10.3 Check-In Flow — Driver (Post-Trip at Night)

```
Night ride completes (10pm – 5am)
    → After trip ends, driver app sends:
      "You've finished your ride. Are you okay to continue driving?"
      [👍 All good]  [📞 Contact safety]
    → Driver response logged
    → No response in 5 minutes: admin notification (passive — not P0)
```

### 10.4 Check-In Configuration

| Setting | Rider | Driver | Default |
|---|---|---|---|
| Post-trip check-in | Always active | Night rides only | Per above |
| Send arrival confirmation to contacts | Toggle | N/A | Off |
| Check-in window (time before escalation) | 5 min (night) / 10 min (day) | 5 min (night only) | Per above |

### 10.5 Check-In Screen Design

```
╔══════════════════════════════════════════════════════════════════╗
║  [Appears as bottom sheet over Home Screen after trip ends]     ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  🛡  Quick Safety Check                                          ║
║  type-h3 / text-primary                                          ║
║                                                                  ║
║  Your ride ended. Did you arrive safely?                        ║
║  type-body / text-secondary                                      ║
║                                                                  ║
║  ┌────────────────────────────────────────┐                     ║
║  │              ✓  I'm Safe              │                     ║
║  └────────────────────────────────────────┘                     ║
║  Primary button                                                  ║
║                                                                  ║
║  [ I need help ]                                                 ║
║  text-error link → opens SOS flow                               ║
║                                                                  ║
║  Dismiss  (small, text-muted, bottom — does not close escalation)║
╚══════════════════════════════════════════════════════════════════╝
```

---

## 11. AI Anomaly Detection

### 11.1 Overview

The AI Anomaly Detection system runs on every active trip from the moment the driver taps "Start Trip" to the moment they tap "End Trip." It evaluates trip conditions every 30 seconds against a ruleset.

This expands and supersedes PRD Section 19.3. All thresholds are now consolidated here.

### 11.2 Anomaly Detection Rules — All Trips

| Rule | Threshold | State | Action |
|---|---|---|---|
| Route deviation (minor) | > 0.5 miles off expected route | SOFT_ALERT | Log |
| Route deviation (significant) | > 1.5 miles off route for > 3 min | MODERATE_ALERT | Admin alert |
| Route deviation (severe) | > 3.0 miles off route for > 5 min | CRITICAL | Admin + rider check |
| Unexpected stop (minor) | Stopped > 3 min in non-destination zone | SOFT_ALERT | Log |
| Unexpected stop (moderate) | Stopped > 8 min in non-destination zone | MODERATE_ALERT | Admin alert + rider check |
| Unexpected stop (severe) | Stopped > 15 min, no response from rider | CRITICAL | Admin action |
| Trip duration overrun | > 60% over estimated duration | SOFT_ALERT | Log |
| Trip duration overrun (severe) | > 120% over estimated duration | MODERATE_ALERT | Admin alert |
| GPS signal lost (brief) | Driver GPS offline 60–179 seconds | MODERATE_ALERT | Admin alert |
| GPS signal lost (extended) | Driver GPS offline ≥ 180 seconds | CRITICAL | Emergency protocol |
| Speed anomaly (sustained) | Vehicle speed > 90 mph for > 30 seconds | MODERATE_ALERT | Admin alert |
| Speed anomaly (extreme) | Vehicle speed > 100 mph | CRITICAL | Admin action |
| SOS activated | Either party pressed SOS | SOS_ACTIVE | Immediate P0 |
| Panic mode activated | Either party activated panic | PANIC_ACTIVE | 3-min admin response |
| Both parties panic | Simultaneous panic mode | CRITICAL | Immediate escalation |
| Erratic speed pattern | Speed varies ≥ 40 mph in < 10 seconds, 3+ times | SOFT_ALERT | Log |

### 11.3 Anomaly Detection Rules — Night Rides (10pm – 5am)

Night rides have tightened thresholds. All standard rules apply plus:

| Rule | Night Threshold (vs. Day) | State | Action |
|---|---|---|---|
| Route deviation | > 0.3 miles (vs. 0.5 miles day) | SOFT_ALERT | Log |
| Unexpected stop | > 5 min (vs. 8 min day) | MODERATE_ALERT | Admin alert |
| Isolated stop (low-population zone) | Stopped > 3 min in area with no POIs | MODERATE_ALERT | Admin alert + rider check |
| Extended isolated stop | > 8 min in isolated zone, no response | CRITICAL | Admin action |
| Trip duration overrun | > 40% over estimate (vs. 60% day) | SOFT_ALERT | Log |
| GPS signal lost | 30 seconds (vs. 60 seconds day) | MODERATE_ALERT | Admin alert |

### 11.4 Anomaly Context Engine

The AI does not evaluate rules in isolation. It applies context weighting before assigning a state:

| Contextual factor | Effect |
|---|---|
| Driver is VIP badge | Route deviation threshold raised 20% (experienced drivers may take known shortcuts) |
| Rider is first-time user | Check-in prompt triggered 2 minutes earlier |
| Trip is night ride | All thresholds tightened per Night Ride rules |
| Trip is airport pickup | Airport Safety rules applied (Section 13) |
| Driver has a prior incident on record | Deviation threshold lowered 15% |
| Trip is in a known construction zone (geo-tagged) | Deviation threshold raised 30% for that segment |
| Historical route data shows this deviation is common | Log only — no alert |

### 11.5 Rider "Are You Okay?" Active Check Screen

Resolves Gap G-03 from gap analysis. This screen appears on the rider's device during a CRITICAL anomaly when the admin sends an active check.

```
╔══════════════════════════════════════════════════════════════════╗
║  [Bottom sheet — appears over in-ride map]                      ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  🛡  BidiRide Safety Check                                        ║
║  type-h3 / text-primary                                          ║
║                                                                  ║
║  We noticed something unexpected on your route.                 ║
║  Is everything okay?                                             ║
║  type-body / text-secondary                                      ║
║                                                                  ║
║  ┌────────────────────────────────────────┐                     ║
║  │           ✓  Yes, I'm fine            │                     ║
║  └────────────────────────────────────────┘                     ║
║  Primary button — bg-teal                                        ║
║                                                                  ║
║  ┌────────────────────────────────────────┐                     ║
║  │         🔴  I Need Help               │                     ║
║  └────────────────────────────────────────┘                     ║
║  Danger button → full SOS activation immediately                ║
║                                                                  ║
║  ─────────────────────────                                       ║
║  SOS button remains visible in corner at all times.             ║
╚══════════════════════════════════════════════════════════════════╝
```

**Rider taps "Yes, I'm fine":**
→ Admin receives confirmation, trip state returns to NORMAL
→ Log entry: "Rider confirmed safe at [timestamp]"

**Rider taps "I Need Help":**
→ Full SOS activation (bypasses countdown — immediate)
→ SOS_ACTIVE state

**No response in 60 seconds:**
→ Admin escalates to CRITICAL without waiting further
→ Admin may initiate contact or dispatch

---

## 12. Trip Deviation Alerts

### 12.1 In-App Deviation Notification — Rider

When the trip state moves to SOFT_ALERT or MODERATE_ALERT due to a route deviation, the rider sees a non-alarming notification.

**SOFT_ALERT (Yellow):**
```
╔══════════════════════════════════════════════════════════════════╗
║  [Persistent chip — top of in-ride map]                         ║
║  ┌──────────────────────────────────────┐                       ║
║  │  ◈  Your route has changed.          │                       ║
║  │     BidiRide is monitoring your trip. │                       ║
║  └──────────────────────────────────────┘                       ║
║  bg: #00272A (info-bg)  border-left: 3px teal                   ║
║  Dismissible (×) — dismissing does not cancel monitoring        ║
╚══════════════════════════════════════════════════════════════════╝
```

**MODERATE_ALERT (Orange):**
```
╔══════════════════════════════════════════════════════════════════╗
║  [Bottom sheet — cannot be dismissed without action]            ║
║                                                                  ║
║  🛡  Route Check                                                 ║
║                                                                  ║
║  Your route has changed significantly.                          ║
║  A BidiRide safety agent has been notified.                      ║
║                                                                  ║
║  [ ✓ Everything is fine — I know about this ]                   ║
║  [ 🔴 I need help ]  → SOS                                       ║
╚══════════════════════════════════════════════════════════════════╝
```

### 12.2 Deviation Data Captured

Every deviation event logs:

```
{
  trip_id,
  event_type: "route_deviation",
  expected_route_polyline,
  actual_position: { lat, lng },
  deviation_distance_miles,
  duration_at_deviation_seconds,
  risk_level: "yellow" | "orange" | "red",
  context: { is_night_ride, is_airport_trip, driver_badge, driver_prior_incidents },
  admin_action: null | "admin_contacted_driver" | "admin_contacted_rider" | "escalated",
  resolved_at,
  resolution_reason
}
```

---

## 13. Airport Safety Monitoring

### 13.1 Airport Safety Context

EWR airport pickups have specific safety risks distinct from city rides:
- Riders are unfamiliar with pickup zones, increasing confusion and exposure time
- Drivers wait in staging areas for extended periods (vulnerability window)
- Terminal pickup zones are crowded — physical confrontation risk is higher
- Late-night international arrivals create high demand with exhausted, vulnerable travelers

### 13.2 Airport Safety Monitoring Rules

These rules apply to any trip where the pickup or destination is within the EWR airport geofence.

| Rule | Threshold | State | Action |
|---|---|---|---|
| Driver waiting in non-TNC zone | Driver stationary in unauthorized airport zone > 5 min | SOFT_ALERT | In-app redirect to TNC zone |
| Rider not boarding after arrival | Driver marked "Arrived" but Start Trip not tapped in > 10 min | SOFT_ALERT | Admin notified, contact rider |
| Extended terminal wait | Driver at terminal > 20 min without a trip start | MODERATE_ALERT | Admin check — is driver okay? |
| Unauthorized departure with rider | Trip started but route immediately leaves airport in unexpected direction | MODERATE_ALERT | Admin alert |
| Rider requested off-airport meetup | Pickup address outside airport zone but contains "EWR" or "Newark Airport" in search | SOFT_ALERT | In-app guidance to official TNC zone |
| Night airport arrival (11pm–5am) | Trip pickup at airport between 11pm–5am | Automatic enhanced monitoring | Shorter deviation thresholds active |
| Driver enters restricted airport zone | GPS shows driver in secure/non-public area | CRITICAL | Admin alert + immediate contact |

### 13.3 Airport Safety In-App Guidance

**For riders at EWR (displayed on RS-010 / RS-010a):**

```
╔══════════════════════════════════════════════════════════════════╗
║  ┌──────────────────────────────────────────────────────────┐  ║
║  │  🛡  Airport Pickup Tips                                  │  ║
║  │  • Only meet your driver in the designated TNC zone       │  ║
║  │  • Verify the plate: ABC-4821 before entering            │  ║
║  │  • Your trip is being monitored for your safety           │  ║
║  │                                      [Got it]            │  ║
║  └──────────────────────────────────────────────────────────┘  ║
║  Shown once per airport trip. Dismissible after 3 seconds.     ║
╚══════════════════════════════════════════════════════════════════╝
```

**For drivers at EWR (displayed on Driver App — in staging queue):**

```
╔══════════════════════════════════════════════════════════════════╗
║  ┌──────────────────────────────────────────────────────────┐  ║
║  │  🛡  Airport Safety Reminder                              │  ║
║  │  • Only pick up from designated TNC zones                │  ║
║  │  • Confirm rider name before they enter the vehicle      │  ║
║  │  • Your location is being shared with BidiRide Safety     │  ║
║  └──────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════╝
```

### 13.4 Airport Safety Admin Panel

The existing A-25 (Airport Operations Panel in PRD Section 17.5) is extended with safety overlays:

```
NEW panel: Airport Safety Monitor (tab within A-25)
  → All active trips at EWR — highlighted separately from city trips
  → Night arrival queue (11pm–5am trips — elevated monitoring flags)
  → Drivers in staging zone > 30 min (wellness check)
  → Trips where rider has not responded to driver arrival (> 8 min)
  → Active MODERATE_ALERT or higher at EWR — instant visibility
```

---

## 14. Night Ride Safety Monitoring

### 14.1 Definition of Night Ride

A trip is classified as a Night Ride if the trip START time is between **10:00 PM and 5:00 AM local time**.

Night Ride classification applies for the entire duration of the trip regardless of when it ends.

### 14.2 Night Ride Enhanced Features

When a Night Ride begins, the following activate automatically:

| Feature | Night Ride Behavior |
|---|---|
| Tightened anomaly thresholds | Per Section 11.3 |
| Trusted contact notification | Auto-share link sent at trip match (even if auto-share is normally off) — but user can opt out in Settings |
| Post-ride check-in | Escalation window shortened from 10 min to 5 min |
| Admin monitoring weight | Night rides receive elevated priority in Safety Command Center sort order |
| Safe check-in for driver | Post-trip driver check-in activated for all night rides |
| In-app night indicator | Subtle "Night Ride — Enhanced Safety Active" label on in-ride screen |

### 14.3 Night Ride In-App Indicator

```
╔══════════════════════════════════════════════════════════════════╗
║  [Displayed on RS-011 (In-Ride Screen) for night rides]         ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────┐     ║
║  │  🌙  Night ride — Enhanced Safety Active                │     ║
║  │       type-caption / text-teal                          │     ║
║  └────────────────────────────────────────────────────────┘     ║
║  Small chip — top of screen below ETA chip                      ║
║  Tappable: opens Safety Center modal with night ride info       ║
╚══════════════════════════════════════════════════════════════════╝
```

### 14.4 Night Ride Trusted Contact Auto-Notification

Night rides trigger a modified trusted contact notification even when auto-share is off:

**Opt-out path:**
Settings → Safety → Night Rides → "Auto-share trip with contacts on night rides" [Toggle]

Default: On (can be turned off, but not hidden during onboarding — user must actively choose)

**If opted out:**
System logs the opt-out decision. No trusted contact notification sent for night rides. Post-trip check-in still runs normally.

---

## 15. Admin Response Protocols

### 15.1 Response SLAs by State

| Trip State | SLA | On Breach |
|---|---|---|
| SOFT_ALERT | No SLA (logged only) | — |
| MODERATE_ALERT | 5 minutes to review | Dashboard flag; logged |
| CRITICAL | 2 minutes to take action | Secondary admin paged |
| SOS_ACTIVE | 90 seconds to first response | All online admins alerted; on-call lead paged after 30s |
| PANIC_ACTIVE | 3 minutes to respond | Secondary admin paged; escalate to CRITICAL if driver/rider non-responsive |

### 15.2 Admin Escalation Chain

```
SOS activated
    → T+0s: All online Safety Admins receive audio alert
    → T+30s: If no acknowledgment: on-call Safety Lead paged (SMS + push)
    → T+90s: SLA breach — Incident flagged for post-incident review
    → T+120s: If still no response: automated escalation to Platform Admin
    → T+180s: If still no response: BidiRide emergency hotline triggered
```

### 15.3 Admin Actions Available by State

| Action | SOFT | MODERATE | CRITICAL | SOS | PANIC |
|---|---|---|---|---|---|
| View trip live | ✓ | ✓ | ✓ | ✓ | ✓ |
| Message rider (in-app) | — | ✓ | ✓ | ✓ | ✓ (rider only) |
| Message driver (in-app) | — | ✓ | ✓ | ✓ | ✓ (driver only if PANIC_ACTIVE) |
| Call rider (masked) | — | ✓ | ✓ | ✓ | ✓ |
| Call driver (masked) | — | ✓ | ✓ | ✓ | ✓ |
| Downgrade state | ✓ | ✓ | ✓ | — | ✓ |
| Initiate 911 dispatch | — | — | ✓ | ✓ | ✓ |
| Suspend accounts | — | — | Platform Admin | Platform Admin | Platform Admin |
| Access audio recording | — | — | Super Admin only | Super Admin only | Super Admin only |
| Mark resolved | ✓ | ✓ | ✓ | ✓ | ✓ |

### 15.4 Post-Incident Protocol

Every incident that reaches CRITICAL or above requires:

1. **Within 24 hours:** Safety admin completes incident report (A-13)
2. **Within 48 hours:** Both rider and driver receive follow-up (anonymized — no personal details shared cross-party)
3. **Within 72 hours:** Trust score re-evaluated for involved accounts
4. **Within 7 days:** If action was taken, account review completed and final decision made
5. **Monthly:** All incidents aggregated into safety metrics report for founder review

---

## 16. Database Schema

### 16.1 New Table: `safety_sessions`

Tracks the safety state of every active trip in real time.

```sql
id                      UUID PRIMARY KEY
trip_id                 UUID REFERENCES trips(id) UNIQUE
current_state           ENUM(normal, soft_alert, moderate_alert, critical, sos_active, panic_active, incident_closed)
previous_state          ENUM(normal, soft_alert, moderate_alert, critical, sos_active, panic_active, incident_closed) NULLABLE
state_changed_at        TIMESTAMP
is_night_ride           BOOLEAN DEFAULT FALSE
is_airport_trip         BOOLEAN DEFAULT FALSE
anomaly_rules_active    JSONB           -- array of currently active rule names
check_in_status         ENUM(pending, safe, escalated, not_required) DEFAULT not_required
check_in_sent_at        TIMESTAMP NULLABLE
check_in_responded_at   TIMESTAMP NULLABLE
admin_assigned_id       UUID REFERENCES admin_users(id) NULLABLE
sla_deadline            TIMESTAMP NULLABLE
sla_breached            BOOLEAN DEFAULT FALSE
created_at              TIMESTAMP
updated_at              TIMESTAMP
```

### 16.2 New Table: `sos_events`

```sql
id                          UUID PRIMARY KEY
trip_id                     UUID REFERENCES trips(id)
safety_session_id           UUID REFERENCES safety_sessions(id)
initiated_by_user_id        UUID REFERENCES users(id)
initiated_by_role           ENUM(rider, driver)
trigger_source              ENUM(button_tap, volume_shortcut, auto_escalation, admin_triggered)
activation_confirmed_at     TIMESTAMP      -- after 5-second window passes
cancelled_at                TIMESTAMP NULLABLE   -- if user cancelled in window
confirmed_safe_at           TIMESTAMP NULLABLE   -- if user tapped "I'm safe"
gps_at_activation           POINT
contacts_notified_count     INTEGER DEFAULT 0
admin_assigned_id           UUID REFERENCES admin_users(id) NULLABLE
admin_assigned_at           TIMESTAMP NULLABLE
sla_met                     BOOLEAN NULLABLE
911_call_initiated          BOOLEAN DEFAULT FALSE
dispatch_requested          BOOLEAN DEFAULT FALSE
recording_id                UUID REFERENCES safety_recordings(id) NULLABLE
status                      ENUM(active, resolved, false_alarm, escalated_to_dispatch)
resolution_notes            TEXT NULLABLE
resolved_at                 TIMESTAMP NULLABLE
created_at                  TIMESTAMP
```

### 16.3 New Table: `panic_events`

```sql
id                          UUID PRIMARY KEY
trip_id                     UUID REFERENCES trips(id)
safety_session_id           UUID REFERENCES safety_sessions(id)
initiated_by_user_id        UUID REFERENCES users(id)
initiated_by_role           ENUM(rider, driver)
trigger_method              ENUM(triple_tap, volume_hold, face_down, tap_streak)
admin_assigned_id           UUID REFERENCES admin_users(id) NULLABLE
admin_assigned_at           TIMESTAMP NULLABLE
sla_met                     BOOLEAN NULLABLE
user_response               ENUM(safe, needs_help, call_requested, no_response) NULLABLE
user_responded_at           TIMESTAMP NULLABLE
escalated_to                ENUM(critical, sos_active) NULLABLE
status                      ENUM(active, resolved, escalated)
resolution_notes            TEXT NULLABLE
resolved_at                 TIMESTAMP NULLABLE
created_at                  TIMESTAMP
```

### 16.4 New Table: `safety_recordings`

```sql
id                      UUID PRIMARY KEY
trip_id                 UUID REFERENCES trips(id)
sos_event_id            UUID REFERENCES sos_events(id)
initiated_by_role       ENUM(rider, driver)
storage_bucket          VARCHAR              -- internal: 'bidride-safety-recordings'
storage_key             VARCHAR              -- S3 object key (encrypted path)
duration_seconds        INTEGER NULLABLE
file_size_bytes         BIGINT NULLABLE
encryption_key_id       VARCHAR              -- KMS key reference (not the key itself)
recording_started_at    TIMESTAMP
recording_ended_at      TIMESTAMP NULLABLE
retention_category      ENUM(no_action_30d, action_taken_2y, law_enforcement_hold)
delete_after            TIMESTAMP NULLABLE   -- null if law enforcement hold
access_log              JSONB DEFAULT '[]'   -- array of access events
status                  ENUM(recording, complete, deleted, held)
created_at              TIMESTAMP
```

### 16.5 New Table: `safe_check_ins`

```sql
id                      UUID PRIMARY KEY
trip_id                 UUID REFERENCES trips(id)
user_id                 UUID REFERENCES users(id)
user_role               ENUM(rider, driver)
check_in_type           ENUM(post_trip, night_ride, airport, manual)
prompt_sent_at          TIMESTAMP
response                ENUM(safe, needs_help, no_response) NULLABLE
responded_at            TIMESTAMP NULLABLE
escalated               BOOLEAN DEFAULT FALSE
escalation_type         ENUM(admin_soft_alert, sos_triggered) NULLABLE
contacts_notified       BOOLEAN DEFAULT FALSE
created_at              TIMESTAMP
```

### 16.6 Extended: `trusted_contacts` (Driver Support)

The existing `trusted_contacts` table is extended to support both riders and drivers:

```sql
-- EXISTING COLUMNS (unchanged):
id              UUID PRIMARY KEY
user_id         UUID REFERENCES users(id)
name            VARCHAR
phone           VARCHAR
relationship    VARCHAR
auto_share      BOOLEAN DEFAULT TRUE
created_at      TIMESTAMP

-- NEW COLUMNS ADDED:
user_role           ENUM(rider, driver)     -- whose contact is this?
notify_on_sos       BOOLEAN DEFAULT TRUE    -- cannot be disabled
notify_on_panic     BOOLEAN DEFAULT TRUE    -- cannot be disabled  
notify_shift_start  BOOLEAN DEFAULT FALSE   -- driver: notify when shift starts
opted_out           BOOLEAN DEFAULT FALSE   -- contact has replied STOP
opted_out_at        TIMESTAMP NULLABLE
```

### 16.7 Extended: `trip_events` (New event types)

```sql
-- Additional ENUM values for event_type:
panic_activated_rider
panic_activated_driver
panic_resolved
check_in_sent
check_in_responded
check_in_escalated
airport_zone_violation
night_ride_started
recording_started
recording_ended
deviation_alert_sent
deviation_confirmed_safe
```

### 16.8 Extended: `safety_incidents` (New fields)

```sql
-- NEW COLUMNS ADDED:
panic_event_id          UUID REFERENCES panic_events(id) NULLABLE
sos_event_id            UUID REFERENCES sos_events(id) NULLABLE
recording_id            UUID REFERENCES safety_recordings(id) NULLABLE
is_night_ride           BOOLEAN DEFAULT FALSE
is_airport_trip         BOOLEAN DEFAULT FALSE
sla_deadline            TIMESTAMP NULLABLE
sla_met                 BOOLEAN NULLABLE
post_incident_followup_sent BOOLEAN DEFAULT FALSE
post_incident_followup_at   TIMESTAMP NULLABLE
```

---

## 17. API Endpoints

### Safety Monitor Service (Internal)

```
-- Trip state management (called by Safety Monitor every 30 seconds per active trip)
POST /internal/safety/evaluate/:trip_id
    Body: { gps, speed, route_deviation_miles, stopped_duration_seconds }
    Response: { current_state, rules_triggered, actions_taken }

-- State transition
POST /internal/safety/state/:trip_id
    Body: { new_state, reason, triggered_by }
    Auth: Internal only
```

### SOS Service

```
-- Rider or driver activates SOS
POST /safety/sos/activate
    Body: { trip_id, trigger_source: "button_tap" | "volume_shortcut" }
    Response: { sos_event_id, recording_started: bool, contacts_notified: int }

-- User cancels SOS during countdown
POST /safety/sos/:sos_event_id/cancel

-- User confirms they are safe (from State 3)
POST /safety/sos/:sos_event_id/confirm-safe
    Body: { note: "accidental activation" }

-- Admin resolves SOS incident
POST /admin/safety/sos/:sos_event_id/resolve
    Body: { resolution: "...", action_taken: "..." }
    Auth: Safety Admin +
```

### Panic Service

```
-- Rider or driver activates panic mode
POST /safety/panic/activate
    Body: { trip_id, trigger_method }
    Response: { panic_event_id } -- minimal response (speed matters)

-- User responds to admin check-in during panic
POST /safety/panic/:panic_event_id/respond
    Body: { response: "safe" | "needs_help" | "call_requested" }

-- Admin resolves panic event
POST /admin/safety/panic/:panic_event_id/resolve
    Body: { resolution: "..." }
    Auth: Safety Admin +
```

### Check-In Service

```
-- System sends post-trip check-in prompt
POST /internal/safety/check-in/send
    Body: { trip_id, user_id, check_in_type }

-- User responds to check-in
POST /safety/check-in/:check_in_id/respond
    Body: { response: "safe" | "needs_help" }

-- User initiates SOS from check-in screen
POST /safety/check-in/:check_in_id/sos
    → Delegates to SOS activate endpoint
```

### Location Sharing Service

```
-- Generate trip link (called at trip match)
POST /internal/safety/location-link/:trip_id
    Response: { token, url }

-- Public endpoint — no auth — for emergency contacts
GET  /t/:token
    Response: { rider_first_name, rider_last_initial, vehicle_color, vehicle_make,
                destination_neighborhood, eta_minutes, current_lat, current_lng,
                trip_status }

-- Invalidate link (called on trip completion)
POST /internal/safety/location-link/:trip_id/invalidate
```

### Emergency Contact Service

```
-- Rider/driver emergency contacts CRUD
GET    /safety/emergency-contacts
POST   /safety/emergency-contacts
PUT    /safety/emergency-contacts/:id
DELETE /safety/emergency-contacts/:id

-- Contact opts out (via SMS STOP reply → handled by Twilio webhook)
POST /internal/safety/emergency-contacts/opt-out
    Body: { phone_number, event: "sms_stop" }
```

### Recording Service (Admin only)

```
-- Request access to a recording (audit logged)
POST /admin/safety/recordings/:id/request-access
    Auth: Super Admin only
    Body: { reason: "...", requester_id }
    Response: { signed_url, expires_at }  -- 72-hour expiring S3 signed URL

-- Get recording metadata
GET  /admin/safety/recordings/:id
    Auth: Safety Admin +

-- Flag recording for retention hold (law enforcement)
POST /admin/safety/recordings/:id/hold
    Auth: Super Admin only
    Body: { hold_reason, legal_reference }
```

---

## 18. Admin Interface

### 18.1 Updates to A-25 — Safety Command Center

Safety Command Center gains a new **Night Ride Monitor** sub-panel:

```
╔══════════════════════════════════════════════════════════════════╗
║  A-25  SAFETY COMMAND CENTER                                     ║
║  [Active Trips] [SOS Queue] [Panic Queue] [Night Rides] [EWR]  ║
╠══════════════════════════════════════════════════════════════════╣
║  Night Rides Tab:                                               ║
║  All active night rides (10pm–5am) — separate list             ║
║  Color-coded: Green (normal) → Yellow → Orange → Red           ║
║  Night rides automatically sorted above day trips              ║
║  ETA to destination shown (alert if severely overdue)          ║
╚══════════════════════════════════════════════════════════════════╝
```

### 18.2 SOS Queue (A-26 — Extended)

Each SOS card now includes:

- SLA countdown timer (90 seconds — turns red at 60s)
- Audio recording status: "Recording in progress" / "Recording available"
- Trusted contacts notified count
- Volume button activation (flagged separately — user may be incapacitated)
- Whether panic mode was previously active on this trip before SOS

### 18.3 New Admin Screen: A-29 — Safety Recordings Archive

```
╔══════════════════════════════════════════════════════════════════╗
║  A-29  Safety Recordings Archive                                ║
║  Access: Super Admin only                                        ║
╠══════════════════════════════════════════════════════════════════╣
║  Table: Recording ID, Trip ID, Date, Duration, Status           ║
║  Filter: by date, by status, by retention category              ║
║                                                                  ║
║  Per row:                                                        ║
║  [ Request Access ]  — opens dual-authorization modal           ║
║  [ View Metadata  ]  — recording details without audio access   ║
║  [ Place on Hold  ]  — legal hold (Super Admin + Legal only)    ║
║                                                                  ║
║  Access log visible per recording — every access event shown    ║
║  Scheduled deletions shown: "Deletes in 18 days"               ║
╚══════════════════════════════════════════════════════════════════╝
```

### 18.4 New Admin Screen: A-30 — Safety Metrics Dashboard (Founder View)

```
╔══════════════════════════════════════════════════════════════════╗
║  A-30  Safety Metrics — Founder Dashboard                       ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  THIS MONTH                                                      ║
║  Total trips monitored:     2,841                               ║
║  Anomalies detected:          127  (4.5% of trips)              ║
║  MODERATE_ALERT or higher:     23  (0.8% of trips)             ║
║  SOS events:                    4  (0.14% of trips)            ║
║  Panic events:                  7  (0.25% of trips)            ║
║  Safe check-in escalations:    11  (0.4% of trips)             ║
║  SLA met (SOS):              4/4   (100%)                       ║
║  SLA met (CRITICAL):        22/23  (95.6%)                      ║
║                                                                  ║
║  Night Ride Safety                                               ║
║  Night ride anomaly rate:    6.2%  (vs. 3.1% daytime)         ║
║  Night ride SOS rate:        0.22%  (vs. 0.09% daytime)        ║
║                                                                  ║
║  Airport Safety                                                  ║
║  EWR safety events:             3  this month                   ║
║  Zone violation alerts:         8                               ║
║  Average rider wait time (EWR): 4.2 min                        ║
║                                                                  ║
║  Audio Recordings                                                ║
║  Active recordings:             0                               ║
║  In retention (pending delete): 3                               ║
║  Under legal hold:              1                               ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## 19. Integration Map

| System | Safety Shield Integration |
|---|---|
| **Trip Service** | Trip state transitions trigger safety session creation. Trip completion triggers check-in service. |
| **Trust Score Engine** | SOS events, panic events, and incident outcomes feed into trust score inputs (fraud history, complaint history). High fraud probability score lowers anomaly thresholds. |
| **Matching Engine** | Accounts with active safety holds are excluded from matching queue. Post-incident: driver with active investigation not matched until resolved. |
| **Emergency Contact Service** | Trip link generated at match. SOS activates immediate SMS to all contacts. Check-in confirmation notifies contacts. |
| **Airport Queue System** | Airport safety rules activate when trip touches EWR geofence. Airport queue drivers receive safety tips at staging. |
| **Rewards System** | Safety events do not affect rewards points in any way. (Riders/drivers should not be disincentivized from using safety features.) |
| **Pricing Engine** | No integration. Safety data never affects fare pricing. |
| **AI Engine Monitor (A-11)** | Safety Monitor Service health displayed as one of the monitored AI engines. |
| **Notification Service** | SOS SMS, check-in push, deviation alerts, and trusted contact messages all routed through the notification service. |
| **Audit Log (A-24)** | All admin safety actions — incident creation, state changes, recording access requests, account suspensions — are logged. |
| **Stripe / Payments** | If SOS causes trip cancellation: no charge to rider regardless of stage. Driver still paid a minimum. |

---

## 20. Gap Resolution Index

| Gap | Status | Resolution |
|---|---|---|
| G-01 · Driver SOS — no wireframe | ✓ RESOLVED | Section 4.3 defines complete driver SOS flow |
| G-02 · Driver trusted contacts | ✓ RESOLVED | Section 6.3 + trusted_contacts table extension (user_role field) |
| G-03 · "Are you OK?" passive check screen | ✓ RESOLVED | Section 11.5 — RS-011a screen fully designed |
| G-04 · Audio recording consent workflow | ✓ RESOLVED | Section 7 — SOS-triggered only; consent model, legal basis, state law note, user transparency all defined |
| G-12 · Driver panic mode | ✓ RESOLVED | Section 8 — complete discreet activation, sequence, and admin response |
| G-13 · Family safety tracking | △ PARTIALLY | Trusted contacts covers the primary use case. Dedicated family account linking (shared live view between family members) deferred to Phase 2 — requires multi-account linking architecture not yet defined |
| G-14 · Shareable live trip link | ✓ RESOLVED | Section 5 — token format, viewer page wireframe, privacy rules, expiry logic all defined |
| G-15 · Driver "BidiRide Verified" badge | ✓ RESOLVED | Addressed in Trust Score Engine (00c) — Verified badge for drivers covers this |

**Remaining open gaps:** G-05 (EWR PANYNJ compliance — separate spec needed), G-06 (insurance periods — defined here for UI but legal spec outstanding), G-09 partial, G-16–G-21, G-22–G-30.

---

## Document Status

**Document:** 00d-safety-shield-system.md
**Version:** 1.0
**Status:** Pending Founder Approval

**Founder requirements addressed:**
- [x] SOS button — full 3-state machine for rider and driver
- [x] Live location sharing — token-based, public viewer page, expiry rules
- [x] Emergency contacts — unified for rider and driver, extended schema
- [x] Ride recording — audio only, SOS-triggered only, consent model, storage, retention, access
- [x] Driver panic mode — discreet gesture, silent admin escalation, 3-min SLA
- [x] Rider panic mode — discreet gesture, silent admin escalation
- [x] Safe check-in after ride — post-trip prompt, escalation, night ride acceleration
- [x] AI anomaly detection — consolidated all rules, context weighting, night adjustments
- [x] Trip deviation alerts — in-app design for SOFT and MODERATE states
- [x] Airport safety monitoring — EWR-specific rules, safety tips, admin panel
- [x] Night ride safety monitoring — tightened thresholds, auto-share, enhanced check-in

**3 founder decisions still open:**
- D1: Video recording — excluded from this document per "audio only during SOS" requirement
- D2: EWR PANYNJ fee handling — compliance spec still needed
- D4: Driver trusted contacts — ✓ now resolved by this document

---

*BidiRide Safety Shield System — Confidential*
*Delaware LLC — All rights reserved*
