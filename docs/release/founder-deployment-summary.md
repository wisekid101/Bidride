# Founder Deployment Summary — Payment Integrity

**Release** `9c3d769` · **Deploy** 60–90 min · **Rollback** 20–40 min ·
**Audit verdict** GO

---

## What changed

Seven defects in the offer-trip payment path, found by audit and fixed one at a
time. Four mattered to money:

- **A retried bid could put two live holds on a rider's card.** The second was
  invisible to us and never released. Every authorization now carries an
  idempotency key, so a retry returns the original hold.
- **Any amount up to the standard fare could be captured on an offer trip.**
  The fare guards protecting standard rides did not apply to the capture path
  at all. Capture is now validated cent-exact against the accepted fare, before
  Stripe is called.
- **A capture that failed left no trace.** The code discarded rejected
  responses, and because a failed capture writes no payment record, the admin
  "failed payments" screen was structurally blind to exactly the case it looked
  built for. Failures are now durable, classified and queryable.
- **A capture confirmed only by webhook never reached the books.** It updated
  the payment row and wrote no ledger entry. All three paths — normal capture,
  webhook, recovery — now book through one atomic operation.

A background worker asks Stripe what actually happened to uncertain captures
and records the answer. It reads Stripe; it never writes to it.

## Why it matters

These are the failures that cost money quietly. A duplicate hold is money the
rider cannot spend and we do not know we are holding. An unvalidated capture is
a wrong amount charged with no alarm. A silent capture failure is a ride we
gave away — and until now, we would only have found it by noticing revenue was
lower than it should be.

Nothing here invents an outcome. Money is booked only when Stripe confirms it,
for an amount validated against the accepted fare. Every ambiguous case goes to
a human rather than to a guess. No code path, and no administrator, can declare
a payment succeeded.

## Risks

| Risk | Severity |
| --- | --- |
| Deployment order is mandatory — reversed, every bid authorization fails | High if ignored, zero if followed |
| No metrics or alerting in payment-service — release is watched by hand | Medium |
| `needs_admin` queue will grow by design | Low — expected, and it is the measurement that decides the next checkpoint |
| Drivers are still paid on bid trips whose capture never landed | Medium — **pre-existing, unchanged by this release** |

## Mitigations

- Written runbook, execution checklist and copy-paste verification commands.
  A hard gate after trip-service: one task-definition revision must be proven
  before payment-service moves.
- Baseline numbers recorded before deploying, so "no increase" is measurable.
- Rollback is the deployment backwards, well within the window.
- Two migrations, both additive; nothing dropped, renamed or backfilled.
  Verified applying from a clean database and from the current schema.
- 619 unit, 313 integration and 20 end-to-end tests, re-run from the exact
  commit: 15/15 parallel and 10/10 sequential full-matrix runs, no
  intermittency. Every capture-success scenario ends by asserting exactly one
  payment row and two ledger entries.

## Deployment time estimate — 60–90 minutes

| Step | Time |
| --- | --- |
| Pre-deploy checks and baseline | 10–15 min |
| Migrations | ~5 min |
| trip-service deploy + drain | 5–15 min |
| trip-service verification (hard gate) | ~10 min |
| payment-service deploy + drain | 5–15 min |
| Post-deploy validation | 15–20 min |

## Rollback time estimate — 20–40 minutes

Revert the task definition per service (<5 min each), plus drain (5–15 min
each), plus verification. Migrations stay applied, so there is no restore and
no downtime.

## Expected operational impact

**Riders and drivers see nothing.** No app change, no flow change.

**Operations gains work and visibility.** New admin screens for capture
failures and the recovery queue, and a queue that will grow: holds whose
capture never landed are routed to a human, because this release deliberately
stops short of re-capturing them. Someone should check the numbers a few times
on day one, daily for three days, then twice weekly.

**That queue is also the decision.** Its size over the next two weeks tells us
whether automatic recovery capture is worth building. If it stays near zero,
the next checkpoint may not be needed at all — which would be the best outcome,
since it is the first code in this programme that could charge a rider
automatically.

## Recommendation

**Deploy**, following `docs/payment-integrity-deployment-runbook.md`, with an
operator watching for the full window. Then hold for **two weeks** before
approving F3b-2b, and use that time to measure rather than to build.
