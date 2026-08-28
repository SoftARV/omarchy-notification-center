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

# ------------------------------------------------------------- checks 2-4
#
# Service.qml is upstream's file that the fork IS allowed to change -- it is
# where the hooks live. So the question here is not "did it change", it is
# "did it change more than agreed, and is every change labelled".
#
# Labelling is what makes a merge conflict readable a year from now. Landing in
# a conflict on an unmarked line means reconstructing intent from the diff;
# landing on a `// fork:` line means reading why it is there.
SEAM="Service.qml"
BUDGET=${DELTA_BUDGET:-60}
SPEC_DIR="docs/spec"
MARKER="// fork:"

if [[ ! -f $SEAM ]]; then
  fail "$SEAM is missing"
elif git rev-parse --verify --quiet "$UPSTREAM:$SEAM" >/dev/null 2>&1; then

  # Added lines only. Hook 7 deliberately deletes ~60 upstream lines when the
  # Repeater delegate body moves into a sidecar, so counting deletions would
  # fail the one change designed to make merges cheaper. Added lines are the
  # truer cost anyway: a deleted block is one conflict resolved the same way
  # every time, while every added line is fork code re-reconciled forever.
  added=$(git diff --numstat "$UPSTREAM" -- "$SEAM" 2>/dev/null | awk 'NR==1{print $1}')
  added=${added:-0}
  [[ $added == "-" ]] && added=0   # binary; cannot happen here, but do not treat as huge

  if (( added > BUDGET )); then
    fail "$SEAM adds $added lines over $UPSTREAM, past the $BUDGET-line budget." \
      "A hook needing more than a few lines is logic that belongs in a sidecar file." \
      "If the hook is genuinely necessary, amend the inventory in" \
      "$SPEC_DIR/SPEC-fork-seam.md in the same commit -- do not just raise this number."
  fi

  # The FIRST added line of every hunk must carry the marker -- not merely some
  # line in the hunk. Asking only "is there a marker in here somewhere" lets an
  # unmarked line placed directly above a marked one join its hunk and sail
  # through, which is how the first version of this check reported ok on a tree
  # with unlabelled fork code in it.
  #
  # A marker covers the contiguous added block it introduces; what stops such a
  # block growing without limit is the budget check, not this one.
  #
  # A hunk that only deletes has no added line at all, so it fails until a
  # comment explaining the deletion is put in its place. That is deliberate: an
  # exemption would create an unlabelled category of fork change, which is the
  # exact thing this check exists to prevent.
  unmarked=$(git diff -U0 "$UPSTREAM" -- "$SEAM" 2>/dev/null | awk -v marker="$MARKER" '
    function flush() { if (start != "" && !ok) print start }
    /^\+\+\+/ { next }
    /^@@/ {
      flush()
      match($0, /\+[0-9]+/)
      start = substr($0, RSTART + 1, RLENGTH - 1)
      ok = 0
      seen = 0
      next
    }
    /^\+/ {
      if (!seen) { seen = 1; ok = (index($0, marker) > 0) }
      next
    }
    END { flush() }
  ')

  if [[ -n $unmarked ]]; then
    for line in $unmarked; do
      fail "$SEAM:$line is fork code with no \"$MARKER\" marker in its hunk." \
        "Put a marker line above it saying why the fork needs it, naming its spec." \
        "A deletion counts too: replace the removed line with a marker comment."
    done
  fi
fi

# Markers point at the spec that justifies them. A marker naming a spec that no
# longer exists is worse than no marker -- it reads as an explanation and then
# leads nowhere.
if [[ -f $SEAM ]]; then
  while read -r ref; do
    [[ -n $ref ]] || continue
    [[ -f "$SPEC_DIR/$ref" ]] || fail \
      "$SEAM has a $MARKER marker naming $ref, which is not in $SPEC_DIR/" \
      "Either the spec was renamed and the marker was not, or the marker is a typo."
  done < <(grep -h -- "$MARKER" "$SEAM" 2>/dev/null |
    grep -oE 'SPEC[A-Za-z0-9._-]*\.md' | sort -u)
fi

if (( status == 0 )); then
  printf 'check-delta: ok -- %d upstream files verbatim, %s +%s/%s added lines\n' \
    "${#VERBATIM[@]}" "$SEAM" "${added:-0}" "$BUDGET"
fi

exit "$status"
