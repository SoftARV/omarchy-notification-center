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

## Task 2: The model, and `notification-history list`

**Description:** Give the sidecar its own `Process` reading the history
directory, a `ListModel` it populates, and an IPC target to see the result. The
read is lazy — nothing loads until asked.

Reading outside `popupFileQueue` is deliberate: that queue's `Process` has no
stdout collector and physically cannot carry a read.

**Acceptance criteria:**
- [ ] `forkState.historyModel` is an empty `ListModel` until `loadHistory()` is called
- [ ] `loadHistory()` populates it newest-first from the history directory
- [ ] An empty directory yields an empty model and no error in the shell log
- [ ] A truncated file in the directory does not stop the rest loading
- [ ] `notification-history list` returns the model as JSON
- [ ] Two `loadHistory()` calls in flight at once do not double-populate
- [ ] Reading does not block the UI: notifications still appear during a load

**Verification:**
- [ ] `./install.sh && omarchy restart shell`
- [ ] `notify-send a; notify-send b`, let them expire, then `notification-history list` → both, newest first
- [ ] `printf 'garbage' > ~/.local/state/omarchy/notifications/history/bad.json`; list again → the good entries still appear
- [ ] Empty the directory, `list` → `[]`, no error
- [ ] `qmllint Service.qml NotificationState.qml` → no warning category upstream does not also report
- [ ] `./scripts/check-delta.sh` → unchanged; this task adds no `Service.qml` hook

**Dependencies:** Task 1

**Files likely touched:**
- `NotificationState.qml`
- `test/history-store.test.js`

**Estimated scope:** S (2 files)

---

## Phase 2: Change and unread

## Task 3: Revision counter, hasUnread, markSeen

**Description:** Make the store report change. Hook 4 makes `historyLimit`
settings-driven; hook 8 bumps a revision from **both** functions that create a
history entry; hook 9 bumps it on clear. `hasUnread` reads filenames against
`historyLastSeen`, and `markSeen` persists a new timestamp through the settings
setter.

Both writers matter: covering only `archivePopupFileFor` would leave the
indicator dark for exactly the notifications missed while DND was on.

**Acceptance criteria:**
- [ ] `historyLimit` comes from settings; `setHistoryLimit 5` trims to 5 on the next archive
- [ ] `historyRevision` increases after an archive, after a DND-silenced write, and after a clear
- [ ] `hasUnread` is true after a notification reaches history, false after `markSeen`
- [ ] `hasUnread` is correct immediately after a shell restart, without loading the model
- [ ] A DND-silenced notification sets `hasUnread` just as an expired toast does
- [ ] `markSeen` persists `historyLastSeen` in `notifications.json`
- [ ] Hooks 4, 8 and 9 each carry a `// fork:` marker naming `SPEC-history-store.md`
- [ ] `check-delta.sh` stays within budget

**Verification:**
- [ ] `notification-history unread` → `no`; send one, let it expire → `yes`; `markSeen` → `no`
- [ ] `omarchy restart shell` with unread entries present → still `yes`
- [ ] `setDnd on`, `notify-send`, `setDnd off` → `unread` is `yes` (the DND path)
- [ ] `setHistoryLimit 5`, generate 8 notifications, count files → 5
- [ ] `grep historyLastSeen ~/.local/state/omarchy/notifications.json` after `markSeen` → a recent timestamp
- [ ] Time the trim with a full directory at limit 100; record it in the plan
- [ ] `./scripts/check-delta.sh` → passes, report the new count

**Dependencies:** Task 2

**Files likely touched:**
- `Service.qml` (hooks 4, 8 ×2, 9)
- `NotificationState.qml`
- `NotificationPolicy.js`
- `docs/spec/SPEC-fork-seam.md` (mark hooks spent)

**Estimated scope:** M (4 files)

---

## Checkpoint A: The store is readable and reports change

- [ ] History can be listed, and a torn file costs one entry rather than all of them
- [ ] The unread flag is right after a restart and after a DND-silenced notification
- [ ] Notifications, DND, toasts and `showHistory` all still work
- [ ] `node --test "test/**/*.test.js"` and `./scripts/check-delta.sh` pass
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

**Files likely touched:**
- `NotificationState.qml`
- `test/history-store.test.js`

**Estimated scope:** S (2 files)

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
