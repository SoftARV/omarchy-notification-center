# Spec: timing

Module id `timing`. Depends on `settings`.

## Objective

"Control the time a notification appears before it auto-dismisses." Today those
numbers are constants in `Service.qml`: 5s low, 8s normal, never for critical,
with a 30s ceiling. Make them the user's.

## Design

Upstream resolves a toast's lifetime as `min(ceiling, max(configured, requested))`
— the configured duration is a floor the app's `expireTimeout` can raise. **This
module replaces that rule with an override:** the user's duration wins and the
app's request is ignored.

That is what "control the time a notification appears" asks for. Under floor
semantics an app asking for 25s defeats a user who set 8s, and the setting reads
as broken. Resolves open question 1 in `SPEC.md`.

Evidence it costs little: every notification recorded on the development machine
— Telegram Desktop included — sends `expireTimeout=0`, which upstream reads as
"no preference". The two rules are indistinguishable for apps in actual use; the
override only decides what happens the first time one does ask.

`NotificationPolicy.durationFor(urgency, settings, urgencyEnum)`:

1. Map the urgency to a name: `Critical` → `critical`, `Low` → `low`, anything
   else → `normal`. This mirrors upstream's `switch`, whose `default` branch
   catches Normal and any unknown value.
2. Return `settings.popupDurationMs[name]`. `0` means never auto-dismiss — how
   critical stays sticky by default, and how a user makes any urgency sticky.
3. If that value is missing or not a finite non-negative number, fall back to
   the built-in default for that urgency.

`expireTimeout` is not a parameter. Omitting it rather than accepting and
ignoring it keeps the decision visible at the call site.

The urgency enum is passed in rather than imported: `NotificationUrgency` is a
QML type unavailable to a plain `.js` resource, and passing it keeps the
function pure and node-testable.

`Service.qml` change is hook 3 alone — `durationFor`'s body becomes one
delegating call. Upstream's `requestedDuration()` is left in place, unreferenced;
it is upstream's code and deleting it would be a change this module does not need
to make.

### Consequence: `maxPopupDurationMs` is now vestigial

It existed to cap how far an app could extend a toast. With app requests ignored
it does nothing — `clampSettings` already caps the user's own durations at 300s.
It stays in the v4 schema rather than forcing a schema change, has no IPC setter,
and is a candidate for removal the next time the schema moves.

### Live changes

**Observed, not assumed: a duration change re-evaluates toasts already on
screen.** `lifetime` is a QML binding that calls through to `forkState.settings`,
and QML tracks that dependency across the function calls.

Measured: a toast 5 s into a 60 s lifetime, with the duration then set to 3 s,
disappeared 3 s later — `remainingLifetime` is a *fraction*, so the ~0.92 left
was reapplied to the new duration rather than restarting it.

An earlier draft of this spec asserted the opposite, reasoning that a `readonly
property` is evaluated once. `readonly` prevents assignment, not re-evaluation.

The behaviour is reasonable for the IPC calls that exist today — a deliberate
change takes effect at once. It is a hazard for `center-ui`'s planned slider:
`applySetting` reassigns `settings` on *every* call while only the file write is
debounced, so dragging a slider from 20 s to 3 s would shrink every visible toast
progressively and could pull one off screen mid-read. See `SPEC-center-ui.md`.

## Acceptance Criteria

- Setting normal duration to 20000 makes the next normal toast last 20s ±0.5s.
- Setting an urgency's duration to 0 makes its toasts stay until dismissed.
- `notify-send -t 25000` yields the **user's** duration, not 25s.
- `notify-send -u critical` never auto-dismisses at default settings.
- A malformed or missing `popupDurationMs` falls back to the built-in default
  and never produces `NaN` — a `NaN` lifetime would freeze a toast on screen
  forever, since `remainingLifetime -= 50/NaN` never reaches zero.
- An unknown urgency value is treated as normal, matching upstream's `default:`.

## Verification

```sh
node --test "test/**/*.test.js"
omarchy-shell notification-settings setDuration normal 20000
notify-send "twenty" "seconds"                 # time it
omarchy-shell notification-settings setDuration normal 0
notify-send "sticky" && sleep 60               # still there
notify-send -t 25000 "app asked for 25s"       # 20s -- the user's, not the app's
notify-send -u critical "critical"             # stays
```

## Risks

- **`NaN` propagation.** `remainingLifetime -= 50.0 / lifetime` with a `NaN`
  lifetime silently never reaches zero. The finiteness check in `durationFor`
  is the guard, and it has a dedicated test.
- **An app that genuinely needs a longer toast cannot get one.** Override is
  absolute. No sender observed on the development machine requests a timeout at
  all, so this is theoretical today; if it bites, the fix is a per-app rule, not
  a return to floor semantics.
- **A live duration change may re-evaluate on-screen toasts.** `lifetime` is a
  QML binding calling `durationFor`, which reads `forkState.settings` — QML
  tracks dependencies through function calls, so changing a duration may
  recompute the lifetime of toasts already showing. Verified during build and
  documented either way; see `tasks/plan.md`.
