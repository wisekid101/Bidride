# Capture Recovery (F3b-1)

F3a made an uncertain capture visible by recording
`payment_capture_outcome_unknown`. That event is evidence and nothing more:
append-only, and nobody acts on it. F3b-1 turns each uncertainty into a known
fact by asking Stripe what actually happened, and gives Operations somewhere to
work.

This checkpoint is **read-only with respect to Stripe**. It reads, classifies
and records. Acting on the answer is F3b-2.

## Why a second table

`TripEvent` cannot be the worklist. It is append-only — which is exactly what
makes it good evidence — so it cannot express "unresolved, 2 attempts, retry
after 10:04", and marking an event resolved would destroy the property that
makes it worth keeping.

`CaptureRecovery` is the mutable counterpart, written in the **same transaction**
as the F3a event. An uncertainty recorded but never queued would be invisible to
recovery; a queued item with no evidence would have no audit trail. Neither can
happen.

It is deliberately **not** a `PaymentStatus` value. A capture that did not
confirm writes no `Payment` row at all, so the status would have nowhere to
live, and creating a `Payment` row to hold it would assert that a payment exists
when the entire point is that we do not know.

`trip_id` is unique, so "one open recovery per trip" is a database invariant
rather than a convention.

## Lifecycle

```
capture outcome uncertain (F3a)
            │  same transaction
            ▼
        unresolved ──────────────► nextAttemptAt backoff: 1m 5m 15m 1h 6h, cap 6
            │  paymentIntents.retrieve
   ┌────────┼─────────────┬──────────────────┐
   ▼        ▼             ▼                  ▼
succeeded  requires_    canceled      anything else /
   │       capture         │          lookup failed / hold expired
   ▼          ▼            ▼                  ▼
resolved_  needs_admin  resolved_        needs_admin
captured                not_captured
   │          │            │                  │
   └──────────┴────────────┴──────────────────┘
                     ▼
        TripEvent audit → closed (admin, with a reason)
```

Nothing in this machine invents an outcome. `resolved_captured` is written only
when Stripe reports `succeeded`; `resolved_not_captured` only when Stripe
reports the hold is gone. Every ambiguous branch — an unexpected status, a
rejected lookup, exhausted attempts, an expired hold, a PaymentIntent id that
cannot be found anywhere — lands in `needs_admin`. Unrecognised is never
resolved.

The PaymentIntent id is resolved from the work item, then the F3a event, then
`bid_submitted.metadata`, which is written durably inside the bid-creation
transaction. Redis holds it for 420 seconds and was never the authority, which
is why its lifecycle needs no change.

## Why `requires_capture` becomes `needs_admin`

`requires_capture` means the hold is still live and the capture never landed.
That is no longer uncertain — it is a known fact, and the obvious next step is
to capture.

F3b-1 may not capture. So rather than leave the item cycling on a worklist it
can never clear, it is handed to a human with the resolution `awaiting_capture`.
The classification is honest about what it is: the outcome is known, and the
action is deferred.

Expect this to be the most common terminal state in production — every capture
that genuinely never landed arrives here — until F3b-2 gives it an automated
path. The size of that queue in the first weeks is the best available estimate
of how much work F3b-2 will actually be doing.

## Why `paymentIntents.capture()` is prohibited here

Capture moves money. Recovery is, by construction, code that runs against
payments whose state we were unsure about — the worst possible place to get a
money-moving path wrong, and the hardest place to be confident in it before the
surrounding machinery has been observed in production.

Splitting the checkpoint means the worklist, the leader-locked worker, the
conditional claim, the Stripe classification, the audit trail and the admin
workflow can all be deployed, watched and corrected while the blast radius is
exactly zero. F3b-2 then adds one narrow branch to a system already proven.

The prohibition is enforced by tests, not just by intent: the recovery unit and
integration suites use a Stripe double whose `capture` throws if it is ever
called, and every test asserts it was not. The same suites assert that recovery
creates no `Payment` row and writes no ledger entry.

Admins are bound by the same rule. `close` can only ever reach `closed`. There
is no code path — automated or manual — by which anything other than Stripe's
own reported state produces a payment outcome.

## What F3b-2 owns

Automated recovery capture: re-issuing capture for `requires_capture` items
under the existing `capture_${paymentIntentId}` idempotency key, after
re-running F5 canonical validation and re-reading the PaymentIntent immediately
beforehand. Booking the `Payment` row and ledger pair for `resolved_captured`.
An admin resolve action beyond `close`. Handle retention policy. Blocking driver
payout on unsettled capture.

Two guards make the re-capture branch safe when it arrives, and both must hold:
the idempotency key is stable, and Stripe refuses capture on a PaymentIntent
that is not in `requires_capture`. Stripe expires idempotency keys after 24
hours, so past that window only the state guard remains — which is why F3b-2
must re-read the PaymentIntent immediately before every capture rather than
trusting the stored row.
