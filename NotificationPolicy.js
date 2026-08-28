// Version 4 of notifications.json, superseding upstream's dnd-only parse.
// Pure, so it is unit testable; anything needing a shell goes in
// NotificationState.qml. See docs/spec/SPEC-settings.md.

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

// Out of range is not invalid. A number past a bound is a value the user
// meant, so it clamps; a string or NaN is not a value at all, so it falls
// back to the default.
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

  // `version` is not read from the input: this writes v4 and nothing else.
  return out
}

function hasLegacyPayload(parsed) {
  for (var i = 0; i < LEGACY_KEYS.length; i++) {
    if (parsed[LEGACY_KEYS[i]] !== undefined) return true
  }
  return false
}

// `settings` is always complete. `dndPresent` distinguishes an absent dnd from
// a false one, so hydration cannot switch DND off under a user who had it on.
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

  // needsRewrite compares the file against what would be written now, catching
  // a v3 document, legacy payload, bad value or whitespace edit at once -- and
  // leaving an already-canonical file alone on every startup.
  return {
    error: false,
    errorMessage: "",
    settings: settings,
    dndPresent: isObject && typeof parsed.dnd === "boolean",
    needsRewrite: legacy || serializeSettings(settings) !== text
  }
}

// Key order is fixed rather than taken from the caller's object, so unchanged
// settings always serialize identically and cannot trigger a spurious write.
// Two-space indent and trailing newline match how upstream writes this file.
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
