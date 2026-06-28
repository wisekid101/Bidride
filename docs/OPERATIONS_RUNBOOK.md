# BidiRide — Operations Runbook

Day-to-day operations reference for Markie and the ops team.

---

## Incident Severity Levels

| Level | Name | Definition | Response Time | Who Gets Notified |
|-------|------|-----------|--------------|-------------------|
| P0 | Critical | Platform down, SOS broken, payment processing failed, data breach | Immediate | Founder (call) + all on-call |
| P1 | High | Single service down, payout failures >10 drivers, auth outage | < 15 min | Founder (text) + on-call |
| P2 | Medium | Elevated error rate, single ride failed, feature degraded | < 1 hour | On-call team |
| P3 | Low | Minor UI issue, single user complaint, non-critical alert | Next business day | Support queue |

### Who to Notify

| Role | Contact | For |
|------|---------|-----|
| Founder (Markie) | Primary contact | All P0, all payments/safety incidents |
| AWS Support | Console → Support | Infrastructure emergencies |
| Stripe | dashboard.stripe.com → Support | Payment processing failures |
| Twilio | console.twilio.com → Support | SMS/OTP outages |
| Firebase | firebase.google.com → Support | Push notification failures |

---

## Daily Founder Checklist

Run every morning before 9 AM EST:

```
□ CloudWatch dashboard — no red alarms
  https://console.aws.amazon.com/cloudwatch/

□ Check ALB 5xx error rate (should be < 0.1%)
  Alarms → bidride-alb-5xx-production

□ Check RDS CPU (should be < 60%)
  Alarms → bidride-rds-cpu-production

□ Check Redis CPU (should be < 50%)
  Alarms → bidride-redis-cpu-production

□ Review any new fraud alerts (admin portal → Fraud)
  https://admin.bidiride.com/fraud

□ Review SOS/safety incidents from prior 24h (admin portal → Safety)
  https://admin.bidiride.com/safety

□ Check payout batch status (admin portal → Finance)
  https://admin.bidiride.com/finance

□ Check pending driver approvals (admin portal → Drivers)
  https://admin.bidiride.com/drivers

□ Review open support tickets (admin portal → Support)
  https://admin.bidiride.com/support
```

---

## Service Health Monitoring

### Quick health check (all 12 services)

```bash
# From any machine with internet access
BIDRIDE_API_URL=https://api.bidiride.com bash infrastructure/scripts/smoke-test.sh

# For detailed functional check
BIDRIDE_API_URL=https://api.bidiride.com \
BIDRIDE_ADMIN_EMAIL=marq@bidiride.com \
BIDRIDE_ADMIN_PASS=your-password \
bash infrastructure/scripts/post-deploy-verify.sh
```

### Check a specific service's logs

```bash
aws logs tail /ecs/bidride/auth-service-production --follow --region us-east-1
# Replace auth-service with: trip-service, driver-service, rider-service,
# pricing-service, safety-service, payment-service, notification-service,
# trust-service, airport-service, admin-service, ai-service
```

### Check ECS service status

```bash
aws ecs describe-services \
  --cluster bidride-production \
  --services bidride-auth-service-production \
  --query 'services[0].{Running:runningCount,Desired:desiredCount,Status:status,LastEvent:events[0].message}' \
  --region us-east-1
```

---

## Payment Failure Handling

### Symptom: Rider charged but driver not paid

1. Go to Admin Portal → Finance → look up the trip by ID
2. Check `payment_ledger` status for the trip
3. If ledger shows `payment_captured` but no `driver_payout_queued`:
   - Check payment-service logs for the `stripe.transfer` call
   - The driver may not have a connected Stripe account — check driver profile
4. Manual payout via Admin Portal → Finance → Manual Payout
5. Log the incident in the admin audit trail

### Symptom: Stripe webhook events not being processed

```bash
# Check payment-service logs for webhook errors
aws logs filter-log-events \
  --log-group-name /ecs/bidride/payment-service-production \
  --filter-pattern "webhook" \
  --start-time $(date -d '1 hour ago' +%s000) \
  --region us-east-1

# Verify webhook signing secret is correct
# Stripe Dashboard → Developers → Webhooks → Signing secret
# Must match bidride/production/stripe-webhook-secret in Secrets Manager
```

### Symptom: Payment intent stuck in `processing`

1. Go to Stripe Dashboard → Payments → find the payment intent
2. If status is `requires_capture`, manually capture it or cancel
3. Update the trip status via Admin Portal if needed

---

## Payout Failure Handling

### Symptom: Driver payout failed

1. Admin Portal → Finance → Payout History
2. Find the failed payout batch — note the error reason
3. Common causes:
   - Driver's Stripe connected account is not fully verified
   - Insufficient funds in platform account (check Stripe balance)
   - Driver's bank account on file is invalid

```bash
# Check payout-batch-service logs
aws logs filter-log-events \
  --log-group-name /ecs/bidride/payment-service-production \
  --filter-pattern "payout" \
  --start-time $(date -d '1 hour ago' +%s000)
```

4. Retry failed payouts via Admin Portal → Finance → Retry Payout
5. If driver account issue: have driver re-verify Stripe Connect onboarding

### Symptom: Instant payout unavailable for driver

- Instant payouts require the driver's connected account to support instant payouts
- Not all bank accounts support instant payout (requires debit card on file)
- Standard payout (T+1) is always available as fallback

---

## Rider Support Workflow

1. Rider files complaint via in-app support or email
2. Support team opens ticket in Admin Portal → Support
3. Look up rider profile (Admin Portal → Riders → search by phone)
4. Review trip history for the reported ride
5. Resolution options:
   - Issue full or partial refund: Admin Portal → Refunds → Select Trip
   - Adjust trust score: done automatically by trust-service; if manual needed, contact Founder
   - Account suspension: Admin Portal → Riders → Suspend (requires Safety Admin role)
6. Close ticket with resolution notes

### Refund Process

```
Admin Portal → Refunds → New Refund
  → Select trip → Enter refund amount (full or partial)
  → Select reason from dropdown
  → Confirm (triggers payment-service refund via Stripe)
```

Refund limits: up to 30 days after trip completion. Beyond 30 days requires Founder approval.

---

## Driver Support Workflow

1. Driver contacts support (in-app or email)
2. Open Admin Portal → Drivers → find driver by name/phone
3. Common issues:
   - **Background check pending**: check Checkr Dashboard for status
   - **Documents rejected**: review rejection reason in Admin Portal → Drivers → Documents
   - **Account suspended**: check fraud/safety alerts that triggered suspension
   - **Payout not received**: follow Payout Failure workflow above
4. For document re-review: Admin Portal → Drivers → Documents → Re-review
5. Driver approval/rejection requires Driver Approval Admin role

---

## Fraud Alert Workflow

### Auto-hold triggered (fraud probability ≥ 90%)

1. Admin Portal → Fraud → Active Alerts (P1 — respond within 2 hours)
2. Review alert details:
   - Trip history pattern
   - Device fingerprint
   - Payment method velocity
3. Decision options:
   - **Clear**: false positive — release hold, add notes
   - **Confirm + Suspend**: fraud confirmed — Admin Portal → suspend account
   - **Escalate**: complex case — escalate to Founder
4. **No automated permanent bans** — human decision required

### Elevated fraud rate

```bash
# Check trust-service logs for fraud detection patterns
aws logs filter-log-events \
  --log-group-name /ecs/bidride/trust-service-production \
  --filter-pattern "FRAUD HOLD"
```

If multiple accounts triggering: possible coordinated attack. Notify Founder immediately (P0).

---

## SOS / Safety Incident Workflow

### P0 — Active SOS in progress

1. Admin Portal → Safety → Active SOS (auto-refreshes every 10s)
2. **DO NOT contact the rider directly** — this may escalate danger
3. Assign to Safety Admin via Admin Portal → Safety → Assign
4. Admin Portal shows:
   - Last known GPS coordinates (refresh every 30s)
   - Driver identity and vehicle
   - Audio recording status (if SOS confirmed)
5. Contact emergency services (911) with trip details if warranted
6. Document all actions in the SOS event timeline (Admin Portal → Safety → Notes)

### Panic Mode (triple-tap, silent)

- Panic is silent — rider does NOT want anyone to know they're in distress
- Admin Portal shows panic flag, but no UI change on rider device
- Same response as SOS: assign to Safety Admin, consider 911
- **NEVER reveal panic mode is active to the driver**

### Route Deviation Alert

- Admin Portal → Safety → Route Deviations
- Safety-service detects deviations > threshold
- Review map overlay: actual route vs. expected
- Contact driver via admin portal if deviation exceeds 15 minutes
- If driver unresponsive: treat as P0

---

## AI Service Failure Workflow

### Symptom: AI service down or returning errors

Services that call ai-service (trip, pricing, trust, admin) have fallback behavior:
- **trip-service**: bid ranking falls back to FIFO by bid time
- **pricing-service**: fare calculated by rule engine only (no AI adjustment)
- **trust-service**: trust score calculation deferred, existing scores used
- **admin-service**: marketplace simulation unavailable

```bash
# Check ai-service logs
aws logs tail /ecs/bidride/ai-service-production --follow

# Check if ai-service is running
aws ecs describe-services \
  --cluster bidride-production \
  --services bidride-ai-service-production \
  --query 'services[0].{Running:runningCount,Desired:desiredCount}'

# Restart if down
aws ecs update-service \
  --cluster bidride-production \
  --service bidride-ai-service-production \
  --force-new-deployment
```

### Impact Assessment

| Service | Degraded behavior | Revenue impact |
|---------|------------------|---------------|
| pricing-service | AI price adjustment disabled | Minor — rule engine still works |
| trip-service | Driver ranking falls back to FIFO | Moderate — driver match quality reduced |
| trust-service | Score updates paused | Low — existing scores still used |

---

## Redis Outage Workflow

Redis is used for: WebSocket pub/sub, EWR airport queue, real-time trip state, surge pricing cache.

### Symptom: Redis unreachable

```bash
# Check ElastiCache status
aws elasticache describe-replication-groups \
  --replication-group-id bidride-production \
  --query 'ReplicationGroups[0].{Status:Status,Members:MemberClusters}'

# Check Redis CPU alarm
aws cloudwatch describe-alarm-history \
  --alarm-name bidride-redis-cpu-production \
  --max-records 10
```

### Impact of Redis outage

| Feature | Impact |
|---------|--------|
| WebSocket (live tracking) | Real-time updates stop; riders/drivers see stale position |
| EWR airport queue | Queue unavailable; airport surge reverts to manual |
| Surge pricing | Surge multiplier defaults to 1.0 (no surge) |
| Trip state | State transitions may duplicate (idempotency layer handles) |
| Auth sessions | New logins may succeed; existing sessions may require re-auth |

### Mitigation

1. ElastiCache has 3-node cluster — automatic failover kicks in within 60s
2. If all nodes down: declare Redis maintenance mode in admin portal
3. Contact AWS Support if failover hasn't completed in 5 minutes

---

## PostgreSQL Outage Workflow

### Symptom: RDS unreachable

```bash
# Check RDS status
aws rds describe-db-instances \
  --db-instance-identifier bidride-production \
  --query 'DBInstances[0].{Status:DBInstanceStatus,MultiAZ:MultiAZ}'

# RDS Multi-AZ: automatic failover < 60s on primary failure
# Check if failover occurred:
aws rds describe-events \
  --source-identifier bidride-production \
  --duration 60 \
  --source-type db-instance
```

### Impact

All services will return 503 if they cannot reach the database. Failover is automatic with Multi-AZ.

### Emergency: Restore from backup

```bash
# Restore to specific point in time (see DEPLOYMENT_RUNBOOK.md Phase Database Restore)
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier bidride-production \
  --target-db-instance-identifier bidride-production-restore \
  --restore-time 2026-06-24T02:00:00Z

# After restore: update DATABASE_URL secret to point to new instance endpoint
aws secretsmanager put-secret-value \
  --secret-id bidride/production/database-url \
  --secret-string "postgresql://bidride_admin:PASSWORD@NEW_ENDPOINT:5432/bidride"

# Force ECS service restarts to pick up new DATABASE_URL
for svc in auth-service trip-service driver-service rider-service pricing-service \
           safety-service payment-service notification-service trust-service \
           airport-service admin-service; do
  aws ecs update-service --cluster bidride-production \
    --service bidride-${svc}-production --force-new-deployment
done
```

---

## Stripe Outage Workflow

### Stripe status page: https://status.stripe.com

### Symptom: Payment processing failing

1. Check Stripe status page for active incidents
2. Check payment-service logs:
   ```bash
   aws logs filter-log-events \
     --log-group-name /ecs/bidride/payment-service-production \
     --filter-pattern "stripe" --start-time $(date -d '30 minutes ago' +%s000)
   ```
3. If Stripe is having an incident:
   - Notify all active riders that payment processing is delayed
   - Trips can still be completed — payment will be retried
   - Instant payouts will be disabled automatically
4. Once Stripe recovers: payment-service will process queued transactions automatically

### Symptom: Stripe webhook not receiving events

- Verify webhook endpoint is reachable: `curl -I https://api.bidiride.com/payments/webhook`
- Check Stripe Dashboard → Developers → Webhooks → Recent deliveries
- If events backed up: Stripe will retry for 72 hours

---

## Twilio / FCM Outage Workflow

### Twilio outage (OTP / SMS)

- Check https://status.twilio.com
- If Twilio is down:
  - Auth-service OTP sending will fail
  - New logins are blocked (existing sessions work)
  - Safety SMS alerts won't send — P0, notify Founder immediately
- Mitigation: No fallback for OTP. Monitor Twilio and announce downtime to users if > 15 min.

### FCM outage (push notifications)

- Check https://status.firebase.google.com
- If FCM is down:
  - Push notifications will fail silently (notification-service logs errors but doesn't crash)
  - Riders/drivers won't get trip notifications on their phones
  - In-app WebSocket events still work (auth-service gateway)
- Mitigation: No action needed if < 30 min. FCM retries queued notifications on recovery.

---

## Rollback Decision Tree

```
Is the bug causing active safety incidents?
  YES → P0: Emergency shutdown, notify Founder immediately
  NO  ↓

Is revenue processing broken (payments, payouts)?
  YES → P1: Rollback immediately, follow payment failure workflow
  NO  ↓

Are more than 2 services down?
  YES → P1: Rollback immediately
  NO  ↓

Is the issue isolated to a single service?
  YES → P2: Restart that service, check logs, fix-forward if possible
  NO  ↓

Is the issue UI-only (no backend impact)?
  YES → P3: Fix-forward, no rollback needed
  NO  → P2/P1: Evaluate rollback vs. fix-forward based on blast radius
```

### How to Rollback

See `infrastructure/DEPLOYMENT_RUNBOOK.md → Rollback Procedure`.

For quick rollback (< 5 min), revert the ECS task definition to the previous revision.
For schema rollback: requires RDS point-in-time restore — involves downtime. Decide carefully.

---

## EWR Airport Queue Operations

The EWR airport FIFO queue lives in Redis (`ewr:queue` sorted set).

### View queue length

```bash
# From admin portal → Airport section (when available)
# Or via Redis CLI (requires VPN/bastion access):
redis-cli -u rediss://REDIS_ENDPOINT:6379 ZCARD ewr:queue
```

### Manual surge override

- Admin Portal → Airport → Surge Multiplier
- Requires admin confirmation for > 1.5×
- Hard cap at 2.5× (enforced in code, cannot be overridden from admin portal)

### Clear stuck queue (emergency only)

```bash
# WARNING: This removes all drivers from the EWR queue
redis-cli -u rediss://REDIS_ENDPOINT:6379 DEL ewr:queue
```

---

## On-Call Escalation Chain

```
Any alert fires
  → Check admin portal / smoke test to assess severity
  → If P2 or lower: log, monitor, fix in business hours
  → If P1: Notify Founder via text within 15 min
  → If P0: Call Founder immediately
            Assess safety impact first
            Declare incident in admin portal
            Document timeline in real-time
```

## CloudWatch Alarm Reference

| Alarm | Threshold | Severity |
|-------|-----------|---------|
| `bidride-alb-5xx-production` | > 10 errors/min | P2 |
| `bidride-rds-cpu-production` | > 80% for 3 min | P2 |
| `bidride-rds-connections-production` | > 400 connections | P1 |
| `bidride-redis-cpu-production` | > 70% for 3 min | P2 |
