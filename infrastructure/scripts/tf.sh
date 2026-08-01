#!/usr/bin/env bash
# BidRide — environment-scoped Terraform wrapper.
#
# The backend `key` and the variable file are the two things that decide whether
# you are touching staging or production. Selecting them by hand is how a
# staging apply becomes a production incident, so this wrapper makes the
# environment the first positional argument and refuses to run without it.
#
# Usage:
#   infrastructure/scripts/tf.sh <staging|production> init
#   infrastructure/scripts/tf.sh <staging|production> plan
#   infrastructure/scripts/tf.sh <staging|production> apply
#   infrastructure/scripts/tf.sh <staging|production> output -json
#
# `plan` writes <env>.tfplan and `apply` with no further arguments consumes it,
# so what you reviewed is what you apply.

set -euo pipefail

TF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../terraform" && pwd)"

die() { echo "ERROR: $*" >&2; exit 1; }

ENVIRONMENT="${1:-}"
shift || true

case "${ENVIRONMENT}" in
  staging|production) ;;
  *) die "first argument must be 'staging' or 'production' (got '${ENVIRONMENT:-<none>}')" ;;
esac

[[ $# -gt 0 ]] || die "no terraform command given (init | plan | apply | output | validate | fmt ...)"

COMMAND="$1"; shift

BACKEND_CONFIG="${TF_DIR}/env/${ENVIRONMENT}.backend.hcl"
VAR_FILE="${TF_DIR}/env/${ENVIRONMENT}.tfvars"
PLAN_FILE="${TF_DIR}/${ENVIRONMENT}.tfplan"

[[ -f "${BACKEND_CONFIG}" ]] || die "missing backend config: ${BACKEND_CONFIG}"

# A stale .terraform pointing at the other environment's state is the one
# failure mode this wrapper exists to prevent. Record which environment the
# working directory was last initialised for and force a re-init on change.
STAMP="${TF_DIR}/.terraform/bidride-environment"

needs_init() {
  [[ ! -d "${TF_DIR}/.terraform" ]] && return 0
  [[ ! -f "${STAMP}" ]] && return 0
  [[ "$(cat "${STAMP}")" != "${ENVIRONMENT}" ]] && return 0
  return 1
}

do_init() {
  echo "→ terraform init (${ENVIRONMENT})"
  ( cd "${TF_DIR}" && terraform init -reconfigure -backend-config="${BACKEND_CONFIG}" "$@" )
  mkdir -p "${TF_DIR}/.terraform"
  printf '%s' "${ENVIRONMENT}" > "${STAMP}"
}

require_vars() {
  [[ -f "${VAR_FILE}" ]] || die \
"missing ${VAR_FILE}
  cp ${TF_DIR}/env/${ENVIRONMENT}.tfvars.example ${VAR_FILE}
then fill in db_password and founder_email. The file is gitignored."
}

case "${COMMAND}" in
  init)
    do_init "$@"
    ;;

  fmt|validate)
    needs_init && do_init
    ( cd "${TF_DIR}" && terraform "${COMMAND}" "$@" )
    ;;

  plan)
    require_vars
    needs_init && do_init
    echo "→ terraform plan (${ENVIRONMENT}) → ${PLAN_FILE##*/}"
    ( cd "${TF_DIR}" && terraform plan -var-file="${VAR_FILE}" -out="${PLAN_FILE}" "$@" )
    echo
    echo "Review the plan above, then:"
    echo "  infrastructure/scripts/tf.sh ${ENVIRONMENT} apply"
    echo
    echo "REMINDER: terraform apply is NOT a deployment. It registers task"
    echo "definition revisions; nothing runs them until deploy-service.sh does."
    ;;

  apply)
    needs_init && do_init
    if [[ $# -eq 0 ]]; then
      [[ -f "${PLAN_FILE}" ]] || die "no saved plan at ${PLAN_FILE} — run 'plan' first"
      ( cd "${TF_DIR}" && terraform apply "${PLAN_FILE}" )
      rm -f "${PLAN_FILE}"
    else
      require_vars
      ( cd "${TF_DIR}" && terraform apply -var-file="${VAR_FILE}" "$@" )
    fi
    echo
    echo "Task definition revisions registered. To make them LIVE:"
    echo "  infrastructure/scripts/deploy-fleet.sh ${ENVIRONMENT} <image-tag>"
    ;;

  output)
    needs_init && do_init
    ( cd "${TF_DIR}" && terraform output "$@" )
    ;;

  *)
    needs_init && do_init
    ( cd "${TF_DIR}" && terraform "${COMMAND}" "$@" )
    ;;
esac
