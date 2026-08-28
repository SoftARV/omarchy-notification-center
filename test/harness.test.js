// Tests for the QML-JS harness.
//
// The harness is the load-bearing piece of this project's testing strategy: if
// it cannot load a QML .js resource, none of the pure logic in NotificationPolicy.js
// can be unit tested and every module falls back to manual checks. So it gets
// tested against a real upstream file rather than a fixture -- a harness that
// works on a contrived input and not on NotificationLogic.js is worthless.

var test = require("node:test")
var assert = require("node:assert")
var harness = require("./harness.js")

test("loads a QML JS resource and returns what it declares", function() {
  var logic = harness.load("NotificationLogic.js")
  assert.strictEqual(typeof logic.parseExecArgv, "function")
  assert.strictEqual(typeof logic.popupFileName, "function")
  assert.strictEqual(typeof logic.isEphemeralApp, "function")
  assert.strictEqual(typeof logic.snapshotOf, "function")
})

// The returned surface is only what the resource declares. If ambient globals
// leaked into it, a test could assert against `console` and believe it had
// found a notification function.
test("returns only declarations, not ambient globals", function() {
  var logic = harness.load("NotificationLogic.js")
  assert.strictEqual(logic.console, undefined)
  assert.strictEqual(logic.Math, undefined)
  assert.strictEqual(logic.JSON, undefined)
  assert.strictEqual(logic.Date, undefined)
})

// Proving the harness exercises behavior rather than merely importing names.
// parseExecArgv is the right function to prove it on: it is the fork's only
// path from notification content to process execution, so its fail-closed
// behavior is the one piece of upstream logic worth being certain about.
test("runs real logic: parseExecArgv accepts a well-formed argv", function() {
  var logic = harness.load("NotificationLogic.js")
  assert.deepStrictEqual(
    logic.parseExecArgv('["notify-send","hi"]'),
    ["notify-send", "hi"])
})

test("runs real logic: parseExecArgv fails closed", function() {
  var logic = harness.load("NotificationLogic.js")
  // A leading-dash program would be read as an option by argv.
  assert.strictEqual(logic.parseExecArgv('["-rf"]'), null)
  // Not an array.
  assert.strictEqual(logic.parseExecArgv('"just a string"'), null)
  // Not JSON at all.
  assert.strictEqual(logic.parseExecArgv("notify-send hi"), null)
  // Empty argv, and a non-string element.
  assert.strictEqual(logic.parseExecArgv("[]"), null)
  assert.strictEqual(logic.parseExecArgv('["sh",2]'), null)
  // Absent hint.
  assert.strictEqual(logic.parseExecArgv(""), null)
  assert.strictEqual(logic.parseExecArgv(null), null)
})

test("runs real logic: file naming and app classification", function() {
  var logic = harness.load("NotificationLogic.js")
  assert.strictEqual(logic.popupFileName({ timestamp: 1, originalId: 2 }), "1-2.json")
  assert.strictEqual(logic.isEphemeralApp("notify-send"), true)
  assert.strictEqual(logic.isEphemeralApp("omarchy-action"), true)
  assert.strictEqual(logic.isEphemeralApp("Slack"), false)
  assert.strictEqual(logic.isEphemeralApp(""), false)
})

// Every module's tests will load through here. A typo in a path must say so,
// not surface later as "cannot read property of undefined" in an assertion.
test("a missing resource fails with a message naming the path", function() {
  assert.throws(
    function() { harness.load("NoSuchThing.js") },
    function(err) {
      assert.match(err.message, /NoSuchThing\.js/)
      assert.match(err.message, /harness/)
      return true
    })
})

// A resource reaching for a QML-only global (Qt, Quickshell, NotificationUrgency)
// is not testable, and the failure should name the file rather than arriving as
// a bare ReferenceError from somewhere inside vm.
test("a resource that throws on load reports which resource", function() {
  assert.throws(
    function() { harness.load("Service.qml") },
    function(err) {
      assert.match(err.message, /Service\.qml/)
      return true
    })
})

test("paths resolve from the repo root, not the test directory", function() {
  var logic = harness.load("NotificationLogic.js")
  assert.strictEqual(typeof logic.parseExecArgv, "function")
})

// Regression. The harness first ran resources in a fresh vm context, which is
// the obvious choice and quietly wrong: every value crossing back out carried
// that realm's prototypes, so deepStrictEqual reported "same structure but not
// reference-equal" on an array that was correct in every observable way.
//
// Six modules will assert on returned arrays and objects -- groupPopups,
// parseSettings, popupRoles. Had this stayed, each of them would have paid a
// tax to buy isolation none of them needed.
test("returned values carry host prototypes, so deepStrictEqual works", function() {
  var logic = harness.load("NotificationLogic.js")

  var roles = logic.popupRoles()
  assert.ok(Array.isArray(roles), "an array from the resource must be a host Array")
  assert.deepStrictEqual(
    logic.parseExecArgv('["notify-send","hi"]'),
    ["notify-send", "hi"])

  var snapshot = logic.snapshotOf({ id: 7, summary: "s", appName: "a" }, 1234)
  assert.strictEqual(Object.getPrototypeOf(snapshot), Object.prototype)
  assert.strictEqual(snapshot.originalId, 7)
  assert.strictEqual(snapshot.timestamp, 1234)
})

// Declaration discovery is a regex over the source, so it is worth pinning what
// it does and does not see. A missed declaration surfaces as undefined in the
// test that wanted it -- a loud failure, not a silent pass.
test("finds top-level declarations and ignores indented ones", function() {
  var names = harness.declarationNames([
    "function top() {}",
    "var TOP_VALUE = 1",
    "function outer() {",
    "  var inner = 2",
    "  function alsoInner() {}",
    "}"
  ].join("\n"))

  assert.deepStrictEqual(names, ["top", "TOP_VALUE", "outer"])
})

test("loads every function NotificationLogic.js declares", function() {
  var logic = harness.load("NotificationLogic.js")
  var fns = Object.keys(logic).filter(function(k) { return typeof logic[k] === "function" })
  // Upstream's file is a flat list of helpers; if a load silently returned
  // almost nothing, this is what would notice.
  assert.ok(fns.length > 20, "expected the full helper surface, got " + fns.length)
})
