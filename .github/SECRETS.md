# GitHub Actions — Required Secrets

Configure these at: **GitHub → Settings → Secrets and variables → Actions**

## AWS (required for all deployments)

| Secret | Description | Where to get |
|--------|-------------|--------------|
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN for GitHub OIDC federation | AWS IAM → Roles → bidride-github-deploy |
| `AWS_ACCOUNT_ID` | 12-digit AWS account ID | AWS Console → top-right account menu |
| `PRIVATE_SUBNETS` | Comma-separated staging private subnet IDs | AWS VPC → Subnets |
| `ECS_SECURITY_GROUP` | Staging ECS security group ID | AWS VPC → Security Groups |
| `PROD_PRIVATE_SUBNETS` | Comma-separated production private subnet IDs | AWS VPC → Subnets |
| `PROD_ECS_SECURITY_GROUP` | Production ECS security group ID | AWS VPC → Security Groups |

## Application Secrets (injected into ECS task definitions)

| Secret | Description | Where to get |
|--------|-------------|--------------|
| `JWT_SECRET` | HS256 signing secret, 64+ chars | Generate: `openssl rand -hex 64` |
| `FOUNDER_JWT_SECRET` | Separate secret for Founder-only endpoints | Generate: `openssl rand -hex 64` |
| `DATABASE_URL` | PostgreSQL connection string (RDS) | AWS RDS → Connectivity |
| `REDIS_URL` | ElastiCache Redis URL | AWS ElastiCache → Cluster endpoint |
| `REDIS_HOST` | ElastiCache hostname (used by most services) | AWS ElastiCache |
| `REDIS_PORT` | `6379` | — |

## Stripe

| Secret | Description | Where to get |
|--------|-------------|--------------|
| `STRIPE_SECRET_KEY` | `sk_live_...` for production, `sk_test_...` for staging | Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret | Stripe Dashboard → Webhooks |

## Twilio (SMS OTP)

| Secret | Description | Where to get |
|--------|-------------|--------------|
| `TWILIO_ACCOUNT_SID` | Starts with `AC...` | Twilio Console → Account Info |
| `TWILIO_AUTH_TOKEN` | Auth token | Twilio Console → Account Info |
| `TWILIO_PHONE_NUMBER` | Your Twilio number in E.164 format | Twilio Console → Phone Numbers |

## Firebase (Push Notifications)

| Secret | Description | Where to get |
|--------|-------------|--------------|
| `FIREBASE_SERVER_KEY` | FCM legacy server key | Firebase Console → Project Settings → Cloud Messaging |

## AWS Services (used by individual services)

| Secret | Description | Where to get |
|--------|-------------|--------------|
| `AWS_S3_BUCKET` | S3 bucket name for driver documents | AWS S3 |
| `AWS_S3_REGION` | `us-east-1` | — |
| `FLIGHTAWARE_API_KEY` | FlightAware AeroAPI key | flightaware.com/commercial/aeroapi |

## Monitoring

| Secret | Description | Where to get |
|--------|-------------|--------------|
| `CODECOV_TOKEN` | Coverage upload token | codecov.io → your repo |
| `SLACK_WEBHOOK_URL` | Deploy notifications channel | Slack → Incoming Webhooks app |

---

## GitHub Environment Configuration

Configure at: **GitHub → Settings → Environments**

### `staging`
- No approval required
- Triggers on: push to `staging` branch

### `production`
- **Required reviewers:** add Marq Brown (wisekid101)
- Protection rules: require reviewer approval before deploy
- Triggers on: push to `main` branch

---

## AWS IAM — GitHub OIDC Setup

Run once in AWS to allow GitHub Actions to assume the deploy role without long-lived keys:

```bash
# 1. Create OIDC provider (once per AWS account)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# 2. Create the deploy role with trust policy
aws iam create-role \
  --role-name bidride-github-deploy \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringLike": { "token.actions.githubusercontent.com:sub": "repo:wisekid101/Bidride:*" },
        "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" }
      }
    }]
  }'

# 3. Attach ECR + ECS + RDS permissions
aws iam attach-role-policy --role-name bidride-github-deploy --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser
aws iam attach-role-policy --role-name bidride-github-deploy --policy-arn arn:aws:iam::aws:policy/AmazonECS_FullAccess
aws iam attach-role-policy --role-name bidride-github-deploy --policy-arn arn:aws:iam::aws:policy/AmazonRDSFullAccess
```
