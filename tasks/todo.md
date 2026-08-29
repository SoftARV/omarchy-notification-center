# Tasks: stacking

Plan: [`tasks/plan.md`](plan.md). Spec:
[`docs/spec/SPEC-stacking.md`](../docs/spec/SPEC-stacking.md).
Every task clears the Definition of Done in
[`docs/spec/SPEC.md`](../docs/spec/SPEC.md); commits follow `CLAUDE.local.md`
(conventional commits via `git-commit-helper`, scope `stacking`, comment blocks
capped at three lines).

---

## Phase 1: The view, and a safe delegate

## Task 1: groupPopups  [DONE]

**Description:** Turn the flat, newest-first row list into a list of groups.
Pure, so the grouping rule is settled before any QML depends on it.

Groups are ordered by their newest member — a deck rises when it receives a
notification. Rows keep their newest-first order within a group.

**Acceptance criteria:**
- [x] `groupPopups(rows, groupByApp)` returns `[{ key, app, rows, newest }]`
- [x] Rows from the same app share one group; the key is the app trimmed and lowercased
- [x] `"Slack"`, `"slack"` and `" Slack "` group together
- [x] Rows with an empty or missing `app` each get their own group — an empty key would herd unrelated senders together
- [x] Groups are ordered by their newest member, newest group first
- [x] Rows inside a group stay newest-first
- [x] `newest` is the group's newest row timestamp
- [x] `groupByApp: false` returns one group per row, in the order given
- [x] Malformed rows, a non-array and a missing flag yield `[]` or sane groups, never a throw

**Verification:**
- [x] `node --test "test/**/*.test.js"` → all pass, including `test/stacking.test.js`
- [x] A test asserts a deck rises to the top when it gains a newer row
- [x] A test asserts two empty-`app` rows do **not** share a group
- [x] A test asserts `groupByApp: false` reproduces the input order exactly
- [x] `./scripts/check-delta.sh` → passes; this task touches no upstream file

**Dependencies:** None

**Files touched:**
- `NotificationPolicy.js` (`groupPopups`)
- `test/stacking.test.js` (new — 16 tests)

**Estimated scope:** S (2 files)

**Anonymous rows are never registered for lookup.** A first attempt namespaced
keys as `app:slack` to keep them from colliding with the `row:<id>-<ts>-<i>`
form used for ungrouped and anonymous rows — but the spec says the key *is* the
app trimmed and lowercased, and four tests said so too. Instead, only shared app
groups go in the lookup table; anonymous ones are pushed straight onto the list.
Collision becomes impossible without namespacing the key, and the spec holds.

**Ordering is computed, not trusted.** `popupModel` is newest-first, but nothing
guarantees a caller passes it that way, and the wrong assumption would put a
stale deck at the top. Both the group order and the rows within each group are
sorted; a test feeds the same rows in two different orders and asserts identical
output.

**Group rows are the caller's own row objects**, not copies — the deck renders
them directly. Pinned by a test using `strictEqual` on identity.

**The Task 4 problem, made concrete:** 12 rows across 3 apps is 3 decks, but
`rowsToEvict` on the raw rows at cap 3 selects **9 rows** — it would shred all
three decks. That is exactly what `slotCount` and group-aware eviction fix.

---

## Task 2: Extract PopupSlot.qml, dismiss by identity  [DONE]

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
- [x] `components/PopupSlot.qml` contains upstream's delegate body, unchanged apart from the identity calls and the properties it now receives
- [x] `service.dismissPopup(index)` and `service.expirePopup(index)` are replaced by `forkState.dismissRow(originalId, timestamp)` and `forkState.expireRow(...)`
- [x] `forkState.indexOfRow`, `dismissRow`, `expireRow` and `invokeRow` resolve against `popupModel` at call time; no index is ever stored
- [x] Hook 7 carries a `// fork:` marker naming `SPEC-stacking.md`
- [x] `check-delta.sh` passes, and the added-line count is reported
- [x] **No visual or behavioural change** — confirmed by the user, 2026-08-29

**Verification:**
- [x] `./install.sh && omarchy restart shell`
- [x] `notify-send` → the toast looks identical — confirmed by the user
- [x] It expires on its own after the configured duration
- [x] Hovering pauses the timer: a 15 s toast held under the pointer survived 32 s
- [x] **Right-click** dismisses it and nothing else — confirmed on a live pointer. There is no close button; the card uses `Qt.RightButton` for `closeRequested`
- [x] `./scripts/smoke.sh` at cap 4 → still exactly 4, newest kept
- [x] Left-clicking a toast with a stored action runs it — `/tmp/click-worked` was created, and it archived to history
- [x] `showHistory` replay and a restart restore both still render
- [x] `git diff upstream -- Service.qml` reviewed: the removed block is contiguous, so a future upstream change to it is one readable conflict
- [x] `qmllint Service.qml components/PopupSlot.qml` → no warning category upstream does not also report

**Dependencies:** Task 1 (not strictly — may be built in parallel)

**Files touched:**
- `components/PopupSlot.qml` (new — upstream's delegate body)
- `Service.qml` (hook 7 — 82 upstream lines out, 32 in, one contiguous hunk)
- `NotificationState.qml` (`indexOfRow`, `dismissRow`, `expireRow`, `invokeRow`)
- `test/stacking.test.js` (3 tests guarding the index hazard)
- `docs/spec/SPEC-fork-seam.md` (hook 7 spent; usage now 47/60)

**Estimated scope:** M (5 files)

**A real bug, caught because the toast never expired.** The delegate first
passed `forkState: forkState` — and since a binding resolves the object's own
properties before the component's ids, that bound the property to *itself*. It
came out null, so `service` was null, so `lifetime` was 0, so the countdown
never ran. The property is now `notificationState`, and the comment says why it
is neither `state` (QQuickItem has one) nor `forkState` (the id in
`Service.qml`).

**qmllint caught the other half of the same class.** `property var state` on an
`Item` collides with `QQuickItem.state` — the identical trap that made the mount
`forkState` rather than `state` back at planning. Renamed before it could bite.

**The conflict surface is what hook 7 promised.** The removal is a single
contiguous hunk, `@@ -979,82 +988,32 @@` — a future upstream rewrite of that
delegate is one readable conflict resolved the same way every time.

**Three tests now guard the module's main hazard**: `components/PopupSlot.qml`
and `components/NotificationDeck.qml` may not call `dismissPopup`, `expirePopup`
or `invokePopupDefault`, and may not declare an `index` property at all.

**What is verified and what is not.** Identity-based *expiry* is proven — the
countdown fired and removed the right row. `dismissRow` and `invokeRow` use the
identical `indexOfRow` mechanism, but they are reached from a pointer, so that
is an argument rather than a check. Left for the checkpoint.

---

## Checkpoint A: The extraction is invisible

- [x] A single toast is indistinguishable from before the change — confirmed by the user
- [x] Timer verified: 3 s duration expires in 3.0 s, 8 s in 8.1 s, critical stays past 12 s
- [x] Replay and restore both still render, and both respect the cap
- [x] Hover-pause, right-click dismiss and left-click action all confirmed on a live pointer
- [x] The cap still holds at 4 under a smoke burst of 20, newest kept
- [x] `node --test "test/**/*.test.js"` (136) and `./scripts/check-delta.sh` (`+47/60`) pass
- [x] The `Service.qml` diff is one contiguous removed block: `@@ -979,82 +988,32 @@`
- [x] Reviewed and approved by the user, 2026-08-29 — the hook the fork most depends on

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

**Two claims corrected by the user.** I described an X button and a countdown
ring in the manual-test brief. Neither exists: `closeRequested` is emitted on
`Qt.RightButton` from the card's `MouseArea`, and `remainingLifetime` is never
passed to the card — it has no such property, so nothing renders elapsed time.
Both were checkable in one grep and I asserted them instead.
