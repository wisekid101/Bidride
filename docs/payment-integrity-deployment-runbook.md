# Payment Integrity — Deployment & Rollback Runbook

Covers the payment-integrity work on `feature/production-readiness`: F1, F2, F3a,
F3b-1, F3b-2a, F4 and F5.

**These services must be deployed in a strict order. `infrastructure/DEPLOYMENT_RUNBOOK.md`
Phase 9 deploys every service in a parallel loop; that is unsafe for this
release and must not be used as written.** Deploy trip-service and drain it
completely before payment-service starts rolling.

> **The order is never reversed.** Deploy trip-service → payment-service.
> Roll back payment-service → trip-service.

---

## Why the order matters

**F4 introduced a required cross-service contract.** trip-service sends
`bidAttemptId` on every authorization request; payment-service requires it. The
two directions are not symmetric:

| Combination | Result |
| --- | --- |
| **new trip-service → old payment-service** | Safe. Both services run `ValidationPipe({ whitelist: true })` without `forbidNonWhitelisted`, so the unknown field is silently stripped and behaviour degrades to pre-F4 (no idempotency key on the hold) — exactly today's production behaviour. |
| **old trip-service → new payment-service** | **Breaks.** The field is absent, `@IsNotEmpty()` rejects, and **every bid authorization fails** with `400 BID_ATTEMPT_ID_REQUIRED`. No rider can submit a bid. |

That asymmetry decides everything below. The safe direction tolerates a mixed
fleet; the unsafe one does not.

**Why a mixed trip-service fleet is unsafe.** During a rolling ECS deployment
both versions serve traffic simultaneously. If payment-service is already new,
every request from a not-yet-replaced trip-service task fails — an intermittent,
partial outage that looks like flakiness rather than a version problem, and one
that resolves only when the last old task drains. Draining fully before
payment-service rolls removes the window entirely.

**The canonical fare contract (F5) is unchanged by ordering.** payment-service
validates the capture amount against the trip's persisted `finalFare`, which
both versions of trip-service write identically. F5 needs no ordering guarantee
of its own — but it does mean a capture arriving mid-deploy is either correct or
refused, never silently wrong.

**Why rolling back payment-service first preserves compatibility.** Rollback is
the deployment run backwards. An old payment-service with a new trip-service is
the *safe* combination, so removing the new payment-service first leaves the
fleet in a working state at every intermediate step. Rolling back trip-service
first would recreate exactly the broken pairing: old trip-service against new
payment-service.

**Why migrations are additive and must precede service deployment.** Both
migrations on this branch — `20260728120000_capture_recovery_worklist` and
`20260728180000_capture_recovery_booking` — only add a table and nullable
columns. Nothing is dropped, renamed or backfilled, so the old code keeps
running unchanged against the new schema. Applying them first means the schema
is ready when the new payment-service starts; applying them after would leave
payment-service querying a `capture_recovery` table that does not yet exist.

---

## Pre-deploy checks

Record the answers — several are the baseline the post-deploy comparison needs.

**Branch and commit**
```bash
git rev-parse HEAD                      # matches the approved release SHA
git rev-parse origin/feature/production-readiness   # identical
git status --short                      # nothing uncommitted that belongs in the release
```

**Migration status** — no drift, and know exactly what will apply.
```bash
pnpm -C packages/database exec prisma migrate status
```

**Database recovery posture** — confirm RDS automated backups are on and note
the latest restorable time. `infrastructure/DEPLOYMENT_RUNBOOK.md → Database
Backup & Restore`. Schema rollback needs point-in-time restore and involves
downtime; these migrations are additive precisely so that is not required.

**Stripe environment and keys** — the live secret key is present, is the
expected environment (never a test key in production), and the webhook signing
secret matches the Stripe Dashboard.

**Internal service keys** — `INTERNAL_SERVICE_KEY` is identical across
trip-service, payment-service and admin-service. A mismatch fails closed: every
internal call is rejected, and capture stops working.

**Redis health** — reachable, and not near its memory limit. The capture-recovery
scheduler will not run without it, by design.

**Service health** — trip-service and payment-service both healthy *before*
starting, so any post-deploy failure is attributable to the deploy.
```bash
curl -sf https://api.bidiride.com/health
```

**No unresolved deployment incidents** — nothing open from a previous rollout.
Deploying on top of an unresolved incident makes both undiagnosable.

**Capture-recovery baseline — record these numbers before touching anything:**
```
GET /admin/finance/capture-recovery/metrics
    unresolvedCount, needsAdminCount, oldestUnresolvedAgeSeconds,
    averageResolutionSeconds, terminalOutcomeCounts

GET /admin/finance/capture-failures?outcome=failed    → count
GET /admin/finance/capture-failures?outcome=unknown   → count
```
"No increase" is meaningless without a number to compare against.

---

## Deployment

### 1. Apply database migrations

Per `infrastructure/DEPLOYMENT_RUNBOOK.md → Phase 7`. Migration exit code must
be `0`, and `prisma migrate status` must then report the schema up to date.

### 2. Deploy trip-service — alone

```bash
infrastructure/scripts/deploy-service.sh production trip-service <sha>
```

`deploy-service.sh` deploys by explicit task-definition ARN (pinned to an image
digest), waits for the rollout to complete, and **then proves every running task
is on that exact ARN** — steps 3 and 4 below are built in and are not optional.

> The previous version of this step used `aws ecs update-service
> --force-new-deployment`. Because every ECS service carries
> `ignore_changes = [task_definition]`, that restarted tasks on the revision the
> service was *already* pinned to — so a task-definition change never actually
> shipped, while the drain and revision checks below all passed. Never deploy
> with `--force-new-deployment`.

### 3. Drain all old trip-service instances completely

Performed by the script: it polls `rolloutState` until `COMPLETED` with
`running == desired`, and aborts on `FAILED` (the ECS deployment circuit
breaker, which also reverts the service automatically).

### 4. Verify only the new version serves traffic

Also performed by the script — it enumerates every running task and asserts a
single distinct revision equal to the ARN just deployed. To re-check by hand at
any later point:

```bash
CLUSTER="bidride-production"
aws ecs list-tasks --cluster "${CLUSTER}" \
  --service-name bidride-trip-service-production --query 'taskArns' --output text |
xargs -n1 -I{} aws ecs describe-tasks --cluster "${CLUSTER}" --tasks {} \
  --query 'tasks[0].taskDefinitionArn' --output text | sort -u
```
**One line of output. If more than one revision appears, stop — payment-service
must not roll while a mixed fleet is serving.**

Then confirm configuration, not just liveness:
```bash
bash infrastructure/scripts/verify-deployment.sh production trip-service
```

### 5. Deploy payment-service

```bash
infrastructure/scripts/deploy-service.sh production payment-service <sha>
```

### 6. Drain all old payment-service instances

Built into the script, as in step 3. Then:
```bash
bash infrastructure/scripts/verify-deployment.sh production payment-service
```

### 7. Verify health and payment-integrity metrics

See the verification section below.

---

## Deploy verification

### After trip-service (before payment-service starts)

- Old instances fully drained; exactly one task definition revision running
- No version skew anywhere in the fleet
- Trip creation and bid acceptance healthy — submit a real bid and accept it
- Authorization-hold requests carry `bidAttemptId`; **no `BID_ATTEMPT_ID_REQUIRED`
  in payment-service logs** (the old payment-service ignores the field, so this
  should be silent either way — a single occurrence means something is wrong)
- `payment_capture_failed` count is at or near the recorded baseline
- `payment_capture_outcome_unknown` count is at or near the recorded baseline

### After payment-service

- payment-service `/health` returns healthy
- Stripe connectivity confirmed — a real capture completes, or the logs show
  successful Stripe calls with no `StripeAuthenticationError`
- Capture-recovery scheduler healthy: logs show ticks running, and **no sustained
  `skipped_redis_unavailable`**. Occasional `skipped_lock_held` is normal and
  correct — that is one replica deferring to another.
- Recovery metrics compared against baseline via
  `GET /admin/finance/capture-recovery/metrics`
- Atomic booking working — for a recent captured offer trip, **one** Payment row
  and **two** ledger entries under correlation `capture:${tripId}`
- Webhook processing healthy — `payment_intent.succeeded` events are handled and
  now write ledger entries, which they did not before this release
- **No duplicate Payment rows.** `Payment.tripId` is unique, so a duplicate would
  surface as a P2002 in the logs rather than as a row
- **No duplicate ledger pairs.** More than two `rider_payment` entries under one
  `capture:${tripId}` correlation is a defect
- `needsAdminCount` has not grown unexpectedly. Some growth is *expected* and
  correct: F3b-1 routes `requires_capture` to `needs_admin` because F3b-2a may
  not capture. Unexplained growth in other resolutions is not.

---

## Abort conditions

Stop the rollout, or roll back, on any of these:

- **Old trip-service instances cannot be drained.** Never start payment-service
  against a mixed fleet.
- **Migration drift detected.** The schema is not what the code expects; stop
  before any service deploys.
- **payment-service cannot reach Stripe.** Captures fail and the recovery queue
  grows behind them.
- **Redis leader lock unavailable for a sustained period.** The scheduler
  correctly skips rather than running unlocked, so recovery stalls silently —
  visible as a rising `oldestUnresolvedAgeSeconds`.
- **Payment failure or unknown-outcome rates rise materially** above the recorded
  baseline.
- **Duplicate booking evidence** — more than one Payment row for a trip, or
  P2002 storms on `payments_trip_id_key`.
- **Ledger imbalance** — debits and credits under one correlation not matching,
  or more than two `rider_payment` entries for one trip.
- **Recovery queue grows unexpectedly**, particularly `unresolvedCount` climbing
  with `averageResolutionSeconds` flat, which means work is arriving faster than
  it is being resolved.
- **Internal authentication fails** — `INTERNAL_SERVICE_KEY` mismatch. Capture
  stops working entirely.
- **Service versions cannot be confirmed.** If you cannot prove which version is
  serving, you cannot prove the order was respected.

---

## Rollback

Exactly the deployment run backwards.

### 1. Roll back payment-service first

```bash
bash infrastructure/scripts/rollback-service.sh production payment-service
```

This rolls back to the **exact** task-definition ARN recorded before the deploy
(`infrastructure/deploy-records/production/payment-service.json`, or the CI run's
`deploy-records-production-<sha>` artifact). Never compute the target as
"current revision minus one" — see `infrastructure/DEPLOYMENT_RUNBOOK.md →
Rollback Procedure` for why that was wrong.

### 2. Drain the newer payment-service instances fully

Built into the script: it waits for the rollout to complete and then asserts a
single distinct revision equal to the target ARN. Do not proceed to step 3 until
it reports `verified`.

### 3. Roll back trip-service second

```bash
bash infrastructure/scripts/rollback-service.sh production trip-service
```

### 4. Drain the newer trip-service instances fully

Built into the script. Then verify bid submission and acceptance:

```bash
bash infrastructure/scripts/verify-deployment.sh production trip-service
bash infrastructure/scripts/verify-deployment.sh production payment-service
```

---

## Rollback cautions

**Never roll back trip-service while the newer payment-service is still active.**
That is the broken pairing — old trip-service against new payment-service — and
it fails every bid authorization. It is the single most important rule here.

**Never leave mixed trip-service versions running during a payment-service
rollout**, in either direction.

**Migrations are additive and should normally stay applied during a rollback.**
The old code ignores the new table and columns. Reverting them requires RDS
point-in-time restore and involves downtime, and would destroy recovery evidence
for no benefit.

**Do not delete `CaptureRecovery` data during rollback.** Those rows are the only
record of which captures are unresolved. Deleting them does not undo a payment
problem; it removes the evidence of one.

**Do not manually mutate `Payment` or `FinancialLedger` rows.** Both are protected
by uniqueness constraints that the booking path depends on, and a hand-edited row
can make a subsequent legitimate booking fail — or worse, succeed twice.
Corrections go through the admin surfaces.

**Unresolved recoveries are evidence and must be preserved.** A row in
`needs_admin` is a question waiting for a human, not debris.

---

## Related documentation

**Release execution package** — `docs/release/`:

- `production-deployment-checklist.md` — the step-by-step checklist to execute,
  with a rollback decision point after each stage
- `operations-verification-checklist.md` — copy-paste commands and queries for
  every verification gate
- `monitoring-guide.md` — what to watch afterwards, what is normal, what needs
  investigation
- `release-notes-payment-integrity.md` — what shipped, what changed, what is
  deferred
- `founder-deployment-summary.md` — one-page executive summary

**General:**

- `infrastructure/DEPLOYMENT_RUNBOOK.md` — general deployment phases, ECS
  mechanics, rollback procedure, backup and restore
- `docs/OPERATIONS_RUNBOOK.md` — incident severity, payment failure handling,
  rollback decision tree
- `docs/capture-failure-detection.md` — what the capture events mean (F3a)
- `docs/capture-recovery.md` — the recovery worklist and lifecycle (F3b-1)
