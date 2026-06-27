# BidRide — Deployment Runbook

Technical reference for engineers deploying BidRide to AWS.
See `docs/FOUNDER_DEPLOYMENT_CHECKLIST.md` for the founder-facing simplified version.

---

## Prerequisites

| Tool | Minimum Version | Install |
|------|----------------|---------|
| AWS CLI | 2.x | `brew install awscli` |
| Terraform | ≥ 1.8 | `brew install terraform` |
| Docker Desktop | 4.x | docker.com |
| pnpm | 9.x | `npm install -g pnpm@9` |
| Node.js | 20 LTS | `brew install node@20` |

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

```bash
# Create state bucket
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

---

## Phase 2 — ACM Certificate (ONE TIME ONLY)

```bash
# Request wildcard cert for api.bidride.com and *.bidride.com
aws acm request-certificate \
  --domain-name api.bidride.com \
  --validation-method DNS \
  --subject-alternative-names "*.bidride.com" \
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

Copy the certificate ARN into `terraform.tfvars`.

---

## Phase 3 — Terraform Init & Plan

```bash
cd infrastructure/terraform

# First-time setup
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — fill in:
#   db_password (32+ chars, save to 1Password)
#   acm_certificate_arn
#   founder_email
#   google_maps_api_key
#   founder_signing_public_key (RSA public key for Founder JWT verification)

terraform init
terraform fmt -check    # must pass before apply
terraform validate      # must pass before apply
terraform plan -out=bidride.tfplan

# Review the plan carefully:
# Expected ~90 resources: VPC, RDS, ElastiCache, ECS, ALB, S3, SQS, IAM, CloudWatch, SecretsManager
```

**STOP HERE. Show terraform plan output to Founder for approval before apply.**

---

## Phase 4 — Terraform Apply (REQUIRES FOUNDER APPROVAL)

```bash
cd infrastructure/terraform
terraform apply bidride.tfplan

# After apply, save outputs to 1Password:
terraform output -json > /tmp/bidride-tf-outputs.json
# Contains: rds_endpoint, redis_endpoint, alb_dns_name, ecs_cluster_name, bucket names
rm /tmp/bidride-tf-outputs.json  # don't leave outputs on disk
```

### Post-Apply DNS

```bash
# Get the ALB DNS name
terraform output alb_dns_name

# Add a CNAME record in your DNS registrar:
#   api.bidride.com → <alb_dns_name>
# Propagation: 5-15 minutes

# Verify
curl -I https://api.bidride.com/
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

# Verify all 17 secrets are populated
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

# Run migration
aws ecs run-task \
  --cluster "${CLUSTER}" \
  --task-definition "${TASK_DEF}" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${ECS_SG}],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"auth-service","command":["node","node_modules/.bin/prisma","migrate","deploy","--schema","packages/database/prisma/schema.prisma"]}]}' \
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

```bash
CLUSTER="bidride-production"

# Deploy safety-service first (always — it's the most critical)
aws ecs update-service \
  --cluster "${CLUSTER}" \
  --service bidride-safety-service-production \
  --force-new-deployment
aws ecs wait services-stable \
  --cluster "${CLUSTER}" \
  --services bidride-safety-service-production

# Deploy all other services
for svc in auth-service trip-service driver-service rider-service pricing-service \
           payment-service notification-service trust-service airport-service \
           admin-service ai-service; do
  aws ecs update-service \
    --cluster "${CLUSTER}" \
    --service "bidride-${svc}-production" \
    --force-new-deployment
done

# Wait for all services to stabilize (5-15 min)
for svc in auth-service trip-service driver-service rider-service pricing-service \
           payment-service notification-service trust-service airport-service \
           admin-service ai-service; do
  echo "Waiting for ${svc}..."
  aws ecs wait services-stable \
    --cluster "${CLUSTER}" \
    --services "bidride-${svc}-production"
  echo "✓ ${svc} stable"
done
```

---

## Phase 10 — Post-Deploy Verification

```bash
# Run smoke test (health checks only)
BIDRIDE_API_URL=https://api.bidride.com bash infrastructure/scripts/smoke-test.sh

# Run full post-deploy verification
BIDRIDE_API_URL=https://api.bidride.com \
BIDRIDE_ADMIN_EMAIL=marq@bidride.com \
BIDRIDE_ADMIN_PASS=your-admin-password \
bash infrastructure/scripts/post-deploy-verify.sh
```

All checks must pass before declaring the deployment successful.

---

## Rollback Procedure

### Fast Rollback (< 5 min): Revert to Previous ECS Task Definition

```bash
CLUSTER="bidride-production"
SERVICE="bidride-auth-service-production"

# Get the previous task definition revision
PREV_TASK=$(aws ecs describe-services \
  --cluster "${CLUSTER}" --services "${SERVICE}" \
  --query 'services[0].taskDefinition' --output text | \
  sed 's/:[0-9]*$//')

# Deregister in reverse to find the previous revision
CURRENT_REV=$(aws ecs describe-services \
  --cluster "${CLUSTER}" --services "${SERVICE}" \
  --query 'services[0].taskDefinition' --output text | \
  grep -oE '[0-9]+$')
PREV_REV=$((CURRENT_REV - 1))

# Roll back
aws ecs update-service \
  --cluster "${CLUSTER}" \
  --service "${SERVICE}" \
  --task-definition "${PREV_TASK}:${PREV_REV}"

# Repeat for all affected services
```

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

# Common cause: secret not populated in Secrets Manager
# Fix: populate the missing secret
aws secretsmanager put-secret-value \
  --secret-id "bidride/production/SECRET-NAME" \
  --secret-string "VALUE"
# Then force a new deployment
aws ecs update-service --cluster bidride-production \
  --service bidride-auth-service-production --force-new-deployment
```

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
# If a previous apply was interrupted
aws dynamodb delete-item \
  --table-name bidride-terraform-locks \
  --key '{"LockID":{"S":"bidride-terraform-state/production/terraform.tfstate"}}' \
  --region us-east-1
```

---

## ALB / ACM / DNS Verification

```bash
# Verify HTTPS is terminating at ALB
curl -vI https://api.bidride.com/ 2>&1 | grep -E "SSL|certificate|HTTP"

# Check certificate expiry
echo | openssl s_client -connect api.bidride.com:443 2>/dev/null | \
  openssl x509 -noout -dates

# Verify ALB listener rules
aws elbv2 describe-rules \
  --listener-arn <HTTPS_LISTENER_ARN> \
  --query 'Rules[*].[Priority,Conditions[0].Values,Actions[0].TargetGroupArn]' \
  --output table

# Trace a request path (e.g., /trips/* → trip-service)
curl -sv https://api.bidride.com/trips/non-existent \
  -H "Authorization: Bearer test" 2>&1 | grep -E "< HTTP|location"
```
