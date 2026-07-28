# Capture Failure Detection (F3a)

Offer trips settle by capturing a Stripe authorization hold. Before F3a, a
capture that did not land left no durable trace: `fetch` resolves for 4xx and
5xx, so trip-service discarded rejections, and payment-service let Stripe errors
escape as unclassified 500s. A failed capture writes no `Payment` row at all, so
the admin `failed-payments` surface — which queries `payment.status = 'failed'`
— was structurally blind to exactly the case it looked built for.

F3a is **detection only**. It makes failures visible, auditable and queryable.
It does not repair them.

## Two event types, deliberately

| Event type | Meaning |
| --- | --- |
| `payment_capture_failed` | Stripe definitively refused the capture. Money did **not** move. |
| `payment_capture_outcome_unknown` | The outcome cannot be determined. Money **may** have moved. |

### Why they are separate

They could have been one event type with an `outcome` field in metadata. They
are not, because the two demand different operational responses and operations
must be able to tell them apart at a glance — by event type alone, without
parsing JSON, in a list, a query filter or an alert rule.

A definitive failure is a closed book: no funds moved, and the trip needs a
fresh settlement decision. An unknown outcome is an open one: funds may be
sitting captured at Stripe, and someone must check the PaymentIntent before
doing anything else. Collapsing them into one type would mean every consumer
re-derives the distinction from a field, and any consumer that forgot would
treat "we don't know" as "it failed".

The admin surface derives `outcome` from the event **type**, never from
metadata, so corrupt or mismatched metadata cannot flip one into the other.

### Why an unknown outcome is never recorded as a failure

Recording "failed" asserts a fact about the rider's money: that none of it
moved. When a connection drops mid-request, a call times out, or Stripe returns
a PaymentIntent in an unexpected status, that assertion may simply be false —
the capture may have succeeded on Stripe's side and the response lost on the
way back.

Treating it as a failure invites the two worst follow-up actions: capturing
again (double-charging the rider) or writing the trip off as unpaid (losing
real revenue). So classification fails closed — **anything not recognised as a
definitive refusal is unknown**, including error types nobody has modelled yet.
An unknown outcome that turns out to be fine costs a human a minute in the
Stripe dashboard. A failure that turns out to be a capture costs a rider money.

Definitive means Stripe rejected the request outright: `StripeCardError`,
`StripeInvalidRequestError`, `StripeIdempotencyError`,
`StripeAuthenticationError`, `StripePermissionError`, `StripeRateLimitError`.

## Who records what

payment-service classifies and records, because only it talks to Stripe.
trip-service records only when payment-service could not — it was unreachable,
or it failed before reaching its own classifier. When payment-service returns a
code showing it already recorded (`FARE_INTEGRITY_ERROR`, `CAPTURE_FAILED`,
`CAPTURE_OUTCOME_UNKNOWN`), trip-service logs and stays quiet, so one failure
produces one event.

trip-service only ever writes `payment_capture_outcome_unknown`. It never calls
Stripe, so it is never in a position to say a capture definitively failed. A
missing Redis payment-intent handle is recorded as unknown too
(`CAPTURE_HANDLE_MISSING`): with no handle we cannot tell whether a hold was
placed and later lost.

## Contract

| Code | HTTP | Meaning |
| --- | --- | --- |
| `FARE_INTEGRITY_ERROR` | 422 | F5, unchanged — rejected before Stripe |
| `CAPTURE_FAILED` | 422 | Stripe refused; no funds moved |
| `CAPTURE_OUTCOME_UNKNOWN` | 502 | outcome uncertain; funds may have moved |
| `CAPTURE_HANDLE_MISSING` | n/a | no handle; recorded as unknown |

502 rather than 500 so upstream uncertainty stays distinguishable from an
ordinary server fault.

Event metadata carries scalars only:

```
outcome, code, stripeErrorType, stripeCode, declineCode, detail,
paymentIntentId, bidId, requestedAmountCents, attemptedAt, source
```

Raw Stripe error objects are never persisted — they can embed customer ids,
payment-method fingerprints and card last-4. Capture failures are an operations
concern and are never surfaced to riders or drivers.

Retrieval: `GET /admin/finance/capture-failures?limit=&outcome=failed|unknown`.

`TripEvent` is the durable record. No migration: `metadata` is `Json`,
`eventType` is `VarChar(50)`, and the existing `[eventType, createdAt]` index
serves the query. `PaymentStatus` is unchanged — there is no `capture_unknown`
status, because uncertainty about one attempt is not a state of the payment.

## What belongs to F3b

F3a adds no retries, no outbox, no recovery worker, no scheduler, no
reconciliation job and no automatic replay. Deferred: recovery of unknown
outcomes by reconciling against Stripe; payment-intent handle retention and
lifecycle; an admin resolve action; blocking driver payout on unsettled
capture; the same blindness in `chargeRiderForTrip` on the standard-ride path;
and the missing idempotency key on void.

One structural note that F3a deliberately does not address: offer-trip capture
happens at **bid acceptance**, before the ride is driven. The platform can
therefore carry a rider for an entire trip having captured nothing. F3a makes
that visible. Moving capture is a separate product decision.
