// Comment blocks are capped at three lines. A wall of comments is skipped as
// readily as none at all, and rots faster than the code beneath it.

var test = require("node:test")
var assert = require("node:assert")
var fs = require("node:fs")
var cp = require("node:child_process")
var path = require("node:path")

var ROOT = path.join(__dirname, "..")
var MAX = 3

// Upstream's files are not ours to trim. Service.qml is mixed, so only its
// `// fork:` blocks are checked.
var OURS = ["NotificationPolicy.js", "NotificationState.qml", "scripts/check-delta.sh"]
var UPSTREAM = ["NotificationLogic.js", "components/NotificationCard.qml"]

function sourceFiles() {
  var files = OURS.slice()
  fs.readdirSync(path.join(ROOT, "test")).forEach(function(name) {
    if (name.endsWith(".js")) files.push("test/" + name)
  })
  return files
}

function isComment(line, file) {
  var s = line.trim()
  if (file.endsWith(".sh")) return s.indexOf("#") === 0 && s.indexOf("#!") !== 0
  return s.indexOf("//") === 0
}

// Returns [{ line, length }] for every run of comment lines longer than MAX.
function overlongBlocks(lines, file) {
  var over = []
  var run = 0
  var start = 0

  function close() {
    if (run > MAX) over.push({ line: start, length: run })
    run = 0
  }

  lines.forEach(function(line, i) {
    if (isComment(line, file)) {
      if (run === 0) start = i + 1
      run++
    } else {
      close()
    }
  })
  close()
  return over
}

test("no comment block in the fork's own files runs past three lines", function() {
  var offenders = []
  sourceFiles().forEach(function(file) {
    var lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n")
    overlongBlocks(lines, file).forEach(function(b) {
      offenders.push(file + ":" + b.line + " (" + b.length + " lines)")
    })
  })
  assert.deepStrictEqual(offenders, [], "comment blocks over " + MAX + " lines: " + offenders.join(", "))
})

// Upstream writes at paragraph length and that is its business. Only the lines
// the fork ADDS are the fork's, and a fork comment often sits directly above an
// upstream one -- so the split comes from git, not from reading the text.
test("no run of comment lines the fork added to Service.qml exceeds three", function() {
  var diff
  try {
    diff = cp.execFileSync("git", ["diff", "-U0", "upstream", "--", "Service.qml"],
      { cwd: ROOT, encoding: "utf8" })
  } catch (e) {
    return   // no upstream branch here; check-delta reports that, not this test
  }

  var run = 0
  var worst = 0
  diff.split("\n").forEach(function(line) {
    if (line.indexOf("+++") === 0) return
    var added = line.indexOf("+") === 0 ? line.slice(1) : null
    if (added !== null && isComment(added, "Service.qml")) {
      run++
      if (run > worst) worst = run
    } else {
      run = 0
    }
  })

  assert.ok(worst <= MAX,
    "the fork adds a run of " + worst + " comment lines to Service.qml; cap is " + MAX)
})

test("upstream files are excluded, not silently trimmed", function() {
  UPSTREAM.forEach(function(file) {
    assert.strictEqual(sourceFiles().indexOf(file), -1, file + " must not be scanned")
  })
})

// The detector has to actually detect. A rule nobody has watched fire is not a
// rule.
test("the block detector finds a run of four and allows three", function() {
  var four = ["// a", "// b", "// c", "// d", "var x = 1"]
  assert.deepStrictEqual(overlongBlocks(four, "x.js"), [{ line: 1, length: 4 }])

  var three = ["// a", "// b", "// c", "var x = 1"]
  assert.deepStrictEqual(overlongBlocks(three, "x.js"), [])

  var split = ["// a", "// b", "var x = 1", "// c", "// d"]
  assert.deepStrictEqual(overlongBlocks(split, "x.js"), [])
})

test("a shebang is not a comment line", function() {
  var lines = ["#!/bin/bash", "# a", "# b", "# c", "echo hi"]
  assert.deepStrictEqual(overlongBlocks(lines, "x.sh"), [])
})
