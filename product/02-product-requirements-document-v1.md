# BidiRide — Product Requirements Document v1.0

**Status:** Draft — Pending Founder Approval
**Prepared by:** Claude Code (CPO / CTO / Senior UX Architect / Senior Systems Architect)
**Founder:** Marq Brown
**Date:** June 5, 2026
**Reference:** /foundation/01-founder-discovery-report-v1.md

> This document defines the complete product blueprint for BidiRide.
> No code is written until this document receives founder approval.

---

## Table of Contents

1. [Rider App — Screen Definitions](#1-rider-app--screen-definitions)
2. [Driver App — Screen Definitions](#2-driver-app--screen-definitions)
3. [Admin Dashboard — Screen Definitions](#3-admin-dashboard--screen-definitions)
4. [Onboarding Workflows](#4-onboarding-workflows)
5. [Rider Verification Workflow](#5-rider-verification-workflow)
6. [Driver Verification Workflow](#6-driver-verification-workflow)
7. [Trip Lifecycle Workflow](#7-trip-lifecycle-workflow)
8. [AI Pricing Workflow](#8-ai-pricing-workflow)
9. [Rewards Workflow](#9-rewards-workflow)
10. [Corporate Account Workflow](#10-corporate-account-workflow)
11. [Payment and Payout Workflow](#11-payment-and-payout-workflow)
12. [Emergency and Safety Workflow](#12-emergency-and-safety-workflow)
13. [Database Architecture](#13-database-architecture)
14. [API Architecture](#14-api-architecture)
15. [User Roles and Permissions](#15-user-roles-and-permissions)
16. [MVP Scope vs Future Releases](#16-mvp-scope-vs-future-releases)

---

## 1. Rider App — Screen Definitions

### R-01 · Splash Screen
**Purpose:** Brand entry point while app initializes.
**Elements:** BidiRide logo (Deep Navy background, Electric Teal wordmark, Gold accent), loading indicator.
**Behavior:** Auto-advances to R-02 for new users, or R-08 for authenticated returning users.

---

### R-02 · Onboarding Carousel
**Purpose:** Communicate BidiRide's core value proposition to new users before registration.
**Slides:**
- Slide 1: "Drivers Earn More." — Driver-first economics message
- Slide 2: "Riders Pay Less." — Transparent AI pricing message
- Slide 3: "Safety First." — Live monitoring, SOS, trusted contacts
- Slide 4: "Smarter Rides." — AI marketplace intelligence message

**Elements:** Slide imagery, headline, subheadline, progress dots, Skip button, Get Started CTA.
**Behavior:** Swipeable. Get Started routes to R-03. Skip routes to R-03 directly.

---

### R-03 · Sign Up
**Purpose:** Create a new rider account.
**Fields:** Full name, email address, phone number, password, confirm password.
**Elements:** BidiRide logo, form fields, Terms of Service checkbox with link, Sign Up CTA, "Already have an account? Log In" link.
**Validation:** Email format, phone format (US), password minimum 8 characters, passwords match.
**Behavior:** On submit → phone OTP sent → route to R-04.

---

### R-04 · Phone Verification
**Purpose:** Verify rider's phone number via one-time passcode.
**Elements:** Instruction text, 6-digit OTP input, Resend Code link (active after 30 seconds), timer countdown.
**Behavior:** Auto-advance to R-05 on correct entry. Resend OTP after 30 seconds. Lock account after 5 failed attempts.

---

### R-05 · Email Verification
**Purpose:** Verify rider's email address.
**Elements:** Instruction text, confirmation that email was sent, Resend Email link, "Open Mail App" shortcut button.
**Behavior:** Email contains verification link. On successful verification, advance to R-06. Rider may continue in-app and verify later with a persistent banner prompt.

---

### R-06 · Profile Setup
**Purpose:** Complete basic rider profile.
**Fields:** Profile photo (optional), display name (pre-filled from sign-up), date of birth.
**Elements:** Profile photo upload area, form fields, Continue CTA, Skip link.
**Behavior:** Continue routes to R-07.

---

### R-07 · Add Payment Method
**Purpose:** Add a payment method before first ride.
**Elements:** Card input (number, expiry, CVV), Apple Pay / Google Pay options, "Add Card" CTA, "Skip for now" link (limited functionality until added).
**Behavior:** Stripe tokenizes card. On success, route to R-08. Skip allowed but ride booking blocked until payment added.

---

### R-08 · Home Screen (Map View)
**Purpose:** Primary screen. Rider requests a ride from here.
**Elements:**
- Full-screen map (Google Maps / Mapbox) showing current location
- "Where to?" search bar (prominent, top of screen)
- Nearby available driver pins on map (anonymized)
- Bottom sheet: Recent destinations, Saved Places shortcuts (Home, Work)
- Rewards points balance (top corner chip)
- Profile avatar (top corner, routes to R-23)
- Notification bell (routes to R-30)
- Safety center shortcut (shield icon)
**Behavior:** Tapping "Where to?" opens R-09. Map updates in real time. Driver pins are approximate (not exact position for privacy).

---

### R-09 · Destination Entry
**Purpose:** Enter trip destination.
**Elements:**
- Pickup location field (pre-filled with current location, editable)
- Destination search field (autofocus)
- Search results list (Google Places autocomplete)
- Recent destinations list
- Saved places (Home, Work, Favorites)
- Map preview updates as destination is selected
**Behavior:** Selecting a destination routes to R-10 with fare preview generated.

---

### R-10 · Fare Preview
**Purpose:** Display AI-recommended fare and ride options. Core pricing screen.
**Elements:**
- Map showing pickup → destination route
- AI-recommended fare (prominent display)
- Estimated pickup time (ETA)
- Estimated trip duration
- Ride type selector (Standard, Priority, Premium)
- Fare breakdown toggle (expand to see distance, time, AI inputs)
- "This fare is protected by BidiRide AI" trust indicator
- Action buttons: **Accept Fare** (primary) | **Make an Offer** (secondary) | **Cancel**
- Promo/rewards code input (expandable)
**Behavior:**
- Accept Fare → routes to R-12 (Matching)
- Make an Offer → routes to R-11
- Priority pickup selected → fare adjusted, routes to R-12
- Premium selected → fare adjusted, routes to R-12
- Fare refreshes if rider waits more than 60 seconds (market conditions change)

---

### R-11 · Make an Offer (Optional Bid)
**Purpose:** Allow rider to submit a lower fare offer. Optional — not the default flow.
**Elements:**
- Original AI-recommended fare shown for reference
- Slider or numeric input for rider's offer
- Minimum offer floor (AI-enforced, shown to rider as "Minimum fare to ensure driver earnings")
- "Your offer must respect driver earnings. BidiRide protects all drivers." message
- Estimated likelihood meter ("Offers near the recommended fare are accepted faster")
- Submit Offer CTA | Back button
**Behavior:**
- Offer cannot be submitted below AI-calculated minimum floor
- On submit → routes to R-12 with offer flag active
- Driver sees offer price and may accept, decline, or counter

---

### R-12 · Matching Screen
**Purpose:** Show rider that BidiRide AI is finding the best available driver.
**Elements:**
- Animated map with expanding radius from pickup point
- "Finding your driver…" status text
- Fare confirmed display
- Estimated wait time
- Cancel button (with cancellation policy note)
**Behavior:**
- AI matches to best available driver
- On match → auto-advances to R-13
- If no match in 90 seconds → fare offer extended to wider radius
- Cancel tap shows cancellation policy modal before confirming

---

### R-13 · Driver Matched
**Purpose:** Introduce the matched driver to the rider.
**Elements:**
- Driver first name, profile photo, star rating, number of completed trips
- Vehicle: make, model, color, license plate (last 3 digits shown)
- Estimated pickup ETA
- Live map showing driver's current location
- "Contact Driver" button (in-app message or masked call)
- "Share Trip" button (routes to live trip link sharing)
- Cancel button (cancellation policy applies)
**Behavior:** Map updates in real time as driver moves. Auto-advances to R-14 when driver is 1 minute away.

---

### R-14 · Driver En Route
**Purpose:** Live tracking of driver approaching pickup location.
**Elements:**
- Full-screen live map with driver location updating in real time
- Driver info chip (name, vehicle, plate)
- Countdown ETA
- "Driver is on the way" status
- Contact Driver button
- Share Trip button
- SOS button (corner, always visible)
- Cancel button (policy applies)
**Behavior:** Auto-advances to R-15 when driver marks arrival.

---

### R-15 · Driver Arrived
**Purpose:** Notify rider that driver is at the pickup location.
**Elements:**
- "Your driver has arrived" header
- Driver name and vehicle details (for identification)
- License plate displayed prominently
- Map with driver pin at pickup point
- Contact Driver button
- "I'm on my way" response option
- SOS button
**Behavior:** Rider boards vehicle. Driver starts trip in Driver App → auto-advances to R-16.

---

### R-16 · In-Ride Screen
**Purpose:** Live tracking during the trip.
**Elements:**
- Full-screen live map showing current position and route to destination
- Trip progress bar (pickup → destination)
- ETA to destination
- Driver name chip
- Estimated fare (live update if route changes)
- Share Trip button (live link to trusted contacts)
- SOS button (prominent, always accessible)
- Expand tray: driver rating reminder, contact option
**Behavior:** Map tracks live GPS. Route deviation detected by AI in background. SOS accessible at all times without unlocking.

---

### R-17 · Trip Complete
**Purpose:** Confirm trip end and display fare summary.
**Elements:**
- "You've arrived!" confirmation
- Trip summary: pickup, destination, distance, duration
- Final fare breakdown: base fare, time, distance, any adjustments
- Payment method charged
- Rewards points earned (this trip)
- Rate Your Driver CTA (primary) | Skip link
**Behavior:** Routes to R-18 on rate tap. Skip routes to R-08 with deferred rating prompt.

---

### R-18 · Rating and Review
**Purpose:** Collect driver feedback and optional tip.
**Elements:**
- Driver name and photo
- 5-star rating (required)
- Optional written review (text field)
- Tip selector: preset amounts ($1, $2, $3, $5) + custom + No Tip
- Compliment tags: "Great driver," "Safe driving," "Friendly," "Clean car," "On time"
- Submit button
**Behavior:** Rating submitted to backend. Tip processed via Stripe. Routes to R-08. Low ratings (1–2 stars) trigger safety review prompt.

---

### R-19 · Ride History
**Purpose:** List all past trips.
**Elements:**
- Chronological trip list: date, time, destination, fare, driver rating given
- Filter: by date range, by ride type
- Search bar
- Each row tappable → routes to R-20
**Behavior:** Infinite scroll. Pull to refresh.

---

### R-20 · Trip Detail
**Purpose:** Full breakdown of a single completed trip.
**Elements:**
- Map showing exact route taken
- Pickup and destination addresses
- Date, time, duration, distance
- Full fare breakdown (base, per mile, per minute, adjustments)
- Payment method used
- Driver name, rating
- Points earned
- "Report an issue" link → support ticket
- Receipt share / download button
**Behavior:** Static view of historical trip data.

---

### R-21 · Rewards Dashboard
**Purpose:** Show rider's rewards status, balance, and history.
**Elements:**
- Current tier badge (Silver / Gold / Platinum / Elite) with progress to next tier
- Points balance (large, prominent)
- Points needed for next tier
- Recent activity log (earned and redeemed)
- Redeem button → routes to R-22
- How points are earned section (expandable)
- Referral code with share button
**Behavior:** Real-time balance. Tier progress bar animates on load.

---

### R-22 · Redeem Rewards
**Purpose:** Allow rider to redeem points for benefits.
**Elements:**
- Available points balance
- Redemption options:
  - Free ride credit (select amount)
  - Percentage discount on next ride
  - Priority pickup (one-time)
  - Premium vehicle upgrade (one-time)
- Each option shows points cost and value
- Confirm Redemption CTA | Cancel
**Behavior:** On confirm, points deducted and benefit applied to account. Confirmation screen shown.

---

### R-23 · Profile Screen
**Purpose:** Rider account overview and settings hub.
**Elements:**
- Profile photo, name, member since date
- Tier badge
- Quick stats: total rides, total saved vs. market rate
- Navigation: Edit Profile, Payment Methods, Saved Places, Safety Center, Notifications Settings, Help & Support, Log Out
**Behavior:** Hub screen routing to sub-screens.

---

### R-24 · Payment Methods
**Purpose:** Manage saved payment methods.
**Elements:**
- Saved cards list (last 4 digits, expiry, card type icon)
- Default card indicator
- Add New Card CTA
- Apple Pay / Google Pay toggle
- Remove card option (swipe or long-press)
**Behavior:** Stripe manages tokenized cards. Changes take effect immediately.

---

### R-25 · Saved Places
**Purpose:** Manage frequently used locations.
**Elements:**
- Home address (edit)
- Work address (edit)
- Favorites list (add, rename, delete)
- "Add New Place" option with map picker or search
**Behavior:** Saved places appear as shortcuts on R-08 and R-09.

---

### R-26 · Safety Center
**Purpose:** Rider overview of all safety features.
**Elements:**
- Safety feature list with status indicators:
  - Trusted Contacts (X contacts added)
  - Live Trip Sharing (enabled/disabled toggle)
  - Family Safety Tracking (linked accounts)
  - Emergency SOS (always active — informational)
  - Audio Recording option (consent toggle, with legal notice)
- "How BidiRide keeps you safe" educational content
- Report a Safety Concern link
**Behavior:** Hub for safety configuration.

---

### R-27 · Trusted Contacts
**Purpose:** Manage emergency and trip-sharing contacts.
**Elements:**
- Contacts list: name, phone, relationship, notification preference
- Add Contact CTA (name, phone, relationship field)
- Edit / Remove per contact
- Toggle: auto-share live trip with these contacts
**Behavior:** Up to 5 trusted contacts. Contacts receive SMS with live trip link automatically when ride begins (if enabled).

---

### R-28 · Emergency SOS
**Purpose:** Emergency activation screen.
**Elements:**
- Large SOS button
- 5-second countdown with cancel option (prevents accidental activation)
- On activation:
  - "Calling emergency services" prompt with one-tap 911
  - Alert sent to all trusted contacts with live GPS link
  - Admin safety dashboard alerted
  - Trip flagged as safety incident
- Calm, clear interface — no clutter during emergency
**Behavior:** Accessible from in-ride screen without any navigation. Designed for one-hand, high-stress operation.

---

### R-29 · Support and Help Center
**Purpose:** Self-service support and contact options.
**Elements:**
- Search bar (FAQ search)
- FAQ categories: Booking, Payments, Safety, Rewards, Account
- "Contact Support" button → opens support ticket with trip context pre-filled
- Live chat option (future release)
- Report a driver button
**Behavior:** FAQ content is searchable. Support tickets routed to admin support queue.

---

### R-30 · Notifications
**Purpose:** Centralized notification history.
**Elements:**
- Chronological list of all alerts: ride updates, promotions, rewards, safety, account
- Read / unread state
- Tap to navigate to relevant screen
- Clear all option
**Behavior:** Badge count on notification bell resets on open.

---

### R-31 · Settings
**Purpose:** App-level preferences.
**Elements:**
- Notification preferences (ride updates, promotions, rewards, safety — individual toggles)
- Language preference
- Default ride type
- Privacy settings
- Delete account option (with confirmation)
**Behavior:** Changes saved immediately.

---

### R-32 · Corporate Ride Booking
**Purpose:** For riders enrolled in a BidiRide Business account — book a ride billed to their employer.
**Elements:**
- "Book for Company" toggle on fare preview screen
- Company account name shown
- Trip purpose field (optional, for expense tracking)
- Confirms company billing method will be charged
**Behavior:** Trip tagged with corporate_account_id. Rider receives personal receipt; company admin sees trip in dashboard.

---

## 2. Driver App — Screen Definitions

### D-01 · Splash Screen
**Purpose:** Brand entry while app initializes.
**Elements:** BidiRide Driver logo variant, loading indicator, Deep Navy background.
**Behavior:** Routes to D-02 (new) or D-17 (returning, approved, authenticated).

---

### D-02 · Driver Onboarding Carousel
**Purpose:** Set expectations for the driver application process.
**Slides:**
- Slide 1: "Earn More. Keep More." — 70–80% payout message
- Slide 2: "Get Paid Instantly." — Instant payout, no waiting
- Slide 3: "You're in Control." — Accept rides on your schedule
- Slide 4: "AI Works for You." — Demand maps, positioning intelligence
**Elements:** Slide imagery, headline, subheadline, progress dots, Get Started CTA.

---

### D-03 · Sign Up
**Purpose:** Create driver account.
**Fields:** Full name, email, phone number, password, confirm password.
**Elements:** Form fields, Terms of Service + Driver Agreement checkbox, Sign Up CTA.
**Behavior:** On submit → OTP sent → D-04.

---

### D-04 · Phone Verification
**Purpose:** Verify driver's phone number via OTP.
**Behavior:** Identical to R-04. Routes to D-05 on success.

---

### D-05 · Email Verification
**Purpose:** Verify driver's email address.
**Behavior:** Identical to R-05. Routes to D-06 on success.

---

### D-06 · Driver Profile Setup
**Purpose:** Basic driver profile. Photo required (used for selfie verification matching).
**Fields:** Profile photo (required), full legal name (must match government ID), date of birth.
**Elements:** Camera/upload prompt, form fields, Continue CTA.
**Behavior:** Photo required before advancing. Routes to D-07.

---

### D-07 · Driver License Upload
**Purpose:** Capture and submit driver's license for verification.
**Elements:**
- Instructions with example image
- Front of license: camera capture or file upload
- Back of license: camera capture or file upload
- OCR auto-extracts: name, license number, expiry date, state
- Confirm extracted data CTA
**Behavior:** Documents sent to verification service. Routes to D-08.

---

### D-08 · Vehicle Registration Upload
**Purpose:** Capture vehicle registration document.
**Elements:** Instructions, front capture, OCR extracts vehicle details.
**Behavior:** Routes to D-09.

---

### D-09 · Insurance Document Upload
**Purpose:** Capture personal auto insurance document. Driver must have rideshare endorsement or commercial coverage.
**Elements:** Instructions noting rideshare insurance requirement, capture/upload, expiry extracted.
**Behavior:** Routes to D-10.

---

### D-10 · Vehicle Details
**Purpose:** Enter vehicle information manually to confirm OCR or fill gaps.
**Fields:** Year, Make, Model, Trim, Color, License Plate, State.
**Elements:** Dropdowns where applicable, text inputs, vehicle age eligibility notice.
**Behavior:** Routes to D-11.

---

### D-11 · Vehicle Photos
**Purpose:** Capture vehicle photos for verification and rider safety (rider can visually confirm the vehicle).
**Elements:**
- Front photo prompt
- Side photo prompt
- Interior photo prompt
- Upload confirmation
**Behavior:** Photos stored securely. Routes to D-12.

---

### D-12 · Background Check Consent
**Purpose:** Obtain legal consent for background check.
**Elements:**
- Explanation of what the check covers: criminal history, driving record, sex offender registry
- Third-party provider disclosure (e.g., Checkr)
- Consent checkbox (legally required)
- Submit for Background Check CTA
**Behavior:** Background check submitted to provider. Routes to D-13.

---

### D-13 · Background Check Pending
**Purpose:** Inform driver their application is under review.
**Elements:**
- "Application Under Review" status
- Estimated timeline (24–72 hours)
- Checklist of submitted items with checkmarks
- Background check status: In Progress / Complete / Requires Attention
- Push notification promised on completion
**Behavior:** Driver can close app. Push notification sent on result.

---

### D-14 · Verification Status
**Purpose:** Real-time tracker of all verification steps.
**Elements:**
- Step list with status per item: Identity, License, Vehicle Registration, Insurance, Background Check, Vehicle Photos
- Status indicators: Pending / Submitted / Approved / Action Required
- "Action Required" items expandable with instructions
**Behavior:** Updates in real time as admin or automated system processes documents.

---

### D-15 · Approval Screen
**Purpose:** Notify driver their application is approved.
**Elements:**
- "You're Approved!" confirmation with BidiRide branding
- Summary: vehicle approved, earnings info, payout setup prompt
- Set Up Instant Payout CTA (bank account or debit card via Stripe)
- Go to Driver Dashboard CTA → D-17
**Behavior:** Routes to payout setup, then D-17.

---

### D-16 · Pre-Shift Selfie Verification
**Purpose:** Confirm the registered driver is the person going online. Required before every shift.
**Elements:**
- Instruction: "Take a selfie to confirm your identity before going online"
- Camera with face oval guide
- Auto-capture when face is detected (or manual capture)
- AI biometric match in progress indicator
- Result: Verified → proceed to D-17 / Failed → retry or contact support
**Behavior:** Biometric compared against profile photo. Failed match blocks driver from going online and triggers admin review.

---

### D-17 · Home / Go Online
**Purpose:** Primary driver screen. Offline state.
**Elements:**
- Map showing current location
- "Go Online" toggle (prominent, center)
- Daily earnings summary chip
- Weekly earnings summary chip
- AI demand hint: "High demand near [area] right now"
- Heat map shortcut button → D-28
- Earnings dashboard shortcut → D-25
- Profile avatar → D-34
- Notification bell → D-36
**Behavior:** Tapping Go Online triggers D-16 (selfie check). After selfie verification, driver is live on map and eligible to receive requests.

---

### D-18 · Ride Request
**Purpose:** Display incoming ride request for driver to act on. Time-sensitive.
**Elements:**
- 30-second countdown timer (prominent)
- Rider first name and star rating
- Pickup location and distance from driver
- Destination and estimated trip distance
- Fare offered (AI-recommended or rider bid — clearly labeled)
- Estimated trip duration
- Estimated earnings per hour for this trip (AI calculated)
- Accept button (primary, green) | Decline button | Counter-Offer button
**Behavior:**
- Accept → routes to D-19
- Decline → returns to D-17, request passed to next driver
- Counter-Offer → routes to counter-offer modal
- Timer expires → treated as decline, passed to next driver
- Repeated declines tracked and surface in D-30 (Performance Analytics)

---

### D-18a · Counter-Offer Modal
**Purpose:** Allow driver to propose an alternative fare.
**Elements:**
- Original fare shown
- Input for counter-offer amount
- Maximum counter-offer note (AI-enforced ceiling to prevent rider gouging)
- Send Counter-Offer CTA | Cancel
**Behavior:** Counter-offer sent to rider. Rider sees counter-offer on their fare screen. If rider accepts → D-19. If rider declines → request closed.

---

### D-19 · Navigation to Pickup
**Purpose:** Turn-by-turn navigation to rider pickup location.
**Elements:**
- Full-screen navigation map (Google Maps / Mapbox)
- Rider name and pickup address header
- ETA to pickup
- Contact Rider button (masked call or in-app message)
- Arrived button (manual confirmation)
- Cancel ride option (with policy)
- SOS button (always accessible)
**Behavior:** Navigation active. Rider's app updates in real time. Arriving within geo-fence triggers D-20.

---

### D-20 · Arrived at Pickup
**Purpose:** Confirm driver has arrived. Notify rider.
**Elements:**
- "You have arrived" confirmation
- Rider name, trip details
- Wait timer begins (free wait window before cancellation allowed)
- Contact Rider button
- Start Trip button (activated once rider is in vehicle)
- Cancel (late cancellation policy applies after wait window)
**Behavior:** Rider receives push notification "Your driver has arrived." Driver taps Start Trip → D-21.

---

### D-21 · In-Ride Navigation
**Purpose:** Navigation to destination during active trip.
**Elements:**
- Full-screen navigation map with real-time routing
- Destination address header
- ETA to destination
- Live earnings meter for this trip
- SOS button (always accessible)
- End Trip button (disabled until within geo-fence of destination, or manual override)
**Behavior:** AI monitors route in background. Route deviation from expected path triggers AI safety check. On arrival, driver taps End Trip → D-22.

---

### D-22 · Trip Complete
**Purpose:** Confirm trip completion and display earnings.
**Elements:**
- "Trip Complete" confirmation
- Trip summary: pickup, destination, distance, duration
- Earnings for this trip (gross and net after platform fee)
- Tip received (if any, appears after rider submits)
- Today's total earnings (updated)
- Rate Rider CTA | Skip
**Behavior:** Routes to D-23 or back to D-17 (online, ready for next ride).

---

### D-23 · Rate Rider
**Purpose:** Collect driver feedback on rider.
**Elements:**
- Rider first name
- 5-star rating (required)
- Issue flags (optional): "Rude behavior," "Did not show up," "Left trash," "Made me uncomfortable," "Other"
- Submit button
**Behavior:** Low ratings and issue flags reviewed by admin safety team. High-frequency flags trigger rider risk score update.

---

### D-24 · Decline Reason (Optional)
**Purpose:** Capture reason for declining a ride request. Used to improve AI matching.
**Elements:**
- "Why did you decline this request?" (optional)
- Options: Too far from pickup, Low fare, Unfamiliar area, Personal reason, Other
- Submit or Skip
**Behavior:** Optional. Data fed to AI matching engine.

---

### D-25 · Earnings Dashboard
**Purpose:** Complete earnings visibility for the driver.
**Elements:**
- Today's earnings (gross, tips, net after platform fee)
- This week's earnings with daily bar chart
- This month's earnings
- Per-trip earnings list (tappable → D-32)
- Average hourly earnings (today, week, month)
- Platform fee transparency: "BidiRide kept $X. You kept $Y."
- Payout button → D-26
**Behavior:** Real-time updates as trips complete.

---

### D-26 · Instant Payout
**Purpose:** Transfer earnings to driver's bank account or debit card immediately.
**Elements:**
- Available balance (ready to transfer)
- Pending balance (in-transit or held)
- Payout method: linked bank account (last 4) or debit card
- "Transfer Now" CTA
- No fee indicator ("BidiRide Instant Payout is always free")
- Estimated arrival: "Funds arrive within minutes"
- Add/Change payout method link
**Behavior:** Stripe Instant Payout triggered. Confirmation screen shown. Balance updates.

---

### D-27 · Payout History
**Purpose:** Full log of all past payouts.
**Elements:**
- Chronological list: date, amount, method, status (Completed / Pending / Failed)
- Total paid out (lifetime)
- Filter by date range
- Export / download option (for tax purposes)
**Behavior:** Static log. Tap row for payout detail.

---

### D-28 · Heat Map / Demand Zones
**Purpose:** Show driver where demand is highest to help them position intelligently.
**Elements:**
- Full-screen map
- Color-coded heat zones: Cool (low demand) → Warm → Hot → Surge (very high demand)
- Current driver position
- AI positioning recommendation: "Move to [zone] for higher earnings likelihood"
- Airport demand indicator (EWR activity level)
- Event overlay (nearby events driving demand)
- Time-of-day slider (forecast next 1–2 hours)
**Behavior:** Updates in real time. AI recommendations personalized to driver's current position and acceptance rate history.

---

### D-29 · AI Insights
**Purpose:** Personalized AI recommendations for this driver.
**Elements:**
- "Good times to drive" this week based on demand forecast
- "Best areas for you" based on driver's historical acceptance patterns
- Earnings projection if driver follows recommendations
- Weekly pattern summary (rider demand by hour)
- Airport demand forecast (EWR arrivals/departures driving ride requests)
**Behavior:** Personalized per driver. Refreshed daily.

---

### D-30 · Performance Analytics
**Purpose:** Give driver full visibility into their platform performance.
**Elements:**
- Acceptance rate (current, 7-day, 30-day)
- Completion rate
- Cancellation rate
- Average star rating (with breakdown by category)
- Total rides completed
- Platform standing indicator: Good Standing / At Risk / Suspended
- Tips for improving acceptance or ratings
**Behavior:** Read-only. Low performance metrics surface contextual guidance (not punitive messaging).

---

### D-31 · Trip History
**Purpose:** List all completed driver trips.
**Elements:**
- Chronological list: date, rider first name, pickup area, destination area, earnings, rating given
- Filter by date
- Tap row → D-32
**Behavior:** Paginated list. Pull to refresh.

---

### D-32 · Trip Detail (Driver)
**Purpose:** Full record of a single completed trip.
**Elements:**
- Map of route taken
- Pickup / destination
- Date, time, duration, distance
- Fare breakdown: gross fare, platform fee (%), driver earnings
- Tip received
- Rider rating (stars given by rider to driver)
- "Report an issue" link
**Behavior:** Read-only record.

---

### D-33 · Vehicle Management
**Purpose:** Manage vehicle information and documents.
**Elements:**
- Current vehicle details (year, make, model, color, plate)
- Document status: Registration, Insurance (expiry dates, renewal reminders)
- Update Vehicle button (triggers re-verification flow)
- Add vehicle option (future: multi-vehicle support)
**Behavior:** Document expiry triggers push notification 30 days prior. Expired documents suspend driver from going online.

---

### D-34 · Driver Profile and Settings
**Purpose:** Account hub for driver.
**Elements:**
- Profile photo (tap to update — triggers biometric re-calibration)
- Name, email, phone (edit)
- Vehicle summary
- Payout method
- Navigation: Earnings, Trip History, Performance, Safety Center, Help, Log Out
- Tax documents section (annual 1099 summary, for MVP: link to Stripe tax dashboard)
**Behavior:** Hub routing to sub-screens.

---

### D-35 · Safety Center (Driver)
**Purpose:** Driver safety features and emergency tools.
**Elements:**
- Emergency SOS (same as R-28, driver variant)
- Report unsafe rider button
- Incident history
- "How BidiRide protects drivers" content
- Contact safety team button
**Behavior:** SOS accessible from in-ride screen at all times.

---

### D-36 · Notifications (Driver)
**Purpose:** Centralized driver alerts.
**Elements:**
- Ride requests missed (when offline)
- Earnings updates
- Document expiry warnings
- Platform announcements
- Safety alerts
- Payout confirmations
**Behavior:** Tapping notification navigates to relevant screen.

---

## 3. Admin Dashboard — Screen Definitions

> The Admin Dashboard is a web application (not mobile). Secure access only.

---

### A-01 · Admin Login
**Purpose:** Secure authentication for admin staff.
**Elements:** BidiRide Admin logo, email field, password field, MFA prompt (TOTP), Sign In CTA.
**Behavior:** MFA required for all admin accounts. Failed attempts trigger lockout after 5 tries. All login events logged.

---

### A-02 · Overview / KPI Dashboard
**Purpose:** Real-time platform health at a glance.
**Metrics panels:**
- Active Rides (live count)
- Active Drivers Online (live count)
- Active Riders in App (live count)
- Rides Completed Today
- Revenue Today (gross / net)
- Average ETA (market-wide)
- Cancellation Rate (today vs. 7-day avg)
- Open Safety Alerts (red badge if > 0)
- AI Engine Status (all engines: Healthy / Warning / Down)
- System Health (API latency, DB status, WebSocket connections)
**Elements:** Cards, sparkline mini-charts, alert banners for anomalies.
**Behavior:** Refreshes every 30 seconds automatically. Clicking any metric drills into detail.

---

### A-03 · Live Map
**Purpose:** Real-time visualization of all platform activity.
**Elements:**
- Full-screen map (Google Maps)
- Driver pins (color: available = teal, on trip = gold, offline = gray)
- Active trip routes (lines from pickup to destination)
- Demand heat zones (overlay toggle)
- Filter: by zone, by status, by vehicle type
- Click driver pin → mini-card with name, trip status, current trip ID
- Click trip line → trip summary modal with link to A-09
- Incident flags (red pins for active safety events)
**Behavior:** WebSocket-powered real-time updates. No manual refresh needed.

---

### A-04 · Driver Management
**Purpose:** Browse, search, and manage all driver accounts.
**Elements:**
- Table: name, city, status, rating, acceptance rate, total rides, account standing, joined date
- Search by name, email, phone, license plate
- Filter: status (Active, Pending, Suspended, Banned), rating, date range
- Bulk actions: export CSV
- "Add Driver" not applicable (self-registration only)
- Click row → A-05
**Behavior:** Paginated. Column sort. Exportable.

---

### A-05 · Driver Detail
**Purpose:** Full profile view of a single driver.
**Tabs:**
- **Profile:** Photo, personal info, contact, account standing, verification status
- **Documents:** License, registration, insurance (view, approve, reject, request resubmission)
- **Vehicle:** Registered vehicle details and photos
- **Trip History:** All completed trips, sortable
- **Earnings:** Total earnings, platform fees collected, payout history
- **Performance:** Acceptance rate, cancellation rate, ratings over time
- **Safety & Incidents:** Incident log, SOS events, flags
- **Admin Actions:** Suspend, Unsuspend, Ban, Approve pending documents, Send message
**Behavior:** All admin actions logged to A-24 (Audit Log).

---

### A-06 · Rider Management
**Purpose:** Browse, search, and manage all rider accounts.
**Elements:**
- Table: name, email, phone, status, risk score, total rides, joined date
- Search and filter (status, risk score level, date range)
- Click row → A-07
**Behavior:** Paginated. Exportable.

---

### A-07 · Rider Detail
**Purpose:** Full profile view of a single rider.
**Tabs:**
- **Profile:** Personal info, verification status, risk score
- **Trip History:** All rides, sortable
- **Payment Methods:** Cards on file (last 4 only — PCI compliant, no full numbers)
- **Rewards:** Points balance, tier, transaction history
- **Safety & Incidents:** Incident log, SOS events, driver reports
- **Admin Actions:** Suspend, Ban, Flag for review, Identity verify (trigger elevated verification), Send message, Issue refund
**Behavior:** All admin actions logged.

---

### A-08 · Trip Management
**Purpose:** Browse and manage all trips across the platform.
**Elements:**
- Table: trip ID, rider name, driver name, pickup, destination, status, fare, date/time
- Status filters: Active, Completed, Cancelled, Incident Flagged
- Search by trip ID, rider name, driver name
- Date range filter
- Click row → A-09
**Behavior:** Active trips shown first by default.

---

### A-09 · Trip Detail (Admin)
**Purpose:** Complete record and audit trail of a single trip.
**Elements:**
- Map with full route taken (replay mode available)
- Timeline: request → match → pickup → in-ride → complete
- Fare audit: AI recommended fare, rider offer (if any), final fare, platform split, driver earnings
- Rider and Driver profile links
- Payment transaction ID (Stripe)
- AI pricing log for this trip (inputs, output, adjustments)
- Safety events during trip (if any)
- Admin actions: Issue refund, Flag trip, Add note
**Behavior:** Full audit capability. All changes logged.

---

### A-10 · Pricing Control Panel
**Purpose:** View and manage platform pricing parameters.
**Elements:**
- Current base fare rates (per mile, per minute)
- Minimum fare floor (platform-wide)
- Driver earnings floor percentage (current setting)
- Surge cap (maximum multiplier allowed by AI)
- Market-specific overrides (by zone)
- AI pricing engine on/off toggle (safety measure — manual mode fallback)
- Last 24-hour fare average chart
- Fare acceptance rate chart (how often riders accept AI fare vs bid)
**Behavior:** Changes to pricing parameters require dual admin approval (Platform Admin + Super Admin). All changes logged.

---

### A-11 · AI Engine Monitor
**Purpose:** Health and performance dashboard for all AI systems.
**Elements:**
- Engine status panel (per engine: Healthy / Degraded / Offline)
  - Marketplace Intelligence Engine
  - Dynamic Pricing Engine
  - Driver Prediction Engine
  - Rider Prediction Engine
  - Surge Forecasting Engine
  - Fraud Detection Engine
  - Demand Forecasting Engine
- Prediction accuracy metrics (pricing accuracy, ETA accuracy, demand forecast accuracy)
- Model version and last training date
- Data pipeline health (last data ingestion timestamp)
- Error log (recent model errors or anomalies)
- Manual override capability per engine (with dual approval)
**Behavior:** Auto-refreshes every 60 seconds. Alert triggers if any engine goes offline.

---

### A-12 · Safety and Incidents Dashboard
**Purpose:** Real-time view of all safety events.
**Elements:**
- Active SOS events (priority queue, real-time)
- Pending incidents awaiting review
- Resolved incidents (24h, 7 days, 30 days)
- Incident type breakdown: SOS, Route Deviation, Driver Report, Rider Report, Fraud Flag
- Map overlay (live incident locations)
- Escalation queue for unresolved events > 15 minutes
**Behavior:** SOS events trigger audio alert in admin dashboard. Assigned to safety admin on open.

---

### A-13 · Incident Detail
**Purpose:** Full record of a single safety incident.
**Elements:**
- Incident type, time, trigger source (AI detection, SOS button, report)
- Trip ID and link to A-09
- Driver and rider profiles involved
- Live GPS at time of incident
- Route deviation map (if applicable)
- Timeline of events
- Communications log (if admin contacted parties)
- Resolution notes
- Status: Open / In Progress / Resolved / Escalated
- Admin actions: Contact driver, Contact rider, Notify emergency services, Suspend accounts, Add notes, Close incident
**Behavior:** All actions timestamped and logged.

---

### A-14 · Fraud Detection Dashboard
**Purpose:** Monitor and action platform fraud signals.
**Elements:**
- Fraud queue (accounts/trips flagged by AI for review)
- Fraud type tags: Fake trip, GPS spoofing, Payment fraud, Account takeover, Referral abuse, Chargeback pattern
- Risk score distribution chart (platform-wide)
- High-risk account list (auto-sorted by score)
- Recent fraud actions (resolved cases)
**Behavior:** AI flags are surfaced here for human review. Admin confirms or dismisses each flag. Confirmed fraud triggers account suspension and Stripe dispute workflow.

---

### A-15 · Financial Dashboard
**Purpose:** Platform financial health and reporting.
**Panels:**
- Gross Revenue (today, week, month, year)
- Platform Commission Collected
- Driver Payouts (total paid)
- Refunds Issued
- Chargeback Rate
- Average Fare (by time period)
- Revenue by Zone / Market
- Instant Payout volume (Stripe)
**Elements:** Charts, date range filter, export CSV/PDF.
**Behavior:** Read-only for Finance Admin role. No payment manipulation from this screen.

---

### A-16 · Corporate Accounts Management
**Purpose:** Manage BidiRide Business accounts.
**Elements:**
- Table: company name, plan, active employees, trips this month, billing status
- Search by company name
- Create New Account CTA
- Click row → A-17
**Behavior:** Paginated. Filter by billing status (Active, Past Due, Suspended).

---

### A-17 · Corporate Account Detail
**Purpose:** Manage a single BidiRide Business account.
**Tabs:**
- **Overview:** Company info, billing contact, account status, plan
- **Employees:** List of enrolled employees, invite new, remove, set spending limits
- **Trips:** All trips billed to this account
- **Billing:** Invoice history, current cycle spend, payment method on file
- **Settings:** Monthly limit, department codes, expense categories
- **Admin Actions:** Suspend account, Update billing, Generate invoice
**Behavior:** Invoices auto-generated monthly. Admin can generate on-demand.

---

### A-18 · Rewards Management
**Purpose:** Monitor and manage the rider rewards program.
**Elements:**
- Total points in circulation
- Points issued (today, week, month)
- Points redeemed (today, week, month)
- Tier distribution chart (Silver / Gold / Platinum / Elite)
- Top referrers list
- Promotional campaign manager (create bonus point events)
- Manual point adjustment (for support resolutions — logged)
**Behavior:** Promo campaigns require Platform Admin approval.

---

### A-19 · Support Queue
**Purpose:** Manage all incoming rider and driver support tickets.
**Elements:**
- Table: ticket ID, user, type, subject, status, created, assigned to
- Filter: by type (billing, safety, account, ride issue), status (Open, In Progress, Resolved)
- Priority flags (safety-related tickets auto-prioritized)
- Assign to agent CTA
- Bulk resolve / bulk assign
- Click row → A-20
**Behavior:** SLA tracking. Tickets open > 24 hours highlighted. Safety tickets always P1.

---

### A-20 · Ticket Detail
**Purpose:** Full support case record.
**Elements:**
- User info, contact
- Trip linked (if applicable, auto-pulled from trip_id)
- Ticket history / thread
- Internal notes (not visible to user)
- Admin response editor
- Status selector: Open / In Progress / Resolved / Escalated
- Linked actions: Issue refund, Adjust points, Flag account
**Behavior:** All responses logged. Refunds linked to payment system.

---

### A-21 · Communications
**Purpose:** Send announcements to drivers or riders.
**Elements:**
- Audience selector: All Drivers / All Riders / Specific Market / Specific Tier
- Message type: Push Notification / Email / In-App Banner
- Subject and body editor
- Scheduled send option
- Preview before send
- Send confirmation (requires confirmation click — not one-tap)
**Behavior:** Mass communications logged with sender, audience, and timestamp.

---

### A-22 · System Settings
**Purpose:** Platform-level configuration.
**Elements:**
- API key management (Maps, Stripe, Background Check provider)
- Feature flag toggles (MVP: enable/disable rewards, bidding, corporate accounts)
- Market settings (active markets, geofence boundaries)
- Notification templates (SMS, push, email)
- Legal document versions (Terms of Service, Privacy Policy)
**Behavior:** Super Admin only. All changes logged.

---

### A-23 · User Roles and Permissions
**Purpose:** Manage admin user accounts and role assignments.
**Elements:**
- Admin user list: name, email, role, last login, status
- Invite Admin CTA
- Role selector per user
- Deactivate admin account option
**Behavior:** Super Admin only. Role changes take effect immediately on next session.

---

### A-24 · Audit Log
**Purpose:** Immutable record of all admin actions.
**Elements:**
- Table: timestamp, admin user, action type, entity affected (user/trip/account), before/after values
- Filter by admin user, action type, date range
- Export CSV
**Behavior:** Read-only. Cannot be edited or deleted by any user including Super Admin. Append-only database table.

---

## 4. Onboarding Workflows

### 4.1 Rider Onboarding

```
Download App
    → Splash (R-01)
    → Onboarding Carousel (R-02)
    → Sign Up: name, email, phone, password (R-03)
    → Phone OTP Verification (R-04)
    → Email Verification (R-05) [can be deferred]
    → Profile Setup: photo (optional), name, DOB (R-06)
    → Add Payment Method (R-07) [required before first ride]
    → Grant Location Permission [system prompt]
    → Grant Notification Permission [system prompt]
    → Home Screen — Ready to Ride (R-08)
```

**Total steps:** 8 screens, ~3 minutes.
**Drop-off mitigation:** Email verification is deferrable. Payment method is required only at ride request, not sign-up, unless added during onboarding.

---

### 4.2 Driver Onboarding

```
Download App
    → Splash (D-01)
    → Driver Onboarding Carousel (D-02)
    → Sign Up (D-03)
    → Phone OTP Verification (D-04)
    → Email Verification (D-05)
    → Profile Setup: photo REQUIRED (D-06)
    → Driver License Upload — front + back (D-07)
    → Vehicle Registration Upload (D-08)
    → Insurance Document Upload (D-09)
    → Vehicle Details: year, make, model, color, plate (D-10)
    → Vehicle Photos: front, side, interior (D-11)
    → Background Check Consent + Submission (D-12)
    → Background Check Pending (D-13)
        ↓ [24–72 hours, async]
    → Push Notification: Application Decision
        ↓ Approved                    ↓ Rejected
    → Approval Screen (D-15)     → Rejection Screen with reason
    → Payout Setup (Stripe)           + Resubmission guidance
    → Pre-Shift Selfie Check (D-16)
    → Driver Home Screen (D-17)
```

**Total active steps:** ~12 screens before background check, then async wait.
**Ongoing requirement:** Selfie verification before every shift.

---

### 4.3 Corporate Account Onboarding

```
Company Admin contacts BidiRide Business (email or web form)
    → BidiRide Admin creates account in A-16
    → Company Admin receives invitation email
    → Company Admin sets up: company name, billing method, spending rules
    → Employees invited via email
    → Each employee follows standard Rider onboarding (R-03 to R-08)
    → Employees linked to corporate account ID in-app
    → Company Admin confirms employee enrollment
    → First ride can be booked on corporate account
```

---

## 5. Rider Verification Workflow

### 5.1 Standard Verification (All Riders)

All riders complete on sign-up:
- Phone number verification (OTP)
- Email address verification

Sufficient for standard ride booking.

### 5.2 Elevated Verification (High-Risk Triggers)

Elevated verification is triggered automatically by the AI fraud detection engine when:

| Trigger | Action |
|---|---|
| Multiple trip disputes in 30 days | Government ID + selfie required |
| Chargeback or payment fraud flag | Payment method re-verification + ID |
| AI fraud score exceeds threshold | Account held pending ID verification |
| Safety incident reported by driver | Account reviewed; ID may be required |
| Unusual usage pattern (AI-flagged) | Soft flag; monitoring increased |

**Elevated verification flow:**
```
AI flags account
    → In-app prompt: "Please verify your identity to continue"
    → Government ID upload (front of license or passport)
    → Selfie capture
    → Biometric match against ID
        ↓ Match             ↓ No Match
    → Account restored   → Account suspended pending manual review
                         → Support ticket auto-created
                         → Admin notified
```

---

## 6. Driver Verification Workflow

### 6.1 Initial Verification Pipeline

```
Step 1 — Identity
    Government ID uploaded
    Selfie biometric match performed
    Name on ID must match account registration
    Result: Pass / Fail / Manual Review

Step 2 — Driver License
    License uploaded (front + back)
    OCR extracts: name, number, expiry, state
    Expiry must be > 30 days from application date
    State must be NJ or approved state
    Result: Pass / Fail / Manual Review

Step 3 — Vehicle Registration
    Registration uploaded
    Vehicle details confirmed against D-10 manual entry
    Registration must not be expired
    Result: Pass / Fail

Step 4 — Insurance Verification
    Insurance document uploaded
    Rideshare endorsement or commercial coverage required
    Expiry date extracted and stored
    Result: Pass / Fail / Request correct document

Step 5 — Background Check
    Submitted to third-party provider (e.g., Checkr)
    Checks: Criminal history (7-year lookback), Driving record, Sex offender registry
    NJ-specific MVR (Motor Vehicle Record) check
    Result: Clear / Consider / Adverse Action
    Timeline: 24–72 hours

Step 6 — Vehicle Inspection
    Vehicle photos reviewed (automated + manual)
    Vehicle year eligibility check (e.g., model year ≥ 2012 — exact threshold TBD)
    Result: Pass / Fail

Step 7 — Admin Final Review
    All steps passed → Auto-approve OR queue for human review
    Any step flagged → Manual admin review in A-05
    Approval notification sent to driver
```

### 6.2 Ongoing Verification

| Check | Frequency | Trigger |
|---|---|---|
| Pre-shift selfie | Every shift | Going online |
| License expiry alert | 30 days before expiry | System cron job |
| Insurance expiry alert | 30 days before expiry | System cron job |
| Registration expiry alert | 30 days before expiry | System cron job |
| Annual background check | Every 12 months | System cron job |
| Continuous driving record monitoring | Ongoing | Third-party MVR monitoring service |

---

## 7. Trip Lifecycle Workflow

```
PHASE 1 — REQUEST
Rider opens app (R-08)
    → Enters destination (R-09)
    → AI Pricing Engine generates recommended fare
    → Fare displayed to rider (R-10)
    → Rider selects: Accept / Bid / Priority / Premium

PHASE 2 — MATCHING
Request enters matching queue
    → AI Matching Engine selects best available driver:
        - Proximity to pickup
        - Driver rating
        - Acceptance rate history
        - Vehicle type match
        - Route efficiency
    → Request sent to matched driver (D-18)
    → Driver has 30 seconds to respond

    If Driver Accepts → Phase 3
    If Driver Declines → Next driver notified (up to 5 attempts)
    If Driver Counter-Offers → Rider notified (R-10 updates)
        If Rider Accepts Counter → Phase 3
        If Rider Declines → Next driver notified
    If No Driver Available → Rider notified, request retried or cancelled

PHASE 3 — EN ROUTE TO PICKUP
Driver navigates to pickup (D-19)
    → Rider sees live driver location (R-14)
    → Driver arrives → taps Arrived (D-20)
    → Rider notified: "Your driver has arrived" (R-15)

PHASE 4 — TRIP
Driver confirms rider in vehicle → taps Start Trip (D-20)
    → Live GPS tracking begins for both apps
    → AI monitors route in real time:
        - Route deviation detection
        - Duration anomaly detection
        - Unexpected stop detection
    → Rider's trusted contacts receive live trip link (if enabled)
    → In-ride screen active for rider (R-16) and driver (D-21)

PHASE 5 — COMPLETION
Driver arrives at destination → taps End Trip (D-21)
    → System calculates final fare:
        - AI recommended fare (base)
        - Wait time adjustments (if applicable)
        - Route adjustments (if applicable)
        - Rider bid adjustment (if bid was accepted)
    → Rider payment charged via Stripe
    → Platform fee calculated (20–30%)
    → Driver earnings confirmed (70–80%)
    → Trip Complete shown to both parties (R-17, D-22)

PHASE 6 — POST-TRIP
Rider rates driver (R-18)
Driver rates rider (D-23)
    → Ratings stored
    → Low ratings trigger review queue
Driver earnings added to wallet
Instant payout available (D-26)
Rider receives email receipt
AI logging: trip outcome feeds all AI engines
    → Pricing Engine updates acceptance model
    → Matching Engine updates driver efficiency model
    → Demand Engine updates area demand model
```

---

## 8. AI Pricing Workflow

```
TRIGGER: Rider enters destination in R-09

STEP 1 — Data Collection (< 200ms target)
Pricing Engine collects:
    - Pickup coordinates
    - Destination coordinates
    - Distance (Google Maps Distance Matrix API)
    - Estimated drive time (traffic-aware)
    - Current driver supply (count within radius, weighted by proximity)
    - Current rider demand (pending requests in area)
    - Time of day + day of week
    - Weather conditions (weather API)
    - Active local events (event data feed)
    - Airport status: EWR arrival/departure volume (flight data API)
    - Historical acceptance rates (pickup zone, last 30 days)
    - Historical cancellation rates (pickup zone, last 30 days)
    - Competitor pricing signals (if available via market research data)

STEP 2 — Base Fare Calculation
    Base Fare = (Base Rate) + (Distance × Per Mile Rate) + (Time × Per Minute Rate)

STEP 3 — Demand Adjustment
    Demand Multiplier = f(driver supply, rider demand, area, time)
    Adjusted Fare = Base Fare × Demand Multiplier
    AI Cap: Multiplier cannot exceed platform-configured surge ceiling

STEP 4 — Driver Earnings Floor Check
    Minimum Fare = (Miles × Min Earnings Per Mile) + (Minutes × Min Earnings Per Minute)
    If Adjusted Fare yields driver earnings below floor:
        Fare raised to meet floor
    This check runs on EVERY fare calculation — no exceptions

STEP 5 — Fare Output
    Recommended Fare displayed to rider
    Fare components available (expandable breakdown in R-10)
    Fare locked for 60 seconds (market conditions may change fare after)

STEP 6 — Rider Response
    Option A: Accept → fare forwarded to matched driver as-is
    Option B: Bid lower →
        System checks: Is rider's bid ≥ driver earnings floor?
            If Yes → bid sent to driver
            If No → bid rejected, minimum shown to rider with explanation
    Option C: Priority → premium added to fare, moved to front of matching queue
    Option D: Premium vehicle → fare adjusted for vehicle type

STEP 7 — Driver Response
    Driver sees fare (or bid)
    Accept → trip proceeds
    Decline → next driver; pricing engine re-evaluates for next driver
    Counter-Offer →
        Counter checked against platform ceiling (no gouging)
        Counter sent to rider
        If accepted → trip proceeds
        If declined → next driver

STEP 8 — Post-Trip AI Update
    Outcome recorded: accepted fare, bid accepted, counter accepted, cancelled
    Driver earnings for this trip recorded
    Rider acceptance behavior recorded
    Area demand updated
    All data feeds AI training pipeline (async)
```

---

## 9. Rewards Workflow

```
POINTS EARNING

Completed Ride:
    → Trip marked complete
    → Points calculated: [fare amount in dollars] × [points multiplier per dollar]
    → Points credited to rider balance in real time
    → Push notification: "You earned X points!"

Referral:
    → Rider shares unique referral code
    → New rider signs up using code
    → New rider completes first trip
    → Referrer earns bonus points (credited on new rider's trip 1 completion)
    → New rider earns welcome bonus points

Verified Review:
    → Rider submits written review after a trip
    → Review passes content check (AI moderation)
    → Points credited (once per trip — no duplicate reviews)

Milestone Bonus:
    → System checks tier thresholds after every trip
    → Tier advancement detected → bonus points credited + tier upgrade notification

TIER MANAGEMENT

After every trip, system evaluates:
    Points balance against tier thresholds:
    Silver    → 0 – 999 points
    Gold      → 1,000 – 4,999 points
    Platinum  → 5,000 – 14,999 points
    Elite     → 15,000+ points

    Tier UP: notification + congratulations modal + new benefits unlocked
    Tier DOWN: not applied during current month (grace period model)

POINTS REDEMPTION

Rider opens R-22 (Redeem Rewards)
    → Selects redemption option
    → Confirms redemption
    → Points deducted from balance
    → Benefit applied:
        Free Ride Credit → added as account credit, auto-applies at checkout
        Ride Discount → applied as discount code, one-time use
        Priority Pickup → one-time flag added to account
        Premium Upgrade → one-time upgrade credit

    Redemption logged in rewards_transactions table
    Rider receives confirmation + updated balance
```

---

## 10. Corporate Account Workflow

```
ACCOUNT SETUP
    Company Admin requests BidiRide Business account
    (web form or sales contact — MVP: manual setup by BidiRide admin)
        → BidiRide Admin creates account in A-16
        → Billing method collected (corporate card or invoicing)
        → Monthly spend limit set
        → Admin invitation email sent to Company Admin

EMPLOYEE ENROLLMENT
    Company Admin logs into corporate portal (or BidiRide Business tab in admin app)
        → Enters employee emails
        → Invitation emails sent to employees
        → Employee downloads BidiRide Rider App
        → Standard rider onboarding (R-03 to R-08)
        → Employee linked to corporate account by invitation token

CORPORATE RIDE BOOKING
    Employee opens Rider App
        → Books ride normally (R-08 to R-10)
        → On fare screen: selects "Bill to [Company Name]"
        → Optional: enters trip purpose or cost code
        → Ride proceeds as normal
        → Fare charged to corporate account (not employee's personal card)

BILLING CYCLE
    Monthly cycle runs:
        → All corporate trips aggregated
        → Invoice generated: trip list, employees, amounts, totals
        → Invoice emailed to billing contact
        → Auto-charge to corporate payment method
        → Or net-30 invoicing (enterprise tier, future)

COMPANY ADMIN REPORTING
    Company Admin views travel dashboard (A-17):
        → All trips by employee (current month + history)
        → Spend by employee, by department (if coded)
        → Airport trip frequency
        → Monthly trend charts
        → Export to CSV / PDF for expense reporting

EMPLOYEE MANAGEMENT
    Company Admin can:
        → Add new employees
        → Remove employees (their corporate access revoked immediately)
        → Set per-employee spending limits
        → Set trip purpose requirements (mandatory/optional)
```

---

## 11. Payment and Payout Workflow

### 11.1 Rider Payment

```
Trip Completes
    → Final fare confirmed by system
    → Stripe payment intent executed:
        - Charge to rider's saved default payment method
        - Or to corporate account (if corporate ride)
    → Payment status: Succeeded / Failed
        If Failed:
            → Retry once (automatic)
            → If retry fails: rider notified, account flagged, payment method update required
            → Driver still paid from platform reserve (system integrity guarantee)
    → Receipt generated:
        - Email receipt to rider
        - In-app receipt accessible in R-20
    → Corporate rides: receipt also appears in A-17 corporate billing
```

### 11.2 Platform Fee Split

```
Final Fare: $X
    → Driver Earnings: $X × driver_payout_rate (70–80%)
    → Platform Fee: $X × platform_commission_rate (20–30%)

    Driver earnings floor check runs before split is finalized.
    If split yields driver below floor:
        Driver receives floor amount
        Platform absorbs the difference
        Event logged for AI training (this market/time may be underpriced)
```

### 11.3 Driver Payout

```
Trip Completes
    → Driver earnings calculated and confirmed
    → Amount added to Driver Wallet (available_balance in drivers table)
    → Driver can:

        Option A — Instant Payout (on-demand):
            → Driver taps "Payout Now" in D-26
            → Stripe Instant Payout triggered
            → Funds to linked debit card or bank account
            → Arrival: within minutes (Stripe standard)
            → No fee to driver

        Option B — Scheduled Payout (automatic):
            → Daily or weekly (driver preference, set in D-34)
            → Stripe standard bank transfer
            → Arrival: 1–2 business days
            → No fee

    → Payout logged in payouts table
    → Driver notified via push notification
    → Payout history updated in D-27

Tax Reporting:
    → Stripe collects SSN/EIN on payout setup (legal requirement)
    → Annual 1099-K or 1099-NEC generated by Stripe for drivers earning > IRS threshold
    → Accessible in driver app D-34 (link to Stripe tax portal, MVP)
```

---

## 12. Emergency and Safety Workflow

### 12.1 AI-Detected Anomaly (Passive Monitoring)

```
During every active trip, AI Safety Monitor runs:
    Checks every 30 seconds:
        → Current route vs. expected route
        → Speed (unexpected stop > 3 minutes in unusual location)
        → Trip duration vs. estimate (> 50% over estimate)
        → Driver GPS signal lost > 60 seconds

    Anomaly Detected:
        → AI flags trip in safety system
        → Admin Safety Dashboard receives alert (A-12)
        → Admin can:
            - View live trip location
            - Contact driver (in-app message or call)
            - Contact rider (in-app message or call)
            - Escalate to emergency dispatch
            - Suspend trip

    Soft Anomaly (likely benign — traffic, detour):
        → Logged, no immediate action
        → Rider sees note: "Your route has changed. Trip is being monitored."

    Hard Anomaly (high risk — extended deviation, signal loss):
        → Admin alerted with P1 priority
        → Push notification sent to rider: "Is everything okay?" with SOS button
        → If no rider response in 60 seconds → emergency protocol considered
```

### 12.2 SOS Activation — Rider or Driver

```
User presses SOS button (accessible on R-16 / D-21 at all times)
    → Confirmation modal: "Send emergency alert?" [Cancel] [Confirm]
    → If no response in 5 seconds → auto-confirms (user may be incapacitated)

    ON ACTIVATION:
    → GPS coordinates captured and logged
    → All trusted contacts receive SMS:
        "BidiRide Safety Alert: [Name] has activated emergency assistance.
         Live trip location: [link]"
    → Admin Safety Dashboard receives P0 alert with:
        - Live GPS
        - Trip ID
        - Driver and rider profiles
        - AI anomaly context (if applicable)
    → In-app SOS screen shows:
        - "Help is on the way"
        - One-tap button: "Call 911" (opens phone dialer with 911 pre-filled)
        - Emergency dispatch integration (if available in market)
    → Trip automatically marked as Safety Incident (A-13)
    → Safety admin assigned within 2 minutes (SLA)

    ADMIN RESPONSE:
    → Admin contacts both parties via in-app message
    → Admin can dispatch emergency services directly (integration — Phase 2)
    → Admin documents all actions in A-13
    → Incident remains open until safety admin marks resolved with notes

    POST-INCIDENT:
    → Both driver and rider accounts flagged for post-incident review
    → Safety team follow-up within 24 hours
    → Incident report generated
    → Accounts may be suspended pending investigation
```

### 12.3 Driver Reports Unsafe Rider

```
Driver taps "Report Unsafe Rider" in D-35
    → Reason options: Threatening behavior, Intoxication, Property damage,
                      Harassment, Made me feel unsafe, Other
    → Optional text description
    → Submit

    → Admin support ticket created (P1 for threatening/harassment)
    → Rider's risk score updated
    → If pattern (3+ driver reports): account reviewed for suspension
    → Driver receives acknowledgment: "Thank you. We take this seriously."
```

---

## 13. Database Architecture

### 13.1 Core Tables

---

**`users`** — Base identity record for all platform users.
```
id              UUID PRIMARY KEY
email           VARCHAR UNIQUE NOT NULL
phone           VARCHAR UNIQUE NOT NULL
password_hash   VARCHAR NOT NULL
full_name       VARCHAR NOT NULL
date_of_birth   DATE
role            ENUM(rider, driver, corporate_admin, admin, super_admin)
status          ENUM(active, pending, suspended, banned)
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

---

**`riders`** — Extends users for rider-specific data.
```
id                  UUID PRIMARY KEY REFERENCES users(id)
profile_photo_url   VARCHAR
risk_score          DECIMAL(5,2) DEFAULT 0.00
rewards_balance     INTEGER DEFAULT 0
rewards_tier        ENUM(silver, gold, platinum, elite) DEFAULT silver
referral_code       VARCHAR UNIQUE
referred_by         UUID REFERENCES riders(id)
corporate_account_id UUID REFERENCES corporate_accounts(id) NULLABLE
```

---

**`drivers`** — Extends users for driver-specific data.
```
id                      UUID PRIMARY KEY REFERENCES users(id)
profile_photo_url       VARCHAR NOT NULL
license_number          VARCHAR
license_state           VARCHAR(2)
license_expiry          DATE
background_check_status ENUM(pending, clear, consider, adverse, failed)
background_check_date   DATE
is_online               BOOLEAN DEFAULT FALSE
current_lat             DECIMAL(9,6)
current_lng             DECIMAL(9,6)
acceptance_rate         DECIMAL(5,2)
completion_rate         DECIMAL(5,2)
average_rating          DECIMAL(3,2)
total_trips             INTEGER DEFAULT 0
earnings_balance        DECIMAL(10,2) DEFAULT 0.00
stripe_account_id       VARCHAR
verification_status     ENUM(pending, approved, rejected, suspended)
```

---

**`vehicles`**
```
id              UUID PRIMARY KEY
driver_id       UUID REFERENCES drivers(id)
make            VARCHAR
model           VARCHAR
year            INTEGER
color           VARCHAR
license_plate   VARCHAR
state           VARCHAR(2)
status          ENUM(active, inactive, suspended)
verified_at     TIMESTAMP NULLABLE
photos          JSONB
created_at      TIMESTAMP
```

---

**`documents`**
```
id              UUID PRIMARY KEY
user_id         UUID REFERENCES users(id)
document_type   ENUM(drivers_license, vehicle_registration, insurance, government_id, selfie, vehicle_photo)
file_url        VARCHAR
status          ENUM(pending, approved, rejected, expired)
expiry_date     DATE NULLABLE
rejection_reason VARCHAR NULLABLE
verified_at     TIMESTAMP NULLABLE
created_at      TIMESTAMP
```

---

**`trips`**
```
id                  UUID PRIMARY KEY
rider_id            UUID REFERENCES riders(id)
driver_id           UUID REFERENCES drivers(id) NULLABLE
vehicle_id          UUID REFERENCES vehicles(id) NULLABLE
corporate_account_id UUID REFERENCES corporate_accounts(id) NULLABLE
status              ENUM(requested, matching, matched, en_route, arrived, in_progress, completed, cancelled)
pickup_address      VARCHAR
pickup_lat          DECIMAL(9,6)
pickup_lng          DECIMAL(9,6)
destination_address VARCHAR
destination_lat     DECIMAL(9,6)
destination_lng     DECIMAL(9,6)
ai_recommended_fare DECIMAL(8,2)
rider_bid           DECIMAL(8,2) NULLABLE
driver_counter      DECIMAL(8,2) NULLABLE
final_fare          DECIMAL(8,2)
ride_type           ENUM(standard, priority, premium)
distance_miles      DECIMAL(6,2)
duration_minutes    INTEGER
driver_earnings     DECIMAL(8,2)
platform_fee        DECIMAL(8,2)
tip_amount          DECIMAL(6,2) DEFAULT 0.00
cancellation_reason VARCHAR NULLABLE
cancelled_by        ENUM(rider, driver, system) NULLABLE
trip_purpose        VARCHAR NULLABLE
requested_at        TIMESTAMP
matched_at          TIMESTAMP NULLABLE
pickup_at           TIMESTAMP NULLABLE
started_at          TIMESTAMP NULLABLE
completed_at        TIMESTAMP NULLABLE
```

---

**`trip_events`** — Real-time event log for each trip (route deviation, stops, SOS, etc.)
```
id          UUID PRIMARY KEY
trip_id     UUID REFERENCES trips(id)
event_type  ENUM(route_deviation, unexpected_stop, sos_activated, signal_lost, driver_arrived, trip_started, trip_ended, anomaly_detected)
lat         DECIMAL(9,6)
lng         DECIMAL(9,6)
metadata    JSONB
created_at  TIMESTAMP
```

---

**`payments`**
```
id                      UUID PRIMARY KEY
trip_id                 UUID REFERENCES trips(id)
rider_id                UUID REFERENCES riders(id)
amount                  DECIMAL(8,2)
platform_fee            DECIMAL(8,2)
driver_earnings         DECIMAL(8,2)
tip_amount              DECIMAL(6,2)
status                  ENUM(pending, succeeded, failed, refunded)
stripe_payment_intent_id VARCHAR
payment_method_last4    VARCHAR(4)
payment_method_type     VARCHAR
corporate_account_id    UUID NULLABLE
created_at              TIMESTAMP
```

---

**`payouts`**
```
id                  UUID PRIMARY KEY
driver_id           UUID REFERENCES drivers(id)
amount              DECIMAL(8,2)
payout_type         ENUM(instant, scheduled)
status              ENUM(pending, paid, failed)
stripe_transfer_id  VARCHAR
payout_method       ENUM(bank_account, debit_card)
created_at          TIMESTAMP
paid_at             TIMESTAMP NULLABLE
```

---

**`ratings`**
```
id          UUID PRIMARY KEY
trip_id     UUID REFERENCES trips(id)
rater_id    UUID REFERENCES users(id)
rated_id    UUID REFERENCES users(id)
score       SMALLINT CHECK (score BETWEEN 1 AND 5)
review      TEXT NULLABLE
tags        JSONB NULLABLE
created_at  TIMESTAMP
```

---

**`rewards_transactions`**
```
id              UUID PRIMARY KEY
rider_id        UUID REFERENCES riders(id)
points          INTEGER
transaction_type ENUM(earned_ride, earned_referral, earned_review, earned_bonus, redeemed, adjusted)
trip_id         UUID REFERENCES trips(id) NULLABLE
description     VARCHAR
balance_after   INTEGER
created_at      TIMESTAMP
```

---

**`corporate_accounts`**
```
id              UUID PRIMARY KEY
company_name    VARCHAR NOT NULL
billing_email   VARCHAR NOT NULL
billing_method  ENUM(card, invoice)
stripe_customer_id VARCHAR NULLABLE
monthly_limit   DECIMAL(10,2) NULLABLE
status          ENUM(active, suspended, cancelled)
created_at      TIMESTAMP
```

---

**`corporate_employees`**
```
id                  UUID PRIMARY KEY
corporate_account_id UUID REFERENCES corporate_accounts(id)
rider_id            UUID REFERENCES riders(id)
spending_limit      DECIMAL(8,2) NULLABLE
status              ENUM(active, removed)
invited_at          TIMESTAMP
enrolled_at         TIMESTAMP NULLABLE
```

---

**`safety_incidents`**
```
id              UUID PRIMARY KEY
trip_id         UUID REFERENCES trips(id)
incident_type   ENUM(sos_rider, sos_driver, route_deviation, driver_report, rider_report, ai_anomaly)
initiated_by    UUID REFERENCES users(id)
status          ENUM(open, in_progress, resolved, escalated)
admin_assigned  UUID REFERENCES users(id) NULLABLE
notes           TEXT NULLABLE
resolved_at     TIMESTAMP NULLABLE
created_at      TIMESTAMP
```

---

**`trusted_contacts`**
```
id              UUID PRIMARY KEY
user_id         UUID REFERENCES users(id)
name            VARCHAR
phone           VARCHAR
relationship    VARCHAR
auto_share      BOOLEAN DEFAULT TRUE
created_at      TIMESTAMP
```

---

**`ai_pricing_logs`**
```
id                  UUID PRIMARY KEY
trip_id             UUID REFERENCES trips(id)
inputs_snapshot     JSONB
recommended_fare    DECIMAL(8,2)
demand_multiplier   DECIMAL(4,2)
driver_floor_applied BOOLEAN DEFAULT FALSE
outcome             ENUM(accepted, bid_submitted, cancelled, driver_declined)
created_at          TIMESTAMP
```

---

**`admin_users`**
```
id              UUID PRIMARY KEY
name            VARCHAR
email           VARCHAR UNIQUE
password_hash   VARCHAR
role            ENUM(support_agent, safety_admin, finance_admin, platform_admin, super_admin)
status          ENUM(active, deactivated)
last_login_at   TIMESTAMP NULLABLE
created_at      TIMESTAMP
```

---

**`audit_logs`**
```
id              UUID PRIMARY KEY
admin_user_id   UUID REFERENCES admin_users(id)
action          VARCHAR NOT NULL
entity_type     VARCHAR
entity_id       UUID NULLABLE
before_value    JSONB NULLABLE
after_value     JSONB NULLABLE
ip_address      VARCHAR
created_at      TIMESTAMP
```

---

## 14. API Architecture

### 14.1 Communication Protocols

| Pattern | Use Case |
|---|---|
| REST (HTTPS) | Standard CRUD, auth, profile management, trip requests, payments |
| WebSocket | Real-time: driver location updates, trip status, fare updates, chat |
| Event Queue (Redis / AWS SQS) | Async: payouts, notifications, AI training data, email receipts |
| Webhooks | Stripe payment events, background check results |

### 14.2 Service Architecture

---

**Auth Service**
- `POST /auth/register` — rider or driver account creation
- `POST /auth/verify-phone` — OTP verification
- `POST /auth/verify-email` — email link verification
- `POST /auth/login` — returns JWT access + refresh token
- `POST /auth/refresh` — refresh access token
- `POST /auth/logout`
- `POST /auth/password-reset/request`
- `POST /auth/password-reset/confirm`

---

**User Service**
- `GET /users/me` — current user profile
- `PUT /users/me` — update profile
- `POST /users/me/photo` — upload profile photo
- `GET /users/me/notifications`
- `PUT /users/me/settings`

---

**Rider Service**
- `GET /riders/me/rewards` — balance, tier, history
- `POST /riders/me/rewards/redeem` — redeem points
- `GET /riders/me/saved-places`
- `POST /riders/me/saved-places`
- `DELETE /riders/me/saved-places/:id`
- `GET /riders/me/trusted-contacts`
- `POST /riders/me/trusted-contacts`
- `DELETE /riders/me/trusted-contacts/:id`
- `POST /riders/referral/apply` — apply referral code

---

**Driver Service**
- `POST /drivers/me/go-online` — set driver available (requires selfie verified)
- `POST /drivers/me/go-offline`
- `PUT /drivers/me/location` — continuous GPS updates (via WebSocket preferred)
- `GET /drivers/me/earnings`
- `GET /drivers/me/performance`
- `GET /drivers/me/heatmap` — demand zone data for current market
- `GET /drivers/me/ai-insights` — personalized recommendations

---

**Document Service**
- `POST /documents/upload` — upload document file
- `GET /documents/:id/status` — check verification status
- `GET /drivers/me/documents` — all driver documents with statuses

---

**Trip Service**
- `POST /trips/request` — rider requests a trip (triggers pricing + matching)
- `GET /trips/:id` — trip detail (rider or driver, scoped by auth)
- `POST /trips/:id/cancel` — cancel trip
- `PUT /trips/:id/status` — update status (driver actions: arrived, started, completed)
- `GET /trips/history` — rider or driver trip history
- `POST /trips/:id/report` — report issue on trip

**WebSocket: Trip Channel**
- `trip:driver_location` — driver GPS position (to rider)
- `trip:status_update` — status changes (matched, arrived, started, completed)
- `trip:fare_update` — if fare adjusts (route change)
- `driver:request` — incoming ride request (to driver)
- `driver:counter_response` — rider response to driver counter-offer

---

**Pricing Service (AI)**
- `POST /pricing/estimate` — generate AI fare for given pickup/destination
- `POST /pricing/validate-bid` — validate rider bid against driver floor
- `POST /pricing/validate-counter` — validate driver counter against ceiling
- `GET /pricing/inputs/:market` — current pricing factors for a market (admin)

---

**Matching Service (AI)**
- Internal service — not externally accessible
- Triggered by trip request
- Selects optimal driver, sends request, manages fallback queue
- Emits events to WebSocket service on match

---

**Payment Service**
- `POST /payments/add-method` — add Stripe payment method
- `GET /payments/methods` — list saved methods
- `DELETE /payments/methods/:id`
- `POST /payments/methods/:id/default`
- `GET /payments/receipts/:trip_id` — trip receipt

**Stripe Webhook Handler**
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `transfer.paid` (driver payout confirmation)

---

**Payout Service**
- `POST /payouts/instant` — trigger instant payout (driver)
- `GET /payouts/history` — driver payout history
- `POST /payouts/setup` — link bank account or debit card (Stripe Connect)
- `PUT /payouts/schedule` — set payout frequency preference

---

**Safety Service**
- `POST /safety/sos` — activate SOS for active trip
- `GET /safety/trip-link/:trip_id` — public live trip link (for trusted contacts)
- `POST /safety/report` — report unsafe driver or rider
- `GET /safety/incidents/me` — user's own incident history

---

**Rewards Service**
- `GET /rewards/me` — balance, tier, history
- `POST /rewards/redeem` — redeem points
- `GET /rewards/options` — available redemption options

---

**Corporate Service**
- `GET /corporate/me` — corporate account info (for corporate admin)
- `GET /corporate/me/employees`
- `POST /corporate/me/employees/invite`
- `DELETE /corporate/me/employees/:id`
- `GET /corporate/me/trips` — all trips on account
- `GET /corporate/me/billing` — billing history and current cycle

---

**Notification Service** (internal, event-driven)
- Listens for platform events
- Sends: push notifications (Expo Push / FCM / APNs), SMS (Twilio), email (SendGrid)
- Templates stored in database
- Delivery logged per notification

---

**Admin Service** (web dashboard API — separate auth domain)
- Full CRUD on driver and rider accounts
- Trip management and audit
- Financial reporting endpoints
- AI engine status endpoints
- Safety incident management
- All admin endpoints require admin JWT + MFA session

---

### 14.3 API Standards

| Standard | Specification |
|---|---|
| Format | JSON (all requests and responses) |
| Authentication | JWT Bearer tokens (access + refresh) |
| Admin Auth | JWT + TOTP MFA |
| Versioning | URI versioning: `/v1/...` |
| Error Format | `{ "error": { "code": "...", "message": "...", "field": "..." } }` |
| Pagination | Cursor-based: `?cursor=...&limit=25` |
| Rate Limiting | Per-user rate limits enforced at API gateway (AWS API Gateway) |
| HTTPS | Required on all endpoints. HTTP rejected. |
| CORS | Restricted to registered app origins only |

---

## 15. User Roles and Permissions

| Role | Description | Key Permissions |
|---|---|---|
| **Rider** | Standard app user | Book rides, manage profile, view history, rewards, safety features, trusted contacts |
| **Corporate Rider** | Rider enrolled in a BidiRide Business account | All Rider permissions + bill rides to company account |
| **Driver** | Approved platform driver | Go online, receive/accept rides, navigation, earnings, instant payout, driver safety tools |
| **Corporate Admin** | Company representative managing a BidiRide Business account | Manage employees, view company trips, view billing, access travel dashboard |
| **Support Agent** | BidiRide customer support staff | View rider + driver profiles, view trip history, create + resolve support tickets. Cannot: modify financial data, change account status beyond flagging |
| **Safety Admin** | BidiRide safety team | All Support Agent permissions + view + manage safety incidents, access live trip data, initiate emergency response, suspend accounts during active incidents |
| **Finance Admin** | BidiRide finance team | View financial dashboard, view payout history, issue refunds, view corporate billing. Cannot: access safety data, manage user accounts |
| **Platform Admin** | BidiRide operations management | All above permissions + approve/reject driver applications, manage driver/rider accounts, pricing control panel, corporate account management, rewards management, send platform communications |
| **Super Admin** | Founder / senior leadership only | Full system access including AI engine controls, system settings, user role management, audit log, pricing parameters. All actions require dual confirmation. |

### 15.1 Permission Enforcement

- All API endpoints validate JWT role claims server-side.
- Role claims are never trusted from the client.
- Admin dashboard routes are restricted at both API and UI level.
- Sensitive actions (suspend, ban, pricing changes, mass communications) require confirmation modal and are logged.
- Super Admin actions that affect driver economics or safety standards require Founder authorization (in MVP: manual approval step).

---

## 16. MVP Scope vs Future Releases

### 16.1 MVP (Stage 1 — Internal Build)

**Included in MVP:**

| Area | MVP Features |
|---|---|
| Rider App | Sign up, verification, home map, destination entry, AI fare display, accept/bid, real-time matching, live driver tracking, in-ride tracking, trip complete, rating, payment, ride history, safety SOS, trusted contacts |
| Driver App | Sign up, full verification flow, pre-shift selfie, go online, ride request screen, navigation to pickup, in-ride navigation, trip complete, earnings dashboard, instant payout, basic performance stats |
| AI Layer | Dynamic pricing engine (fare generation + driver floor enforcement), basic matching engine (proximity + rating + acceptance rate), basic fraud detection (rule-based), route anomaly detection |
| Payments | Stripe card payments, instant payout (Stripe Connect), corporate billing (MVP: manual invoice) |
| Admin Dashboard | Live map, driver management, rider management, trip management, basic safety incidents, basic financial view, support queue |
| Safety | SOS button, trusted contacts, live trip tracking shared link, AI route monitoring, admin safety alerts |
| Notifications | Push (Expo), SMS (Twilio) for critical events, email receipts |
| Backend | Auth, user, rider, driver, trip, pricing, payment, payout, safety, document, notification services |

---

### 16.2 Phase 2 (Post-Beta Validation)

| Area | Phase 2 Features |
|---|---|
| Rider App | BidiRide Rewards (points, tiers, redemption), referral program, family safety tracking, audio recording option, corporate ride booking |
| Driver App | Heat map with AI demand zones, AI Insights (personalized recommendations), full performance analytics, annual tax document access |
| AI Layer | Driver Prediction Engine (positioning recommendations), Rider Prediction Engine (demand anticipation), Surge Forecasting Engine, Demand Forecasting Engine |
| Admin Dashboard | AI Engine Monitor, Rewards management, full Fraud Detection dashboard, corporate accounts module, Communications tool |
| Business | BidiRide Business (corporate accounts, employee management, company dashboard) |
| Safety | Emergency dispatch integration (911 API), driver pre-trip vehicle checklist |

---

### 16.3 Phase 3 (Market Expansion)

| Area | Phase 3 Features |
|---|---|
| Products | BidiRide XL (large vehicles, groups) |
| Rider App | BidiRide Elite benefits, ride scheduling (future pickup), multi-stop trips |
| Driver App | Multi-vehicle support, advanced earnings analytics, driver community features |
| AI Layer | Competitor pricing analysis engine, market expansion intelligence (which city to enter next) |
| Platform | Multi-market admin tools, market-specific pricing parameters |

---

### 16.4 Phase 4–5 (Ecosystem Expansion)

| Phase | Product |
|---|---|
| Phase 4 | BidiRide Delivery — package and last-mile delivery marketplace |
| Phase 5 | BidiRide Freight — commercial freight matching |
| Phase 5+ | BidiRide AI Mobility Platform — full transportation intelligence network |

---

## 17. Airport Queue Intelligence System

> EWR (Newark Liberty International Airport) is BidiRide's primary launch anchor. This system is purpose-built for airport operations and is a core competitive differentiator in the Newark market.

### 17.1 Overview

The Airport Queue Intelligence System is a dedicated AI subsystem that manages driver staging, demand prediction, and terminal routing for airport pickups. It connects live flight data with driver supply to eliminate the guesswork of airport driving — turning EWR from a chaotic pickup zone into BidiRide's highest-efficiency market.

---

### 17.2 Driver Staging Zones (Virtual Airport Queue)

**Problem:** At major airports, rideshare drivers circle the lot burning fuel and earning nothing while waiting for rides. BidiRide replaces this with an intelligent virtual queue.

**How It Works:**
```
Driver arrives at EWR staging area
    → Driver taps "Enter Airport Queue" in Driver App
    → System registers driver into virtual queue
    → Driver sees:
        - Queue position (e.g., "You are #7 in the queue")
        - Estimated wait time based on current flight arrivals
        - Projected earnings for next airport ride
        - "Leave Queue" option (no penalty)

Queue management rules:
    → Queue is first-in, first-out within the same vehicle tier
    → AI adjusts queue ordering if a ride requires a specific vehicle type
    → Drivers who decline airport rides while in queue are moved to back
    → Queue position visible only to that driver (not public)
    → Drivers not in the physical staging geo-fence cannot join queue
```

**Driver App — Airport Queue Screen (D-17b):**
- Queue position counter
- Live flight arrivals feed (next 30 minutes)
- Projected demand: "High demand in ~12 minutes (Flight UA 447 arriving Terminal C)"
- Terminal assignment on match: "Pick up at Terminal C, Door 4"
- Earnings forecast for current queue position
- Map of staging area with lot boundaries

---

### 17.3 Flight Delay Integration

**Data Source:** Real-time flight data API (e.g., FlightAware, AeroAPI, or Aviation Stack).

**System Behavior:**
```
Flight data ingested every 5 minutes:
    → Scheduled arrivals at EWR (all terminals)
    → Actual arrival times (delays, early arrivals)
    → Number of passengers per flight (estimated from seat capacity × load factor)
    → Terminal assignment per flight

AI processes:
    → Delayed flight detected → reduce driver queue encouragement for that window
    → Early arrival detected → accelerate driver repositioning recommendation
    → Large aircraft arriving → increase driver pull-to-airport recommendation
    → Multiple simultaneous arrivals → surge forecast triggered

Rider-side behavior:
    → Arriving passengers open app at airport
    → AI already has drivers positioned and queued
    → ETA shown to rider is accurate because supply was pre-positioned
```

**Database: `flight_data_cache`**
```
id                  UUID PRIMARY KEY
airport_code        VARCHAR(4) DEFAULT 'KEWR'
flight_number       VARCHAR
airline             VARCHAR
origin              VARCHAR
scheduled_arrival   TIMESTAMP
estimated_arrival   TIMESTAMP
terminal            VARCHAR
gate                VARCHAR NULLABLE
passenger_estimate  INTEGER
status              ENUM(scheduled, delayed, arrived, cancelled)
fetched_at          TIMESTAMP
```

---

### 17.4 Terminal-Specific Pickup Guidance

EWR has three terminals (A, B, C) with separate TNC pickup zones. Directing drivers and riders to the correct door eliminates cancellations caused by pickup confusion.

**For Riders (arriving at EWR):**
```
Rider requests ride from EWR
    → App detects EWR geofence
    → Prompts: "Which terminal are you arriving at?"
    → Options: Terminal A / Terminal B / Terminal C / Not sure
    → If "Not sure": AI uses flight number lookup (optional entry) to determine terminal
    → Pickup pin drops at correct TNC pickup zone for that terminal
    → Ride confirmation shows: "Meet your driver at Terminal C, Arrivals Level, Door 3"
```

**For Drivers (matched to airport pickup):**
```
Driver receives airport ride request
    → Request shows: Terminal C, Door 3 — estimated 4 min from staging
    → Navigation routes to exact terminal pickup zone (not general airport entrance)
    → On arrival: "Pull into lane 2. Your rider is at Door 3."
    → Rider and driver both see same pin — eliminates "where are you?" confusion
```

---

### 17.5 Airport Demand Forecasting

The Airport Demand Forecasting Engine runs continuously and projects ride demand at EWR up to 4 hours in advance.

**Forecast Inputs:**
- Scheduled flight arrivals (all airlines, all terminals)
- Historical ride request volume by terminal, time of day, day of week
- Weather conditions (delays, cancellations, passenger rerouting)
- Seasonal travel patterns (holidays, events, college calendars)
- Flight load factors by airline and route
- Current driver supply near airport

**Forecast Output:**
```
Every 15 minutes, the engine produces:
    → Demand forecast: Low / Moderate / High / Very High per terminal
    → Time-to-peak: "Peak demand in ~22 minutes"
    → Recommended driver count per terminal
    → Current supply vs. recommended supply gap
    → Repositioning recommendations (published to nearby drivers)
```

**Admin Dashboard — Airport Operations Panel (A-25a):**
- Live terminal demand heatmap
- Flight arrivals feed (next 2 hours)
- Queue depth per terminal
- Driver supply vs. forecast demand chart
- Average ETA at airport vs. platform target
- Cancellation rate at EWR (separate from general market)

---

### 17.6 Driver Reposition Recommendations

When airport demand is forecast to spike, the AI proactively surfaces repositioning recommendations to nearby drivers.

**Trigger Logic:**
```
Airport Demand Engine detects:
    → Demand forecast exceeds current driver supply
    → Gap: need X more drivers at airport in Y minutes

AI sends repositioning nudge to eligible drivers:
    → Drivers within 10 miles of EWR
    → Currently online but not on a trip
    → Historically accept airport rides (acceptance rate > 70% for airport requests)

Driver receives in-app notification:
    "High demand at Newark Airport in ~18 minutes.
     Estimated earnings: $22–$28 for your next ride.
     [Go to Airport] [Dismiss]"

Drivers who navigate to airport join virtual queue on arrival.
Drivers who dismiss are not penalized.
Recommendations are never forced — they are suggestions.
```

**API Endpoints — Airport Service:**
```
GET  /airport/queue/status           — driver queue position and ETA
POST /airport/queue/join             — driver joins airport queue
POST /airport/queue/leave            — driver exits queue
GET  /airport/demand/forecast        — current demand forecast by terminal
GET  /airport/flights/arrivals       — next 2 hours of arrivals at EWR
GET  /airport/terminal/:code/pickup  — pickup zone coordinates for terminal
POST /airport/rider/terminal-select  — rider selects arrival terminal
```

**Database: `airport_queue_entries`**
```
id              UUID PRIMARY KEY
driver_id       UUID REFERENCES drivers(id)
airport_code    VARCHAR(4) DEFAULT 'KEWR'
terminal        VARCHAR NULLABLE
queue_position  INTEGER
joined_at       TIMESTAMP
assigned_at     TIMESTAMP NULLABLE
left_at         TIMESTAMP NULLABLE
status          ENUM(waiting, assigned, completed, left)
```

---

## 18. AI Driver Earnings Protection Engine

> This engine is the enforcement layer behind BidiRide's core promise: drivers will never be driven below a profitable earnings floor by marketplace dynamics, rider bids, or AI pricing errors.

### 18.1 Objectives

| Objective | Description |
|---|---|
| Prevent race-to-bottom pricing | No bid or counter-offer accepted below the calculated floor |
| Protect hourly earnings | Monitor driver earnings per hour across a shift and flag underperformance |
| Minimum earnings enforcement | Hard floor per trip — enforced before any fare is shown to a rider |
| Dynamic floor calculation | Floor is not a fixed number — it accounts for real costs in real time |
| Driver profitability forecasting | Show drivers projected earnings before they accept a ride |

---

### 18.2 Dynamic Floor Calculation Model

The earnings floor is not a static platform setting. It is calculated fresh for every trip request.

**Floor Inputs:**
```
Per-trip floor calculation:
    → Estimated trip distance (miles)
    → Estimated trip duration (minutes)
    → Current fuel cost index (market fuel price feed)
    → Vehicle operating cost estimate (IRS mileage rate or platform baseline)
    → Platform minimum earnings rate (per mile + per minute, set in pricing config)
    → Market-specific adjustments (e.g., airport surcharge, late-night premium)

Floor Formula:
    Minimum Driver Earnings =
        (Distance × min_earnings_per_mile)
        + (Duration × min_earnings_per_minute)
        + market_adjustments

    Where:
        min_earnings_per_mile  = configurable (default: $0.65/mile)
        min_earnings_per_minute = configurable (default: $0.22/minute)
        market_adjustments     = airport premium, late-night premium, weather premium
```

**Floor Enforcement Rules:**
```
RULE 1 — Fare Generation:
    AI generates recommended fare
    If (recommended_fare × driver_payout_rate) < floor:
        Fare is raised until driver earnings meet floor
        Rider sees adjusted fare — no transparency gap

RULE 2 — Rider Bid Validation:
    Rider submits bid
    If (bid × driver_payout_rate) < floor:
        Bid rejected
        Rider shown: "Minimum fare to protect driver earnings: $X"
        Rider may accept minimum or cancel request

RULE 3 — Driver Counter Validation:
    Driver submits counter-offer
    Counter is validated against platform ceiling (anti-gouging)
    Counter must be > AI recommended fare (driver cannot counter below)

RULE 4 — Post-Trip Audit:
    If final fare after adjustments yields driver earnings below floor:
        System flags trip
        Driver paid floor amount
        Platform absorbs the difference
        Event logged for AI model retraining
```

---

### 18.3 Hourly Earnings Monitoring

The engine monitors driver earnings across a shift in real time — not just per trip.

**How It Works:**
```
Driver goes online (shift begins)
    → Earnings tracker initialized: earnings = $0, time_online = 0

After each completed trip:
    → Cumulative earnings updated
    → Time online updated
    → Current hourly rate calculated: earnings / hours_online

If hourly rate falls below platform earnings target ($25/hr minimum):
    → AI surfaces in-app suggestion (non-intrusive):
        "Your current hourly rate is $19/hr.
         High demand in [zone] may improve your earnings."
    → AI adjusts driver's demand recommendations toward higher-value zones
    → No penalty — this is guidance, not punishment

If hourly rate consistently below target for 3+ consecutive hours:
    → Driver shown full earnings analysis in D-29 (AI Insights)
    → AI suggests optimal times to drive based on this driver's history
```

---

### 18.4 Driver Profitability Forecast (Per-Trip)

Before a driver accepts or declines a ride, the system shows projected profitability.

**Displayed on D-18 (Ride Request Screen):**
```
Trip: 8.2 miles | Est. 19 min
Fare offered: $18.40
Your earnings: $13.80 (75%)
Est. cost (fuel + time): $4.20
Estimated profit: ~$9.60
Projected hourly rate for this trip: ~$30/hr
```

**Purpose:** Drivers make informed decisions. High-cost trips (long empty return miles, heavy traffic) are visible before acceptance. Transparency builds trust.

---

### 18.5 Race-to-Bottom Prevention

The bidding system includes structural safeguards that prevent price compression over time.

**Safeguards:**
- Rider bids below floor are blocked at API level — they never reach the driver
- The platform does not display "lowest bid wins" framing — it displays "fair fare"
- AI monitors bid acceptance rates: if riders consistently bid below floor, the floor is surfaced more prominently in UX
- Driver counter-offers cannot go below the AI recommended fare (prevents drivers from undercutting themselves)
- Platform commission is never passed to drivers as a cost reduction — it is fixed from the fare, not taken from the floor

**Database: `earnings_floor_logs`**
```
id                      UUID PRIMARY KEY
trip_id                 UUID REFERENCES trips(id)
driver_id               UUID REFERENCES drivers(id)
calculated_floor        DECIMAL(8,2)
recommended_fare        DECIMAL(8,2)
driver_earnings         DECIMAL(8,2)
floor_enforced          BOOLEAN
platform_absorbed       DECIMAL(8,2) DEFAULT 0.00
floor_inputs_snapshot   JSONB
created_at              TIMESTAMP
```

**API Endpoints — Earnings Protection Service:**
```
GET  /earnings/floor/:trip_estimate     — calculate floor for a given trip before matching
GET  /drivers/me/earnings/shift-summary — real-time shift earnings rate
GET  /drivers/me/earnings/forecast      — projected earnings for current zone and time
GET  /admin/earnings/floor-breaches     — trips where floor was enforced (admin)
GET  /admin/earnings/absorption-report  — platform cost from floor enforcement (admin)
```

---

## 19. Safety Command Center

> The Safety Command Center is BidiRide's operational nerve center for real-time safety monitoring. It is not a passive log — it is an active, always-on command environment for the safety team.

### 19.1 Overview

The Safety Command Center consolidates all safety intelligence into a single operational interface. Safety admins monitor every active trip, respond to incidents, manage emergency dispatch, and review high-risk accounts — all from one screen.

This replaces and expands A-12 (Safety and Incidents Dashboard) into a full command environment.

---

### 19.2 Admin Screen: A-25 — Safety Command Center (Main)

**Layout:** Split-panel command interface. Left: live trip list. Right: map with active trip overlays.

**Left Panel — Live Trip Monitor:**
- All active trips listed in real time (WebSocket-driven)
- Risk color-coding per trip:
  - Green: Normal
  - Yellow: Soft anomaly (minor deviation, extended duration)
  - Orange: Moderate risk (significant deviation, no rider response)
  - Red: Hard anomaly or SOS active
- Columns: Trip ID, Driver name, Rider first name, Pickup zone, Destination zone, Duration, Risk level, AI flags
- Click any trip → opens Trip Safety Detail panel (inline or A-09)

**Right Panel — Live Safety Map:**
- All active trips shown as route lines (color-coded by risk level)
- Driver and rider positions on map
- SOS events shown as pulsing red pins
- Filter: by risk level, by zone, by duration
- Click any pin → opens driver/rider quick profile + trip detail

**Top Bar — Command Metrics:**
- Active trips count
- Active SOS events (red badge — always visible)
- Trips under AI monitoring (yellow/orange)
- Safety admins currently online
- Average trip anomaly rate (today)

---

### 19.3 Real-Time Anomaly Detection Rules

The AI Safety Monitor evaluates every active trip against the following rules every 30 seconds:

| Rule | Threshold | Risk Level | Action |
|---|---|---|---|
| Route deviation | > 0.5 miles off expected route | Yellow | Log + monitor |
| Extended deviation | > 1.5 miles off route for > 3 min | Orange | Admin alerted |
| Unexpected stop | Stopped > 3 min in non-destination zone | Yellow | Log + monitor |
| Extended stop | Stopped > 8 min in non-destination zone | Orange | Admin alerted + rider checked |
| Trip duration overrun | > 60% over estimated duration | Yellow | Log |
| Severe duration overrun | > 120% over estimated duration | Orange | Admin alerted |
| GPS signal lost | Driver GPS offline > 60 seconds | Orange | Admin alerted |
| Extended GPS loss | Driver GPS offline > 3 minutes | Red | Emergency protocol considered |
| SOS activated | Either party pressed SOS | Red | Immediate P0 alert to all online safety admins |
| Speed anomaly | Vehicle speed > 90 mph sustained | Orange | Admin alerted |
| Nighttime isolated stop | Stop in low-population zone 11pm–5am | Orange | Admin alerted + rider checked |

**Anomaly Response Flow:**
```
Yellow anomaly detected:
    → Logged in trip_events table
    → Visible on Safety Command Center map (color change)
    → No immediate admin action required unless it escalates

Orange anomaly detected:
    → Admin receives in-dashboard alert (audio ping + notification card)
    → Admin reviews trip on map
    → Admin may: message rider, message driver, escalate to Red, or dismiss as benign
    → All admin actions logged with timestamp

Red anomaly / SOS activated:
    → All online safety admins receive immediate audio alert
    → Trip moves to top of incident queue
    → Admin assigned within 2 minutes (SLA enforced — dashboard shows timer)
    → Escalation to emergency dispatch if no admin response in 3 minutes
```

---

### 19.4 Admin Screen: A-26 — Emergency Dispatch Dashboard

**Purpose:** Manage active SOS events and coordinate emergency response.

**Elements:**
- Active SOS queue (sorted by time since activation, oldest first)
- Per-event card:
  - Rider or driver name + profile photo
  - Live GPS coordinates (updating in real time)
  - Trip ID and linked trip detail
  - Time since SOS activated
  - Trusted contacts notified (yes/no + count)
  - Actions taken so far
- Action buttons per event:
  - **Contact Rider** — in-app message or masked call
  - **Contact Driver** — in-app message or masked call
  - **Initiate 911 Call** — admin calls emergency services with GPS coordinates
  - **Dispatch Integration** — (Phase 2) direct API dispatch to local emergency services
  - **Suspend Both Accounts** — immediate hold pending investigation
  - **Mark Resolved** — requires resolution note before closing
- Resolved events log (last 24 hours)
- SLA timer: red if event unaddressed > 2 minutes

---

### 19.5 Driver Incident Management Workflow

```
Incident Source: Driver report, SOS, admin flag, AI anomaly

STEP 1 — Incident Created
    → safety_incidents record created (incident_type = driver-related)
    → Assigned to safety admin queue

STEP 2 — Admin Review (A-13 Incident Detail)
    → Review driver's full profile, rating history, prior incidents
    → Review trip route replay and AI anomaly flags
    → Review rider's report or statement (if applicable)

STEP 3 — Admin Action Options:
    → No action (log and close — benign)
    → Warning issued to driver (logged in profile)
    → Temporary suspension (24h, 72h, or indefinite — pending investigation)
    → Permanent deactivation (requires Platform Admin or Super Admin)
    → Escalation to law enforcement (extreme cases)

STEP 4 — Driver Notification:
    → Driver notified of action via push + email
    → Suspension: reason provided, appeal process explained
    → Permanent deactivation: reason provided, final earnings paid out

STEP 5 — Resolution:
    → Incident marked resolved with admin notes
    → Driver risk score updated
    → AI models updated with incident outcome data
```

---

### 19.6 Rider Incident Management Workflow

```
Incident Source: Rider SOS, driver report, AI anomaly, admin flag

STEP 1 — Incident Created
    → safety_incidents record created (incident_type = rider-related)
    → Assigned to safety admin queue

STEP 2 — Admin Review:
    → Review rider's profile, risk score, incident history
    → Review driver's report and rating for this trip
    → Review AI flags on this rider's account

STEP 3 — Admin Action Options:
    → No action (log and close)
    → Warning issued to rider
    → Elevated verification required (ID + selfie before next ride)
    → Temporary account suspension
    → Permanent ban
    → Block rider from being matched with specific driver (protective order)

STEP 4 — Rider Notification:
    → Rider notified via push + email
    → Suspension with reason and appeal process

STEP 5 — Resolution:
    → Incident closed with admin notes
    → Rider risk score updated
    → Driver informed of outcome (anonymized — no personal details shared)
```

---

### 19.7 Admin Screen: A-27 — High-Risk Trip Review Queue

**Purpose:** Surface trips that completed without SOS but were flagged by AI as elevated risk for post-trip review.

**Elements:**
- Queue of completed trips with unresolved AI flags
- Sorted by risk score (highest first)
- Per-row: trip ID, rider name, driver name, flag type, flag severity, trip date
- Click row → trip detail with route replay and AI flag explanation
- Admin action: Dismiss flag / Open incident / Request driver statement / Request rider statement
- Batch dismiss (for low-severity flags after review)

**Queue Population Rules:**
- Any completed trip with an Orange or Red anomaly flag that was not already escalated
- Any trip with a post-trip low rating (1–2 stars) from both parties
- Any trip where rider bid was accepted below recommended fare by > 30% (potential pressure indicator)
- Trips involving first-time riders matched with drivers who have any prior incident

**Database additions:**
```
safety_incidents table additions:
    anomaly_rules_triggered  JSONB     — list of rules that fired during this trip
    admin_assigned_at        TIMESTAMP — for SLA tracking
    sla_breached             BOOLEAN DEFAULT FALSE

trip_events table additions:
    risk_level    ENUM(green, yellow, orange, red) DEFAULT green
    reviewed_by   UUID REFERENCES admin_users(id) NULLABLE
```

**API Endpoints — Safety Command Center:**
```
GET  /admin/safety/command-center      — all active trips with risk levels (WebSocket)
GET  /admin/safety/sos/active          — active SOS events
POST /admin/safety/sos/:id/respond     — log admin response to SOS
POST /admin/safety/sos/:id/resolve     — resolve SOS incident
GET  /admin/safety/incidents/queue     — full incident queue (open + in-progress)
GET  /admin/safety/incidents/high-risk — high-risk completed trip review queue
POST /admin/safety/dispatch/:id        — initiate emergency dispatch for incident
GET  /admin/safety/metrics             — safety KPIs (SLA compliance, resolution times)
```

---

## 20. Reserved Future Platform APIs

> These API contracts are defined now to ensure BidiRide's architecture is built with future expansion in mind. No implementation is required in MVP. These are architectural reservations — placeholders that shape today's database schemas and service boundaries so future integration does not require breaking changes.

### 20.1 Autonomous Vehicle Support

**Purpose:** Enable BidiRide to dispatch and manage autonomous vehicles alongside human drivers as AV technology matures and regulatory approval is granted in New Jersey.

**Reserved API Namespace:** `/v1/av/`

```
POST /av/vehicles/register          — register an AV unit with fleet operator credentials
GET  /av/vehicles/:id/status        — vehicle operational status, battery, location
POST /av/vehicles/:id/dispatch      — assign AV to a trip (replaces driver accept flow)
PUT  /av/vehicles/:id/location      — AV GPS update stream (replaces driver GPS)
POST /av/vehicles/:id/trip/start    — AV confirms passenger aboard
POST /av/vehicles/:id/trip/complete — AV confirms trip end
POST /av/vehicles/:id/incident      — AV reports in-trip anomaly
GET  /av/fleet/:operator_id         — all vehicles for a fleet operator
POST /av/fleet/:operator_id/recall  — return all vehicles to depot
```

**Database reservation:**
```
autonomous_vehicles:
    id                  UUID PRIMARY KEY
    fleet_operator_id   UUID
    vehicle_type        ENUM(passenger, delivery, freight)
    make_model          VARCHAR
    vin                 VARCHAR UNIQUE
    regulatory_status   ENUM(pending, approved, suspended)
    operational_status  ENUM(available, on_trip, charging, maintenance, offline)
    current_lat         DECIMAL(9,6)
    current_lng         DECIMAL(9,6)
    battery_level       DECIMAL(5,2) NULLABLE
    registered_at       TIMESTAMP
```

**Architecture Note:** The `drivers` table will gain a nullable `av_vehicle_id` field in a future migration. The trip lifecycle workflow routes to AV dispatch when no human driver is matched and an AV is available in the market.

---

### 20.2 Autonomous Delivery Support

**Purpose:** Enable BidiRide Delivery (Phase 3) to dispatch autonomous delivery robots or vehicles for last-mile package delivery.

**Reserved API Namespace:** `/v1/delivery/av/`

```
POST /delivery/av/units/register        — register delivery unit
GET  /delivery/av/units/:id/status      — unit status and location
POST /delivery/av/units/:id/dispatch    — assign to delivery order
POST /delivery/av/units/:id/pickup-confirm   — unit has collected package
POST /delivery/av/units/:id/dropoff-confirm  — delivery complete
GET  /delivery/av/coverage/:zip_code    — is AV delivery available in this zone?
```

**Dependency:** Requires BidiRide Delivery product (Phase 3) to be built before activation. API contract is reserved to avoid namespace conflicts.

---

### 20.3 Autonomous Freight Support

**Purpose:** Enable BidiRide Freight (Phase 4) to integrate with autonomous long-haul trucking operators for freight matching and dispatch.

**Reserved API Namespace:** `/v1/freight/av/`

```
POST /freight/av/trucks/register         — register autonomous truck with freight operator
GET  /freight/av/trucks/:id/status       — truck location, cargo status, ETA
POST /freight/av/loads/:id/assign-truck  — assign autonomous truck to freight load
GET  /freight/av/loads/:id/telemetry     — real-time cargo telemetry during haul
POST /freight/av/loads/:id/delivered     — delivery confirmation + proof of delivery
POST /freight/av/incidents/:id           — in-transit incident report
```

**Dependency:** Requires BidiRide Freight product (Phase 4) to be built before activation.

---

### 20.4 Fleet AI Orchestration

**Purpose:** When BidiRide operates mixed fleets (human drivers + AV passenger vehicles + AV delivery units + AV freight trucks), the Fleet AI Orchestration layer coordinates all vehicle types through a single intelligence engine.

**Reserved API Namespace:** `/v1/fleet-ai/`

```
GET  /fleet-ai/status                   — full fleet status across all vehicle types and markets
POST /fleet-ai/optimize/:market_id      — trigger fleet rebalancing for a market
GET  /fleet-ai/demand-coverage          — supply vs. demand gap across all vehicle types
POST /fleet-ai/priority/:vehicle_type   — set dispatch priority for a vehicle type in a market
GET  /fleet-ai/efficiency-report        — fleet utilization, empty mile rates, earnings per vehicle
POST /fleet-ai/emergency-recall/:zone   — emergency pull-back of all AVs in a zone
GET  /fleet-ai/regulatory/status        — AV regulatory approval status by market
```

**Architecture Principle:** Fleet AI Orchestration does not replace the existing Marketplace Intelligence Engine — it sits above it. The Marketplace Intelligence Engine optimizes human driver matching. Fleet AI Orchestration allocates across human and AV fleets before the Marketplace Engine receives demand signals.

**Data contracts:** All four AV API namespaces share a common telemetry schema so monitoring, safety, and audit tools built for human drivers apply to AV fleets with minimal modification.

---

## Document Status

**Version:** 1.1 Draft
**Sections complete:** 20 of 20
**Added in v1.1:** Sections 17–20 (Airport Queue Intelligence, AI Driver Earnings Protection Engine, Safety Command Center, Reserved Future Platform APIs)
**Next step:** Founder review and approval
**Upon approval:** Proceed to `/design/03-ui-ux-system.md`

No code is written until this document is approved by Marq Brown.

---

*BidiRide Product Requirements Document — Confidential*
*Delaware LLC — All rights reserved*
