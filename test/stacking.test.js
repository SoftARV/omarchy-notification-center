// Turning the flat row list into decks. Pure, so the grouping rule is settled
// before any QML depends on it.

var test = require("node:test")
var assert = require("node:assert")
var harness = require("./harness.js")

var policy = harness.load("NotificationPolicy.js")

// Rows as popupModel holds them: newest first.
function row(id, app, ts) {
  return { originalId: id, timestamp: ts, app: app, summary: app + " " + id, urgency: 1 }
}

function keys(groups) { return groups.map(function(g) { return g.key }) }
function counts(groups) { return groups.map(function(g) { return g.rows.length }) }

test("rows from one app collapse into a single group", function() {
  var g = policy.groupPopups([row(3, "Slack", 3000), row(2, "Slack", 2000), row(1, "Slack", 1000)], true)
  assert.strictEqual(g.length, 1)
  assert.strictEqual(g[0].rows.length, 3)
  assert.strictEqual(g[0].app, "Slack")
  assert.strictEqual(g[0].newest, 3000)
})

test("the key is the app trimmed and lowercased", function() {
  var g = policy.groupPopups([row(3, "Slack", 3000), row(2, "slack", 2000), row(1, " Slack ", 1000)], true)
  assert.strictEqual(g.length, 1, "case and padding must not split a deck")
  assert.strictEqual(g[0].key, "slack")
})

test("different apps get different groups", function() {
  var g = policy.groupPopups([row(3, "Mail", 3000), row(2, "Slack", 2000), row(1, "Slack", 1000)], true)
  assert.strictEqual(g.length, 2)
  assert.deepStrictEqual(counts(g), [1, 2])
})

// Newest-group-first, so a deck rises when it receives a notification.
test("groups are ordered by their newest member", function() {
  var g = policy.groupPopups([
    row(5, "Mail", 5000), row(4, "Slack", 4000), row(3, "Disc", 3000),
    row(2, "Slack", 2000), row(1, "Disc", 1000)
  ], true)
  assert.deepStrictEqual(keys(g), ["mail", "slack", "disc"])
})

test("a deck rises to the top when it gains a newer row", function() {
  var before = policy.groupPopups([row(3, "Mail", 3000), row(2, "Slack", 2000)], true)
  assert.deepStrictEqual(keys(before), ["mail", "slack"])

  var after = policy.groupPopups([row(4, "Slack", 4000), row(3, "Mail", 3000), row(2, "Slack", 2000)], true)
  assert.deepStrictEqual(keys(after), ["slack", "mail"], "Slack should rise")
  assert.strictEqual(after[0].rows.length, 2)
})

test("rows inside a group stay newest first", function() {
  var g = policy.groupPopups([row(1, "Slack", 1000), row(3, "Slack", 3000), row(2, "Slack", 2000)], true)
  assert.deepStrictEqual(g[0].rows.map(function(r) { return r.timestamp }), [3000, 2000, 1000])
})

// An empty key would herd unrelated senders into one deck.
test("rows with no app each get their own group", function() {
  var g = policy.groupPopups([row(3, "", 3000), row(2, "   ", 2000), row(1, "", 1000)], true)
  assert.strictEqual(g.length, 3, "three anonymous senders, three groups")
  assert.deepStrictEqual(counts(g), [1, 1, 1])
  assert.strictEqual(new Set(keys(g)).size, 3, "their keys must be distinct")
})

test("a missing app property is treated as no app", function() {
  var g = policy.groupPopups([{ originalId: 1, timestamp: 1000 }, { originalId: 2, timestamp: 2000 }], true)
  assert.strictEqual(g.length, 2)
})

test("grouping off yields one group per row", function() {
  var rows = [row(3, "Slack", 3000), row(2, "Slack", 2000), row(1, "Slack", 1000)]
  var g = policy.groupPopups(rows, false)
  assert.strictEqual(g.length, 3)
  assert.deepStrictEqual(counts(g), [1, 1, 1])
  assert.deepStrictEqual(g.map(function(x) { return x.rows[0].timestamp }), [3000, 2000, 1000])
})

test("every group key is unique, so delegates can be keyed by it", function() {
  var rows = [row(3, "Slack", 3000), row(2, "", 2000), row(1, "Slack", 1000)]
  ;[true, false].forEach(function(on) {
    var g = policy.groupPopups(rows, on)
    assert.strictEqual(new Set(keys(g)).size, g.length, "duplicate keys with grouping " + on)
  })
})

// popupModel is newest-first, but nothing guarantees a caller passes it that
// way, and a wrong assumption would put an old deck at the top.
test("ordering does not depend on the order rows arrive in", function() {
  var a = [row(3, "Mail", 3000), row(2, "Slack", 2000), row(1, "Slack", 1000)]
  var b = [row(1, "Slack", 1000), row(3, "Mail", 3000), row(2, "Slack", 2000)]
  assert.deepStrictEqual(keys(policy.groupPopups(a, true)), keys(policy.groupPopups(b, true)))
})

test("newest is the group's newest row timestamp", function() {
  var g = policy.groupPopups([row(2, "Slack", 2000), row(1, "Slack", 1000), row(3, "Mail", 500)], true)
  assert.strictEqual(g[0].newest, 2000)
  assert.strictEqual(g[1].newest, 500)
})

test("malformed input yields sane groups and never throws", function() {
  assert.deepStrictEqual(policy.groupPopups(null, true), [])
  assert.deepStrictEqual(policy.groupPopups(undefined, true), [])
  assert.deepStrictEqual(policy.groupPopups("rows", true), [])
  assert.deepStrictEqual(policy.groupPopups(42, true), [])
  assert.deepStrictEqual(policy.groupPopups([], true), [])
  assert.deepStrictEqual(policy.groupPopups([null, undefined, "x", 7], true), [],
    "rows that are not objects are dropped, not grouped")
})

test("a missing grouping flag groups by app", function() {
  var rows = [row(2, "Slack", 2000), row(1, "Slack", 1000)]
  assert.strictEqual(policy.groupPopups(rows, undefined).length, 1, "default is grouped")
})

test("groupPopups does not mutate the rows it is given", function() {
  var rows = [row(2, "Slack", 2000), row(1, "Slack", 1000)]
  var copy = JSON.parse(JSON.stringify(rows))
  policy.groupPopups(rows, true)
  assert.deepStrictEqual(rows, copy)
})

// The deck renders these rows directly, so they must be the rows themselves.
test("group rows are the caller's row objects, not copies", function() {
  var r = row(1, "Slack", 1000)
  var g = policy.groupPopups([r], true)
  assert.strictEqual(g[0].rows[0], r)
})
