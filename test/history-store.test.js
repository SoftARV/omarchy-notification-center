// History parsing is upstream's already. These tests pin the behaviour this
// module now depends on, so an upstream change surfaces here at merge time
// rather than as an empty panel.

var test = require("node:test")
var assert = require("node:assert")
var fs = require("node:fs")
var os = require("node:os")
var path = require("node:path")
var harness = require("./harness.js")

var policy = harness.load("NotificationPolicy.js")
var logic = harness.load("NotificationLogic.js")

var NORMAL = 1

function entry(over) {
  var e = {
    id: 1, originalId: 1, app: "App", appIcon: "", summary: "s", body: "b",
    image: "", glyph: "", execArgv: "", urgency: NORMAL, timestamp: 1000
  }
  for (var k in over) e[k] = over[k]
  return JSON.stringify(e)
}

// ------------------------------------------------ upstream parsing contract

test("rows come back newest first", function() {
  var raw = [entry({ summary: "old", timestamp: 1000 }),
             entry({ summary: "new", timestamp: 3000 }),
             entry({ summary: "mid", timestamp: 2000 })].join("\n")
  var rows = logic.historyRows(raw, [], NORMAL, 100)
  assert.deepStrictEqual(rows.map(function(r) { return r.summary }), ["new", "mid", "old"])
})

// The failure this prevents: one crash-torn file costing the whole history.
test("a torn entry between two good ones costs only itself", function() {
  var raw = [entry({ summary: "before", timestamp: 1000 }),
             '{"summary": "torn', 
             entry({ summary: "after", timestamp: 2000 })].join("\n")
  var rows = logic.historyRows(raw, [], NORMAL, 100)
  assert.strictEqual(rows.length, 2)
  assert.deepStrictEqual(rows.map(function(r) { return r.summary }), ["after", "before"])
})

test("empty and malformed input yield an empty array, never null", function() {
  ;["", "   ", "\n\n", "not json at all", "{", "null", "[]"].forEach(function(raw) {
    var rows = logic.historyRows(raw, [], NORMAL, 100)
    assert.ok(Array.isArray(rows), "for " + JSON.stringify(raw))
  })
})

// The rows feed NotificationCard unchanged, so they must carry every role a
// popupModel row does.
test("rows carry every role a card renders", function() {
  var rows = logic.historyRows(entry({ image: "/tmp/i.png", execArgv: '["echo","hi"]', glyph: "X" }),
    [], NORMAL, 100)
  var required = ["id", "originalId", "app", "appIcon", "summary", "body",
                  "image", "glyph", "execArgv", "urgency", "expireTimeout", "timestamp"]
  required.forEach(function(role) {
    assert.ok(role in rows[0], "missing role: " + role)
  })
  assert.strictEqual(rows[0].image, "/tmp/i.png")
  assert.strictEqual(rows[0].execArgv, '["echo","hi"]')
})

test("the limit is honoured, keeping the newest", function() {
  var raw = []
  for (var i = 1; i <= 10; i++) raw.push(entry({ summary: "n" + i, timestamp: i * 1000 }))
  var rows = logic.historyRows(raw.join("\n"), [], NORMAL, 3)
  assert.deepStrictEqual(rows.map(function(r) { return r.summary }), ["n10", "n9", "n8"])
})

// Real files this machine actually wrote, rather than only hand-built fixtures.
test("real history files on this machine parse", function() {
  var dir = path.join(os.homedir(), ".local/state/omarchy/notifications/history")
  if (!fs.existsSync(dir)) return
  var files = fs.readdirSync(dir).filter(function(f) { return f.endsWith(".json") })
  if (files.length === 0) return

  var raw = files.map(function(f) {
    return fs.readFileSync(path.join(dir, f), "utf8").trim()
  }).join("\n")

  var rows = logic.historyRows(raw, [], NORMAL, 500)
  assert.strictEqual(rows.length, files.length, "every real file should parse")
  rows.forEach(function(r) {
    assert.strictEqual(typeof r.summary, "string")
    assert.strictEqual(typeof r.timestamp, "number")
  })
  for (var i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].timestamp >= rows[i].timestamp, "should be newest first")
  }
})

// ----------------------------------------------------- the unread predicate

// History files are named <timestamp>-<id>.json, so "is anything newer than
// the last look" is answered without opening a single file.
test("hasUnreadIn is true when a filename timestamp beats lastSeen", function() {
  assert.strictEqual(policy.hasUnreadIn(["2000-1.json"], 1000), true)
  assert.strictEqual(policy.hasUnreadIn(["500-1.json", "2000-2.json"], 1000), true)
  assert.strictEqual(policy.hasUnreadIn(["1787931019798-18.json"], 0), true)
})

test("hasUnreadIn is false when nothing is newer", function() {
  assert.strictEqual(policy.hasUnreadIn(["500-1.json"], 1000), false)
  assert.strictEqual(policy.hasUnreadIn(["1000-1.json"], 1000), false, "equal is not newer")
  assert.strictEqual(policy.hasUnreadIn([], 1000), false)
  assert.strictEqual(policy.hasUnreadIn(["2000-1.json"], 9999999999999), false, "lastSeen in the future")
})

test("hasUnreadIn ignores names it cannot read as a timestamp", function() {
  assert.strictEqual(policy.hasUnreadIn(["bad.json", "notatimestamp-1.json", ""], 0), false)
  assert.strictEqual(policy.hasUnreadIn(["-1.json"], 0), false)
  assert.strictEqual(policy.hasUnreadIn([".json"], 0), false)
  // A good name alongside unreadable ones still counts.
  assert.strictEqual(policy.hasUnreadIn(["bad.json", "2000-1.json"], 1000), true)
})

test("hasUnreadIn never throws, whatever it is handed", function() {
  var inputs = [null, undefined, "string", 42, {}, [null], [undefined], [{}], [[]], ["x"]]
  var seens = [0, 1000, null, undefined, NaN, Infinity, -1, "1000", {}]
  inputs.forEach(function(names) {
    seens.forEach(function(seen) {
      var r = policy.hasUnreadIn(names, seen)
      assert.strictEqual(typeof r, "boolean",
        "for " + JSON.stringify(names) + " / " + String(seen))
    })
  })
})

// A missing or unusable lastSeen must mean "everything is unread", not
// "nothing is" -- failing dark would hide the notifications this exists for.
test("an unusable lastSeen treats existing history as unread", function() {
  assert.strictEqual(policy.hasUnreadIn(["2000-1.json"], null), true)
  assert.strictEqual(policy.hasUnreadIn(["2000-1.json"], undefined), true)
  assert.strictEqual(policy.hasUnreadIn(["2000-1.json"], NaN), true)
  assert.strictEqual(policy.hasUnreadIn(["2000-1.json"], "nonsense"), true)
})

test("hasUnreadIn short-circuits on the first newer file", function() {
  var names = ["9999-1.json"]
  for (var i = 0; i < 5000; i++) names.push("1-" + i + ".json")
  var t0 = Date.now()
  assert.strictEqual(policy.hasUnreadIn(names, 100), true)
  assert.ok(Date.now() - t0 < 50, "should not scan the whole list")
})
