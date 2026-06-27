#!/usr/bin/env bash
# BidRide — Smoke Test Script
# Tests all 12 services via health endpoints.
# Usage:
#   Local:      bash infrastructure/scripts/smoke-test.sh
#   Production: BIDRIDE_API_URL=https://api.bidride.com bash infrastructure/scripts/smoke-test.sh
#
# Exit code: 0 if all services healthy, 1 if any down.

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────

BASE_URL="${BIDRIDE_API_URL:-http://localhost}"
TIMEOUT="${SMOKE_TIMEOUT:-10}"
RETRIES="${SMOKE_RETRIES:-3}"
RETRY_DELAY="${SMOKE_RETRY_DELAY:-5}"

# Local mode: each service has its own port.
# Production mode: all services are behind the ALB on port 443.
LOCAL_MODE="${LOCAL_MODE:-true}"
if [[ "${BASE_URL}" == https://* || "${BASE_URL}" == http://* && "${BASE_URL}" != *:30* ]]; then
  LOCAL_MODE="false"
fi

# ── Color output ──────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }

# ── Health check function ─────────────────────────────────────────────────────

check_service() {
  local name=$1
  local port=$2
  local path=$3

  if [[ "${LOCAL_MODE}" == "true" ]]; then
    local url="${BASE_URL}:${port}${path}"
  else
    local url="${BASE_URL}${path}"
  fi

  local attempt=0
  while [[ $attempt -lt $RETRIES ]]; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time "${TIMEOUT}" --connect-timeout 5 "${url}" 2>/dev/null || echo "000")

    if [[ "${http_code}" == "200" ]]; then
      pass "${name} (${url}) — HTTP ${http_code}"
      return 0
    fi

    attempt=$((attempt + 1))
    if [[ $attempt -lt $RETRIES ]]; then
      warn "${name} — HTTP ${http_code}, retrying in ${RETRY_DELAY}s (attempt ${attempt}/${RETRIES})"
      sleep "${RETRY_DELAY}"
    fi
  done

  fail "${name} (${url}) — HTTP ${http_code} after ${RETRIES} attempts"
  return 1
}

# ── Main ─────────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════"
echo "  BidRide Smoke Test — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Target: ${BASE_URL}"
echo "  Mode:   $([ "${LOCAL_MODE}" == "true" ] && echo "local (per-port)" || echo "production (ALB)")"
echo "════════════════════════════════════════════════"
echo ""

FAILURES=0

# Service table: name | port | health_path
# Port is used in local mode only; ignored in production (ALB) mode.
declare -a SERVICES=(
  "auth-service:3001:/health/live"
  "trip-service:3002:/health"
  "driver-service:3003:/health"
  "rider-service:3004:/health"
  "pricing-service:3005:/health"
  "safety-service:3006:/health"
  "payment-service:3007:/health"
  "notification-service:3008:/health"
  "trust-service:3009:/health"
  "airport-service:3010:/health"
  "admin-service:3011:/health"
  "ai-service:3012:/ai/health"
)

for entry in "${SERVICES[@]}"; do
  name="${entry%%:*}"
  rest="${entry#*:}"
  port="${rest%%:*}"
  path="${rest#*:}"

  # In production mode, ai-service is VPC-internal and not ALB-accessible.
  # Skip it in production smoke tests (or test from within the VPC).
  if [[ "${LOCAL_MODE}" == "false" && "${name}" == "ai-service" ]]; then
    warn "ai-service — SKIPPED (VPC-internal, not ALB-routed)"
    continue
  fi

  check_service "${name}" "${port}" "${path}" || FAILURES=$((FAILURES + 1))
done

echo ""
echo "════════════════════════════════════════════════"

TOTAL=${#SERVICES[@]}
PASSED=$((TOTAL - FAILURES))

if [[ "${LOCAL_MODE}" == "false" ]]; then
  # ai-service was skipped
  TOTAL=$((TOTAL - 1))
  PASSED=$((TOTAL - FAILURES))
fi

if [[ $FAILURES -eq 0 ]]; then
  echo -e "  ${GREEN}PASSED${NC}: ${PASSED}/${TOTAL} services healthy"
  echo "════════════════════════════════════════════════"
  echo ""
  exit 0
else
  echo -e "  ${RED}FAILED${NC}: ${FAILURES} service(s) down (${PASSED}/${TOTAL} healthy)"
  echo "════════════════════════════════════════════════"
  echo ""
  exit 1
fi
