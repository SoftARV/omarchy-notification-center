# Tasks: timing

Plan: [`tasks/plan.md`](plan.md). Spec:
[`docs/spec/SPEC-timing.md`](../docs/spec/SPEC-timing.md).
Every task also clears the Definition of Done in
[`docs/spec/SPEC.md`](../docs/spec/SPEC.md); commits follow `CLAUDE.local.md`
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

## Task 2: Hook 3 — toasts obey the setting

**Description:** Point `Service.qml`'s `durationFor` at the policy (hook 3). One
line plus its marker. After this, `setDuration` changes how long a toast stays
on screen — the first of the five original asks to become real behaviour.

Upstream's `requestedDuration()` becomes unreferenced and stays where it is.

**No unit test.** It is a one-line delegation; the logic is tested in Task 1 and
the behaviour is a stopwatch on a live shell.

**Acceptance criteria:**
- [ ] Hook 3 carries a `// fork:` marker naming `SPEC-timing.md`
- [ ] `setDuration normal 20000` → the next normal toast lasts 20s ±0.5s
- [ ] `setDuration normal 0` → the toast stays until dismissed
- [ ] `notify-send -t 25000` yields the user's duration, not 25s
- [ ] `notify-send -u critical` never auto-dismisses at default settings
- [ ] Default settings behave exactly as before this module: 5s low, 8s normal, critical sticky
- [ ] Hovering a toast still pauses its countdown (upstream behaviour intact)
- [ ] `check-delta.sh` stays within budget

**Verification:**
- [ ] `./install.sh && omarchy restart shell`
- [ ] Time a 20s toast with a stopwatch; then set 3000 and confirm it is visibly quicker
- [ ] `setDuration normal 0`, send one, wait 60s → still there; dismiss by hand
- [ ] `notify-send -u critical`, wait 60s → still there
- [ ] Reset to defaults, send one, confirm ~8s
- [ ] Hover a toast mid-countdown → it stops shrinking; unhover → it resumes
- [ ] **Live-change behaviour:** send a toast, change the duration while it is on
      screen, and record what actually happens to it. Update `SPEC-timing.md`'s
      "Live changes" section from the observation, whichever way it goes
- [ ] `qmllint Service.qml` → no warning category upstream does not also report
- [ ] Settings reset to defaults afterwards, so no test value is left behind

**Dependencies:** Task 1

**Files likely touched:**
- `Service.qml` (hook 3)
- `docs/spec/SPEC-timing.md` (record the observed live-change behaviour)
- `docs/spec/SPEC-fork-seam.md` (mark hook 3 spent)

**Estimated scope:** S (3 files)

---

## Checkpoint: Module complete

- [ ] Every acceptance criterion in `docs/spec/SPEC-timing.md` is met
- [ ] `node --test "test/**/*.test.js"` passes
- [ ] `./scripts/check-delta.sh` passes and is within budget
- [ ] `qmllint` reports no warning category upstream does not also report
- [ ] `git merge upstream` is a no-op
- [ ] Notifications, DND and history all still work on a live shell
- [ ] The "Live changes" section of the spec matches observed behaviour
- [ ] Ready for review; `stacking` and `history-store` remain unblocked
