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

**Out of range is not the same as invalid.** A number past a bound is a value
the user meant — 9999 visible popups is an ambition, not a typo — so it clamps
to the bound. A string, a `NaN` or an `Infinity` is not a value at all, so it
falls back to the default. Collapsing the two would turn one bad character in a
hand-edited file into a setting the user never chose and cannot see.

| Field | Range | Out of range | Invalid type |
|---|---|---|---|
| `popupDurationMs.*` | 0, or 500–300000 | nearest bound | that urgency's default |
| `maxPopupDurationMs` | 1000–300000 | nearest bound | 30000 |
| `maxVisiblePopups` | 1–20 | nearest bound | 4 |
| `groupByApp` | boolean | — | true |
| `historyLimit` | 1–500 | nearest bound | 100 |
| `historyLastSeen` | finite ≥ 0 | 0 | 0 |

`0` is the sentinel for "never auto-dismiss" and nothing rounds into it: a 1 ms
duration is a mistake, and reading it as "never" would be the opposite of what
was asked. It clamps up to 500.

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

  `parseSettings` returns `{ error, errorMessage, settings, needsRewrite }`.
  `needsRewrite` answers "does the file on disk differ from what we would write
  now", which covers a v3 document, a legacy payload, an out-of-range value and
  a whitespace edit in one comparison. It is derived from the serialized form
  rather than from a version number, so an already-canonical file is never
  rewritten on startup.
- **`NotificationState.qml`** — a QtObject mounted in `Service.qml` (hook 2)
  holding `property var settings`, a `settingsChanged` signal, and the setter
  functions. It reuses the service's existing `FileView`, save timer and
  `_hydrating` guard rather than opening a second handle on the file.
- **`Service.qml`** — hooks 2 and 5 only: mount `NotificationState`, and point
  `loadSettings`/`flushSettings` bodies at it.

### Runtime interface (the contract other modules consume)

```qml
forkState.settings                       // clamped, always complete, never null
forkState.settingsChanged()              // emitted after any change lands
forkState.setDuration(urgencyName, ms)   // "low" | "normal" | "critical"
forkState.setMaxVisible(n)
forkState.setGrouping(on)
forkState.setHistoryLimit(n)
```

Every setter clamps, writes through to `forkState.settings`, emits
`settingsChanged`, and calls the existing debounced save. Changes apply to the
next notification with no restart; the 200ms debounce means a slider drag
writes once.

### IPC

On its own target, `notification-settings`, declared by an `IpcHandler` inside
`NotificationState.qml`:

```
notification-settings getSettings                 -> JSON string
notification-settings setDuration <urgency> <ms>  -> "ok" | "invalid"
notification-settings setMaxVisible <n>           -> "ok" | "invalid"
notification-settings setGrouping <on|off>        -> "ok" | "invalid"
notification-settings setHistoryLimit <n>         -> "ok" | "invalid"
```

Not added to upstream's `notifications` target, for two reasons. It rides in on
the mount that hook 2 already performs, so it costs no further `Service.qml`
hook and no amendment to the inventory. And an upstream release adding its own
`setDuration` to `notifications` would then be a merge conflict over a name;
on a separate target it cannot be.

Every argument arrives as a string from bash and is coerced and clamped like
any other untrusted input.

## Acceptance Criteria

- A missing `notifications.json` produces stock defaults and a valid v4 file on
  first write, with no error in the shell log.
- An existing v3 file keeps its `dnd` value through migration and is rewritten
  at version 4.
- `{"version":4,"maxVisiblePopups":9999,"groupByApp":"yes","historyLimit":-1}`
  clamps to 20 / true / 1 and logs no error.
- An IPC setter follows the same rule: an out-of-range number clamps and returns
  `ok`, a non-number returns `invalid` and changes nothing.
- A file of invalid JSON logs exactly one warning and yields full defaults.
- A setter's effect is visible on the next notification without a shell restart.
- Ten setter calls in one second produce one file write.
- `forkState.settings` is never null and never missing a key, at any point during
  startup — consumers may read it unconditionally.

## Verification

```sh
node --test test/settings.test.js
rm ~/.local/state/omarchy/notifications.json && omarchy restart shell
notify-send hi && cat ~/.local/state/omarchy/notifications.json   # v4, defaults
omarchy-shell notification-settings setMaxVisible 2
omarchy-shell notification-settings getSettings
printf '{' > ~/.local/state/omarchy/notifications.json && omarchy restart shell  # one warning, defaults
```

## Risks

- **Two writers on one file.** `NotificationState` must go through the
  service's existing `FileView` and save timer. A second `FileView` on the same
  path would race the atomic write and could lose `dnd`.
- **Startup ordering.** Consumers read `forkState.settings` before the file loads.
  Initializing it to `defaultSettings()` at construction — not null — is what
  makes the "never null" criterion hold, and it must be done at declaration.
- **Schema churn.** Bumping to v5 later costs another migration path. The
  fields above are chosen to cover all five asks so that one bump suffices.
