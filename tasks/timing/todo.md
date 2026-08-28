# Tasks: timing

Plan: [`tasks/plan.md`](plan.md). Spec:
[`docs/spec/SPEC-timing.md`](../../docs/spec/SPEC-timing.md).
Every task also clears the Definition of Done in
[`docs/spec/SPEC.md`](../../docs/spec/SPEC.md); commits follow `CLAUDE.local.md`
(conventional commits via `git-commit-helper`, scope `timing`, comment blocks
capped at three lines).

---

## Phase 1: The rule

## Task 1: durationFor in NotificationPolicy.js  [DONE]

**Description:** One pure function returning a toast's lifetime in milliseconds
from the settings and the urgency. The user's duration wins outright — the app's
`expireTimeout` is not a parameter.

The output feeds `remainingLifetime -= 50.0 / lifetime`, where a `NaN` never
reaches zero and the toast never leaves. Every path that could produce one is
tested.

**Acceptance criteria:**
- [x] `durationFor(urgency, settings, urgencyEnum)` returns the configured duration for that urgency
- [x] Critical, Low and Normal map correctly; every other value maps to normal, matching upstream's `default:`
- [x] `0` is returned unchanged — never auto-dismiss
- [x] A missing, non-numeric, non-finite or negative duration falls back to that urgency's built-in default
- [x] Null or malformed `settings`, or a missing `urgencyEnum`, yields defaults rather than throwing
- [x] The result is always a finite non-negative number — no input produces `NaN`
- [x] Default settings reproduce upstream's numbers exactly: 5000 low, 8000 normal, 0 critical

**Verification:**
- [x] `node --test "test/**/*.test.js"` → all pass, including new cases in `test/timing.test.js`
- [x] A test asserts `isFinite()` over every urgency for a deliberately hostile settings object
- [x] A test pins the upstream-equivalence claim: default settings give 5000/8000/0
- [x] `./scripts/check-delta.sh` → still passes (this task touches no upstream file)

**Dependencies:** None

**Files touched:**
- `NotificationPolicy.js` (`urgencyName`, `durationFor`)
- `test/timing.test.js` (new — 11 tests)

**Estimated scope:** S (2 files)

**A safer fallback than the spec asked for.** The criteria said a missing
`urgencyEnum` should "yield defaults rather than throw". Falling through to
normal would make a critical auto-dismiss — the worst way this can fail — so
the fallback is the freedesktop urgency levels (0 low, 1 normal, 2 critical),
which are a published standard rather than a Quickshell implementation detail.

**Equivalence verified against the live constants**, not from memory: upstream's
`lowPopupDuration: 5000` / `normalPopupDuration: 8000` are still in `Service.qml`,
and `durationFor` at default settings returns exactly those, with critical 0.

**The comment rule caught its author.** The first draft of `durationFor`'s
docstring ran to four lines and `test/comments.test.js` failed the build.

---

## Phase 2: The behaviour

## Task 2: Hook 3 — toasts obey the setting  [DONE]

**Description:** Point `Service.qml`'s `durationFor` at the policy (hook 3). One
line plus its marker. After this, `setDuration` changes how long a toast stays
on screen — the first of the five original asks to become real behaviour.

Upstream's `requestedDuration()` becomes unreferenced and stays where it is.

**No unit test.** It is a one-line delegation; the logic is tested in Task 1 and
the behaviour is a stopwatch on a live shell.

**Acceptance criteria:**
- [x] Hook 3 carries a `// fork:` marker naming `SPEC-timing.md`
- [x] `setDuration normal 20000` → the next normal toast lasts 20s ±0.5s
- [x] `setDuration normal 0` → the toast stays until dismissed
- [x] `notify-send -t 25000` yields the user's duration, not 25s
- [x] `notify-send -u critical` never auto-dismisses at default settings
- [x] Default settings behave exactly as before this module: 5s low, 8s normal, critical sticky
- [x] Hovering a toast still pauses its countdown — confirmed by the user, 2026-08-28: with three 25 s toasts on screen, the hovered one stayed while the other two expired
- [x] `check-delta.sh` stays within budget

**Verification:**
- [x] `./install.sh && omarchy restart shell`
- [x] Time a 20s toast with a stopwatch; then set 3000 and confirm it is visibly quicker
- [x] `setDuration normal 0`, send one, wait 60s → still there; dismiss by hand
- [x] `notify-send -u critical`, wait 60s → still there
- [x] Reset to defaults, send one, confirm ~8s
- [x] Hover a toast mid-countdown → it stops shrinking; unhover → it resumes — confirmed by the user
- [x] **Live-change behaviour:** send a toast, change the duration while it is on
      screen, and record what actually happens to it. Update `SPEC-timing.md`'s
      "Live changes" section from the observation, whichever way it goes
- [x] `qmllint Service.qml` → no warning category upstream does not also report
- [x] Settings reset to defaults afterwards, so no test value is left behind

**Dependencies:** Task 1

**Files touched:**
- `Service.qml` (hook 3 — one hunk, 3 added lines)
- `NotificationState.qml` (a `durationFor` delegate, so `Service.qml` still needs no `Policy` import)
- `docs/spec/SPEC-timing.md` (live-change behaviour recorded from measurement)
- `docs/spec/SPEC-center-ui.md` (warned about the slider hazard this uncovered)
- `docs/spec/SPEC-fork-seam.md` (hook 3 marked spent; usage now 23/60)

**Estimated scope:** S (5 files)

**Measured, not asserted.** Default normal 8.0s; low 5.0s; `setDuration normal
20000` → 20.0s; `3000` → 3.0s; `notify-send -t 25000` → 3.0s and `-t 1000` →
3.0s, so override holds in both directions; critical still on screen past 70s;
`duration 0` still on screen past 45s and removable with `dismissAll` — sticky,
not stuck.

**The live-change question is answered: the lifetime re-evaluates.** A toast 5s
into a 60s lifetime, with the duration then set to 3s, vanished 3s later —
`remainingLifetime` is a fraction, so the ~0.92 remaining was reapplied to the
new duration. The spec asserted the opposite on the incorrect grounds that
`readonly` means evaluated-once; it now records what was measured, and
`SPEC-center-ui.md` carries the consequence for its planned slider.

**A false alarm worth recording.** An early measurement showed a low-urgency
toast lasting 15.8s instead of 5s. The bug was in the measuring harness, which
deleted popup state files without removing the on-screen toast, so it timed the
previous toast's tail. Re-measured cleanly: 5.0s, urgency 0.

---

## Checkpoint: Module complete  [REACHED]

- [x] Every acceptance criterion in `docs/spec/SPEC-timing.md` is met
- [x] `node --test "test/**/*.test.js"` passes — 89 tests
- [x] `./scripts/check-delta.sh` passes at `+23/60`
- [x] `qmllint` reports warning categories identical to upstream's own file
- [x] `git merge upstream` is a no-op
- [x] Notifications, DND and history all still work on a live shell
- [x] The "Live changes" section of the spec matches observed behaviour
- [x] Hover-pause confirmed by the user on three simultaneous 25 s toasts: the
      hovered one held while the other two expired, so the pause is per-card and
      the duration is applied consistently across a stack
- [x] Reviewed and approved by the user, 2026-08-28; `stacking` and `history-store` remain unblocked

**timing is complete.** The first of the five original asks is real behaviour:
`setDuration` changes how long a toast stays on screen.
