# Spec: center-ui

Module id `center-ui`. Depends on `history-store` and `settings`. Built last.

## Objective

A notification center: a bell in the bar carrying an unread count, opening a
panel that lists what has arrived, clears it, and holds the controls for the
dismiss timer, the visible cap and grouping.

## Design

### Shape

A `bar-widget` entry point on this same plugin — `Center.qml`, built on
`qs.Ui.Panel`, which is omarchy's base for "a bar button plus a popup from one
QML file" and already owns the open/close lifecycle and its IPC.

`manifest.json` gains:

```json
"kinds": ["service", "bar-widget"],
"entryPoints": { "service": "Service.qml", "barWidget": "Center.qml" },
"barWidget": {
  "displayName": "Notifications",
  "description": "Notification history and settings",
  "category": "System",
  "allowMultiple": false
}
```

The manifest already differs from upstream, so this costs no delta budget.

### Reaching the service

```qml
readonly property var notifications: bar?.shell?.serviceFor("nec.notifications")
readonly property var state: notifications ? notifications.state : null
```

Verified against `shell.qml:275` — `serviceFor` takes any plugin id, not only
first-party — and against the `omarchy.media` bar widget, which binds to its
own service exactly this way. Same process, direct property bindings, no file
polling and no IPC round-trip. Every binding tolerates a null service, since
the widget can incubate before the service mounts.

### Bar button

Bell glyph, `󰂚`. When `forkState.unreadCount > 0`, a count badge in the shell's
accent color; the glyph dims to the bar's normal foreground otherwise. Click
toggles the panel. Opening it calls `forkState.markHistorySeen()`, so the badge
clears on read rather than on dismissal of individual entries.

Do-not-disturb is deliberately absent — it was not selected for this panel and
stays on its keybind and IPC.

### Panel content

Stock `qs.Ui` components throughout, so the panel looks like every other
omarchy panel with no custom widget work:

```
PanelSectionHeader   "Notifications"          [Clear all]
HistoryList          scrollable, newest first
PanelSeparator
PanelSectionHeader   "Settings"
PanelSlider          Dismiss after      5-60s, or "Never" at 0
NumberField          Max on screen      1-20
Toggle               Group by app
NumberField          Keep history       1-500
```

`components/HistoryList.qml` renders `forkState.historyModel` by reusing
`components/NotificationCard.qml` — the same card the toasts use, byte-identical
upstream, in a compact variant. Reusing it is why entries look right and why
images and glyphs work with no new rendering code. Clicking an entry calls
`forkState.invokeHistoryEntry(originalId, timestamp)`.

The list re-reads when `forkState.historyRevision` changes *and* the panel is open.
A closed panel does no work.

`components/CenterSettings.qml` binds each control to a `state` setter. The
setters clamp, so a control's range is a convenience rather than the guard.
Every change applies to the next notification with no restart — that is the
headline behavior of this panel and the first thing to verify.

### Empty and error states

- No history: the panel says so plainly, in the dimmed body color. A blank
  panel reads as broken.
- `state` null (service not mounted): the bar button hides rather than
  rendering a dead bell.

### Installation note

A bar widget must be added to the user's bar layout in `shell.json` to appear.
`install.sh` prints how; the README documents it. It is not added
automatically — writing to a user's bar layout uninvited is not this
installer's business.

## Acceptance Criteria

- The bell appears in the bar once the widget is added to the bar layout.
- The badge shows an accurate unread count and clears when the panel opens.
- The panel lists history newest-first with correct icons, images and text.
- Clicking an entry with a stored action runs it.
- Clear all empties the list, the directory and the badge together.
- Each of the four controls persists, survives a shell restart, and affects the
  next notification with no restart.
- A notification arriving while the panel is open appears in the list once it
  reaches history, without a manual refresh.
- An empty history shows an explanatory message, not a blank panel.
- The panel opens in under 200ms with 100 entries in history.
- The bar button hides, rather than erroring, when the service is unavailable.
- `qmllint` reports nothing on `Center.qml` that it does not also report on
  upstream's own panels.

## Verification

```sh
./install.sh
# add the widget to the bar in ~/.config/omarchy/shell.json, then:
omarchy restart shell
notify-send one; notify-send two          # badge reads 2
# open the panel: badge clears, both listed, settings controls respond
omarchy-notification-send --exec '["notify-send","from history"]' "clickable" "body"
# let it expire, open the panel, click it -- the action runs
/usr/lib/qt6/bin/qmllint Center.qml components/HistoryList.qml components/CenterSettings.qml
```

## Risks

- **Bar widget lifecycle.** The widget can incubate before the service mounts,
  and `rescanPlugins` can reload one without the other. Every binding must
  survive a null `state`; this is the most likely source of a console-error
  cascade.
- **Panel sizing with 100 entries.** The list must be virtualized (a `ListView`,
  not a `Repeater` in a `Column`) or the panel builds a hundred cards to show
  eight. This is what the 200ms criterion is testing.
- **Card reuse in a list.** `NotificationCard.qml` is upstream and sized for a
  toast. If a compact variant needs card changes, those changes go in a wrapper
  in `HistoryList.qml` — never in the card, which stays byte-identical.
- **This module is specced furthest ahead of implementation.** Six modules land
  before it. Expect to revise this spec once `history-store` is real; that is
  the intended use of a living spec, not a failure of it.
