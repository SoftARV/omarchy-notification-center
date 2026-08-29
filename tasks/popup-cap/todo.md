# Tasks: popup-cap

Plan: [`tasks/plan.md`](plan.md). Spec:
[`docs/spec/SPEC-popup-cap.md`](../../docs/spec/SPEC-popup-cap.md).
Every task clears the Definition of Done in
[`docs/spec/SPEC.md`](../../docs/spec/SPEC.md); commits follow `CLAUDE.local.md`
(conventional commits via `git-commit-helper`, scope `popup-cap`, comment blocks
capped at three lines).

---

## Phase 1: What to evict

## Task 1: Eviction selection  [DONE]

**Description:** Given the rows on screen, the cap and the critical urgency
value, decide which rows leave. Pure, so the rule is settled before anything
touches a live model.

Returns a **list of row identities** (`originalId` + `timestamp`), never
indices and never a single row. Indices shift as the model mutates, and the
list shape is what lets `stacking` later swap one row for a whole group without
changing the mechanism.

**Acceptance criteria:**
- [x] `rowsToEvict(rows, max, criticalUrgency)` returns `[]` when the count is at or under the cap
- [x] Over the cap it returns exactly `count - max` identities
- [x] It selects the oldest rows by timestamp, never the newest
- [x] Critical rows are never selected
- [x] When every row is critical it returns `[]`, even far over the cap — the cap is exceeded rather than an alert dropped
- [x] With a mix, it evicts only non-criticals and stops when they run out, even if still over the cap
- [x] Identities carry `originalId` and `timestamp`, not indices
- [x] Malformed rows, a non-array, a zero or negative cap, and a missing urgency value all yield `[]` rather than throwing

**Verification:**
- [x] `node --test "test/**/*.test.js"` → all pass, including `test/popup-cap.test.js`
- [x] A test with 20 rows and cap 3 asserts the 17 oldest are chosen and the 3 newest survive
- [x] A test with 5 criticals and cap 1 asserts `[]`
- [x] A test with 3 criticals + 3 normals and cap 2 asserts only normals are chosen
- [x] `./scripts/check-delta.sh` → passes; this task touches no upstream file

**Dependencies:** None

**Files touched:**
- `NotificationPolicy.js` (`rowsToEvict`)
- `test/popup-cap.test.js` (new — 13 tests)

**Estimated scope:** S (2 files)

**"Exactly the overflow" has one deliberate exception.** With three criticals
and three normals at cap 2, the overflow is four but only three rows are
evictable — so three leave and the screen holds three, one over the cap. The
criteria are worded as if the overflow is always available; it is not, and the
critical exemption wins. A test pins that case specifically.

**Two failure directions, one chosen on purpose.** A missing or unparseable
critical-urgency value makes everything look evictable, which could drop an
alert. It returns `[]` instead: the cap is exceeded rather than an emergency
notification dropped. The same reasoning covers a nonsense cap.

**Selection sorts rather than trusting the order it is handed.** `popupModel`
is newest-first today, but nothing guarantees the caller passes it that way, and
a wrong assumption would evict the newest toasts. Tested with newest-first,
oldest-first and shuffled input.

---

## Phase 2: When to evict

## Task 2: Enforce the cap, and a smoke script to see it  [DONE]

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
- [x] `maxVisiblePopups: 3` and a burst of 20 leaves 3 toasts on screen
- [x] The newest 3 survive; the evicted are the oldest
- [x] Every evicted notification is in history immediately afterwards
- [x] No evicted notification leaves a file behind in `notifications/`
- [x] Lowering the cap while toasts are on screen evicts down to the new value
- [x] Raising it does not resurrect anything
- [x] A screen of criticals over the cap keeps them all
- [x] `scripts/smoke.sh` fires a documented, repeatable burst and is not shipped by `install.sh`
- [x] No `Service.qml` change: `check-delta.sh` still reports `+36/60`

**Verification:**
- [x] `./install.sh && omarchy restart shell`
- [x] `setMaxVisible 3`, run `./scripts/smoke.sh`, count toasts on screen → 3
- [x] Compare the survivors' summaries against the last 3 sent
- [x] `notification-history list` → the evicted ones are there
- [x] `ls ~/.local/state/omarchy/notifications/*.json` → one file per visible toast, no orphans
- [x] `setMaxVisible 1` with 3 on screen → 2 evicted immediately
- [x] Send 5 criticals with cap 2 → all 5 stay; dismiss them by hand
- [x] Time a burst of 20 at cap 1 and record the file-queue cost in the plan
- [x] **Visual**: the column no longer runs off the bottom of the screen — confirmed by the user, 2026-08-29

**Dependencies:** Task 1

**Files touched:**
- `NotificationState.qml` (`slotCount`, the watcher, `enforceCap`, identity lookup)
- `scripts/smoke.sh` (new)
- `test/comments.test.js` (now globs `scripts/`, so a new script cannot escape the rule)

**Estimated scope:** S (3 files). **Zero `Service.qml` hooks** — the guard reads
`+36/60`, exactly as before this task.

**Two checks proved nothing the first time and were redone.** The survivors of
the first burst had already expired naturally by the time I measured, so
"no orphaned files" read 0 files against 0 toasts, and "lowering the cap evicts"
compared 0 against 0. Re-run with `setDuration normal 0` so the toasts stay put:
then 3 files against 3 toasts, and lowering to 1 visibly evicted 2 keeping the
newest.

**Measured, not asserted:** 20 notifications at cap 3 leave `smoke 18/19/20`;
all 20 reach history; lowering to 1 leaves `smoke 20`; raising to 5 resurrects
nothing; 5 criticals at cap 2 all stay, and a normal arriving among them is the
one evicted.

**Eviction storm timing**, which the plan asked for: 20 notifications at cap 1,
each triggering an eviction, settled in 4.2 s wall clock — of which about 4 s is
the script's own `sleep`. One toast left, shell responsive throughout.

---

## Checkpoint A: A burst is bounded  [REACHED]

- [x] A burst of 20 leaves exactly the cap on screen, newest kept
- [x] Everything evicted is in history, with no file left behind
- [x] Criticals survive the cap, and a normal among them is evicted instead
- [x] `node --test "test/**/*.test.js"` (117) and `./scripts/check-delta.sh` (`+36/60`) pass
- [x] Settings restored and smoke entries cleared from history afterwards
- [x] Reviewed and approved by the user, 2026-08-29, visual check included

---

## Phase 3: The other ways rows arrive

## Task 3: Replay and restore  [DONE]

**Description:** Rows also arrive from `showHistory` replaying history as
toasts, and from the restart restore. The watcher should already cover both,
since it reacts to the model rather than to a call site — this task proves it
and fixes what it finds.

It also settles `SPEC.md` open question 2: with the cap in place, `showHistory`
stays exactly as it is, because the replay can no longer flood the screen.

**Acceptance criteria:**
- [x] `showHistory` with `historyLimit: 100` leaves at most `maxVisiblePopups` toasts on screen
- [x] The replay keeps the newest entries, not an arbitrary subset
- [x] A restart with more saved popups than the cap leaves exactly the cap's worth, newest kept
- [x] The cap runs once after the restore batch settles, not per row
- [x] A restored critical is never evicted, even over the cap
- [x] Replay and restore leave no orphaned files
- [x] `showHistory` still behaves as it always did in every other respect

**Verification:**
- [x] `setHistoryLimit 100`, generate 20 history entries, `setMaxVisible 3`, `omarchy-shell notifications showHistory` → 3 toasts
- [x] Generate 10 live toasts with `duration 0` so they persist, `omarchy restart shell` → the cap's worth returns, newest kept
- [x] Same with criticals → all restored, none evicted
- [x] `ls ~/.local/state/omarchy/notifications/*.json` after each → matches what is on screen
- [x] `./scripts/check-delta.sh` and the full suite pass

**Dependencies:** Task 2

**Files touched:** none. The watcher written in Task 2 already covered both
paths, because it reacts to the model rather than to a call site. This task was
verification, and it found nothing to fix.

**Estimated scope:** S — verification only. `check-delta.sh` unchanged at `+36/60`.

**Two measurements were wrong before they were right.** Counting popup state
files said "0 toasts" after a replay — but replayed rows come *from* history and
never get popup files, so the file count cannot see them. Counted through the
model instead (`dismissOne` until it reports `none`): 3 at cap 3, 8 at cap 8.

And the first restore attempt proved nothing: lowering the cap evicted down to 3
*before* the restart, so only 3 files were ever saved. Redone by editing
`maxVisiblePopups` directly in `notifications.json` while the shell held 10
sticky toasts, so it restarted with 10 saved popups and a cap of 3. Result: 3
restored, `smoke 8/9/10` — the newest.

**Which entries survive was proved, not assumed.** Replayed toasts have no files
to read, so the newest and oldest history summaries were probed with
`notifications dismiss <summary>`: newest → `ok`, oldest → `none`.

**Restored criticals are exempt end to end:** 5 criticals saved, cap lowered to
2 on disk, restart → all 5 came back. Dismissing them left 0 files, so nothing
was orphaned.

**On "once after the batch, not per row":** both orderings end with the newest
`cap` rows, so the outcome cannot distinguish them. The `Qt.callLater` in the
watcher coalesces the burst of `countChanged` signals into one call, which is
the intended behaviour; the observable result is correct either way.

---

## Checkpoint B: Module complete  [REACHED]

- [x] Every acceptance criterion in `docs/spec/SPEC-popup-cap.md` is met, except those explicitly deferred to `stacking`
- [x] `node --test "test/**/*.test.js"` passes — 117 tests
- [x] `./scripts/check-delta.sh` passes, unchanged at `+36/60` — **no hook spent**
- [x] `qmllint` reports no warning category upstream does not also report
- [x] `git merge upstream` is a no-op
- [x] Notifications, DND, history and `showHistory` all still work
- [x] Settings restored to defaults and smoke entries cleared from history
- [x] Reviewed and approved by the user, 2026-08-29, including a live spacing test at cap 5; `stacking` is next and inherits the two follow-ups recorded in its spec

**popup-cap is complete.** A burst no longer runs off the bottom of the screen,
and it cost nothing from the hook budget.
