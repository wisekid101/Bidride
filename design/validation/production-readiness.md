# Production Readiness

Criteria that must be met before BidiRide is open to real riders and drivers.
Grouped by domain. Each item requires a named owner and a confirmed date.

---

## Platform Core

### Services
- [ ] All 11 services deployed to ECS and passing health checks
- [ ] No service running with `NODE_ENV=development` in production
- [ ] All inter-service URLs using ECS service discovery (not localhost)
- [ ] `AI_SERVICE_URL` set in trip-service and bids-service task definitions
- [ ] All services emit structured logs to CloudWatch Logs

### Database
- [ ] RDS Multi-AZ enabled (us-east-1 primary, automatic failover)
- [ ] Automated daily snapshots enabled (7-day retention minimum)
- [ ] `pnpm db:migrate:prod` executed successfully against production RDS
- [ ] All 35+ Prisma models verified in production schema
- [ ] `pnpm db:seed` executed — platform_config and founder admin seeded
- [ ] Connection pool limits set appropriately per service

### Cache
- [ ] ElastiCache Redis cluster deployed (replication group for HA)
- [ ] Redis eviction policy: `allkeys-lru` (location keys must never fill memory)
- [ ] Redis maxmemory alarm set at 75% utilization

---

## Payments

- [ ] Stripe account in live mode (`sk_live_*` key in production env)
- [ ] Stripe Connect configured for driver payouts
- [ ] Stripe webhook endpoint registered and `STRIPE_WEBHOOK_SECRET` set
- [ ] Instant payout fee confirmed (`$0.99`), minimum (`$10`), cap (`$500`) correct in live Stripe config
- [ ] 2-hour wallet hold period (`WALLET_HOLD_HOURS=2`) confirmed
- [ ] Test of live auth hold → capture → instant payout end-to-end before launch
- [ ] PCI DSS scope confirmed (Stripe Elements / hosted fields — no raw card data touches BidiRide servers)

---

## Driver Onboarding

- [ ] Checkr production API key (`CHECKR_API_KEY`) set; package slug (`driver_pro`) confirmed
- [ ] Checkr webhook endpoint registered; `CHECKR_WEBHOOK_SECRET` set
- [ ] FCRA pre-adverse action letter template reviewed by legal counsel
- [ ] FCRA 7-day waiting period (Redis TTL) confirmed in production
- [ ] S3 bucket for driver documents created; versioning enabled; presigned URL TTL appropriate
- [ ] At least one driver fully onboarded and approved in production before public launch

---

## Safety

- [ ] SOS 3-state flow tested on physical devices (initiation → countdown → confirmation)
- [ ] Panic handler (triple-tap) confirmed not in accessibility tree on both iOS and Android
- [ ] Audio recording: confirmed starts only on SOS confirmation
- [ ] Audio files stored encrypted in S3; access logged
- [ ] Safety admin can view and assign active SOS sessions in real time
- [ ] Panic admin payload verified to contain no `riderId`, `riderName`, or `riderPhone`
- [ ] Emergency services contact number configured and tested (911 or local equivalent)

---

## Compliance

- [ ] FCRA adverse action letter delivery mechanism confirmed (email via Twilio SendGrid or equivalent)
- [ ] Trust score numerical values confirmed inaccessible via all client-facing APIs
- [ ] Fraud auto-hold threshold (`fraud_probability ≥ 90%`) confirmed and audited
- [ ] No automated permanent ban path exists in any code or admin UI
- [ ] `audit_logs` table confirmed append-only; no soft-delete or update path exists
- [ ] Data retention policy defined for: trips, payments, ratings, audio recordings, OTP logs
- [ ] Privacy policy and terms of service published and linked in both mobile apps
- [ ] Delaware LLC operating agreement reviewed (business legal entity confirmed for launch)

---

## Notifications

- [ ] Firebase project confirmed in production mode; `FCM_SERVICE_ACCOUNT` set
- [ ] FCM push confirmed working on physical iOS and Android devices
- [ ] Twilio production account; `TWILIO_PHONE_NUMBER` provisioned in +1-NJ area code
- [ ] SMS delivery confirmed for OTP and trip status updates
- [ ] Twilio proxy session for masked in-trip communication tested end-to-end

---

## Airport (EWR)

- [ ] FlightAware production API key set; 30s cache TTL confirmed
- [ ] EWR virtual queue FIFO ordering confirmed (Redis sorted set, score = join timestamp)
- [ ] Surge 2.5× hard cap enforced in production config
- [ ] Surge > 1.5× admin confirmation flow tested in production admin portal
- [ ] EWR terminal map / pickup zones configured in `platform_config`

---

## Mobile Apps

- [ ] Rider app (`@bidride/rider-app`) published to App Store and Google Play
- [ ] Driver app (`@bidride/driver-app`) published to App Store and Google Play
- [ ] Both apps pointing to production API base URL (not staging)
- [ ] Apple Pay merchant ID configured for production
- [ ] EAS project IDs confirmed for both apps
- [ ] Push notification entitlements confirmed on both iOS apps (APNs + FCM)
- [ ] App Store / Play Store review approved

---

## Admin Portal

- [ ] Admin portal (`@bidride/admin`) deployed to production URL
- [ ] Founder account seeded with a strong `FOUNDER_SEED_PASSWORD` (no default exists; seeding skips without it)
- [ ] All admin role accounts created with least-privilege roles
- [ ] Admin session cookie `httpOnly`, `secure`, `sameSite=strict` in production
- [ ] Founder-only config mutations tested (earnings floor, surge cap)

---

## Infrastructure & Operations

- [ ] Terraform production state confirmed (`terraform show` clean, no pending changes)
- [ ] ALB with HTTPS (ACM certificate) on all public-facing load balancers
- [ ] WAF rules active on ALB (rate limiting, SQL injection protection, XSS protection)
- [ ] CloudWatch dashboards created for: API latency, 5xx rates, ECS task health, RDS connections, Redis memory
- [ ] Alerting configured: PagerDuty or equivalent on-call rotation
- [ ] SQS dead-letter queue alarm configured (> 0 messages = alert)
- [ ] Runbook documented for: service restart, RDS failover, Redis failover, Stripe webhook failure, SOS escalation

---

## Launch Market (Newark, NJ / EWR)

- [ ] Minimum viable driver supply confirmed (target: ≥ 10 approved drivers in Newark area)
- [ ] Minimum viable rider acquisition plan in place
- [ ] EWR pickup zone compliance reviewed (airport ground transportation rules)
- [ ] Local insurance requirements for TNC (transportation network company) confirmed
- [ ] NJ TNC license or equivalent filed / approved
- [ ] Launch date confirmed by Founder

---

## Final Sign-off **[Founder]**

- [ ] All sections above checked by named owner
- [ ] Staging E1–E20 validation report reviewed and approved
- [ ] Production deploy approved via GitHub Actions manual gate
- [ ] Founder confirms: **BidiRide is ready for live riders and drivers**
