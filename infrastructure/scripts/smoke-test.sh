#!/usr/bin/env bash
# BidiRide — Smoke Test Script
# Tests all 12 services via health endpoints.
# Usage:
#   Local:      bash infrastructure/scripts/smoke-test.sh
#   Production: BIDRIDE_API_URL=https://api.bidiride.com bash infrastructure/scripts/smoke-test.sh
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
    body=$(curl -s --max-time "${TIMEOUT}" --connect-timeout 5 "${url}" 2>/dev/null | head -c 200)
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time "${TIMEOUT}" --connect-timeout 5 "${url}" 2>/dev/null || echo "000")

    # Local mode probes /health directly on the container: only 200 means alive.
    #
    # ALB mode probes an unmatched path under the service's prefix, so "alive"
    # means the request reached the application at all:
    #   401 — a global guard rejected it before routing
    #   404 with a statusCode field — NestJS's own not-found
    # A 404 WITHOUT statusCode is the ALB's fixed response (prefix not routed),
    # and 503 means the target group has no healthy target. Both are failures.
    alive=1
    if [[ "${http_code}" == "200" ]]; then
      alive=0
    elif [[ "${LOCAL_MODE}" == "false" ]]; then
      if [[ "${http_code}" == "401" ]]; then
        alive=0
      elif [[ "${http_code}" == "404" && "${body}" == *'"statusCode"'* ]]; then
        alive=0
      fi
    fi

    if [[ ${alive} -eq 0 ]]; then
      pass "${name} (${url}) — HTTP ${http_code} (application reached)"
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
echo "  BidiRide Smoke Test — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
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

# Production-mode probing.
#
# The previous table listed one "auth-protected endpoint" per service and expected
# 401. Most entries were wrong: /internal/trust/recalculate and
# /internal/notifications/push are @Post-only, so a GET returns 404 and a healthy
# service reported as down; /drivers, /safety/sos and /admin/analytics are not
# routes at all (the real ones are /drivers/me, /safety/sos/initiate,
# /admin/analytics/dashboard). CI runs this as an unguarded step after every
# staging and production deploy, so a perfect deploy still failed the job.
#
# "Fix the methods" is the wrong repair: POSTing those paths would initiate a real
# SOS and send real push notifications from a smoke test.
#
# Instead probe an unmatched path under each service's ALB prefix with GET. That
# needs no per-route knowledge, mutates nothing, and distinguishes cleanly —
# verified against staging:
#
#   alive, guard first   401 {"message":"Unauthorized","statusCode":401}
#   alive, no route      404 {"message":"Cannot GET /…","statusCode":404}   (NestJS)
#   no healthy target    503 + HTML                                          (ALB)
#   prefix not routed    404 {"error":"Not Found"}                           (ALB fixed response)
#
# The discriminator between a NestJS 404 and the ALB's is the statusCode field.
alb_prefix() {
  case "$1" in
    auth-service)         echo "/auth" ;;
    trip-service)         echo "/trips" ;;
    driver-service)       echo "/drivers" ;;
    rider-service)        echo "/riders" ;;
    pricing-service)      echo "/pricing" ;;
    safety-service)       echo "/safety" ;;
    payment-service)      echo "/payments" ;;
    notification-service) echo "/internal/notifications" ;;
    trust-service)        echo "/internal/trust" ;;
    airport-service)      echo "/airport" ;;
    admin-service)        echo "/admin" ;;
    *)                    echo "" ;;
  esac
}

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
  if [[ "${LOCAL_MODE}" == "false" ]]; then
    prefix=$(alb_prefix "${name}")
    [[ -n "${prefix}" ]] && path="${prefix}/__smoke"
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
