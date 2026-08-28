# Spec: nec.notifications

Project-wide specification. The six core areas below are shared by every module
in `CAPABILITY-MAP.md`; each module's own spec covers only its objective,
design, acceptance criteria and risks.

## Assumptions

These were filled in from the codebase and the answered clarifying questions.
Correct any of them and the affected module specs change.

1. Everything ships inside the existing `nec.notifications` plugin. The center
   is a `bar-widget` entry point added to this manifest, not a second plugin.
2. The bar widget reaches the running service in-process via
   `bar?.shell?.serviceFor("nec.notifications")`. Verified against
   `shell.qml:275` (`serviceFor` accepts any plugin id, not just first-party)
   and the `omarchy.media` widget, which uses exactly this pattern. No file
   polling or D-Bus round-trip between widget and service.
3. Settings persist in the existing `~/.local/state/omarchy/notifications.json`,
   bumped from `version: 3` to `version: 4`. That file already exists, is
   already atomically written by the service, and already holds user
   preference (`dnd`).
4. The UI is built from stock `qs.Ui` components (`Panel`, `PanelSlider`,
   `Toggle`, `NumberField`, `PanelSectionHeader`, `PanelSeparator`), so the
   center matches every other omarchy panel without custom widget work.
5. Do-not-disturb stays where it is: keybind and IPC only. It was explicitly
   not selected for the center panel, so no module touches it.
6. Users of this plugin are the repo owner and anyone who clones the fork. It
   is a single-user desktop component; there is no multi-user, network or
   privilege boundary in scope.

## Objective

Make omarchy's notification toasts stop cluttering the screen, and give the
notifications somewhere to go once they leave it — without giving up the
ability to merge upstream omarchy releases cheaply.

Today the fork is a seven-line delta over upstream, deliberately, so
`git merge upstream` lands clean. Five requested changes threaten that:

| Ask | Module | Today |
|---|---|---|
| Control how long a toast stays before auto-dismiss | `timing` | Hardcoded 5s low / 8s normal / never for critical, 30s ceiling |
| Stack same-origin notifications | `stacking` | Every notification is its own full-width card |
| A center: history, clear, set the dismiss timer | `history-store`, `center-ui` | History is a directory of JSON files with no reader; `showHistory` only replays it as toasts |
| Cap how many toasts are on screen at once | `popup-cap` | Unbounded — a burst runs off the bottom of the screen |
| Stay free to take upstream changes | `fork-seam` | The seven-line delta is the whole strategy, and it does not survive these features unaided |

Success looks like: a burst of fifteen notifications from three apps produces
three tidy decks at the top-center of the screen, each dismissing on a timer
the user chose; everything that has scrolled past is one bar click away; and
`git merge upstream` after the next omarchy release still touches only a
documented handful of lines in `Service.qml`.

### User stories

- *As someone in a chat-heavy workday*, when twelve Slack messages land in a
  minute, I see one Slack deck with a count instead of twelve cards, so my
  screen stays usable.
- *As someone who reads slowly*, I set the dismiss timer to 20 seconds once, in
  the panel, and every toast honors it from then on with no shell restart.
- *As someone who stepped away*, I click the bell, see what arrived while I was
  gone with an unread count, click one to run its action, and clear the rest.
- *As the maintainer of this fork*, when omarchy 4.1 ships I run one script that
  tells me whether my delta is still within budget, and the merge is a merge.

## Tech Stack

| Piece | Choice | Notes |
|---|---|---|
| UI + service | QML (Qt 6) under Quickshell, hosted by `omarchy-shell` | No build step; the shell loads `.qml` at runtime |
| Logic | ES5 JavaScript in QML `.js` resources | QML JS resources have no module system — plain function declarations, imported via `import "X.js" as X` |
| Shared UI kit | `qs.Ui`, `qs.Commons` (omarchy shell singletons: `Style`, `Color`, `Border`, `Util`) | Provided by the host shell, not vendored |
| Persistence | JSON files under `~/.local/state/omarchy/` | Already the upstream mechanism |
| Tests | `node --test` with `node:assert` | Zero dependencies — this repo has no `package.json` and will not grow one |
| Lint | `/usr/lib/qt6/bin/qmllint` | Cannot resolve `qs.*` outside the shell; compare warnings against upstream rather than expecting silence |
| Tracked upstream | omarchy **4.0.1-1** | `/usr/share/omarchy/shell/plugins/notifications` |

No runtime dependency may be added. `jq` (already required by `install.sh`) and
`bash` are the only external tools.

## Commands

```sh
# Install into the shell and ask it to rescan
./install.sh

# Run the unit tests (no dependencies, no package.json). The glob is quoted so
# the shell passes it through, and scoped to *.test.js so helper files like
# test/harness.js are not run as empty test files and counted in the total.
# Note: a bare directory argument (`node --test test/`) errors on node 26 --
# it resolves the directory as a module.
node --test "test/**/*.test.js"
node --test test/harness.test.js     # a single file, when iterating

# Lint every QML file; compare the output against upstream's own baseline
/usr/lib/qt6/bin/qmllint Service.qml Center.qml components/*.qml

# Assert the upstream delta is still within budget -- run before every commit
./scripts/check-delta.sh

# Fire a scripted burst so grouping, capping and timing are observable
./scripts/smoke.sh

# Geometry and delegate changes need a full restart; rescanPlugins is not enough
omarchy restart shell

# Take an upstream release (see README)
git checkout upstream && cp -r /usr/share/omarchy/shell/plugins/notifications/. .
git commit -am "Vendor omarchy.notifications from omarchy <version>"
git checkout main && git merge upstream && ./scripts/check-delta.sh
```

## Project Structure

Files are split by *who owns them*, because that is what decides whether an
upstream merge conflicts.

```
manifest.json                        Ours. kinds/entryPoints/id differ from upstream.

# --- upstream files: hooks only, never new logic -------------------------
Service.qml                          Upstream + a budgeted set of marked hook lines
NotificationLogic.js                 BYTE-IDENTICAL to upstream. Never edited.
components/NotificationCard.qml      BYTE-IDENTICAL to upstream. Never edited.

# --- sidecar files: 100% ours, upstream will never have them -------------
NotificationPolicy.js                Pure logic: settings parse, duration, grouping, capping
NotificationState.qml                Settings + grouping + cap state. Mounted by one line in Service.qml.
components/PopupSlot.qml             Lifetime timer + card, lifted out of Service.qml's Repeater delegate
components/NotificationDeck.qml      Collapsed/expanded same-app deck
Center.qml                           barWidget entry point: bell button + dropdown panel
components/HistoryList.qml           Scrollable history view inside the panel
components/CenterSettings.qml        Duration / max-visible / grouping controls

# --- not shipped (install.sh already prunes these) -----------------------
scripts/check-delta.sh               Delta budget guard
scripts/smoke.sh                     Reproducible notification burst
test/                                node --test suites + the QML-JS eval harness
tasks/                               plan.md and todo.md, written by /plan

docs/                                Every written artifact. Nothing lands in the root.
docs/spec/CAPABILITY-MAP.md          The approved module index
docs/spec/SPEC.md                    This file
docs/spec/SPEC-<module-id>.md        One per module id in the map
docs/adr/                            Architecture decision records
```

**Written artifacts go under `docs/`, never in the repo root.** The root holds
runtime files, `README.md`, `LICENSE`, `manifest.json` and `install.sh` — what a
reader of the *plugin* needs. Specs, ADRs and notes are for a reader of the
*project*, and they belong one level down. New documents follow the same rule:
`docs/spec/` for specifications, `docs/adr/` for decisions, `docs/` for anything
else. `tasks/`, `test/` and `scripts/` stay at the root because they are
executable working directories rather than documents, and because `install.sh`
prunes them by exact path.

Spec files reference each other by bare filename, since they all sit in one
directory. A `// fork:` marker in `Service.qml` names a bare filename too; it
resolves against `docs/spec/`.

`install.sh` discovers what to ship rather than hardcoding it: every `.qml` and
`.js` outside `test/ docs/ scripts/ tasks/ .git/` travels. Every sidecar file
above therefore installs with no change to the installer.

## Code Style

Match upstream exactly. The fork's value is that its files read as though
upstream wrote them; a stylistic tell is a merge conflict waiting to happen.

- ES5 only: `var`, function declarations, no arrow functions, no `let`/`const`,
  no template literals, no `class`. QML JS resources are not ES modules.
- **No trailing semicolons.** `NotificationLogic.js` has zero; `Service.qml`
  has one. This is not negotiable stylistic preference, it is the house style.
- Two-space indent, double-quoted strings, camelCase.
- Coerce defensively at every boundary: `String(x || "")`, `Number(x || 0)`,
  then a finiteness check. Notification content is attacker-influenced.
- Comments explain **why**, in **three lines at most** per block, file headers
  included. A comment restating the code is noise; a comment recording the crash
  that motivated a guard is the point — but it earns three lines, not a page.
  Anything longer belongs in the spec or an ADR, with the comment pointing there.
  Enforced by `test/comments.test.js`.

Real example — upstream's own style, trimmed to the fork's three-line limit:

```js
// Whether a refresh has anything to write. Without this, one update would
// rewrite the file several times over.
function popupRowChanged(row, updated) {
  var current = row || {}
  var next = updated || {}
  for (var i = 0; i < POPUP_ROLES.length; i++) {
    var role = POPUP_ROLES[i]
    if (current[role] !== next[role]) return true
  }
  return false
}
```

Every hook line placed in `Service.qml` carries a `// fork:` marker so it is
greppable, countable by `check-delta.sh`, and unmistakable during a merge:

```qml
// fork: durations come from settings, not the upstream constants -- SPEC-timing.md
function durationFor(urgency, expireTimeout) {
  return Policy.durationFor(urgency, expireTimeout, forkState.settings, NotificationUrgency)
}
```

## Testing Strategy

Three levels, because QML under a live compositor cannot be unit tested and
pretending otherwise produces tests that assert nothing.

**1. Unit — pure logic, `node --test "test/**/*.test.js"`.** Everything decidable without a
screen lives in `NotificationPolicy.js` and is tested there. This is the
primary quality gate and the reason the policy file exists at all.

QML `.js` resources have no `export`, so `test/harness.js` reads one, wraps it
in a function, and returns what it declares:

```js
var harness = require("./harness.js")

var logic = harness.load("NotificationLogic.js")
assert.strictEqual(logic.parseExecArgv('["-rf"]'), null)
```

It runs the source in the host realm rather than in a fresh `vm` context. A
fresh context is the obvious choice and quietly wrong: values crossing back out
carry that realm's prototypes, so `deepStrictEqual` fails on an array that is
correct in every observable way. A function wrapper keeps declarations out of
the host global just as well, and QML-only globals (`Qt`, `Quickshell`,
`NotificationUrgency`) are absent from node either way — which is the property
that actually matters, and the reason `durationFor()` takes the urgency enum as
an argument rather than importing it.

Coverage expectation: every exported function in `NotificationPolicy.js` has
tests for its happy path, its malformed input, and its boundary values.
Malformed input is not optional — notification content comes from any process
on the session bus.

**2. Contract — cross-module invariants, also under `node --test`.** The
interfaces named in `CAPABILITY-MAP.md` get tests independent of any one
module: a deck counts as one slot against the cap; eviction never selects a
critical; a v3 settings file migrates to v4 without losing `dnd`.

**3. Manual — QML behavior, `./scripts/smoke.sh` plus a per-module checklist.**
Each module spec ends with a numbered checklist whose steps are literal
commands and literal observations. `scripts/smoke.sh` fires a fixed burst
(five from one app, three from another, one critical, one with an image) so
grouping, capping and timing are observed against a repeatable input rather
than whatever happened to arrive.

A module is not done until its unit tests pass, `./scripts/check-delta.sh`
passes, `qmllint` reports nothing upstream does not also report, and its manual
checklist has been walked on a live shell.

## Boundaries

**Always**

- Keep `NotificationLogic.js` and `components/NotificationCard.qml`
  byte-identical to upstream. `check-delta.sh` fails the moment they are not.
- Put new logic in a sidecar file. `Service.qml` receives hooks, never bodies.
- Mark every `Service.qml` hook with `// fork:` and a spec reference.
- Run `node --test "test/**/*.test.js"` and `./scripts/check-delta.sh` before every commit.
- Coerce and range-check every value that came from a notification, a JSON
  file, or an IPC argument.
- Write the *why* in comments, in upstream's voice.
- Put new documents under `docs/` — `docs/spec/` for specifications, `docs/adr/`
  for decisions. The repo root is for runtime files and the four files a plugin
  user looks for there.

**Ask first**

- Touching `Service.qml` outside the hook points inventoried in
  `SPEC-fork-seam.md`, or raising the delta budget.
- Changing the `notifications.json` schema version, or any on-disk layout under
  `~/.local/state/omarchy/notifications/`.
- Adding or renaming an IPC function on the `notifications` target — keybinds
  and omarchy's own scripts call these.
- Adding any runtime dependency, or a `package.json`.
- Changing behavior a user could reasonably have keybound, such as what
  `showHistory` does.

**Never**

- Commit fork changes to the `upstream` branch. It carries pristine vendor
  drops and nothing else; that is what makes the merge a real three-way merge.
- Put a symlink anywhere in the plugin directory — `omarchy-plugin-validate`
  rejects the whole plugin and the shell silently never loads it.
- Store a live `Notification` QObject in a `ListModel` role. The server
  destroys it and the next read segfaults in `QQmlListModel::data`. Live
  objects go in the `liveRefs` JS map; models hold snapshots. This is upstream's
  hard-won rule and it applies to every new model too.
- Resolve a restored or replayed row through `liveRefs` by id. Ids restart at 1
  each server generation, so an old id can belong to an unrelated live
  notification — dismissing it would kill someone else's alert.
- Dismiss a notification by a `popupModel` index captured earlier. Indices
  shift; dismiss by identity (`originalId` + `timestamp`).
- Remove or weaken a failing test, or an upstream guard whose comment you have
  not fully understood.
- Block the UI thread on a subprocess. All file work goes through the existing
  serialized `popupFileQueue`.

## Success Criteria

The initiative is done when all of the following hold on a live shell:

1. Twenty notifications from three apps arriving in five seconds produce at
   most `maxVisiblePopups` slots on screen, grouped by app, none of them
   running past the bottom of the display.
2. Changing the dismiss duration in the center panel affects the very next
   notification, with no shell restart.
3. The bell shows an accurate unread count; opening the panel clears it; the
   history list shows the last `historyLimit` notifications newest-first;
   Clear all empties both the list and `~/.local/state/omarchy/notifications/history/`.
4. Clicking a history entry with a stored `execArgv` runs that action.
5. A critical notification is never auto-dismissed and never evicted by the cap.
6. `node --test "test/**/*.test.js"` passes, `./scripts/check-delta.sh` passes, and `qmllint`
   reports nothing upstream does not also report.
7. `git merge upstream` for a vendored omarchy 4.0.1 drop is a no-op, and the
   `Service.qml` delta is within the budget set in `SPEC-fork-seam.md`.
8. Deleting `notifications.json` and restarting the shell reproduces stock
   defaults without an error in the shell log.

## Open Questions

1. ~~**Should a user-set duration be a floor or a hard override?**~~ **Resolved
   2026-08-28: override.** The user's duration wins and the app's `expireTimeout`
   is ignored, because "control the time a notification appears" is defeated by
   an app that can overrule it. Every sender observed on the development machine
   requests no timeout at all, so the two rules are indistinguishable in practice.
   Consequence: `maxPopupDurationMs` is now vestigial — see `SPEC-timing.md`.
2. **What should `showHistory` do now that a center exists?** Today it replays
   history as toasts. With `historyLimit` at 100 that would be absurd, so
   `popup-cap` bounds the replay automatically and the behavior stays. The
   alternative is repointing the keybind at the center panel, which is nicer
   but changes what an existing keybind does. Left as-is pending your call.
3. **Should the delta budget be enforced or advisory?** `check-delta.sh` exits
   non-zero over budget. There is no CI here, so it is only as binding as the
   habit of running it. A `pre-commit` hook would make it real; that is a
   local-config change, so it needs your say-so.
