# Tasks: settings

Plan: [`tasks/plan.md`](plan.md). Spec:
[`docs/spec/SPEC-settings.md`](../../docs/spec/SPEC-settings.md).
Every task also clears the project-wide Definition of Done in
[`docs/spec/SPEC.md`](../../docs/spec/SPEC.md), and commits follow the rules in
`CLAUDE.local.md` (conventional commits via the `git-commit-helper` skill,
scope `settings`).

---

## Phase 1: The schema

## Task 1: NotificationPolicy.js — defaults, clamping, parse, serialize  [DONE]

**Description:** The first sidecar file. Everything about the settings schema
that can be decided without a shell: what the defaults are, what each field's
valid range is, how a v3 or corrupt file becomes a complete v4 object, and how
that object is written back. This is the only unit-testable part of the module,
so it is where the correctness lives.

Clamp, never reject. A field out of range falls back to its default and the
rest of the file still loads — a corrupt settings file must not cost the user
their notifications.

**Acceptance criteria:**
- [x] `defaultSettings()` returns every key in the v4 schema, with upstream's current constants as values (`low: 5000`, `normal: 8000`, `critical: 0`, `maxPopupDurationMs: 30000`, `maxVisiblePopups: 4`, `groupByApp: true`, `historyLimit: 100`, `historyLastSeen: 0`)
- [x] `clampSettings(obj)` returns a complete object for any input at all — `null`, `{}`, an array, a string, wrong-typed fields — never missing a key
- [x] Every field clamps to the ranges in the spec's table; out-of-range values fall back to that field's default, not to zero
- [x] `parseSettings(raw)` migrates v3 (and the legacy `pending`/`past`/`entries` shapes) by keeping `dnd` and defaulting everything else
- [x] Invalid JSON yields full defaults and reports the error once, without throwing
- [x] `serializeSettings(obj)` round-trips: `parseSettings(serializeSettings(x))` deep-equals `clampSettings(x)`
- [x] Output is stable — same input, byte-identical output — so an unchanged settings object never produces a spurious file write

**Verification:**
- [x] `node --test "test/**/*.test.js"` → all pass, including the new `test/settings.test.js`
- [x] Tests cover the real v3 file's exact contents (`{"version":3,"dnd":false}`) as a migration fixture
- [x] Tests cover the spec's hostile example: `{"version":4,"maxVisiblePopups":9999,"groupByApp":"yes","historyLimit":-1}` → 20 / true / 1
- [x] `./scripts/check-delta.sh` → still passes (this task adds a sidecar, touching no upstream file)

**Dependencies:** None

**Files touched:**
- `NotificationPolicy.js` (new — the fork's first sidecar)
- `test/settings.test.js` (new — 24 tests)
- `docs/spec/SPEC-settings.md` (clamp table clarified, see below)

**Estimated scope:** S (3 files)

**Spec conflict found and resolved.** The clamp table said out-of-range values
fall back to the default, but the acceptance example said
`maxVisiblePopups: 9999` → 20 and `historyLimit: -1` → 1, which is clamping to
the bound. Resolved by separating the two cases: a number past a bound is a
value the user meant, so it clamps; a string or `NaN` is not a value at all, so
it falls back. The table now has a column for each, and `0`'s "never
auto-dismiss" sentinel is documented as unreachable by rounding.

**Verified against the real file**, not only fixtures: the live
`{"version":3,"dnd":false}` migrates to v4 with `dnd` intact, and a second load
of the result reports `needsRewrite: false` — proving the file will not be
rewritten on every startup.

---

## Phase 2: The round trip

## Task 2: Mount the sidecar and migrate the file to v4  [DONE]

**Description:** Create `NotificationState.qml`, mount it in `Service.qml` as
`forkState` (hook 2), and point `loadSettings`/`flushSettings` at it (hook 5).
After this the shell reads the existing v3 file, keeps its `dnd`, and writes it
back as v4 with defaults filled in.

Reuse `Service.qml`'s existing `FileView`, debounce timer, `settingsLoaded`
re-entry guard and `_hydrating` DND guard. A second `FileView` on the same path
would race the atomic write; dropping either guard causes a needless rewrite on
every startup.

`forkState.settings` is initialised to `defaultSettings()` at declaration, not
null — five modules read it before the file loads, and one of them would forget
the null guard.

**No unit test.** This is QML wiring; its logic was tested in Task 1. Verified
on a live shell and by `check-delta.sh`.

**Acceptance criteria:**
- [x] `forkState.settings` is complete and non-null from construction, before any file load
- [x] The existing v3 file migrates: `dnd` preserved, rewritten at `version: 4` with defaults
- [x] A missing file produces stock defaults and a valid v4 file, with no error in the shell log
- [x] A file of invalid JSON logs exactly one warning and yields defaults
- [x] Hooks 2 and 5 carry `// fork:` markers naming `SPEC-settings.md`
- [x] No behavior change to notifications: toasts still appear, still top-center, DND still toggles

**Verification:**
- [x] `cp ~/.local/state/omarchy/notifications.json /tmp/` first — this task rewrites real user state
- [x] `omarchy restart shell` → file becomes v4, `dnd` unchanged
- [x] `rm` the file, restart → recreated at v4 with defaults, no log error
- [x] `printf '{' > ` the file, restart → one warning, defaults, notifications still work
- [x] **Idempotence:** restart twice with no user action → the file's mtime is unchanged on the second restart (proves the `_hydrating` guard survived)
- [x] `omarchy-shell notifications toggleDnd` → still works, value persists across a restart
- [x] `./scripts/check-delta.sh` → passes, reports the new added-line count
- [x] `qmllint Service.qml NotificationState.qml` → no warning category upstream does not also report

**Dependencies:** Task 1

**Files touched:**
- `NotificationState.qml` (new)
- `Service.qml` (hooks 2 and 5 — 4 hunks, +12 lines)
- `NotificationPolicy.js` (added `dndPresent`, see below)
- `test/settings.test.js` (2 tests for it)
- `docs/spec/SPEC-fork-seam.md` (hooks recorded as spent)

**Estimated scope:** M (5 files)

**An upstream guard that would have been lost silently.** Upstream only assigns
`persisted.doNotDisturb` when the file actually carried a boolean `dnd`, because
`PersistentProperties` survives an in-process QML reload while the file may be
absent. Clamping turns a missing `dnd` into `false`, so hydrating it would have
switched DND *off* under a user who had it on. `parseSettings` now reports
`dndPresent`, and `hydrate()` returns a result shaped like upstream's — `dnd`
null when absent — which both preserves the guard and leaves upstream's
hydration block unforked.

**Under budget.** Hook 1 (an import in `Service.qml`) proved unnecessary: the
sidecar imports the policy itself. Hook 5 came in cheap for the reason above.
26 of 60 added lines used after this module's two hooks.

**Verified on a live shell**, including the destructive cases: the real v3 file
migrated with `dnd` intact, a deleted file was recreated, a corrupt file was
repaired with exactly one warning logged, and notifications kept working
throughout. DND round-tripped on → restart → on → off → restart → off.

---

## Checkpoint A: Migration is safe  [REACHED]

- [x] The real settings file survived a v3 → v4 round trip with `dnd` intact
- [x] Deleting the file and restarting reproduces stock defaults
- [x] A corrupt file does not stop notifications from working — one warning, defaults, toasts fine
- [x] Restarting twice does not rewrite the file the second time (mtime unchanged)
- [x] `node --test "test/**/*.test.js"` (65) and `./scripts/check-delta.sh` (+26/60) pass
- [x] Reviewed and approved by the user, 2026-08-28

---

## Phase 3: Changing a value

## Task 3: Setters and the notification-settings IPC target  [DONE]

**Description:** Add the five setters to `NotificationState.qml`, the
`settingsChanged` signal, and an `IpcHandler` on target
`notification-settings`. This is what makes the module observable: until
`center-ui` exists, IPC is the only way to invoke a setter, which is why they
land together.

The handler lives in the sidecar, so it costs no further `Service.qml` hook and
cannot collide with an IPC name a future upstream adds to its own
`notifications` target.

Every setter clamps before storing — arguments arrive from bash as strings and
are as untrusted as notification content.

**Acceptance criteria:**
- [x] `getSettings` returns the full current settings as JSON
- [x] `setDuration <low|normal|critical> <ms>`, `setMaxVisible`, `setGrouping`, `setHistoryLimit` each apply, clamp, and persist
- [x] Out-of-range and non-numeric arguments return `invalid` and change nothing
- [x] An unknown urgency name returns `invalid` rather than creating a key
- [x] `settingsChanged` fires after a change lands, so later modules can bind to it
- [x] Ten setter calls in one second produce exactly one file write (the 200 ms debounce)
- [x] Values survive `omarchy restart shell`
- [x] The existing `notifications` IPC target is untouched — `dndState`, `showHistory`, `dismissAll` and the rest still work

**Verification:**
- [x] `omarchy-shell notification-settings getSettings` → full JSON
- [x] `omarchy-shell notification-settings setMaxVisible 2` → `ok`; `... setMaxVisible 9999` → clamps to 20; `... setMaxVisible abc` → `invalid`
- [x] `omarchy-shell notification-settings setDuration normal 20000` → `ok`; `... setDuration bogus 5000` → `invalid`
- [x] Loop ten `setMaxVisible` calls, watch the file's mtime → one write
- [x] `omarchy restart shell && omarchy-shell notification-settings getSettings` → values persisted
- [x] `omarchy-shell notifications ping` → still `ok` (upstream's target intact)
- [x] `node --test "test/**/*.test.js"` and `./scripts/check-delta.sh` pass

**Dependencies:** Task 2

**Files touched:**
- `NotificationState.qml` (setters + `IpcHandler`; root type changed, see below)
- `NotificationPolicy.js` (`parseCountArg`, `parseBoolArg`, `isUrgencyName`, `withSetting`)
- `test/settings.test.js` (8 more tests)
- `docs/spec/SPEC-settings.md` (AC conflict resolved)

**Estimated scope:** S (4 files). No `Service.qml` change at all — the IPC rode
in on the mount hook 2 already performed, exactly as the plan predicted.

**Root type changed from `QtObject` to `Item`.** `QtObject` has no default
property, so a nested `IpcHandler` cannot be declared inside one, and every
`IpcHandler` in the omarchy shell lives in an `Item`. It stays non-visual — no
size, no anchors — like the `Process`, `Timer` and `FileView` children upstream
already keeps in its own root `Item`.

**Second AC conflict in this spec.** The criteria said out-of-range arguments
"return `invalid` and change nothing", while the verification line said
`setMaxVisible 9999` clamps to 20. Resolved the same way as Task 1's: a number
past a bound is a value the user meant, so it clamps and returns `ok`; a
non-number is not a value, so it returns `invalid` and changes nothing.

**The debounce was verified by counting, not by inference.** A changed mtime
only proves *a* write. `inotifywait` over ten rapid setter calls recorded
exactly one `MOVED_TO` — one atomic write, as specified.

---

## Checkpoint B: Module complete  [REACHED]

- [x] Every acceptance criterion in `docs/spec/SPEC-settings.md` is met
- [x] `node --test "test/**/*.test.js"` passes — 78 tests
- [x] `./scripts/check-delta.sh` passes at `+20/60`
- [x] `qmllint` reports no warning category upstream does not also report
- [x] `git merge upstream` is a no-op
- [x] `./install.sh` ships the new sidecar files and nothing from `test/ docs/ scripts/ tasks/`
- [x] Notifications, DND and history all still work on a live shell
- [x] Settings reset to defaults after testing, so no test value was left behind
- [x] Reviewed and approved by the user, 2026-08-28; `timing`, `stacking` and `history-store` are unblocked

**settings is complete.** The four knobs persist, clamp, survive a restart, and
are reachable from the shell. Nothing reads them yet — `timing` is next and
consumes two.
