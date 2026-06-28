# BidiRide — Secrets Manager Population Checklist

All secrets live at path: `bidride/{environment}/{secret-name}`
For internal alpha use `environment = production`.

Populate each secret with:
```bash
aws secretsmanager put-secret-value \
  --secret-id "bidride/production/SECRET-NAME" \
  --secret-string "VALUE" \
  --region us-east-1
```

---

## Shared Secrets (used by multiple services)

### `database-url`
- **Format:** `postgresql://bidride_admin:PASSWORD@RDS_ENDPOINT:5432/bidride`
- **Get value:** Terraform output `rds_endpoint` + `var.db_password`
- **Example:** `postgresql://bidride_admin:abc123@bidride-production.xxxx.us-east-1.rds.amazonaws.com:5432/bidride`
- [ ] Populated

### `redis-url`
- **Format:** `rediss://ELASTICACHE_ENDPOINT:6379` (note `rediss://` — TLS required)
- **Get value:** Terraform output `redis_endpoint`
- **Example:** `rediss://bidride-production.xxxx.cache.amazonaws.com:6379`
- [ ] Populated

### `jwt-secret`
- **Format:** Random string, minimum 64 characters
- **Generate:** `openssl rand -base64 64 | tr -d '\n'`
- **Note:** Used by auth-service to sign rider/driver JWTs. Changing this invalidates all active sessions.
- [ ] Populated

### `internal-service-key`
- **Format:** Random string, minimum 32 characters
- **Generate:** `openssl rand -hex 32`
- **Note:** Must match `INTERNAL_SERVICE_KEY` env var in all ECS task definitions. Set in: trip-service, pricing-service, trust-service, admin-service, and ai-service.
- [ ] Populated

---

## Payment — Stripe

### `stripe-secret-key`
- **Format:** `sk_live_...` (production) or `sk_test_...` (alpha testing)
- **Get value:** Stripe Dashboard → Developers → API Keys
- **For alpha:** Use test key `sk_test_...` — no real charges
- [ ] Populated

### `stripe-webhook-secret`
- **Format:** `whsec_...`
- **Get value:** Stripe Dashboard → Developers → Webhooks → Select endpoint → Signing secret
- **Note:** Create webhook endpoint pointing to `https://api.bidiride.com/payments/webhook`
- [ ] Webhook endpoint created in Stripe
- [ ] Populated

### `stripe-platform-account-id`
- **Format:** `acct_...`
- **Get value:** Stripe Dashboard → Settings → Account details → Account ID
- **Note:** This is the platform (BidiRide) Stripe Connect account, not a connected driver account.
- [ ] Populated

---

## Notifications — Twilio

### `twilio-account-sid`
- **Format:** `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` (34 chars)
- **Get value:** Twilio Console → Account Info
- [ ] Populated

### `twilio-auth-token`
- **Format:** 32-char hex string
- **Get value:** Twilio Console → Account Info → Auth Token (click to reveal)
- [ ] Populated

### `twilio-phone-number`
- **Format:** E.164, e.g. `+12015551234`
- **Get value:** Twilio Console → Phone Numbers → Manage → Active Numbers
- **Note:** Must have SMS capability. For NJ/Newark launch, prefer a 201 or 973 area code.
- [ ] Purchased and configured
- [ ] Populated

---

## Notifications — Firebase Cloud Messaging (FCM)

### `fcm-project-id`
- **Format:** Firebase project ID string, e.g. `bidride-prod`
- **Get value:** Firebase Console → Project Settings → General → Project ID
- [ ] Populated

### `fcm-service-account-email`
- **Format:** `firebase-adminsdk-xxxxx@bidride-prod.iam.gserviceaccount.com`
- **Get value:** Firebase Console → Project Settings → Service Accounts → Generate new private key → open JSON, field `client_email`
- [ ] Populated

### `fcm-service-account-private-key`
- **Format:** PEM private key string with literal `\n` for newlines
- **Get value:** Same JSON file, field `private_key`
- **Important:** Store the key with `\n` replacing real newlines:
  ```bash
  # Extract and format for Secrets Manager
  cat firebase-service-account.json | jq -r '.private_key' | \
    python3 -c "import sys; print(sys.stdin.read().replace('\n','\\n').rstrip('\\n'))"
  ```
- [ ] Firebase project created
- [ ] Service account JSON downloaded (store offline, do NOT commit)
- [ ] Populated

---

## Driver Onboarding — Checkr

### `checkr-api-key`
- **Format:** `test_...` (sandbox) or live key
- **Get value:** Checkr Dashboard → API Keys
- **For alpha:** Use Checkr sandbox — background checks return canned results, no real SSN verification
- [ ] Checkr account created at checkr.com
- [ ] Populated

### `checkr-webhook-secret`
- **Format:** Hex string provided by Checkr
- **Get value:** Checkr Dashboard → Webhooks → Create endpoint → Secret
- **Note:** Create webhook pointing to `https://api.bidiride.com/drivers/checkr/webhook`
- [ ] Webhook endpoint registered in Checkr
- [ ] Populated

---

## Admin Service

### `admin-jwt-secret`
- **Format:** Random string, minimum 64 characters, DIFFERENT from `jwt-secret`
- **Generate:** `openssl rand -base64 64 | tr -d '\n'`
- **Note:** Signs admin session cookies. Separate from rider/driver JWT to prevent privilege escalation.
- [ ] Populated

### `founder-jwt-secret`
- **Format:** Random string, minimum 64 characters
- **Generate:** `openssl rand -base64 64 | tr -d '\n'`
- **Note:** Used by admin-service to verify Founder-signed JWTs for earnings floor formula changes. Pair with `FOUNDER_SIGNING_PUBLIC_KEY` Terraform variable (RSA keypair).
- [ ] Populated

---

## Airport — FlightAware

### `flightaware-api-key`
- **Format:** API key string from FlightAware AeroAPI
- **Get value:** flightaware.com → AeroAPI → My Account → API Keys
- **Note:** airport-service calls `getOrThrow('FLIGHTAWARE_API_KEY')` — service will crash without this.
- [ ] Populated

---

## Verification

After populating all secrets, verify:

```bash
# List all populated secrets
aws secretsmanager list-secrets \
  --filter Key=name,Values=bidride/production \
  --query 'SecretList[].Name' \
  --output table \
  --region us-east-1

# Should show 19 entries:
# bidride/production/database-url
# bidride/production/redis-url
# bidride/production/jwt-secret
# bidride/production/internal-service-key
# bidride/production/stripe-secret-key
# bidride/production/stripe-webhook-secret
# bidride/production/stripe-platform-account-id
# bidride/production/twilio-account-sid
# bidride/production/twilio-auth-token
# bidride/production/twilio-phone-number
# bidride/production/twilio-proxy-service-sid
# bidride/production/fcm-project-id
# bidride/production/fcm-service-account-email
# bidride/production/fcm-service-account-private-key
# bidride/production/checkr-api-key
# bidride/production/checkr-webhook-secret
# bidride/production/admin-jwt-secret
# bidride/production/founder-jwt-secret
# bidride/production/flightaware-api-key
```

**Note:** `internal-service-key` should also be set as the env var that ECS task definitions reference. Terraform's `ecs-services.tf` injects it as `INTERNAL_SERVICE_KEY`.

---

## Google Maps API Key

**Not in Secrets Manager** — configured per-service in the ECS task definition environment block.
Add to `ecs-services.tf` → `aws_ecs_task_definition.services` → `environment`:

```terraform
{ name = "GOOGLE_MAPS_API_KEY", value = var.google_maps_api_key }
```

And add to `main.tf` variables:
```terraform
variable "google_maps_api_key" { sensitive = true }
```

Then add to `terraform.tfvars`:
```
google_maps_api_key = "AIza..."
```

- [ ] Google Maps API key obtained (Google Cloud Console → APIs → Maps Geocoding API)
- [ ] Billing enabled on Google Cloud project
- [ ] Key restricted to your API server IPs or referrer domains
- [ ] Added to `terraform.tfvars` and `ecs-services.tf`
