# BidiRide — Founder Deployment Checklist

This checklist walks you through deploying BidiRide to AWS from scratch.
You do not need to be an engineer to follow it — every step is explicit.

If anything goes wrong, stop and call your engineer. Do NOT continue past a failed step.

---

## Before You Start

You need these accounts and access ready. Check them off before continuing.

**Accounts:**
- [ ] AWS account with payment method on file
- [ ] Stripe account with Connect enabled (for driver payouts)
- [ ] Twilio account with a phone number purchased
- [ ] Firebase project created (for push notifications)
- [ ] Checkr account (for driver background checks)
- [ ] Domain registered: bidiride.com (or your domain)

**On your computer:**
- [ ] AWS CLI installed — type `aws --version` in Terminal. Should show version 2.x
- [ ] Terraform installed — type `terraform version`. Should show ≥ 1.8
- [ ] Docker Desktop installed and running
- [ ] This code repository on your computer

**Credentials in hand:**
- [ ] AWS Access Key ID and Secret (from AWS → IAM → Users → Security Credentials)
- [ ] Stripe secret key (`sk_live_...` or `sk_test_...` for testing)
- [ ] Twilio Account SID and Auth Token
- [ ] Firebase service account JSON file downloaded
- [ ] Checkr API key
- [ ] FlightAware AeroAPI key (for EWR flight data)

---

## Part 1 — One-Time AWS Setup (Skip if already done)

### Step 1.1 — Configure AWS on your computer

Open Terminal and run:

```
aws configure
```

Enter your AWS Access Key ID, Secret Access Key, then type `us-east-1` for region and `json` for output format.

Test it worked:
```
aws sts get-caller-identity
```

You should see your AWS account ID. If you get an error, your credentials are wrong.

- [ ] Done

### Step 1.2 — Create the Terraform state storage (one time only)

Copy and paste this entire block into Terminal:

```bash
aws s3api create-bucket --bucket bidride-terraform-state --region us-east-1
aws s3api put-bucket-versioning --bucket bidride-terraform-state --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption \
  --bucket bidride-terraform-state \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

If you see "BucketAlreadyOwnedByYou" — that's fine, keep going.

Note: No DynamoDB table is needed. Terraform uses an S3-native lock file instead (simpler and cheaper).

- [ ] Done

### Step 1.3 — Create an SSL Certificate

Run this (replace `api.bidiride.com` with your actual domain if different):

```bash
aws acm request-certificate \
  --domain-name api.bidiride.com \
  --validation-method DNS \
  --subject-alternative-names "*.bidiride.com" \
  --region us-east-1
```

Copy the ARN it gives you (looks like `arn:aws:acm:us-east-1:1234...`).

Then run this with that ARN:
```bash
aws acm describe-certificate \
  --certificate-arn YOUR-ARN-HERE \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
```

It shows you a DNS record (Name and Value). Add this as a CNAME record in your domain registrar.
Wait 10-30 minutes, then run:

```bash
aws acm wait certificate-validated --certificate-arn YOUR-ARN-HERE --region us-east-1
```

When the command finishes without error, the certificate is ready.

Save the ARN — you need it in the next step.

- [ ] Certificate ARN saved: `arn:aws:acm:us-east-1:_______________________`

---

## Part 2 — Configure the Deployment

### Step 2.1 — Create your configuration file

In Terminal, go to the infrastructure/terraform folder:
```
cd infrastructure/terraform
```

Copy the example file:
```
cp terraform.tfvars.example terraform.tfvars
```

Open `terraform.tfvars` in a text editor (TextEdit, VS Code, etc.).

Fill in these values:

| Variable | What to put | Where to find it |
|----------|-------------|-----------------|
| `aws_region` | `us-east-1` | Leave as-is |
| `environment` | `production` | Leave as-is |
| `db_password` | A strong password (32+ characters, save to 1Password) | Make one up |
| `founder_email` | `brownmarq184@gmail.com` | Your email |
| `acm_certificate_arn` | The ARN from Step 1.3 | From Step 1.3 |
| `domain_name` | `api.bidiride.com` | Your API domain |
| `db_instance_class` | `db.t4g.medium` | Use this for internal alpha (saves money) |
| `cache_node_type` | `cache.t4g.micro` | Use this for internal alpha (saves money) |
| `google_maps_api_key` | Your Google Maps key | Google Cloud Console |
| `founder_signing_public_key` | Your RSA public key | See note below |

**Important — Founder signing key:** This is a security key that only you control. Generate it once:
```bash
openssl genrsa -out founder_private.pem 4096
openssl rsa -in founder_private.pem -pubout -out founder_public.pem
cat founder_public.pem
```
Copy the contents of `founder_public.pem` into the `founder_signing_public_key` field (including the BEGIN/END lines).
Store `founder_private.pem` somewhere safe — never upload it anywhere.

- [ ] `terraform.tfvars` filled out and saved

---

## Part 3 — Create AWS Infrastructure

### Step 3.1 — Initialize Terraform

```
terraform init
```

Should say "Terraform has been successfully initialized!"

- [ ] Done

### Step 3.2 — Preview what will be created

```
terraform plan -out=bidride.tfplan
```

This lists everything Terraform will create. It should say something like "Plan: ~206 to add, 0 to change, 0 to destroy."

Read through it. If anything says "destroy" that you didn't expect, stop and call your engineer.

**Estimated monthly cost (alpha sizing):** ~$500/month
(Breakdown: Fargate 18 tasks $225, NAT Gateways 3× $99, RDS 3 instances $107, other $69.
The figure $185 in earlier docs was incorrect — see cost note at the bottom of this file.)

- [ ] Reviewed, no unexpected destroys

### Step 3.3 — Create the infrastructure

⚠️ **This costs real money. Make sure your AWS billing is set up.**

```
terraform apply bidride.tfplan
```

This takes 15-25 minutes. Don't close Terminal.

When it finishes, it shows "Outputs:" — save these somewhere safe (1Password):
- `rds_endpoint` — your database address
- `redis_endpoint` — your cache address
- `alb_dns_name` — your load balancer address

- [ ] Done, outputs saved

### Step 3.4 — Connect your domain

Go to your domain registrar (GoDaddy, Namecheap, etc.) and add a CNAME record:
- Name: `api`
- Value: the `alb_dns_name` from Terraform outputs
- TTL: 300

Wait 5-15 minutes, then test:
```
curl -I https://api.bidiride.com/
```

Should show `HTTP/2 404` (that's correct — services aren't running yet).

- [ ] Domain pointing to load balancer

---

## Part 4 — Add Your Secret Keys

Now you need to put your API keys into AWS Secrets Manager.
Run each command below, replacing `VALUE` with the actual key.

```bash
# Your database URL (fill in your RDS endpoint and db_password from terraform.tfvars)
aws secretsmanager put-secret-value \
  --secret-id bidride/production/database-url \
  --secret-string "postgresql://bidride_admin:YOUR_DB_PASSWORD@YOUR_RDS_ENDPOINT:5432/bidride"

# Your Redis URL (fill in redis_endpoint from Terraform outputs — note rediss:// not redis://)
aws secretsmanager put-secret-value \
  --secret-id bidride/production/redis-url \
  --secret-string "rediss://YOUR_REDIS_ENDPOINT:6379"

# JWT signing secret — generate a strong random one
aws secretsmanager put-secret-value \
  --secret-id bidride/production/jwt-secret \
  --secret-string "$(openssl rand -base64 64 | tr -d '\n')"

# Internal service key — shared among your services
aws secretsmanager put-secret-value \
  --secret-id bidride/production/internal-service-key \
  --secret-string "$(openssl rand -hex 32)"

# Stripe
aws secretsmanager put-secret-value \
  --secret-id bidride/production/stripe-secret-key \
  --secret-string "sk_test_YOUR_STRIPE_KEY"

aws secretsmanager put-secret-value \
  --secret-id bidride/production/stripe-webhook-secret \
  --secret-string "whsec_YOUR_WEBHOOK_SECRET"

aws secretsmanager put-secret-value \
  --secret-id bidride/production/stripe-platform-account-id \
  --secret-string "acct_YOUR_PLATFORM_ACCOUNT_ID"

# Twilio
aws secretsmanager put-secret-value \
  --secret-id bidride/production/twilio-account-sid \
  --secret-string "AC_YOUR_ACCOUNT_SID"

aws secretsmanager put-secret-value \
  --secret-id bidride/production/twilio-auth-token \
  --secret-string "YOUR_AUTH_TOKEN"

aws secretsmanager put-secret-value \
  --secret-id bidride/production/twilio-phone-number \
  --secret-string "+1YOUR_PHONE_NUMBER"

aws secretsmanager put-secret-value \
  --secret-id bidride/production/twilio-proxy-service-sid \
  --secret-string "KS_YOUR_PROXY_SID"

# FCM (Firebase)
aws secretsmanager put-secret-value \
  --secret-id bidride/production/fcm-project-id \
  --secret-string "your-firebase-project-id"

aws secretsmanager put-secret-value \
  --secret-id bidride/production/fcm-service-account-email \
  --secret-string "firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com"

# For the FCM private key, use this script (replace path with your JSON file path):
# jq -r '.private_key' firebase-service-account.json | python3 -c "import sys; print(sys.stdin.read().replace(chr(10),'\\n').strip())" | \
#   xargs -I {} aws secretsmanager put-secret-value \
#     --secret-id bidride/production/fcm-service-account-private-key \
#     --secret-string "{}"

# Checkr
aws secretsmanager put-secret-value \
  --secret-id bidride/production/checkr-api-key \
  --secret-string "test_YOUR_CHECKR_KEY"

aws secretsmanager put-secret-value \
  --secret-id bidride/production/checkr-webhook-secret \
  --secret-string "YOUR_CHECKR_WEBHOOK_SECRET"

# FlightAware
aws secretsmanager put-secret-value \
  --secret-id bidride/production/flightaware-api-key \
  --secret-string "YOUR_FLIGHTAWARE_KEY"

# Admin JWT (different from the main JWT secret)
aws secretsmanager put-secret-value \
  --secret-id bidride/production/admin-jwt-secret \
  --secret-string "$(openssl rand -base64 64 | tr -d '\n')"

# Founder JWT (for earnings floor formula signing)
aws secretsmanager put-secret-value \
  --secret-id bidride/production/founder-jwt-secret \
  --secret-string "$(openssl rand -base64 64 | tr -d '\n')"
```

Verify all 19 secrets are set:
```bash
aws secretsmanager list-secrets \
  --filter Key=name,Values=bidride/production \
  --query 'SecretList[].Name' \
  --output table
```

Should show 19 entries.

- [ ] All 19 secrets populated

---

## Part 5 — Build and Upload the App

### Step 5.1 — Get your AWS Account ID

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Your account ID: $ACCOUNT_ID"
```

Save this number.

### Step 5.2 — Log Docker into AWS

```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  ${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com
```

Should say "Login Succeeded".

### Step 5.3 — Build and upload each service

This takes about 20-40 minutes. Run from the root of the repository:

```bash
ECR_BASE="${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com"
for svc in auth-service trip-service driver-service rider-service pricing-service \
           safety-service payment-service notification-service trust-service \
           airport-service admin-service ai-service; do
  echo "Building ${svc}..."
  docker build -f services/Dockerfile.template --build-arg SERVICE_NAME=${svc} \
    -t ${ECR_BASE}/bidride/${svc}:latest .
  docker push ${ECR_BASE}/bidride/${svc}:latest
  echo "✓ ${svc} done"
done
```

- [ ] All 12 services built and uploaded

---

## Part 6 — Set Up the Database

### Step 6.1 — Run database setup

This creates all the tables. Run from the repository root:

```bash
CLUSTER="bidride-production"
TASK_DEF="bidride-auth-service-production"

# Get the private subnet IDs
SUBNETS=$(aws ec2 describe-subnets \
  --filters "Name=tag:Name,Values=bidride-production-private-*" \
  --query 'Subnets[].SubnetId' --output text | tr '\t' ',')
ECS_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=bidride-ecs-production" \
  --query 'SecurityGroups[0].GroupId' --output text)

aws ecs run-task \
  --cluster "${CLUSTER}" \
  --task-definition "${TASK_DEF}" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${ECS_SG}],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"auth-service","command":["node","node_modules/.bin/prisma","migrate","deploy","--schema","packages/database/prisma/schema.prisma"]}]}'
```

Wait 2-3 minutes, then check it worked:
```bash
aws ecs list-tasks --cluster bidride-production
# The migration task should no longer be running
```

- [ ] Database setup complete

### Step 6.2 — Seed your admin account

```bash
DATABASE_URL="postgresql://bidride_admin:YOUR_PASSWORD@YOUR_RDS_ENDPOINT:5432/bidride" \
  pnpm db:seed
```

- [ ] Admin account created (marq@bidiride.com)

---

## Part 7 — Start the Services

```bash
CLUSTER="bidride-production"

# Start safety first (most important)
aws ecs update-service --cluster ${CLUSTER} \
  --service bidride-safety-service-production --desired-count 1 --force-new-deployment
sleep 30

# Start all other services
for svc in auth-service trip-service driver-service rider-service pricing-service \
           payment-service notification-service trust-service airport-service \
           admin-service ai-service; do
  aws ecs update-service --cluster ${CLUSTER} \
    --service bidride-${svc}-production --force-new-deployment
  echo "✓ Started ${svc}"
done

echo "Waiting for services to start (5-15 minutes)..."
```

Check the admin portal to watch services come up:
https://console.aws.amazon.com/ecs/v2/clusters/bidride-production/services

All services should show "Running: 1" within 15 minutes.

- [ ] All services running

---

## Part 8 — Test Everything

Run the health check script:

```bash
BIDRIDE_API_URL=https://api.bidiride.com bash infrastructure/scripts/smoke-test.sh
```

All 11 checks should show ✓ (ai-service is skipped — it's internal).

Then test the admin portal:
```
https://admin.bidiride.com
```

Log in with marq@bidiride.com and the password set during seeding.

- [ ] Health checks pass
- [ ] Admin portal loads and login works

---

## Part 9 — Final Security Steps

- [ ] Change the default seed admin password immediately in admin portal
- [ ] Write down the database password and store it in 1Password (not in a file)
- [ ] Store `founder_private.pem` securely offline — this controls the earnings floor formula
- [ ] Delete `founder_private.pem` from your computer after backing it up
- [ ] Enable CloudWatch alarms notification email (AWS Console → CloudWatch → Alarms → each alarm → Actions → Add notification)
- [ ] Confirm `bidride/production/terraform.tfvars` is NOT committed to git: `git status` should not show it

---

## You're Live 🎉

BidiRide is running on AWS. For day-to-day operations, see `docs/OPERATIONS_RUNBOOK.md`.

**Bookmark these:**
- Admin Portal: https://admin.bidiride.com
- AWS Console: https://console.aws.amazon.com
- Stripe Dashboard: https://dashboard.stripe.com
- CloudWatch Alarms: https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#alarmsV2

**Cost reminder:** Running at internal alpha sizing costs ~$500/month.
Primary drivers: 18 Fargate task instances ($225), 3 HA NAT Gateways ($99), RDS Multi-AZ + 2 replicas ($107).
To reduce alpha cost, consider reducing desired_count to 1 for all services (~$72 savings) or using
single_nat_gateway=true in terraform.tfvars (~$66 savings) — discuss with your engineer before changing.
Scale up to production sizing (`db.r6g.large`, `cache.r6g.large`) when you have consistent traffic.
