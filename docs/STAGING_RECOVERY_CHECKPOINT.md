# Staging Recovery Checkpoint — 2026-08-03

Point-in-time record of staging state, written so recovery does not depend on any
one machine. Facts here are verified against AWS, not inferred. Supersede it with
a newer commit rather than editing history into it.

**Blocked on:** 13 third-party credentials only the Founder can obtain, plus two
gated Terraform applies. Nothing else.

## Live services — 5 of 12

Each 1/1/0, rollout COMPLETED, container HEALTHY, 0 stopped tasks, one Cloud Map
instance. Do not rebuild or redeploy these without evidence they changed.

| service | task-def rev | image digest |
|---|---|---|
| trust | 3 | `sha256:7f80c10735a6eb865db5279485554bdb3743324b705af5399344cac83a987397` |
| pricing | 3 | `sha256:3d43d9514d730df2ae072407b7ad2b4348179400ff99cb6b636fcf24b6591051` |
| trip | 3 | `sha256:c32c7dcac592c6598744fd539a84b04b3d78a478099a37a6fea1294d45e0cf4f` |
| ai | 6 | `sha256:3596d43139851b1e556e8e5c505cabfd81f5528d0280c0133c5fae558db8acbb` |
| admin | 3 | `sha256:e1e5d984272eea5069fb1e1b6c7e4466798087657713f8115d41c972b50ed9c4` |

`ai-service` has no ALB target group by design — it is reachable only through
Cloud Map.

## Blocked services — 7 of 12

Deployment order, approved: **auth → rider → safety → notification → payment →
driver → airport**.

Images are built, validated and pushed at commit `c19fdc4`. Use these digests;
do **not** rebuild unless service source or `services/Dockerfile.template`
changes.

| service | image digest |
|---|---|
| auth | `sha256:e1401e3804281f0193e04af2748614ae7a189ad4e0ce4873734d59cc4d0f2076` |
| rider | `sha256:e74278c5f998b5711400ab2066fb8f12fc16e4877e2d1420f31ae78a60a6c52a` |
| safety | `sha256:52fb19c4e8ea5850b4708eb7a9efae1edb48d4e4712d1ee03b020e2211bddc3d` |
| notification | `sha256:07fa7a5987a63eb17ca504a260e2a9595d1218f5758173c67b878a300172ee45` |
| payment | `sha256:b52b1d4578b3a5b929474901ee55c3e371c38d871e2c7d24fc0a4bfe8a52de19` |
| driver | `sha256:ebc782671d74806f970ed3d9644bcb5f34dc1e7d1a3685eeeaa6ae5d5188306e` |
| airport | `sha256:6aae239ba825255ff594365e0843cd98c1823f645327ae53c2c91595d300b63e` |

Each was validated inside the image before push: WORKDIR `/app/services/<svc>`,
`dist/main.js`, `/app/packages/observability/dist/index.js`, and both
`@nestjs/core` and `@bidride/observability/nest` resolving. All `linux/amd64`.

**Earlier `198c43a`-tagged images are BROKEN** — built before the dist-colocation
fix, they cannot boot (`MODULE_NOT_FOUND`). Never deploy them.

## Why the 7 cannot start

Entries in a task definition's `secrets[]` are mandatory: ECS resolves every one
before starting the container. A container with no `AWSCURRENT` version yields
`ResourceNotFoundException` → `ResourceInitializationError`, and the task never
reaches RUNNING. There is no partial-start path — `airport` declares three
secrets and one empty value is enough to kill it.

**22 secret containers, 9 populated, 13 empty.**

| service | missing secrets |
|---|---|
| auth | twilio-account-sid, twilio-auth-token, twilio-phone-number |
| rider | google-maps-api-key |
| safety | twilio-account-sid, twilio-auth-token, twilio-proxy-service-sid, google-maps-api-key |
| notification | twilio ×4, fcm-project-id, fcm-service-account-email, fcm-service-account-private-key |
| payment | stripe-webhook-secret, stripe-platform-account-id |
| driver | checkr-api-key, checkr-webhook-secret |
| airport | flightaware-api-key |

**Highest-value action: 4 Twilio values + 1 replacement Maps key unlocks three
services** (auth, rider, safety).

Formats: Twilio SID `^AC[0-9a-f]{32}$` (hex — an alphanumeric value was rejected
once as fake), auth token `^[0-9a-f]{32}$`, phone `^\+1[0-9]{10}$` (a real
purchased number; `+1555000…` is reserved fictional), proxy `^KS[0-9a-f]{32}$`,
Maps `^AIza[0-9A-Za-z_-]{35}$`.

Containers already exist — use `put-secret-value`, never `create-secret`, and
always `--secret-string file://…` so no value enters argv or shell history.

> **Security:** the previous Google Maps key was exposed and must be **deleted**
> in the Cloud Console, not rotated. It is still present in
> `services/rider-service/.env`, so local development is using a compromised key.

## Deploying, once credentials land

```bash
infrastructure/scripts/preflight-service.sh staging <service> <tag>   # must exit 0
infrastructure/scripts/deploy-service.sh   staging <service> <tag> --desired-count 0  # baseline
infrastructure/scripts/deploy-service.sh   staging <service> <tag> --desired-count 1  # deploy
```

Preflight is read-only and names the exact blocker. The zero-count baseline pins
a digest and makes it PRIMARY without launching a task, so a circuit-breaker
rollback lands on a pullable image instead of the `:bootstrap` tag, which does
not exist in ECR.

## Gated on Founder approval

1. **staging `terraform apply`** — 2 ALB listener rules (`/webhooks/stripe` →
   payment, `/webhooks/checkr` → driver) plus recreating the SNS email
   subscription. Plan verified: 2 add, 0 change, 0 destroy. Apply *before*
   creating the Stripe and Checkr endpoints so the first delivery succeeds.
2. **`infrastructure/terraform/account/`** — a fourth state
   (`account/terraform.tfstate`) that makes ECR image scanning actually run.
   Never initialised.

> **Staging alerting is currently dead.** `aws_sns_topic_subscription.alerts_email`
> is in state but absent from AWS — the confirmation email was never clicked and
> AWS deletes pending email subscriptions after ~3 days. All 29 alarms are `OK`,
> but nothing would reach anyone. Re-applying only helps if the confirmation link
> is clicked within 3 days.

## Known-clean (do not re-audit without new evidence)

- Rollback is sound: `rollback-service.sh` verifies the target exists and is
  ACTIVE first. Records live in `infrastructure/deploy-records/<env>/` (gitignored),
  CI uploads them as artifacts, and the runbook documents the no-record fallback.
- `post-deploy-verify.sh` probing `/health/live` for auth is correct — auth has
  its own `@Controller('health')` alongside the root-mounted observability one.
- Images carry no `.env`, tfvars, tfstate, credentials or `.git`; they run as uid
  1001. The only `*.pem` files are Alpine's public CA bundles.
- Only `admin-service` registers a global auth guard. Every `/health` route is
  `@SkipThrottle()`, so probes cannot be rate-limited into a task kill.
- ECR lifecycle retains 60 tagged builds as the rollback horizon.

## Cost

≈ **$381/month** — ~$300 baseline infrastructure plus ~$81 Fargate for 2.25 vCPU
/ 4.50 GiB across five tasks. Running all twelve will exceed the $400 target;
re-cost before completing the platform.
