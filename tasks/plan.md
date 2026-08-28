# Implementation Plan: popup-cap

Module `popup-cap` from [`docs/spec/CAPABILITY-MAP.md`](../docs/spec/CAPABILITY-MAP.md).
Depends on `settings`, which is merged. Spec:
[`docs/spec/SPEC-popup-cap.md`](../docs/spec/SPEC-popup-cap.md).

Earlier task lists: [`fork-seam`](fork-seam/plan.md), [`settings`](settings/plan.md),
[`timing`](timing/plan.md), [`history-store`](history-store/plan.md).

## Overview

A hard ceiling on how many toasts are on screen. The fourth of the five original
asks, and the one that stops a burst running off the bottom of the display.

Everything the module needs already exists: `maxVisiblePopups` is in settings,
eviction reuses upstream's `removePopup(index, "expire")`, and history already
absorbs what leaves. The work is deciding *what* to evict and *when*.

## What planning verified

- **`popupModel` is reachable from the sidecar.** Upstream exposes it as
  `property alias popupModel`, precisely so consumers outside its id scope can
  bind to it. That is what makes a zero-hook design possible.
- **Three code paths insert rows**, not one: `handleNotification`, the
  `showHistory` replay, and the restart restore. The spec's "hook 6 alone"
  would have missed the restore path.
- **Upstream wraps every model mutation in `Qt.callLater`**, with a comment
  naming the crash it prevents — `QV4::Object::insertMember` when a Repeater is
  mid-incubation. Any reaction to `countChanged` must observe the same
  discipline.
- **`scripts/smoke.sh` does not exist**, though `SPEC.md` references it in four
  places and this module's verification calls for it. A cap cannot be verified
  without a repeatable burst, so it gets built here.

## Decisions taken before planning

1. **No `Service.qml` hook at all.** The sidecar watches `service.popupModel`'s
   `count` and enforces the cap when it rises, covering arrival, replay and
   restore through one mechanism. Hook 6 is released back to the budget.
2. **Built ahead of `stacking`**, against the capability map's order.
   `forkState.slotCount` becomes the interface: `popupModel.count` today,
   `groups.length` once `stacking` lands. The eviction selector returns a *list*
   of row identities so that later change is a change of selector, not of
   mechanism. `SPEC-stacking.md` carries both follow-ups as acceptance criteria.
3. **`SPEC.md` open question 2 is resolved.** The cap bounds the `showHistory`
   replay automatically, so the keybind keeps its behaviour and no knob is added.

## Architecture Decisions

- **Never index into a model mid-mutation.** The eviction picks rows by
  identity — `originalId` + `timestamp` — collects them all, and only then
  removes them. `SPEC.md` bans index-based dismissal for exactly this reason,
  and a loop calling `removePopup(i)` while indices shift underneath is the
  classic version of that bug.
- **Criticals are never evicted.** If every visible slot is critical the cap is
  exceeded rather than honoured. A cap is a comfort feature; dropping an
  emergency alert to satisfy one is a bug no default makes right.
- **Eviction is `"expire"`, not `"dismiss"`.** The user dismissed nothing, and
  `expire()` is the freedesktop-correct signal to the sender. It also means
  eviction reuses upstream's archive-and-clean path and adds no file handling.
- **Selection is pure and testable; the trigger is not.** Which rows to evict is
  a function of rows, cap and urgency — unit tested. When to run it is a QML
  binding, verified live.

## Dependency Graph

```
T1  eviction selection  (pure, unit tested)
     │
     ▼
T2  the cap enforced from the sidecar + scripts/smoke.sh
     │
     ▼
  Checkpoint A -- a burst is bounded
     │
     ▼
T3  the replay and restore paths
     │
     ▼
  Checkpoint B -- module complete
```

## Task List

Tasks and checkpoints are in [`tasks/todo.md`](todo.md).

### Phase 1: What to evict
- [ ] Task 1: eviction selection

### Phase 2: When to evict
- [ ] Task 2: enforce the cap, and a smoke script to see it
- [ ] Checkpoint A

### Phase 3: The other ways rows arrive
- [ ] Task 3: replay and restore
- [ ] Checkpoint B

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Evicting by index while the model mutates | High — removes the wrong notification, or crashes | Select by identity, collect first, remove after. Pure selection is unit tested; the removal loop resolves each identity at call time |
| Re-entering the model from `countChanged` | High — the `QV4::Object::insertMember` crash upstream documents | The watcher defers through `Qt.callLater`, the same discipline upstream applies to its own mutations |
| An eviction loop that does not terminate | High — a hung shell | Eviction strictly reduces the count, and the critical exemption returns an empty selection rather than looping. A test asserts selection is empty when every row is critical |
| Eviction storm at cap 1 under a burst | Medium — file-queue traffic | Bounded work per notification on a serialized queue. Watched during the smoke test, and the timing recorded |
| A restored critical is evicted on restart | Medium — it survived a crash only to be dropped | Criticals are exempt everywhere, including the restore path. Verified by restarting with more criticals than the cap |
| The cap fights `stacking` later | Known, recorded | `slotCount` is the interface and `SPEC-stacking.md` carries both required changes as acceptance criteria |

## Open Questions

None blocking. `SPEC.md` open question 3 — whether `check-delta.sh` should be
enforced by a hook — remains open and belongs to local tooling.
