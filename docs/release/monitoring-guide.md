# Monitoring Guide — Payment Integrity

What to watch after the payment-integrity release, what each signal means, what
is normal, and what needs a human.

> **This release is manually watched.** payment-service has no metrics
> instrumentation and no alerting — every signal below is an on-demand admin
> query or a log scan. Plan operator time rather than expecting a page.
> The gaps are listed at the end.

**Cadence:** every few hours for the first day, daily for the first three days,
then twice weekly through the observation window.

---

## Capture failures

**Where:** `GET /admin/finance/capture-failures?outcome=failed`
**Event:** `payment_capture_failed` on the trip

**Means:** Stripe **definitively refused** a capture — a declined card, a
malformed request, an auth or rate-limit rejection. **No money moved.** The
trip needs a fresh settlement decision.

**Normal:** a low, steady trickle. Cards get declined; that is ordinary.

**Investigate when:** the rate rises materially above the recorded baseline, or
several share a `stripeErrorType` that is not `StripeCardError` — a burst of
`StripeInvalidRequestError` means we are sending something wrong, not that
riders' cards are failing.

---

## Unknown capture outcomes

**Where:** `GET /admin/finance/capture-failures?outcome=unknown`
**Event:** `payment_capture_outcome_unknown`

**Means:** we **cannot tell** whether Stripe captured — a dropped connection, a
timeout, an unexpected PaymentIntent status. Money may or may not have moved.
Deliberately never recorded as a failure: calling it one invites either
double-charging the rider or writing off real revenue.

**Normal:** rarer than definitive failures, and each one should clear quickly —
the recovery worker picks it up within about a minute and asks Stripe.

**Investigate when:** the count rises and the recovery queue does *not* drain
behind it. An unknown outcome that stays unknown is the case that costs money.

---

## Unresolved recoveries

**Where:** `GET /admin/finance/capture-recovery/metrics` → `unresolvedCount`

**Means:** work items waiting for the recovery worker to ask Stripe what
happened.

**Normal:** small and draining. Items arrive, get resolved within a minute or
two, and leave.

**Investigate when:** the count climbs while `averageResolutionSeconds` stays
flat — work is arriving faster than it is being resolved. Usually the scheduler
is stalled, not the queue being busy.

---

## Oldest unresolved age

**Where:** metrics → `oldestUnresolvedAgeSeconds`

**Means:** how long the longest-waiting item has been waiting. **The single
best indicator of scheduler health**, because it rises whether the worker is
crashed, blocked on Redis, or quietly skipping.

**Normal:** seconds to a few minutes. The worker polls every 60s with a 30s
first-attempt delay, so a few minutes is expected. Backoff is 1m → 5m → 15m →
1h → 6h, so a genuinely retrying item can legitimately sit for hours.

**Investigate when:** it climbs steadily with no corresponding backoff
explanation, or exceeds an hour with `unresolvedCount` also rising.

---

## Awaiting-capture queue

**Where:** `GET /admin/finance/capture-recovery?resolution=awaiting_capture`

**Means:** Stripe reports `requires_capture` — the hold is live and the capture
never landed. This is a **known** fact, not an uncertainty. F3b-2a may not
capture, so it is handed to a human.

**Normal:** **expected to be non-zero and to grow.** This is the designed
destination for every capture that genuinely never landed.

**This number is the measurement that decides F3b-2b.** Record it at every
check. If it stays near zero, automatic recovery capture may never be worth
building. If it grows steadily, that is the case for F3b-2b-i.

**Investigate when:** any individual item approaches its `holdExpiresAt`. An
expired hold cannot be captured at all, and the trip becomes a manual
settlement problem.

---

## Needs-admin queue

**Where:** metrics → `needsAdminCount`

**Means:** every terminal state requiring a human — `awaiting_capture`,
`amount_mismatch`, `hold_expired`, `payment_intent_mismatch`,
`handle_unresolvable`, `lookup_rejected`, `attempts_exhausted`, `trip_missing`.

**Normal:** growth **from `awaiting_capture`** is expected and correct.

**Investigate when:** growth comes from anything else. In particular
`amount_mismatch` means Stripe captured an amount that is not the trip's
canonical fare, and `payment_intent_mismatch` means one trip has two
PaymentIntents. Both are integrity problems, not workload.

Break the queue down by resolution rather than watching the total:
`GET /admin/finance/capture-recovery?resolution=<name>`.

---

## Webhook failures

**Where:** payment-service logs — `Webhook booking failed`

**Means:** a webhook-confirmed capture could not be booked. New in this
release: the `payment_intent.succeeded` webhook now writes ledger entries,
which it previously did not do at all.

**Normal:** none.

**Investigate when:** any occurrence. It is best-effort by design so a webhook
is never failed on our bookkeeping, but every occurrence is logged and every
one means a booking did not happen when it should have.

---

## Scheduler activity

**Where:** payment-service logs — tick lines from `CaptureRecoveryScheduler`

**Means:** the recovery worker is running. One replica holds a Redis leader
lock (`payment:capture-recovery:lock`) and ticks every 60s.

**Normal:** `skipped_lock_held` appears routinely — that is another replica
correctly deferring. Ticks with `claimed: 0` on an empty worklist are normal.

**Investigate when:** `skipped_redis_unavailable` appears repeatedly. The
worker refuses to run unlocked, which is the correct choice, but it means
**recovery is stalled and silent**. Cross-check `oldestUnresolvedAgeSeconds`.

---

## Stripe authentication failures

**Where:** payment-service logs — `StripeAuthenticationError`,
`StripePermissionError`

**Means:** the API key is wrong, revoked, or for the wrong account.

**Normal:** none.

**Investigate when:** any occurrence. Captures stop working entirely, and
recovery classifies these as non-retryable, so affected items go straight to
`needs_admin`. This is an abort condition during a deployment window.

---

## Duplicate booking evidence

**Where:** the SQL in the Operations Verification Checklist, plus log scans for
P2002 on `payments_trip_id_key`

**Means:** an attempt to book the same trip twice. `Payment.tripId` is unique,
so the database *prevents* the duplicate — a P2002 is the constraint working.

**Normal:** zero duplicate rows. Occasional P2002 under genuine concurrency is
expected and handled — the booking path re-reads and reports `already_booked`.

**Investigate when:** any duplicate row exists (that would mean a constraint
problem, not a code problem), or P2002s arrive in bursts, which suggests
something retrying hard.

---

## Ledger integrity

**Where:** the imbalance query in the Operations Verification Checklist

**Means:** every captured offer trip must have exactly one rider debit and one
platform credit of equal amount under correlation `capture:{tripId}`.

**Normal:** zero imbalanced correlations, and never more or fewer than two
`rider_payment` entries per correlation.

**Investigate when:** any imbalance appears. This is the most serious signal in
this guide — it means money is recorded incorrectly, not merely late. Abort or
roll back and escalate.

---

## Known observability gaps

Honest inventory of what you cannot see:

1. **No metrics instrumentation in payment-service.** No counters, no
   Prometheus. Everything here is polled by hand.
2. **No scheduler-health endpoint.** `lastResult` exists in memory but is not
   exposed; health must be inferred from logs or from
   `oldestUnresolvedAgeSeconds`.
3. **No duplicate-booking counter.** Detection is a SQL query or a log scan.
4. **No ledger-imbalance signal.** Manual query only.
5. **No webhook failure counter.** Log scan only.
6. **No alerting anywhere.** Nothing pages anyone.

None of these blocks the release. Together they mean the release is *watchable*
but not *monitored*, and closing them is a small, well-scoped follow-up
checkpoint that would make the observation window considerably less manual.
