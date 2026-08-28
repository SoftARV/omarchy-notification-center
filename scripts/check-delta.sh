#!/bin/bash
#
# Fails when the fork has drifted outside the seam it is allowed to occupy.
#
# The whole strategy of this fork is that upstream's files stay upstream's, so
# taking an omarchy release is `git merge upstream` rather than a re-application
# by hand. That only holds if drift is caught the day it happens: a stray edit
# to an upstream file is invisible until the merge conflict it causes months
# later, by which point nobody remembers what the edit was for.
#
# Run it before every commit. See docs/spec/SPEC-fork-seam.md for the hook
# inventory and the reasoning.
#
# Exit status:
#   0  the fork is inside its seam (or there is no upstream branch to compare
#      against, which is a missing comparison rather than a broken fork)
#   1  drift, or the script could not do its job

# No `set -e`: every check runs and every problem is reported. Finding out
# about one violation per run, discovering the next only after fixing the
# first, is how a pre-commit check becomes something people stop running.
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  printf 'check-delta: not inside a git repository, so there is nothing to check\n' >&2
  exit 1
}
cd "$ROOT" || exit 1

# Overridable so the tests can point at a fixture branch, and so a checkout
# that tracks upstream under another name still works.
UPSTREAM=${UPSTREAM_REF:-upstream}

status=0
fail() {
  printf 'check-delta: %s\n' "$1" >&2
  shift
  for line in "$@"; do printf '             %s\n' "$line" >&2; done
  status=1
}

if ! git rev-parse --verify --quiet "$UPSTREAM" >/dev/null 2>&1; then
  # A fresh clone need not have the branch. Reporting that as a failure would
  # teach people that a red run is normal, which is how a guard stops guarding.
  printf 'check-delta: no "%s" branch here, so there is nothing to compare against.\n' "$UPSTREAM"
  printf '             Fetch it with: git fetch origin %s:%s\n' "$UPSTREAM" "$UPSTREAM"
  exit 0
fi

# ---------------------------------------------------------------- check 1
#
# These two files carry no fork changes at all, ever. Every line of them is
# upstream's, which is why an upstream release can rewrite them freely without
# ever conflicting. New logic goes in a sidecar file upstream has never had.
VERBATIM=(
  "NotificationLogic.js"
  "components/NotificationCard.qml"
)

for file in "${VERBATIM[@]}"; do
  if [[ ! -f $file ]]; then
    fail "$file is missing, and upstream ships it." \
      "A file the fork deletes is a file the next merge will fight over."
    continue
  fi
  # Comparing a ref against the working tree, not against HEAD: this runs
  # pre-commit, when the change being checked is usually still unstaged.
  if ! git diff --quiet "$UPSTREAM" -- "$file" 2>/dev/null; then
    fail "$file differs from $UPSTREAM, and it must stay byte-identical." \
      "Fork logic belongs in a sidecar file -- see docs/spec/SPEC-fork-seam.md" \
      "Look:  git diff $UPSTREAM -- $file"
  fi
done

if (( status == 0 )); then
  printf 'check-delta: ok -- %d upstream files verbatim\n' "${#VERBATIM[@]}"
fi

exit "$status"
