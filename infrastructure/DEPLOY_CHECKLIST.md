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

The S3 bucket and DynamoDB table for Terraform state must exist before `terraform init`.
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
- [ ] ARN copied into `terraform.tfvars` as `acm_certificate_arn`

---

## Phase 3 — Terraform Init & Plan

```bash
cd infrastructure/terraform

# Copy and edit variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — set db_password, acm_certificate_arn, founder_email

# Initialize (downloads providers, connects to state backend)
terraform init

# Review the plan — expected: ~80 resources to create
terraform plan -out=bidride.tfplan
```

- [ ] `terraform init` — successful
- [ ] `terraform plan` — no errors, review resource count
- [ ] Review: VPC, subnets, security groups look correct
- [ ] Review: RDS Multi-AZ, ElastiCache 3-node cluster
- [ ] Review: 11 ALB target groups, 12 listener rules
- [ ] Review: 12 ECS task definitions (11 ALB + 1 internal ai-service)
- [ ] Review: 13 Secrets Manager secrets (4 shared + 9 per-service)
- [ ] Review: 11 CloudWatch log groups + 4 alarms
- [ ] Review: IAM execution role + task role

**Get Founder approval before running apply.**

---

## Phase 4 — Terraform Apply

```bash
# REQUIRES FOUNDER APPROVAL — this creates real AWS resources (~$400–600/month)
terraform apply bidride.tfplan
```

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

for svc in auth-service trip-service driver-service rider-service pricing-service \
           safety-service payment-service notification-service trust-service \
           airport-service admin-service ai-service; do
  echo "Building $svc..."
  docker build -t "bidride/${svc}" "services/${svc}"
  docker tag "bidride/${svc}:latest" "${ECR_BASE}/bidride/${svc}:latest"
  docker push "${ECR_BASE}/bidride/${svc}:latest"
  echo "✓ $svc pushed"
done
```

- [ ] All 12 images built successfully
- [ ] All 12 images pushed to ECR
- [ ] Latest digest visible in ECR console

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
  --overrides '{"containerOverrides":[{"name":"auth-service","command":["sh","-c","npx prisma migrate deploy"]}]}' \
  --region us-east-1
```

- [ ] Migration applied to production RDS
- [ ] Seed founder admin: run seed script against production DB
- [ ] Verify: `SELECT COUNT(*) FROM users;` returns ≥ 1

---

## Phase 8 — Force ECS Service Deployment

After images are pushed and secrets are set:

```bash
for svc in auth-service trip-service driver-service rider-service pricing-service \
           safety-service payment-service notification-service trust-service \
           airport-service admin-service ai-service; do
  aws ecs update-service \
    --cluster bidride-production \
    --service "bidride-${svc}-production" \
    --force-new-deployment \
    --region us-east-1
done
```

- [ ] All 12 ECS services updating
- [ ] Wait for all services to reach RUNNING state (5–15 min): `aws ecs describe-services ...`
- [ ] CloudWatch log groups receiving logs

---

## Phase 9 — Post-Deploy Verification

Run the smoke test script:

```bash
# Set your ALB DNS or custom domain
export BIDRIDE_API_URL="https://api.bidiride.com"
bash infrastructure/scripts/smoke-test.sh
```

Run the post-deploy verification script:

```bash
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

**For internal alpha cost reduction**, change these in `terraform.tfvars`:
```
db_instance_class = "db.t4g.medium"   # saves ~$280/month, no replicas needed
cache_node_type   = "cache.t4g.micro" # saves ~$175/month, single node OK
```
Alpha sizing: ~$185/month.
