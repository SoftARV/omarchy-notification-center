// Settings schema for the fork.
//
// Upstream keeps exactly one preference in ~/.local/state/omarchy/notifications.json
// (`dnd`, at version 3). The fork needs four more knobs -- dismiss durations, the
// visible-toast cap, same-app grouping, and how much history to keep -- so this
// file owns version 4 of that document: what the defaults are, what each field's
// valid range is, how an older or corrupt file becomes a complete v4 object, and
// how it is written back.
//
// Upstream's NotificationLogic.parseSettings is left byte-identical and unused by
// the fork path; this supersedes it. A v4 file is still readable by that parser --
// it finds the `dnd` key it expects and ignores the rest -- so a user switching
// back to the stock plugin does not lose their setting.
//
// Everything here is pure, and is the only part of the settings module that can
// be unit tested. Decisions that need a running shell belong in
// NotificationState.qml, not here.

var SCHEMA_VERSION = 4

// Upstream's own constants, so a user who never opens the settings panel sees
// no change in dismiss timing. Critical is 0 -- never auto-dismiss.
var DEFAULT_DURATIONS = { low: 5000, normal: 8000, critical: 0 }
var URGENCY_NAMES = ["low", "normal", "critical"]

// A duration of 0 means "never auto-dismiss". Any other value is held above
// MIN_DURATION so a mistyped 1 cannot produce a toast nobody can read.
var MIN_DURATION = 500
var MAX_DURATION = 300000

var BOUNDS = {
  maxPopupDurationMs: { min: 1000, max: MAX_DURATION, fallback: 30000 },
  maxVisiblePopups: { min: 1, max: 20, fallback: 4 },
  historyLimit: { min: 1, max: 500, fallback: 100 },
  historyLastSeen: { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 }
}

// Dead payload from versions that kept notifications in this file, before
// history moved into its own directory. Their presence is what marks a file as
// needing the rewrite that drops them.
var LEGACY_KEYS = ["pending", "past", "entries"]

function defaultSettings() {
  return {
    version: SCHEMA_VERSION,
    dnd: false,
    popupDurationMs: {
      low: DEFAULT_DURATIONS.low,
      normal: DEFAULT_DURATIONS.normal,
      critical: DEFAULT_DURATIONS.critical
    },
    maxPopupDurationMs: BOUNDS.maxPopupDurationMs.fallback,
    maxVisiblePopups: BOUNDS.maxVisiblePopups.fallback,
    groupByApp: true,
    historyLimit: BOUNDS.historyLimit.fallback,
    historyLastSeen: BOUNDS.historyLastSeen.fallback
  }
}

// Out of range is not the same as invalid.
//
// A number past a bound is a value the user meant -- 9999 visible popups is an
// ambition, not a typo -- so it clamps to the bound. A string, a NaN or an
// Infinity is not a value at all, so it falls back to the default. Collapsing
// the two would turn one bad character in a hand-edited file into a setting the
// user never chose and cannot see.
function clampNumber(value, min, max, fallback) {
  if (typeof value !== "number" || !isFinite(value)) return fallback
  if (value < min) return min
  if (value > max) return max
  return Math.round(value)
}

function clampDuration(value, fallback) {
  if (typeof value !== "number" || !isFinite(value)) return fallback
  // Exactly 0 is the sentinel for "never". Nothing else is allowed to round
  // into it: a 1 ms duration is a mistake, and treating it as "never" would be
  // the opposite of what was asked.
  if (value === 0) return 0
  return clampNumber(value, MIN_DURATION, MAX_DURATION, fallback)
}

function clampSettings(value) {
  var input = value && typeof value === "object" && !Array.isArray(value) ? value : {}
  var out = defaultSettings()

  if (typeof input.dnd === "boolean") out.dnd = input.dnd
  if (typeof input.groupByApp === "boolean") out.groupByApp = input.groupByApp

  var durations = input.popupDurationMs
  if (durations && typeof durations === "object" && !Array.isArray(durations)) {
    for (var i = 0; i < URGENCY_NAMES.length; i++) {
      var name = URGENCY_NAMES[i]
      if (durations[name] !== undefined)
        out.popupDurationMs[name] = clampDuration(durations[name], DEFAULT_DURATIONS[name])
    }
  }

  for (var key in BOUNDS) {
    if (input[key] !== undefined)
      out[key] = clampNumber(input[key], BOUNDS[key].min, BOUNDS[key].max, BOUNDS[key].fallback)
  }

  // `version` is deliberately not read from the input. This file writes v4 and
  // nothing else; what the document claimed to be is only interesting for
  // deciding whether it needs rewriting, which parseSettings works out from the
  // serialized form instead.
  return out
}

function hasLegacyPayload(parsed) {
  for (var i = 0; i < LEGACY_KEYS.length; i++) {
    if (parsed[LEGACY_KEYS[i]] !== undefined) return true
  }
  return false
}

// Returns { error, errorMessage, settings, dndPresent, needsRewrite }.
//
// `settings` is always complete and always clamped, whatever came in -- there is
// no input for which a consumer has to check before reading a field.
//
// `dndPresent` says whether the file actually carried a boolean `dnd`. Clamping
// turns an absent one into `false`, and the service must be able to tell those
// apart: PersistentProperties survives an in-process QML reload while the file
// may be missing or unreadable, so hydrating a `false` that was never written
// would silently switch do-not-disturb off under the user.
//
// `needsRewrite` answers "does the file on disk differ from what we would write
// now", which covers a v3 document, a legacy payload, an out-of-range value and
// a hand-edited whitespace change in one comparison. Deriving it from the
// serialized form rather than from a version number is what keeps an
// already-canonical file from being rewritten on every startup.
function parseSettings(raw) {
  var text = String(raw === null || raw === undefined ? "" : raw)
  var trimmed = text.trim()

  if (!trimmed) {
    return {
      error: false,
      errorMessage: "",
      settings: defaultSettings(),
      dndPresent: false,
      needsRewrite: true
    }
  }

  var parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch (e) {
    return {
      error: true,
      errorMessage: String(e),
      settings: defaultSettings(),
      dndPresent: false,
      needsRewrite: true
    }
  }

  var settings = clampSettings(parsed)
  var isObject = !!parsed && typeof parsed === "object" && !Array.isArray(parsed)
  var legacy = isObject ? hasLegacyPayload(parsed) : false

  return {
    error: false,
    errorMessage: "",
    settings: settings,
    dndPresent: isObject && typeof parsed.dnd === "boolean",
    needsRewrite: legacy || serializeSettings(settings) !== text
  }
}

// Key order is fixed here rather than taken from the caller's object, so the
// same settings always produce byte-identical output. Without that, an
// unchanged settings object could serialize differently and trigger a file
// write on every load.
//
// Two-space indent and a trailing newline match how upstream writes this file,
// and keep it comfortable to hand-edit.
function serializeSettings(value) {
  var s = clampSettings(value)
  return JSON.stringify({
    version: s.version,
    dnd: s.dnd,
    popupDurationMs: {
      low: s.popupDurationMs.low,
      normal: s.popupDurationMs.normal,
      critical: s.popupDurationMs.critical
    },
    maxPopupDurationMs: s.maxPopupDurationMs,
    maxVisiblePopups: s.maxVisiblePopups,
    groupByApp: s.groupByApp,
    historyLimit: s.historyLimit,
    historyLastSeen: s.historyLastSeen
  }, null, 2) + "\n"
}
