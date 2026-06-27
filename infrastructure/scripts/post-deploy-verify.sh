#!/usr/bin/env bash
# BidRide — Post-Deploy Verification Script
# Runs functional checks after a production deployment:
#   1. All 12 health checks
#   2. Auth OTP request (non-destructive — just verifies the endpoint responds)
#   3. Trip create (requires a valid JWT — uses BIDRIDE_TEST_TOKEN if set)
#   4. Admin login
#   5. AI health
#   6. Fare estimate
#
# Usage:
#   Local:
#     bash infrastructure/scripts/post-deploy-verify.sh
#
#   Production (full auth flow):
#     BIDRIDE_API_URL=https://api.bidride.com \
#     BIDRIDE_ADMIN_EMAIL=marq@bidride.com \
#     BIDRIDE_ADMIN_PASS=your-password \
#     bash infrastructure/scripts/post-deploy-verify.sh
#
# Exit code: 0 = all checks passed, 1 = one or more failed.

set -uo pipefail

BASE_URL="${BIDRIDE_API_URL:-http://localhost}"
ADMIN_EMAIL="${BIDRIDE_ADMIN_EMAIL:-marq@bidride.com}"
ADMIN_PASS="${BIDRIDE_ADMIN_PASS:-CHANGE_ME_IMMEDIATELY}"
LOCAL_MODE="true"
[[ "${BASE_URL}" == "https://"* ]] && LOCAL_MODE="false"

TIMEOUT=10
PASS=0
FAIL=0

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $*"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC} $*"; FAIL=$((FAIL+1)); }
info() { echo -e "  ${BLUE}→${NC} $*"; }
section() { echo ""; echo -e "${BLUE}[$*]${NC}"; }

svc_url() {
  local port=$1 path=$2
  [[ "${LOCAL_MODE}" == "true" ]] && echo "${BASE_URL}:${port}${path}" || echo "${BASE_URL}${path}"
}

http_get() {
  local url=$1; shift
  curl -sf --max-time "${TIMEOUT}" "$@" "${url}" 2>/dev/null
}

http_post() {
  local url=$1 data=$2; shift 2
  curl -sf --max-time "${TIMEOUT}" -X POST \
    -H "Content-Type: application/json" \
    -d "${data}" "$@" "${url}" 2>/dev/null
}

http_code() {
  local url=$1; shift
  curl -s -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT}" "$@" "${url}" 2>/dev/null || echo "000"
}

# ── Header ───────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════"
echo "  BidRide Post-Deploy Verification"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Target: ${BASE_URL}"
echo "════════════════════════════════════════════════════"

# ── 1. Health Checks ─────────────────────────────────────────────────────────

section "1. Service Health Checks"

check_health() {
  local name=$1 port=$2 path=$3
  local url; url=$(svc_url "${port}" "${path}")
  if [[ "${LOCAL_MODE}" == "false" && "${name}" == "ai-service" ]]; then
    echo -e "  ${YELLOW}⚠${NC} ${name} — SKIPPED (VPC-internal)"; return
  fi
  code=$(http_code "${url}")
  [[ "${code}" == "200" ]] && ok "${name} — HTTP 200" || fail "${name} — HTTP ${code} (${url})"
}

check_health auth-service        3001 /health/live
check_health trip-service        3002 /health
check_health driver-service      3003 /health
check_health rider-service       3004 /health
check_health pricing-service     3005 /health
check_health safety-service      3006 /health
check_health payment-service     3007 /health
check_health notification-service 3008 /health
check_health trust-service       3009 /health
check_health airport-service     3010 /health
check_health admin-service       3011 /health
check_health ai-service          3012 /ai/health

# ── 2. Auth — OTP Request ────────────────────────────────────────────────────

section "2. Auth — OTP Request (canary phone)"

AUTH_URL=$(svc_url 3001 "")
OTP_RESP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT}" \
  -X POST "${AUTH_URL}/v1/auth/send-otp" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+15550000001","role":"rider"}' 2>/dev/null || echo "000")

# 204 = OTP sent, 429 = rate limited (also acceptable — means auth is working)
if [[ "${OTP_RESP_CODE}" == "204" || "${OTP_RESP_CODE}" == "429" || "${OTP_RESP_CODE}" == "400" ]]; then
  ok "Auth OTP endpoint responds — HTTP ${OTP_RESP_CODE}"
else
  fail "Auth OTP endpoint — HTTP ${OTP_RESP_CODE} (expected 204/429/400)"
fi

# ── 3. Auth — Full OTP Flow (local dev only, uses demo rider) ────────────────

RIDER_JWT=""
if [[ "${LOCAL_MODE}" == "true" ]]; then
  section "3. Auth — Full OTP Flow (local demo rider)"

  # Request OTP for demo rider
  REQ_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT}" \
    -X POST "${AUTH_URL}/v1/auth/send-otp" \
    -H "Content-Type: application/json" \
    -d '{"phone":"+15551234567","role":"rider"}' 2>/dev/null || echo "000")
  info "OTP request → HTTP ${REQ_CODE}"

  # Extract OTP from service log (local dev only)
  LOG_FILE="/private/tmp/claude-501/-Users-kaylee/5eb94e0d-308d-415f-8dec-39768bd65f34/scratchpad/auth-service.log"
  if [[ -f "${LOG_FILE}" ]]; then
    OTP=$(grep -oE '\b[0-9]{6}\b' "${LOG_FILE}" | tail -1)
    info "OTP from log: ${OTP}"

    if [[ -n "${OTP}" ]]; then
      VERIFY_RESP=$(curl -sf --max-time "${TIMEOUT}" \
        -X POST "${AUTH_URL}/v1/auth/verify-otp" \
        -H "Content-Type: application/json" \
        -d "{\"phone\":\"+15551234567\",\"code\":\"${OTP}\",\"role\":\"rider\"}" 2>/dev/null || echo "{}")
      RIDER_JWT=$(echo "${VERIFY_RESP}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || echo "")
      [[ -n "${RIDER_JWT}" ]] && ok "Rider JWT obtained" || fail "Rider JWT not returned — resp: ${VERIFY_RESP:0:100}"
    else
      fail "Could not extract OTP from log"
    fi
  else
    info "Auth service log not found — skipping full OTP flow"
  fi
else
  section "3. Auth — OTP Flow (production — manual token required)"
  info "Set BIDRIDE_TEST_TOKEN env var to run trip/fare checks with a real JWT"
  RIDER_JWT="${BIDRIDE_TEST_TOKEN:-}"
fi

# ── 4. Fare Estimate ─────────────────────────────────────────────────────────

section "4. Fare Estimate"

FARE_URL=$(svc_url 3005 "/pricing/estimate")
FARE_BODY='{"pickupLat":40.7357,"pickupLng":-74.1724,"dropoffLat":40.6895,"dropoffLng":-74.1745,"distanceMiles":4.2,"durationMin":18,"vehicleClass":"standard"}'

if [[ -n "${RIDER_JWT}" ]]; then
  FARE_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT}" \
    -X POST "${FARE_URL}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${RIDER_JWT}" \
    -d "${FARE_BODY}" 2>/dev/null || echo "000")
  [[ "${FARE_CODE}" == "200" || "${FARE_CODE}" == "201" ]] \
    && ok "Fare estimate — HTTP ${FARE_CODE}" \
    || fail "Fare estimate — HTTP ${FARE_CODE}"
else
  echo -e "  ${YELLOW}⚠${NC} Fare estimate — SKIPPED (no JWT available)"
fi

# ── 5. Trip Create ───────────────────────────────────────────────────────────

section "5. Trip Create"

TRIP_URL=$(svc_url 3002 "/trips")
TRIP_BODY='{"pickupLat":40.7357,"pickupLng":-74.1724,"pickupAddress":"Newark Penn Station","dropoffLat":40.6895,"dropoffLng":-74.1745,"dropoffAddress":"Newark Liberty Airport","vehicleClass":"standard","requestedFare":18.50}'

if [[ -n "${RIDER_JWT}" ]]; then
  TRIP_RESP=$(curl -sf --max-time "${TIMEOUT}" \
    -X POST "${TRIP_URL}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${RIDER_JWT}" \
    -d "${TRIP_BODY}" 2>/dev/null || echo "{}")
  TRIP_ID=$(echo "${TRIP_RESP}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
  [[ -n "${TRIP_ID}" ]] \
    && ok "Trip created — id=${TRIP_ID:0:8}" \
    || fail "Trip create failed — ${TRIP_RESP:0:120}"
else
  echo -e "  ${YELLOW}⚠${NC} Trip create — SKIPPED (no JWT available)"
fi

# ── 6. Admin Login ───────────────────────────────────────────────────────────

section "6. Admin Login"

ADMIN_URL=$(svc_url 3011 "/admin/auth/login")
ADMIN_RESP_CODE=$(curl -s -o /tmp/bidride_admin_resp.json -w "%{http_code}" \
  --max-time "${TIMEOUT}" \
  -X POST "${ADMIN_URL}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASS}\"}" \
  -c /tmp/bidride_admin_cookies.txt 2>/dev/null || echo "000")

if [[ "${ADMIN_RESP_CODE}" == "200" || "${ADMIN_RESP_CODE}" == "201" ]]; then
  ADMIN_ROLE=$(python3 -c "import json; d=json.load(open('/tmp/bidride_admin_resp.json')); print(d.get('admin',{}).get('role','?'))" 2>/dev/null || echo "?")
  ok "Admin login — role=${ADMIN_ROLE}"

  # Admin analytics check
  ANALYTICS_URL=$(svc_url 3011 "/admin/analytics/dashboard")
  ANA_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT}" \
    -b /tmp/bidride_admin_cookies.txt "${ANALYTICS_URL}" 2>/dev/null || echo "000")
  [[ "${ANA_CODE}" == "200" ]] \
    && ok "Admin analytics dashboard — HTTP ${ANA_CODE}" \
    || fail "Admin analytics — HTTP ${ANA_CODE}"
else
  fail "Admin login — HTTP ${ADMIN_RESP_CODE}"
fi

# Cleanup temp files
rm -f /tmp/bidride_admin_resp.json /tmp/bidride_admin_cookies.txt

# ── 7. AI Health ─────────────────────────────────────────────────────────────

section "7. AI Service Health"

if [[ "${LOCAL_MODE}" == "true" ]]; then
  AI_URL=$(svc_url 3012 "/ai/health")
  AI_RESP=$(http_get "${AI_URL}" 2>/dev/null || echo "{}")
  [[ "${AI_RESP}" == *"service"* ]] \
    && ok "AI service health — uptime=$(echo "${AI_RESP}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(round(d.get('service',{}).get('uptime',0),1))" 2>/dev/null)s" \
    || fail "AI service health returned unexpected response: ${AI_RESP:0:80}"
else
  echo -e "  ${YELLOW}⚠${NC} AI health — SKIPPED (VPC-internal in production)"
fi

# ── 8. JWT Security Check ────────────────────────────────────────────────────

section "8. Security — JWT Enforcement"

TRIPS_NO_AUTH_CODE=$(http_code "$(svc_url 3002 "/trips")")
[[ "${TRIPS_NO_AUTH_CODE}" == "401" ]] \
  && ok "Trip list rejects unauthenticated request — HTTP 401" \
  || fail "Trip list without auth returned HTTP ${TRIPS_NO_AUTH_CODE} (expected 401)"

FAKE_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJoYWNrZXIiLCJyb2xlIjoiYWRtaW4ifQ.FAKE"
FORGED_CODE=$(http_code "$(svc_url 3002 "/trips")" -H "Authorization: Bearer ${FAKE_JWT}")
[[ "${FORGED_CODE}" == "401" ]] \
  && ok "Forged JWT rejected — HTTP 401" \
  || fail "Forged JWT not rejected — HTTP ${FORGED_CODE}"

# ── Summary ──────────────────────────────────────────────────────────────────

TOTAL=$((PASS + FAIL))
echo ""
echo "════════════════════════════════════════════════════"
if [[ $FAIL -eq 0 ]]; then
  echo -e "  ${GREEN}ALL CHECKS PASSED${NC} — ${PASS}/${TOTAL}"
else
  echo -e "  ${RED}${FAIL} CHECK(S) FAILED${NC} — ${PASS}/${TOTAL} passed"
fi
echo "════════════════════════════════════════════════════"
echo ""
exit ${FAIL}
