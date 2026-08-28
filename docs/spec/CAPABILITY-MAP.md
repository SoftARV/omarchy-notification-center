# Capability Map: nec.notifications

Approved 2026-08-28. This map, not filename guessing, is the index of what
exists. Module ids are stable and kebab-case; they are never renamed
mid-initiative, because specs, plans and task lists select work by them.

| Module id | Responsibility | Depends on |
|---|---|---|
| `fork-seam` | Sidecar-file architecture, the hook contract in `Service.qml`, the delta-budget check, upstream merge docs | — |
| `settings` | `notifications.json` v4 schema: durations, max visible, grouping, history limit. Load / save / defaults / IPC | `fork-seam` |
| `timing` | Per-urgency auto-dismiss durations read from settings instead of hardcoded constants | `settings` |
| `stacking` | Same-app grouping into a hover-expandable deck; a deck is one slot | `settings` |
| `popup-cap` | Max visible slots; evict the oldest to history when a new toast arrives over the cap | `settings`, `stacking` |
| `history-store` | Observable history model for readers, configurable limit, clear, unread count | `settings` |
| `center-ui` | Bar widget (bell + unread count) and dropdown panel: history list, clear, settings controls | `history-store`, `settings` |

**Build order:** `fork-seam` → `settings` → {`timing`, `stacking`, `history-store`} → {`popup-cap`, `center-ui`}

Braces mark work that can proceed in parallel once its dependency lands.

## Why these boundaries

- **`fork-seam` is a module, not a convention.** It ships `scripts/check-delta.sh`
  and the hook-point inventory that every later module plugs into. Building it
  first means modules 2-7 have a rule to follow, rather than a rule
  reverse-engineered from what they happened to do.
- **`popup-cap` depends on `stacking`** because stacking defines what one slot
  means. Six Discord pings must count as one slot against the cap, not six.
  Reversing the arrow would mean capping raw rows and then discovering the cap
  is wrong once decks exist.
- **`history-store` is split from `center-ui`** because today there is no way to
  *read* history: `showRecentHistory()` only replays it onto the screen as
  toasts. Turning the history directory into a queryable, observable model is
  distinct work from drawing a panel, and it is independently testable.
- **`timing` stays separate from `settings`** because settings owns the schema
  and persistence while timing owns the resolution policy (how a user duration,
  an app-requested `expireTimeout` and the hard ceiling combine). They fail in
  different ways and have different tests.

## Interfaces

Interfaces live at the boundary, recorded in the *provider's* spec:

- `settings` provides the resolved settings object and change signal consumed by
  `timing`, `stacking`, `popup-cap`, `history-store`, `center-ui`. Contract in
  `SPEC-settings.md`.
- `stacking` provides the grouped-slot view of `popupModel` consumed by
  `popup-cap`. Contract in `SPEC-stacking.md`.
- `history-store` provides the history model, revision counter and unread count
  consumed by `center-ui`. Contract in `SPEC-history-store.md`.

## Specs

All of these live beside this file in `docs/spec/` and reference each other by
bare filename. Nothing in this initiative writes a document to the repo root —
see the Project Structure section of `SPEC.md`.

- Project-wide spec (six core areas, shared by every module): `SPEC.md`
- Module specs: `SPEC-fork-seam.md`, `SPEC-settings.md`, `SPEC-timing.md`,
  `SPEC-stacking.md`, `SPEC-popup-cap.md`, `SPEC-history-store.md`,
  `SPEC-center-ui.md`
