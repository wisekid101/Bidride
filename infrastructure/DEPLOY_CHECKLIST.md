# BidiRide — AWS Cloud Internal Alpha Deployment Checklist

Run each section in order. Check off items as you complete them.
Do NOT share this file publicly — it references secret names.

---

## Pre-flight (local, before any AWS work)

- [ ] `pnpm typecheck` — all 16 packages pass
- [ ] `pnpm test` — all tests pass
- [ ] `pnpm build` — all 14 tasks succeed
- [ ] AWS CLI installed: `aws --version`
- [ ] AWS CLI configured: `aws sts get-caller-identity`
- [ ] Terraform installed ≥ 1.8: `terraform version`
- [ ] Docker installed (for ECR push): `docker --version`
- [ ] You have IAM permissions: EC2, ECS, ECR, RDS, ElastiCache, S3, SQS, IAM, SecretsManager, CloudWatch, Route53 (or AdministratorAccess for first deploy)

---

## Phase 1 — Terraform State Backend Bootstrap

The S3 bucket and DynamoDB table for Terraform state must exist before `tf.sh <env> init`.
Run once, manually:

```bash
# Create state bucket (bucket name must match main.tf backend block)
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

# Create DynamoDB lock table
aws dynamodb create-table \
  --table-name bidride-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

- [ ] `bidride-terraform-state` S3 bucket created with versioning + encryption
- [ ] `bidride-terraform-locks` DynamoDB table created

---

## Phase 2 — ACM Certificate

Your API domain must have a valid ACM certificate before the ALB HTTPS listener can be created.

```bash
# Request certificate (DNS validation recommended)
aws acm request-certificate \
  --domain-name api.bidiride.com \
  --validation-method DNS \
  --subject-alternative-names "*.bidiride.com" \
  --region us-east-1
```

- [ ] Certificate requested in `us-east-1`
- [ ] DNS CNAME records added to your domain registrar
- [ ] Certificate status = ISSUED: `aws acm list-certificates --region us-east-1`
- [ ] ARN copied into `env/<env>.tfvars` as `acm_certificate_arn`

---

## Phase 3 — Terraform Init & Plan

```bash
# Copy and edit variables for the target environment (<env> = staging|production)
cd infrastructure/terraform
cp env/<env>.tfvars.example env/<env>.tfvars
# Edit env/<env>.tfvars — set db_password, acm_certificate_arn, founder_email.
# Leave jwt_signing_alg = "HS256" (see infrastructure/RS256_ROLLOUT_RUNBOOK.md).

# Init + plan, environment-scoped. The wrapper selects the backend key and the
# var file together, so staging can never plan against production state.
cd "$(git rev-parse --show-toplevel)"
infrastructure/scripts/tf.sh <env> init
infrastructure/scripts/tf.sh <env> plan
```

- [ ] `tf.sh <env> init` — successful
- [ ] `tf.sh <env> plan` — no errors, review resource count (~230)
- [ ] Review: VPC, subnets, security groups look correct
- [ ] Review: RDS Multi-AZ, ElastiCache 3-node cluster
- [ ] Review: 11 ALB target groups, 12 listener rules
- [ ] Review: 12 ECS task definitions (11 ALB + 1 internal ai-service)
- [ ] Review: 21 Secrets Manager secrets (5 shared + 16 per-service)
- [ ] Review: 12 CloudWatch log groups, 5 base alarms, deployment/JWT metric filters + alarms
- [ ] Review: IAM execution role + shared task role + auth/admin signer task roles
- [ ] Review: SNS alert topic `bidride-alerts-<env>` and its email subscription
- [ ] Review: **zero `aws_ecs_service` changes** on a re-apply — expected, see Phase 8

**Get Founder approval before running apply.**

---

## Phase 4 — Terraform Apply

```bash
# REQUIRES FOUNDER APPROVAL — this creates real AWS resources (~$400–600/month)
infrastructure/scripts/tf.sh <env> apply
```

> **Apply is not a deployment.** It registers task-definition revisions; nothing
> runs them until Phase 8. See `infrastructure/DEPLOYMENT_RUNBOOK.md`.

Expected outputs after apply:
- `rds_endpoint` — RDS writer endpoint
- `redis_endpoint` — ElastiCache primary endpoint
- `alb_dns_name` — ALB DNS name (add CNAME in Route53/registrar → api.bidiride.com)
- `ecs_cluster_name`
- `documents_bucket`, `recordings_bucket`

- [ ] `terraform apply` — successful, 0 errors
- [ ] Copy outputs to a secure note
- [ ] Add `alb_dns_name` as CNAME for `api.bidiride.com` in Route53
- [ ] Verify HTTPS: `curl -I https://api.bidiride.com/` → 404 (ALB default response — services not up yet)

---

## Phase 5 — Secrets Population

See `infrastructure/SECRETS_CHECKLIST.md` for the complete list of secrets to populate.

```bash
# Shortcut helper (replace VALUE with real secret)
aws secretsmanager put-secret-value \
  --secret-id "bidride/production/SECRET-NAME" \
  --secret-string "VALUE" \
  --region us-east-1
```

- [ ] All 13 secrets populated (verify with SECRETS_CHECKLIST.md)
- [ ] Test retrieval: `aws secretsmanager get-secret-value --secret-id bidride/production/jwt-secret`

---

## Phase 6 — ECR Build & Push

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  $(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com

# Build and push each service (run from repo root)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_BASE="${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com"

# The DEPLOYABLE tag. Immutable, one per commit — this is what Phase 8 resolves
# to a digest. :latest is pushed only as a Docker layer cache source and is
# never deployed from.
SHA=$(git rev-parse HEAD)

for svc in auth-service trip-service driver-service rider-service pricing-service \
           safety-service payment-service notification-service trust-service \
           airport-service admin-service ai-service; do
  echo "Building $svc..."
  docker build -f services/Dockerfile.template --build-arg SERVICE_NAME="${svc}" \
    -t "${ECR_BASE}/bidride/${svc}:${SHA}" \
    -t "${ECR_BASE}/bidride/${svc}:latest" \
    --cache-from "${ECR_BASE}/bidride/${svc}:latest" .
  docker push "${ECR_BASE}/bidride/${svc}:${SHA}"
  docker push "${ECR_BASE}/bidride/${svc}:latest"
  echo "✓ $svc pushed"
done
echo "Deploy this SHA in Phase 8: ${SHA}"
```

- [ ] All 12 images built successfully
- [ ] All 12 images pushed to ECR, tagged with the git SHA
- [ ] SHA recorded for Phase 8
- [ ] Digest visible in ECR console

---

## Phase 7 — Database Migration

Run migrations against the production RDS instance from a bastion host or via ECS run-task.

```bash
# Option A: ECS run-task (no bastion needed)
aws ecs run-task \
  --cluster bidride-production \
  --task-definition bidride-auth-service-production \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[PRIVATE_SUBNET_ID],securityGroups=[ECS_SG_ID],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"auth-service","command":["node","/app/node_modules/.pnpm/node_modules/.bin/prisma","migrate","deploy","--schema","/app/packages/database/prisma/schema.prisma"]}]}' \
  --region us-east-1
```

Absolute paths are required — see DEPLOYMENT_RUNBOOK.md Phase 7 for why. Do not
use `npx`: the task runs in a private subnet with no route to the npm registry,
and prisma is not linked into `/app/node_modules/.bin`, so npx would try to fetch
it and hang until the task times out.

- [ ] Migration applied to production RDS
- [ ] Seed founder admin: run seed script against production DB
- [ ] Verify: `SELECT COUNT(*) FROM users;` returns ≥ 1

---

## Phase 8 — ECS Service Deployment

After images are pushed and secrets are set:

```bash
# <sha> is the git commit whose images were pushed in the build phase.
infrastructure/scripts/deploy-fleet.sh production <sha>
```

Ordered (safety-service first, token issuers last), one service at a time, each
deployed **by explicit task-definition ARN** with a digest-pinned image and
verified before the next begins.

> ⚠️ The loop that used to be here ran `aws ecs update-service
> --force-new-deployment` across all 12 services. That restarts each service on
> the revision it is **already** pinned to — so newly-applied task-definition
> changes (new secrets, new environment variables) never shipped, while the
> checklist below still ticked green. Do not reintroduce it.

- [ ] `deploy-fleet.sh` completed without halting
- [ ] Every service reports `verified: all N task(s) on <arn>`
- [ ] `bash infrastructure/scripts/verify-deployment.sh production all` passes
- [ ] CloudWatch log groups receiving logs

---

## Phase 9 — Post-Deploy Verification

Three scripts, three different questions. Run all three.

```bash
# 1. CONFIGURATION — "is it running what I deployed?"
#    Proves revision, keysets, signing algorithm, KMS key, RS256 round trip.
#    Health checks pass whether or not the keyset loaded; this is what catches that.
bash infrastructure/scripts/verify-deployment.sh production all

# 2. LIVENESS — "is it up?"
export BIDRIDE_API_URL="https://api.bidiride.com"
bash infrastructure/scripts/smoke-test.sh

# 3. FUNCTION — "does a real request work?"
bash infrastructure/scripts/post-deploy-verify.sh
```

- [ ] All 12 health checks green
- [ ] OTP request + verify returns JWT
- [ ] Trip create succeeds
- [ ] Admin login succeeds
- [ ] AI health returns model status

---

## Phase 10 — Internal Alpha Go-Live

- [ ] Share API URL with alpha testers
- [ ] Confirm admin portal accessible at `https://admin.bidiride.com` (or via port-forward)
- [ ] Set `INTERNAL_SERVICE_KEY` in all calling services and ai-service
- [ ] Rotate initial seed admin password (marq@bidiride.com → new password)
- [ ] CloudWatch alarms have SNS topic with on-call email/PagerDuty
- [ ] Monitor ECS service CPU/memory for first 30 minutes

---

## Estimated Cost (us-east-1, production sizing)

| Resource | Monthly estimate |
|----------|-----------------|
| RDS db.r6g.large Multi-AZ + 2 replicas | ~$350 |
| ElastiCache cache.r6g.large × 3 nodes | ~$200 |
| ECS Fargate (12 services, 0.25–1 vCPU) | ~$80 |
| ALB | ~$20 |
| NAT Gateways (3) | ~$100 |
| S3 + CloudWatch + SQS | ~$15 |
| **Total** | **~$765/month** |

**For internal alpha cost reduction**, change these in `env/<env>.tfvars`:
```
db_instance_class = "db.t4g.medium"   # saves ~$280/month, no replicas needed
cache_node_type   = "cache.t4g.micro" # saves ~$175/month, single node OK
```
Alpha sizing: ~$185/month.
