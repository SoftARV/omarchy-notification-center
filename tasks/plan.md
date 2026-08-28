# Implementation Plan: history-store

Module `history-store` from [`docs/spec/CAPABILITY-MAP.md`](../docs/spec/CAPABILITY-MAP.md).
Depends on `settings`, which is merged. Spec:
[`docs/spec/SPEC-history-store.md`](../docs/spec/SPEC-history-store.md).

Earlier task lists are archived under [`tasks/fork-seam/`](fork-seam/plan.md),
[`tasks/settings/`](settings/plan.md) and [`tasks/timing/`](timing/plan.md).

## Overview

Make history readable. The directory has existed since upstream; nothing can
read it. `showRecentHistory()` replays it onto the screen as toasts, and that is
the only way to see what arrived.

This module adds a reader, a change signal, an unread indicator and a way to run
a stored action — the whole contract `center-ui` consumes. It is the last module
`center-ui` waits on.

## What planning verified

- **Two functions create a history entry**, not one. `archivePopupFileFor` moves
  a popup that left the screen; `writeHistoryFile` records a DND-silenced
  notification that never appeared. The inventory listed only the first.
  Hooking only it would leave the indicator dark for exactly the notifications
  the user missed while away.
- **The file queue physically cannot carry a read.** `popupFileProc` has an
  `onExited` handler and no `StdioCollector`, so the spec's "read through the
  existing `popupFileQueue`" was not implementable as written.
- **History filenames are `<timestamp>-<id>.json`.** Confirmed against
  `popupFileName()`, which builds them from the entry's timestamp and originalId.
  That is what makes the unread check a filename comparison rather than a parse.
- **`trimHistoryScript` sorts numerically on those names**, so raising
  `historyLimit` needs no change to the trim itself — only the number passed in.
- **`historyLastSeen` already exists in the v4 schema**, clamped and persisted,
  so the unread indicator needs no schema change.

## Decisions taken before planning

1. **The sidecar owns its own read `Process`.** Zero `Service.qml` hooks for
   reading. A read racing a write is self-healing: `mv` is atomic, torn files
   are skipped by design, and a revision bump prompts a re-read.
2. **`hasUnread` is a boolean, not a count.** The bar gets a dot, not a number —
   the useful signal is "there is something to look at", and the list says how
   much. This replaces the spec's incremental counter, which would have read
   zero after a restart in contradiction of its own criterion, and it removes
   the "unread drift" risk entirely. Filenames answer the question directly:
   is any leading timestamp greater than `historyLastSeen`.
3. **Hook 8 covers both writers.** Inventory amended, budget 2 → 4 lines.
4. **A `notification-history` IPC target**, following the pattern approved for
   `settings`. It costs no `Service.qml` hook and makes every criterion
   verifiable now rather than after `center-ui`.

## Architecture Decisions

- **The unread check never parses JSON.** It compares the leading number in each
  filename against `historyLastSeen` and short-circuits on the first match.
  Cheap enough to run at startup, exact immediately, and impossible to drift.
- **Parsing is pure and lives in `NotificationPolicy.js`.** Turning the `awk`
  output into ordered, validated rows is the testable part; the `Process` and
  the `ListModel` are the untestable part. The split is what lets the risky
  logic — skipping a torn file without losing the rest — be tested properly.
- **`invokeHistoryEntry` reuses `NotificationLogic.parseExecArgv`.** The same
  fail-closed, structural validation the live toast path uses. A history entry
  has no live sender, so there is no libnotify action and no focus fallback: an
  entry with no valid `execArgv` does nothing at all.
- **Slices are vertical against IPC.** Each task ends with something observable
  from the shell, which is why the IPC target was worth asking for.

## Dependency Graph

```
T1  history parsing + unread predicate  (pure, unit tested)
     │
     ▼
T2  historyModel + loadHistory + `notification-history list`
     │
     ▼
T3  revision counter + hasUnread + markSeen   (hooks 4, 8x2, 9)
     │
     ▼
  Checkpoint A -- the store is readable and reports change
     │
     ▼
T4  clearHistory wrapper + invokeHistoryEntry
     │
     ▼
  Checkpoint B -- module complete, center-ui unblocked
```

Sequential: each task needs the previous one's surface to be observable.

## Task List

Tasks and checkpoints are in [`tasks/todo.md`](todo.md).

### Phase 1: Reading
- [ ] Task 1: history parsing and the unread predicate
- [ ] Task 2: the model, and `notification-history list`

### Phase 2: Change and unread
- [ ] Task 3: revision counter, `hasUnread`, `markSeen`
- [ ] Checkpoint A

### Phase 3: Acting on an entry
- [ ] Task 4: `clear` and `invoke`
- [ ] Checkpoint B

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `invokeHistoryEntry` runs attacker-influenced argv | **Highest in the project** — a notification body is attacker-controlled, and this path ends in process execution | Reuse `NotificationLogic.parseExecArgv` unchanged; never build a shell string; `Util.execArgv` only. Task 4 tests a malformed hint, a leading-dash program and a non-array, and confirms nothing runs |
| One torn file loses the whole history | High — a panel that shows nothing after a crash | Parsing skips invalid entries individually. Tested with a truncated file between two good ones |
| A read races a write | Low, and self-healing | `mv` is atomic; torn files are skipped; the revision bump prompts a re-read. Accepted deliberately, see decision 1 |
| The unread dot lies after a restart | Medium — the feature exists for the case where you were away | Filenames answer it without loading anything. Verified by restarting with unread entries present |
| Raising `historyLimit` to 100 slows the trim | Low now, worth watching | The trim runs per archive on the serialized queue, off the UI thread. Timed during Task 3 with a full directory |
| `Util` unreachable from the sidecar | Would block Task 4 | `qs.Commons` is a shell-provided singleton import; `Service.qml` uses it. Verified early in Task 4 rather than assumed |

## Open Questions

None blocking. `SPEC.md` open question 2 — what `showHistory` should do now a
center exists — belongs to `popup-cap` and stays open; this module does not
change that path.
