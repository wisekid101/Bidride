# Operations Verification Checklist — Payment Integrity Release

Copy-paste commands for each gate in
`docs/release/production-deployment-checklist.md`. Record every number in the
"before" section — the "after" section compares against them.

Shell variables used throughout:

```bash
CLUSTER="bidride-production"
REGION="us-east-1"
API="https://api.bidiride.com"
```

---

## Before deployment

### Health endpoints

```bash
curl -sf "${API}/health" && echo " ← gateway OK"
aws ecs describe-services --cluster "${CLUSTER}" --region "${REGION}" \
  --services bidride-trip-service-production bidride-payment-service-production \
  --query 'services[].{Name:serviceName,Running:runningCount,Desired:desiredCount,Status:status}'
```
**Expect:** healthy response; `Running == Desired`; status `ACTIVE`.

### Service versions — record these, you need them to roll back

```bash
for SVC in trip-service payment-service; do
  echo -n "${SVC}: "
  aws ecs describe-services --cluster "${CLUSTER}" --region "${REGION}" \
    --services "bidride-${SVC}-production" \
    --query 'services[0].taskDefinition' --output text
done
```
**Record both ARNs.** These are the rollback targets.

`deploy-service.sh` now captures the same ARNs automatically, before it changes
anything, into `infrastructure/deploy-records/production/<service>.json` — and CI
uploads them as the `deploy-records-production-<sha>` artifact on every run,
including failed ones. Recording them by hand here is belt-and-braces, not the
only copy. Roll back with:

```bash
bash infrastructure/scripts/rollback-service.sh production <service>
```

### Stripe verification

- Live secret key present in Secrets Manager, and it is the **live** key, not a
  test key
- Webhook signing secret matches Stripe Dashboard → Developers → Webhooks
- Recent payment-service logs show no `StripeAuthenticationError`

```bash
aws secretsmanager list-secrets --region "${REGION}" \
  --query "SecretList[?contains(Name,'stripe')].Name"
```

### Redis verification

Reachable, and not near its memory limit. The capture-recovery scheduler
refuses to run without Redis — by design, so recovery stalls silently rather
than risking two workers.

### Database verification and baseline row counts

```sql
SELECT count(*) AS payments FROM payments;
SELECT count(*) AS rider_payment_entries
  FROM financial_ledger WHERE entry_type = 'rider_payment';
SELECT count(*) AS unresolved FROM capture_recovery WHERE status = 'unresolved';
SELECT status, count(*) FROM capture_recovery GROUP BY status;
```
Also confirm RDS automated backups are enabled and note the latest restorable
time.

### Migration verification

```bash
pnpm -C packages/database exec prisma migrate status
```
**Expect:** "Database schema is up to date!" before deploying, and the two
release migrations listed as pending if they have not yet been applied.

### Payment-integrity baseline — record all of these

```
GET /admin/finance/capture-recovery/metrics
    unresolvedCount ................ ______
    needsAdminCount ................ ______
    oldestUnresolvedAgeSeconds ..... ______
    averageResolutionSeconds ....... ______
    terminalOutcomeCounts .......... ______

GET /admin/finance/capture-failures?outcome=failed   → count ______
GET /admin/finance/capture-failures?outcome=unknown  → count ______
GET /admin/finance/capture-recovery?resolution=awaiting_capture → count ______
```

Webhook failures have no endpoint — scan recent payment-service logs for
`Webhook booking failed` and record the count.

---

## After trip-service, before payment-service

### Only one revision is running

```bash
aws ecs list-tasks --cluster "${CLUSTER}" --region "${REGION}" \
  --service-name bidride-trip-service-production --query 'taskArns' --output text |
xargs -n1 -I{} aws ecs describe-tasks --cluster "${CLUSTER}" --region "${REGION}" \
  --tasks {} --query 'tasks[0].taskDefinitionArn' --output text | sort -u
```
**Expect exactly one line.** More than one means a mixed fleet — **stop, do not
deploy payment-service.**

### Contract check

Scan payment-service logs for `BID_ATTEMPT_ID_REQUIRED`. The old
payment-service ignores the new field entirely, so this should be silent either
way. **A single occurrence means something is wrong with the rollout.**

### Functional check

Create a trip, submit a bid, accept it. The bid must be accepted and an
authorization hold placed.

---

## After deployment

### Booking verification

For a trip captured since the deploy:

```sql
-- exactly one payment
SELECT count(*) FROM payments WHERE trip_id = '<TRIP_ID>';          -- expect 1

-- exactly two ledger entries, one debit and one credit, equal amounts
SELECT direction, account_type, amount
  FROM financial_ledger
 WHERE correlation_id = 'capture:<TRIP_ID>' AND entry_type = 'rider_payment';
-- expect 2 rows: rider/debit and platform/credit, same amount
```

### Duplicate-booking evidence — expect zero rows

```sql
SELECT trip_id, count(*) FROM payments GROUP BY trip_id HAVING count(*) > 1;

SELECT correlation_id, count(*) FROM financial_ledger
 WHERE entry_type = 'rider_payment'
 GROUP BY correlation_id HAVING count(*) <> 2;
```
Also scan logs for P2002 on `payments_trip_id_key`. The constraint *prevents*
duplication; a burst of violations means something is retrying hard.

### Ledger verification — debits must equal credits

```sql
SELECT correlation_id,
       sum(CASE WHEN direction='debit'  THEN amount ELSE 0 END) AS debits,
       sum(CASE WHEN direction='credit' THEN amount ELSE 0 END) AS credits
  FROM financial_ledger
 WHERE entry_type = 'rider_payment' AND created_at > now() - interval '1 hour'
 GROUP BY correlation_id
HAVING sum(CASE WHEN direction='debit' THEN amount ELSE 0 END)
    <> sum(CASE WHEN direction='credit' THEN amount ELSE 0 END);
```
**Expect zero rows.** Any row is an imbalance and an abort condition.

### Webhook verification

`payment_intent.succeeded` events are being handled, and — new in this release —
now write ledger entries. Confirm a webhook-confirmed capture produces the same
one-payment/two-entry shape. Scan for `Webhook booking failed`.

### Capture recovery verification

```
GET /admin/finance/capture-recovery/metrics        → compare to baseline
GET /admin/finance/capture-recovery                → inspect recent rows
GET /admin/finance/capture-recovery/:id            → item + trip + full history
```
Scheduler health is read from payment-service logs: ticks appearing, and no
sustained `skipped_redis_unavailable`. `skipped_lock_held` is normal.

### Payment verification

```
GET /admin/finance/capture-failures?outcome=failed    → compare to baseline
GET /admin/finance/capture-failures?outcome=unknown   → compare to baseline
```
Both should sit at or near baseline. A material rise is an abort condition.
