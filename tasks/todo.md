# Tasks: popup-cap

Plan: [`tasks/plan.md`](plan.md). Spec:
[`docs/spec/SPEC-popup-cap.md`](../docs/spec/SPEC-popup-cap.md).
Every task clears the Definition of Done in
[`docs/spec/SPEC.md`](../docs/spec/SPEC.md); commits follow `CLAUDE.local.md`
(conventional commits via `git-commit-helper`, scope `popup-cap`, comment blocks
capped at three lines).

---

## Phase 1: What to evict

## Task 1: Eviction selection

**Description:** Given the rows on screen, the cap and the critical urgency
value, decide which rows leave. Pure, so the rule is settled before anything
touches a live model.

Returns a **list of row identities** (`originalId` + `timestamp`), never
indices and never a single row. Indices shift as the model mutates, and the
list shape is what lets `stacking` later swap one row for a whole group without
changing the mechanism.

**Acceptance criteria:**
- [ ] `rowsToEvict(rows, max, criticalUrgency)` returns `[]` when the count is at or under the cap
- [ ] Over the cap it returns exactly `count - max` identities
- [ ] It selects the oldest rows by timestamp, never the newest
- [ ] Critical rows are never selected
- [ ] When every row is critical it returns `[]`, even far over the cap — the cap is exceeded rather than an alert dropped
- [ ] With a mix, it evicts only non-criticals and stops when they run out, even if still over the cap
- [ ] Identities carry `originalId` and `timestamp`, not indices
- [ ] Malformed rows, a non-array, a zero or negative cap, and a missing urgency value all yield `[]` rather than throwing

**Verification:**
- [ ] `node --test "test/**/*.test.js"` → all pass, including `test/popup-cap.test.js`
- [ ] A test with 20 rows and cap 3 asserts the 17 oldest are chosen and the 3 newest survive
- [ ] A test with 5 criticals and cap 1 asserts `[]`
- [ ] A test with 3 criticals + 3 normals and cap 2 asserts only normals are chosen
- [ ] `./scripts/check-delta.sh` → passes; this task touches no upstream file

**Dependencies:** None

**Files likely touched:**
- `NotificationPolicy.js`
- `test/popup-cap.test.js` (new)

**Estimated scope:** S (2 files)

---

## Phase 2: When to evict

## Task 2: Enforce the cap, and a smoke script to see it

**Description:** The sidecar watches `service.popupModel`'s count and evicts
when it rises above the cap. No `Service.qml` hook: `popupModel` is already
exposed as an alias for consumers outside its id scope.

The watcher defers through `Qt.callLater`. Reacting synchronously to
`countChanged` would re-enter a model mid-mutation — the crash upstream's own
`Qt.callLater` comment warns about.

Also builds `scripts/smoke.sh`, which `SPEC.md` has referenced in four places
since `fork-seam` without it existing. A cap cannot be verified by hand without
a repeatable burst.

**Acceptance criteria:**
- [ ] `maxVisiblePopups: 3` and a burst of 20 leaves 3 toasts on screen
- [ ] The newest 3 survive; the evicted are the oldest
- [ ] Every evicted notification is in history immediately afterwards
- [ ] No evicted notification leaves a file behind in `notifications/`
- [ ] Lowering the cap while toasts are on screen evicts down to the new value
- [ ] Raising it does not resurrect anything
- [ ] A screen of criticals over the cap keeps them all
- [ ] `scripts/smoke.sh` fires a documented, repeatable burst and is not shipped by `install.sh`
- [ ] No `Service.qml` change: `check-delta.sh` still reports `+36/60`

**Verification:**
- [ ] `./install.sh && omarchy restart shell`
- [ ] `setMaxVisible 3`, run `./scripts/smoke.sh`, count toasts on screen → 3
- [ ] Compare the survivors' summaries against the last 3 sent
- [ ] `notification-history list` → the evicted ones are there
- [ ] `ls ~/.local/state/omarchy/notifications/*.json` → one file per visible toast, no orphans
- [ ] `setMaxVisible 1` with 3 on screen → 2 evicted immediately
- [ ] Send 5 criticals with cap 2 → all 5 stay; dismiss them by hand
- [ ] Time a burst of 20 at cap 1 and record the file-queue cost in the plan
- [ ] **Visual**: confirm the column no longer runs off the bottom of the screen

**Dependencies:** Task 1

**Files likely touched:**
- `NotificationState.qml`
- `scripts/smoke.sh` (new)
- `test/popup-cap.test.js`

**Estimated scope:** S (3 files)

---

## Checkpoint A: A burst is bounded

- [ ] A burst of 20 leaves exactly the cap on screen, newest kept
- [ ] Everything evicted is in history, with no file left behind
- [ ] Criticals survive the cap
- [ ] `node --test "test/**/*.test.js"` and `./scripts/check-delta.sh` pass
- [ ] Review with human before proceeding

---

## Phase 3: The other ways rows arrive

## Task 3: Replay and restore

**Description:** Rows also arrive from `showHistory` replaying history as
toasts, and from the restart restore. The watcher should already cover both,
since it reacts to the model rather than to a call site — this task proves it
and fixes what it finds.

It also settles `SPEC.md` open question 2: with the cap in place, `showHistory`
stays exactly as it is, because the replay can no longer flood the screen.

**Acceptance criteria:**
- [ ] `showHistory` with `historyLimit: 100` leaves at most `maxVisiblePopups` toasts on screen
- [ ] The replay keeps the newest entries, not an arbitrary subset
- [ ] A restart with more saved popups than the cap leaves exactly the cap's worth, newest kept
- [ ] The cap runs once after the restore batch settles, not per row
- [ ] A restored critical is never evicted, even over the cap
- [ ] Replay and restore leave no orphaned files
- [ ] `showHistory` still behaves as it always did in every other respect

**Verification:**
- [ ] `setHistoryLimit 100`, generate 20 history entries, `setMaxVisible 3`, `omarchy-shell notifications showHistory` → 3 toasts
- [ ] Generate 10 live toasts with `duration 0` so they persist, `omarchy restart shell` → the cap's worth returns, newest kept
- [ ] Same with criticals → all restored, none evicted
- [ ] `ls ~/.local/state/omarchy/notifications/*.json` after each → matches what is on screen
- [ ] `./scripts/check-delta.sh` and the full suite pass

**Dependencies:** Task 2

**Files likely touched:**
- `NotificationState.qml`
- `test/popup-cap.test.js`
- `docs/spec/SPEC.md` (open question 2 already marked resolved during planning)

**Estimated scope:** S (2 files)

---

## Checkpoint B: Module complete

- [ ] Every acceptance criterion in `docs/spec/SPEC-popup-cap.md` is met, except those explicitly deferred to `stacking`
- [ ] `node --test "test/**/*.test.js"` passes
- [ ] `./scripts/check-delta.sh` passes — expected unchanged at `+36/60`
- [ ] `qmllint` reports no warning category upstream does not also report
- [ ] `git merge upstream` is a no-op
- [ ] Notifications, DND, history and `showHistory` all still work
- [ ] Settings and history left as they were found
- [ ] Ready for review; `stacking` is next and inherits the two follow-ups recorded in its spec
