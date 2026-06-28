# BidiRide — Technical Architecture v1.0 · Part 5: Deployment Architecture

**Status:** Draft — Pending Founder Approval
**Document:** 08-E · Part 5 of 5

---

## AWS Infrastructure Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        AWS (us-east-1)                      │
│                                                             │
│  ┌─── Route 53 ───────────────────────────────────────┐    │
│  │   api.bidiride.com → ALB                            │    │
│  │   admin.bidiride.com → ALB (admin-only security grp)│    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─── CloudFront ──────────────────────────────────────┐    │
│  │   Static assets (driver/rider web fallback)         │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─── VPC (10.0.0.0/16) ───────────────────────────────┐   │
│  │                                                      │   │
│  │  Public Subnets (10.0.1.0/24, 10.0.2.0/24)         │   │
│  │  ├── NAT Gateway (outbound for private subnets)      │   │
│  │  └── ALB (Application Load Balancer)                 │   │
│  │                                                      │   │
│  │  Private Subnets (10.0.10.0/24, 10.0.11.0/24)       │   │
│  │  ├── ECS Cluster (Fargate)                           │   │
│  │  │   ├── auth-service (2 tasks min)                  │   │
│  │  │   ├── trip-service (3 tasks min)                  │   │
│  │  │   ├── driver-service (2 tasks min)                │   │
│  │  │   ├── rider-service (2 tasks min)                 │   │
│  │  │   ├── pricing-service (2 tasks min)               │   │
│  │  │   ├── safety-service (2 tasks min)                │   │
│  │  │   ├── payment-service (2 tasks min)               │   │
│  │  │   ├── notification-service (2 tasks min)          │   │
│  │  │   ├── trust-service (1 task min)                  │   │
│  │  │   ├── airport-service (2 tasks min)               │   │
│  │  │   └── admin-service (2 tasks min)                 │   │
│  │  │                                                   │   │
│  │  ├── RDS PostgreSQL Multi-AZ (db.r6g.large)          │   │
│  │  │   ├── Primary (writes)                            │   │
│  │  │   ├── Read Replica 1 (analytics)                  │   │
│  │  │   └── Read Replica 2 (admin portal)               │   │
│  │  │                                                   │   │
│  │  └── ElastiCache Redis Cluster (cache.r6g.large)     │   │
│  │      ├── Node 1 (primary shard)                      │   │
│  │      ├── Node 2 (shard + replica)                    │   │
│  │      └── Node 3 (shard + replica)                    │   │
│  │                                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─── Supporting Services ─────────────────────────────┐    │
│  │  S3 Buckets (5)    SQS Queues   SageMaker Endpoints  │    │
│  │  Secrets Manager   CloudWatch   WAF + Shield         │    │
│  │  SES (email)       AWS KMS      EAS (Expo builds)    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## ECS Service Configuration

Each NestJS service runs as an ECS Fargate task. All services share a base configuration:

| Setting | Value |
|---|---|
| Launch type | Fargate |
| CPU | 512 vCPU (0.5 vCPU) default; 1024 for trip/pricing |
| Memory | 1024 MB default; 2048 MB for trip/pricing/safety |
| Health check | `GET /health` → 200 |
| Log driver | `awslogs` → CloudWatch Logs `/bidride/{service-name}` |
| Task role | Service-specific IAM role (least privilege) |

### Auto-Scaling Rules

```yaml
ScalingPolicy:
  MetricType: RequestCountPerTarget
  TargetValue: 100 requests/target/minute
  ScaleOutCooldown: 60s
  ScaleInCooldown: 300s
  MinCapacity: 2
  MaxCapacity: 20

SafetyService:
  # Never scale below 2 — safety is non-negotiable
  MinCapacity: 2
  MaxCapacity: 10
  AlarmOnBreach: true   # PagerDuty alert if max capacity reached
```

---

## SQS Async Queues

| Queue | Producer | Consumer | Retention |
|---|---|---|---|
| `bidride-trip-events` | Trip Service | Analytics, Trust | 1 day |
| `bidride-notifications` | All services | Notification Service | 4 hours |
| `bidride-rating-updates` | Trip Service | Trust Service | 1 day |
| `bidride-email-sends` | All services | Notification Service | 1 day |
| `bidride-floor-logs` | Pricing Service | Analytics | 1 day |
| `bidride-fraud-alerts` | Trust Service | Admin Service | 4 hours |
| `bidride-payout-processing` | Payment Service | Payment Service (DLQ) | 4 days |
| `bidride-driver-approval` | Driver Service | Notification Service | 1 day |

Dead-letter queues (DLQ) enabled on all queues. DLQ messages trigger CloudWatch alarm → PagerDuty.

---

## Environments

### Three-Environment Strategy

| Environment | Purpose | Domain | Database |
|---|---|---|---|
| `development` | Local dev + PR previews | localhost / ngrok | Local PostgreSQL |
| `staging` | QA + integration testing | staging-api.bidiride.com | RDS (smaller instance) |
| `production` | Live platform | api.bidiride.com | RDS Multi-AZ |

### Environment Variables (managed via AWS Secrets Manager)

```
DATABASE_URL            → Secrets Manager
REDIS_URL               → Secrets Manager
STRIPE_SECRET_KEY       → Secrets Manager
STRIPE_WEBHOOK_SECRET   → Secrets Manager
CHECKR_API_KEY          → Secrets Manager
TWILIO_ACCOUNT_SID      → Secrets Manager
TWILIO_AUTH_TOKEN       → Secrets Manager
FIREBASE_SERVICE_ACCOUNT → Secrets Manager (JSON)
FLIGHTAWARE_API_KEY     → Secrets Manager
SAGEMAKER_ENDPOINT_URL  → Secrets Manager
JWT_SECRET              → Secrets Manager (rotated 90 days)
FOUNDER_JWT_PUBLIC_KEY  → Secrets Manager (for floor formula writes)
AWS_REGION              → Environment variable (non-secret)
```

---

## CI/CD Pipeline

### GitHub Actions — Main Workflow

```yaml
name: BidiRide CI/CD

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: bidride_test
      redis:
        image: redis:7
    steps:
      - checkout
      - setup Node 20
      - install dependencies
      - run lint (ESLint + Prettier)
      - run type check (tsc --noEmit)
      - run unit tests (Jest)
      - run integration tests (Jest + real PG)
      - upload coverage to Codecov

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - build Docker images (each service)
      - push to ECR (tagged with commit SHA)

  deploy-staging:
    needs: build
    if: branch == 'staging'
    steps:
      - run database migrations (Prisma migrate deploy)
      - update ECS service (new task definition)
      - wait for deployment stable
      - run smoke tests

  deploy-production:
    needs: build
    if: branch == 'main'
    environment: production   # requires manual approval in GitHub
    steps:
      - create RDS snapshot (pre-migration backup)
      - run database migrations
      - blue-green deploy via ECS
      - run smoke tests
      - notify Slack on success/failure
```

### Mobile Build Pipeline (Expo EAS)

```
PR merged to main:
  → EAS Build triggered (iOS + Android)
  → Internal distribution (TestFlight + Firebase App Distribution)
  → QA approval required for App Store / Play Store submit

Release branch:
  → EAS Submit → App Store Connect + Google Play Console
  → Staged rollout: 10% → 50% → 100% (manual gates)
```

---

## Monitoring & Alerting

### CloudWatch Dashboards

| Dashboard | Metrics |
|---|---|
| **API Health** | Request rate, error rate, p50/p95/p99 latency per service |
| **Safety SLA** | SOS response time, panic queue depth, SLA breach rate |
| **Driver Earnings** | Floor supplement rate, payout failures, instant payout volume |
| **Database** | RDS CPU, connections, replication lag |
| **Cache** | Redis hit rate, eviction rate, memory usage |

### PagerDuty Alert Rules

| Condition | Severity | Response |
|---|---|---|
| SOS queue depth > 3 (unassigned) | Critical | On-call safety admin |
| API error rate > 5% for 2 min | High | Engineering on-call |
| Safety Service crash | Critical | Engineering + Safety lead |
| RDS failover triggered | High | Engineering on-call |
| DLQ message on payout queue | High | Engineering on-call |
| ECS task count at max capacity | Medium | Engineering on-call |
| Fraud auto-hold triggered | Medium | Fraud admin queue |

### Logging Strategy

- All request logs: structured JSON (`requestId`, `userId`, `route`, `duration`, `status`)
- Safety events: separate log group with 2-year retention (`/bidride/safety`)
- Audit events: separate log group with 7-year retention (`/bidride/audit`)
- Standard logs: 90-day retention
- Logs streamed to CloudWatch, can export to S3 for long-term archival

---

## Security Configuration

### WAF Rules (AWS WAF on ALB)

- SQL injection protection
- XSS protection
- Rate limiting by IP (see API Architecture Part 3)
- Geographic blocking (optional — US only for launch)
- Known bad bots: blocked via managed rule group

### TLS

- Minimum TLS 1.2 (TLS 1.3 preferred)
- Certificates managed by AWS ACM (auto-renewed)
- HSTS enforced on all responses

### IAM Roles (least privilege)

| Service | Permissions |
|---|---|
| Trip Service | RDS read/write (trips table only) |
| Safety Service | RDS read/write (safety_* tables), S3 write (recordings bucket) |
| Payment Service | RDS read/write (payments, payouts), Secrets Manager (Stripe keys) |
| Admin Service | RDS read (all), read replicas, Secrets Manager read |
| Notification Service | SES send, SNS publish, Secrets Manager (Twilio, Firebase) |

Shared database user for Pricing/Trust Services has **no UPDATE/DELETE on audit_logs** — insert only.

---

## Disaster Recovery

| Scenario | RTO | RPO | Solution |
|---|---|---|---|
| Single service crash | < 60s | 0 | ECS restarts task automatically |
| AZ failure | < 5 min | 0 | Multi-AZ RDS failover, ECS spreads across AZs |
| Region failure | < 4 hours | < 1 hour | Manual failover to us-west-2 (RDS snapshot restore) |
| Data corruption | < 2 hours | < 5 min | PITR restore from RDS automated backup |
| Safety recording loss | 0 (prevented) | 0 | S3 versioning + cross-region replication enabled |

---

## Technical Architecture — Document Complete

| Part | File | Status |
|---|---|---|
| Part 1: System Architecture | 08-technical-architecture-part1.md | ✓ Saved |
| Part 2: Database Architecture | 08-technical-architecture-part2.md | ✓ Saved |
| Part 3: API Architecture | 08-technical-architecture-part3.md | ✓ Saved |
| Part 4: AI Architecture | 08-technical-architecture-part4.md | ✓ Saved |
| Part 5: Deployment Architecture | 08-technical-architecture-part5.md | ✓ Saved |

**Next phase:** Code generation. Order: PostgreSQL schema → Auth Service → Trip Service → Pricing Service → Safety Service → Payment Service → Remaining services → Rider App → Driver App → Admin Portal → Infrastructure (Terraform) → Test Suite.

---

*BidiRide Technical Architecture — Part 5 of 5 — Confidential · Delaware LLC*
