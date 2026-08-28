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

// ---------------------------------------------------------------- roles

// The IPC serialiser copies rows role by role. If that list and what
// historyRows produces ever diverge, entries lose fields silently -- an image
// or an execArgv going missing with nothing to notice it.
test("historyRoles names exactly the fields historyRows produces", function() {
  var produced = Object.keys(logic.historyRows(entry({}), [], NORMAL, 10)[0]).sort()
  assert.deepStrictEqual(policy.historyRoles().slice().sort(), produced)
})

test("historyRoles covers every role the card draws", function() {
  var roles = policy.historyRoles()
  logic.popupRoles().forEach(function(role) {
    assert.ok(roles.indexOf(role) !== -1, "card role missing from historyRoles: " + role)
  })
  ;["id", "originalId", "timestamp"].forEach(function(role) {
    assert.ok(roles.indexOf(role) !== -1, "identity role missing: " + role)
  })
})

test("historyRoles hands out a fresh array", function() {
  var a = policy.historyRoles()
  a.push("tampered")
  assert.strictEqual(policy.historyRoles().indexOf("tampered"), -1)
})
