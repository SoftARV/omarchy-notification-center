# Implementation Plan: stacking

Module `stacking` from [`docs/spec/CAPABILITY-MAP.md`](../docs/spec/CAPABILITY-MAP.md).
Depends on `settings`; also completes two follow-ups `popup-cap` left behind.
Spec: [`docs/spec/SPEC-stacking.md`](../docs/spec/SPEC-stacking.md).

Earlier task lists: [`fork-seam`](fork-seam/plan.md), [`settings`](settings/plan.md),
[`timing`](timing/plan.md), [`history-store`](history-store/plan.md),
[`popup-cap`](popup-cap/plan.md).

## Overview

Twelve Slack pings should occupy one card's worth of screen, not twelve. The
last of the five original asks, and the riskiest module in the project.

It is riskiest for three reasons, none of which apply to anything built so far:
it spends **hook 7**, the largest change to `Service.qml` and the one
`SPEC-fork-seam.md` flags as most exposed to an upstream restructure; it
introduces a Repeater inside a Repeater, widening the incubation window upstream
already guards with `Qt.callLater`; and the delegate it moves calls
`dismissPopup(index)`, which is meaningless once a nested delegate's index is
not the model's.

## What planning verified

- **The delegate calls `service.expirePopup(cardSlot.index)` and
  `service.dismissPopup(cardSlot.index)`.** Both are index-based. Inside a deck
  the local index is not the `popupModel` index, so both must become identity
  calls or every dismissal in a deck hits the wrong notification.
- **`NotificationCard` already exposes `readonly property bool hovered`**, so a
  deck can aggregate hover across its cards without touching the card.
- **The delegate uses `required property` bound to model roles**, plus
  `Layout.preferredWidth` and `Layout.alignment` from its `ColumnLayout` parent.
  Moving it into a component means those become plain properties set by the
  deck, and the layout attached properties move with it.
- **`popupModel` has no row limit.** The cap counts *slots*; once a slot is a
  deck, the number of rows behind it is unbounded. That is what makes the
  expanded-fan cap necessary rather than cosmetic.

## Decisions taken before planning

1. **Groups are ordered by their newest member.** A deck rises to the top when
   it receives a notification, matching the flat stack's newest-first ordering.
2. **An expanded deck draws at most 5 cards**, with `+N more` beyond. Undrawn
   rows keep their countdowns and still reach history — they are not dropped.
   A per-deck row limit was rejected: it would silently discard notifications
   the user never saw.
3. **A per-deck row cap is not added.** Any non-zero duration drains a deck on
   its own, and the alternative loses notifications silently.

## Architecture Decisions

- **Extract before grouping.** Task 2 moves the delegate into `PopupSlot.qml`
  and switches to identity-based dismissal, with **no visual change at all**.
  That isolates the riskiest edit — hook 7 — behind a verification anybody can
  run: nothing about the toasts should look or behave different. Grouping then
  builds on a delegate that is already proven in its new home.
- **The deck composes slots; it does not reimplement them.** `PopupSlot.qml`
  keeps the lifetime timer, the hover pause and the restart-on-content-change
  exactly as upstream wrote them. `NotificationDeck.qml` arranges slots and adds
  the badge, the ghosts and the expansion.
- **Nothing in a deck ever holds an index.** `dismissRow`/`invokeRow`/`indexOfRow`
  resolve against `popupModel` at call time. `SPEC.md` lists index-based
  dismissal under **Never**, and a nested Repeater is exactly where that bites.
- **`popupModel` stays upstream's.** This module computes a *view* and never
  writes to the model. Restore, `replaces_id`, archive and dismissal all keep
  working because their source of truth is untouched.
- **Recompute, do not maintain.** `groups` is rebuilt from rows on change. With
  at most a few dozen rows the cost is nothing, and incremental maintenance of a
  grouped model is where the subtle bugs live.

## Dependency Graph

```
T1  groupPopups  (pure, unit tested)
     │
T2  PopupSlot.qml + identity dismissal + hook 7   <-- riskiest; no visual change
     │
     ▼
  Checkpoint A -- the extraction is invisible
     │
     ▼
T3  NotificationDeck.qml: badge, ghosts, hover expansion, group hover-pause
     │
     ▼
T4  popup-cap follow-ups: slotCount and group-aware eviction
     │
     ▼
  Checkpoint B -- module complete, center-ui unblocked
```

T1 is independent of T2 and could run alongside it; everything else is strictly
sequential.

## Task List

Tasks and checkpoints are in [`tasks/todo.md`](todo.md).

### Phase 1: The view, and a safe delegate
- [ ] Task 1: `groupPopups`
- [ ] Task 2: extract `PopupSlot.qml`, dismiss by identity
- [ ] Checkpoint A

### Phase 2: The deck
- [ ] Task 3: `NotificationDeck.qml`

### Phase 3: Teaching the cap about decks
- [ ] Task 4: `slotCount` and group-aware eviction
- [ ] Checkpoint B

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Hook 7 conflicts with a future upstream delegate rewrite | High — the one place a big upstream change lands on fork code | `PopupSlot.qml` starts as a **verbatim** copy of upstream's delegate body, so diffing upstream's new version against it stays meaningful. Task 2's diff is reviewed for exactly that |
| A dismissal in a deck hits the wrong notification | High — silent, and destroys trust in the feature | Every call resolves identity at call time; no index is ever held. Verified by dismissing the *middle* card of an expanded deck and checking the other two survive |
| Nested Repeater incubation crash | High — takes the shell down | Every mutation path reached from a deck keeps upstream's `Qt.callLater` discipline. The smoke burst at cap 1 is the stress case |
| Delegate churn on recompute | Medium — visible flicker on every arrival | Delegates keyed by group key so a stable group keeps its delegate. If flicker appears the fix is keying, not abandoning recompute |
| A deck of 20 expands off-screen | Medium — reintroduces the clutter this fixes | At most 5 drawn, `+N more` beyond |
| `popup-cap` silently mis-counts until T4 | Medium — a deck of six would count as six slots | T4 is in this module, not a follow-up issue, and Checkpoint B does not pass without it |
| Grouping breaks `replaces_id` in-place updates | Medium | The view is recomputed from rows; an update rewrites a row and the deck redraws. Verified with `omarchy-notification-send` replacing a grouped notification |

## Open Questions

None blocking. `SPEC.md` open question 3 — enforcing `check-delta.sh` with a
hook — remains open and belongs to local tooling.
