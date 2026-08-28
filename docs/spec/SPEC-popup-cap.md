# Spec: popup-cap

Module id `popup-cap`. Depends on `settings`. Written to depend on `stacking`,
**built before it** — see "Built ahead of stacking" below.

## Objective

"Control how many notifications we have at the same time so they don't go all
the way down the screen." A hard ceiling on visible slots, with the oldest
evicted to history when a new one arrives over the limit.

## Design

### The unit is a slot, not a row

With grouping on, a slot is a deck; six Discord pings are one slot. With
grouping off, a slot is a row. Capping raw rows would put a cap of 4 nowhere
near four cards of screen space, which is why the final semantics need
`stacking`.

`forkState.slotCount` is the interface. Until `stacking` lands it is
`popupModel.count` — one row, one slot — and the two are identical, because
without grouping every row *is* its own card.

### Built ahead of stacking

The capability map orders `stacking` first. It was built second instead, so this
module ships its value earlier and `stacking` inherits a working cap rather than
having to grow one.

The cost is a known, recorded follow-up rather than a surprise. When `stacking`
lands it must:

1. redefine `forkState.slotCount` as `forkState.groups.length`, and
2. make eviction remove **every row of the chosen group**, not a single row.

The eviction selector returns a *list* of row identities precisely so that
change is a change of selector, not of mechanism. `SPEC-stacking.md` carries
both items as acceptance criteria; without them a deck of six pings would count
as six slots and the cap would shred it.

### Eviction

Chosen behavior: **evict the oldest immediately**. A new notification always
shows; the oldest visible slot leaves early.

On insert, after the row is in `popupModel`, while `slotCount > maxVisiblePopups`:

1. Choose the oldest **non-critical** group — oldest by its newest row's
   timestamp, so a deck that is still actively receiving is not the first to go.
2. Evict every row in it via the existing `removePopup(index, "expire")` path,
   which archives each to history, deletes its popup file, and tells the sender
   the notification expired.
3. If every visible group is critical, **exceed the cap** and evict nothing.

That last rule is deliberate. A cap is a comfort feature; silently dropping an
emergency alert to honor it is a bug, and no reasonable default makes it right.
`SPEC.md` lists it as a success criterion.

Eviction uses `"expire"`, not `"dismiss"`: the user did not dismiss anything,
and `expire()` is the freedesktop-correct signal to the sender. History and
on-disk cleanup then follow the paths upstream already exercises, so eviction
adds no new file handling.

### Bounding the replay for free

`showRecentHistory()` replays history onto the screen as toasts. Once
`historyLimit` defaults to 100 that would fill the display several times over.
Because the cap runs on every insert, the replay is bounded automatically: it
appends rows and the cap trims to `maxVisiblePopups` slots. No new knob, no
change to what the keybind does. See open question 2 in `SPEC.md`.

### No `Service.qml` hook at all

The spec originally placed a call after the insert in `handleNotification`, and
another after a replay appends — and a third would have been needed after the
restore batch.

None is necessary. `popupModel` is exposed as `service.popupModel`, so the
sidecar watches its `count` and enforces the cap whenever it rises. That covers
arrival, replay and restore through one mechanism, and spends **zero** of the
hook budget. Hook 6 is released back.

The watcher defers through `Qt.callLater`, matching the discipline upstream
already applies to model mutation: reacting synchronously to `countChanged`
would re-enter a model mid-mutation, which is what upstream's own
`Qt.callLater` comment warns about.

### Interaction with restore

Restoring popups after a shell restart appends rows straight to `popupModel`
outside `handleNotification`. The cap must run after the restore batch settles
too, or a crash during a burst reopens the shell with twenty toasts. Applying
it once at the end of the restore — not per row — keeps the newest, which is
what a user expects to come back to.

## Acceptance Criteria

- With `maxVisiblePopups: 3`, twenty notifications from five apps leave three
  cards on screen.
- *(Deferred to `stacking`: the same burst with grouping on leaves three decks.)*
- The evicted notification is present in history immediately after eviction.
- Eviction removes the oldest slot, never the newest.
- *(Deferred to `stacking`: a deck still receiving new members is not evicted
  before an older idle deck.)*
- Criticals are never evicted; a screen of four criticals with a cap of 3 keeps
  all four and evicts nothing.
- `showHistory` with `historyLimit: 100` leaves at most `maxVisiblePopups` slots
  on screen.
- Restoring after a restart with more saved popups than the cap leaves exactly
  the cap's worth, newest kept.
- Lowering the cap while toasts are on screen evicts down to the new value.
- No evicted notification leaves a stale file in `notifications/`.

## Verification

```sh
node --test "test/**/*.test.js"       # slot selection, critical exemption, ordering
omarchy-shell notification-settings setMaxVisible 3
./scripts/smoke.sh                    # count slots; check history for the evicted
for i in $(seq 1 6); do notify-send -u critical "crit $i"; done   # none evicted
omarchy-shell notification-settings setMaxVisible 1               # evicts live
ls ~/.local/state/omarchy/notifications/*.json                    # no orphans
```

## Risks

- **Eviction races the model.** `removePopup` inside a loop over a model being
  mutated is the classic index bug. Collect the rows to evict by identity
  first, then remove them, never index into a model mid-mutation.
- **Eviction storm.** A cap of 1 under a heavy burst evicts on every arrival,
  producing a lot of file-queue traffic. The queue is serialized and this is
  bounded work per notification, but it is worth watching during the smoke test.
- **"Oldest" is ambiguous for a deck.** Defined here as the newest row's
  timestamp. Using the group's oldest row instead would evict a busy deck
  first, which is the wrong answer for chat apps.
