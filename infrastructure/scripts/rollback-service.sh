#!/usr/bin/env bash
# BidRide — roll an ECS service back to an EXACT task-definition ARN.
#
# WHAT THIS REPLACES
# ------------------
# The previous procedure (DEPLOYMENT_RUNBOOK "Fast Rollback") computed the
# target as CURRENT_REVISION - 1. That was wrong three ways:
#
#   1. Under `ignore_changes = [task_definition]` the service's pinned revision
#      drifts far behind the family's latest, so "current - 1" is arithmetic on
#      the wrong number and can land many generations back.
#   2. Every revision referenced the mutable :latest tag, so reverting the
#      revision reverted configuration but NOT code — the container still
#      pulled whatever was pushed most recently.
#   3. It never checked that the computed revision existed or was ACTIVE, and
#      produced ":0" when the service was on revision 1.
#
# This script takes no arithmetic. It replays the exact ARN recorded by
# deploy-service.sh before the deploy touched anything, and that ARN is pinned
# to an image DIGEST — so rolling back restores the exact bytes that were
# running.
#
# Usage:
#   rollback-service.sh <staging|production> <service>              # recorded target
#   rollback-service.sh <staging|production> <service> <exact-arn>  # explicit target
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

ENVIRONMENT="${1:-}"
SERVICE="${2:-}"
TARGET_ARN="${3:-}"

case "${ENVIRONMENT}" in
  staging|production) ;;
  *) die "usage: $0 <staging|production> <service> [exact-task-definition-arn]" ;;
esac
[[ -n "${SERVICE}" ]] || die "service name required"

command -v jq  >/dev/null || die "jq is required"
command -v aws >/dev/null || die "aws CLI is required"

CLUSTER="bidride-${ENVIRONMENT}"
ECS_SERVICE="bidride-${SERVICE}-${ENVIRONMENT}"
DEPLOY_RECORD_DIR="${DEPLOY_RECORD_DIR:-${REPO_ROOT}/infrastructure/deploy-records/${ENVIRONMENT}}"
RECORD="${DEPLOY_RECORD_DIR}/${SERVICE}.json"

# ── Resolve the target ──────────────────────────────────────────────────────

if [[ -z "${TARGET_ARN}" ]]; then
  [[ -f "${RECORD}" ]] || die \
"no deploy record at ${RECORD}, and no ARN given.

Recover the target from ECS history and pass it explicitly:
  aws ecs list-task-definitions --family-prefix bidride-${SERVICE}-${ENVIRONMENT} \\
    --status ACTIVE --sort DESC --region ${AWS_REGION} --max-items 10

Then: $0 ${ENVIRONMENT} ${SERVICE} <arn>"

  TARGET_ARN=$(jq -r '.previousTaskDefinition' "${RECORD}")
  DEPLOYED_ARN=$(jq -r '.deployedTaskDefinition' "${RECORD}")
  DEPLOYED_AT=$(jq -r '.deployedAt' "${RECORD}")
  info "deploy record: ${DEPLOYED_AT}"
  info "  deployed : ${DEPLOYED_ARN}"
  info "  rollback : ${TARGET_ARN}"
fi

[[ "${TARGET_ARN}" == arn:aws:ecs:* ]] \
  || die "target must be a full task-definition ARN, got '${TARGET_ARN}'"

# ── Verify the target is real and ACTIVE before touching the service ────────
# The old procedure skipped this and could issue an update-service against a
# revision that had been deregistered.

TARGET_STATUS=$(aws ecs describe-task-definition \
  --task-definition "${TARGET_ARN}" --region "${AWS_REGION}" \
  --query 'taskDefinition.status' --output text 2>/dev/null) \
  || die "task definition ${TARGET_ARN} does not exist"

[[ "${TARGET_STATUS}" == "ACTIVE" ]] \
  || die "task definition ${TARGET_ARN} is ${TARGET_STATUS}, not ACTIVE — cannot roll back to it"

TARGET_IMAGE=$(aws ecs describe-task-definition \
  --task-definition "${TARGET_ARN}" --region "${AWS_REGION}" \
  --query "taskDefinition.containerDefinitions[?name=='${SERVICE}'].image | [0]" --output text)

if [[ "${TARGET_IMAGE}" != *"@sha256:"* ]]; then
  warn "target image is TAG-pinned, not digest-pinned: ${TARGET_IMAGE}"
  warn "this revision predates digest pinning — the image it resolves to may have changed."
fi

CURRENT_ARN=$(aws ecs describe-services \
  --cluster "${CLUSTER}" --services "${ECS_SERVICE}" --region "${AWS_REGION}" \
  --query 'services[0].taskDefinition' --output text)

echo
echo "════════════════════════════════════════════════════"
echo "  ROLLBACK ${SERVICE} (${ENVIRONMENT})"
echo "    from : ${CURRENT_ARN}"
echo "    to   : ${TARGET_ARN}"
echo "    image: ${TARGET_IMAGE}"
echo "════════════════════════════════════════════════════"

if [[ "${CURRENT_ARN}" == "${TARGET_ARN}" ]]; then
  ok "already running the target revision — nothing to do"
  exit 0
fi

if [[ "${ROLLBACK_ASSUME_YES:-}" != "true" ]]; then
  read -r -p "Proceed? [yes/N] " reply
  [[ "${reply}" == "yes" ]] || die "aborted"
fi

# ── Roll back ───────────────────────────────────────────────────────────────

aws ecs update-service \
  --cluster "${CLUSTER}" \
  --service "${ECS_SERVICE}" \
  --task-definition "${TARGET_ARN}" \
  --region "${AWS_REGION}" \
  --query 'service.serviceName' --output text >/dev/null \
  || die "update-service failed"

ok "rollback issued"

info "waiting for ${ECS_SERVICE} to stabilise…"
tries=0
while (( tries < DEPLOY_TIMEOUT_TRIES )); do
  read -r running desired rollout <<<"$(aws ecs describe-services \
    --cluster "${CLUSTER}" --services "${ECS_SERVICE}" --region "${AWS_REGION}" \
    --query 'services[0].[runningCount,desiredCount,deployments[?status==`PRIMARY`]|[0].rolloutState]' \
    --output text)"

  [[ "${rollout}" == "FAILED" ]] && die "rollback deployment FAILED — escalate; ${ECS_SERVICE} needs manual attention"
  [[ "${rollout}" == "COMPLETED" && "${running}" == "${desired}" ]] && { ok "stable — ${running}/${desired} tasks"; break; }

  tries=$((tries + 1))
  sleep 15
done
(( tries < DEPLOY_TIMEOUT_TRIES )) || die "timed out waiting for rollback to stabilise"

# ── Prove it ────────────────────────────────────────────────────────────────

TASK_ARNS=$(aws ecs list-tasks \
  --cluster "${CLUSTER}" --service-name "${ECS_SERVICE}" --region "${AWS_REGION}" \
  --query 'taskArns[]' --output text | tr '\t' '\n' | sed '/^$/d')
[[ -n "${TASK_ARNS}" ]] || die "no running tasks after rollback"

# shellcheck disable=SC2086
REVISIONS=$(aws ecs describe-tasks \
  --cluster "${CLUSTER}" --tasks ${TASK_ARNS} --region "${AWS_REGION}" \
  --query 'tasks[].taskDefinitionArn' --output text | tr '\t' '\n' | sort -u)

[[ "$(wc -l <<<"${REVISIONS}")" -eq 1 && "${REVISIONS}" == "${TARGET_ARN}" ]] \
  || die "rollback did not converge — fleet is on: ${REVISIONS}"

ok "verified: fleet on ${TARGET_ARN}"

# Record the rollback so the next operator sees the true current state.
if [[ -f "${RECORD}" ]]; then
  tmp="$(mktemp -t bidride-rec-XXXXXX.json)"
  jq --arg t "${TARGET_ARN}" --arg at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    '.rolledBackTo = $t | .rolledBackAt = $at' "${RECORD}" > "${tmp}" && mv "${tmp}" "${RECORD}"
fi

echo
echo -e "${GREEN}Rollback complete.${NC} Re-run verification before declaring the incident closed:"
echo "  bash infrastructure/scripts/verify-deployment.sh ${ENVIRONMENT} ${SERVICE}"
