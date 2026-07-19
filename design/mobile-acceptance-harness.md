# Mobile Simulator GPS & End-to-End Acceptance Harness

**Status:** Development/acceptance tooling. Not a production change. No production ride,
payment, pricing, dispatch, safety, or GPS business rule was modified. Uncommitted —
awaiting Founder approval.

**Demonstrated:** a complete BidiRide ride driven entirely through the visible Rider and
Driver simulator apps + Founder portal. Round 1 on 2026-07-12/13 (trip `cae08a68`, $10.97);
Round 2 re-test after the six contained fixes on 2026-07-13 (trip
`fdd836f9-a38a-4a83-94d0-ed9b58d2108b`, $9.97). No backend API substituted for any
rider/driver state-transition action; backend queries were used only to verify the records
the apps produced.

---

## 1. Root-cause analysis — why the prior visible ride stalled at "accepted"

The server transitions are permissive (verified against current code):

| Action | Endpoint | Server proximity gate | Body | Required prior state |
|---|---|---|---|---|
| Arrived | `POST /trips/:id/arrived` | none | `{}` | `accepted` |
| Start | `POST /trips/:id/start` | none | `{}` | `driver_arrived` |
| End | `POST /trips/:id/end` | **≤ 0.2 mi** (`DROPOFF_LOCK_RADIUS_MILES`, `trips.service.ts:35`, haversine `trips.service.ts:307-317`) | `{currentLat,currentLng}` (required, `dto.ts:32-38`) | `in_progress` |

Because Arrived/Start need no GPS and no body, the stall was **not** a pricing, proximity,
or authorization problem. It was the **client/socket layer**: the driver app advances screens
on socket events (`trip:accepted` → NavigatingToPickup). Maestro's XCUITest runner pushes
Expo Go to Springboard; a suspended app's socket dies and does not reconnect promptly, so the
accept event never advances the UI and the **"I've Arrived" button never renders**.

**Fixes that made it reliable:**
- Every Maestro flow starts with `launchApp: { stopApp: false }` — re-foregrounds Expo Go
  **without a JS reload**, preserving the live socket.
- Rider and driver run on **separate simulators**, so automating one never suspends the other.
- GPS is set **before** foregrounding the target screen (the app reads GPS on mount / via
  `watchPositionAsync`); a stale GPS permission requires a cold restart to (re)start the watch.

## 1a. Round 2 — the six contained fixes (all applied, all verified)

| Fix | Problem | Change | Scope guarded |
|---|---|---|---|
| **1** | Vehicle scrolled off-screen; map remounted per GPS update | `useFollowCamera` hook + `RecenterButton` on the four active-trip maps: smooth `animateCamera`, 12 m jitter floor, ~900 ms throttle, newest coord, safe missing heading (no north-snap), no reset on GPS loss, pause on user pan, Recenter resumes | No streaming/proximity/state/backend change |
| **2** | Client checked `TRIP_INVALID_TRANSITION`; server emits `TRIP_INVALID_STATE` | `utils/tripErrors.ts` recognises the real code; wired into `NavigatingToPickup` (arrived) + `InTripScreen` (start); unit test added | Server contract unchanged |
| **3** | Rating stars point-tapped by coordinate | Stable `testID`/a11y on rider stars 1–5 & Submit; driver stars 1–5, safety toggle, Submit, Skip; Maestro flows select by id | No behaviour/visual change |
| **4** | Scripts had machine-specific absolute paths | `scripts/lib/env.mjs` resolves repo root dynamically; Playwright via project require; `.env.founder.local` read relative to root; output → gitignored `.dev-artifacts/`; password never printed/committed | Works from any clone dir |
| **5** | Risk of blanket-killing node/Expo/Metro | `scripts/lib/proc.mjs` kills a process **only** if its cwd is inside the repo; PostgreSQL/Redis ports protected; foreign collisions **stop** startup instead of killing; unit tests | Never touches unrelated procs/PG/Redis |
| **6** | Fixed sleep before End sent a stale fix | `gps-harness await-at-dropoff` polls the backend-ingested `driver:{userId}:location` until ≤ radius, bounded timeout + diagnostic; never calls the End endpoint | Server 0.2 mi enforcement unchanged |

## 2. Simulator architecture
- **iPhone 17 Pro** `4F7452E6-AF4E-43F9-B030-985107482995` → **driver** app.
- **iPhone 17** `2281812B-976E-41E0-A85D-036DEFA4418F` → **rider** app.
- Both run Expo Go (`host.exp.Exponent`) loading the app bundles from the two Metros.
- Apps reach the backend through the dev-proxy (`:8080`, mirrors prod ALB routing).
- Driver location: `watchPositionAsync` → socket `driver:location` (`source:'gps'`) + 60s
  cached heartbeat (`source:'heartbeat'`). The GPS stream only emits when the fix **changes**
  (distance filter), so a parked driver's key expires (TTL) until it moves or the heartbeat fires.
- Rider observes the driver via the `driver:location` socket event → map marker.

## 2a. Follow camera & recenter (Fix 1)
`useFollowCamera(mapRef)` (identical in both apps) returns `{ following, follow, onUserGesture,
recenter }`:
- `follow(coord, heading)` stores the newest coord and animates the camera to it **only** while
  following and only if the pure `shouldAnimateCamera` gate passes (first fix centres immediately;
  otherwise require ≥ 12 m move and ≥ 900 ms since the last animation). No remount; heading applied
  only when `>= 0`.
- `onUserGesture` (wired to `MapView.onPanDrag`) pauses following; `RecenterButton`
  (`testID="recenter-button"`, a11y "Recenter map on vehicle") renders while `!following`.
- `recenter()` re-enables following and jumps to the latest known coord.
Wired on driver `NavigatingToPickup` + `InTripScreen` and rider `TrackingScreen` (matched-driver
and active-trip). Unit-tested in `follow-camera.test.ts`.

## 3. GPS harness design — `scripts/sim/gps-harness.mjs`
Uses the official `xcrun simctl location` interface only (no GPX files, no app-code injection):
- `newark` — set both sims to downtown Newark (40.7357,-74.1724).
- `pickup  --trip <id>` — `set` driver at the trip's pickup (visible realism; Arrived has no gate).
- `drive   --trip <id>` — interpolate driver pickup→dropoff (live movement the rider sees).
- `dropoff --trip <id>` — `clear` + `set` the driver exactly at the dropoff.
- `await-at-dropoff --trip <id> [--radius 0.2] [--timeout 30]` — **Fix 6 readiness gate**: polls
  the backend-ingested `driver:{userId}:location`, computes haversine miles to the dropoff, returns
  only when ≤ radius (prints the confirmed distance), throws a diagnostic on timeout. It **never**
  calls the End endpoint — the visible Driver app performs the End tap.
- `coords  --trip <id>` — print resolved coordinates. `clear` — stop simulation on both sims.

Coordinates are read from the dev DB with a **read-only** SELECT.

**Note:** `simctl location` interpolates a straight line, not road-following — acceptable for a
harness. Because the GPS stream is change-triggered, drive the driver in real steps (or via
`drive`) so each leg emits; the final leg lands the coord the readiness gate confirms.

## 4. Startup / shutdown

**One command (exact, portable — works from any clone directory):**
```
node scripts/dev/stack-up.mjs
```
Detects foreign port collisions and **stops with a message** rather than killing them; otherwise
brings up dev-proxy → 10 backend services (incl. ai-service in its default shadow posture) →
admin portal → both Expo Metros → sets both sims to Newark → loads Expo Go on each → prints a
readiness report. Logs: `$TMPDIR/bidride-dev/<name>.log` (or `$BIDRIDE_LOG_DIR`).

**Post-login readiness (driver socket/heartbeat exists only after the driver goes Online):**
```
node scripts/dev/readiness.mjs
```

**Post-demo readiness (re-foreground both apps + confirm connections after the final step):**
```
node scripts/dev/post-demo.mjs
```
Idempotent, dev-only: `simctl openurl` re-foregrounds each app (stopApp:false semantics —
never a kill), confirms both Expo Go processes are running AND connected to the dev-proxy,
confirms there is no active trip, prints a readiness summary, and exits non-zero (reporting the
specific app) if either cannot be foregrounded/connected. It changes no product lifecycle,
adds no background execution, and does not restart the stack. Pure logic unit-tested in
`scripts/dev/__tests__/post-demo.test.mjs`.

**Shutdown (repo-scoped; leaves PostgreSQL/Redis and the simulators):**
```
node scripts/dev/stack-down.mjs
```
Cleanup terminates a process **only if its working directory is inside this repo** — it never
blanket-kills node, never touches unrelated user processes, and PostgreSQL (5432) / Redis (6379)
are protected ports. Selection logic is unit-tested (`scripts/dev/__tests__/process-select.test.mjs`).
Orphaned, port-less service processes (e.g. from a killed startup) are outside the port-scoped
sweep and are reaped by matching repo cwd / `@bidride/*` — still never PG/Redis.

## 5. Manual fallback
If any tap cannot be automated, perform it on the visible sim and continue:
- **Driver login:** phone → Continue → OTP (dev OTP printed in `auth.log`) → Verify.
- **Driver Online:** tap the Offline→Online toggle (Driver Hub, top-left).
- **Rider destination:** tap the "Where to?" field → tap a RECENT row → wait for the fare →
  tap "Request …".
- **Driver accept:** tap "Accept · $…" within the countdown (redispatch gives repeat windows).
- **Arrived / Start / End:** the three large buttons on the driver screens; run
  `gps-harness await-at-dropoff` before End. **Ratings:** tap the 5th star, then "Submit Rating".

## 6. Accessibility / automation changes (behaviour-preserving)
Only stable test hooks were added — no interaction behaviour or visual design changed:
- Rider `AddressAutocomplete.tsx` — `testID`+`accessibilityLabel` on recent/suggestion rows
  (`dest-recent-N` / `dest-suggestion-N`); optional `triggerTestID`. `RiderBookingSheet.tsx`
  passes `triggerTestID="dest-field"`.
- Rider `TripCompleteScreen.tsx` — `rate-star-N`, `rate-submit`.
- Driver `rate-rider.tsx` — `rate-star-N`, `rate-safety-toggle`, `rate-submit`, `rate-skip`.
Driver action buttons (Accept/Arrived/Start/End) + "Submit Rating" match by stable text.
Both apps `tsc --noEmit`: exit 0.

## 7. Round 2 full visible demonstration (trip `fdd836f9-a38a-4a83-94d0-ed9b58d2108b`)
Newark 171 Market St → Jersey City 727 NJ-440. Driver: Jordan, Silver Toyota Camry.
Screenshots per step under `.dev-artifacts/retest/` (+ portal captures in `.dev-artifacts/`).

| # | Step | Result |
|---|---|---|
| 1 | Stack via `stack-up.mjs` | 14/14 components green |
| 2–3 | Driver login (visible OTP) + Online | Redis location key + `drivers:geo` member |
| 4 | Rider Request (by `testID`: dest-field → dest-recent-0 → Request) | trip `searching` |
| 5 | Driver Accept (`Accept · $7.98`; take-home first & largest, Rider **verified** badge only) | `accepted` |
| 11 | **Camera follows** — driver GPS stepped across 3 positions | vehicle stays centred each time |
| 12–14 | **Pan → Recenter → resume** | pan hides vehicle + shows Recenter; tap re-centres, hides button |
| 8–9 | Arrived (exercises Fix 2 path) + Start | `driver_arrived` → `in_progress` |
| — | In-trip follow (driver + rider `TrackingScreen`) | vehicle centred while moving |
| 15 | `await-at-dropoff` readiness gate (Fix 6) | "0.000 mi from dropoff (≤ 0.2) — safe to End" |
| 16 | End Trip (visible tap) | `completed` **first try** (no stale-fix rejection), fare $9.97 |
| 17 | Payment | **1** row `succeeded`, $9.97, real PI, refund $0 |
| 18 | Ratings (by `testID`) | rider→driver **5**, driver→rider **5**, `rider_flagged=f` |
| 19–20 | AI shadow + Founder portal | see §8 |

## 8. Financial reconciliation & AI observation
**Financials (all reconcile):** AI fare $9.97 = final $9.97 = Stripe charge $9.97
(**1** payment row, status `succeeded`, **1** PaymentIntent `pi_3TsjKK…` — no duplicates).
Driver take-home $7.98 = wallet credit $7.98 ("Trip earning (2h hold)"). `earnings_floor_met=t`
(fare above floor, $0 supplement). `is_airport_trip=false` → no airport premium. Standard
(non-bid). Take-home shown first and largest on the driver screens throughout.

**AI (advisory only):** shadow `fare-adjustment` inference recorded in `ai_pricing_logs`
(`ai_adjustment 0.00`, served fare = raw fare, `model_version fallback-v1`). No autonomous
pricing/dispatch activation. Founder portal **Intelligence** surface is explicitly read-only
("adopting a recommendation records your decision, it never executes a change"); the inbox shows
zone recommendations with evidence (n, confidence, status **proposed**), including the ride's
pickup zone `2261:-3373`.

**Trust/integrity:** driver Online (heartbeat) when matched → no offline-driver exposure; only the
one live driver was eligible (a stale phantom `drivers:geo` member from a prior session was cleaned
— dev hygiene, no product change); End 0.2 mi gate proven intact via the readiness gate; no
proximity rule weakened; Rider shown the "verified" **badge label only** (no numeric trust score).

## 9. Regression results (Round 2)
- driver-app `tsc` exit 0 · rider-app `tsc` exit 0
- driver-app jest **30/30** (incl. `follow-camera`, `trip-errors`) · rider-app jest **55/55**
- harness `process-select` **4/4**
- trip-service **160/160** · payment-service **77/77** · ai-service **312/312**
- Maestro: all 8 committed flows executed live during the demo (online, request, accept, arrived,
  start, end, rider-rate, driver-rate)

## 10. Known limitations
- `simctl location` is straight-line, not road-following (fine for a demo).
- The GPS stream is change-triggered; a parked driver's Redis key expires until it moves/heartbeats
  — the readiness gate accounts for this by confirming the last ingested fix.
- Driver take-home Hub card refresh after completion not re-verified this run.
- Google Directions API still disabled → rider route polyline/ETA dormant (Founder infra item).

## 11. Working-tree file inventory (uncommitted)
**Modified (8):** `.gitignore`; driver `app/rate-rider.tsx`, `src/screens/InTripScreen.tsx`,
`src/screens/NavigatingToPickup.tsx`; rider `src/components/AddressAutocomplete.tsx`,
`src/components/RiderBookingSheet.tsx`, `src/screens/TrackingScreen.tsx`,
`src/screens/TripCompleteScreen.tsx`.
**New app code:** driver `src/hooks/useFollowCamera.ts`, `src/components/RecenterButton.tsx`,
`src/utils/tripErrors.ts`, `src/__tests__/follow-camera.test.ts`, `src/__tests__/trip-errors.test.ts`;
rider `src/hooks/useFollowCamera.ts`, `src/components/RecenterButton.tsx`.
**New harness:** `scripts/lib/{env,proc}.mjs`; `scripts/dev/{stack-up,stack-down,readiness,runtime,post-demo}.mjs`,
`scripts/dev/__tests__/{process-select,post-demo}.test.mjs`; `scripts/sim/{gps-harness,portal-capture}.mjs`,
`scripts/sim/maestro/*.yaml` (8 flows). **Docs:** this file.

## 12. Rollback plan
All harness code is additive under `scripts/lib/`, `scripts/dev/`, `scripts/sim/` — deleting those
directories removes it with zero product impact. New app files (`useFollowCamera.ts`,
`RecenterButton.tsx`, `tripErrors.ts`, the two test files) are self-contained; deleting them and
reverting the eight modified files restores prior behaviour exactly (the modified files only add a
follow-camera hook usage, the corrected error-code check, and `testID`/a11y attributes). The
`.gitignore` addition only ignores runtime artifacts. Nothing is committed, pushed, or deployed.
