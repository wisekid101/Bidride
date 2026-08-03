#!/usr/bin/env bash
#
# preflight-service.sh <staging|production> <service> [image-tag]
#
# Step 1 of the deployment workflow — readiness verification — as a command
# instead of a habit.
#
# Every staging deployment failure so far was detectable before the deploy and
# was instead found by ECS killing tasks:
#
#   ai-service      no /health route; the container health check curls /health,
#                   got the /* catch-all 404 every 30s, and ECS SIGTERM'd the
#                   task until the circuit breaker failed the rollout — while
#                   the application itself booted perfectly.
#   every service   an empty Secrets Manager container makes ECS fail task
#                   initialisation before the process ever starts.
#   trust-service   a required env var missing from the task definition surfaces
#                   as a FATAL at boot, not as a config error at deploy time.
#
# Each check below exists because that failure actually happened. Read-only:
# this script never mutates AWS.
#
# Exit 0 = safe to deploy. Exit 1 = do not deploy, reason printed.

set -uo pipefail

RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YEL=$'\033[0;33m'; NC=$'\033[0m'
ok()   { echo "${GRN}✓${NC} $*"; }
bad()  { echo "${RED}✗${NC} $*"; FAILED=$((FAILED + 1)); }
warn() { echo "${YEL}!${NC} $*"; }
die()  { echo "${RED}✗ ERROR:${NC} $*" >&2; exit 1; }

ENVIRONMENT="${1:-}"
SERVICE="${2:-}"
IMAGE_TAG="${3:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"
FAILED=0

case "${ENVIRONMENT}" in
  staging|production) ;;
  *) die "usage: $0 <staging|production> <service> [image-tag]" ;;
esac
[[ -n "${SERVICE}" ]] || die "service name required (e.g. auth, rider, safety)"

command -v aws     >/dev/null || die "aws CLI is required"
command -v python3 >/dev/null || die "python3 is required"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${REPO_ROOT}/services/${SERVICE}-service/src"
FAMILY="bidride-${SERVICE}-service-${ENVIRONMENT}"

[[ -d "${SRC}" ]] || die "no such service: services/${SERVICE}-service"

echo "── preflight: ${SERVICE}-service (${ENVIRONMENT}) ──"

# ── 1. The /health route the container health check probes ───────────────────
# ECS runs `curl -sf http://localhost:<PORT>/health`. The observability
# controllers provide /live, /ready and /metrics — NOT /health. Having only
# those is exactly the ai-service failure.
if [[ -f "${SRC}/health.controller.ts" ]] \
   && grep -q "HealthController" "${SRC}/app.module.ts" 2>/dev/null; then
  ok "/health route present and registered in app.module"
else
  bad "no /health controller registered — the ECS health check will 404 and ECS will kill every task"
fi

# ── 2. Task definition exists ────────────────────────────────────────────────
TD_JSON=$(aws ecs describe-task-definition --task-definition "${FAMILY}" \
  --region "${AWS_REGION}" --output json 2>/dev/null)
if [[ -z "${TD_JSON}" ]]; then
  bad "no ACTIVE task definition in family ${FAMILY} — run terraform apply first"
  echo "── ${FAILED} blocking problem(s) ──"; exit 1
fi
ok "task definition family ${FAMILY} exists"

# ── 3. Every required variable is supplied by the task definition ────────────
# A var read with config.getOrThrow(), or enforced by a main.ts refuse-to-start
# guard, must appear in secrets[] or environment[]. Otherwise the service boots
# far enough to look alive and then dies on first use.
REQUIRED=$(grep -rhoE "getOrThrow<?[^(]*\(\s*['\"][A-Za-z_]+['\"]" "${SRC}" --include="*.ts" 2>/dev/null \
  | grep -v spec | grep -oE "['\"][A-Za-z_]+['\"]" | tr -d "\"'" | sort -u)
if grep -q "INTERNAL_SERVICE_KEY is required" "${SRC}/main.ts" 2>/dev/null; then
  REQUIRED="${REQUIRED}"$'\n'"INTERNAL_SERVICE_KEY"
fi

SUPPLIED=$(echo "${TD_JSON}" | python3 -c "
import json,sys
c=json.load(sys.stdin)['taskDefinition']['containerDefinitions'][0]
print('\n'.join([s['name'] for s in c.get('secrets') or []]
               +[e['name'] for e in c.get('environment') or []]))")

MISSING=$(comm -23 <(echo "${REQUIRED}" | grep -v '^$' | sort -u) <(echo "${SUPPLIED}" | sort -u))
if [[ -z "${MISSING}" ]]; then
  ok "all $(echo "${REQUIRED}" | grep -cv '^$') required variables supplied by the task definition"
else
  bad "required but NOT in the task definition: $(echo "${MISSING}" | tr '\n' ' ')"
fi

# ── 4. Every referenced secret actually has a value ──────────────────────────
# ECS resolves all of secrets[] before starting the container. A container that
# exists but holds no AWSCURRENT version fails task initialisation — the process
# never runs, so nothing is logged and the cause is invisible from the service.
EMPTY=""
while read -r name arn; do
  [[ -z "${name}" ]] && continue
  sid="${arn%%:*}"; [[ "${arn}" == arn:* ]] && sid="${arn}"
  have=$(aws secretsmanager list-secret-version-ids --secret-id "${sid}" --region "${AWS_REGION}" \
    --query "length(Versions[?contains(VersionStages,'AWSCURRENT')])" --output text 2>/dev/null)
  [[ "${have}" == "1" ]] || EMPTY="${EMPTY} ${name}"
done < <(echo "${TD_JSON}" | python3 -c "
import json,sys
c=json.load(sys.stdin)['taskDefinition']['containerDefinitions'][0]
for s in c.get('secrets') or []: print(s['name'], s['valueFrom'])")

if [[ -z "${EMPTY}" ]]; then
  ok "every referenced secret has exactly one AWSCURRENT version"
else
  bad "secret containers with NO value — ECS cannot start the task:${EMPTY}"
fi

# ── 5. The image exists in ECR ───────────────────────────────────────────────
if [[ -n "${IMAGE_TAG}" ]]; then
  DIGEST=$(aws ecr describe-images --repository-name "bidride/${SERVICE}-service" \
    --image-ids "imageTag=${IMAGE_TAG}" --region "${AWS_REGION}" \
    --query 'imageDetails[0].imageDigest' --output text 2>/dev/null)
  if [[ "${DIGEST}" == sha256:* ]]; then
    ok "image bidride/${SERVICE}-service:${IMAGE_TAG} → ${DIGEST}"
  else
    bad "image bidride/${SERVICE}-service:${IMAGE_TAG} not found in ECR — build and push it first"
  fi
else
  warn "no image tag given — skipping the ECR check (pass one to verify)"
fi

echo
if (( FAILED == 0 )); then
  ok "preflight passed — safe to deploy ${SERVICE}-service to ${ENVIRONMENT}"
  exit 0
fi
echo "${RED}${FAILED} blocking problem(s) — do not deploy${NC}"
exit 1
