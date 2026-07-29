# Release Notes — Payment Integrity

**Release:** `9c3d769fd60e7fb15785813259aef31e54abb419`
**Branch:** `feature/production-readiness`
**Scope:** offer-trip (bid) payment path — authorization, capture, booking,
failure detection and recovery

---

## Summary

Seven defects in the offer-trip payment path, found by audit and fixed in
sequence. Each was independently verified before the next began.

| | Defect | Fix |
| --- | --- | --- |
| **F1** | Counter-offer notifications addressed by `Driver.id` where `User.id` was required — the wrong party was notified | Address by `User.id` |
| **F2** | Every replica ran the bid-expiry sweep on the same 30s cadence, duplicating expiry, void, notification and telemetry; a bid transitioning mid-sweep was silently overwritten | Redis lease plus conditional writes |
| **F4** | Bid authorization created a Stripe PaymentIntent with **no idempotency key**. A retry after a timeout created a **second live hold on the rider's card**, unreachable and never voided | One `bidAttemptId` per attempt, minted before anything else, used as the key |
| **F5** | Offer trips settled by capture, so `chargeTrip`'s fare guards never applied — **any amount up to the authorized standard fare could be captured** | Cent-exact validation against the trip's canonical fare, before Stripe |
| **F3a** | A capture that did not land left no durable trace. `fetch` resolves for 4xx/5xx, so trip-service discarded rejections; a failed capture writes no Payment row, so the admin "failed payments" surface was structurally blind to it | Two distinct durable event types plus a stable error contract |
| **F3b-1** | Nothing acted on those events; no Stripe read path existed anywhere in the repository | Durable worklist drained by a leader-locked worker that asks Stripe what actually happened |
| **F3b-2a** | Three paths booked the same money three different ways; the webhook wrote **no ledger entry at all**; Payment and ledger were not atomic | One shared atomic booking path, plus healing for historical gaps |

## Architectural improvements

**One booking path.** `bookCapturedPayment` is now the single way an offer-trip
capture becomes a booked payment, used by capture, the webhook and recovery.
The Payment row and both ledger entries commit in one transaction, and ledger
errors propagate instead of being swallowed by a fire-and-forget `.catch(() =>
{})`.

**Database-enforced idempotency.** `Payment.tripId` is unique and
`FinancialLedger` is unique on `(correlationId, accountId, direction)`. Every
offer-trip booking shares the correlation `capture:{tripId}` — deliberately not
varied per source, because a per-source correlation would slip past the
constraint and book a second debit and credit for the same money.

**Known failure separated from uncertain outcome.** `payment_capture_failed`
means Stripe refused and no money moved. `payment_capture_outcome_unknown`
means we cannot tell. Two event types rather than a metadata flag, so
Operations triages by type. Classification fails closed: anything not
recognised as a definitive refusal is treated as unknown.

**Nothing invents an outcome.** Money is booked only when Stripe reports
`succeeded`, for an amount F5 confirms is canonical. Every ambiguous branch
lands in `needs_admin`. No admin action — and no code path — can declare a
payment succeeded or failed.

**Extracted, reused validation.** F5 lives in one function used by capture, the
webhook and recovery, rather than three copies of the rule that decides how
much may move.

## Database changes

Two additive migrations. Nothing dropped, renamed or backfilled. `PaymentStatus`,
`Payment`, `financial_ledger`, `trips`, `bids` and `trip_events` are unchanged.

| Migration | Change |
| --- | --- |
| `20260728120000_capture_recovery_worklist` | New `capture_recovery` table, unique on `trip_id`, two lookup indexes |
| `20260728180000_capture_recovery_booking` | Five nullable columns: `last_stripe_status`, `claim_token`, `claimed_at`, `booking_status`, `booked_at` |

Verified applying from a clean database and from the pre-release schema. Old
code runs unchanged against the new schema, which is why migrations go first and
stay applied during a rollback.

## Deployment requirements

**Strict order: trip-service first, fully drained, then payment-service.
Rollback reversed.**

F4 introduced a required cross-service contract. New trip-service against old
payment-service is safe — the unknown field is stripped and behaviour degrades
to pre-F4. Old trip-service against new payment-service **fails every bid
authorization** with `400 BID_ATTEMPT_ID_REQUIRED`. During a rolling deploy both
versions serve at once, so a mixed fleet is an intermittent partial outage.

`infrastructure/DEPLOYMENT_RUNBOOK.md` Phase 9 deploys all services in a
parallel loop and **must not be used for this release**. Follow
`docs/payment-integrity-deployment-runbook.md`.

## Operational changes

New admin surfaces under `/admin/finance`:

```
GET  capture-failures?outcome=failed|unknown
GET  capture-recovery                     filter by status, resolution, tripId, paymentIntentId, date
GET  capture-recovery/metrics
GET  capture-recovery/:id                 item + trip + full history
POST capture-recovery/:id/recheck         re-ask Stripe; read-only
POST capture-recovery/:id/close           requires a reason; writes AuditLog
```

A background worker in payment-service polls every 60s under a Redis leader
lock. It reads Stripe and never writes to it.

**Expect `needsAdminCount` to grow.** `requires_capture` — a live hold whose
capture never landed — is routed to a human by design, because this release may
not capture. That queue's size is the measurement that decides whether F3b-2b
is worth building.

## Known limitations

- **No metrics or alerting in payment-service.** Every signal is an on-demand
  query or a log scan. The release is watchable, not monitored.
- No scheduler-health endpoint; health is inferred from logs and from
  `oldestUnresolvedAgeSeconds`.
- Duplicate-booking and ledger-imbalance detection are manual SQL.
- Recovery cannot capture. `requires_capture` items wait for a human.

## Deferred work

- **F3b-2b** — recovery capture execution. Gated on measured `awaiting_capture`
  volume and explicit Founder approval of new Stripe-write behaviour.
- **Driver payout before capture settlement.** A completed bid trip credits the
  driver's wallet regardless of whether capture landed. Pre-existing and
  unchanged by this release; deserves its own checkpoint.
- **`fare_integrity_driver_payout_hold` is advisory only** — written, read
  nowhere.
- **Standard-ride `chargeRiderForTrip`** has the same silent-failure shape F3a
  fixed on the offer-trip side.
- Void path has no idempotency key.
- Offer-trip capture happens at **bid acceptance**, before the ride is driven.
  This release makes the consequences visible; it does not change where capture
  sits.

## Rollback notes

Roll back **payment-service first**, drained fully, then trip-service. Never the
reverse — old trip-service against new payment-service is the broken pairing.

- **Migrations stay applied.** Reverting needs RDS point-in-time restore and
  downtime, and would destroy recovery evidence for no benefit.
- **Do not delete `CaptureRecovery` rows.** They are the only record of which
  captures are unresolved. Deleting them does not undo a payment problem; it
  removes the evidence of one.
- **Do not hand-edit `Payment` or `FinancialLedger`.** Both are protected by
  constraints the booking path depends on; an edited row can make a legitimate
  booking fail, or succeed twice. Corrections go through the admin surfaces.
- An unresolved recovery is a question waiting for a human, not debris.
