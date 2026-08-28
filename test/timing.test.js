// The lifetime feeds `remainingLifetime -= 50.0 / lifetime`, where a NaN never
// reaches zero and the toast never leaves. Every path is checked for finiteness.

var test = require("node:test")
var assert = require("node:assert")
var harness = require("./harness.js")

var policy = harness.load("NotificationPolicy.js")

// Quickshell's NotificationUrgency. The values match the freedesktop levels.
var URGENCY = { Low: 0, Normal: 1, Critical: 2 }

test("default settings reproduce upstream's constants exactly", function() {
  var d = policy.defaultSettings()
  assert.strictEqual(policy.durationFor(URGENCY.Low, d, URGENCY), 5000)
  assert.strictEqual(policy.durationFor(URGENCY.Normal, d, URGENCY), 8000)
  assert.strictEqual(policy.durationFor(URGENCY.Critical, d, URGENCY), 0)
})

test("the configured duration is returned for each urgency", function() {
  var s = policy.clampSettings({ popupDurationMs: { low: 1500, normal: 20000, critical: 12000 } })
  assert.strictEqual(policy.durationFor(URGENCY.Low, s, URGENCY), 1500)
  assert.strictEqual(policy.durationFor(URGENCY.Normal, s, URGENCY), 20000)
  assert.strictEqual(policy.durationFor(URGENCY.Critical, s, URGENCY), 12000)
})

// 0 is the sentinel for "never auto-dismiss" and must survive untouched.
test("zero is returned unchanged, for any urgency", function() {
  var s = policy.clampSettings({ popupDurationMs: { low: 0, normal: 0, critical: 0 } })
  assert.strictEqual(policy.durationFor(URGENCY.Low, s, URGENCY), 0)
  assert.strictEqual(policy.durationFor(URGENCY.Normal, s, URGENCY), 0)
  assert.strictEqual(policy.durationFor(URGENCY.Critical, s, URGENCY), 0)
})

// The app's expireTimeout is not a parameter: the user's setting wins outright.
test("durationFor takes no expireTimeout, so an app cannot influence it", function() {
  assert.strictEqual(policy.durationFor.length, 3)
})

// Upstream's switch sends Normal and everything unrecognised down `default:`.
test("an unknown urgency is treated as normal", function() {
  var d = policy.defaultSettings()
  ;[99, -1, undefined, null, "critical", {}, NaN].forEach(function(u) {
    assert.strictEqual(policy.durationFor(u, d, URGENCY), 8000, "for " + String(u))
  })
})

// Without the enum a critical must not silently become a normal toast that
// auto-dismisses, so the freedesktop urgency levels are the fallback.
test("a missing urgency enum falls back to the freedesktop levels", function() {
  var d = policy.defaultSettings()
  assert.strictEqual(policy.durationFor(2, d, null), 0, "2 is critical")
  assert.strictEqual(policy.durationFor(0, d, null), 5000, "0 is low")
  assert.strictEqual(policy.durationFor(1, d, undefined), 8000, "1 is normal")
})

test("malformed settings fall back to the built-in defaults", function() {
  var bad = [
    null, undefined, {}, [], "nonsense", 42,
    { popupDurationMs: null },
    { popupDurationMs: "nope" },
    { popupDurationMs: {} },
    { popupDurationMs: { normal: "20s" } },
    { popupDurationMs: { normal: NaN } },
    { popupDurationMs: { normal: Infinity } },
    { popupDurationMs: { normal: -5 } },
    { popupDurationMs: { normal: null } }
  ]
  bad.forEach(function(s) {
    assert.strictEqual(policy.durationFor(URGENCY.Normal, s, URGENCY), 8000,
      "for " + JSON.stringify(s))
  })
})

test("a malformed duration for one urgency does not disturb the others", function() {
  var s = { popupDurationMs: { low: 1500, normal: "broken", critical: 0 } }
  assert.strictEqual(policy.durationFor(URGENCY.Low, s, URGENCY), 1500)
  assert.strictEqual(policy.durationFor(URGENCY.Normal, s, URGENCY), 8000)
  assert.strictEqual(policy.durationFor(URGENCY.Critical, s, URGENCY), 0)
})

// The failure this guards is silent and permanent: a NaN lifetime means a toast
// that never expires and can only be dismissed by hand.
test("no input produces a NaN, an Infinity or a negative", function() {
  var settings = [
    null, undefined, {}, [], "x", 0, NaN,
    { popupDurationMs: { normal: NaN } },
    { popupDurationMs: { normal: -Infinity } },
    policy.defaultSettings(),
    policy.clampSettings({ popupDurationMs: { normal: 0 } })
  ]
  var urgencies = [URGENCY.Low, URGENCY.Normal, URGENCY.Critical, 99, null, undefined, NaN, "x"]
  var enums = [URGENCY, null, undefined, {}]

  settings.forEach(function(s) {
    urgencies.forEach(function(u) {
      enums.forEach(function(e) {
        var ms = policy.durationFor(u, s, e)
        assert.strictEqual(typeof ms, "number")
        assert.ok(isFinite(ms), "not finite for " + JSON.stringify(s) + " / " + String(u))
        assert.ok(ms >= 0, "negative for " + JSON.stringify(s) + " / " + String(u))
      })
    })
  })
})

test("durationFor does not mutate the settings it is given", function() {
  var s = policy.defaultSettings()
  var copy = JSON.parse(JSON.stringify(s))
  policy.durationFor(URGENCY.Normal, s, URGENCY)
  assert.deepStrictEqual(s, copy)
})

// What the shell will actually do: read the live settings, apply a change,
// and see the next toast get the new duration.
test("a duration set through withSetting is what durationFor then returns", function() {
  var s = policy.withSetting(policy.defaultSettings(), "duration.normal", 20000)
  assert.strictEqual(policy.durationFor(URGENCY.Normal, s, URGENCY), 20000)

  var sticky = policy.withSetting(s, "duration.normal", 0)
  assert.strictEqual(policy.durationFor(URGENCY.Normal, sticky, URGENCY), 0)
})
