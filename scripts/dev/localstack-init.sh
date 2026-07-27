#!/bin/sh
# BidRide local dev — runs on every LocalStack boot (/etc/localstack/init/ready.d).
# Provisions the KMS/Secrets Manager/SQS objects that mirror B8B-1's production
# resources, so the future RS256 (B8C) code path can be exercised locally.
# This touches ONLY the local LocalStack instance — never AWS.
#
# STABILITY ACROSS RESTARTS
# LocalStack community edition has no state persistence (PERSISTENCE=1 is a Pro
# feature; community accepts the variable, writes nothing, and logs no warning).
# So every boot starts empty and this script runs again. To keep local config
# stable we pin the two JWT signing keys to fixed IDs via LocalStack's
# `_custom_id_` tag. Those UUIDs are declared dev constants — like the dev DB
# password — not runtime values captured from a previous boot.
#
# What IS stable across restarts: key IDs, aliases, secret names, queue URL.
# What is NOT: RSA key *material* and secret *values* are regenerated each boot
# (community edition cannot persist them). Re-run `pnpm dev:rs256` after a
# restart if you have populated the keyset secrets.
#
# Every step is check-then-create, so re-running never duplicates a resource.
set -e

REGION=us-east-1

# Fixed dev key IDs (see note above — declared constants, not captured values).
USER_KEY_ID=00000000-0000-4000-8000-0000000bd001
ADMIN_KEY_ID=00000000-0000-4000-8000-0000000bd002

ensure_key() {
  key_id=$1
  key_desc=$2
  key_alias=$3

  if awslocal kms describe-key --key-id "$key_id" >/dev/null 2>&1; then
    echo "[localstack-init] kms key $key_id exists — reusing"
  else
    awslocal kms create-key --key-usage SIGN_VERIFY --key-spec RSA_2048 \
      --description "$key_desc" \
      --tags TagKey=_custom_id_,TagValue="$key_id" \
      --query KeyMetadata.KeyId --output text >/dev/null
    echo "[localstack-init] kms key $key_id created"
  fi

  if awslocal kms list-aliases --query "Aliases[?AliasName=='$key_alias'].AliasName" \
      --output text 2>/dev/null | grep -q "^${key_alias}$"; then
    echo "[localstack-init] alias $key_alias exists — reusing"
  else
    awslocal kms create-alias --alias-name "$key_alias" --target-key-id "$key_id"
    echo "[localstack-init] alias $key_alias -> $key_id created"
  fi
}

echo "[localstack-init] ensuring dev JWT signing KMS keys (RSA_2048, SIGN_VERIFY)"
ensure_key "$USER_KEY_ID"  "BidRide dev user JWT signing key"  alias/bidride-jwt-user-development
ensure_key "$ADMIN_KEY_ID" "BidRide dev admin JWT signing key" alias/bidride-jwt-admin-development

echo "[localstack-init] ensuring secret placeholders (values populated by scripts/dev/rs256.mjs)"
for s in jwt-public-keys jwt-admin-public-keys internal-service-key; do
  name="bidride/development/$s"
  if awslocal secretsmanager describe-secret --secret-id "$name" >/dev/null 2>&1; then
    echo "[localstack-init] secret $name exists — value left untouched"
  else
    awslocal secretsmanager create-secret --name "$name" --secret-string '{}' >/dev/null
    echo "[localstack-init] secret $name created"
  fi
done

echo "[localstack-init] ensuring dev SQS queue"
QUEUE=bidride-dev-events
if awslocal sqs get-queue-url --queue-name "$QUEUE" >/dev/null 2>&1; then
  echo "[localstack-init] queue $QUEUE exists — reusing"
else
  awslocal sqs create-queue --queue-name "$QUEUE" >/dev/null
  echo "[localstack-init] queue $QUEUE created"
fi

echo "[localstack-init] done (region=$REGION, user-key=$USER_KEY_ID, admin-key=$ADMIN_KEY_ID)"
