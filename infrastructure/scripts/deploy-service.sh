#!/usr/bin/env bash
# BidRide — deploy ONE ECS service onto an explicit task-definition revision.
#
# THE PROBLEM THIS SOLVES
# -----------------------
# Every ECS service in this stack carries `ignore_changes = [task_definition]`.
# Terraform therefore registers new revisions but never moves a service onto
# one. The previous pipeline ran `aws ecs update-service --force-new-deployment`
# with no `--task-definition`, which restarts tasks on the revision the service
# is ALREADY pinned to. The net effect: task-definition changes — new secrets,
# new environment variables — never reached production, and every checkpoint
# still reported success.
#
# WHAT THIS SCRIPT GUARANTEES
# ---------------------------
#   1. It reads the LATEST ACTIVE revision of the family (the shape Terraform
#      most recently produced), never an older one.
#   2. It resolves the image tag to a sha256 DIGEST and pins the revision to
#      repo@sha256:… — so the deployed reference cannot change meaning later,
#      and a rollback to this ARN restores these exact bytes.
#   3. It registers that revision and deploys it BY EXPLICIT ARN.
#   4. It refuses to report success until every running task is on that ARN.
#
# Usage:
#   deploy-service.sh <staging|production> <service> <image-tag> [--no-wait] [--desired-count N]
#
# Environment:
#   AWS_REGION            defaults to us-east-1
#   DEPLOY_RECORD_DIR     defaults to infrastructure/deploy-records/<env>
#   DEPLOY_TIMEOUT_TRIES  services-stable retries (default 60 ≈ 15 min)
#
# Requires: aws CLI v2, jq.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AWS_REGION="${AWS_REGION:-us-east-1}"
DEPLOY_TIMEOUT_TRIES="${DEPLOY_TIMEOUT_TRIES:-60}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}→${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
die()  { echo -e "${RED}✗ ERROR:${NC} $*" >&2; exit 1; }

# ── Arguments ────────────────────────────────────────────────────────────────

ENVIRONMENT="${1:-}"
SERVICE="${2:-}"
IMAGE_TAG="${3:-}"

# Trailing flags, order-independent.
#
# --desired-count N exists because Terraform creates every ECS service with
# `ignore_changes = [task_definition, desired_count]`. Terraform therefore sets
# the count ONCE at creation and never again: it owns infrastructure shape, this
# script owns what is running. Staging is bootstrapped at 0 so that `terraform
# apply` never asks ECS to start a task before its image and secrets exist, and
# the first real deployment scales the service to 1 as a deliberate, reviewable
# act. Passing it on later deploys is unnecessary — omit it and the current
# count is preserved.
NO_WAIT=""
DESIRED_COUNT=""
while [[ $# -gt 3 ]]; do
  case "${4}" in
    --no-wait) NO_WAIT="--no-wait"; shift ;;
    --desired-count)
      DESIRED_COUNT="${5:-}"
      [[ "${DESIRED_COUNT}" =~ ^[0-9]+$ ]] || die "--desired-count requires a non-negative integer (got '${DESIRED_COUNT:-<none>}')"
      shift 2 ;;
    *) die "unknown argument '${4}'" ;;
  esac
done

case "${ENVIRONMENT}" in
  staging|production) ;;
  *) die "usage: $0 <staging|production> <service> <image-tag> [--no-wait] [--desired-count N]" ;;
esac
[[ -n "${SERVICE}"   ]] || die "service name required"
[[ -n "${IMAGE_TAG}" ]] || die "image tag required (the git SHA the pipeline built)"

command -v jq  >/dev/null || die "jq is required"
command -v aws >/dev/null || die "aws CLI is required"

CLUSTER="bidride-${ENVIRONMENT}"
ECS_SERVICE="bidride-${SERVICE}-${ENVIRONMENT}"
FAMILY="bidride-${SERVICE}-${ENVIRONMENT}"
ECR_REPO="bidride/${SERVICE}"

DEPLOY_RECORD_DIR="${DEPLOY_RECORD_DIR:-${REPO_ROOT}/infrastructure/deploy-records/${ENVIRONMENT}}"
mkdir -p "${DEPLOY_RECORD_DIR}"

echo
echo "════════════════════════════════════════════════════"
echo "  Deploy ${SERVICE} → ${ENVIRONMENT}"
echo "  cluster=${CLUSTER}  tag=${IMAGE_TAG}"
echo "════════════════════════════════════════════════════"

# ── 1. Record what is running NOW — this is the rollback target ──────────────
# Captured before anything changes. Rollback never recomputes a revision by
# arithmetic; it replays this exact string.

PREVIOUS_TD=$(aws ecs describe-services \
  --cluster "${CLUSTER}" --services "${ECS_SERVICE}" --region "${AWS_REGION}" \
  --query 'services[0].taskDefinition' --output text)

[[ -n "${PREVIOUS_TD}" && "${PREVIOUS_TD}" != "None" ]] \
  || die "could not read the current task definition for ${ECS_SERVICE} (does the service exist?)"

info "currently deployed: ${PREVIOUS_TD}"

# ── 2. Latest ACTIVE revision of the family ─────────────────────────────────
# Describing by FAMILY (no :revision suffix) returns the latest ACTIVE revision.
# That is the shape Terraform most recently registered.

BASE_TD_JSON=$(aws ecs describe-task-definition \
  --task-definition "${FAMILY}" --region "${AWS_REGION}" \
  --include TAGS 2>/dev/null) \
  || die "no ACTIVE task definition in family ${FAMILY} — run terraform apply first"

BASE_TD_ARN=$(jq -r '.taskDefinition.taskDefinitionArn' <<<"${BASE_TD_JSON}")
info "latest ACTIVE shape: ${BASE_TD_ARN}"

if [[ "${BASE_TD_ARN}" != "${PREVIOUS_TD}" ]]; then
  warn "the running revision is NOT the latest ACTIVE one — this deploy will move it forward"
fi

# ── 3. Resolve the image tag to an immutable digest ─────────────────────────

DIGEST=$(aws ecr describe-images \
  --repository-name "${ECR_REPO}" --region "${AWS_REGION}" \
  --image-ids "imageTag=${IMAGE_TAG}" \
  --query 'imageDetails[0].imageDigest' --output text 2>/dev/null) \
  || die "image ${ECR_REPO}:${IMAGE_TAG} not found in ECR — was it built and pushed?"

[[ "${DIGEST}" == sha256:* ]] || die "unexpected digest for ${ECR_REPO}:${IMAGE_TAG}: '${DIGEST}'"

REGISTRY=$(jq -r --arg name "${SERVICE}" '
  .taskDefinition.containerDefinitions[] | select(.name == $name) | .image
' <<<"${BASE_TD_JSON}" | sed -E 's#(/bidride/.*)$##')

[[ -n "${REGISTRY}" ]] || die "could not derive the ECR registry from the base task definition"

IMAGE_REF="${REGISTRY}/${ECR_REPO}@${DIGEST}"
ok "image pinned by digest: ${IMAGE_REF}"

# ── 4. Derive the revision to register ──────────────────────────────────────
# Strip the server-managed fields, swap the image, stamp the build SHA.
# Everything else — secrets, environment, roles, limits, health check — is
# carried over from Terraform's shape untouched.

CONTAINER_EXISTS=$(jq -r --arg name "${SERVICE}" \
  '[.taskDefinition.containerDefinitions[] | select(.name == $name)] | length' <<<"${BASE_TD_JSON}")
[[ "${CONTAINER_EXISTS}" == "1" ]] \
  || die "expected exactly one container named '${SERVICE}' in ${FAMILY}, found ${CONTAINER_EXISTS}"

NEW_TD_INPUT=$(jq \
  --arg name  "${SERVICE}" \
  --arg image "${IMAGE_REF}" \
  --arg sha   "${IMAGE_TAG}" \
  '
  # Carry the family tags across: describe-task-definition returns them as a
  # sibling of .taskDefinition, but register-task-definition expects them
  # inside the input document.
  (.tags // []) as $tags
  | .taskDefinition
  | del(
      .taskDefinitionArn, .revision, .status, .requiresAttributes,
      .compatibilities, .registeredAt, .registeredBy, .deregisteredAt
    )
  | .containerDefinitions |= map(
      if .name == $name then
        .image = $image
        | .environment = (
            ((.environment // []) | map(select(.name != "GIT_COMMIT_SHA")))
            + [{ name: "GIT_COMMIT_SHA", value: $sha }]
          )
      else . end
    )
  | if ($tags | length) > 0 then . + { tags: $tags } else . end
  ' <<<"${BASE_TD_JSON}")

TMP_INPUT="$(mktemp -t bidride-td-XXXXXX.json)"
trap 'rm -f "${TMP_INPUT}"' EXIT
printf '%s' "${NEW_TD_INPUT}" > "${TMP_INPUT}"

NEW_TD_ARN=$(aws ecs register-task-definition \
  --region "${AWS_REGION}" \
  --cli-input-json "file://${TMP_INPUT}" \
  --query 'taskDefinition.taskDefinitionArn' --output text) \
  || die "register-task-definition failed"

ok "registered: ${NEW_TD_ARN}"

# ── 5. Deploy BY EXPLICIT ARN ───────────────────────────────────────────────
# Not --force-new-deployment. The ARN is the whole point.

SCALE_ARGS=()
if [[ -n "${DESIRED_COUNT}" ]]; then
  SCALE_ARGS=(--desired-count "${DESIRED_COUNT}")
  info "scaling ${ECS_SERVICE} to desired-count=${DESIRED_COUNT}"
fi

aws ecs update-service \
  --cluster "${CLUSTER}" \
  --service "${ECS_SERVICE}" \
  --task-definition "${NEW_TD_ARN}" \
  "${SCALE_ARGS[@]+"${SCALE_ARGS[@]}"}" \
  --region "${AWS_REGION}" \
  --query 'service.serviceName' --output text >/dev/null \
  || die "update-service failed"

ok "update-service accepted ${NEW_TD_ARN}"

# A service left at desired-count 0 goes "stable" instantly with zero tasks, and
# the fleet check below would then fail with a misleading "no running tasks after
# a successful rollout". Catch it here, where the cause is still obvious.
#
# But `--desired-count 0` is also a deliberate, load-bearing move: it registers a
# digest-pinned revision and makes it PRIMARY *without* launching a task, so that
# a later circuit-breaker rollback lands on a pullable image instead of the
# `:bootstrap` tag that does not exist in ECR. Every service deployed so far used
# it as a rollback baseline. Treating that success as a failure made the script
# exit 1 on a run that had done exactly what was asked, so operators learned to
# ignore its exit code — which is far more dangerous than the original problem.
#
# So: intentional baseline → success. Unintended zero → still a hard error.
BASELINE_ONLY=""
CURRENT_DESIRED=$(aws ecs describe-services \
  --cluster "${CLUSTER}" --services "${ECS_SERVICE}" --region "${AWS_REGION}" \
  --query 'services[0].desiredCount' --output text)
if [[ "${CURRENT_DESIRED}" == "0" ]]; then
  if [[ "${DESIRED_COUNT}" == "0" ]]; then
    BASELINE_ONLY="yes"
    ok "baseline established at desired-count 0 — revision is PRIMARY, no task launched"
  else
    die "${ECS_SERVICE} has desired-count 0 — the revision is deployed but nothing will run.
     This is the expected state straight after the staging bootstrap apply.
     Re-run with --desired-count 1 once the image exists and every secret this
     service consumes has a value."
  fi
fi

# ── 6. Write the deploy record BEFORE waiting ───────────────────────────────
# If the wait times out, or the shell dies, the rollback target must already be
# on disk. A rollback plan that only exists in a completed run is not a plan.

RECORD="${DEPLOY_RECORD_DIR}/${SERVICE}.json"
jq -n \
  --arg service    "${SERVICE}" \
  --arg env        "${ENVIRONMENT}" \
  --arg cluster    "${CLUSTER}" \
  --arg ecsService "${ECS_SERVICE}" \
  --arg previous   "${PREVIOUS_TD}" \
  --arg deployed   "${NEW_TD_ARN}" \
  --arg image      "${IMAGE_REF}" \
  --arg tag        "${IMAGE_TAG}" \
  --arg at         "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  '{service:$service, environment:$env, cluster:$cluster, ecsService:$ecsService,
    previousTaskDefinition:$previous, deployedTaskDefinition:$deployed,
    image:$image, imageTag:$tag, deployedAt:$at}' > "${RECORD}"

ok "rollback target recorded → ${RECORD#"${REPO_ROOT}/"}"

# The baseline exits here, deliberately: there is no task to wait for and no
# fleet to verify. Note this is *after* the deploy record is written — the old
# code died before this point, so an intentional baseline left no rollback target
# on disk at all, which is precisely the state the record exists to prevent.
if [[ -n "${BASELINE_ONLY}" ]]; then
  info "no task launched (desired-count 0). Deploy for real with:"
  echo "  $0 ${ENVIRONMENT} ${SERVICE} ${IMAGE_TAG} --desired-count 1"
  exit 0
fi

if [[ "${NO_WAIT}" == "--no-wait" ]]; then
  warn "--no-wait: not waiting for stability, not verifying"
  echo "ROLLBACK: infrastructure/scripts/rollback-service.sh ${ENVIRONMENT} ${SERVICE}"
  exit 0
fi

# ── 7. Wait for stability ───────────────────────────────────────────────────
# `aws ecs wait services-stable` polls 15s x 40 by default. Services here can
# take longer than that, so drive the loop explicitly.

info "waiting for ${ECS_SERVICE} to stabilise…"
tries=0
while (( tries < DEPLOY_TIMEOUT_TRIES )); do
  read -r running desired rollout <<<"$(aws ecs describe-services \
    --cluster "${CLUSTER}" --services "${ECS_SERVICE}" --region "${AWS_REGION}" \
    --query 'services[0].[runningCount,desiredCount,deployments[?status==`PRIMARY`]|[0].rolloutState]' \
    --output text)"

  if [[ "${rollout}" == "FAILED" ]]; then
    die "deployment rolloutState=FAILED — the ECS circuit breaker rejected it.
     ${ECS_SERVICE} has been rolled back by ECS to its last stable revision.
     Check: aws logs tail /ecs/bidride/${SERVICE}-${ENVIRONMENT} --since 10m"
  fi

  if [[ "${rollout}" == "COMPLETED" && "${running}" == "${desired}" ]]; then
    ok "stable — ${running}/${desired} tasks"
    break
  fi

  tries=$((tries + 1))
  (( tries % 4 == 0 )) && info "  … ${running}/${desired} running, rollout=${rollout} (${tries}/${DEPLOY_TIMEOUT_TRIES})"
  sleep 15
done

(( tries < DEPLOY_TIMEOUT_TRIES )) || die "timed out waiting for ${ECS_SERVICE} to stabilise"

# ── 8. Prove the fleet is on the ARN we deployed ────────────────────────────
# services-stable is necessary but not sufficient: a service can be "stable"
# while still serving an older revision. This is the check that actually closes
# the propagation gap.

# Deliberately not `mapfile` — macOS ships bash 3.2 and an operator running a
# rollback from a laptop must not hit a syntax error.
TASK_ARNS=$(aws ecs list-tasks \
  --cluster "${CLUSTER}" --service-name "${ECS_SERVICE}" --region "${AWS_REGION}" \
  --query 'taskArns[]' --output text | tr '\t' '\n' | sed '/^$/d')

[[ -n "${TASK_ARNS}" ]] || die "no running tasks for ${ECS_SERVICE} after a successful rollout"
TASK_COUNT=$(wc -l <<<"${TASK_ARNS}" | tr -d ' ')

# shellcheck disable=SC2086 — word splitting is intended: one --tasks argument per ARN.
REVISIONS=$(aws ecs describe-tasks \
  --cluster "${CLUSTER}" --tasks ${TASK_ARNS} --region "${AWS_REGION}" \
  --query 'tasks[].taskDefinitionArn' --output text | tr '\t' '\n' | sort -u)

if [[ "$(wc -l <<<"${REVISIONS}")" -ne 1 ]]; then
  echo "${REVISIONS}" >&2
  die "MIXED FLEET — more than one task-definition revision is serving ${ECS_SERVICE}"
fi

[[ "${REVISIONS}" == "${NEW_TD_ARN}" ]] \
  || die "fleet is running ${REVISIONS} but we deployed ${NEW_TD_ARN}"

ok "verified: all ${TASK_COUNT} task(s) on ${NEW_TD_ARN}"

echo
echo "════════════════════════════════════════════════════"
echo -e "  ${GREEN}${SERVICE} deployed${NC}"
echo "  revision : ${NEW_TD_ARN##*/}"
echo "  image    : ${IMAGE_REF##*@}"
echo "  rollback : infrastructure/scripts/rollback-service.sh ${ENVIRONMENT} ${SERVICE}"
echo "════════════════════════════════════════════════════"
