# Spec: history-store

Module id `history-store`. Depends on `settings`. Provides the history model,
revision counter and unread count consumed by `center-ui`.

## Objective

Make history *readable*. Today `historyDir` is a directory of JSON files with
no reader: `showRecentHistory()` replays it onto the screen as toasts and that
is the only way to see it. The center needs a list it can render, a count it
can badge, and a clear it can call.

## Design

### Storage stays exactly as upstream built it

One JSON file per entry under
`~/.local/state/omarchy/notifications/history/`, trimmed to the newest
`historyLimit` by the existing `trimHistoryScript`, with persisted image copies
under `images/` living and dying with their entry's file stem. None of that
changes. This module adds a reader.

`historyLimit` becomes settings-driven. Upstream already passes it as an
argument (`String(historyLimit)` in `archivePopupFileFor`), so the change is
hook 4: one property binding. Default rises from 10 to 100.

Raising the limit costs a hundred small files per read and a hundred-file trim
per archive. Both are already off the UI thread on the serialized
`popupFileQueue`. The trim script's cost is what to watch at 500.

### Reading

`forkState.historyModel` — a `ListModel` with the same roles as `popupModel`,
newest first. Populated by a read through the existing `popupFileQueue`, using
upstream's own `awk 1 "$1"/*.json` pattern (`awk`, not `cat`, so a torn file
missing its trailing newline cannot glue itself onto the next).

The read is **lazy and on demand**: the model is empty until something asks. A
service that keeps a hundred parsed entries resident for a panel nobody opened
is wasted memory. `forkState.loadHistory()` triggers it; `center-ui` calls it when
the panel opens.

### Change notification without a file watcher

The service is the only writer, so it can say when it wrote:
`forkState.historyRevision`, an integer bumped after each archive job and after a
clear (hooks 8 and 9). Readers compare the revision they rendered against the
current one and re-read when it differs and they are visible.

A `FileView` watcher on the directory would fire mid-write, on every one of a
hundred files, and on the service's own writes. A counter the writer owns is
both cheaper and correct.

### Unread count

`historyLastSeen` (a millisecond timestamp in `notifications.json`, owned by
this module, stored by `settings`) marks the last time the user looked.

`forkState.unreadCount` is the number of history entries with
`timestamp > historyLastSeen`. `forkState.markHistorySeen()` sets it to `Date.now()`
and zeroes the count.

Counting requires knowing the entries, which the lazy model does not hold
before the first open. So the count is maintained incrementally instead: the
archive hook increments a persisted counter, and `markHistorySeen()` resets it.
The model, once loaded, reconciles the counter against the real timestamps.
Incremental-plus-reconcile avoids reading a hundred files just to draw a badge.

### Clearing

`clearHistory()` exists upstream and already removes both the JSON files and
their orphaned image copies. This module adds: bump the revision, clear
`historyModel`, and call `markHistorySeen()` — an empty history with a non-zero
unread badge is a bug the user cannot clear.

### Runtime interface (the contract `center-ui` consumes)

```qml
forkState.historyModel          // ListModel, newest first, popupModel roles
forkState.historyRevision       // int, bumped on any history write
forkState.unreadCount           // int
forkState.loadHistory()         // async; populates historyModel
forkState.markHistorySeen()     // zeroes unreadCount, persists the timestamp
forkState.clearHistory()        // wraps the service's, then bumps and resets
forkState.invokeHistoryEntry(originalId, timestamp)   // runs a stored execArgv
```

`invokeHistoryEntry` runs the entry's persisted `execArgv` through
`Util.execArgv` after `NotificationLogic.parseExecArgv` validates it — the same
structural, fail-closed validation the live toast path uses, reused rather than
reimplemented. History entries have no live sender, so there is no libnotify
action and no focus fallback: an entry with no valid `execArgv` does nothing.

## Acceptance Criteria

- `loadHistory()` populates `historyModel` newest-first with every field a card
  needs to render, including the persisted image path.
- An empty history directory yields an empty model and no error.
- A truncated or invalid JSON file is skipped; the rest of the history still
  loads.
- `historyRevision` increases after an archive and after a clear.
- `unreadCount` rises by one per archived notification and returns to zero
  after `markHistorySeen()`, surviving a shell restart.
- `clearHistory()` empties the model, the directory, the orphaned images and
  the unread count together.
- Setting `historyLimit` to 25 trims the directory to 25 on the next archive.
- `invokeHistoryEntry` runs a valid stored `execArgv` and does nothing at all
  for a malformed one — no shell interpretation, ever.
- Reading 100 entries does not block the UI thread.

## Verification

```sh
node --test test/history-store.test.js   # parse, ordering, skip-bad-file, unread math
notify-send a; notify-send b             # let them expire
ls ~/.local/state/omarchy/notifications/history/
printf 'garbage' > ~/.local/state/omarchy/notifications/history/bad.json
# open the center: the good entries still list
omarchy-shell notifications clear && ls ~/.local/state/omarchy/notifications/history/
omarchy restart shell                    # unread count survives
```

## Risks

- **Unread drift.** An incremental counter and the real timestamps can disagree
  after a crash mid-write. The reconcile on model load is the correction; the
  badge may be briefly wrong until the panel is opened, which is acceptable for
  a count.
- **Trim cost at a large limit.** The trim script runs per archive. At
  `historyLimit: 500` and a heavy burst this is the first thing to profile.
- **Image lifetime.** Entries reference persisted copies keyed by file stem.
  Raising the limit raises the image count proportionally; upstream's
  `sweepOrphanImages` is what keeps it honest and must keep running at startup.
