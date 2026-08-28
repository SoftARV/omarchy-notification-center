# Implementation Plan: settings

Module `settings` from [`docs/spec/CAPABILITY-MAP.md`](../docs/spec/CAPABILITY-MAP.md).
Depends on `fork-seam`, which is merged. Spec:
[`docs/spec/SPEC-settings.md`](../docs/spec/SPEC-settings.md).
Project-wide conventions: [`docs/spec/SPEC.md`](../docs/spec/SPEC.md).

Previous module's plan and task list are archived under
[`tasks/fork-seam/`](fork-seam/plan.md).

## Overview

One place where the four knobs live — dismiss durations, visible cap, grouping,
history limit — readable and writable at runtime, surviving a shell restart,
and degrading to stock behavior when the file is missing or corrupt.

Nothing consumes these values yet. `timing`, `stacking`, `popup-cap`,
`history-store` and `center-ui` all read them, so this module is the one whose
contract has to be right before anything is built on it. Its user-visible
result is narrow on purpose: the file round-trips at version 4 and IPC can
change a value.

## What planning verified

- **The live file is at `version: 3` with `dnd: false`.** Real migration
  material, not a hypothetical. Migration will be tested against the actual
  file, and the failure mode if it goes wrong is losing a `false` — recoverable,
  which is why this is a safe place to be wrong.
- **Upstream's `parseSettings` returns `{error, dnd, legacy}` and nothing more.**
  It stays byte-identical and unused by the fork path;
  `NotificationPolicy.parseSettings` supersedes it.
- **`Service.qml` already owns the `FileView`, the 200 ms debounce timer, the
  `settingsLoaded` re-entry guard and the `_hydrating` DND guard.** All four are
  reused. The spec's "two writers on one file" risk is avoided by not opening a
  second `FileView`, and the `_hydrating` guard must survive or hydration will
  schedule a write on every startup.
- **`Service.qml` never uses `state` unqualified** — only `stateDir` and prose.
  So `id: state` would have worked; it was still renamed, see below.

## Decisions taken before planning

1. **IPC lives on its own target, `notification-settings`,** declared by an
   `IpcHandler` inside `NotificationState.qml`. It rides in on the mount hook 2
   already performs, so it costs **no further `Service.qml` hook** and no
   amendment to the approved inventory. And an upstream release adding its own
   `setDuration` to the `notifications` target cannot collide with it. This
   supersedes what `SPEC-settings.md` originally proposed; the spec is amended.
2. **The sidecar is mounted as `forkState`, not `state`.** `QQuickItem` has a
   built-in `state` property and `Service.qml`'s root is an `Item`, so `state`
   would shadow a built-in on every line that reads it. Renamed across all seven
   specs while it costs nothing but a search-and-replace.
3. **Five named setters**, not one generic `setSetting`. Each validates its own
   argument, and a typo is an unknown-function error rather than a silent no-op.

## Architecture Decisions

- **Pure logic first, wiring second.** `NotificationPolicy.js` holds every
  decision that can be made without a shell: defaults, clamping, parsing,
  serializing. It is the only part of this module that can be unit tested, so
  it is where the correctness lives, and Task 1 exists to make it airtight
  before any QML touches it.
- **Clamp, never reject.** A corrupt or hostile settings file must not cost the
  user their notifications. Every field out of range falls back to its default
  and the rest of the file still loads. The only thing a parse failure buys is
  one warning line.
- **`forkState.settings` is initialised to `defaultSettings()` at declaration.**
  Consumers read it before the file loads. Initialising to `null` and filling in
  later would make every consumer in five modules write a null guard, and one of
  them would forget.
- **Setters and IPC land in the same task.** A setter with no caller cannot be
  verified end-to-end — until `center-ui` exists, IPC is the only way to invoke
  one. Splitting them would produce a task whose completion nobody can observe.
- **Task 2 has no unit test, and the plan says so.** It is QML wiring: mounting
  a component and pointing two function bodies at it. Its logic was tested in
  Task 1; its verification is a live shell and `check-delta.sh`. Inventing a
  test that asserts a file contains a string would be theatre.

## Dependency Graph

```
T1  NotificationPolicy.js -- schema, defaults, clamp, parse, serialize
     │   (pure; the only unit-testable part of this module)
     ▼
T2  NotificationState.qml + Service.qml hooks 2 and 5
     │   the file round-trips at v4 on a live shell
     ▼
  Checkpoint A -- migration is safe
     │
     ▼
T3  Setters + settingsChanged + IpcHandler on notification-settings
     │
     ▼
  Checkpoint B -- module complete, timing/stacking/history-store unblocked
```

Strictly sequential. Each task needs the one before it to exist, and there is
nothing here worth parallelising.

## Task List

Tasks and checkpoints are in [`tasks/todo.md`](todo.md).

### Phase 1: The schema
- [ ] Task 1: `NotificationPolicy.js` — defaults, clamping, parse, serialize

### Phase 2: The round trip
- [ ] Task 2: Mount the sidecar and migrate the file to v4
- [ ] Checkpoint A

### Phase 3: Changing a value
- [ ] Task 3: Setters and the `notification-settings` IPC target
- [ ] Checkpoint B

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Migration loses the user's `dnd` value | Medium — silent, and only noticed later when DND behaves wrong | Task 1 tests migration against the real v3 shape before any QML exists; Task 2 verifies the live file specifically, and the value is `false` today so a regression is recoverable |
| Dropping upstream's `_hydrating` guard | Medium — hydration schedules a write on every startup, and the file is rewritten for no reason forever | Task 2's criteria include "starting the shell twice with no user action leaves the file's mtime unchanged the second time" |
| Dropping the `settingsLoaded` re-entry guard | Medium — `FileView` fires `onLoaded` more than once at startup, so defaults could overwrite a loaded file | Preserved verbatim; the load path is delegated, not rewritten |
| `forkState` constructed after `FileView` fires | High — a null sidecar at load time means settings silently never load | QML creates every object in a component before any `componentComplete`, so this is safe by construction; the mount is still declared early in the file, and Task 2 verifies a cold start |
| Writing v4 breaks a downgrade | Low | Upstream's `parseSettings` reads `dnd` and ignores unknown keys, so a stock omarchy reading our v4 file behaves correctly. Verified by reading upstream's parser, not assumed |
| The four knobs are stored but unread | Low, by design | `timing` is the next module and consumes two of them. Until then the acceptance criterion is the file round trip, not behavior |

## Open Questions

None blocking. The three that were open — IPC placement, the sidecar id, and
setter shape — were settled before this plan was written and are recorded above.
