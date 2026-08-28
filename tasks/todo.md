# Tasks: fork-seam

Plan: `tasks/plan.md`. Spec: `docs/spec/SPEC-fork-seam.md`.
Every task also clears the project-wide Definition of Done in `docs/spec/SPEC.md`.

---

## Phase 1: The guard

## Task 1: Guard the byte-identical upstream files  [DONE]

**Description:** Create `scripts/check-delta.sh` with its first and most
important check: `NotificationLogic.js` and `components/NotificationCard.qml`
must be byte-identical to the `upstream` branch. This is the invariant the
whole fork strategy rests on, it is trivially checkable, and it passes on the
current tree — so the script is green from its first commit and the habit of
running it can start immediately.

**Acceptance criteria:**
- [x] `scripts/check-delta.sh` exists, is executable, and exits 0 on the current tree
- [x] It exits non-zero and names the offending file when either guarded file differs from `upstream`
- [x] It exits 0 with an explanatory note, not an error, when the `upstream` branch is absent

**Verification:**
- [x] `./scripts/check-delta.sh` → exits 0
- [x] `echo "" >> NotificationLogic.js && ./scripts/check-delta.sh` → non-zero, names the file; then `git checkout NotificationLogic.js`
- [x] Same negative test for `components/NotificationCard.qml`
- [x] Works against an uncommitted edit (dirty tree), not just committed state
- [x] `git branch -m upstream upstream-tmp && ./scripts/check-delta.sh` → exits 0 with a note; then rename back
- [x] Also covered automatically: 9 tests in `test/check-delta.test.js`, run against a
      throwaway fixture repo so no negative case ever touches this working tree
- [x] Deletion of a verbatim file is caught (not in the original list; found while testing)
- [x] Running outside a git repository fails cleanly rather than checking nothing

**Dependencies:** None

**Files touched:**
- `scripts/check-delta.sh`
- `test/check-delta.test.js`
- `docs/spec/SPEC.md` (corrected the documented test command -- see note below)

**Estimated scope:** S (3 files)

**Note:** `SPEC.md` documented `node --test test/`, which errors on node 26 --
a directory argument is resolved as a module. Corrected to bare `node --test`
throughout, with the reason recorded in the command block so nobody re-adds it.

---

## Task 2: Mark the existing fork lines and guard Service.qml

**Description:** Add `// fork:` markers to the four existing hunks in
`Service.qml` (the top-center popup change), then extend `check-delta.sh` with
checks 2-4: the added-line budget, the requirement that every changed hunk
carries a marker, and the requirement that each marker names a spec file that
exists in `docs/spec/`. The markers come first in the same task because check 3
cannot pass without them, and a task must leave the tree green.

Pure-deletion hunks — the removed `anchors.rightMargin` line — get a one-line
`// fork:` comment stating what was removed and why, per the decision in
`tasks/plan.md`. Markers go on their own line above the construct, never inline
inside a binding.

**Acceptance criteria:**
- [ ] All four existing fork hunks in `Service.qml` carry a `// fork:` marker naming `SPEC.md`
- [ ] The script counts **added** lines against the 60-line budget and reports the current count
- [ ] It fails, naming the line number, on an added `Service.qml` line with no marker in its hunk
- [ ] It fails when a marker names a spec file absent from `docs/spec/`
- [ ] `docs/spec/SPEC-fork-seam.md` budget wording amended to "added lines" (pending open question 1)
- [ ] No runtime behavior change: toasts still render top-center

**Verification:**
- [ ] `./scripts/check-delta.sh` → exits 0, prints the added-line count (expect ~11)
- [ ] Add an unmarked line to `Service.qml` → fails with the line number; revert
- [ ] Add a `// fork: SPEC-nonexistent.md` marker → fails naming the missing spec; revert
- [ ] `/usr/lib/qt6/bin/qmllint Service.qml` → still 32 warnings, no new ones
- [ ] `./install.sh && omarchy restart shell && notify-send "seam" "still centered"` → toast appears top-center as before

**Dependencies:** Task 1

**Files likely touched:**
- `Service.qml`
- `scripts/check-delta.sh`
- `docs/spec/SPEC-fork-seam.md`

**Estimated scope:** S (3 files)

---

## Checkpoint A: The guard is real

- [ ] `./scripts/check-delta.sh` exits 0 on a clean tree
- [ ] Each of the four checks has been **observed to fail** when deliberately broken — a guard nobody has seen fail is not a guard
- [ ] `git merge upstream` reports "Already up to date."
- [ ] Notifications still work on a live shell
- [ ] Review with human before proceeding

---

## Phase 2: The scaffold

## Task 3: Test harness for QML JS resources

**Description:** Create `test/harness.js`, which loads a QML `.js` resource into
a fresh V8 context and returns its declared functions, plus a test that proves
the harness works by exercising `NotificationLogic.js`. Every later module's
unit tests depend on this. The approach was verified during planning against
node v26.7.0, so this is transcription rather than exploration.

The harness must return only the functions the file declares — the seeded
context globals (`Date`, `Math`, `JSON`, `console`) must not leak into the
returned surface, or tests will assert against the wrong thing.

**Acceptance criteria:**
- [ ] `node --test` runs and passes
- [ ] `harness.load("NotificationLogic.js")` returns the file's declared functions and none of the seeded globals
- [ ] Tests cover a known-good and a known-bad input for at least one real upstream function, proving the harness exercises behavior rather than just importing
- [ ] Loading a nonexistent path fails with a clear message, not a stack trace about `undefined`

**Verification:**
- [ ] `node --test` → all pass
- [ ] `git diff upstream -- NotificationLogic.js` → empty (the harness reads it, never writes it)
- [ ] `./scripts/check-delta.sh` → still exits 0
- [ ] `./install.sh` → `test/` is not copied into the plugin directory

**Dependencies:** None (parallelizable with Tasks 1-2)

**Files likely touched:**
- `test/harness.js`
- `test/harness.test.js`

**Estimated scope:** S (2 files)

---

## Phase 3: The record

## Task 4: README — how the fork is structured

**Description:** Add a "How the fork is structured" section to `README.md`: the
sidecar rule, the hook inventory in `docs/spec/SPEC-fork-seam.md` as the source
of truth, and `check-delta.sh` added to the merge procedure. The existing "the
whole fork is seven lines" claim becomes a statement about hook points, since it
is about to stop being literally true. Add a pointer to
`docs/spec/CAPABILITY-MAP.md` so the root README stays a plugin README rather
than turning into a project plan.

**Acceptance criteria:**
- [ ] README documents the sidecar rule and the `// fork:` marker convention
- [ ] The "Tracking upstream" procedure ends with `./scripts/check-delta.sh`
- [ ] The seven-lines claim is restated in terms of hook points and stays accurate
- [ ] A pointer to `docs/spec/CAPABILITY-MAP.md` exists; no plan content is duplicated into the README
- [ ] The existing install and DND-conflict instructions are untouched

**Verification:**
- [ ] Every command in the README runs as written
- [ ] Every file path in the README resolves
- [ ] Manual read: someone who has never seen this repo can tell where new code goes

**Dependencies:** Task 2 (documents the finished script)

**Files likely touched:**
- `README.md`

**Estimated scope:** S (1 file)

---

## Task 5: ADR 0001 — the sidecar seam

**Description:** Record the decision in `docs/adr/0001-sidecar-seam.md`: why fork
logic lives in sidecar files rather than in `Service.qml`, and why the rejected
alternative — a separate companion plugin — was rejected. Creates `docs/adr/`.
Without this, the next person to hit a merge conflict re-litigates a settled
question.

**Acceptance criteria:**
- [ ] `docs/adr/0001-sidecar-seam.md` states context, decision, consequences
- [ ] It names the rejected alternative (separate companion plugin) and why: two plugins to install, plus file/IPC coordination that `shell.serviceFor()` makes unnecessary
- [ ] It records the accepted cost: the delta grows from 7 lines to a budgeted 60
- [ ] It links to `docs/spec/SPEC-fork-seam.md` for the live hook inventory rather than copying it

**Verification:**
- [ ] Links resolve
- [ ] The hook inventory is referenced, not duplicated — one source of truth

**Dependencies:** None (parallelizable)

**Files likely touched:**
- `docs/adr/0001-sidecar-seam.md`

**Estimated scope:** XS (1 file)

---

## Checkpoint B: Module complete

- [ ] Every acceptance criterion in `docs/spec/SPEC-fork-seam.md` is met
- [ ] `node --test` passes
- [ ] `./scripts/check-delta.sh` passes, and has been seen to fail on each check
- [ ] `qmllint Service.qml` reports no warning upstream does not also report
- [ ] `git merge upstream` is a no-op
- [ ] `./install.sh` ships no new file into the plugin directory
- [ ] Notifications work on a live shell
- [ ] Ready for review; `settings` is unblocked
