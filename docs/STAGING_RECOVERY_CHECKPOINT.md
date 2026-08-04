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
infrastructure/scripts/preflight-service.sh staging auth-service <tag>   # must exit 0
infrastructure/scripts/deploy-service.sh   staging auth-service <tag> --desired-count 0  # baseline
infrastructure/scripts/deploy-service.sh   staging auth-service <tag> --desired-count 1  # deploy
```

Preflight is read-only and names the exact blocker. Both scripts accept either
`auth` or `auth-service`. The zero-count baseline pins a digest and makes it
PRIMARY without launching a task, so a circuit-breaker rollback lands on a
pullable image instead of the `:bootstrap` tag, which does not exist in ECR.

For several services at once use `deploy-fleet.sh`, which preflights the **whole**
order before deploying any of it and aborts with nothing changed if any service
fails. Both CI deploy jobs call it, so they inherit that gate.

## Gated on Founder approval

1. **staging `terraform apply`** — 2 ALB listener rules (`/webhooks/stripe` →
   payment, `/webhooks/checkr` → driver) plus recreating the SNS email
   subscription. Plan verified: 2 add, 0 change, 0 destroy. Apply *before*
   creating the Stripe and Checkr endpoints so the first delivery succeeds.
2. **`infrastructure/terraform/account/`** — a fourth state
   (`account/terraform.tfstate`) that makes ECR image scanning actually run.
   Never initialised.

> **The SNS subscription is STILL PENDING as of 2026-08-04T01:5xZ**, verified
> three ways: `list-subscriptions-by-topic`, account-wide `list-subscriptions`,
> and Terraform state (`pending_confirmation = true`,
> `confirmation_was_authenticated = false`). Topic attributes read
> `SubscriptionsPending=1, SubscriptionsConfirmed=0, SubscriptionsDeleted=1`.
>
> **The most likely cause: there are TWO confirmation emails and the older one is
> dead.** A first subscription was created 2026-08-01 and expired unconfirmed —
> that is the `Deleted=1` — and its link no longer does anything. The live
> subscription was created **2026-08-04T01:40:50Z** by the staging apply, and only
> *that* email's link will confirm it. Sort by newest and click the one timestamped
> 2026-08-03 ~9:40 PM EDT. Check spam. Deadline ≈ **2026-08-07** before it expires
> the same way.
>
> Do NOT recreate the subscription to "retry" — that invalidates the live email
> and starts the 3-day clock again.

> **CI deploys are blocked until the SNS subscription is confirmed.** The
> workflow runs `verify-deployment.sh <env> all` and `smoke-test.sh` as unguarded
> steps, so a non-zero exit fails the deploy job — and the alerting check fails
> while the topic has no confirmed subscriber. That is correct behaviour (alerting
> really is broken), but it means a CI deploy will go red *after* deploying
> successfully. Manual `deploy-service.sh` / `deploy-fleet.sh` runs are unaffected:
> the fleet gate calls `verify-deployment.sh <service>`, which does not run the
> alerting section.

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

## Deployment-readiness verification — 2026-08-03, all CLEAN

Checked explicitly for hidden boot blockers in the seven undeployed services.
None found. Do not repeat without new evidence.

- **IAM execution role** — one shared role, `bidride-ecs-execution-staging`, whose
  inline policy allows `secretsmanager:GetSecretValue` on
  `arn:aws:secretsmanager:us-east-1:*:secret:bidride/staging/*`. A **wildcard**, so
  secrets added later (as `google-maps-api-key` was) are covered automatically —
  there is no per-ARN list to fall out of date. Plus the managed
  `AmazonECSTaskExecutionRolePolicy` for ECR pulls and log writes.
- **KMS** — staging secrets have `KmsKeyId: None`, i.e. the AWS-managed key, so no
  explicit `kms:Decrypt` grant is required. Not a blocker.
- **Task roles** — `bidride-ecs-task-staging` grants S3 on all five buckets
  (object *and* bucket level), SQS on all eight queues, and one KMS key.
  `auth` and `admin` have **dedicated** roles each scoped to their own KMS key, so
  neither JWT signer can reach the other's — the RS256 domain isolation the
  runbook describes is real, not aspirational.
- **Health-check alignment** — for all seven, container `PORT`, the port mapping
  and the port in the health-check command agree (3001/3003/3004/3006/3007/3008/
  3010). No repeat of the ai-service mismatch.
- **CloudWatch alarms — 29, complete coverage.** 12 × `ecs-tasks-below-desired`
  (one per service), 8 × `jwt-401-ratio`, 4 × deployment (RS256 boot + KMS signing
  for auth/admin), 2 × ALB 4XX/5XX, 3 × RDS/ElastiCache. Container Insights is
  **enabled** and all 12 task-count alarms are in `OK` — they are receiving data,
  not silently starved.

### Health-endpoint semantics — do not "fix" `/health` to fail on dependencies

`/health` is the path the **ECS container health check** curls and, for most
services, the ALB target group too. It is deliberately a **liveness** check:

- most services return a flat `{status:"ok"}` with no dependency calls
- `auth-service` is different — its `/health` calls `ready()`, but that method
  catches every error and still returns **HTTP 200**, with `status:"not_ready"`
  in the *body*. `curl -sf` only inspects the status code, so it passes
- `auth-service`'s ALB target group uses `/health/live`, which is genuinely
  dependency-free (uptime and heap only)

**Consequence, both directions.** A green ECS health check does NOT mean a
service can serve traffic — during a database outage auth stays "healthy" while
failing every login. Check `/health/ready` or `/ready` for that, and the
`ecs-tasks-below-desired` and `jwt-401-ratio` alarms for the operational signal.

**Do not make `/health` return 503 when a dependency is unhealthy.** It looks like
a correctness improvement and is a cascading-outage generator: a brief RDS blip
would fail every container health check simultaneously, ECS would kill and
replace every task across all twelve services at once, and the replacements would
fail their health checks too while the database was still recovering. Liveness
and readiness are separate on purpose.

> **Trap, recorded so it is not repeated:** the 12 task-count alarms are
> metric-math alarms, so their `MetricName` field is **null**. Filtering alarms by
> `MetricName` makes them invisible and produces the false conclusion that no
> service has a task-count alarm. Query `Metrics[]`, not `MetricName`.

The whole alarm stack publishes to `bidride-alerts-staging`. It is correctly
built and correctly wired — the *only* break is that the topic has no subscriber
(see above), which is a one-line fix gated behind the Terraform apply.

## Expected `verify-deployment.sh` output at this stage

Run `bash infrastructure/scripts/verify-deployment.sh staging all`. It currently
exits 1 with **8 failures and 4 skips — every one expected**. Triage before
investigating anything:

| Result | Meaning |
|---|---|
| 7 × `<svc> — no RUNNING tasks` | the credential gate; not defects |
| 1 × `no CONFIRMED subscriptions` | the SNS gap; fixed by the gated apply + clicking the link |
| 2 × `empty placeholder` keyset skips | correct pre-RS256 state, `JWT_SIGNING_ALG=HS256` |
| 2 × `no 'JWT issuance algorithm' log line` skips | task started outside the 2h log window |

**A healthy service must return exit 0 per-service** — that is the gate
`deploy-fleet.sh` applies after each deploy. All five live services do. If one
starts failing, that is real.

Two false failures were fixed in `075742b`; do not reintroduce them. An empty
keyset is not a failure, and `aws logs filter-log-events` auto-paginates while
applying `--query` per page, so an empty result prints `None\nNone` rather than
`None` and slips past a naive equality guard.

## ECR scanning — correcting an earlier wrong claim (2026-08-04)

`398c90f` asserted that image scanning "has never scanned anything" because the
registry configuration held `{"scanType":"BASIC","rules":[]}` and
`DescribeImageScanFindings` returned `ScanNotFoundException`. **That conclusion
was wrong.**

Scanning was working the whole time. The `ScanNotFoundException` came from
querying **by tag**. buildx attaches provenance/SBOM attestations, so each pushed
tag resolves to an **OCI image index**
(`application/vnd.oci.image.index.v1+json`), which ECR BASIC scanning cannot scan
— `StartImageScan` on it returns `UnsupportedImageTypeException`. The real
`linux/amd64` child manifest inside the index *is* scanned, on push.

Verified after the apply, with scan timestamps that all predate it:

| repository | child manifest | scan | completed |
|---|---|---|---|
| auth-service | `cc4a8ac0f8b1` | COMPLETE | 2026-08-03T22:25Z |
| trust-service | `cb854ebc304a` | COMPLETE | 2026-08-03T19:08Z |
| admin-service | `208dfae75c66` | COMPLETE | 2026-08-03T20:25Z |
| payment-service | `adf70bec0620` | COMPLETE | 2026-08-03T22:28Z |

`findingSeverityCounts` is empty on all of them — **zero vulnerabilities found**.

**Operational trap:** to read scan results you must resolve the tag to its
`linux/amd64` child manifest digest and query *that*. Querying by tag will always
report `ScanNotFoundException` and look like scanning is broken.

```bash
IDX=$(aws ecr describe-images --repository-name bidride/<svc> \
  --image-ids imageTag=<tag> --query 'imageDetails[0].imageDigest' --output text)
CHILD=$(aws ecr batch-get-image --repository-name bidride/<svc> \
  --image-ids imageDigest=$IDX \
  --accepted-media-types application/vnd.oci.image.index.v1+json \
  --query 'images[0].imageManifest' --output text \
  | python3 -c "import json,sys;print([m['digest'] for m in json.load(sys.stdin)['manifests'] if m['platform']['architecture']=='amd64'][0])")
aws ecr describe-image-scan-findings --repository-name bidride/<svc> \
  --image-id imageDigest=$CHILD --query 'imageScanStatus'
```

The `account/` registry configuration is still correct and worth having — it makes
the intent explicit and its wildcard covers repositories created later, which a
per-repository flag can be missed on. But it repaired nothing; the control was
already functioning.

## CloudTrail proof: the credential writes and SNS confirmation never reached AWS

Checked 2026-08-04 after the gates were reported complete twice while AWS showed
no change. CloudTrail settles it — this is **not** eventual consistency, a caching
artifact, or a permissions problem:

- **`PutSecretValue`, last 24h: 9 events.** All at 2026-08-03T11:41 by
  `bidride-deploy`, all `err=none`, and all for the **nine secrets that are
  already populated** (database-url, jwt-secret, redis-url, admin-jwt-secret,
  internal-service-key, founder-jwt-secret, jwt-public-keys,
  jwt-admin-public-keys, stripe-secret-key).
  **Zero events for any twilio-* or google-maps-api-key.** No attempt arrived —
  not a rejected one, not a failed one. None.
- **`ConfirmSubscription`, last 24h: 0 events.**

Those nine successes prove the mechanism, IAM permissions, account and region are
all correct. The five writes simply were never issued against this account.

**For SNS this confirms the earlier diagnosis.** Clicking an *expired*
confirmation link generates no `ConfirmSubscription` call at all — exactly the
zero observed. The 2026-08-01 subscription was deleted after expiring; its email
is inert. Only the email sent at **2026-08-04T01:40:50Z** can confirm the live
subscription.

**Diagnostic to run before retrying** — proves which account is being written to:

```bash
aws sts get-caller-identity --query Account --output text   # must be 898711549003
aws configure get region                                    # must be us-east-1
aws secretsmanager put-secret-value --secret-id bidride/staging/twilio-account-sid \
  --secret-string file:///tmp/s ; echo "exit=$?"            # exit MUST be 0
```

A non-zero exit, a different account, or a different region explains it
immediately. If the command reports exit 0 and `LastChangedDate` still does not
advance, that would be genuinely anomalous and worth escalating.

## INCIDENT 2026-08-04 — rider-service deploy failed, rolled back, resolved

**Trigger:** `google-maps-api-key` was populated (secrets 9→10/22), unblocking
rider-service. Preflight passed. Deploy to desired-count 1 failed.

**What ECS showed (misleading):** `CannotPullContainerError: …rider-service:bootstrap:
not found`, repeatedly. That is the *rollback* target — revision 1 — not the cause.

**Actual cause, from the task logs of revision 3:**
```
ERROR [ExceptionHandler] STRIPE_SECRET_KEY environment variable is required
  at new PaymentMethodsService (…/payment-methods.service.js:21:19)
```
rider's task definition supplied only DATABASE_URL, REDIS_URL, JWT_SECRET,
JWT_PUBLIC_KEYS, GOOGLE_MAPS_API_KEY. `stripe-secret-key` was already populated
in Secrets Manager and used by payment-service — it was never wired to rider.

**Sequence:** task starts → dies in DI → circuit breaker → rollback to rev 1 →
`:bootstrap` unpullable → churn. **The real cause is two failures deep.** When a
deploy shows `CannotPullContainerError: :bootstrap`, read the *task logs of the
revision you deployed*, not the service events.

**Contained:** rider scaled to 0 (0/0/0, 3 stopped tasks retained as evidence).
The other five services were never touched and stayed 1/1/0 throughout.

**Two fixes committed, one gated:**
- `07ee075` preflight now catches refuse-to-start vars that are NOT
  `getOrThrow()` — it extracts any ALL_CAPS name in an "is required" throw. This
  exact gap let the bad deploy through. First attempt regressed by matching
  `FATAL` in `FATAL: INTERNAL_SERVICE_KEY is required`; the variable must sit
  immediately before the phrase. Verified: 5 live services pass, rider flags
  STRIPE_SECRET_KEY, auth/safety flag Twilio.
- `d818652` adds `stripe-secret-key` to rider in `ecs-services.tf`.
  **Plan verified: 1 add / 1 destroy, sole address
  `aws_ecs_task_definition.services["rider-service"]` — NOT APPLIED, Founder gate.**

**To finish rider:** apply that Terraform (registers the new task-def shape;
`ignore_changes = [task_definition, desired_count]` means nothing moves), then
re-run preflight and deploy normally.

## Findings that would otherwise be re-derived

Recorded because each cost real investigation and each would otherwise be
repeated — or, worse, re-decided the wrong way.

- **No usable provider credentials exist on this workstation.** All 18 real
  `.env` files were checked. Twilio values are fake or malformed (SID is `AC` +
  32 *alphanumeric*, real ones are hex; the phone is `+1555000…`, a reserved
  fictional range that can never send). Stripe webhook/platform, Checkr and
  FlightAware are placeholders. FCM has a project id and service-account email
  but the **private key is empty**, so the set is unusable. Do not re-scan
  unless told new credentials were added.
- **The Maps key in `services/rider-service/.env` is byte-identical to the key
  that leaked**, confirmed by hash comparison. It is the only local value that
  would have passed format validation, so an unverified write would have pushed
  a compromised key into staging. Delete it in Google Cloud; do not reuse it.
- **Do not pre-establish zero-count baselines for the seven blocked services.**
  It looks helpful and is not: a service at desired-count 0 can never experience a
  rollback, and step 5 of the deployment workflow establishes a fresh
  digest-pinned baseline at deploy time from these same images.
- **Image freshness cannot be derived from service-source git history.** The
  seven blocked images were stale because of a change to
  `services/Dockerfile.template`, which no per-service path filter would show.
  Always check the Dockerfile too. This error was made once and cost a full
  re-verification cycle.
- **`grep --include="*.env" --exclude="*.example"` does not exclude as expected** —
  the example files still matched, which briefly made placeholder credentials look
  real. Filter in code when the answer matters.
- **The throttler is correct, do not re-audit.** `throttlerClientIp` trusts only
  the ALB-appended rightmost `X-Forwarded-For` entry, so one client cannot consume
  everyone's rate-limit bucket. Every `/health` route carries `@SkipThrottle()`,
  so probes cannot be throttled into a task kill.

## One defect left UNFIXED — it lives in a file you are editing

`docs/FOUNDER_DEPLOYMENT_CHECKLIST.md` line ~418 carries the broken production
migration command that was corrected in `DEPLOYMENT_RUNBOOK.md` and
`DEPLOY_CHECKLIST.md` (commit `d0e277c`):

```
["node","node_modules/.bin/prisma","migrate","deploy",
 "--schema","packages/database/prisma/schema.prisma"]
```

Both paths are wrong for the current image. pnpm never populates
`/app/node_modules/.bin`, and WORKDIR is `/app/services/<service>`, so every
relative path breaks. Replace with:

```
["node","/app/node_modules/.pnpm/node_modules/.bin/prisma","migrate","deploy",
 "--schema","/app/packages/database/prisma/schema.prisma"]
```

**Deliberately not fixed by the assistant.** That file is modified in the working
tree (Founder's Identity Platform edits, 49 insertions / 28 deletions), and the
defect is present in the committed version too. Editing the working copy would
sweep those unrelated changes into an infrastructure commit; patching only the
committed version would be silently reverted the moment the Founder commits their
copy. It is a one-line change for whoever owns that file.

It is the FOUNDER-facing checklist, so this is the copy most likely to be used
during a real production migration.

## Uncommitted work outside this milestone

Roughly 8,000 lines of in-progress Identity Platform and branding work sit
uncommitted on `feature/production-readiness` — 51 modified tracked files and 43
untracked ones. It is **not** part of this milestone and was deliberately never
staged into any of its commits.

It is backed up: branch **`feature/identity-platform-wip`** (`4bfee35`, pushed) is
a point-in-time snapshot of all 94, taken with git plumbing against a temporary
index so the working tree, real index and HEAD were untouched. `.gitignore` was
honoured, so it contains no `.env`, tfvars, tfstate, key or credential file.

It is a backup, not reviewed work — nothing in it was built or tested. Recover a
file with `git checkout feature/identity-platform-wip -- <path>`.

**Re-snapshot whenever that work continues** — the copy is point-in-time, not a
live mirror:

```bash
infrastructure/scripts/snapshot-wip.sh feature/identity-platform-wip --push
```

Safe to run at any moment, including mid-edit: it builds the tree in a temporary
index, so the working tree, the real index and HEAD are never touched, and it
asserts all four afterwards. It is idempotent — if nothing changed it makes no
commit, and it still pushes when origin is behind.

## Cost

≈ **$381/month** — ~$300 baseline infrastructure plus ~$81 Fargate for 2.25 vCPU
/ 4.50 GiB across five tasks. Running all twelve will exceed the $400 target;
re-cost before completing the platform.
