# Tasks: settings

Plan: [`tasks/plan.md`](plan.md). Spec:
[`docs/spec/SPEC-settings.md`](../docs/spec/SPEC-settings.md).
Every task also clears the project-wide Definition of Done in
[`docs/spec/SPEC.md`](../docs/spec/SPEC.md), and commits follow the rules in
`CLAUDE.local.md` (conventional commits via the `git-commit-helper` skill,
scope `settings`).

---

## Phase 1: The schema

## Task 1: NotificationPolicy.js — defaults, clamping, parse, serialize

**Description:** The first sidecar file. Everything about the settings schema
that can be decided without a shell: what the defaults are, what each field's
valid range is, how a v3 or corrupt file becomes a complete v4 object, and how
that object is written back. This is the only unit-testable part of the module,
so it is where the correctness lives.

Clamp, never reject. A field out of range falls back to its default and the
rest of the file still loads — a corrupt settings file must not cost the user
their notifications.

**Acceptance criteria:**
- [ ] `defaultSettings()` returns every key in the v4 schema, with upstream's current constants as values (`low: 5000`, `normal: 8000`, `critical: 0`, `maxPopupDurationMs: 30000`, `maxVisiblePopups: 4`, `groupByApp: true`, `historyLimit: 100`, `historyLastSeen: 0`)
- [ ] `clampSettings(obj)` returns a complete object for any input at all — `null`, `{}`, an array, a string, wrong-typed fields — never missing a key
- [ ] Every field clamps to the ranges in the spec's table; out-of-range values fall back to that field's default, not to zero
- [ ] `parseSettings(raw)` migrates v3 (and the legacy `pending`/`past`/`entries` shapes) by keeping `dnd` and defaulting everything else
- [ ] Invalid JSON yields full defaults and reports the error once, without throwing
- [ ] `serializeSettings(obj)` round-trips: `parseSettings(serializeSettings(x))` deep-equals `clampSettings(x)`
- [ ] Output is stable — same input, byte-identical output — so an unchanged settings object never produces a spurious file write

**Verification:**
- [ ] `node --test "test/**/*.test.js"` → all pass, including the new `test/settings.test.js`
- [ ] Tests cover the real v3 file's exact contents (`{"version":3,"dnd":false}`) as a migration fixture
- [ ] Tests cover the spec's hostile example: `{"version":4,"maxVisiblePopups":9999,"groupByApp":"yes","historyLimit":-1}` → 20 / true / 1
- [ ] `./scripts/check-delta.sh` → still passes (this task adds a sidecar, touching no upstream file)

**Dependencies:** None

**Files likely touched:**
- `NotificationPolicy.js` (new)
- `test/settings.test.js` (new)

**Estimated scope:** S (2 files)

---

## Phase 2: The round trip

## Task 2: Mount the sidecar and migrate the file to v4

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
- [ ] `forkState.settings` is complete and non-null from construction, before any file load
- [ ] The existing v3 file migrates: `dnd` preserved, rewritten at `version: 4` with defaults
- [ ] A missing file produces stock defaults and a valid v4 file, with no error in the shell log
- [ ] A file of invalid JSON logs exactly one warning and yields defaults
- [ ] Hooks 2 and 5 carry `// fork:` markers naming `SPEC-settings.md`
- [ ] No behavior change to notifications: toasts still appear, still top-center, DND still toggles

**Verification:**
- [ ] `cp ~/.local/state/omarchy/notifications.json /tmp/` first — this task rewrites real user state
- [ ] `omarchy restart shell` → file becomes v4, `dnd` unchanged
- [ ] `rm` the file, restart → recreated at v4 with defaults, no log error
- [ ] `printf '{' > ` the file, restart → one warning, defaults, notifications still work
- [ ] **Idempotence:** restart twice with no user action → the file's mtime is unchanged on the second restart (proves the `_hydrating` guard survived)
- [ ] `omarchy-shell notifications toggleDnd` → still works, value persists across a restart
- [ ] `./scripts/check-delta.sh` → passes, reports the new added-line count
- [ ] `qmllint Service.qml NotificationState.qml` → no warning category upstream does not also report

**Dependencies:** Task 1

**Files likely touched:**
- `NotificationState.qml` (new)
- `Service.qml` (hooks 2 and 5)
- `docs/spec/SPEC-fork-seam.md` (record the hooks as spent)

**Estimated scope:** S (3 files)

---

## Checkpoint A: Migration is safe

- [ ] The real settings file survived a v3 → v4 round trip with `dnd` intact
- [ ] Deleting the file and restarting reproduces stock defaults
- [ ] A corrupt file does not stop notifications from working
- [ ] Restarting twice does not rewrite the file the second time
- [ ] `node --test "test/**/*.test.js"` and `./scripts/check-delta.sh` pass
- [ ] Review with human before proceeding

---

## Phase 3: Changing a value

## Task 3: Setters and the notification-settings IPC target

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
- [ ] `getSettings` returns the full current settings as JSON
- [ ] `setDuration <low|normal|critical> <ms>`, `setMaxVisible`, `setGrouping`, `setHistoryLimit` each apply, clamp, and persist
- [ ] Out-of-range and non-numeric arguments return `invalid` and change nothing
- [ ] An unknown urgency name returns `invalid` rather than creating a key
- [ ] `settingsChanged` fires after a change lands, so later modules can bind to it
- [ ] Ten setter calls in one second produce exactly one file write (the 200 ms debounce)
- [ ] Values survive `omarchy restart shell`
- [ ] The existing `notifications` IPC target is untouched — `dndState`, `showHistory`, `dismissAll` and the rest still work

**Verification:**
- [ ] `omarchy-shell notification-settings getSettings` → full JSON
- [ ] `omarchy-shell notification-settings setMaxVisible 2` → `ok`; `... setMaxVisible 9999` → clamps to 20; `... setMaxVisible abc` → `invalid`
- [ ] `omarchy-shell notification-settings setDuration normal 20000` → `ok`; `... setDuration bogus 5000` → `invalid`
- [ ] Loop ten `setMaxVisible` calls, watch the file's mtime → one write
- [ ] `omarchy restart shell && omarchy-shell notification-settings getSettings` → values persisted
- [ ] `omarchy-shell notifications ping` → still `ok` (upstream's target intact)
- [ ] `node --test "test/**/*.test.js"` and `./scripts/check-delta.sh` pass

**Dependencies:** Task 2

**Files likely touched:**
- `NotificationState.qml`
- `test/settings.test.js` (argument coercion cases)
- `docs/spec/SPEC-settings.md` (tick the delivered interface)

**Estimated scope:** S (3 files)

---

## Checkpoint B: Module complete

- [ ] Every acceptance criterion in `docs/spec/SPEC-settings.md` is met
- [ ] `node --test "test/**/*.test.js"` passes
- [ ] `./scripts/check-delta.sh` passes and is still within budget
- [ ] `qmllint` reports no warning category upstream does not also report
- [ ] `git merge upstream` is a no-op
- [ ] `./install.sh` ships the new sidecar files and nothing from `test/ docs/ scripts/ tasks/`
- [ ] Notifications, DND and history all still work on a live shell
- [ ] Ready for review; `timing`, `stacking` and `history-store` are unblocked
