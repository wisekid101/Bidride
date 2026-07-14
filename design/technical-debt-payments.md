# Technical Debt Register — Payments & Marketplace Integrity

Documented 2026-07-10 during the Offer Fare Integrity Hotfix (`e225720`). These are
**pre-existing** risks deliberately excluded from that hotfix's scope.

> **STATUS: ALL FOUR ITEMS ARE NOT FIXED.** This register documents them for
> scheduling; no code change accompanies this document. None are
believed exploitable for incorrect money movement today because of the canonical-fare
guards, but each narrows a defense layer and should be scheduled.

---

## 1. Counter-accept claim-locking race

- **Risk:** `riderAcceptCounter` (trip-service `bids.service.ts`) lacks the Redis NX
  claim lock that `driverAcceptBid` and `driverCounterBid` both use. Its status check
  and subsequent plain `update` calls are a TOCTOU window.
- **Trigger condition:** two concurrent accept-counter requests for the same bid
  (rider double-tap, client retry after timeout, two devices).
- **Potential impact:** both calls pass validation and both invoke
  `captureStripeHold`. Stripe's capture idempotency prevents a double charge, and the
  payments-row unique constraints plus the first-booking ledger gate (added by the
  hotfix) prevent double bookkeeping — the residual impact is duplicated
  notifications/trip events and wasted work, not wrong money.
- **Current mitigation:** Stripe capture idempotency key; `payments.tripId` /
  `stripePaymentIntentId` unique constraints; ledger writes gated to first booking.
- **Recommended follow-up:** add the same `SET NX` claim key used by
  `driverAcceptBid`; convert the trip/bid updates to status-conditioned `updateMany`
  with row-count checks.
- **Priority:** Medium.

## 2. Cancellation-time vs sweep-time hold void

- **Risk:** cancelling a bid trip does not void the Stripe authorization hold at
  cancel time; the hold is voided only when the bid-expiry sweep runs.
- **Trigger condition:** rider cancels a bid trip while the bid is pending
  (observed live 2026-07-10: hold stayed `requires_capture` for ~60–90 s).
- **Potential impact:** the rider's card retains an authorization hold for up to the
  bid TTL + sweep interval after cancellation. No charge occurs, but held funds are
  temporarily unavailable and support may field "why is there a hold" contacts.
- **Current mitigation:** the expiry sweep reliably voids within ~90 s; holds are
  small (standard-fare-sized).
- **Recommended follow-up:** `cancelTrip` should resolve any pending bid for the trip
  (mark withdrawn + `voidStripeHold`) inline.
- **Priority:** Medium-low.

## 3. Internal service-key validation

- **Risk:** `payments/internal/*` endpoints (authorize, capture, void, charge-trip,
  credit-wallet) read but never validate the `x-internal-key` header. Protection is
  VPC unreachability plus rate limiting only.
- **Trigger condition:** any network-boundary misconfiguration (ALB route added, VPC
  peering, SSRF from another internal service) exposing port 3007.
- **Potential impact:** arbitrary charge/capture/void/credit calls. The canonical-fare
  guard limits charge-trip abuse (amounts must match the trip), but `credit-wallet`
  and `void` have no equivalent guard.
- **Current mitigation:** not exposed via public ALB (per infrastructure design);
  throttling; charge-path canonical guard.
- **Recommended follow-up:** validate `INTERNAL_SERVICE_KEY` in a guard on the
  internal controller (all services already send the header); rotateable secret.
- **Priority:** High (cheap fix, large blast radius if the network assumption fails).

## 4. Refund available-balance validation

- **Risk:** `issueRefund` performs no local check that a (partial) refund does not
  exceed the remaining captured balance; it relies entirely on Stripe rejecting
  over-refunds.
- **Trigger condition:** admin issues overlapping partial refunds, or a refund is
  retried after a timeout whose first attempt actually succeeded.
- **Potential impact:** Stripe rejects true over-refunds, so worst case is confusing
  errors and `refund_amount` drift between our DB and Stripe rather than money loss —
  but reconciliation noise is itself a trust cost.
- **Current mitigation:** Stripe-side enforcement; `payment_reconciliation` records.
  Note: offer-ride refunds only became *possible* with the hotfix (captures now book
  payments rows), so this path sees new traffic.
- **Recommended follow-up:** track cumulative `refund_amount` against `amount` in the
  payments row inside a transaction before calling Stripe; idempotency key per refund
  request.
- **Priority:** Medium.

---

*Related earlier register: reliability deferrals (drivers:geo orphan reaper,
driver:location rate limiting, KEYS→GEOSEARCH matcher migration, backgrounded-driver
eligibility, client/server airport-radius CI lockstep) recorded 2026-07-10 in the
Mobility Trust & Reliability Founder Demo.*
