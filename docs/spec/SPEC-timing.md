# Spec: timing

Module id `timing`. Depends on `settings`.

## Objective

"Control the time a notification appears before it auto-dismisses." Today those
numbers are constants in `Service.qml`: 5s low, 8s normal, never for critical,
with a 30s ceiling. Make them the user's.

## Design

Upstream resolves a toast's lifetime as:

```qml
// upstream Service.qml
case NotificationUrgency.Low:
  return Math.min(maxPopupDuration, Math.max(lowPopupDuration, requestedDuration(expireTimeout)))
```

So the configured duration is a **floor** and the app's requested
`expireTimeout` can raise it, up to a ceiling. This module keeps those
semantics exactly and substitutes the user's numbers for the constants. See
open question 1 in `SPEC.md` — if you want the user's setting to override the
app outright, that is a different rule and a small extra knob.

`NotificationPolicy.durationFor(urgency, expireTimeout, settings, urgencyEnum)`:

1. Pick the per-urgency duration from `settings.popupDurationMs`.
2. If it is `0`, return `0` — never auto-dismiss. This is how critical stays
   sticky by default, and how a user can make any urgency sticky.
3. Otherwise return `min(settings.maxPopupDurationMs, max(duration, requested))`,
   where `requested` is `expireTimeout` coerced to a finite non-negative
   integer, `0` when absent or nonsense.

The urgency enum is passed in rather than imported: `NotificationUrgency` is a
QML type unavailable to a plain `.js` resource, and passing it keeps the
function pure and node-testable.

`Service.qml` change is hook 3 alone — `durationFor`'s body becomes one
delegating call. The per-slot countdown timer, hover-pause, and
restart-on-content-change already exist in the delegate and move unchanged into
`components/PopupSlot.qml` as part of `stacking`; this module does not touch
them.

### Live changes

A duration change applies to notifications that arrive *after* it. Toasts
already on screen keep the lifetime they started with, because
`PopupSlot.lifetime` is a `readonly property` evaluated at construction.
Retroactively restarting live countdowns would make a slider drag yank toasts
off the screen mid-read. This is a deliberate choice, not an omission.

## Acceptance Criteria

- Setting normal duration to 20000 makes the next normal toast last 20s ±0.5s.
- Setting an urgency's duration to 0 makes its toasts stay until dismissed.
- `notify-send -t 25000` still yields 25s when the user duration is 8s
  (upstream floor semantics preserved).
- `notify-send -t 999999` is clamped to `maxPopupDurationMs`.
- `notify-send -u critical` never auto-dismisses at default settings.
- A negative, non-numeric or absent `expireTimeout` is treated as 0 and never
  produces `NaN` — a `NaN` lifetime would freeze a toast on screen forever.
- Toasts on screen when a duration changes keep their original lifetime.

## Verification

```sh
node --test test/timing.test.js
omarchy-shell notifications setDuration normal 20000
notify-send "twenty" "seconds"                 # time it
omarchy-shell notifications setDuration normal 0
notify-send "sticky" && sleep 60               # still there
notify-send -t 25000 "app asked for 25s"       # 25s, not 20s
notify-send -u critical "critical"             # stays
```

## Risks

- **`NaN` propagation.** `remainingLifetime -= 50.0 / lifetime` with a `NaN`
  lifetime silently never reaches zero. The finiteness check in `durationFor`
  is the guard, and it has a dedicated test.
- **Floor semantics surprise the user.** Someone who sets 5s and still sees a
  25s Slack toast will read it as a bug. If open question 1 resolves toward
  override, this changes here and nowhere else.
