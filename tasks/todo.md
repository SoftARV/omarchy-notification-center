# Tasks: stacking

Plan: [`tasks/plan.md`](plan.md). Spec:
[`docs/spec/SPEC-stacking.md`](../docs/spec/SPEC-stacking.md).
Every task clears the Definition of Done in
[`docs/spec/SPEC.md`](../docs/spec/SPEC.md); commits follow `CLAUDE.local.md`
(conventional commits via `git-commit-helper`, scope `stacking`, comment blocks
capped at three lines).

---

## Phase 1: The view, and a safe delegate

## Task 1: groupPopups

**Description:** Turn the flat, newest-first row list into a list of groups.
Pure, so the grouping rule is settled before any QML depends on it.

Groups are ordered by their newest member — a deck rises when it receives a
notification. Rows keep their newest-first order within a group.

**Acceptance criteria:**
- [ ] `groupPopups(rows, groupByApp)` returns `[{ key, app, rows, newest }]`
- [ ] Rows from the same app share one group; the key is the app trimmed and lowercased
- [ ] `"Slack"`, `"slack"` and `" Slack "` group together
- [ ] Rows with an empty or missing `app` each get their own group — an empty key would herd unrelated senders together
- [ ] Groups are ordered by their newest member, newest group first
- [ ] Rows inside a group stay newest-first
- [ ] `newest` is the group's newest row timestamp
- [ ] `groupByApp: false` returns one group per row, in the order given
- [ ] Malformed rows, a non-array and a missing flag yield `[]` or sane groups, never a throw

**Verification:**
- [ ] `node --test "test/**/*.test.js"` → all pass, including `test/stacking.test.js`
- [ ] A test asserts a deck rises to the top when it gains a newer row
- [ ] A test asserts two empty-`app` rows do **not** share a group
- [ ] A test asserts `groupByApp: false` reproduces the input order exactly
- [ ] `./scripts/check-delta.sh` → passes; this task touches no upstream file

**Dependencies:** None

**Files likely touched:**
- `NotificationPolicy.js`
- `test/stacking.test.js` (new)

**Estimated scope:** S (2 files)

---

## Task 2: Extract PopupSlot.qml, dismiss by identity

**Description:** Move the Repeater's delegate body into
`components/PopupSlot.qml` **verbatim**, and replace its two index-based calls
with identity ones. This is hook 7 and the riskiest edit in the project.

**Nothing should look or behave differently afterwards.** That is the whole
point of doing it before grouping: the risky move is verified on its own, and
the deck is then built on a delegate already proven in its new home.

`PopupSlot.qml` starts as a verbatim copy so that diffing a future upstream
delegate against it stays meaningful — the mitigation `SPEC-fork-seam.md`
records for hook 7.

**Acceptance criteria:**
- [ ] `components/PopupSlot.qml` contains upstream's delegate body, unchanged apart from the identity calls and the properties it now receives
- [ ] `service.dismissPopup(index)` and `service.expirePopup(index)` are replaced by `forkState.dismissRow(originalId, timestamp)` and `forkState.expireRow(...)`
- [ ] `forkState.indexOfRow`, `dismissRow`, `expireRow` and `invokeRow` resolve against `popupModel` at call time; no index is ever stored
- [ ] Hook 7 carries a `// fork:` marker naming `SPEC-stacking.md`
- [ ] `check-delta.sh` passes, and the added-line count is reported
- [ ] **No visual or behavioural change**: one toast looks and behaves exactly as before

**Verification:**
- [ ] `./install.sh && omarchy restart shell`
- [ ] `notify-send` → the toast looks identical, top-centre, same size
- [ ] It expires on its own after the configured duration
- [ ] Hovering pauses the countdown; leaving resumes it
- [ ] Its close button dismisses it, and nothing else
- [ ] `./scripts/smoke.sh` at cap 4 → still exactly 4, newest kept
- [ ] Clicking a toast with a stored action still runs it
- [ ] `showHistory` replay and a restart restore both still render
- [ ] `git diff upstream -- Service.qml` reviewed: the removed block is contiguous, so a future upstream change to it is one readable conflict
- [ ] `qmllint Service.qml components/PopupSlot.qml` → no warning category upstream does not also report

**Dependencies:** Task 1 (not strictly — may be built in parallel)

**Files likely touched:**
- `components/PopupSlot.qml` (new)
- `Service.qml` (hook 7)
- `NotificationState.qml` (identity helpers)
- `docs/spec/SPEC-fork-seam.md` (mark hook 7 spent)

**Estimated scope:** M (4 files)

---

## Checkpoint A: The extraction is invisible

- [ ] A single toast is indistinguishable from before the change
- [ ] Timer, hover-pause, close, click-action, replay and restore all still work
- [ ] The cap still holds at 4 under a smoke burst
- [ ] `node --test "test/**/*.test.js"` and `./scripts/check-delta.sh` pass
- [ ] The `Service.qml` diff is one contiguous removed block
- [ ] Review with human before proceeding — this is the hook the fork most depends on

---

## Phase 2: The deck

## Task 3: NotificationDeck.qml

**Description:** Render a group. Collapsed by default with a count badge and
ghost edges; fanned out while the pointer is inside it. The Repeater binds to
`forkState.groups`.

A group of one must render exactly as a plain card does today — no badge, no
ghosts, no difference.

**Acceptance criteria:**
- [ ] Five notifications from one app produce one deck with a count of 5
- [ ] Three apps produce three decks, newest-group first
- [ ] A deck rises to the top when it receives a new notification
- [ ] A group of one is visually identical to a plain card
- [ ] Hovering a deck expands it; every card is independently readable, closable and clickable
- [ ] Hovering **anywhere** in a deck pauses **every** countdown in it; leaving resumes them
- [ ] An expanded deck draws at most 5 cards and shows `+N more` beyond
- [ ] Undrawn rows still expire on their own and still reach history
- [ ] Dismissing the middle card of an expanded deck removes that one and no other
- [ ] `setGrouping off` renders exactly today's flat stack; toggling it live re-lays out
- [ ] A `replaces_id` update to a grouped notification updates in place without reordering or duplicating
- [ ] A group whose rows all expire leaves no empty deck
- [ ] Delegates are keyed by group key, so a stable group does not flicker on every arrival

**Verification:**
- [ ] `APPS="Slack" COUNT=5 ./scripts/smoke.sh` → one deck, badge 5
- [ ] `APPS="Slack Discord Mail" COUNT=9 ./scripts/smoke.sh` → three decks
- [ ] Send to an existing deck → it rises to the top
- [ ] Hover a deck: it fans out; hover a middle card and close it; the others survive
- [ ] Hold the pointer on a deck past its duration → nothing expires; move away → they resume
- [ ] `COUNT=12 APPS="Slack" ./scripts/smoke.sh`, hover → 5 cards and `+7 more`
- [ ] `setGrouping off` → flat stack; `setGrouping on` → decks, live
- [ ] `omarchy-notification-send` twice with the same replaces id → one card updates in place
- [ ] **Visual**: no flicker as notifications arrive into an existing deck

**Dependencies:** Task 2

**Files likely touched:**
- `components/NotificationDeck.qml` (new)
- `NotificationState.qml` (`groups`)
- `Service.qml` (Repeater model, part of hook 7)

**Estimated scope:** M (3 files)

---

## Phase 3: Teaching the cap about decks

## Task 4: slotCount and group-aware eviction

**Description:** The two follow-ups `popup-cap` recorded. Without them a deck of
six counts as six slots and the cap shreds it.

**Acceptance criteria:**
- [ ] `forkState.slotCount` is `groups.length`, not `popupModel.count`
- [ ] A deck of six counts as **one** slot against `maxVisiblePopups`
- [ ] Eviction removes every row of the chosen group at once
- [ ] "Oldest" is the group's **newest** row, so a deck still receiving is not evicted before an older idle one
- [ ] A group containing any critical is never evicted
- [ ] With grouping off, eviction behaves exactly as `popup-cap` shipped it
- [ ] Every evicted row reaches history and leaves no file behind

**Verification:**
- [ ] `node --test "test/**/*.test.js"` → selection tests cover group eviction
- [ ] `setMaxVisible 3`, `APPS="A B C D E" COUNT=20 ./scripts/smoke.sh` → three decks on screen
- [ ] A deck of six with cap 3 alongside two others → all six rows stay, counted as one slot
- [ ] Keep sending to one deck while an older idle deck exists → the idle one goes first
- [ ] A deck containing a critical survives the cap
- [ ] `setGrouping off` → `popup-cap`'s original behaviour returns
- [ ] `ls ~/.local/state/omarchy/notifications/*.json` → matches what is on screen

**Dependencies:** Task 3

**Files likely touched:**
- `NotificationPolicy.js` (group-aware selection)
- `NotificationState.qml`
- `test/stacking.test.js`, `test/popup-cap.test.js`

**Estimated scope:** M (4 files)

---

## Checkpoint B: Module complete

- [ ] Every acceptance criterion in `docs/spec/SPEC-stacking.md` is met
- [ ] Both `popup-cap` follow-ups are done, not deferred again
- [ ] `node --test "test/**/*.test.js"` passes
- [ ] `./scripts/check-delta.sh` passes and is within the 60-line budget
- [ ] `qmllint` reports no warning category upstream does not also report
- [ ] `git merge upstream` is a no-op
- [ ] Notifications, DND, history, `showHistory`, restore and the cap all still work
- [ ] Settings and history left as they were found
- [ ] Ready for review; **all five original asks are delivered** and only `center-ui` remains
