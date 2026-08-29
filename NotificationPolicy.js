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

// ------------------------------------------------- IPC argument parsing

// Every IPC argument arrives from bash as a string and is as untrusted as
// notification content. null means "not a usable value" -- the caller rejects
// rather than guessing.
function parseCountArg(value) {
  if (typeof value === "number") return isFinite(value) && value === Math.round(value) ? value : null
  var text = String(value === null || value === undefined ? "" : value).trim()
  // Strict integers only. Number("12abc") is NaN, but a laxer parse would read
  // it as 12 and turn a typo into a setting the user never chose.
  if (!/^-?\d+$/.test(text)) return null
  var n = Number(text)
  return isFinite(n) ? n : null
}

var TRUE_WORDS = ["on", "true", "1", "yes"]
var FALSE_WORDS = ["off", "false", "0", "no"]

function parseBoolArg(value) {
  if (typeof value === "boolean") return value
  var text = String(value === null || value === undefined ? "" : value).trim().toLowerCase()
  if (TRUE_WORDS.indexOf(text) !== -1) return true
  if (FALSE_WORDS.indexOf(text) !== -1) return false
  return null
}

function isUrgencyName(name) {
  var text = String(name === null || name === undefined ? "" : name).trim().toLowerCase()
  return URGENCY_NAMES.indexOf(text) !== -1
}

// A new clamped object with one field changed, or null if unusable. New, not
// mutated: QML emits settingsChanged on reassignment, so editing in place
// would change the value while telling nobody.
function withSetting(settings, key, rawValue) {
  var base = clampSettings(settings)
  var next = clampSettings(base)

  if (key.indexOf("duration.") === 0) {
    var urgency = key.slice("duration.".length)
    if (!isUrgencyName(urgency)) return null
    var ms = parseCountArg(rawValue)
    if (ms === null) return null
    next.popupDurationMs[String(urgency).trim().toLowerCase()] = ms
    return clampSettings(next)
  }

  if (key === "groupByApp") {
    var on = parseBoolArg(rawValue)
    if (on === null) return null
    next.groupByApp = on
    return clampSettings(next)
  }

  if (!Object.prototype.hasOwnProperty.call(BOUNDS, key)) return null
  var n = parseCountArg(rawValue)
  if (n === null) return null
  next[key] = n
  return clampSettings(next)
}

// ------------------------------------------------------------ toast lifetime

// The freedesktop urgency levels, used only when the caller cannot supply
// Quickshell's enum. Without them a critical would fall through to normal and
// start auto-dismissing, which is the worst way for this to fail.
var FREEDESKTOP_URGENCY = { Low: 0, Normal: 1, Critical: 2 }

// Mirrors upstream's switch: Critical and Low are named, everything else --
// Normal included -- goes down the default branch.
function urgencyName(urgency, urgencyEnum) {
  var levels = urgencyEnum && urgencyEnum.Critical !== undefined ? urgencyEnum : FREEDESKTOP_URGENCY
  if (urgency === levels.Critical) return "critical"
  if (urgency === levels.Low) return "low"
  return "normal"
}

// How long a toast stays on screen, in ms; 0 means never. The app's
// expireTimeout is deliberately not a parameter -- the user's setting wins,
// and omitting it keeps that visible at the call site.
function durationFor(urgency, settings, urgencyEnum) {
  var name = urgencyName(urgency, urgencyEnum)
  var durations = settings && typeof settings === "object" ? settings.popupDurationMs : null
  var ms = durations && typeof durations === "object" ? durations[name] : undefined

  // Anything unusable falls back to the built-in default. A NaN reaching the
  // countdown would divide into it forever and the toast would never leave.
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return DEFAULT_DURATIONS[name]
  return ms
}

// ------------------------------------------------------------------ history

// Every field a history row carries. The IPC serialiser copies role by role, so
// this list drifting from what historyRows produces would drop fields silently.
var HISTORY_ROLES = [
  "id", "originalId", "app", "appIcon", "summary", "body",
  "image", "glyph", "execArgv", "urgency", "expireTimeout", "timestamp"
]

function historyRoles() {
  return HISTORY_ROLES.slice()
}

// Entries are addressed by identity, never by position: a re-read between
// rendering a list and clicking a row would otherwise fire the wrong
// notification's action. -1 when there is no exact match.
function historyRowIndex(rows, originalId, timestamp) {
  if (!Array.isArray(rows)) return -1
  var id = Number(originalId)
  var ts = Number(timestamp)
  if (!isFinite(id) || !isFinite(ts) || String(originalId) === "" || String(timestamp) === "") return -1

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i]
    if (!row || typeof row !== "object") continue
    if (Number(row.originalId) === id && Number(row.timestamp) === ts) return i
  }
  return -1
}

// ---------------------------------------------------------------- the cap

// Which rows leave when the screen holds more than maxVisible slots. A slot is
// a deck, so six pings cost the same as one notification, and a whole deck
// leaves at once. Returns identities, never indices.
function groupsToEvict(groups, maxVisible, criticalUrgency) {
  if (!Array.isArray(groups)) return []

  var max = Number(maxVisible)
  if (!isFinite(max) || max < 1) return []
  // Without a usable critical value every deck would look evictable, and a
  // dropped alert is worse than an over-full screen.
  if (typeof criticalUrgency !== "number" || !isFinite(criticalUrgency)) return []

  var usable = []
  for (var i = 0; i < groups.length; i++) {
    var group = groups[i]
    if (!group || typeof group !== "object" || !Array.isArray(group.rows)) continue
    if (group.rows.length === 0) continue

    // One critical anywhere in a deck protects the whole deck: evicting its
    // neighbours would leave a stack that no longer reads as one conversation.
    var hasCritical = false
    for (var r = 0; r < group.rows.length; r++) {
      if (group.rows[r] && group.rows[r].urgency === criticalUrgency) hasCritical = true
    }
    usable.push({ group: group, newest: Number(group.newest) || 0, critical: hasCritical })
  }

  var overflow = usable.length - max
  if (overflow < 1) return []

  // Oldest by the deck's NEWEST row, so a deck still receiving outlives an
  // older idle one.
  var candidates = usable.slice().sort(function(a, b) { return a.newest - b.newest })

  var picked = []
  var taken = 0
  for (var c = 0; c < candidates.length && taken < overflow; c++) {
    if (candidates[c].critical) continue
    var rows = candidates[c].group.rows
    for (var k = 0; k < rows.length; k++) {
      var row = rows[k]
      if (!row) continue
      var id = Number(row.originalId)
      var ts = Number(row.timestamp)
      if (!isFinite(id) || !isFinite(ts)) continue
      picked.push({ originalId: id, timestamp: ts })
    }
    taken++
  }
  return picked
}

// ------------------------------------------------------------- grouping

// The flat row list as decks: [{ key, app, rows, newest }]. Groups are ordered
// by their newest member, so a deck rises when it receives a notification --
// matching the flat stack's newest-first order.
function groupPopups(rows, groupByApp) {
  if (!Array.isArray(rows)) return []
  var grouped = groupByApp === undefined || groupByApp === null ? true : !!groupByApp

  var groups = []
  var byKey = {}

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i]
    if (!row || typeof row !== "object") continue

    var app = String(row.app === null || row.app === undefined ? "" : row.app).trim()
    var ts = Number(row.timestamp)
    if (!isFinite(ts)) ts = 0

    var shared = grouped && app.length > 0
    var key = shared ? app.toLowerCase()
                     : "row:" + String(row.originalId) + "-" + String(row.timestamp) + "-" + i

    // Anonymous and ungrouped rows are never registered for lookup, so they
    // cannot collide with an app whose name happens to look like a row key.
    var group = shared ? byKey[key] : null
    if (!group) {
      group = { key: key, app: app, rows: [], newest: ts }
      if (shared) byKey[key] = group
      groups.push(group)
    }
    group.rows.push(row)
    if (ts > group.newest) {
      group.newest = ts
      // The newest row names the deck, so a rename by replaces_id shows.
      group.app = app
    }
  }

  // Sorted rather than trusted: popupModel is newest-first, but nothing
  // guarantees a caller passes it that way, and the wrong assumption would put
  // a stale deck at the top.
  for (var g = 0; g < groups.length; g++) {
    groups[g].rows.sort(function(a, b) { return Number(b.timestamp) - Number(a.timestamp) })
  }
  groups.sort(function(a, b) { return b.newest - a.newest })
  return groups
}

// What a deck draws: the front card plus ghost edges when collapsed, or a fan
// of up to fanLimit cards when expanded. `hidden` rows still exist and still
// run their own countdowns -- they are simply not drawn.
function deckLayout(total, expanded, fanLimit) {
  var n = Number(total)
  if (!isFinite(n) || n < 1) return { shown: 0, ghosts: 0, hidden: 0 }
  n = Math.floor(n)

  var limit = Number(fanLimit)
  if (!isFinite(limit) || limit < 1) limit = 1

  if (!expanded) {
    // Two ghosts read as a stack; more would just be noise behind the card.
    return { shown: 1, ghosts: Math.min(n - 1, 2), hidden: n - 1 }
  }
  var shown = Math.min(n, limit)
  return { shown: shown, ghosts: 0, hidden: n - shown }
}
