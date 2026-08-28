# Spec: fork-seam

Module id `fork-seam` from `CAPABILITY-MAP.md`. Depends on nothing. Built first.
Project-wide conventions, commands and boundaries live in `SPEC.md`.

## Objective

Make the other six modules possible without giving up cheap upstream merges.

The fork's current delta is seven lines and the README says so proudly, because
that is what makes `git merge upstream` a merge rather than a re-application by
hand. The requested features are hundreds of lines. This module decides *where
those lines go* so that the answer stays "not in upstream's files".

Deliverables: the sidecar convention, the inventory of permitted hook points in
`Service.qml`, a script that fails when the delta drifts outside them, and the
README changes that tell a future reader the rule.

## Design

### The seam

Three files stay byte-identical to upstream forever: `NotificationLogic.js`,
`components/NotificationCard.qml`, and — as far as *logic* is concerned —
`Service.qml`. Everything the fork adds lives in files upstream has never had
and never will, so a vendor drop cannot touch them.

`Service.qml` receives two categories of change and nothing else:

1. **Delegation** — an upstream function body replaced by a call into
   `NotificationPolicy.js` or `NotificationState.qml`.
2. **Mounting** — a one-line instantiation of a sidecar component, or a
   delegate swapped for a sidecar component.

A hook that needs more than about three lines is a sign the logic belongs in a
sidecar. That is the test to apply when in doubt.

### Hook point inventory

Every permitted hook, its module, and its budget. `check-delta.sh` reads this
table's marker strings out of `Service.qml`.

| # | Location in `Service.qml` | Kind | Module | Budget |
|---|---|---|---|---|
| 1 | Import block: `import "NotificationPolicy.js" as Policy` | Mount | `fork-seam` | 1 |
| 2 | Body: `NotificationState { id: state; service: service }` | Mount | `settings` | 3 |
| 3 | `durationFor()` body | Delegation | `timing` | 3 |
| 4 | `historyLimit` property binding | Delegation | `history-store` | 1 |
| 5 | `loadSettings()` / `flushSettings()` bodies | Delegation | `settings` | 6 |
| 6 | `handleNotification()` — one call before the model insert | Delegation | `popup-cap` | 2 |
| 7 | Popup `Repeater` `model` and `delegate` | Mount | `stacking` | 6 |
| 8 | `archivePopupFileFor()` — one revision-bump call | Delegation | `history-store` | 2 |
| 9 | `clearHistory()` — one revision-bump call | Delegation | `history-store` | 1 |

Existing fork lines (popup column centering) are unchanged and counted
separately. Hook 7 also *deletes* roughly sixty upstream lines — the Repeater
delegate body moves wholesale into `components/PopupSlot.qml`. Deleting a
contiguous block is the cheapest possible conflict: git reports it once, and
the resolution is always "take our version of the block, then port any upstream
change into `PopupSlot.qml`".

**Budget: 60 added lines in `Service.qml`** (the seven existing plus the 25
above, doubled for headroom), and **zero** changed lines in `NotificationLogic.js`
and `components/NotificationCard.qml`.

Added lines, not added-plus-deleted. Hook 7 deliberately *deletes* about sixty
upstream lines when the Repeater delegate body moves into `PopupSlot.qml`, so a
combined count would fail the check on the one hook designed to shrink the
conflict surface. Added lines are also the truer measure of cost: a deleted
block is one conflict git reports once and resolves the same way every time,
while every added line is fork code that must be re-reconciled forever.

A pure-deletion hunk has no added line to carry a marker, so it gains a
one-line `// fork:` comment saying what was removed and why. That keeps check 3
uniform -- no unlabelled category of fork change -- and makes the deletion
self-documenting during a merge.

### `scripts/check-delta.sh`

Exits non-zero, with a readable reason, when any of these is false:

1. `git diff --numstat upstream -- NotificationLogic.js components/NotificationCard.qml` is empty.
2. **Added** lines in `Service.qml` versus `upstream` are within budget.
3. Every changed hunk in `Service.qml` contains a `// fork:` marker — i.e. no
   fork line is unlabelled, and no upstream line was edited by accident.
4. Every `// fork:` marker names a spec file that exists under `docs/spec/`.
   Markers carry a bare filename (`SPEC-timing.md`); the script resolves it.

It must work with a dirty tree and with no network. When the `upstream` branch
is missing it says so and exits 0 — a fresh clone without the branch should not
look like a failure.

### Docs

`README.md` gains a "How the fork is structured" section: the sidecar rule, the
hook inventory as the source of truth, and the merge procedure amended to run
`check-delta.sh` after the merge. The existing "the whole fork is seven lines"
sentence becomes a statement about *hooks* rather than lines, since it will no
longer be literally true.

[`docs/adr/0001-sidecar-seam.md`](../adr/0001-sidecar-seam.md) records the decision and the alternative that
was rejected (a separate companion plugin), so the next reader does not
re-litigate it. It is this module's job to create `docs/adr/`; `docs/spec/`
already exists.

This module also establishes `test/`: the harness that loads QML `.js`
resources under node, and the first suite to use it. Nothing else can meet its
Definition of Done until `node --test` runs.

`README.md` stays in the root, because GitHub and a plugin user both look for
it there. It gains a pointer to `docs/spec/CAPABILITY-MAP.md` as the index of
what is planned, so the root stays a plugin README rather than becoming a
project plan.

## Acceptance Criteria

- `scripts/check-delta.sh` exists, is executable, and passes on the current tree.
- It fails, with a message naming the file, when a line is added to
  `NotificationLogic.js`.
- It fails, with a message naming the line number, when a line is added to
  `Service.qml` without a `// fork:` marker.
- It exits 0 with an explanatory note when the `upstream` branch does not exist.
- `README.md` documents the sidecar rule and the amended merge procedure.
- `test/harness.js` loads a QML `.js` resource into a node context and returns
  its declared functions, and `node --test` runs green. Every later module's
  Definition of Done depends on this command working, so the scaffold is this
  module's to build -- putting it in `settings` would make that module carry
  test infrastructure unrelated to settings.
- [`docs/adr/0001-sidecar-seam.md`](../adr/0001-sidecar-seam.md) records the decision and the rejected
  alternative.
- Re-running `git merge upstream` against the already-merged omarchy 4.0.1 drop
  is a no-op.

## Verification

```sh
./scripts/check-delta.sh                                  # passes
echo "" >> NotificationLogic.js && ./scripts/check-delta.sh   # fails, names the file
git checkout NotificationLogic.js
git merge upstream                                        # "Already up to date."
```

## Risks

- **The budget is a guess.** Twenty-five hook lines is an estimate made before
  writing them. If a module needs a hook not in the table, that is an *ask
  first* per `SPEC.md`, and the table is amended in the same commit — not
  quietly exceeded.
- **`check-delta.sh` is only as binding as the habit of running it.** There is
  no CI. See open question 3 in `SPEC.md`.
- **Upstream may restructure the Repeater delegate.** Hook 7 is the one place a
  large upstream change would land squarely on fork code. Mitigation is that
  `PopupSlot.qml` starts as a verbatim copy of upstream's delegate body, so
  diffing upstream's new delegate against it stays meaningful.
