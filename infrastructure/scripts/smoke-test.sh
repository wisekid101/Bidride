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

    # In production mode: /health paths go directly to containers (not ALB-routed).
    # We accept 200 (direct/local) or 401 (ALB-routed auth-protected endpoint).
    # 401 proves the service is running and responding; auth just isn't satisfied.
    if [[ "${http_code}" == "200" || ( "${LOCAL_MODE}" == "false" && "${http_code}" == "401" ) ]]; then
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

# Service table: name | port | path
# Port is used in local mode (direct per-service) only.
# In production (ALB) mode the path must be ALB-routable; /health is not routed.
# We use auth-protected endpoints — a 401 response proves the service is alive.
declare -a SERVICES=(
  "auth-service:3001:/health/live"        # local: /health/live; prod: /auth/session (401)
  "trip-service:3002:/health"             # local: /health;      prod: /trips (401)
  "driver-service:3003:/health"           # local: /health;      prod: /drivers (401)
  "rider-service:3004:/health"            # local: /health;      prod: /riders/me (401)
  "pricing-service:3005:/health"          # local: /health;      prod: /pricing/estimate (400/401)
  "safety-service:3006:/health"           # local: /health;      prod: /safety/sos (401)
  "payment-service:3007:/health"          # local: /health;      prod: /payments (401)
  "notification-service:3008:/health"     # local: /health;      prod: /internal/notifications/push (401)
  "trust-service:3009:/health"            # local: /health;      prod: /internal/trust/recalculate (401)
  "airport-service:3010:/health"          # local: /health;      prod: /airport/queue (401)
  "admin-service:3011:/health"            # local: /health;      prod: /admin/analytics (401)
  "ai-service:3012:/ai/health"            # local: /ai/health;   prod: SKIPPED (VPC-internal)
)

# Production-mode paths (ALB-routable, returns 401 = service is alive)
declare -A PROD_PATHS=(
  ["auth-service"]="/auth/session"
  ["trip-service"]="/trips"
  ["driver-service"]="/drivers"
  ["rider-service"]="/riders/me"
  ["pricing-service"]="/pricing/surge/default"
  ["safety-service"]="/safety/sos"
  ["payment-service"]="/payments"
  ["notification-service"]="/internal/notifications/push"
  ["trust-service"]="/internal/trust/recalculate"
  ["airport-service"]="/airport/queue"
  ["admin-service"]="/admin/analytics"
)

for entry in "${SERVICES[@]}"; do
  name="${entry%%:*}"
  rest="${entry#*:}"
  port="${rest%%:*}"
  path="${rest#*:}"

  # In production mode, ai-service is VPC-internal and not ALB-accessible.
  if [[ "${LOCAL_MODE}" == "false" && "${name}" == "ai-service" ]]; then
    warn "ai-service — SKIPPED (VPC-internal, not ALB-routed)"
    continue
  fi

  # In production mode, use ALB-routable paths (health endpoints are not ALB-routed).
  if [[ "${LOCAL_MODE}" == "false" && -n "${PROD_PATHS[$name]:-}" ]]; then
    path="${PROD_PATHS[$name]}"
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
