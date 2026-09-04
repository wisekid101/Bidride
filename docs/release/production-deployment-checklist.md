# Production Deployment Checklist — Payment Integrity Release

**Release:** `9c3d769fd60e7fb15785813259aef31e54abb419` on `feature/production-readiness`
**Contains:** F1, F2, F3a, F3b-1, F3b-2a, F4, F5
**Estimated duration:** 60–90 minutes
**Requires:** Founder approval before step 3 (first service deploy)

This is the execution checklist. `docs/payment-integrity-deployment-runbook.md`
explains *why* the order is what it is — read it once before your first run of
this release. `docs/release/operations-verification-checklist.md` holds the
copy-paste commands for each verification gate below.

> **Do not use `infrastructure/DEPLOYMENT_RUNBOOK.md` Phase 9 for this release.**
> Its parallel deploy loop rolls trip-service and payment-service together,
> which is exactly the failure this release's contract creates.

---

## Prerequisites

- [ ] Founder has approved this release
- [ ] Deploying from `9c3d769fd60e7fb15785813259aef31e54abb419`, verified with
      `git rev-parse HEAD`
- [ ] Local `HEAD` matches `origin/feature/production-readiness`
- [ ] An operator is available for the full window — this release is **manually
      watched**, not alerted (see the Monitoring Guide)
- [ ] No unresolved incident from a previous deployment
- [ ] Rollback authority is clear: who decides, and how they are reached
- [ ] AWS CLI configured for `us-east-1`, ECS cluster `bidride-production`

## Environment verification

Run everything in the "Before deployment" section of the Operations
Verification Checklist and **record the baseline numbers**. Do not skip this:
several post-deploy gates are comparisons, and "no increase" is meaningless
without a number.

- [ ] Both service health endpoints return healthy
- [ ] Stripe: live key present, correct environment, webhook secret matches the
      Dashboard
- [ ] Redis reachable, not near its memory limit
- [ ] Database reachable; RDS automated backups on; latest restorable time noted
- [ ] `INTERNAL_SERVICE_KEY` identical across trip, payment and admin services
- [ ] Migration status clean, no drift
- [ ] Current task definition revisions recorded for both services — **you need
      these to roll back**
- [ ] Payment-integrity baseline recorded (capture failures, unknown outcomes,
      recovery counts, Payment and ledger row counts)

## Migration execution

Two additive migrations: `20260728120000_capture_recovery_worklist` (new
`capture_recovery` table) and `20260728180000_capture_recovery_booking` (five
nullable columns on it). Nothing is dropped, renamed or backfilled, so the
currently running code keeps working against the new schema.

- [ ] Run the migration task per `infrastructure/DEPLOYMENT_RUNBOOK.md → Phase 7`
- [ ] Task exit code is **0**
- [ ] `prisma migrate status` reports the schema up to date
- [ ] **Decision point:** any non-zero exit or drift → **stop.** Nothing has
      deployed; there is nothing to roll back.

## Deployment order

**trip-service first, fully drained, then payment-service.** Never the reverse,
and never both at once.

### Step 1 — trip-service

- [ ] `infrastructure/scripts/deploy-service.sh production trip-service <sha>`
      (deploys by explicit ARN, digest-pinned. **Never** `--force-new-deployment`
      — it restarts on the revision already pinned and ships nothing.)
- [ ] The script reports `stable`
- [ ] **Exactly one task definition revision is running, and it is the one just
      deployed.** The script asserts this; `services-stable` alone does not prove it.
- [ ] `bash infrastructure/scripts/verify-deployment.sh production trip-service` passes
- [ ] **Decision point:** if old instances will not drain, or more than one
      revision persists → **stop. Do not deploy payment-service.** Roll back
      trip-service if needed; payment-service is untouched, so the fleet is
      still consistent.

### Step 2 — trip-service functional gate

- [ ] Create a trip and accept a bid end to end
- [ ] No `BID_ATTEMPT_ID_REQUIRED` in payment-service logs
- [ ] Capture failure and unknown-outcome counts at or near baseline
- [ ] **Decision point:** failures here → roll back trip-service only.
      payment-service has not moved.

### Step 3 — payment-service

- [ ] `infrastructure/scripts/deploy-service.sh production payment-service <sha>`
- [ ] The script reports `stable`
- [ ] Exactly one task definition revision is running, and it is the one just deployed
- [ ] `bash infrastructure/scripts/verify-deployment.sh production payment-service` passes
- [ ] **Decision point:** failure here → begin the rollback sequence,
      payment-service first.

## Health verification

- [ ] payment-service `/health` healthy
- [ ] trip-service `/health` healthy
- [ ] Stripe connectivity confirmed — a real capture completes, or logs show
      successful Stripe calls with no `StripeAuthenticationError`
- [ ] Recovery scheduler ticking; no sustained `skipped_redis_unavailable`
      (occasional `skipped_lock_held` is correct — one replica deferring to
      another)

## Post-deployment validation

Run the "After deployment" section of the Operations Verification Checklist.

- [ ] Atomic booking: a recent captured offer trip has **one** Payment row and
      **two** ledger entries under correlation `capture:{tripId}`
- [ ] Webhook processing healthy — `payment_intent.succeeded` handled, and now
      writing ledger entries, which it did not before this release
- [ ] No duplicate Payment rows; no P2002 storms on `payments_trip_id_key`
- [ ] No duplicate ledger pairs — no correlation with more than two
      `rider_payment` entries
- [ ] Recovery metrics compared against baseline
- [ ] `needsAdminCount` growth is explained. Growth from resolution
      `awaiting_capture` is **expected and correct** — F3b-1 routes
      `requires_capture` there because F3b-2a may not capture. Growth in other
      resolutions is not expected.

## Rollback order

Exactly the deployment run backwards. Full detail in the runbook.

1. [ ] Roll back **payment-service first** (revert ECS task definition)
2. [ ] Drain newer payment-service instances; confirm one revision
3. [ ] Roll back **trip-service second**
4. [ ] Drain newer trip-service instances; confirm one revision
5. [ ] Verify bid submission and acceptance

**Never roll back trip-service while the newer payment-service is still
running** — that is the broken pairing and it fails every bid authorization.

Migrations stay applied. Do not delete `CaptureRecovery` rows. Do not hand-edit
`Payment` or `FinancialLedger`.

## Success criteria

The deployment is successful when **all** of these hold:

- [ ] One task definition revision per service, both the new one
- [ ] Both health endpoints healthy
- [ ] A trip can be created, bid on, accepted and captured end to end
- [ ] Capture failure and unknown-outcome counts at or near baseline
- [ ] Exactly one Payment row and two ledger entries for every captured offer trip
- [ ] No duplicate Payment or ledger evidence
- [ ] Recovery scheduler ticking, `oldestUnresolvedAgeSeconds` bounded
- [ ] All `needsAdminCount` growth explained
- [ ] No unexplained error in either service's logs since the deploy

Anything unresolved after 30 minutes of investigation → roll back. A clean
rollback with a puzzle to solve tomorrow beats an unexplained payment state
overnight.
