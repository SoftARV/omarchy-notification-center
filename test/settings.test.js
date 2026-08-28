// Tests for the settings schema in NotificationPolicy.js.
//
// This file decides what every other module reads. A settings object that is
// missing a key, or that silently turns a typo into a 500 ms toast, is a bug
// that surfaces five modules away from here -- so the rules are pinned in
// detail rather than sampled.

var test = require("node:test")
var assert = require("node:assert")
var harness = require("./harness.js")

var policy = harness.load("NotificationPolicy.js")

var KEYS = [
  "version", "dnd", "popupDurationMs", "maxPopupDurationMs",
  "maxVisiblePopups", "groupByApp", "historyLimit", "historyLastSeen"
]

// ------------------------------------------------------------- defaults

test("defaultSettings returns the whole v4 schema", function() {
  var d = policy.defaultSettings()
  assert.deepStrictEqual(Object.keys(d).sort(), KEYS.slice().sort())
  assert.strictEqual(d.version, 4)
  assert.strictEqual(d.dnd, false)
  assert.deepStrictEqual(d.popupDurationMs, { low: 5000, normal: 8000, critical: 0 })
  assert.strictEqual(d.maxPopupDurationMs, 30000)
  assert.strictEqual(d.maxVisiblePopups, 4)
  assert.strictEqual(d.groupByApp, true)
  assert.strictEqual(d.historyLimit, 100)
  assert.strictEqual(d.historyLastSeen, 0)
})

// The defaults are upstream's own constants, so a user who never opens the
// settings panel sees no change in dismiss timing.
test("defaults match the constants upstream currently hardcodes", function() {
  var d = policy.defaultSettings()
  assert.strictEqual(d.popupDurationMs.low, 5000)     // lowPopupDuration
  assert.strictEqual(d.popupDurationMs.normal, 8000)  // normalPopupDuration
  assert.strictEqual(d.maxPopupDurationMs, 30000)     // maxPopupDuration
  assert.strictEqual(d.popupDurationMs.critical, 0)   // critical never expires
})

// A shared mutable default would let one caller's edit leak into every later
// read, which is the kind of bug that takes a day to find.
test("defaultSettings hands out a fresh object every time", function() {
  var a = policy.defaultSettings()
  var b = policy.defaultSettings()
  assert.notStrictEqual(a, b)
  assert.notStrictEqual(a.popupDurationMs, b.popupDurationMs, "the nested object must be fresh too")
  a.maxVisiblePopups = 99
  a.popupDurationMs.low = 1
  assert.strictEqual(policy.defaultSettings().maxVisiblePopups, 4)
  assert.strictEqual(policy.defaultSettings().popupDurationMs.low, 5000)
})

// ------------------------------------------------------------- clamping

// Consumers read forkState.settings unconditionally. There is no input for
// which clampSettings may return something incomplete.
test("clampSettings returns a complete object for any input at all", function() {
  var inputs = [null, undefined, {}, [], "nonsense", 42, true, function() {}, { popupDurationMs: null }]
  inputs.forEach(function(input) {
    var s = policy.clampSettings(input)
    assert.deepStrictEqual(Object.keys(s).sort(), KEYS.slice().sort(),
      "incomplete for input: " + JSON.stringify(input))
    assert.strictEqual(typeof s.popupDurationMs.low, "number")
    assert.strictEqual(typeof s.popupDurationMs.normal, "number")
    assert.strictEqual(typeof s.popupDurationMs.critical, "number")
  })
})

// Out of range is not the same as invalid. A number past a bound is a value the
// user meant, so it clamps to the bound; a string or a NaN is not a value at
// all, so it falls back to the default.
test("out-of-range numbers clamp to the nearest bound", function() {
  assert.strictEqual(policy.clampSettings({ maxVisiblePopups: 9999 }).maxVisiblePopups, 20)
  assert.strictEqual(policy.clampSettings({ maxVisiblePopups: 0 }).maxVisiblePopups, 1)
  assert.strictEqual(policy.clampSettings({ maxVisiblePopups: -1 }).maxVisiblePopups, 1)
  assert.strictEqual(policy.clampSettings({ historyLimit: -1 }).historyLimit, 1)
  assert.strictEqual(policy.clampSettings({ historyLimit: 99999 }).historyLimit, 500)
  assert.strictEqual(policy.clampSettings({ maxPopupDurationMs: 10 }).maxPopupDurationMs, 1000)
  assert.strictEqual(policy.clampSettings({ maxPopupDurationMs: 9e9 }).maxPopupDurationMs, 300000)
  assert.strictEqual(policy.clampSettings({ historyLastSeen: -5 }).historyLastSeen, 0)
})

test("invalid values fall back to the default, not to a bound", function() {
  var d = policy.defaultSettings()
  assert.strictEqual(policy.clampSettings({ maxVisiblePopups: "lots" }).maxVisiblePopups, d.maxVisiblePopups)
  assert.strictEqual(policy.clampSettings({ maxVisiblePopups: NaN }).maxVisiblePopups, d.maxVisiblePopups)
  assert.strictEqual(policy.clampSettings({ maxVisiblePopups: Infinity }).maxVisiblePopups, d.maxVisiblePopups)
  assert.strictEqual(policy.clampSettings({ maxVisiblePopups: null }).maxVisiblePopups, d.maxVisiblePopups)
  assert.strictEqual(policy.clampSettings({ historyLimit: {} }).historyLimit, d.historyLimit)
  assert.strictEqual(policy.clampSettings({ groupByApp: "yes" }).groupByApp, true)
  assert.strictEqual(policy.clampSettings({ groupByApp: 0 }).groupByApp, true)
  assert.strictEqual(policy.clampSettings({ groupByApp: false }).groupByApp, false)
})

// 0 means "never auto-dismiss" -- upstream's behavior for critical, and the
// only way a user makes any urgency sticky. It must survive clamping, and a
// too-short duration must never be rounded down into it.
test("a duration of 0 means never, and nothing else rounds into it", function() {
  assert.strictEqual(policy.clampSettings({ popupDurationMs: { normal: 0 } }).popupDurationMs.normal, 0)
  assert.strictEqual(policy.clampSettings({ popupDurationMs: { low: 0 } }).popupDurationMs.low, 0)
  assert.strictEqual(policy.clampSettings({ popupDurationMs: { normal: 1 } }).popupDurationMs.normal, 500)
  assert.strictEqual(policy.clampSettings({ popupDurationMs: { normal: 499 } }).popupDurationMs.normal, 500)
  assert.strictEqual(policy.clampSettings({ popupDurationMs: { normal: -1 } }).popupDurationMs.normal, 500)
  assert.strictEqual(policy.clampSettings({ popupDurationMs: { normal: 9e9 } }).popupDurationMs.normal, 300000)
})

test("a partial popupDurationMs keeps the defaults for the urgencies it omits", function() {
  var s = policy.clampSettings({ popupDurationMs: { low: 1500 } })
  assert.strictEqual(s.popupDurationMs.low, 1500)
  assert.strictEqual(s.popupDurationMs.normal, 8000)
  assert.strictEqual(s.popupDurationMs.critical, 0)
})

test("clampSettings does not mutate its argument", function() {
  var input = { maxVisiblePopups: 9999, popupDurationMs: { normal: 1 } }
  var copy = JSON.parse(JSON.stringify(input))
  policy.clampSettings(input)
  assert.deepStrictEqual(input, copy)
})

test("unknown keys are dropped rather than carried forward", function() {
  var s = policy.clampSettings({ maxVisiblePopups: 3, somethingElse: "hi" })
  assert.strictEqual(s.somethingElse, undefined)
  assert.strictEqual(s.maxVisiblePopups, 3)
})

test("version is always 4 regardless of what the file claimed", function() {
  assert.strictEqual(policy.clampSettings({ version: 3 }).version, 4)
  assert.strictEqual(policy.clampSettings({ version: 99 }).version, 4)
  assert.strictEqual(policy.clampSettings({ version: "x" }).version, 4)
})

// -------------------------------------------------------------- parsing

test("an absent or empty file yields defaults and asks to be written", function() {
  ;["", "   ", null, undefined].forEach(function(raw) {
    var r = policy.parseSettings(raw)
    assert.strictEqual(r.error, false)
    assert.deepStrictEqual(r.settings, policy.defaultSettings())
    assert.strictEqual(r.needsRewrite, true, "a missing file must be created")
  })
})

// The real file on this machine at the time this module was written.
test("the live v3 file migrates with its dnd intact", function() {
  var r = policy.parseSettings('{\n  "version": 3,\n  "dnd": false\n}\n')
  assert.strictEqual(r.error, false)
  assert.strictEqual(r.settings.dnd, false)
  assert.strictEqual(r.settings.version, 4)
  assert.strictEqual(r.settings.maxVisiblePopups, 4)
  assert.strictEqual(r.needsRewrite, true)
})

test("a v3 file with dnd on keeps it on", function() {
  var r = policy.parseSettings('{"version":3,"dnd":true}')
  assert.strictEqual(r.settings.dnd, true)
})

// Versions before history moved into its own directory kept notification
// arrays in here. They are dead payload; the rewrite is what removes them.
test("legacy pending/past/entries payloads are dropped and trigger a rewrite", function() {
  ;["pending", "past", "entries"].forEach(function(key) {
    var raw = {}
    raw.dnd = true
    raw[key] = [{ summary: "old" }]
    var r = policy.parseSettings(JSON.stringify(raw))
    assert.strictEqual(r.settings.dnd, true, key + ": dnd should survive")
    assert.strictEqual(r.settings[key], undefined, key + ": dead payload should be dropped")
    assert.strictEqual(r.needsRewrite, true)
  })
})

test("invalid JSON yields full defaults, reports once, and does not throw", function() {
  var r = policy.parseSettings("{")
  assert.strictEqual(r.error, true)
  assert.ok(r.errorMessage.length > 0)
  assert.deepStrictEqual(r.settings, policy.defaultSettings())
  assert.strictEqual(r.needsRewrite, true)
})

test("JSON that is valid but not an object yields defaults", function() {
  ;["[]", '"a string"', "42", "null", "true"].forEach(function(raw) {
    var r = policy.parseSettings(raw)
    assert.deepStrictEqual(r.settings, policy.defaultSettings(), "for " + raw)
  })
})

// The point of needsRewrite: a file already in canonical form must not be
// rewritten on every startup.
test("an already-canonical v4 file needs no rewrite", function() {
  var canonical = policy.serializeSettings(policy.defaultSettings())
  var r = policy.parseSettings(canonical)
  assert.strictEqual(r.error, false)
  assert.strictEqual(r.needsRewrite, false)
  assert.deepStrictEqual(r.settings, policy.defaultSettings())
})

test("a v4 file with out-of-range values is corrected and rewritten", function() {
  var r = policy.parseSettings('{"version":4,"maxVisiblePopups":9999,"groupByApp":"yes","historyLimit":-1}')
  assert.strictEqual(r.settings.maxVisiblePopups, 20)
  assert.strictEqual(r.settings.groupByApp, true)
  assert.strictEqual(r.settings.historyLimit, 1)
  assert.strictEqual(r.needsRewrite, true)
})

// ---------------------------------------------------------- serializing

test("serializeSettings round-trips through parseSettings", function() {
  var inputs = [
    policy.defaultSettings(),
    { dnd: true, maxVisiblePopups: 7, groupByApp: false, historyLimit: 25 },
    { popupDurationMs: { low: 0, normal: 20000, critical: 12000 }, historyLastSeen: 1787912153488 },
    {}
  ]
  inputs.forEach(function(input) {
    var text = policy.serializeSettings(input)
    assert.deepStrictEqual(policy.parseSettings(text).settings, policy.clampSettings(input))
  })
})

test("serialization is byte-stable for the same input", function() {
  var a = policy.serializeSettings({ maxVisiblePopups: 3 })
  var b = policy.serializeSettings({ maxVisiblePopups: 3 })
  assert.strictEqual(a, b)
  // Key order must not depend on the caller's object, or an unchanged settings
  // object would produce a spurious write.
  var c = policy.serializeSettings({ historyLimit: 50, dnd: true })
  var d = policy.serializeSettings({ dnd: true, historyLimit: 50 })
  assert.strictEqual(c, d)
})

test("serialized output ends with a newline, as upstream writes it", function() {
  assert.ok(/\n$/.test(policy.serializeSettings(policy.defaultSettings())))
})

test("serialized output is human-editable JSON", function() {
  var text = policy.serializeSettings(policy.defaultSettings())
  assert.ok(text.indexOf("\n  \"version\": 4") !== -1, "should be indented, one key per line")
  assert.doesNotThrow(function() { JSON.parse(text) })
})

// A stock omarchy reading our file must still find the key it expects, or a
// user switching back to the built-in plugin silently loses their DND setting.
test("a v4 file is still readable by upstream's own parser", function() {
  var upstream = harness.load("NotificationLogic.js")
  var text = policy.serializeSettings({ dnd: true })
  var parsed = upstream.parseSettings(text)
  assert.strictEqual(parsed.error, false)
  assert.strictEqual(parsed.dnd, true)
  assert.strictEqual(parsed.legacy, false)
})
