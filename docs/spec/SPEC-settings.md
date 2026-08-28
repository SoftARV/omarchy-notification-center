# Spec: settings

Module id `settings`. Depends on `fork-seam`. Provides the resolved settings
object consumed by every other module.

## Objective

One place where the four knobs live, readable and writable at runtime, surviving
a shell restart, and degrading to stock behavior when the file is missing or
corrupt.

Upstream already persists exactly one preference (`dnd`) in
`~/.local/state/omarchy/notifications.json` at `version: 3`, atomically, through
a debounced save timer. This module widens that file rather than inventing a
second one.

## Design

### Schema — `notifications.json` version 4

```json
{
  "version": 4,
  "dnd": false,
  "popupDurationMs": { "low": 5000, "normal": 8000, "critical": 0 },
  "maxPopupDurationMs": 30000,
  "maxVisiblePopups": 4,
  "groupByApp": true,
  "historyLimit": 100,
  "historyLastSeen": 0
}
```

Defaults are upstream's current constants, so a user who never opens the panel
sees no behavior change except the new cap and grouping — which are the point.

- `popupDurationMs.critical: 0` preserves upstream's "critical never
  auto-dismisses". A user may set it non-zero.
- `historyLastSeen` is a millisecond timestamp owned by `history-store` for the
  unread count. It lives here because it is user state that must survive a
  restart, not because settings cares about it.

### Validation

Every field is clamped, never rejected. A corrupt file must not cost the user
their notifications.

| Field | Range | On invalid |
|---|---|---|
| `popupDurationMs.*` | 0 or 500–300000 | that urgency's default |
| `maxPopupDurationMs` | 1000–300000 | 30000 |
| `maxVisiblePopups` | 1–20 | 4 |
| `groupByApp` | boolean | true |
| `historyLimit` | 1–500 | 100 |
| `historyLastSeen` | finite ≥ 0 | 0 |

A whole-file parse failure logs one warning and yields defaults, matching
upstream's `parseSettings` behavior.

### Migration

`version: 3` (or absent, or the pre-3 `entries`/`pending`/`past` shapes upstream
already flags as `legacy`) is read for `dnd` only; every other field takes its
default and the file is rewritten at version 4. Downgrade is not supported — an
older shell reading a v4 file finds the `dnd` key it expects and ignores the
rest, which is the only compatibility that matters.

### Where the code lives

- **`NotificationPolicy.js`** — `parseSettings(raw)`, `defaultSettings()`,
  `clampSettings(obj)`, `serializeSettings(obj)`. Pure, fully unit-tested.
  Upstream's `NotificationLogic.parseSettings` is left untouched and unused by
  the fork path.
- **`NotificationState.qml`** — a QtObject mounted in `Service.qml` (hook 2)
  holding `property var settings`, a `settingsChanged` signal, and the setter
  functions. It reuses the service's existing `FileView`, save timer and
  `_hydrating` guard rather than opening a second handle on the file.
- **`Service.qml`** — hooks 2 and 5 only: mount `NotificationState`, and point
  `loadSettings`/`flushSettings` bodies at it.

### Runtime interface (the contract other modules consume)

```qml
state.settings                       // clamped, always complete, never null
state.settingsChanged()              // emitted after any change lands
state.setDuration(urgencyName, ms)   // "low" | "normal" | "critical"
state.setMaxVisible(n)
state.setGrouping(on)
state.setHistoryLimit(n)
```

Every setter clamps, writes through to `state.settings`, emits
`settingsChanged`, and calls the existing debounced save. Changes apply to the
next notification with no restart; the 200ms debounce means a slider drag
writes once.

### IPC

Added to the existing `notifications` target. Adding IPC names is *ask first*
per `SPEC.md`; these are proposed, not assumed:

```
notifications getSettings            -> JSON string
notifications setDuration <urgency> <ms>  -> "ok" | "invalid"
notifications setMaxVisible <n>      -> "ok" | "invalid"
notifications setGrouping <on|off>   -> "ok" | "invalid"
notifications setHistoryLimit <n>    -> "ok" | "invalid"
```

Every argument arrives as a string from bash and is coerced and clamped like
any other untrusted input.

## Acceptance Criteria

- A missing `notifications.json` produces stock defaults and a valid v4 file on
  first write, with no error in the shell log.
- An existing v3 file keeps its `dnd` value through migration and is rewritten
  at version 4.
- `{"version":4,"maxVisiblePopups":9999,"groupByApp":"yes","historyLimit":-1}`
  clamps to 20 / true / 1 and logs no error.
- A file of invalid JSON logs exactly one warning and yields full defaults.
- A setter's effect is visible on the next notification without a shell restart.
- Ten setter calls in one second produce one file write.
- `state.settings` is never null and never missing a key, at any point during
  startup — consumers may read it unconditionally.

## Verification

```sh
node --test test/settings.test.js
rm ~/.local/state/omarchy/notifications.json && omarchy restart shell
notify-send hi && cat ~/.local/state/omarchy/notifications.json   # v4, defaults
omarchy-shell notifications setMaxVisible 2 && omarchy-shell notifications getSettings
printf '{' > ~/.local/state/omarchy/notifications.json && omarchy restart shell  # one warning, defaults
```

## Risks

- **Two writers on one file.** `NotificationState` must go through the
  service's existing `FileView` and save timer. A second `FileView` on the same
  path would race the atomic write and could lose `dnd`.
- **Startup ordering.** Consumers read `state.settings` before the file loads.
  Initializing it to `defaultSettings()` at construction — not null — is what
  makes the "never null" criterion hold, and it must be done at declaration.
- **Schema churn.** Bumping to v5 later costs another migration path. The
  fields above are chosen to cover all five asks so that one bump suffices.
