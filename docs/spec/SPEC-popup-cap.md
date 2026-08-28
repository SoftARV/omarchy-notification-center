# Spec: popup-cap

Module id `popup-cap`. Depends on `settings` and `stacking`.

## Objective

"Control how many notifications we have at the same time so they don't go all
the way down the screen." A hard ceiling on visible slots, with the oldest
evicted to history when a new one arrives over the limit.

## Design

### The unit is a slot, not a row

With grouping on, a slot is a deck; six Discord pings are one slot. With
grouping off, a slot is a row. This is why the module depends on `stacking` —
capping raw rows would put a cap of 4 nowhere near four cards of screen space.

`forkState.slotCount` is `forkState.groups.length`.

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

`Service.qml` change is hook 6 alone: one call after the insert in
`handleNotification`, plus the same call after a replay appends.

### Interaction with restore

Restoring popups after a shell restart appends rows straight to `popupModel`
outside `handleNotification`. The cap must run after the restore batch settles
too, or a crash during a burst reopens the shell with twenty toasts. Applying
it once at the end of the restore — not per row — keeps the newest, which is
what a user expects to come back to.

## Acceptance Criteria

- With `maxVisiblePopups: 3` and grouping on, twenty notifications from five
  apps leave three decks on screen.
- With grouping off, the same burst leaves three cards.
- The evicted notification is present in history immediately after eviction.
- Eviction removes the oldest slot, never the newest.
- A deck still receiving new members is not evicted before an older idle deck.
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
node --test test/popup-cap.test.js    # slot selection, critical exemption, ordering
omarchy-shell notifications setMaxVisible 3
./scripts/smoke.sh                    # count slots; check history for the evicted
for i in $(seq 1 6); do notify-send -u critical "crit $i"; done   # none evicted
omarchy-shell notifications setMaxVisible 1                       # evicts live
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
