# Implementation Plan: timing

Module `timing` from [`docs/spec/CAPABILITY-MAP.md`](../docs/spec/CAPABILITY-MAP.md).
Depends on `settings`, which is merged. Spec:
[`docs/spec/SPEC-timing.md`](../docs/spec/SPEC-timing.md).

Earlier modules' task lists are archived under
[`tasks/fork-seam/`](fork-seam/plan.md) and [`tasks/settings/`](settings/plan.md).

## Overview

The first of the five original asks to become visible behaviour. `settings`
stored a dismiss duration; this module makes toasts obey it.

Small on purpose: one pure function and one hook. The size is the point —
`fork-seam` and `settings` did the work that lets a behaviour change be fifteen
lines.

## What planning verified

- **Every notification on this machine sends `expireTimeout=0`.** Ten history
  entries across Telegram Desktop and `notify-send`, all zero, which upstream
  reads as "no preference". That is what made the floor-versus-override question
  cheap to answer: the two rules are indistinguishable for apps in actual use.
- **Upstream returns `0` for Critical unconditionally**, ignoring `expireTimeout`
  entirely. Default settings reproduce that exactly, and a user who sets a
  non-zero critical duration opts out of it deliberately.
- **Upstream's `switch` sends Normal and every unknown urgency down `default:`.**
  The urgency-name mapping must do the same, or an unrecognised value would fall
  through to `undefined` and then to `NaN`.
- **`requestedDuration()` will become unreferenced.** It is upstream's function;
  it stays where it is. Deleting upstream code the fork no longer calls is a
  change with no upside and a merge cost.

## Decisions taken before planning

1. **Override, not floor.** The user's duration wins; the app's `expireTimeout`
   is ignored. "Control the time a notification appears" is defeated by an app
   that can overrule it. Resolves open question 1 in `SPEC.md`.
2. **`maxPopupDurationMs` becomes vestigial.** It only ever capped how far an app
   could extend a toast; `clampSettings` already caps the user's own value. It
   keeps its place in the v4 schema rather than forcing a schema change, gets no
   IPC setter, and is flagged for removal the next time the schema moves.
3. **`expireTimeout` is not a parameter of `durationFor`.** Accepting and
   ignoring it would hide the decision inside the function; omitting it puts the
   decision at the call site where a reader trips over it.

## Architecture Decisions

- **NaN-proof by construction.** The lifetime feeds
  `remainingLifetime -= 50.0 / lifetime`, and a `NaN` there never reaches zero —
  the toast simply never leaves. `clampSettings` already guarantees a finite
  number, so `durationFor` cannot produce `NaN` from valid settings; the explicit
  fallback covers a caller passing something malformed anyway. Both paths get
  tests, because the failure is silent and permanent.
- **The urgency enum is a parameter.** `NotificationUrgency` is a QML type a
  plain `.js` resource cannot import. Passing it keeps the function pure and
  node-testable, and is the reason `fork-seam` insisted logic stay out of QML.
- **One hook, one line.** Hook 3 replaces `durationFor`'s body with a delegating
  call. Nothing else in `Service.qml` is touched: the countdown timer, the
  hover-pause and the restart-on-content-change stay exactly as upstream wrote
  them, and move to `PopupSlot.qml` later as part of `stacking`.

## Dependency Graph

```
T1  NotificationPolicy.durationFor  (pure, unit tested)
     │
     ▼
T2  Service.qml hook 3  --  durations take effect on a live shell
     │
     ▼
  Checkpoint -- module complete, and the first ask is real
```

Sequential and short. Nothing here is worth parallelising.

## Task List

Tasks and checkpoints are in [`tasks/todo.md`](todo.md).

### Phase 1: The rule
- [ ] Task 1: `durationFor` in `NotificationPolicy.js`

### Phase 2: The behaviour
- [ ] Task 2: Hook 3 — toasts obey the setting
- [ ] Checkpoint: module complete

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A `NaN` lifetime freezes a toast on screen permanently | High — silent, and the toast can only be dismissed by hand | `clampSettings` guarantees finite numbers; `durationFor` falls back on anything malformed; dedicated tests for both |
| An unknown urgency value maps to no name | High — same `NaN` failure | Mapping mirrors upstream's `switch`: anything not Critical or Low is normal. Tested with an out-of-range enum value |
| A live duration change re-evaluates on-screen toasts | Unknown until observed — QML tracks binding dependencies through function calls, so it may | Task 2 verifies it deliberately and documents what actually happens. The spec previously asserted it could not, on the incorrect grounds that `readonly` means evaluated-once |
| Override surprises an app that needs a longer toast | Low today | No sender observed here requests a timeout at all. If it bites, the answer is a per-app rule, not a return to floor semantics |
| Timing a toast by hand is imprecise | Low | Acceptance is ±0.5s on a 20s toast, which a stopwatch clears comfortably. The 0-means-never case is checked by waiting well past any plausible duration |

## Open Questions

None blocking. Open questions 2 and 3 in `SPEC.md` remain open but belong to
`popup-cap` and to local tooling respectively, not to this module.
