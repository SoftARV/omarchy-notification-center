# 0001 — Fork logic lives in sidecar files

## Status

Accepted, 2026-08-28.

## Context

This fork existed to move toasts from the top-right corner to the top-center:
a seven-line delta over `omarchy.notifications`. The small delta was the whole
strategy — `git merge upstream` landed clean, so taking an omarchy release cost
nothing.

Five requested features — a configurable dismiss timer, same-app stacking, a
cap on visible toasts, a notification center, and continued cheap upstream
merges — are worth hundreds of lines. Written the obvious way they go into
`Service.qml`, a 1063-line file upstream actively rewrites. The last
requirement contradicts the other four unless the code goes somewhere upstream
never touches.

## Decision

New logic lives in files upstream has never had and never will:
`NotificationPolicy.js`, `NotificationState.qml`, `components/PopupSlot.qml`,
and the rest. A vendor drop cannot conflict with a file it does not contain.

`Service.qml` receives only two kinds of change — an upstream function body
delegating to a sidecar, or a one-line mount of a sidecar component. Each is
marked `// fork:` and names its spec. `NotificationLogic.js` and
`components/NotificationCard.qml` stay byte-identical to upstream.

`scripts/check-delta.sh` enforces it. The live hook inventory and budget
arithmetic are in [../spec/SPEC-fork-seam.md](../spec/SPEC-fork-seam.md), which
changes as modules land — this record deliberately does not copy them.

## Alternatives considered

**A separate companion plugin.** The notification center becomes its own plugin
reading the same state directory, leaving `Service.qml` pristine. It was the
stronger alternative until we checked how the shell exposes services:
`shell.serviceFor(pluginId)` accepts any plugin id, not only first-party ones
(`shell.qml:275`), and `omarchy.media` already pairs a service with a bar widget
in one plugin. A bar widget in *this* plugin therefore binds to the live service
in-process. The companion would have paid for file polling or IPC to reach state
it could read directly, plus a second install step, buying isolation the sidecar
rule already provides.

**Editing `Service.qml` freely.** Fastest to write, and it converts every future
upstream release from a merge into a manual re-application — the cost this fork
was built to avoid.

## Consequences

The delta grows from 7 lines to a budgeted 60 added lines, all labelled. That is
the real price, paid in the file where conflicts hurt most.

Sidecar files are conflict-immune, so the price does not scale with feature
count: six more modules add no `Service.qml` risk beyond their own hooks.

One hook is riskier than the rest. The popup `Repeater` delegate body moves
wholesale into `components/PopupSlot.qml`, so if upstream restructures that
delegate the change lands squarely on fork code. `PopupSlot.qml` starts as a
verbatim copy of upstream's delegate to keep that diff meaningful.

A hook needing more than a few lines signals logic that belongs in a sidecar.
Exceeding the budget is a decision made in the open — amend the inventory in the
same commit — not a number to quietly raise.
