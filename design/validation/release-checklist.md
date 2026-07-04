# BidiRide Release Checklist

Pre-production gate. Every item must be checked before a production deploy is approved.
Items marked **[Founder]** require explicit sign-off from the Founder before proceeding.

---

## Code Quality

- [ ] `pnpm test` — all unit tests pass (zero failures, zero skipped)
- [ ] `pnpm turbo run test:int` — all integration tests pass against real PG + Redis
- [ ] `pnpm typecheck` — zero TypeScript errors across all packages and services
- [ ] No `console.log` / `console.error` left in production paths (grep check)
- [ ] No hardcoded secrets, API keys, or credentials in source (gitleaks or equivalent)
- [ ] `pnpm audit` — no high or critical npm vulnerabilities unaddressed

## Services

- [ ] All 11 NestJS services start cleanly (`GET /health → 200`) in staging
- [ ] Auth service OTP flow end-to-end (send → verify → JWT)
- [ ] Trip service state machine: searching → accepted → in_progress → completed
- [ ] Pricing service: fare engine returns deterministic result; AI bounded ±$2.00
- [ ] Payment service: Stripe auth hold → capture → instant payout chain
- [ ] Safety service: SOS 3-state flow; panic handler not in accessibility tree
- [ ] Notification service: FCM push + Twilio SMS both reachable
- [ ] Trust service: badge labels only (Verified / Trusted / Business / VIP) — no score exposed
- [ ] Airport service: EWR FIFO queue; surge cap enforced at 2.5×; surge > 1.5× requires admin confirm
- [ ] Driver service: Redis location key format `driver:{userId}:location` (not DB UUID)
- [ ] Admin service: all role-gated endpoints enforcing correct role hierarchy

## Earnings Floor **[Founder]**

- [ ] Earnings floor formula unchanged: `(distance_miles × $1.10) + (duration_min × $0.22) + $2.50`
- [ ] Formula change (if any) signed with Founder JWT before deploy
- [ ] `earnings_floor_logs` table records supplement amounts correctly
- [ ] Platform absorbs supplement — driver always receives floor or above

## Security

- [ ] JWT secrets rotated from dev defaults (`local-dev-jwt-secret-*`)
- [ ] Admin founder password changed from `CHANGE_ME_IMMEDIATELY`
- [ ] All `httpOnly` cookies in use for admin session (no localStorage JWT)
- [ ] Internal service keys (`INTERNAL_SERVICE_KEY`) set and non-default
- [ ] Stripe webhook signature verification enabled (`STRIPE_WEBHOOK_SECRET` set)
- [ ] Checkr webhook signature verification enabled (`CHECKR_WEBHOOK_SECRET` set)
- [ ] CORS origins locked to production domains (no `*`)
- [ ] Rate limiting active on auth endpoints (OTP send/verify)
- [ ] WAF rules active on ALB (Terraform `aws_wafv2_web_acl`)

## Data & Migrations

- [ ] `pnpm db:migrate:prod` — all migrations applied to production RDS with no errors
- [ ] RDS snapshot taken immediately before migration (CI/CD enforces this)
- [ ] `pnpm db:seed` — platform_config seeded; founder admin account created
- [ ] No `actual_distance_miles` null values expected in production (mobile app must supply distance at trip end)

## Environment Variables

- [ ] `AI_SERVICE_URL` set in trip-service and bids-service production configs (required for `bid_outcomes` recording)
- [ ] `DATABASE_URL` pointing to production RDS (not localhost)
- [ ] `REDIS_HOST` pointing to production ElastiCache (not localhost)
- [ ] `STRIPE_SECRET_KEY` — live key, not test key (`sk_live_*`)
- [ ] `STRIPE_WEBHOOK_SECRET` — live endpoint secret
- [ ] `CHECKR_API_KEY` — production Checkr key
- [ ] `FCM_SERVICE_ACCOUNT` / `FCM_PROJECT_ID` — production Firebase project
- [ ] `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — production Twilio
- [ ] `SAGEMAKER_ENDPOINT_*` — production SageMaker endpoints for fare engine
- [ ] `FLIGHTAWARE_API_KEY` — production FlightAware key for EWR queue

## Infrastructure

- [ ] Terraform `plan` reviewed and approved **[Founder]**
- [ ] RDS Multi-AZ enabled; automated backups on (7-day retention minimum)
- [ ] ElastiCache cluster-mode or replica configured for Redis HA
- [ ] ECS task definitions updated with new image tags
- [ ] ALB health check paths responding on all target groups
- [ ] S3 bucket versioning enabled for driver document storage
- [ ] SQS dead-letter queues configured for all queues
- [ ] CloudWatch alarms active for: 5xx rates, RDS CPU, Redis memory, ECS task failures

## Compliance & Legal

- [ ] FCRA pre-adverse action flow tested (7-day waiting period key set in Redis)
- [ ] FCRA adverse action letter template reviewed
- [ ] Trust score numerical values confirmed not exposed to any client (internal only)
- [ ] Panic admin payload confirmed to NOT include `riderId`, `riderName`, or `riderPhone`
- [ ] Fraud auto-hold at `fraud_probability ≥ 90%` confirmed; no automated permanent ban
- [ ] Audio recording starts only on SOS confirmation (not on initiation or countdown)
- [ ] SOS panic handler (triple-tap) confirmed not in accessibility tree

## Alpha / Staging Validation

- [ ] Full E1–E20 end-to-end validation run completed against staging (see `sprint-2c-alpha-validation.md` as reference)
- [ ] Admin dashboard shows correct GMV, trip counts, driver counts
- [ ] Zero open SOS sessions at deploy time

## Final Gates **[Founder]**

- [ ] Founder approves production deploy
- [ ] GitHub Actions production workflow triggered with manual approval
- [ ] RDS snapshot confirmed before ECS rolling deploy
- [ ] On-call contact confirmed and aware of deploy window
