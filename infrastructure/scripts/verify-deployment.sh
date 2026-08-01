#!/usr/bin/env bash
# BidRide — deployment verification that proves configuration, not just liveness.
#
# WHY THIS EXISTS
# ---------------
# smoke-test.sh and post-deploy-verify.sh answer "is it up?". Neither can answer
# "is it running the task definition I deployed, with the keyset loaded, under
# the signing algorithm I intended?" — and those are exactly the questions an
# RS256 rollout turns on. A fleet that silently lost its keyset passes every
# health check ever written for it.
#
# WHAT IT PROVES
#   1. Task-definition revision  — the running fleet is on ONE revision, and it
#                                  is the latest ACTIVE one.
#   2. JWT_PUBLIC_KEYS           — referenced by the revision, and the secret
#                                  holds a schema-valid keyset.
#   3. JWT_ADMIN_PUBLIC_KEYS     — same, admin domain, admin-service only.
#   4. Signing algorithm         — configured value AND what the service logged
#                                  at boot agree.
#   5. KMS key                   — each signer points at its own domain's key,
#                                  and its task role grants kms:Sign on that key
#                                  and no other.
#   6. RS256 round trip          — a real kms:Sign signature over a real JWT
#                                  signing input, verified against the PUBLISHED
#                                  keyset with openssl. This is the end-to-end
#                                  proof that a token the issuer produces is one
#                                  the verifiers can check.
#
# Note on (2)/(3): a container's environment cannot be read back from outside.
# The proof is a chain rather than a direct read — the revision references the
# secret, the secret has a valid value, and ECS placed RUNNING tasks on that
# revision. ECS refuses to start a task whose `secrets` entry cannot resolve, so
# running tasks on that revision is positive evidence the value was injected.
#
# Usage:
#   verify-deployment.sh <staging|production> <service|all>
#
# Exit: 0 = every check passed, 1 = one or more failed.
# Requires: aws CLI v2, jq, openssl.

set -uo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
PASS=0; FAIL=0; SKIP=0
ok()   { echo -e "  ${GREEN}✓${NC} $*"; PASS=$((PASS+1)); }
bad()  { echo -e "  ${RED}✗${NC} $*"; FAIL=$((FAIL+1)); }
skip() { echo -e "  ${YELLOW}⚠${NC} $*"; SKIP=$((SKIP+1)); }
info() { echo -e "  ${BLUE}→${NC} $*"; }
section() { echo ""; echo -e "${BLUE}[$*]${NC}"; }

ENVIRONMENT="${1:-}"
TARGET="${2:-all}"

case "${ENVIRONMENT}" in
  staging|production) ;;
  *) echo "usage: $0 <staging|production> <service|all>" >&2; exit 2 ;;
esac

for tool in aws jq openssl; do
  command -v "${tool}" >/dev/null || { echo "ERROR: ${tool} is required" >&2; exit 2; }
done

CLUSTER="bidride-${ENVIRONMENT}"

# Services that verify user tokens — must carry JWT_PUBLIC_KEYS.
JWT_VERIFIERS="auth-service trip-service driver-service rider-service pricing-service safety-service payment-service admin-service"
JWT_SIGNERS="auth-service admin-service"
ALL_SERVICES="auth-service trip-service driver-service rider-service pricing-service safety-service payment-service notification-service trust-service airport-service admin-service ai-service"

if [[ "${TARGET}" == "all" ]]; then
  SERVICES="${ALL_SERVICES}"
else
  SERVICES="${TARGET}"
fi

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
in_list() { case " $2 " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

echo ""
echo "════════════════════════════════════════════════════"
echo "  BidRide Deployment Verification"
echo "  env=${ENVIRONMENT}  target=${TARGET}"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "════════════════════════════════════════════════════"

# ── 1. Task-definition revision ─────────────────────────────────────────────

section "1. Task-definition revision"

for svc in ${SERVICES}; do
  ecs_service="bidride-${svc}-${ENVIRONMENT}"
  family="bidride-${svc}-${ENVIRONMENT}"

  deployed=$(aws ecs describe-services --cluster "${CLUSTER}" --services "${ecs_service}" \
    --region "${AWS_REGION}" --query 'services[0].taskDefinition' --output text 2>/dev/null)
  if [[ -z "${deployed}" || "${deployed}" == "None" ]]; then
    bad "${svc} — service not found in ${CLUSTER}"
    continue
  fi

  latest=$(aws ecs describe-task-definition --task-definition "${family}" \
    --region "${AWS_REGION}" --query 'taskDefinition.taskDefinitionArn' --output text 2>/dev/null)

  task_arns=$(aws ecs list-tasks --cluster "${CLUSTER}" --service-name "${ecs_service}" \
    --region "${AWS_REGION}" --query 'taskArns[]' --output text 2>/dev/null | tr '\t' '\n' | sed '/^$/d')

  if [[ -z "${task_arns}" ]]; then
    bad "${svc} — no RUNNING tasks"
    continue
  fi

  # shellcheck disable=SC2086
  running_revs=$(aws ecs describe-tasks --cluster "${CLUSTER}" --tasks ${task_arns} \
    --region "${AWS_REGION}" --query 'tasks[].taskDefinitionArn' --output text 2>/dev/null \
    | tr '\t' '\n' | sort -u)
  rev_count=$(wc -l <<<"${running_revs}" | tr -d ' ')

  if [[ "${rev_count}" -ne 1 ]]; then
    bad "${svc} — MIXED FLEET, ${rev_count} revisions serving: $(tr '\n' ' ' <<<"${running_revs}")"
  elif [[ "${running_revs}" != "${deployed}" ]]; then
    bad "${svc} — tasks on ${running_revs##*/} but service pinned to ${deployed##*/}"
  elif [[ "${deployed}" != "${latest}" ]]; then
    bad "${svc} — running ${deployed##*/}, latest ACTIVE is ${latest##*/} (a terraform apply has not been deployed)"
  else
    ok "${svc} — ${rev_count} revision serving, ${deployed##*/} = latest ACTIVE"
  fi

  # Image must be digest-pinned; a tag-pinned image is not rollback-safe.
  image=$(aws ecs describe-task-definition --task-definition "${deployed}" --region "${AWS_REGION}" \
    --query "taskDefinition.containerDefinitions[?name=='${svc}'].image | [0]" --output text 2>/dev/null)
  if [[ "${image}" == *"@sha256:"* ]]; then
    ok "${svc} — image digest-pinned (${image##*@sha256:})"
  elif [[ "${image}" == *":bootstrap" ]]; then
    skip "${svc} — running the Terraform bootstrap image; deploy a build to pin a digest"
  else
    bad "${svc} — image is TAG-pinned and not rollback-safe: ${image}"
  fi
done

# ── 2 & 3. Keyset secrets ───────────────────────────────────────────────────

verify_keyset_secret() {
  local secret_name="$1" label="$2"
  local value
  value=$(aws secretsmanager get-secret-value --secret-id "bidride/${ENVIRONMENT}/${secret_name}" \
    --region "${AWS_REGION}" --query 'SecretString' --output text 2>/dev/null)

  if [[ -z "${value}" || "${value}" == "None" ]]; then
    bad "${label} — secret bidride/${ENVIRONMENT}/${secret_name} is EMPTY (tasks referencing it cannot start)"
    return 1
  fi
  if ! jq -e 'type == "object" and length > 0' >/dev/null 2>&1 <<<"${value}"; then
    bad "${label} — not a non-empty JSON object"
    return 1
  fi
  if grep -q "PRIVATE KEY" <<<"${value}"; then
    bad "${label} — CONTAINS A PRIVATE KEY. Rotate immediately."
    return 1
  fi
  if ! jq -e 'all(.[]; type == "string" and (contains("BEGIN PUBLIC KEY")))' >/dev/null 2>&1 <<<"${value}"; then
    bad "${label} — one or more entries is not an SPKI public-key PEM"
    return 1
  fi
  local kids
  kids=$(jq -r 'keys | join(", ")' <<<"${value}")
  ok "${label} — valid keyset, kid(s): ${kids}"
  return 0
}

section "2. JWT_PUBLIC_KEYS (user domain)"

USER_KEYSET_OK=1
verify_keyset_secret "jwt-public-keys" "jwt-public-keys" || USER_KEYSET_OK=0

for svc in ${SERVICES}; do
  in_list "${svc}" "${JWT_VERIFIERS}" || continue
  deployed=$(aws ecs describe-services --cluster "${CLUSTER}" --services "bidride-${svc}-${ENVIRONMENT}" \
    --region "${AWS_REGION}" --query 'services[0].taskDefinition' --output text 2>/dev/null)
  [[ -z "${deployed}" || "${deployed}" == "None" ]] && continue

  if aws ecs describe-task-definition --task-definition "${deployed}" --region "${AWS_REGION}" \
      --query "taskDefinition.containerDefinitions[?name=='${svc}'].secrets[].name" --output text 2>/dev/null \
      | tr '\t' '\n' | grep -qx "JWT_PUBLIC_KEYS"; then
    ok "${svc} — deployed revision injects JWT_PUBLIC_KEYS"
  else
    bad "${svc} — deployed revision does NOT inject JWT_PUBLIC_KEYS (RS256 tokens will be rejected)"
  fi
done

section "3. JWT_ADMIN_PUBLIC_KEYS (admin domain)"

ADMIN_KEYSET_OK=1
if in_list "admin-service" "${SERVICES}" || [[ "${TARGET}" == "all" ]]; then
  verify_keyset_secret "jwt-admin-public-keys" "jwt-admin-public-keys" || ADMIN_KEYSET_OK=0

  deployed=$(aws ecs describe-services --cluster "${CLUSTER}" --services "bidride-admin-service-${ENVIRONMENT}" \
    --region "${AWS_REGION}" --query 'services[0].taskDefinition' --output text 2>/dev/null)
  if [[ -n "${deployed}" && "${deployed}" != "None" ]]; then
    if aws ecs describe-task-definition --task-definition "${deployed}" --region "${AWS_REGION}" \
        --query "taskDefinition.containerDefinitions[?name=='admin-service'].secrets[].name" --output text 2>/dev/null \
        | tr '\t' '\n' | grep -qx "JWT_ADMIN_PUBLIC_KEYS"; then
      ok "admin-service — deployed revision injects JWT_ADMIN_PUBLIC_KEYS"
    else
      bad "admin-service — deployed revision does NOT inject JWT_ADMIN_PUBLIC_KEYS"
    fi
  fi

  # Domain separation: the two keysets must never share key material.
  u=$(aws secretsmanager get-secret-value --secret-id "bidride/${ENVIRONMENT}/jwt-public-keys" \
        --region "${AWS_REGION}" --query 'SecretString' --output text 2>/dev/null)
  a=$(aws secretsmanager get-secret-value --secret-id "bidride/${ENVIRONMENT}/jwt-admin-public-keys" \
        --region "${AWS_REGION}" --query 'SecretString' --output text 2>/dev/null)
  if [[ -n "${u}" && -n "${a}" && "${u}" != "None" && "${a}" != "None" ]]; then
    shared=$(jq -rn --argjson x "${u}" --argjson y "${a}" \
      '[$x[] as $p | $y[] | select(. == $p)] | length' 2>/dev/null || echo "0")
    if [[ "${shared}" == "0" ]]; then
      ok "user and admin keysets share no key material"
    else
      bad "user and admin keysets SHARE ${shared} key(s) — trust domains are crossed"
    fi
  fi
else
  skip "admin-service not in target — admin keyset not checked"
fi

# ── 4 & 5. Signing algorithm and KMS key ────────────────────────────────────

section "4. Signing algorithm"

for svc in ${SERVICES}; do
  in_list "${svc}" "${JWT_SIGNERS}" || continue

  deployed=$(aws ecs describe-services --cluster "${CLUSTER}" --services "bidride-${svc}-${ENVIRONMENT}" \
    --region "${AWS_REGION}" --query 'services[0].taskDefinition' --output text 2>/dev/null)
  [[ -z "${deployed}" || "${deployed}" == "None" ]] && continue

  env_json=$(aws ecs describe-task-definition --task-definition "${deployed}" --region "${AWS_REGION}" \
    --query "taskDefinition.containerDefinitions[?name=='${svc}'].environment | [0]" --output json 2>/dev/null)

  alg=$(jq -r '(map(select(.name=="JWT_SIGNING_ALG")) | .[0].value) // "<unset>"' <<<"${env_json}")
  kid=$(jq -r '(map(select(.name=="JWT_SIGNING_KID")) | .[0].value) // "<unset>"' <<<"${env_json}")

  case "${alg}" in
    HS256)
      ok "${svc} — JWT_SIGNING_ALG=HS256 (RS256 disabled, default posture)"
      ;;
    RS256)
      ok "${svc} — JWT_SIGNING_ALG=RS256, kid=${kid}"
      # The kid must exist in this service's own keyset.
      ks="jwt-public-keys"; [[ "${svc}" == "admin-service" ]] && ks="jwt-admin-public-keys"
      val=$(aws secretsmanager get-secret-value --secret-id "bidride/${ENVIRONMENT}/${ks}" \
            --region "${AWS_REGION}" --query 'SecretString' --output text 2>/dev/null)
      if jq -e --arg k "${kid}" 'has($k)' >/dev/null 2>&1 <<<"${val}"; then
        ok "${svc} — kid '${kid}' present in ${ks}"
      else
        bad "${svc} — kid '${kid}' is NOT in ${ks}; the service will refuse to boot"
      fi
      ;;
    "<unset>")
      bad "${svc} — JWT_SIGNING_ALG is not set on the deployed revision (infrastructure wiring missing)"
      ;;
    *)
      bad "${svc} — JWT_SIGNING_ALG='${alg}' is not a supported value"
      ;;
  esac

  # Cross-check against what the service actually logged at boot. Configuration
  # says what should happen; the log says what did.
  logged=$(aws logs filter-log-events \
    --log-group-name "/ecs/bidride/${svc}-${ENVIRONMENT}" \
    --region "${AWS_REGION}" \
    --start-time "$(( ($(date +%s) - 7200) * 1000 ))" \
    --filter-pattern '"JWT issuance algorithm:"' \
    --query 'events[-1].message' --output text 2>/dev/null)

  if [[ -z "${logged}" || "${logged}" == "None" ]]; then
    skip "${svc} — no 'JWT issuance algorithm' log line in the last 2h (task may predate the window)"
  elif grep -q "algorithm: ${alg}" <<<"${logged}"; then
    ok "${svc} — boot log agrees: ${alg}"
  else
    bad "${svc} — configured ${alg} but boot log says: ${logged}"
  fi
done

section "5. KMS signing key"

for svc in ${SERVICES}; do
  in_list "${svc}" "${JWT_SIGNERS}" || continue

  deployed=$(aws ecs describe-services --cluster "${CLUSTER}" --services "bidride-${svc}-${ENVIRONMENT}" \
    --region "${AWS_REGION}" --query 'services[0].taskDefinition' --output text 2>/dev/null)
  [[ -z "${deployed}" || "${deployed}" == "None" ]] && continue

  key_id=$(aws ecs describe-task-definition --task-definition "${deployed}" --region "${AWS_REGION}" \
    --query "taskDefinition.containerDefinitions[?name=='${svc}'].environment | [0]" --output json 2>/dev/null \
    | jq -r '(map(select(.name=="JWT_KMS_KEY_ID")) | .[0].value) // "<unset>"')

  if [[ "${key_id}" == "<unset>" ]]; then
    bad "${svc} — JWT_KMS_KEY_ID not set on the deployed revision"
    continue
  fi

  alias_name="alias/bidride-jwt-user-${ENVIRONMENT}"
  [[ "${svc}" == "admin-service" ]] && alias_name="alias/bidride-jwt-admin-${ENVIRONMENT}"

  expected_arn=$(aws kms describe-key --key-id "${alias_name}" --region "${AWS_REGION}" \
    --query 'KeyMetadata.Arn' --output text 2>/dev/null)
  actual_arn=$(aws kms describe-key --key-id "${key_id}" --region "${AWS_REGION}" \
    --query 'KeyMetadata.Arn' --output text 2>/dev/null)

  if [[ -n "${expected_arn}" && "${actual_arn}" == "${expected_arn}" ]]; then
    ok "${svc} — points at its own domain key (${alias_name})"
  else
    bad "${svc} — JWT_KMS_KEY_ID resolves to ${actual_arn:-<unresolvable>}, expected ${expected_arn:-<missing alias>}"
  fi

  spec=$(aws kms describe-key --key-id "${key_id}" --region "${AWS_REGION}" \
    --query 'KeyMetadata.[KeyUsage,KeySpec,KeyState]' --output text 2>/dev/null)
  read -r usage keyspec state <<<"${spec}"
  if [[ "${usage}" == "SIGN_VERIFY" && "${keyspec}" == "RSA_2048" ]]; then
    ok "${svc} — key is ${keyspec}/${usage}, state=${state}"
  else
    bad "${svc} — key is ${usage}/${keyspec}, expected SIGN_VERIFY/RSA_2048"
  fi
  [[ "${state}" != "Enabled" ]] && bad "${svc} — KMS key state is ${state}, not Enabled"

  # Least privilege: the task role must grant kms:Sign on this key ONLY.
  role_short="auth"; [[ "${svc}" == "admin-service" ]] && role_short="admin"
  role_name="bidride-ecs-task-${role_short}-${ENVIRONMENT}"
  policy_name="bidride-ecs-task-${role_short}-jwt-sign-${ENVIRONMENT}"

  pol=$(aws iam get-role-policy --role-name "${role_name}" --policy-name "${policy_name}" \
    --query 'PolicyDocument' --output json 2>/dev/null)
  if [[ -z "${pol}" ]]; then
    bad "${svc} — task role policy ${policy_name} not found on ${role_name}"
  else
    granted=$(jq -r '[.Statement[].Resource] | flatten | join(",")' <<<"${pol}")
    if [[ "${granted}" == "${expected_arn}" ]]; then
      ok "${svc} — task role grants kms:Sign on exactly its own key"
    else
      bad "${svc} — task role kms:Sign resource is '${granted}', expected exactly '${expected_arn}'"
    fi
  fi

  # The other domain's key must NOT be reachable from this role.
  other_alias="alias/bidride-jwt-admin-${ENVIRONMENT}"
  [[ "${svc}" == "admin-service" ]] && other_alias="alias/bidride-jwt-user-${ENVIRONMENT}"
  other_arn=$(aws kms describe-key --key-id "${other_alias}" --region "${AWS_REGION}" \
    --query 'KeyMetadata.Arn' --output text 2>/dev/null)
  if [[ -n "${pol}" && -n "${other_arn}" ]]; then
    if grep -qF "${other_arn}" <<<"${pol}"; then
      bad "${svc} — task role can also sign with the OTHER domain's key. Trust separation broken."
    else
      ok "${svc} — cannot sign with the other domain's key"
    fi
  fi
done

# ── 6. RS256 round trip ─────────────────────────────────────────────────────
# Sign a real JWT signing input with kms:Sign, then verify that signature
# against the PUBLISHED keyset using openssl. If this passes, a token the
# issuer mints is one every verifier holding this keyset can check.
#
# This never touches the running services and issues no usable credential: the
# payload is inert and carries no subject a verifier would accept.

section "6. RS256 sign → verify round trip"

rs256_roundtrip() {
  local domain="$1" alias_name="$2" secret_name="$3"
  local keyset kid pem tmp rc=0

  keyset=$(aws secretsmanager get-secret-value --secret-id "bidride/${ENVIRONMENT}/${secret_name}" \
    --region "${AWS_REGION}" --query 'SecretString' --output text 2>/dev/null)
  if [[ -z "${keyset}" || "${keyset}" == "None" ]]; then
    skip "${domain} — keyset not populated; round trip cannot run yet"
    return 0
  fi

  tmp=$(mktemp -d -t bidride-rs256-XXXXXX) || { bad "${domain} — mktemp failed"; return 1; }

  # Match the kid the issuer is configured to stamp when one is set, otherwise
  # test every kid in the keyset.
  local kids
  kids=$(jq -r 'keys[]' <<<"${keyset}")

  for kid in ${kids}; do
    jq -r --arg k "${kid}" '.[$k]' <<<"${keyset}" > "${tmp}/pub.pem"

    # KMS public half must equal the published PEM — same assertion the service
    # makes at boot (jwt-signing.config.ts assertSigningKeyMatchesKeyset).
    if ! aws kms get-public-key --key-id "${alias_name}" --region "${AWS_REGION}" \
         --query PublicKey --output text 2>/dev/null | openssl base64 -d -A > "${tmp}/kms.der" 2>/dev/null; then
      skip "${domain}/${kid} — kms:GetPublicKey denied for these credentials; round trip skipped"
      continue
    fi
    openssl pkey -pubin -inform DER -in "${tmp}/kms.der" -out "${tmp}/kms.pem" 2>/dev/null

    if ! diff -q <(openssl pkey -pubin -in "${tmp}/kms.pem" -outform DER 2>/dev/null | openssl dgst -sha256) \
                 <(openssl pkey -pubin -in "${tmp}/pub.pem" -outform DER 2>/dev/null | openssl dgst -sha256) >/dev/null; then
      info "${domain}/${kid} — not this KMS key's public half (expected when the keyset holds a rotated key)"
      continue
    fi

    # Build a real JWT signing input.
    local header payload signing_input
    header=$(printf '{"alg":"RS256","typ":"JWT","kid":"%s"}' "${kid}" | b64url)
    payload=$(printf '{"iss":"bidride-deployment-verification","purpose":"rs256-roundtrip","iat":%s}' "$(date +%s)" | b64url)
    signing_input="${header}.${payload}"
    printf '%s' "${signing_input}" > "${tmp}/input.txt"

    # DIGEST message type — exactly what AwsKmsSigner sends.
    openssl dgst -sha256 -binary "${tmp}/input.txt" > "${tmp}/digest.bin"

    if ! aws kms sign \
        --key-id "${alias_name}" \
        --message "fileb://${tmp}/digest.bin" \
        --message-type DIGEST \
        --signing-algorithm RSASSA_PKCS1_V1_5_SHA_256 \
        --region "${AWS_REGION}" \
        --query Signature --output text 2>/dev/null | openssl base64 -d -A > "${tmp}/sig.bin" 2>/dev/null; then
      skip "${domain}/${kid} — kms:Sign denied for these credentials; round trip skipped"
      continue
    fi

    if openssl dgst -sha256 -verify "${tmp}/pub.pem" -signature "${tmp}/sig.bin" "${tmp}/input.txt" >/dev/null 2>&1; then
      ok "${domain}/${kid} — KMS signature VERIFIES against the published keyset"
    else
      bad "${domain}/${kid} — KMS signature does NOT verify against the published keyset. Do not enable RS256."
      rc=1
    fi
  done

  rm -rf "${tmp}"
  return "${rc}"
}

if [[ "${TARGET}" == "all" || "${TARGET}" == "auth-service" ]]; then
  rs256_roundtrip "user"  "alias/bidride-jwt-user-${ENVIRONMENT}"  "jwt-public-keys"
fi
if [[ "${TARGET}" == "all" || "${TARGET}" == "admin-service" ]]; then
  rs256_roundtrip "admin" "alias/bidride-jwt-admin-${ENVIRONMENT}" "jwt-admin-public-keys"
fi

# ── 7. Alerting readiness ───────────────────────────────────────────────────

if [[ "${TARGET}" == "all" ]]; then
  section "7. Alerting"

  topic_arn=$(aws sns list-topics --region "${AWS_REGION}" \
    --query "Topics[?ends_with(TopicArn, ':bidride-alerts-${ENVIRONMENT}')].TopicArn | [0]" --output text 2>/dev/null)

  if [[ -z "${topic_arn}" || "${topic_arn}" == "None" ]]; then
    bad "SNS topic bidride-alerts-${ENVIRONMENT} not found — alarms would notify nobody"
  else
    ok "alert topic exists"
    pending=$(aws sns list-subscriptions-by-topic --topic-arn "${topic_arn}" --region "${AWS_REGION}" \
      --query "length(Subscriptions[?SubscriptionArn=='PendingConfirmation'])" --output text 2>/dev/null)
    confirmed=$(aws sns list-subscriptions-by-topic --topic-arn "${topic_arn}" --region "${AWS_REGION}" \
      --query "length(Subscriptions[?SubscriptionArn!='PendingConfirmation'])" --output text 2>/dev/null)
    if [[ "${confirmed:-0}" -gt 0 ]]; then
      ok "${confirmed} confirmed subscription(s)"
    else
      bad "no CONFIRMED subscriptions (${pending:-0} pending) — click the SNS confirmation email"
    fi
    orphans=$(aws cloudwatch describe-alarms --region "${AWS_REGION}" \
      --alarm-name-prefix "bidride-" \
      --query "length(MetricAlarms[?length(AlarmActions)==\`0\`])" --output text 2>/dev/null)
    if [[ "${orphans:-0}" -eq 0 ]]; then
      ok "every bidride alarm has an action"
    else
      bad "${orphans} bidride alarm(s) have no alarm_actions"
    fi
  fi
fi

# ── Summary ─────────────────────────────────────────────────────────────────

TOTAL=$((PASS + FAIL))
echo ""
echo "════════════════════════════════════════════════════"
if [[ ${FAIL} -eq 0 ]]; then
  echo -e "  ${GREEN}VERIFICATION PASSED${NC} — ${PASS}/${TOTAL} checks, ${SKIP} skipped"
else
  echo -e "  ${RED}${FAIL} CHECK(S) FAILED${NC} — ${PASS}/${TOTAL} passed, ${SKIP} skipped"
fi
echo "════════════════════════════════════════════════════"
echo ""
[[ ${FAIL} -eq 0 ]] || exit 1
