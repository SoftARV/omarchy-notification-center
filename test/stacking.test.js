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

// ------------------------------------------------------ the index hazard

var fs = require("node:fs")
var path = require("node:path")
var ROOT = path.join(__dirname, "..")

// Inside a deck the delegate's index is not the popupModel index, and an index
// captured earlier goes stale the moment any row is removed. SPEC.md lists
// index-based dismissal under Never; these files are where it would creep in.
var DECK_FILES = ["components/PopupSlot.qml", "components/NotificationDeck.qml"]

function existing(files) {
  return files.filter(function(f) { return fs.existsSync(path.join(ROOT, f)) })
}

test("the slot component exists", function() {
  assert.ok(fs.existsSync(path.join(ROOT, "components/PopupSlot.qml")),
    "components/PopupSlot.qml should hold the delegate body")
})

test("no deck component dismisses, expires or invokes by index", function() {
  var offenders = []
  existing(DECK_FILES).forEach(function(file) {
    var text = fs.readFileSync(path.join(ROOT, file), "utf8")
    text.split("\n").forEach(function(line, i) {
      if (/\b(dismissPopup|expirePopup|invokePopupDefault)\s*\(/.test(line)) {
        offenders.push(file + ":" + (i + 1) + "  " + line.trim())
      }
    })
  })
  assert.deepStrictEqual(offenders, [],
    "these take a popupModel index; use the identity helpers instead")
})

// A slot draws one row and never needs to know where it sits.
test("the slot component holds no index at all", function() {
  var text = fs.readFileSync(path.join(ROOT, "components/PopupSlot.qml"), "utf8")
  assert.ok(!/^\s*(required\s+)?property\s+int\s+index\b/m.test(text),
    "a slot with an index would be one refactor away from dismissing by it")
})

// A deck needs a Repeater's own index for ghost offsets and for which cards are
// drawn -- layout, not identity. An earlier version banned the property
// outright and failed on both; the hazard is an index reaching a dismissal.
test("no index is ever passed to a dismissal", function() {
  var offenders = []
  existing(DECK_FILES).forEach(function(file) {
    var text = fs.readFileSync(path.join(ROOT, file), "utf8")
    text.split("\n").forEach(function(line, i) {
      if (/\b(dismissRow|expireRow|invokeRow)\s*\([^)]*\bindex\b/.test(line)) {
        offenders.push(file + ":" + (i + 1) + "  " + line.trim())
      }
    })
  })
  assert.deepStrictEqual(offenders, [], "dismiss by originalId and timestamp, never by position")
})

// ------------------------------------------------------------ deck layout

// How many cards a deck draws, how many ghost edges peek behind, and how many
// are held back. Pure, so the rules are testable without a screen.
test("a lone notification is drawn plainly, with no ghosts", function() {
  assert.deepStrictEqual(policy.deckLayout(1, false, 5), { shown: 1, ghosts: 0, hidden: 0 })
  assert.deepStrictEqual(policy.deckLayout(1, true, 5), { shown: 1, ghosts: 0, hidden: 0 })
})

// The stack itself is the signal that there is more than one; no count is drawn.
test("a collapsed deck shows the front card and up to two ghost edges", function() {
  assert.deepStrictEqual(policy.deckLayout(2, false, 5), { shown: 1, ghosts: 1, hidden: 1 })
  assert.deepStrictEqual(policy.deckLayout(3, false, 5), { shown: 1, ghosts: 2, hidden: 2 })
  assert.deepStrictEqual(policy.deckLayout(12, false, 5), { shown: 1, ghosts: 2, hidden: 11 },
    "ghosts stop at two however deep the stack")
})

test("an expanded deck fans out up to the limit and holds back the rest", function() {
  assert.deepStrictEqual(policy.deckLayout(3, true, 5), { shown: 3, ghosts: 0, hidden: 0 })
  assert.deepStrictEqual(policy.deckLayout(5, true, 5), { shown: 5, ghosts: 0, hidden: 0 })
  assert.deepStrictEqual(policy.deckLayout(12, true, 5), { shown: 5, ghosts: 0, hidden: 7 })
})

test("an empty deck draws nothing", function() {
  assert.deepStrictEqual(policy.deckLayout(0, false, 5), { shown: 0, ghosts: 0, hidden: 0 })
  assert.deepStrictEqual(policy.deckLayout(0, true, 5), { shown: 0, ghosts: 0, hidden: 0 })
})

test("shown plus hidden always accounts for every row", function() {
  for (var total = 0; total <= 20; total++) {
    ;[true, false].forEach(function(expanded) {
      var l = policy.deckLayout(total, expanded, 5)
      assert.strictEqual(l.shown + l.hidden, total,
        "lost a row at total=" + total + " expanded=" + expanded)
    })
  }
})

test("deckLayout survives nonsense arguments", function() {
  ;[null, undefined, NaN, -3, "x", {}].forEach(function(total) {
    var l = policy.deckLayout(total, false, 5)
    assert.strictEqual(l.shown, 0, "for total " + String(total))
    assert.strictEqual(l.ghosts, 0)
    assert.strictEqual(l.hidden, 0)
  })
  ;[null, undefined, 0, -1, "x"].forEach(function(limit) {
    var l = policy.deckLayout(10, true, limit)
    assert.ok(l.shown >= 1, "a broken limit must still draw the front card")
  })
})
