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
newest first. Populated by a `Process` the sidecar owns, using upstream's own
`awk 1 "$1"/*.json` pattern (`awk`, not `cat`, so a torn file missing its
trailing newline cannot glue itself onto the next).

The read does **not** go through `popupFileQueue`. It cannot: that queue's
`Process` has no `StdioCollector`, so it is physically unable to carry output.
The alternative — hooking upstream's `readHistoryProc` and dispatching on a mode
flag — would entangle the model read with the `showHistory` replay path, which
already juggles `replayCarryOver` state, and cost hooks for no gain.

Reading outside the queue can race a write, and the race is self-healing. A
popup archived into history arrives by `mv`, which is atomic. A DND-silenced
entry is written with `printf`, which is not, so a concurrent read may see a
torn file — and invalid entries are skipped by design. Any write bumps
`historyRevision`, so a reader re-reads once the write has finished.

The model is **loaded once at startup and refreshed on demand**, not lazily.
The lazy design was chosen to save memory, and the memory is negligible — a
hundred entries is roughly 50 KB. Keeping it warm means `center-ui` opens with
content rather than flickering through an empty panel, and it makes the IPC
usable: a read is a subprocess, and IPC cannot wait on one, so a lazily-loaded
model would return empty on its first query.

`forkState.loadHistory()` refreshes it; `center-ui` calls it when the panel
opens, and the revision counter drives it otherwise. `list` returns the last
completed read, so a query issued immediately after a write may be one behind.

### Change notification without a file watcher

The service is the only writer, so it can say when it wrote:
`forkState.historyRevision`, an integer bumped after every job that creates or
removes a history file. Readers compare the revision they rendered against the
current one and re-read when it differs and they are visible.

**Two functions create a history entry**, not one: `archivePopupFileFor` when a
popup leaves the screen, and `writeHistoryFile` when DND silences a notification
before it ever appears. Both carry the hook. Covering only the first would mean
the indicator stays dark for exactly the notifications the user missed while
away, which is the case it exists for.

A `FileView` watcher on the directory would fire mid-write, on every one of a
hundred files, and on the service's own writes. A counter the writer owns is
both cheaper and correct.

### Unread indicator

`historyLastSeen` (a millisecond timestamp in `notifications.json`, owned by
this module, stored by `settings`) marks the last time the user looked.

`forkState.hasUnread` is a **boolean**, not a count: the bar shows a dot on the
bell when something has arrived since, and the dot clears when the center is
opened. A number there would be clutter — the useful signal is "there is
something to look at", and the list itself says how much.

History files are named `<timestamp>-<id>.json`, so the question "is anything
newer than `historyLastSeen`" is answered by the filenames alone — no JSON
parsing, no entries held in memory, and correct immediately after a restart
without loading anything. It short-circuits on the first match.

`forkState.markHistorySeen()` sets `historyLastSeen` to `Date.now()` through the
settings setter, which persists it, and clears the flag.

### Clearing

`clearHistory()` exists upstream and already removes both the JSON files and
their orphaned image copies. This module adds: bump the revision, clear
`historyModel`, and call `markHistorySeen()` — an empty history with a lit
unread dot is a bug the user cannot clear.

### Runtime interface (the contract `center-ui` consumes)

```qml
forkState.historyModel          // ListModel, newest first, popupModel roles
forkState.historyRevision       // int, bumped on any history write
forkState.hasUnread             // bool -- something arrived since historyLastSeen
forkState.loadHistory()         // async; populates historyModel
forkState.markHistorySeen()     // clears hasUnread, persists the timestamp
forkState.clearHistory()        // wraps the service's, then bumps and clears
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
- `historyRevision` increases after an archive, after a DND-silenced write, and
  after a clear.
- `hasUnread` becomes true when a notification reaches history and false after
  `markHistorySeen()`, and is correct immediately after a shell restart without
  loading the model.
- `clearHistory()` empties the model, the directory, the orphaned images and the
  unread flag together.
- Setting `historyLimit` to 25 trims the directory to 25 on the next archive.
- `invokeHistoryEntry` runs a valid stored `execArgv` and does nothing at all
  for a malformed one — no shell interpretation, ever.
- Reading 100 entries does not block the UI thread.

## Verification

```sh
node --test "test/**/*.test.js"          # parse, ordering, skip-bad-file, unread
notify-send a; notify-send b             # let them expire
ls ~/.local/state/omarchy/notifications/history/
printf 'garbage' > ~/.local/state/omarchy/notifications/history/bad.json
# open the center: the good entries still list
omarchy-shell notifications clear && ls ~/.local/state/omarchy/notifications/history/
omarchy restart shell                    # unread count survives
```

## Risks

- **A read can race a write.** Deliberate, and self-healing: `mv` is atomic,
  torn files are skipped, and the revision bump prompts a re-read. The cost is
  an entry briefly missing from an open panel.
- **Trim cost at a large limit.** The trim script runs per archive. At
  `historyLimit: 500` and a heavy burst this is the first thing to profile.
- **Image lifetime.** Entries reference persisted copies keyed by file stem.
  Raising the limit raises the image count proportionally; upstream's
  `sweepOrphanImages` is what keeps it honest and must keep running at startup.
