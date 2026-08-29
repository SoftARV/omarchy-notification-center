# Spec: stacking

Module id `stacking`. Depends on `settings`. Provides the grouped-slot view
consumed by `popup-cap`.

## Objective

Twelve Slack pings should occupy one card's worth of screen, not twelve.
Same-origin notifications collapse into a shallow visual deck that fans out on
hover so each is still individually readable, clickable and dismissable.

## Design

### Grouping key

`app` (the notification's `appName`), normalized: trimmed, lowercased.
Notifications with an empty `app` are never grouped — an empty key would herd
unrelated senders into one deck.

Rows restored from disk or replayed from history group like any other. They
carry `app`, which is all the key needs.

### The grouped view

`popupModel` stays exactly as upstream built it: flat, newest-first, the single
source of truth for restore, replaces_id, archive and dismissal. Nothing in
this module writes to it. A sidecar computes a *view*:

```js
// NotificationPolicy.js
// [{ key, app, rows: [rowRef, ...], newest }] in first-appearance order,
// rows newest-first within a group. Grouping off yields one row per group.
function groupPopups(rows, groupByApp)
```

`NotificationState.qml` exposes `forkState.groups`, recomputed on
`popupModel.countChanged`, on `settingsChanged`, and after `refreshPopup`
rewrites a row. The Repeater binds to `forkState.groups` (hook 7).

**Groups are ordered by their newest member, newest group first.** A deck rises
to the top when it receives a notification, matching the flat stack today where
the newest is always on top — the deck you just got a message in is the one you
look at. It falls out of scanning a newest-first row list and taking each app's
first appearance.

Recompute-on-change rather than an incrementally maintained model: with a cap
of at most 20 rows the cost is nothing, and incremental maintenance of a
grouped model is where the subtle bugs live.

### Rendering

`components/NotificationDeck.qml` renders one group.

**Collapsed** (default, group of *n* > 1): the newest row drawn as a full
`NotificationCard`, unchanged, with up to two ghost edges peeking below it —
each offset ~4px down, scaled ~0.98, progressively dimmed, drawn *behind*. It
should read at a glance as a stack of cards, one on top of another.

**No count badge.** The stack itself is the signal that there is more than one;
a number on the card is information the user did not ask for. A group of 1
renders as a plain card with no ghosts — pixel-identical to today.

**The card is not modified.** `components/NotificationCard.qml` stays
byte-identical to upstream, as it has all along. Everything the deck adds —
the ghost edges, the offsets, the expansion — lives in
`components/NotificationDeck.qml` and is composed *around* the card, never
inside it.

**Expanded** (any pointer inside the deck): the group's rows fan into a normal
vertical column with standard spacing, each a full card with its own close
button and click target. The transition is a height/opacity animation on the
column, ~160ms, matching the shell's existing animation durations.

**At most 5 cards are drawn when expanded**, newest first. The cap counts
*decks*, not rows, so a single deck can hold many notifications — and expanding
twelve would run straight off the bottom of the screen, the exact clutter this
initiative exists to remove.

**The ghost edges stay while expanded if rows are held back.** An earlier draft
put a `+N more` line under the fan. It was wrong twice over: it is a *count*,
which is what a collapsed deck deliberately does not show, and it was bare text
with no card behind it — every other element in the column is a card with its
own background, so the label rendered onto the wallpaper in a colour meant for a
card surface and read as an unexplained gap rather than a label. Reported from
the live shell and replaced.

Keeping the ghosts says "there is more behind" in the vocabulary the collapsed
deck already established, and needs no new one.

The undrawn rows are not dropped: they keep running their own countdowns and
reach history like any other. They are simply not rendered.

### Timers

Each row keeps its own independent countdown, exactly as it does today — this
module does not change lifetime semantics. Consequences:

- When the front card of a collapsed deck expires, the next becomes the face
  and the count drops. The deck shrinks naturally to a single card, then to
  nothing.
- Hovering **anywhere in the deck** pauses **every** row in it. Upstream pauses
  per-card on hover; extending that to the group is required, or a card would
  expire out from under the pointer while it is being read in an expanded deck.

The lifetime timer and its hover-pause move out of `Service.qml`'s Repeater
delegate into `components/PopupSlot.qml` verbatim, so `NotificationDeck` can
compose slots. Moving it unchanged is what keeps hook 7's conflict resolution
mechanical.

### Dismissal by identity, not index

This is the module's main hazard. `service.dismissPopup(index)` takes a
`popupModel` index, and inside a nested deck Repeater the local index is not
that index. Capturing an outer index is worse: it goes stale the moment any row
is removed.

So `NotificationState` gains:

```qml
function indexOfRow(originalId, timestamp)   // -1 when gone
function dismissRow(originalId, timestamp)
function invokeRow(originalId, timestamp)
```

resolving against `popupModel` at call time. `originalId` + `timestamp` is
already this codebase's row identity — it is what `popupFileName()` is built
from. Decks call these; nothing in a deck ever holds an index. `SPEC.md` lists
index-based dismissal under **Never** for this reason.

## Inherited from `popup-cap`

`popup-cap` was built first, capping rows rather than groups. Two changes here
are not optional — without them a deck of six pings counts as six slots and the
cap shreds it:

- `forkState.slotCount` becomes `forkState.groups.length` instead of
  `popupModel.count`.
- Eviction removes **every row of the chosen group**. The selector already
  returns a list of row identities, so this is a change of selector, not of
  mechanism.
- "Oldest" becomes the group's *newest* row's timestamp, so a deck still
  receiving is not evicted before an older idle one.

## Acceptance Criteria

- `forkState.slotCount` counts groups, and a deck of six counts as one slot
  against `maxVisiblePopups`.
- Eviction removes a whole group at once, choosing the one whose newest row is
  oldest.
- Five notifications from one app produce one deck that reads as a stack of
  cards — the front card unchanged, with ghost edges behind it.
- No count is drawn on a collapsed deck.
- `components/NotificationCard.qml` is still byte-identical to upstream.
- Notifications from three apps produce three decks, in first-appearance order.
- One notification produces a card visually identical to today's.
- Hovering a collapsed deck expands it; every card in it is independently
  readable, closable and clickable.
- Hovering anywhere in a deck pauses every countdown in it; leaving resumes them.
- Dismissing the middle card of an expanded deck removes that notification and
  no other, and the deck re-lays out without flicker.
- `groupByApp: false` renders exactly today's flat stack.
- Toggling `groupByApp` while toasts are on screen re-lays them out live.
- A `replaces_id` update to a grouped notification updates in place without
  reordering or duplicating the deck.
- A group whose rows all expire leaves no empty deck behind.
- Notifications with an empty `app` never share a deck.
- Groups are ordered by their newest member; a deck rises to the top when it
  receives a notification.
- An expanded deck draws at most 5 cards and keeps its ghost edges when rows are
  held back; the undrawn rows still expire on their own schedule and still reach
  history.
- No count is drawn anywhere, expanded or collapsed.

## Verification

```sh
node --test test/stacking.test.js     # groupPopups: ordering, empty keys, toggle
./scripts/smoke.sh                    # 5 from one app, 3 from another, 1 critical
# then, by hand: hover to expand, close a middle card, toggle grouping live
omarchy-shell notifications setGrouping off
```

## Risks

- **Hook 7 is the largest single change to `Service.qml`.** Mitigated by moving
  the delegate body verbatim into `PopupSlot.qml` — see `SPEC-fork-seam.md`.
- **Nested Repeater incubation.** Upstream already wraps model mutation in
  `Qt.callLater` to dodge `QV4::Object::insertMember` crashes when a Repeater is
  mid-incubation. A Repeater of Repeaters widens that window. Every mutation
  path reached from a deck must keep the `Qt.callLater` discipline.
- **Recompute churn.** `forkState.groups` rebuilding on every row change re-creates
  delegates unless the group objects are stable. If cards visibly flicker on
  insert, the fix is keying delegates by group key, not abandoning the
  recompute model.
- **Expansion near the screen edge.** Settled: at most 5 cards are drawn when
  expanded, with ghost edges standing in for the remainder. A tall deck can still exceed a
  short screen if `maxVisiblePopups` is also high; that is a product of two
  user-chosen numbers rather than something this module can bound alone.
- **Rows in a deck are unbounded.** The cap limits decks, so a chatty app can
  accumulate rows indefinitely if their duration is 0. In practice any non-zero
  duration drains them. A per-deck row limit was considered and rejected: it
  would silently drop notifications the user never saw.
