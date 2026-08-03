# BidiRide — Deployment Runbook

Technical reference for engineers deploying BidiRide to AWS.
See `docs/FOUNDER_DEPLOYMENT_CHECKLIST.md` for the founder-facing simplified version.

---

## Current status — staging is live, 5 of 12 services running

Verified against AWS on 2026-08-03. See `docs/STAGING_RECOVERY_CHECKPOINT.md`
for image digests, task-definition revisions and the exact resume procedure.

**Production has never been applied** — its state key does not exist.

Staging:

- **266 resources** in `staging/terraform.tfstate`; drift is 0 apart from two
  reviewed, unapplied ALB webhook rules
- ACM `staging-api.bidiride.com` is **ISSUED**; the hostname resolves to the ALB
  and serves TLS
- **22 `bidride/staging/*` secret containers exist, 9 hold values.** The 13 empty
  ones are third-party credentials and are the only thing blocking the remaining
  seven services
- `infrastructure/terraform/env/staging.tfvars` exists locally at mode 600. It is
  gitignored and must never be committed — it carries `db_password`
- **Live and healthy:** trust, pricing, trip, ai, admin — each 1/1/0
- **Blocked on credentials:** auth, rider, safety, notification, payment, driver,
  airport. Their images are built, validated and waiting in ECR

Two changes are written, reviewed and **deliberately unapplied**, because a
`terraform apply` is a Founder gate: the ALB rules routing `/webhooks/stripe` and
`/webhooks/checkr`, and the new `account/` state that makes ECR image scanning
actually run.

> There is also an unrelated ACM certificate for **`api.bidride.com`** in FAILED
> state. Note the spelling — `bidride`, not `bidiride`. It is for a domain this
> project does not own and cannot validate, is referenced by nothing, and is
> safe to delete. Do not confuse it with the working `staging-api.bidiride.com`
> certificate.

---

## DNS and TLS — one authoritative zone, per-environment certificates

**Applied for staging.** The hosted zone `bidiride.com` exists
(`Z0146569VNVGTD6VDLMB`), the registrar delegates to its Route 53 nameservers,
the `staging-api.bidiride.com` certificate is ISSUED, and the alias record
resolves to the ALB. The sequence below is what produced that, and is the
procedure to repeat for **production**, which has not been applied.

`infrastructure/terraform/dns/` is a SEPARATE root module and state
(`dns/terraform.tfstate`) whose only job is to own the single authoritative
public hosted zone for `bidiride.com`.

Why separate: staging and production are the same root module rendered twice
against two state files. A zone resource there would be created **once per
state** — two authoritative zones with different nameservers, only one of which
the registrar can delegate to. Keeping the zone in its own state makes
duplication structurally impossible, and means `terraform destroy` on an
environment cannot reach the company domain.

The zone carries `lifecycle { prevent_destroy = true }`. Removing that is an
extraordinary action, justified only by a Founder-approved domain migration:
destroying the zone takes company DNS offline, and a recreated zone gets
**different nameservers**, requiring another registrar change and another
propagation window. Remove it, apply, restore it in the same change — never
leave it off.

Each environment owns its own certificate (`staging-api.bidiride.com` /
`api.bidiride.com`), its own validation record, and its own alias record. No
wildcard: a staging mistake can never present a certificate valid for
production.

### Execution sequence

Steps 1–5 are **done** — they created the shared zone and the delegation, which
exist once for the company and are not repeated per environment. Step 6 onward is
what production still needs.

1. **Delete the obsolete local `infrastructure/terraform/terraform.tfvars`.**
   Terraform auto-loads it and it still carries the old `api.bidride.com`
   hostname. `tf.sh` now refuses `plan`/`apply`/`destroy`/`import`/`refresh`/
   `taint`/`untaint`/`state`/`console` while it exists. Use only
   `env/<environment>.tfvars`.
2. Apply the DNS state:
   `cd infrastructure/terraform/dns && terraform init -reconfigure -backend-config=../env/dns.backend.hcl && terraform apply`
3. **Review the four nameservers**: `terraform output hosted_zone_name_servers`.
4. **Founder updates the GoDaddy nameservers** to those four values.
5. Confirm delegation: `dig +short NS bidiride.com` returns the Route 53 set.
6. Copy `terraform output hosted_zone_id` into `route53_zone_id` in
   `env/staging.tfvars`.
7. Apply staging. Terraform requests the certificate, writes the validation
   record, and blocks until ACM reports ISSUED.
8. Confirm ISSUED, then verify `staging-api.bidiride.com` resolves to the ALB.
9. Repeat 6–8 for production **only after staging is approved**.

Steps 2 and 7 are the first commands in this repository that create AWS
resources. Everything before them is reversible.

---

## Capacity profiles — staging is not a small production

Staging and production are the **same root module rendered twice**, against two
state files, differentiated by `var.environment` and the backend key. They must
differ in capacity without differing in security.

That is enforced by direction of travel: **every capacity variable defaults to
the production value**, and `env/staging.tfvars` opts *down* explicitly.

| Setting | Production (default) | Staging | Why staging can be smaller |
|---|---|---|---|
| NAT gateways | one per AZ | **1** | An AZ outage costing staging egress is acceptable |
| RDS Multi-AZ | true | **false** | No synchronous standby; AZ failure = downtime until restore |
| RDS read replicas | 2 | **0** | Nothing in this module reads from them; they exist to keep production analytics/admin load off the primary |
| RDS class / storage | db.r6g.large / 100 GB | **db.t4g.medium / 50 GB** | Migrations and controlled beta traffic only |
| Backup retention | 30 days | **7 days** | Never 0 — a validation block rejects it |
| Redis nodes | 3 | **1** | Cache loss rebuilds; nothing of record lives there |
| Log retention | 30 days | **7 days** | Long enough to debug a test session |
| Tasks per service | 1–2 | **1** (airport 0) | No redundancy target in staging |

**What is identical in both, and must stay identical:** encryption at rest and
in transit, private subnet placement for ECS/RDS/Redis, security-group
isolation, TLS policy, IAM boundaries, secret handling, automated backups,
health checks, and deployment rollback. Cost reduction comes from capacity and
redundancy — never from weaker security.

Three consequences worth internalising:

1. **An unset variable yields production.** A lost or truncated tfvars file
   cannot silently shrink production; it can only fail to shrink staging.
2. **`environment` has no default** and is validated against
   `["staging","production"]`, so an unset environment cannot fall through to
   production.
3. **Redis failover and Multi-AZ are derived** from `cache_num_cache_clusters`,
   not set independently — AWS rejects failover on a single node, so the
   invalid combination cannot be written in tfvars at all.

`airport-service` runs at desired_count **0** in staging: EWR is out of scope
for the first Founder test. It is deferred, not deleted — the service, its task
definition, log group and secrets all still exist. Raise it to 1 to enable.

### Bootstrap: a first apply must not schedule tasks

`terraform apply` creates the 21 Secrets Manager containers **empty** and the 12
ECR repositories **empty**. Every task definition consumes secrets through
`valueFrom` and pulls an image from ECR, so on a brand-new environment **no task
can start** — the image does not exist and the secrets have no values.

A service created at `desired_count = 1` would therefore try to launch, fail to
pull or fail to resolve its secrets, trip the deployment circuit breaker, and
bill Fargate for tasks that cannot run. Terraform itself would still finish
(`wait_for_steady_state` is not set, so it does not block on ECS stability), but
it would hand back a half-broken environment.

So a **first apply sets every service to 0** via `service_desired_counts` in
`env/staging.tfvars`. Infrastructure shape is complete; nothing is scheduled.

**Ownership is unambiguous, and this is why the bootstrap is safe:**

| Concern | Owner |
|---|---|
| Services, task definitions, ECR, ALB, IAM, alarms — the *shape* | Terraform |
| Which revision runs, and how many — the *runtime* | `deploy-service.sh` |

Every ECS service carries `lifecycle { ignore_changes = [task_definition, desired_count] }`.
Terraform sets the count **once at creation** and never touches it again, so
scaling up cannot be reverted by a later `terraform apply`. There is exactly one
owner at any moment, and no drift loop.

Scale a service up only when its image exists and every secret it consumes has a
value. Verify that with preflight rather than by inspection — it is read-only and
exits non-zero with the exact reason:

```bash
infrastructure/scripts/preflight-service.sh staging <service>-service <tag>
```

It checks the four things that have actually broken a staging deployment: the
`/health` route the ECS health check probes (ai-service had only `/live` and
`/ready`, so every probe 404'd and ECS killed the task while the app ran fine);
the task definition exists; every `config.getOrThrow()` variable is supplied by
that task definition; and every referenced secret holds an `AWSCURRENT` version —
an empty container fails task initialisation before the process starts, so
nothing is logged and the service cannot tell you why.

Both scripts accept either `auth` or `auth-service`; the full name is written
here because it is what `deploy-fleet.sh` lists and what the ECR repository is
called. Once preflight exits 0:

```bash
infrastructure/scripts/deploy-service.sh staging <service>-service <tag> --desired-count 1
```

On a service still pinned to the `:bootstrap` tag, establish a rollback baseline
first — this registers a digest-pinned revision and makes it PRIMARY **without**
launching a task, so a later circuit-breaker rollback lands on a pullable image:

```bash
infrastructure/scripts/deploy-service.sh staging <service>-service <tag> --desired-count 0
```

Omit `--desired-count` on subsequent deploys — the current count is preserved.

An explicit `--desired-count 0` is the baseline above and **exits 0**: it did what
was asked. A service found at 0 *without* being asked still fails with an explicit
message rather than reporting a deploy that put nothing into service.

### What still costs money when nobody is testing

NAT gateway, ALB, RDS instance and storage, Redis node, and the Secrets Manager
entries bill hourly regardless of traffic. Fargate bills only for running tasks,
so `service_desired_counts` set to all-zero is the lever that idles staging
between test windows without destroying it. RDS and NAT are the floor.

---

## The one rule that governs everything below

**`terraform apply` is NOT a deployment.**

Every ECS service in this stack carries `lifecycle { ignore_changes = [task_definition] }`.
Terraform *registers* task-definition revisions; it never moves a service onto
one. A shape change — a new secret, a new environment variable — is not live
until `deploy-service.sh` has explicitly pointed the service at a revision
containing it.

This is deliberate. Terraform owns the task definition's **shape**; the
pipeline owns its **image**. If Terraform also asserted the running revision,
every apply would roll the fleet back to the bootstrap image and undo the last
deploy.

The failure mode this replaced is worth remembering: `aws ecs update-service
--force-new-deployment` (with no `--task-definition`) restarts tasks on the
revision the service is *already* pinned to. It looks identical to a successful
deploy at every checkpoint — services reach `stable`, health checks return 200,
smoke tests pass — while the change you applied never reached production.
**Never deploy with `--force-new-deployment`.**

Deployment is therefore always three steps:

| Step | Command | What it does |
|---|---|---|
| 1. Shape | `scripts/tf.sh <env> apply` | Registers new task-definition revisions |
| 2. Deploy | `scripts/deploy-fleet.sh <env> <sha>` | Moves services onto them, **by explicit ARN** |
| 3. Prove | `scripts/verify-deployment.sh <env> all` | Confirms what is actually running |

---

## Prerequisites

| Tool | Minimum Version | Install |
|------|----------------|---------|
| AWS CLI | 2.x | `brew install awscli` |
| Terraform | ≥ 1.8 | `brew install terraform` |
| jq | 1.6+ | `brew install jq` |
| OpenSSL | 1.1+ / 3.x | `brew install openssl` |
| Docker Desktop | 4.x | docker.com |
| pnpm | 9.x | `npm install -g pnpm@9` |
| Node.js | 20 LTS | `brew install node@20` |

`jq` and `openssl` are required by the deployment and verification scripts, not
optional conveniences.

### AWS IAM Permissions Required

The deploying IAM user/role must have:
- `AdministratorAccess` for first deploy (creates VPC, IAM roles, RDS, etc.)
- For subsequent deploys: ECS, ECR, SecretsManager read/write

### AWS CLI Setup

```bash
aws configure
# AWS Access Key ID: [your key]
# AWS Secret Access Key: [your secret]
# Default region: us-east-1
# Default output format: json

# Verify
aws sts get-caller-identity
```

---

## Phase 1 — Terraform State Backend Bootstrap (ONE TIME ONLY)

Run once before `terraform init`. If the bucket already exists, skip.

State locking uses an S3-native lock file (`use_lockfile = true`, Terraform ≥ 1.10).
No DynamoDB table is required.

```bash
# Create and harden the state bucket
aws s3api create-bucket \
  --bucket bidride-terraform-state \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket bidride-terraform-state \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket bidride-terraform-state \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

---

## Phase 2 — ACM Certificate (ONE TIME ONLY)

```bash
# Request wildcard cert for api.bidiride.com and *.bidiride.com
aws acm request-certificate \
  --domain-name api.bidiride.com \
  --validation-method DNS \
  --subject-alternative-names "*.bidiride.com" \
  --region us-east-1

# Get the CNAME validation records to add at your registrar
aws acm describe-certificate \
  --certificate-arn <ARN from above> \
  --region us-east-1 \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'

# Wait until ISSUED (5-30 min after DNS propagates)
aws acm wait certificate-validated \
  --certificate-arn <ARN> \
  --region us-east-1
```

Copy the certificate ARN into `env/<env>.tfvars` as `acm_certificate_arn`.

---

## Phase 3 — Terraform Init & Plan

Terraform is **environment-scoped**. The backend `key` and the variable file
together decide whether you are touching staging or production, so both are
selected by one argument through the wrapper. Do not run bare `terraform` in
this directory.

```bash
# First-time setup for an environment (<env> = staging | production)
cd infrastructure/terraform
cp env/<env>.tfvars.example env/<env>.tfvars
# Edit env/<env>.tfvars — fill in:
#   db_password (32+ chars, save to 1Password)
#   acm_certificate_arn
#   founder_email
#   founder_signing_public_key (RSA public key for Founder JWT verification)
# NOT google_maps_api_key — that variable no longer exists. The key is the
# Secrets Manager container bidride/<env>/google-maps-api-key, populated after
# apply, so it never reaches Terraform state or the task-definition JSON.
#   jwt_signing_alg — LEAVE AS "HS256". See RS256_ROLLOUT_RUNBOOK.md.
# env/<env>.tfvars is gitignored. Never commit it.

cd "$(git rev-parse --show-toplevel)"
infrastructure/scripts/tf.sh <env> fmt -check    # must pass
infrastructure/scripts/tf.sh <env> validate      # must pass
infrastructure/scripts/tf.sh <env> plan          # writes <env>.tfplan
```

The wrapper runs `terraform init -reconfigure -backend-config=env/<env>.backend.hcl`
for you, and re-initialises automatically if the working directory was last
used for the *other* environment — which is the mistake that would otherwise
plan staging against production state.

State keys:

| State | Backend key | Root module | Owns |
|---|---|---|---|
| staging | `staging/terraform.tfstate` | `terraform/` | per-environment infrastructure |
| production | `production/terraform.tfstate` | `terraform/` | per-environment infrastructure |
| shared DNS | `dns/terraform.tfstate` | `terraform/dns/` | the one authoritative hosted zone |
| shared account | `account/terraform.tfstate` | `terraform/account/` | account+region singletons (ECR registry scanning) |

staging and production are the **same root module** rendered twice, differentiated
only by `var.environment` and the backend key. Anything that exists exactly once
per AWS account therefore cannot live there — both states would declare it and
overwrite each other on every apply, reporting perpetual drift. That is why the
hosted zone lives in `dns/` and registry-level ECR scanning lives in `account/`.

`account/` is **not yet created** — initialising that state is a Founder gate.

`production/terraform.tfstate` is byte-identical to the key that used to be
hardcoded in `main.tf`, so initialising with the wrapper targets the **existing**
production state. No migration is required.

Review the plan carefully. Approximate resource count: ~230 — VPC (28), ECS
services + task defs + IAM (54), ECR (24), Secrets Manager (19), Cloud Map (13),
CloudWatch log groups + alarms + metric filters (60), RDS (3), ElastiCache (1),
S3 (16), SQS (16), ALB + listeners + TGs + rules (25), KMS keys + aliases (6),
SNS (2), misc (9).

**STOP HERE. Show terraform plan output to Founder for approval before apply.**

---

## Phase 4 — Terraform Apply (REQUIRES FOUNDER APPROVAL)

```bash
infrastructure/scripts/tf.sh <env> apply       # consumes the reviewed <env>.tfplan

# After apply, save outputs to 1Password:
infrastructure/scripts/tf.sh <env> output -json > /tmp/bidride-tf-outputs.json
# Contains: rds_endpoint, redis_endpoint, alb_dns_name, ecs_cluster_name,
#           bucket names, kms_jwt_user_key_id, kms_jwt_admin_key_id,
#           alerts_topic_arn, jwt_verifier_services
rm /tmp/bidride-tf-outputs.json  # don't leave outputs on disk
```

> **Apply has changed nothing that is serving traffic.** It registered new
> task-definition revisions. The running fleet is still on its previous
> revisions until Phase 9. Expect the plan to show `aws_ecs_task_definition`
> changes and **zero** `aws_ecs_service` changes — that is correct, not a
> problem.

### One-time: confirm the alert subscription

`terraform apply` creates the `bidride-alerts-<env>` SNS topic and subscribes
`founder_email`. AWS sends a confirmation email; **until someone clicks it,
every CloudWatch alarm in the stack notifies nobody.**

```bash
aws sns list-subscriptions-by-topic \
  --topic-arn "$(infrastructure/scripts/tf.sh <env> output -raw alerts_topic_arn)" \
  --query 'Subscriptions[].[Endpoint,SubscriptionArn]' --output table
```
`SubscriptionArn` must not read `PendingConfirmation`.

### Post-Apply DNS

```bash
# Get the ALB DNS name
terraform output alb_dns_name

# Add a CNAME record in your DNS registrar:
#   api.bidiride.com → <alb_dns_name>
# Propagation: 5-15 minutes

# Verify
curl -I https://api.bidiride.com/
# Expected: 404 (ALB default response — services not up yet)
```

---

## Phase 5 — Secrets Manager Population

See `infrastructure/SECRETS_CHECKLIST.md` for the full list.

```bash
# Template for each secret
aws secretsmanager put-secret-value \
  --secret-id "bidride/production/SECRET-NAME" \
  --secret-string "VALUE" \
  --region us-east-1

# Verify all 19 secrets are populated
aws secretsmanager list-secrets \
  --filter Key=name,Values=bidride/production \
  --query 'SecretList[].Name' \
  --output table \
  --region us-east-1
```

---

## Phase 6 — ECR Build & Push

```bash
# Authenticate Docker to ECR
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_BASE="${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com"

aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin "${ECR_BASE}"

# Build and push all 12 services
# ECR repo naming: bidride/<service-name> (with slash — matches Terraform)
for svc in auth-service trip-service driver-service rider-service pricing-service \
           safety-service payment-service notification-service trust-service \
           airport-service admin-service ai-service; do
  echo "Building ${svc}..."
  docker build \
    -f services/Dockerfile.template \
    --build-arg SERVICE_NAME=${svc} \
    --build-arg PORT=$(grep -A2 "\"${svc}\"" infrastructure/terraform/ecs-services.tf | grep "port" | grep -oE "[0-9]{4}" | head -1) \
    -t "${ECR_BASE}/bidride/${svc}:latest" \
    .
  docker push "${ECR_BASE}/bidride/${svc}:latest"
  echo "✓ ${svc} pushed"
done
```

---

## Phase 7 — Database Migration

Run the Prisma migration against the production RDS instance using an ECS task override.
The auth-service task definition has DATABASE_URL injected from Secrets Manager.

```bash
# Get subnet and security group IDs from Terraform outputs
CLUSTER="bidride-production"
TASK_DEF="bidride-auth-service-production"
SUBNETS=$(aws ec2 describe-subnets \
  --filters "Name=tag:Name,Values=bidride-production-private-*" \
  --query 'Subnets[].SubnetId' --output text | tr '\t' ',')
ECS_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=bidride-ecs-production" \
  --query 'SecurityGroups[0].GroupId' --output text)

# Run migration.
#
# Both paths MUST be absolute. The image's WORKDIR is /app/services/<service>
# (dist has to sit beside its own node_modules for pnpm's symlinks to resolve),
# so every path relative to /app breaks. And pnpm does not populate
# /app/node_modules/.bin — the real prisma binary lives under the .pnpm store.
# Verified inside the image:
#   /app/node_modules/.pnpm/node_modules/.bin/prisma   EXISTS
#   /app/node_modules/.bin/prisma                      MISSING
#   /app/packages/database/prisma/schema.prisma        EXISTS
aws ecs run-task \
  --cluster "${CLUSTER}" \
  --task-definition "${TASK_DEF}" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${ECS_SG}],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"auth-service","command":["node","/app/node_modules/.pnpm/node_modules/.bin/prisma","migrate","deploy","--schema","/app/packages/database/prisma/schema.prisma"]}]}' \
  --region us-east-1

# Monitor the task until it stops (exit code 0 = migration successful)
TASK_ARN=$(aws ecs list-tasks --cluster "${CLUSTER}" --family "${TASK_DEF}" --query 'taskArns[0]' --output text)
aws ecs wait tasks-stopped --cluster "${CLUSTER}" --tasks "${TASK_ARN}"
aws ecs describe-tasks --cluster "${CLUSTER}" --tasks "${TASK_ARN}" \
  --query 'tasks[0].containers[0].exitCode'
# Must be 0
```

---

## Phase 8 — Seed Founder Admin

```bash
# Run seed from a local machine with DATABASE_URL pointing to production
# (or use ECS run-task override with the seed script)
DATABASE_URL="postgresql://bidride_admin:PASSWORD@RDS_ENDPOINT:5432/bidride" \
  pnpm db:seed
```

---

## Phase 9 — ECS Service Deployment

This is the step that makes Phase 4 live. Until it runs, the fleet is still on
its old revisions.

```bash
# <env> = staging | production ; <sha> = the git SHA the pipeline built
infrastructure/scripts/deploy-fleet.sh <env> <sha>
```

`deploy-fleet.sh` deploys **one service at a time**, and each service must both
stabilise and pass verification before the next one starts. Any failure halts
the run and prints the rollback commands for whatever already landed.

### What each service deploy actually does

`deploy-service.sh` — invoked per service by the fleet script — performs:

1. **Records the currently deployed ARN.** This is the rollback target, written
   to `infrastructure/deploy-records/<env>/<service>.json` *before* anything
   changes.
2. **Reads the latest ACTIVE revision** of `bidride-<service>-<env>` — the shape
   Terraform most recently registered.
3. **Resolves `<sha>` to an image digest** and pins the revision to
   `repo@sha256:…`. Deployments never reference a tag.
4. **Registers** that revision.
5. **`aws ecs update-service --task-definition <exact ARN>`.** Not
   `--force-new-deployment`.
6. **Waits** for `rolloutState=COMPLETED` and `running == desired`.
7. **Proves it** — enumerates every running task and asserts they are all on the
   ARN just deployed. `services-stable` alone is necessary but not sufficient:
   a service can be "stable" while still serving an older revision.

### Deployment order (not arbitrary)

| Position | Service(s) | Why |
|---|---|---|
| 1 | safety-service | Its failure is a safety incident, not an outage. Clean fleet, full gate. |
| 2 | trip-service | F4 cross-service contract — must fully drain before payment-service. |
| 3 | payment-service | Depends on the trip-service contract above. |
| 4–10 | driver, rider, pricing, notification, trust, airport, ai | Remaining verifiers and internal services. |
| 11 | auth-service | **Token issuer.** Every verifier must already hold the keyset. |
| 12 | admin-service | **Admin token issuer.** Same reason. |

Issuers deploy **last** so that no token can ever exist which some verifier
cannot check. Reversing this during an RS256 rollout would mint RS256 tokens
that unrolled verifiers reject — a fleet-wide 401 storm.

> **Payment-integrity releases** still follow
> `docs/payment-integrity-deployment-runbook.md` for the rollback *ordering*
> (payment-service first, then trip-service). The forward order above already
> satisfies its deploy-order requirement.

To deploy a subset — a single-service hotfix, or resuming a halted run:

```bash
infrastructure/scripts/deploy-fleet.sh <env> <sha> --only trip-service,payment-service
```

---

## Phase 10 — Post-Deploy Verification

Three scripts, three different questions. Run all three.

```bash
# 1. CONFIGURATION — "is it running what I deployed?"  ← the one that matters
bash infrastructure/scripts/verify-deployment.sh <env> all

# 2. LIVENESS — "is it up?"
BIDRIDE_API_URL=https://api.bidiride.com bash infrastructure/scripts/smoke-test.sh

# 3. FUNCTION — "does a real request work?"
BIDRIDE_API_URL=https://api.bidiride.com \
BIDRIDE_ADMIN_EMAIL=marq@bidiride.com \
BIDRIDE_ADMIN_PASS=your-admin-password \
bash infrastructure/scripts/post-deploy-verify.sh
```

`verify-deployment.sh` is the one that closes the gap the other two cannot.
Health checks pass whether or not the keyset loaded; it proves:

| # | Check | How |
|---|---|---|
| 1 | Correct revision deployed | Every running task on ONE revision, and it is the latest ACTIVE. Image digest-pinned. |
| 2 | `JWT_PUBLIC_KEYS` loaded | Revision references the secret; secret holds a schema-valid keyset; tasks are RUNNING on that revision. |
| 3 | `JWT_ADMIN_PUBLIC_KEYS` loaded | Same, admin domain. Plus: the two keysets share no key material. |
| 4 | Signing algorithm | Configured value on the deployed revision **and** the boot log line agree. |
| 5 | KMS key | Each signer points at its own domain's key; its task role grants `kms:Sign` on exactly that key and cannot reach the other. |
| 6 | RS256 verification | A real `kms:Sign` signature over a real JWT signing input, verified against the **published keyset** with openssl. |

On (2) and (3): a container's environment cannot be read back from outside, so
the proof is a chain — the revision references the secret, the secret has a
valid value, and ECS placed RUNNING tasks on that revision. ECS refuses to start
a task whose `secrets` entry cannot resolve, so running tasks are positive
evidence the value was injected.

Check (6) is the end-to-end proof that a token the issuer mints is one the
verifiers can check. It runs even while `jwt_signing_alg = HS256` — it tests the
key material, not the live token path — so the RS256 rollout is de-risked before
it is switched on. It signs an inert payload and issues no usable credential.

All checks must pass before declaring the deployment successful.

---

## Rollback Procedure

> **Payment-integrity releases have a required rollback order:** payment-service
> first, drained fully, then trip-service. Rolling back trip-service first
> recreates the broken pairing and fails every bid authorization. See
> `docs/payment-integrity-deployment-runbook.md`.

### Fast Rollback (< 5 min): Revert to an EXACT Task-Definition ARN

```bash
# Uses the ARN recorded before the deploy touched anything.
bash infrastructure/scripts/rollback-service.sh <env> <service>

# Or target an ARN explicitly (incident recovery, older revision):
bash infrastructure/scripts/rollback-service.sh <env> <service> arn:aws:ecs:...:task-definition/bidride-<service>-<env>:41
```

Rollback targets live in `infrastructure/deploy-records/<env>/<service>.json`,
written by `deploy-service.sh` *before* it changes anything. CI uploads the same
records as the `deploy-records-<env>-<sha>` artifact on every run, including
failed ones. If both are gone:

```bash
aws ecs list-task-definitions --family-prefix bidride-<service>-<env> \
  --status ACTIVE --sort DESC --max-items 10
```

The script refuses to proceed unless the target exists and is `ACTIVE`, and
warns if the target predates digest pinning.

There is also a `workflow_dispatch` rollback: **Actions → BidRide Rollback**.
It takes the exact ARN, validates it belongs to the named service, keeps the
production approval gate, notifies SNS, and re-runs verification afterwards.

#### Why not "current revision minus one"

The previous procedure computed `CURRENT_REV - 1`. It was wrong three ways, and
all three are now structurally impossible:

| Old defect | Why it broke | Fixed by |
|---|---|---|
| Arithmetic on a stale pin | Under `ignore_changes`, the service's revision lags the family's latest, so `-1` lands an unpredictable number of generations back | Replaying a recorded ARN — no arithmetic |
| Reverted config but not code | Every revision referenced the mutable `:latest` tag, so the container still pulled whatever was newest | Digest pinning: `repo@sha256:…` |
| No existence check | Could target a deregistered revision, or produce `:0` at revision 1 | `describe-task-definition` + `ACTIVE` assertion |

#### ECS-native automatic rollback

Every service now sets `deployment_circuit_breaker { enable = true, rollback = true }`.
A deployment that cannot reach a steady state is failed and reverted by ECS
itself, without human intervention. `deploy-service.sh` detects
`rolloutState=FAILED` and stops the fleet run rather than continuing into a
half-deployed fleet.

### Full Rollback: Revert Git + Redeploy

```bash
# Find last known good commit
git log --oneline -10

# Tag the bad deploy for investigation
git tag bad-deploy-$(date +%Y%m%d) HEAD

# Reset to last known good
git checkout <good-sha>

# Rebuild and push images
# ... (same as Phase 6)

# Redeploy
# ... (same as Phase 9)
```

---

## Database Backup & Restore

### Manual Snapshot

```bash
aws rds create-db-snapshot \
  --db-instance-identifier bidride-production \
  --db-snapshot-identifier bidride-manual-$(date +%Y%m%d-%H%M%S) \
  --region us-east-1

# List available snapshots
aws rds describe-db-snapshots \
  --db-instance-identifier bidride-production \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier,SnapshotCreateTime,Status]' \
  --output table
```

### Point-In-Time Restore

RDS automated backups retain 30 days. To restore to a specific time:

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier bidride-production \
  --target-db-instance-identifier bidride-production-restored \
  --restore-time 2026-06-24T03:00:00Z \
  --region us-east-1

# After restore, verify data, then update DATABASE_URL secret to point to restored instance
```

### Restore from Snapshot

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier bidride-production-restore \
  --db-snapshot-identifier <snapshot-id> \
  --db-subnet-group-name bidride-production \
  --vpc-security-group-ids <rds-sg-id> \
  --region us-east-1
```

---

## Emergency Shutdown Procedure

**Only use this during active security incidents or catastrophic failures.**

```bash
# Step 1: Scale down all ECS services to 0 (preserve task definitions)
CLUSTER="bidride-production"
for svc in auth-service trip-service driver-service rider-service pricing-service \
           safety-service payment-service notification-service trust-service \
           airport-service admin-service ai-service; do
  aws ecs update-service \
    --cluster "${CLUSTER}" \
    --service "bidride-${svc}-production" \
    --desired-count 0
done

# Step 2: Disable ALB (optional — blocks all traffic immediately)
# Update security group to block inbound 443 from 0.0.0.0/0
ALB_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=bidride-alb-production" \
  --query 'SecurityGroups[0].GroupId' --output text)
aws ec2 revoke-security-group-ingress \
  --group-id "${ALB_SG}" \
  --protocol tcp --port 443 --cidr 0.0.0.0/0

# Step 3: Notify ops team immediately
# To bring back up: restore desired_count and re-add SG ingress rule
```

---

## Common Failure Fixes

### Service fails to start — Secret not found

```bash
# Check CloudWatch logs
aws logs filter-log-events \
  --log-group-name "/ecs/bidride/auth-service-production" \
  --start-time $(date -d '10 minutes ago' +%s000) \
  --filter-pattern "ERROR"

# Common cause: secret not populated in Secrets Manager.
# ECS refuses to start a task whose `secrets` entry resolves to an empty secret,
# so this presents as tasks that never reach RUNNING.
aws secretsmanager put-secret-value \
  --secret-id "bidride/production/SECRET-NAME" \
  --secret-string "VALUE"

# Then restart the service ON ITS CURRENT REVISION to re-resolve secret VALUES.
# Re-issuing the CURRENT ARN is a restart, not a deployment: the task definition
# already references the secret and only its value changed. Naming the ARN
# explicitly (rather than --force-new-deployment) keeps one habit for every
# update-service call — you always say which revision you mean.
CURRENT=$(aws ecs describe-services --cluster bidride-production \
  --services bidride-auth-service-production \
  --query 'services[0].taskDefinition' --output text)
aws ecs update-service --cluster bidride-production \
  --service bidride-auth-service-production \
  --task-definition "$CURRENT"
```

If the secret is a NEW reference (it was added to the task definition by a
Terraform change), restarting is not enough — the running revision does not
reference it at all. Run the real deployment path:
`infrastructure/scripts/deploy-fleet.sh production <sha> --only auth-service`.

### Service fails to start — Database connection refused

```bash
# Check RDS is running
aws rds describe-db-instances \
  --db-instance-identifier bidride-production \
  --query 'DBInstances[0].DBInstanceStatus'

# Check ECS security group allows 5432 to RDS security group
aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=bidride-rds-production" \
  --query 'SecurityGroups[0].IpPermissions'
```

### Health check failing — 504 from ALB

```bash
# Check target group health
aws elbv2 describe-target-health \
  --target-group-arn <TG_ARN> \
  --query 'TargetHealthDescriptions[*].[Target.Id,TargetHealth.State,TargetHealth.Reason]' \
  --output table

# Check service logs for startup errors
aws logs tail /ecs/bidride/trip-service-production --follow
```

### Redis connection failed

```bash
# Check ElastiCache cluster status
aws elasticache describe-replication-groups \
  --replication-group-id bidride-production \
  --query 'ReplicationGroups[0].Status'

# Note: Redis URL uses rediss:// (TLS) for production
# Local dev uses redis:// — make sure production secrets use rediss://
```

### ECS task stopped immediately (exit code 1)

```bash
# Get stopped reason
aws ecs describe-tasks \
  --cluster bidride-production \
  --tasks <task-arn> \
  --query 'tasks[0].{Status:lastStatus,StopCode:stopCode,Reason:stoppedReason,ExitCode:containers[0].exitCode}'
```

### Terraform state locked

```bash
# If a previous apply was interrupted, the S3 lock file must be removed.
# Lock file path: production/terraform.tfstate.tflock
aws s3 rm s3://bidride-terraform-state/production/terraform.tfstate.tflock \
  --region us-east-1
```

---

## ALB / ACM / DNS Verification

```bash
# Verify HTTPS is terminating at ALB
curl -vI https://api.bidiride.com/ 2>&1 | grep -E "SSL|certificate|HTTP"

# Check certificate expiry
echo | openssl s_client -connect api.bidiride.com:443 2>/dev/null | \
  openssl x509 -noout -dates

# Verify ALB listener rules
aws elbv2 describe-rules \
  --listener-arn <HTTPS_LISTENER_ARN> \
  --query 'Rules[*].[Priority,Conditions[0].Values,Actions[0].TargetGroupArn]' \
  --output table

# Trace a request path (e.g., /trips/* → trip-service)
curl -sv https://api.bidiride.com/trips/non-existent \
  -H "Authorization: Bearer test" 2>&1 | grep -E "< HTTP|location"
```
