# BidRide — Deployment Sequence
## Part 3 of 3: Environments · Feature Flags · Rollback · Launch Checklist

**Status:** FOUNDER APPROVED — 2026-06-07
**Deployment philosophy:** Every environment is a gate. Nothing skips a gate. Staging is treated as production.

---

## 1. Environment Topology

```
Developer Machine  →  Staging  →  Production
(local Postgres        (AWS ECS    (AWS ECS
 + Redis)               Fargate     Fargate
                        us-east-1   us-east-1
                        RDS Multi-AZ RDS Multi-AZ
                        ElastiCache) ElastiCache)

Admin Portal:
Developer Machine  →  Staging (Vercel preview) →  Production (Vercel / ECS)

Mobile Apps:
Developer Machine  →  Expo Go (device)  →  TestFlight (iOS) / Internal Track (Android)
                                         →  App Store / Google Play (production)
```

---

## 2. Branch → Environment Mapping

| Branch | Deploys To | Trigger | Approval Required |
|--------|-----------|---------|------------------|
| `feature/*` | Local only | Manual | None |
| `staging` | Staging (ECS + Vercel) | Auto on merge | CI green |
| `main` | Production (ECS + Vercel) | Auto on merge | CI green + GitHub Environment approval (Founder) |
| `hotfix/*` | Production (fast-path) | Manual | Founder approval + RDS snapshot first |

---

## 3. Deployment Sequence — Per Feature

Every feature follows this exact promotion path. No exceptions.

```
Step 1 — Local development
  pnpm --filter @bidride/<service> dev
  All tests pass locally

Step 2 — Feature branch PR
  CI runs: lint → typecheck → unit tests → integration tests
  All green required. PR merged to staging only if green.

Step 3 — Staging deploy (auto on merge to staging)
  GitHub Actions:
    a. Run DB migrations (additive only)
    b. Build Docker image → push to ECR
    c. Update ECS service → wait services-stable
    d. Smoke tests: curl staging-api.bidride.com/v1/health
    e. Safety smoke: SOS endpoint responds correctly

Step 4 — Staging QA
  Manual test on staging (real devices for mobile)
  Playwright E2E suite runs against staging
  Safety-adjacent features: dedicated safety review

Step 5 — Staging sign-off
  Checklist signed (see §7)
  Promotion PR opened: staging → main

Step 6 — Production deploy (requires Founder approval in GitHub Environments)
  GitHub Actions:
    a. Pre-migration RDS snapshot (automated)
    b. Run DB migrations
    c. Deploy safety-service FIRST → wait stable
    d. Deploy remaining services in parallel
    e. Wait all services stable
    f. Production smoke tests
    g. Alert: Slack/SMS to Founder on success or failure

Step 7 — Post-deploy monitoring (30 minutes)
  Watch Cloudwatch metrics:
    - ECS task health (no restarts)
    - RDS connection count (no spike)
    - p95 API latency (no degradation)
    - Error rate (no spike above baseline)
  If any metric anomalous → rollback (see §5)
```

---

## 4. Feature Flag Strategy

Feature flags allow features to be deployed but not yet activated. Used for:
- Gradual rollout to % of users
- Kill switch if issues detected post-deploy
- A/B testing (future)

**Flag storage:** `platform_config` table (existing, Founder-only write for sensitive flags).

| Flag Key | Type | Default | Controls |
|----------|------|---------|---------|
| `preferred_driver_enabled` | boolean | false | Preferred Driver Network — all layers |
| `following_enabled` | boolean | false | Driver Following feature |
| `connect_enabled` | boolean | false | BidRide Connect request + direct booking |
| `business_center_enabled` | boolean | false | Business Center screens |
| `corporate_enabled` | boolean | false | Corporate Preferred Driver Program |
| `subscriptions_enabled` | boolean | false | Driver Subscription Plans |
| `preferred_exclusive_window_sec` | integer | 45 | Tunable without deploy |
| `corporate_exclusive_window_sec` | integer | 60 | Tunable without deploy |
| `connect_exclusive_window_sec` | integer | 120 | Tunable without deploy |
| `subscription_pro_boost` | decimal | 1.15 | Pro dispatch boost multiplier |
| `subscription_elite_boost` | decimal | 1.30 | Elite dispatch boost multiplier |

**Rollout sequence (each flag enabled in staging first, then production):**

```
Week 12 → preferred_driver_enabled = true (staging → production)
Week 16 → following_enabled = true
Week 20 → connect_enabled = true
Week 22 → business_center_enabled = true
Week 28 → corporate_enabled = true  (legal docs must be complete)
Week 32 → subscriptions_enabled = true
```

**Flag read pattern (services):**
- Flags cached in Redis with 60s TTL
- On cache miss: read from `platform_config` table
- Flag changes take effect within 60s without deploy

---

## 5. Rollback Procedures

### 5.1 Service Rollback (No DB Change)

If a service is misbehaving post-deploy:

```
1. Identify failing service from Cloudwatch
2. AWS Console → ECS → Service → Update
   → Image: previous tag (IMAGE_TAG = prior commit SHA)
3. Wait services-stable (~2 minutes)
4. Verify smoke test passes
5. Post-incident: root cause analysis before re-deploy
```

### 5.2 Database Rollback (Additive Schema Only)

BidRide uses additive migrations only. "Rolling back" a migration means:

```
1. New columns: set to nullable or with default → safe to leave in place
2. New tables: can be dropped if feature flag is off and no data written
3. Never roll back a migration that has modified existing rows
```

Pre-deploy RDS snapshot enables full database restore if catastrophic (data corruption, accidental drop). Restore is a last resort — takes 15–30 minutes for production RDS.

```
Restore from snapshot:
  aws rds restore-db-instance-from-db-snapshot \
    --db-instance-identifier bidride-production-restore \
    --db-snapshot-identifier bidride-pre-deploy-<SHA>
  (Then promote and update DATABASE_URL — coordinate with Founder)
```

### 5.3 Feature Flag Rollback (Fastest — <60 seconds)

If a feature causes issues in production without a DB change:

```
Admin Portal → Platform Config → set flag = false
Takes effect within 60s (Redis TTL expires)
No redeploy needed
No downtime
```

This is the first rollback to attempt for any new feature issue.

### 5.4 Mobile App Rollback

- iOS: submit a new build with the bug fixed; previous build stays in store
- Android: use Play Console to halt rollout; previous track promoted
- Emergency: feature flag disables the backend endpoint → app shows graceful error

---

## 6. Production Launch Sequence

### Pre-Launch (Weeks 33–34)

**Week 33 — Infrastructure hardening:**

```
Day 1:  Terraform apply in production (ECS, RDS Multi-AZ, ElastiCache, S3, WAF, ALB)
Day 2:  Run DB migrations (all tables) in production — additive, no data yet
Day 3:  Seed production: Founder admin account only (no demo data)
Day 4:  Deploy all 13 services (11 existing + relationship + corporate)
Day 5:  End-to-end smoke test on production with real Stripe test key
Day 6:  DNS cutover: api.bidride.com, admin.bidride.com
Day 7:  Load test production (50 concurrent simulated trips)
```

**Week 34 — Credentials and partners:**

```
Day 1:  Stripe live mode keys → payment-service
Day 2:  Twilio live credentials → notification-service
Day 3:  Firebase production FCM key → notification-service
Day 4:  FlightAware live API key → airport-service
Day 5:  Apple App Store submission (rider-app + driver-app)
Day 6:  Google Play submission (rider-app + driver-app)
Day 7:  TestFlight / Internal Track invite first drivers and riders
```

### Launch Day Sequence

```
T-24h  Final staging regression (Playwright full suite)
T-12h  Production smoke test (all 13 services healthy)
T-4h   Enable feature flags: preferred_driver_enabled=true (all others remain false)
T-1h   First cohort: 10 invited drivers, 10 invited riders (soft launch)
T+0    Monitor 30 minutes:
         ECS task health, RDS connections, p95 latency, error rate
T+1h   Expand: 50 drivers, 50 riders
T+24h  Open registration (driver onboarding queue)
T+7d   following_enabled=true (after network has trips to follow)
T+14d  connect_enabled=true (after riders have ≥1 completed trip)
T+30d  business_center_enabled=true
T+60d  corporate_enabled=true (legal docs in place)
T+90d  subscriptions_enabled=true
```

---

## 7. Staging Sign-Off Checklist

*Complete before every production promotion.*

### Infrastructure
- [ ] All 13 ECS services healthy (no restarts in last 30 minutes)
- [ ] RDS connection count normal
- [ ] Redis cluster reachable, no evictions
- [ ] S3 document upload working (presigned URL test)
- [ ] ALB returning 200 on all health endpoints

### Auth & Security
- [ ] OTP send → verify → JWT flow works (test phone)
- [ ] Expired JWT returns 401
- [ ] Non-Founder JWT blocked from earnings floor + corporate fee rate endpoints
- [ ] Panic payload verified: no riderId, riderName, riderPhone

### Trip Lifecycle
- [ ] Full trip: request → dispatch → accept → start → complete
- [ ] Earnings floor formula verified (formula output matches known good)
- [ ] Driver take-home shown first on earnings screen
- [ ] Stripe test charge fires on completion
- [ ] Receipt sent (email + in-app)

### Safety
- [ ] SOS 3-state flow tested manually on device
- [ ] Panic gesture fires with no visual change
- [ ] Audio recording starts only on SOS confirm
- [ ] Trusted contact SMS received

### Preferred Network (after Sprint 6)
- [ ] Preferred dispatch offered before standard pool
- [ ] 45s exclusive window expires → Layer 4 fires
- [ ] EWR queued driver not offered preferred trip
- [ ] Preferred-by count only (no rider identity)

### Admin Portal
- [ ] All 8 original pages load
- [ ] Corporate Approval Queue visible (Founder only)
- [ ] Subscription MRR widget populates
- [ ] Earnings floor formula locked (Founder JWT required to edit)
- [ ] Fraud page: no automated permanent ban actions available

### Feature Flags
- [ ] All flags default to correct values
- [ ] Flag change takes effect within 60s (test with preferred_driver_enabled toggle)

---

## 8. Monitoring and Alerting

| Metric | Warning Threshold | Critical Threshold | Action |
|--------|------------------|-------------------|--------|
| p95 API latency | >500ms | >1,000ms | Investigate ECS memory / DB query plans |
| ECS task restart rate | >1/hour | >3/hour | Rollback service |
| RDS CPU | >60% | >80% | Check slow queries; scale up if sustained |
| Redis memory | >70% | >85% | Increase ElastiCache node size |
| Dispatch success rate | <95% | <90% | Check driver supply; check Redis NX |
| Stripe charge failure rate | >2% | >5% | Check Stripe dashboard; notify riders |
| SOS event unacknowledged | >60s | >120s | Page Safety Admin immediately |
| Earnings floor supplement rate | >10% of trips | >25% | Review pricing; driver supply issue |

All alerts fire to: Founder SMS (Twilio) + Safety Admin email.

---

## 9. Complete Document Index

| File | Contents | Lines |
|------|---------|-------|
| `product/implementation-roadmap-part1.md` | Phases, milestones, feature-level scope, DoD, risk register | 260 |
| `product/implementation-roadmap-part2-sprints.md` | 16 sprints, acceptance criteria, velocity | 326 |
| `product/implementation-roadmap-part3-deployment.md` | This document | — |
| `product/FOUNDER_REVIEW_PACKAGE.md` | Executive summary, decisions, competitive analysis | 244 |
| `product/feature-addendum-preferred-drivers-subscriptions-part1.md` | Architecture, ERD | 268 |
| `product/feature-addendum-preferred-drivers-subscriptions-part2.md` | DB, API, matching, screens | 384 |
| `product/feature-addendum-preferred-drivers-subscriptions-part3.md` | Privacy, safety, regulatory, revenue | 236 |
| `product/feature-addendum-preferred-drivers-subscriptions-part4.md` | User flows, MVP checklist, approval | 439 |

---

*Part 3 of 3 complete. Implementation Roadmap is fully documented.*
*No code written. No infrastructure modified.*
*Ready to begin Sprint 1 on Founder's go-ahead.*
