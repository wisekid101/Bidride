#!/usr/bin/env bash
# BidRide — ordered, one-service-at-a-time fleet deployment.
#
# Ordering is not cosmetic:
#
#   safety-service first, always. It is the service whose failure is a safety
#   incident rather than an outage, so it gets a clean fleet and a full gate
#   before anything else moves.
#
#   trip-service before payment-service. F4 introduced a cross-service contract
#   and payment-service must not roll while a mixed trip-service fleet serves
#   (docs/payment-integrity-deployment-runbook.md).
#
#   auth-service and admin-service last. They are the token ISSUERS. Every
#   verifier must already be running a task definition that carries the public
#   keyset before the issuer is touched, so that at no point does a token exist
#   that some verifier cannot check.
#
# Each service is fully deployed AND verified before the next starts. Any
# failure stops the run immediately, leaving the remaining services untouched.
#
# Usage:
#   deploy-fleet.sh <staging|production> <image-tag> [--only svc1,svc2]
#
# Requires: aws CLI v2, jq.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN='\033[0;32m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
die() { echo -e "${RED}✗ ERROR:${NC} $*" >&2; exit 1; }

ENVIRONMENT="${1:-}"
IMAGE_TAG="${2:-}"
ONLY_FLAG="${3:-}"
ONLY_LIST="${4:-}"

case "${ENVIRONMENT}" in
  staging|production) ;;
  *) die "usage: $0 <staging|production> <image-tag> [--only svc1,svc2]" ;;
esac
[[ -n "${IMAGE_TAG}" ]] || die "image tag required"

# Deployment order. Verifiers before issuers — see the header.
ORDER=(
  safety-service
  trip-service
  payment-service
  driver-service
  rider-service
  pricing-service
  notification-service
  trust-service
  airport-service
  ai-service
  auth-service
  admin-service
)

if [[ "${ONLY_FLAG}" == "--only" && -n "${ONLY_LIST}" ]]; then
  FILTERED=()
  for svc in "${ORDER[@]}"; do
    case ",${ONLY_LIST}," in *",${svc},"*) FILTERED+=("${svc}") ;; esac
  done
  [[ ${#FILTERED[@]} -gt 0 ]] || die "--only matched no known service: ${ONLY_LIST}"
  ORDER=("${FILTERED[@]}")
fi

echo
echo "════════════════════════════════════════════════════"
echo "  FLEET DEPLOY → ${ENVIRONMENT}"
echo "  tag   : ${IMAGE_TAG}"
echo "  order : ${ORDER[*]}"
echo "════════════════════════════════════════════════════"

DEPLOYED=()
for svc in "${ORDER[@]}"; do
  echo
  echo -e "${BLUE}━━━ ${svc} (${#DEPLOYED[@]}/${#ORDER[@]} done) ━━━${NC}"

  if ! bash "${SCRIPT_DIR}/deploy-service.sh" "${ENVIRONMENT}" "${svc}" "${IMAGE_TAG}"; then
    echo
    echo -e "${RED}FLEET DEPLOY HALTED at ${svc}.${NC}"
    echo "Services already deployed: ${DEPLOYED[*]:-none}"
    echo "Services NOT touched     : remaining entries after ${svc}"
    echo
    echo "Roll back what landed, newest first:"
    for (( i=${#DEPLOYED[@]}-1; i>=0; i-- )); do
      echo "  bash infrastructure/scripts/rollback-service.sh ${ENVIRONMENT} ${DEPLOYED[$i]}"
    done
    exit 1
  fi

  # Gate: a service is not "done" until verification proves what it is running.
  if ! bash "${SCRIPT_DIR}/verify-deployment.sh" "${ENVIRONMENT}" "${svc}"; then
    echo
    echo -e "${RED}VERIFICATION FAILED for ${svc} — halting before the next service.${NC}"
    echo "  bash infrastructure/scripts/rollback-service.sh ${ENVIRONMENT} ${svc}"
    exit 1
  fi

  DEPLOYED+=("${svc}")
done

echo
echo "════════════════════════════════════════════════════"
echo -e "  ${GREEN}FLEET DEPLOY COMPLETE${NC} — ${#DEPLOYED[@]} services on ${IMAGE_TAG}"
echo "════════════════════════════════════════════════════"
echo
echo "Run the cross-cutting checks now:"
echo "  bash infrastructure/scripts/verify-deployment.sh ${ENVIRONMENT} all"
