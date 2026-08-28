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

## Task 2: Mark the existing fork lines and guard Service.qml  [DONE]

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
- [x] All **five** existing fork hunks in `Service.qml` carry a `// fork:` marker naming `SPEC.md`
- [x] The script counts **added** lines against the 60-line budget and reports the current count
- [x] It fails, naming the line number, on an added `Service.qml` line with no marker in its hunk
- [x] It fails when a marker names a spec file absent from `docs/spec/`
- [x] `docs/spec/SPEC-fork-seam.md` budget wording amended to "added lines"
- [x] No runtime behavior change: service loads and handles notifications

**Verification:**
- [x] `./scripts/check-delta.sh` → exits 0, reports `+14/60 added lines`
- [x] Add an unmarked line to `Service.qml` → fails with the line number; reverted
- [x] Add an unmarked line *directly above a marker* → fails (see bug note below)
- [x] Add a `// fork: SPEC-nonexistent.md` marker → fails naming the missing spec; reverted
- [x] `DELTA_BUDGET=5 ./scripts/check-delta.sh` → fails on the budget
- [x] `/usr/lib/qt6/bin/qmllint Service.qml` → 32 warnings, warning categories identical to upstream's own file
- [x] `./install.sh && omarchy restart shell && notify-send` → service live, popup persisted
- [x] **Visual**: toasts still render top-center (confirmed by the user, 2026-08-28)

**Bug found and fixed during verification:** the first cut of the marker check
asked "does this hunk contain a marker anywhere". An unmarked line placed
directly above a marked one joined its hunk and passed — the guard reporting
`ok` on a tree with unlabelled fork code in it. Caught by running the negative
case against the real `Service.qml`; the fixture had missed it because its
unmarked line was nowhere near a marker. The rule is now "the **first** added
line of a hunk must carry the marker", with a regression test.

**Documented limit:** a marker covers the contiguous added block it introduces.
A line added directly *below* a marker is indistinguishable from a legitimate
two-line hook, and only per-line markers would separate them — which would
double the delta in order to police the delta. The budget check is what bounds
a labelled block from growing. Recorded as a passing test so the limit is not
mistaken for a guarantee.

**Dependencies:** Task 1

**Files touched:**
- `Service.qml`
- `scripts/check-delta.sh`
- `test/check-delta.test.js`
- `docs/spec/SPEC-fork-seam.md`
- `tasks/plan.md` (open questions resolved)

**Estimated scope:** S (5 files)

---

## Checkpoint A: The guard is real  [REACHED]

- [x] `./scripts/check-delta.sh` exits 0 on a clean tree (`+14/60 added lines`)
- [x] Each of the four checks has been **observed to fail** when deliberately broken — a guard nobody has seen fail is not a guard. Doing this is what found the marker bug.
- [x] `git merge upstream` reports "Already up to date."
- [x] Notifications work on a live shell; 19 tests pass
- [ ] Review with human before proceeding

---

## Phase 2: The scaffold

## Task 3: Test harness for QML JS resources  [DONE]

**Description:** Create `test/harness.js`, which loads a QML `.js` resource into
a fresh V8 context and returns its declared functions, plus a test that proves
the harness works by exercising `NotificationLogic.js`. Every later module's
unit tests depend on this. The approach was verified during planning against
node v26.7.0, so this is transcription rather than exploration.

The harness must return only the functions the file declares — the seeded
context globals (`Date`, `Math`, `JSON`, `console`) must not leak into the
returned surface, or tests will assert against the wrong thing.

**Acceptance criteria:**
- [x] `node --test "test/**/*.test.js"` runs and passes (30 tests)
- [x] `harness.load("NotificationLogic.js")` returns the file's declarations and no ambient globals
- [x] Tests cover known-good and known-bad input for real upstream functions — `parseExecArgv` fail-closed cases, `popupFileName`, `isEphemeralApp` — proving the harness exercises behavior rather than just importing
- [x] Loading a nonexistent path fails with a message naming the path and where it looked

**Verification:**
- [x] `node --test "test/**/*.test.js"` → all pass
- [x] `git diff upstream -- NotificationLogic.js` → empty (the harness reads it, never writes it)
- [x] `./scripts/check-delta.sh` → still exits 0
- [x] `./install.sh` → `test/` is not copied into the plugin directory

**Design change made during the task.** The harness first ran resources in a
fresh `vm` context, which is the obvious choice and quietly wrong: every value
crossing back out carried that realm's prototypes, so `deepStrictEqual` failed
with "same structure but not reference-equal" on an array that was correct in
every observable way. Since `groupPopups`, `parseSettings` and `popupRoles` all
return arrays and objects, all six remaining modules would have paid a tax to
buy isolation none of them needed. The harness now wraps the source in a
function and runs it in the host realm — which keeps declarations out of the
host global just as well, while QML-only globals stay absent from node either
way. Pinned by a regression test.

**Second command correction.** `test/harness.js` was itself being run as a test
file: node's default discovery matches every `.js` under `test/`, so a helper
with no assertions reported as a passing test and inflated the count. The
command is now `node --test "test/**/*.test.js"`, scoped and quoted.

**Dependencies:** None (parallelizable with Tasks 1-2)

**Files touched:**
- `test/harness.js`
- `test/harness.test.js`
- `docs/spec/SPEC.md` (test command, and the harness description)

**Estimated scope:** S (3 files)

---

## Phase 3: The record

## Task 4: README — how the fork is structured  [DONE]

**Description:** Add a "How the fork is structured" section to `README.md`: the
sidecar rule, the hook inventory in `docs/spec/SPEC-fork-seam.md` as the source
of truth, and `check-delta.sh` added to the merge procedure. The existing "the
whole fork is seven lines" claim becomes a statement about hook points, since it
is about to stop being literally true. Add a pointer to
`docs/spec/CAPABILITY-MAP.md` so the root README stays a plugin README rather
than turning into a project plan.

**Scope changed by the user mid-task:** the README is to be *condensed*, with
long explanations moved into their own files and referenced. So rather than
adding a section, this task moved detail out — 81 lines down to 58, while
covering more ground.

**Acceptance criteria:**
- [x] README states the sidecar rule and the `// fork:` marker convention, in five lines, linking `docs/spec/SPEC-fork-seam.md` for the rest
- [x] The upstream procedure ends with `./scripts/check-delta.sh` — now in `docs/upstream.md`, which the README links, rather than in the README itself
- [x] A pointer to `docs/spec/CAPABILITY-MAP.md` exists; no plan content is duplicated
- [x] Install and DND-conflict instructions preserved: the commands stay in the README, the reasoning moved to `docs/install.md`

**Verification:**
- [x] Every command in the README and both new docs runs as written
- [x] Every relative link in every markdown file resolves (enforced by `test/docs.test.js`)
- [x] README is under the 60-line budget (enforced)
- [x] No documentation file is orphaned (enforced)
- [x] The README's factual claims re-checked against the tree: two files byte-identical, five `// fork:` markers present, qmllint categories identical to upstream

**Deliberately dropped:** the "What differs from upstream" table and the "the
whole fork is seven lines" sentence. Both were about to become maintenance
liabilities — the table duplicated the hook inventory in `SPEC-fork-seam.md`,
and the line count stops being seven the moment a module lands. The structure
section says the durable thing instead.

**Tests are structural, not editorial.** `test/docs.test.js` checks what rots
silently: a link pointing at a renamed file, a README growing past the point
anyone reads it, a doc nobody links. It has no opinion on prose.

**Dependencies:** Task 2 (documents the finished script)

**Files touched:**
- `README.md` (81 → 58 lines)
- `docs/install.md` (new)
- `docs/upstream.md` (new)
- `docs/spec/CAPABILITY-MAP.md` (spec list turned into real links, so it works as the index it claims to be)
- `test/docs.test.js` (new)

**Estimated scope:** M (5 files)

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
- [ ] `node --test "test/**/*.test.js"` passes
- [ ] `./scripts/check-delta.sh` passes, and has been seen to fail on each check
- [ ] `qmllint Service.qml` reports no warning upstream does not also report
- [ ] `git merge upstream` is a no-op
- [ ] `./install.sh` ships no new file into the plugin directory
- [ ] Notifications work on a live shell
- [ ] Ready for review; `settings` is unblocked
