# Implementation Plan: fork-seam

Module `fork-seam` from `docs/spec/CAPABILITY-MAP.md`. First module in build
order; nothing depends on anything else yet. Spec: `docs/spec/SPEC-fork-seam.md`.
Project-wide conventions: `docs/spec/SPEC.md`.

## Overview

Build the guard rails before the features that need them. `fork-seam` ships no
user-visible behavior: it produces the script that fails when the fork drifts
outside its budgeted hook points, the `// fork:` marker convention on the seven
lines that already exist, the test scaffold every later module's Definition of
Done depends on, and the docs that tell a future reader the rule.

Everything here is additive except four comment lines in `Service.qml`. No
runtime behavior changes in this module. That is deliberate — if `fork-seam`
can break a toast, its scope is wrong.

## What planning verified (so the plan doesn't rest on guesses)

- **The test harness assumption holds.** `SPEC.md`'s entire testing strategy
  rests on node being able to load a QML `.js` resource, which has no `export`.
  Confirmed with node v26.7.0: `vm.runInNewContext` over `NotificationLogic.js`
  yields all 27 declared functions, and `parseExecArgv` behaves identically to
  QML (`["-rf"]` → `null`, `["notify-send","hi"]` → passthrough). There are no
  QML-only globals (`Qt.*`, `Quickshell`, `console.*`) in that file. This was
  the highest-risk unknown in the initiative and it is now closed.
- **The current delta is 7 added / 7 deleted across 4 hunks in `Service.qml`**,
  plus `manifest.json`. `NotificationLogic.js` and `components/NotificationCard.qml`
  are byte-identical to `upstream`, as claimed.
- **Both `upstream` and `origin/upstream` exist**, so the three-way base the
  merge procedure depends on is real.
- **`qmllint` is present** at `/usr/lib/qt6/bin/qmllint` and reports 32 warnings
  on `Service.qml`, all from unresolvable `qs.*` imports — the baseline the
  README already warns about.

## Architecture Decisions

- **The budget counts ADDED lines, not changed lines.** `SPEC-fork-seam.md` says
  "60 changed lines", but hook 7 deliberately *deletes* about sixty upstream
  lines when the Repeater delegate body moves into `PopupSlot.qml`. Counting
  added + deleted would blow the budget on the one hook designed to shrink the
  conflict surface. Added lines are also the honest measure: a deleted block is
  one conflict git reports once, while every added line is fork code that must
  be re-reconciled forever. **This needs a one-word amendment to
  `SPEC-fork-seam.md` — flagged in Open Questions.**
- **Pure-deletion hunks get a marker comment.** Check 3 requires every changed
  hunk to carry a `// fork:` marker, but a hunk that only deletes upstream lines
  has no added line to put one on. Rather than exempting them — which would
  create an unlabelled category of fork change, exactly what the check exists to
  prevent — a pure-deletion hunk gains a one-line `// fork:` comment explaining
  what was removed and why. It becomes a mixed hunk, the check applies
  uniformly, and the deletion is self-documenting during a merge.
- **`check-delta.sh` is built in two slices, each leaving a passing script.**
  Slice one guards the two byte-identical files; slice two guards `Service.qml`.
  A half-built guard that fails on a clean tree is worse than no guard, because
  the habit it needs to build is "run it, expect green".
- **The test scaffold lands here, not in `settings`.** `fork-seam`'s objective
  is making the other six modules possible, and every one of them has
  `node --test test/` in its Definition of Done. Putting it in `settings` would
  make `settings` carry scaffolding unrelated to settings. **This extends
  `SPEC-fork-seam.md`'s acceptance criteria — flagged in Open Questions.**
- **No `package.json`, ever.** `node --test` and `node:assert` are built in.
  `SPEC.md` forbids adding runtime dependencies and this repo ships as a plugin
  directory, not an npm package.

## Dependency Graph

```
T1  drift guard (checks 1)          T3  test scaffold        T5  ADR
     │                                   (independent)           (independent)
     ▼
T2  markers + budget/label checks (2-4)
     │
     ▼
  Checkpoint A -- the guard is real
     │
     ▼
T4  README (documents T1-T2's final behavior)
     │
     ▼
  Checkpoint B -- module complete
```

T3 and T5 are safe to parallelize with T1-T2: they share no files. T4 must
follow T2, because it documents what the finished script actually does rather
than what it was planned to do.

## Task List

Tasks and checkpoints are recorded in `tasks/todo.md`.

### Phase 1: The guard
- [ ] Task 1: Guard the byte-identical upstream files
- [ ] Task 2: Mark the existing fork lines and guard `Service.qml`
- [ ] Checkpoint A

### Phase 2: The scaffold
- [ ] Task 3: Test harness for QML JS resources

### Phase 3: The record
- [ ] Task 4: README — how the fork is structured
- [ ] Task 5: ADR 0001 — the sidecar seam
- [ ] Checkpoint B

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Hunk-parsing in bash is fiddly and easy to get subtly wrong, passing when it should fail | High — a guard that never fails is worse than none, it manufactures false confidence | Every check gets a negative test in Task 1/2 verification: deliberately break the tree, confirm the script fails and names the file. A guard is not done until it has been seen to fail. |
| `git diff upstream` behaves differently on a dirty tree | Medium — the script is meant to run pre-commit, when the tree is always dirty | Verified during planning that `git diff upstream -- <path>` compares the branch tip to the working tree. Task 1 verification runs it against an uncommitted edit explicitly. |
| The 60-line budget is a guess made before writing any hooks | Medium — a wrong budget either blocks real work or rubber-stamps drift | The budget is advisory in effect (no CI). When a module needs a hook outside the inventory that is an *ask first* per `SPEC.md`, and the table is amended in the same commit, never quietly exceeded. |
| `// fork:` markers add lines, consuming budget to enforce the budget | Low | Four comment lines against a 60-line budget with 7 in use. Noted so the arithmetic isn't a surprise later. |
| Adding comments to `Service.qml` could break QML parsing if inserted mid-expression | Low but real — a broken `Service.qml` means no notifications at all | Markers go on their own line above the construct, never inline in a binding. Task 2 verification restarts the shell and sends a real notification. |

## Open Questions

1. **Amend the budget wording to "added lines"?** `SPEC-fork-seam.md` currently
   says "60 changed lines". As written, hook 7 fails the check it was designed
   to satisfy. I plan to implement "added lines" and amend the spec sentence to
   match. Say if you would rather keep added + deleted and raise the number.
2. **Accept the test scaffold as a `fork-seam` deliverable?** It is not in the
   module's stated acceptance criteria. The alternative is deferring it to
   `settings`. I recommend here, for the reason in Architecture Decisions, and
   will add one AC line to the spec.
3. **Is a `qmllint` comparison script wanted?** `SPEC.md` requires "qmllint
   reports nothing upstream does not also report" for every module, but nothing
   automates that comparison — today it is an eyeball against 32 warnings. A
   `scripts/check-lint.sh` diffing our warnings against upstream's would make it
   real. It is **not** in `SPEC-fork-seam.md`, so I have left it out rather than
   widening scope unasked. Say the word and it becomes Task 6.
