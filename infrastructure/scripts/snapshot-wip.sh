#!/usr/bin/env bash
#
# snapshot-wip.sh [branch-name] [--push]
#
# Back up uncommitted work to a branch WITHOUT touching the working tree.
#
# Long-lived in-progress work — a redesign, a migration, anything spanning days —
# exists in exactly one place: one machine's working tree. No stash, no branch, no
# remote. A disk failure or a stray `git checkout` destroys it, and the usual
# advice ("just commit it") is wrong when the work belongs to a different
# milestone and must not land on the current branch.
#
# This takes a point-in-time copy using a TEMPORARY index, so:
#
#   - the working tree is not modified — files stay exactly as they are
#   - the real index is not modified — nothing becomes staged
#   - HEAD and the current branch do not move
#   - no stash is created or popped
#
# It is therefore safe to run at any time, including mid-edit, and safe to run
# repeatedly: each run updates the branch to the current state.
#
# .gitignore is honoured, so ignored files — .env, tfvars, tfstate, keys — are
# never captured. The script verifies that and refuses if anything sensitive
# somehow appears.
#
# The result is a BACKUP, not reviewed work. Nothing in it has been built or
# tested. Rebase, squash or delete it when the real work lands.

set -uo pipefail

RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YEL=$'\033[0;33m'; NC=$'\033[0m'
ok()   { echo "${GRN}✓${NC} $*"; }
warn() { echo "${YEL}!${NC} $*"; }
die()  { echo "${RED}✗ ERROR:${NC} $*" >&2; exit 1; }

BRANCH="${1:-}"
PUSH=""
for arg in "$@"; do [[ "${arg}" == "--push" ]] && PUSH="yes"; done
[[ "${BRANCH}" == "--push" ]] && BRANCH=""
BRANCH="${BRANCH:-wip-snapshot/$(git branch --show-current 2>/dev/null || echo detached)}"

command -v git >/dev/null || die "git is required"
git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

# Record the state we must not disturb, so we can prove we did not.
BEFORE_HEAD=$(git rev-parse HEAD)
BEFORE_BRANCH=$(git branch --show-current)
BEFORE_INDEX=$(git diff --cached --name-only | wc -l | tr -d ' ')
BEFORE_DIRTY=$(git status --porcelain | wc -l | tr -d ' ')

if [[ "${BEFORE_DIRTY}" == "0" ]]; then
  ok "working tree is clean — nothing to snapshot"
  exit 0
fi

echo "── snapshotting ${BEFORE_DIRTY} uncommitted path(s) → ${BRANCH} ──"

IDX="$(mktemp "${TMPDIR:-/tmp}/bidride-snap.XXXXXX")"
trap 'rm -f "${IDX}"' EXIT

# Build the tree in a temporary index. read-tree seeds it from HEAD so tracked
# files are present; add -A then layers modifications and untracked files on top.
GIT_INDEX_FILE="${IDX}" git read-tree HEAD    || die "read-tree failed"
GIT_INDEX_FILE="${IDX}" git add -A            || die "add failed"

# Refuse to capture anything that should never leave the machine. `git add -A`
# honours .gitignore, so this should be impossible — which is exactly why it is
# worth asserting rather than assuming.
SENSITIVE=$(GIT_INDEX_FILE="${IDX}" git diff --cached --name-only HEAD \
  | grep -iE '(^|/)\.env($|\.)|\.tfvars$|\.tfstate|\.pem$|\.p12$|\.key$|(^|/)credentials$' || true)
[[ -z "${SENSITIVE}" ]] || die "refusing to snapshot — sensitive files matched:
${SENSITIVE}
     Check .gitignore before retrying."

COUNT=$(GIT_INDEX_FILE="${IDX}" git diff --cached --name-only HEAD | wc -l | tr -d ' ')
TREE=$(GIT_INDEX_FILE="${IDX}" git write-tree) || die "write-tree failed"

# Nothing to do if the tree already matches the branch tip.
if EXISTING=$(git rev-parse --verify --quiet "${BRANCH}^{tree}"); then
  if [[ "${EXISTING}" == "${TREE}" ]]; then
    ok "${BRANCH} already matches the working tree — no new snapshot needed"
    exit 0
  fi
fi

PARENT=$(git rev-parse --verify --quiet "${BRANCH}" || echo "${BEFORE_HEAD}")
COMMIT=$(git commit-tree "${TREE}" -p "${PARENT}" -m "wip(snapshot): ${COUNT} uncommitted path(s) from ${BEFORE_BRANCH} @ ${BEFORE_HEAD:0:12}

UNREVIEWED BACKUP — not built, not tested, not reviewed. Taken by
infrastructure/scripts/snapshot-wip.sh against a temporary index, so the working
tree, the real index and HEAD were never touched: these files remain uncommitted
on ${BEFORE_BRANCH} exactly as they were.

Point-in-time, not a live mirror. Re-run the script as the work continues.
Recover a file with: git checkout ${BRANCH} -- <path>") || die "commit-tree failed"

git branch -f "${BRANCH}" "${COMMIT}" || die "could not update branch ${BRANCH}"
ok "snapshot ${COMMIT:0:12} → ${BRANCH} (${COUNT} paths)"

if [[ -n "${PUSH}" ]]; then
  git push -q --force-with-lease origin "${BRANCH}" \
    && ok "pushed to origin/${BRANCH}" \
    || die "push failed — the snapshot exists locally as ${BRANCH}"
else
  warn "not pushed (pass --push). It exists only on this machine until you do."
fi

# Prove we disturbed nothing. If any of these changed, say so loudly: the whole
# value of this script is that it is safe to run at any moment.
AFTER_HEAD=$(git rev-parse HEAD)
AFTER_BRANCH=$(git branch --show-current)
AFTER_INDEX=$(git diff --cached --name-only | wc -l | tr -d ' ')
AFTER_DIRTY=$(git status --porcelain | wc -l | tr -d ' ')

FAIL=0
[[ "${AFTER_HEAD}"   == "${BEFORE_HEAD}"   ]] || { echo "${RED}HEAD MOVED${NC}"; FAIL=1; }
[[ "${AFTER_BRANCH}" == "${BEFORE_BRANCH}" ]] || { echo "${RED}BRANCH CHANGED${NC}"; FAIL=1; }
[[ "${AFTER_INDEX}"  == "${BEFORE_INDEX}"  ]] || { echo "${RED}INDEX CHANGED${NC}"; FAIL=1; }
[[ "${AFTER_DIRTY}"  == "${BEFORE_DIRTY}"  ]] || { echo "${RED}WORKING TREE CHANGED${NC}"; FAIL=1; }
(( FAIL == 0 )) || die "the snapshot disturbed local state — investigate before trusting it"

ok "unchanged: branch ${AFTER_BRANCH}, HEAD ${AFTER_HEAD:0:12}, staged ${AFTER_INDEX}, dirty ${AFTER_DIRTY}"
