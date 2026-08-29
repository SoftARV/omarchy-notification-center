// Which toasts leave when the screen is full. Pure, so the rule is settled
// before anything touches a live model.

var test = require("node:test")
var assert = require("node:assert")
var harness = require("./harness.js")

var policy = harness.load("NotificationPolicy.js")

var LOW = 0, NORMAL = 1, CRITICAL = 2

// Rows as popupModel holds them: newest first.
function rows(n, over) {
  var out = []
  for (var i = n; i >= 1; i--) {
    var row = { originalId: i, timestamp: i * 1000, urgency: NORMAL, summary: "n" + i }
    if (over && over[i]) for (var k in over[i]) row[k] = over[i][k]
    out.push(row)
  }
  return out
}

function ids(picked) {
  return picked.map(function(p) { return p.originalId })
}

test("nothing is evicted at or under the cap", function() {
  assert.deepStrictEqual(policy.rowsToEvict(rows(3), 3, CRITICAL), [])
  assert.deepStrictEqual(policy.rowsToEvict(rows(1), 3, CRITICAL), [])
  assert.deepStrictEqual(policy.rowsToEvict([], 3, CRITICAL), [])
})

test("over the cap it evicts exactly the overflow", function() {
  assert.strictEqual(policy.rowsToEvict(rows(4), 3, CRITICAL).length, 1)
  assert.strictEqual(policy.rowsToEvict(rows(20), 3, CRITICAL).length, 17)
  assert.strictEqual(policy.rowsToEvict(rows(20), 1, CRITICAL).length, 19)
})

// The newest is what the user is most likely reading.
test("the oldest go and the newest stay", function() {
  var picked = policy.rowsToEvict(rows(20), 3, CRITICAL)
  assert.deepStrictEqual(ids(picked).sort(function(a, b) { return a - b }),
    [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17])
  ;[18, 19, 20].forEach(function(kept) {
    assert.strictEqual(ids(picked).indexOf(kept), -1, "n" + kept + " should survive")
  })
})

test("identities carry originalId and timestamp, never an index", function() {
  var picked = policy.rowsToEvict(rows(5), 3, CRITICAL)
  picked.forEach(function(p) {
    assert.strictEqual(typeof p.originalId, "number")
    assert.strictEqual(typeof p.timestamp, "number")
    assert.strictEqual(p.index, undefined, "an index would be stale by the time it is used")
  })
  assert.deepStrictEqual(picked.map(function(p) { return p.timestamp }).sort(), [1000, 2000])
})

// A cap is a comfort feature. Dropping an emergency alert to honour one is a
// bug no default makes right.
test("criticals are never evicted", function() {
  var picked = policy.rowsToEvict(rows(6, { 1: { urgency: CRITICAL }, 2: { urgency: CRITICAL } }), 3, CRITICAL)
  assert.strictEqual(ids(picked).indexOf(1), -1)
  assert.strictEqual(ids(picked).indexOf(2), -1)
})

test("a screen of criticals exceeds the cap rather than dropping one", function() {
  var all = rows(5).map(function(r) { r.urgency = CRITICAL; return r })
  assert.deepStrictEqual(policy.rowsToEvict(all, 1, CRITICAL), [])
  assert.deepStrictEqual(policy.rowsToEvict(all, 0, CRITICAL), [])
})

test("with a mix it takes only non-criticals, and stops when they run out", function() {
  // 3 critical + 3 normal, cap 2 -> overflow is 4, but only 3 are evictable.
  var mixed = rows(6, { 4: { urgency: CRITICAL }, 5: { urgency: CRITICAL }, 6: { urgency: CRITICAL } })
  var picked = policy.rowsToEvict(mixed, 2, CRITICAL)
  assert.deepStrictEqual(ids(picked).sort(function(a, b) { return a - b }), [1, 2, 3])
  assert.strictEqual(picked.length, 3, "not the full overflow of 4 — criticals are not available")
})

test("low urgency is evictable; only critical is exempt", function() {
  var low = rows(4, { 1: { urgency: LOW } })
  assert.deepStrictEqual(ids(policy.rowsToEvict(low, 3, CRITICAL)), [1])
})

// The row order given is not guaranteed, so selection must sort rather than
// assume newest-first.
test("selection does not depend on the order rows arrive in", function() {
  var newestFirst = rows(5)
  var oldestFirst = rows(5).slice().reverse()
  var shuffled = [newestFirst[2], newestFirst[0], newestFirst[4], newestFirst[1], newestFirst[3]]
  var expected = [1, 2]
  ;[newestFirst, oldestFirst, shuffled].forEach(function(order) {
    assert.deepStrictEqual(ids(policy.rowsToEvict(order, 3, CRITICAL)).sort(), expected)
  })
})

test("malformed input yields an empty selection rather than throwing", function() {
  var bad = [null, undefined, "rows", 42, {}, [null], [undefined], ["x"], [{}], [{ timestamp: "x" }]]
  bad.forEach(function(r) {
    assert.deepStrictEqual(policy.rowsToEvict(r, 3, CRITICAL), [], "for " + JSON.stringify(r))
  })
})

test("a missing or nonsense cap evicts nothing", function() {
  ;[0, -1, null, undefined, NaN, "three", {}].forEach(function(max) {
    assert.deepStrictEqual(policy.rowsToEvict(rows(10), max, CRITICAL), [], "for cap " + String(max))
  })
})

// Without a usable urgency value, treating everything as evictable could drop a
// critical. Treating nothing as evictable only means the cap is exceeded.
test("a missing critical urgency value evicts nothing", function() {
  ;[null, undefined, NaN, "critical"].forEach(function(crit) {
    assert.deepStrictEqual(policy.rowsToEvict(rows(10), 3, crit), [], "for " + String(crit))
  })
})

test("rowsToEvict does not mutate the rows it is given", function() {
  var input = rows(5)
  var copy = JSON.parse(JSON.stringify(input))
  policy.rowsToEvict(input, 2, CRITICAL)
  assert.deepStrictEqual(input, copy)
})
