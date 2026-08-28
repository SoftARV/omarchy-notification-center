# Tasks: history-store

Plan: [`tasks/plan.md`](plan.md). Spec:
[`docs/spec/SPEC-history-store.md`](../docs/spec/SPEC-history-store.md).
Every task clears the Definition of Done in
[`docs/spec/SPEC.md`](../docs/spec/SPEC.md); commits follow `CLAUDE.local.md`
(conventional commits via `git-commit-helper`, scope `history-store`, comment
blocks capped at three lines).

---

## Phase 1: Reading

## Task 1: History parsing and the unread predicate  [DONE]

**Description:** The pure half of the module. Turn the concatenated output of
`awk 1 history/*.json` into ordered, validated rows, and answer "is anything
newer than `historyLastSeen`" from filenames alone.

One torn file must cost one entry, not the whole history — that is the failure
this task exists to prevent.

**Acceptance criteria:**
- [x] `historyRows(raw)` returns rows newest-first with every role a card needs, including `image` and `execArgv`
- [x] A truncated or invalid line is skipped and the surrounding entries still load
- [x] Empty input returns an empty array, not null
- [x] Rows are shaped exactly like `popupModel` rows, so `NotificationCard` can render them unchanged
- [x] `hasUnreadIn(fileNames, lastSeen)` is true when any name's leading timestamp exceeds `lastSeen`
- [x] It is false for an empty list, for `lastSeen` in the future, and for names it cannot parse
- [x] Neither function throws on any malformed input

**Verification:**
- [x] `node --test "test/**/*.test.js"` → all pass, including `test/history-store.test.js`
- [x] A test places a truncated file **between** two good ones and asserts both survive
- [x] A test uses real serialized entries from this machine's history directory as fixture text
- [x] `./scripts/check-delta.sh` → passes; this task touches no upstream file

**Dependencies:** None

**Files touched:**
- `NotificationPolicy.js` (`timestampFromFileName`, `hasUnreadIn`)
- `test/history-store.test.js` (new — 12 tests)

**Estimated scope:** S (2 files)

**Half this task was already written — by upstream.** `parsePopupFiles` splits
the concatenated output, skips invalid JSON with a comment saying exactly that,
and sorts newest-first; `historyRows` dedupes and applies the limit;
`historyEntry` normalises to the `popupModel` role shape. Verified empirically
before writing anything: a torn line between two good ones costs only itself,
ordering is newest-first, `image` and `execArgv` survive, empty input gives `[]`.

So no parser was written. The tests that would have covered a new one now pin
**upstream's** behaviour instead, because this module depends on it — an upstream
change that broke torn-file tolerance would otherwise surface as an empty panel
long after the merge that caused it.

**Only `hasUnreadIn` was new.** An unusable `lastSeen` deliberately counts
everything as unread: failing dark would hide exactly the notifications the
indicator exists to report.

**Checked against the real directory**, not only fixtures: 10 files,
`historyLastSeen: 0` → unread `true`; simulating `markSeen` → `false`.

---

## Task 2: The model, and `notification-history list`  [DONE]

**Description:** Give the sidecar its own `Process` reading the history
directory, a `ListModel` it populates, and an IPC target to see the result. The
read is lazy — nothing loads until asked.

Reading outside `popupFileQueue` is deliberate: that queue's `Process` has no
stdout collector and physically cannot carry a read.

**Acceptance criteria:**
- [x] ~~`forkState.historyModel` is empty until `loadHistory()` is called~~ — **changed**: loaded once at startup, see below
- [x] `loadHistory()` populates it newest-first from the history directory
- [x] An empty directory yields an empty model and no error in the shell log
- [x] A truncated file in the directory does not stop the rest loading
- [x] `notification-history list` returns the model as JSON
- [x] Two `loadHistory()` calls in flight at once do not double-populate
- [x] Reading does not block the UI: notifications still appear during a load

**Verification:**
- [x] `./install.sh && omarchy restart shell`
- [x] `notify-send a; notify-send b`, let them expire, then `notification-history list` → both, newest first
- [x] `printf 'garbage' > ~/.local/state/omarchy/notifications/history/bad.json`; list again → the good entries still appear
- [x] Empty the directory, `list` → `[]`, no error
- [x] `qmllint Service.qml NotificationState.qml` → no warning category upstream does not also report
- [x] `./scripts/check-delta.sh` → unchanged; this task adds no `Service.qml` hook

**Dependencies:** Task 1

**Files touched:**
- `NotificationState.qml` (model, read `Process`, `notification-history` target)
- `NotificationPolicy.js` (`historyRoles`)
- `test/history-store.test.js` (3 more tests)
- `docs/spec/SPEC-history-store.md` (lazy → warm, see below)

**Estimated scope:** S (4 files). No `Service.qml` change; the guard reads
`+23/60`, unmoved.

**The spec's "lazy" read had to go.** A read is a subprocess and IPC cannot wait
on one, so a lazily-loaded model returns empty on its first query — `list` would
have needed calling twice to see anything. The stated reason for lazy was
memory, and a hundred entries is roughly 50 KB. The model is now loaded once at
startup and refreshed on demand, which also means `center-ui` will open with
content instead of flickering through an empty panel. `list` returns the last
completed read and starts a fresh one, so a query right after a write can be one
behind; the revision counter in Task 3 closes that.

**A drift guard rather than a convenience.** `historyRoles()` exists because the
IPC serialiser copies rows role by role, and a list that fell out of step with
what `historyRows` produces would drop an image or an `execArgv` with nothing to
notice. A test asserts the two match exactly.

**Verified against real data**, including the destructive cases, with the history
directory backed up to `/tmp/history.backup` first: 10 real entries listed
newest-first straight after a restart; a hand-written torn file skipped while all
10 survived; the directory emptied → `[]` with no error, then restored; five
overlapping reloads left 10 entries and 10 unique timestamps; a toast still
appeared while three reads were in flight.

---

## Phase 2: Change and unread

## Task 3: Revision counter, hasUnread, markSeen  [DONE]

**Description:** Make the store report change. Hook 4 makes `historyLimit`
settings-driven; hook 8 bumps a revision from **both** functions that create a
history entry; hook 9 bumps it on clear. `hasUnread` reads filenames against
`historyLastSeen`, and `markSeen` persists a new timestamp through the settings
setter.

Both writers matter: covering only `archivePopupFileFor` would leave the
indicator dark for exactly the notifications missed while DND was on.

**Acceptance criteria:**
- [x] `historyLimit` comes from settings; `setHistoryLimit 5` trims to 5 on the next archive
- [x] `historyRevision` increases after an archive, after a DND-silenced write, and after a clear
- [x] `hasUnread` is true after a notification reaches history, false after `markSeen`
- [x] `hasUnread` is correct immediately after a shell restart, without loading the model
- [x] A DND-silenced notification sets `hasUnread` just as an expired toast does
- [x] `markSeen` persists `historyLastSeen` in `notifications.json`
- [x] Hooks 4, 8 and 9 each carry a `// fork:` marker naming `SPEC-history-store.md`
- [x] `check-delta.sh` stays within budget

**Verification:**
- [x] `notification-history unread` → `no`; send one, let it expire → `yes`; `markSeen` → `no`
- [x] `omarchy restart shell` with unread entries present → still `yes`
- [x] `setDnd on`, `notify-send`, `setDnd off` → `unread` is `yes` (the DND path)
- [x] `setHistoryLimit 5`, generate 8 notifications, count files → 5
- [x] `grep historyLastSeen ~/.local/state/omarchy/notifications.json` after `markSeen` → a recent timestamp
- [x] Time the trim with a full directory at limit 100; record it in the plan
- [x] `./scripts/check-delta.sh` → passes, report the new count

**Dependencies:** Task 2

**Files touched:**
- `Service.qml` (hooks 4, 8a, 8b, 9 — `+36/60` added lines)
- `NotificationState.qml` (revision, `hasUnread`, `markHistorySeen`, three IPC calls)
- `NotificationPolicy.js` (**removed** `hasUnreadIn` — see below)
- `test/history-store.test.js` (removed its tests to match)
- `tasks/plan.md` (trim timing recorded)

**Estimated scope:** M (5 files)

**Task 1's unread predicate was deleted.** It scanned filenames because the
model was going to be lazy. Task 2 made the model warm, so the newest entry's
timestamp is already in hand and a filename scan is redundant — the flag is a
one-line comparison against `historyLastSeen`. Carrying twenty-five lines of
tested-but-unused code would be worse than removing it, so it went, tests
included. The design moved under it; that is the honest consequence.

**The guard caught the markers before the shell did.** Two hooks change the
*last* line of an argument list, so my first attempt put the marker second in
its hunk and `check-delta.sh` rejected it. The markers now lead, which is what
the rule is for.

**Hook 8b earned its place immediately.** A DND-silenced notification from a
named app reached history and lit the flag; without that hook the dot would
stay dark for precisely the notifications missed while away. Upstream's
behaviour is preserved alongside it — a plain `notify-send` while DND is on is
still dropped as ephemeral and never stored.

**Trim timing, which the plan asked for:** 8 ms in steady state, when the
directory is already at its limit and nothing is deleted. 486 ms only in the
pathological case of deleting 400 files in a single pass. Off the UI thread
either way. Not a concern at 100, and fine at 500.

**Restart persistence verified in all four states** after a first attempt that
was mis-sequenced and proved nothing: notification → `yes`, restart → `yes`,
`markSeen` → `no`, restart → `no`.

---

## Checkpoint A: The store is readable and reports change  [REACHED]

- [x] History can be listed, and a torn file costs one entry rather than all of them
- [x] The unread flag is right after a restart and after a DND-silenced notification
- [x] Notifications, DND, toasts and `showHistory` all still work
- [x] `node --test "test/**/*.test.js"` (98) and `./scripts/check-delta.sh` (`+36/60`) pass
- [x] Real history backed up to `/tmp/history.backup` and restored intact afterwards
- [ ] Review with human before proceeding

---

## Phase 3: Acting on an entry

## Task 4: `clear` and `invoke`

**Description:** Wrap `clearHistory()` so the model, the directory, the images
and the unread flag empty together, and add `invokeHistoryEntry` to run an
entry's stored action.

**`invoke` is the highest-risk path in this project.** A notification body is
attacker-influenced and this ends in process execution. It reuses
`NotificationLogic.parseExecArgv` unchanged — structural, fail-closed — and
`Util.execArgv`, which passes argv as positional parameters with no shell
interpretation. No string is ever built and handed to a shell.

**Acceptance criteria:**
- [ ] `clear` empties the model, the directory, the orphaned images and `hasUnread` together
- [ ] `invoke <originalId> <timestamp>` runs a valid stored `execArgv`
- [ ] A malformed, non-array, or leading-dash `execArgv` runs **nothing** and reports it
- [ ] An entry with no `execArgv` does nothing — history has no live sender, so there is no action fallback
- [ ] An unknown id/timestamp reports `none` rather than acting on the wrong entry
- [ ] No shell string is constructed anywhere on this path

**Verification:**
- [ ] `omarchy-notification-send --exec '["notify-send","from history"]' "clickable" "body"`, let it expire, `invoke` it → the action runs
- [ ] Hand-write a history entry with `execArgv` of `["-rf"]`, `"notstring"`, `[]` and `["rm","-rf","/tmp/x"]` — confirm the first three are refused and **do not** create `/tmp/x` for the fourth without an explicit run
- [ ] `invoke 999 999` → `none`
- [ ] `clear`, then `ls` the history and images directories → both empty; `unread` → `no`; `list` → `[]`
- [ ] `./scripts/check-delta.sh` and the full suite pass

**Dependencies:** Task 3

**Files touched:**
- `NotificationState.qml` (model, read `Process`, `notification-history` target)
- `NotificationPolicy.js` (`historyRoles`)
- `test/history-store.test.js` (3 more tests)
- `docs/spec/SPEC-history-store.md` (lazy → warm, see below)

**Estimated scope:** S (4 files). No `Service.qml` change; the guard reads
`+23/60`, unmoved.

**The spec's "lazy" read had to go.** A read is a subprocess and IPC cannot wait
on one, so a lazily-loaded model returns empty on its first query — `list` would
have needed calling twice to see anything. The stated reason for lazy was
memory, and a hundred entries is roughly 50 KB. The model is now loaded once at
startup and refreshed on demand, which also means `center-ui` will open with
content instead of flickering through an empty panel. `list` returns the last
completed read and starts a fresh one, so a query right after a write can be one
behind; the revision counter in Task 3 closes that.

**A drift guard rather than a convenience.** `historyRoles()` exists because the
IPC serialiser copies rows role by role, and a list that fell out of step with
what `historyRows` produces would drop an image or an `execArgv` with nothing to
notice. A test asserts the two match exactly.

**Verified against real data**, including the destructive cases, with the history
directory backed up to `/tmp/history.backup` first: 10 real entries listed
newest-first straight after a restart; a hand-written torn file skipped while all
10 survived; the directory emptied → `[]` with no error, then restored; five
overlapping reloads left 10 entries and 10 unique timestamps; a toast still
appeared while three reads were in flight.

---

## Checkpoint B: Module complete

- [ ] Every acceptance criterion in `docs/spec/SPEC-history-store.md` is met
- [ ] `node --test "test/**/*.test.js"` passes
- [ ] `./scripts/check-delta.sh` passes and is within budget
- [ ] `qmllint` reports no warning category upstream does not also report
- [ ] `git merge upstream` is a no-op
- [ ] Notifications, DND, toasts and `showHistory` all still work on a live shell
- [ ] History state left clean, with nothing from testing behind
- [ ] Ready for review; `center-ui` needs only `stacking` and `popup-cap` after this
