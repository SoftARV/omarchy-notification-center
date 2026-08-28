// Tests for scripts/check-delta.sh.
//
// Every case runs against a throwaway git repository in a temp dir, never
// against this checkout. The negative cases work by breaking a file that must
// not change, and a test that did that here would leave the tree dirty -- or
// worse, revert it with a git checkout that ate an unrelated edit.
//
// A guard nobody has watched fail is not a guard, so each check gets both a
// passing case and a failing one.

var test = require("node:test")
var assert = require("node:assert")
var cp = require("node:child_process")
var fs = require("node:fs")
var os = require("node:os")
var path = require("node:path")

var SCRIPT = path.join(__dirname, "..", "scripts", "check-delta.sh")

function git(args, cwd) {
  cp.execFileSync("git", args, { cwd: cwd, stdio: "pipe" })
}

// A miniature of this repo: the two files that must stay byte-identical to
// upstream, plus a Service.qml, all committed and branched as `upstream`.
function makeRepo() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-delta-"))
  git(["init", "-q", "-b", "main"], dir)
  git(["config", "user.email", "test@example.com"], dir)
  git(["config", "user.name", "test"], dir)

  fs.mkdirSync(path.join(dir, "components"))
  fs.mkdirSync(path.join(dir, "docs", "spec"), { recursive: true })
  write(dir, "NotificationLogic.js", "function upstreamThing() {}\n")
  write(dir, "components/NotificationCard.qml", "Item { id: card }\n")
  write(dir, "docs/spec/SPEC.md", "# Spec\n")
  write(dir, "Service.qml", [
    "Item {",
    "  id: service",
    "  property int a: 1",
    "  property int b: 2",
    "  property int c: 3",
    "}",
    ""
  ].join("\n"))

  git(["add", "-A"], dir)
  git(["commit", "-qm", "vendor drop"], dir)
  git(["branch", "upstream"], dir)

  // Copied in uncommitted, exactly as an in-development script would be.
  fs.mkdirSync(path.join(dir, "scripts"))
  fs.copyFileSync(SCRIPT, path.join(dir, "scripts", "check-delta.sh"))
  return dir
}

function write(dir, rel, text) {
  fs.writeFileSync(path.join(dir, rel), text)
}

// Run the guard and capture everything, including a non-zero exit -- which is
// the outcome half these tests are asserting on.
function check(dir, cwd, env) {
  var result = cp.spawnSync("bash", [path.join(dir, "scripts", "check-delta.sh")], {
    cwd: cwd || dir,
    encoding: "utf8",
    env: Object.assign({}, process.env, env || {})
  })
  return {
    code: result.status,
    out: String(result.stdout || "") + String(result.stderr || "")
  }
}

test("passes on a tree that matches upstream", function() {
  var dir = makeRepo()
  var r = check(dir)
  assert.strictEqual(r.code, 0, r.out)
})

test("finds the repo root when run from a subdirectory", function() {
  var dir = makeRepo()
  var r = check(dir, path.join(dir, "components"))
  assert.strictEqual(r.code, 0, r.out)
})

test("fails on an uncommitted edit to NotificationLogic.js", function() {
  var dir = makeRepo()
  write(dir, "NotificationLogic.js", "function upstreamThing() {}\nfunction ours() {}\n")
  var r = check(dir)
  assert.notStrictEqual(r.code, 0)
  assert.match(r.out, /NotificationLogic\.js/)
})

test("fails on a committed edit to NotificationLogic.js", function() {
  var dir = makeRepo()
  write(dir, "NotificationLogic.js", "function upstreamThing() {}\nfunction ours() {}\n")
  git(["commit", "-qam", "sneak a change in"], dir)
  var r = check(dir)
  assert.notStrictEqual(r.code, 0)
  assert.match(r.out, /NotificationLogic\.js/)
})

test("fails on an edit to components/NotificationCard.qml", function() {
  var dir = makeRepo()
  write(dir, "components/NotificationCard.qml", "Item { id: card; property int ours: 1 }\n")
  var r = check(dir)
  assert.notStrictEqual(r.code, 0)
  assert.match(r.out, /NotificationCard\.qml/)
})

test("fails when a verbatim file is deleted outright", function() {
  var dir = makeRepo()
  fs.unlinkSync(path.join(dir, "NotificationLogic.js"))
  var r = check(dir)
  assert.notStrictEqual(r.code, 0)
  assert.match(r.out, /NotificationLogic\.js/)
})

test("names both verbatim files when both drift", function() {
  var dir = makeRepo()
  write(dir, "NotificationLogic.js", "changed\n")
  write(dir, "components/NotificationCard.qml", "changed\n")
  var r = check(dir)
  assert.notStrictEqual(r.code, 0)
  assert.match(r.out, /NotificationLogic\.js/)
  assert.match(r.out, /NotificationCard\.qml/)
})

// A fresh clone has no upstream branch. That is a missing comparison, not a
// broken fork, and reporting it as a failure would train people to ignore the
// script's exit code.
test("exits 0 with an explanation when there is no upstream branch", function() {
  var dir = makeRepo()
  git(["branch", "-D", "upstream"], dir)
  var r = check(dir)
  assert.strictEqual(r.code, 0, r.out)
  assert.match(r.out, /upstream/)
})

test("fails outside a git repository", function() {
  var dir = makeRepo()
  var loose = fs.mkdtempSync(path.join(os.tmpdir(), "check-delta-loose-"))
  var r = cp.spawnSync("bash", [path.join(dir, "scripts", "check-delta.sh")], {
    cwd: loose,
    encoding: "utf8",
    env: Object.assign({}, process.env, { GIT_CEILING_DIRECTORIES: os.tmpdir() })
  })
  assert.notStrictEqual(r.status, 0)
  assert.match(String(r.stdout || "") + String(r.stderr || ""), /git/i)
})


// --------------------------------------------------------------- Service.qml
//
// Service.qml is upstream's file with a budgeted set of fork lines in it. The
// guard's job there is not "did it change" -- it is meant to change -- but
// "did it change more than agreed, and is every change labelled".

// Replace a line in the fixture's Service.qml, returning the new contents.
function editService(dir, lines) {
  write(dir, "Service.qml", lines.join("\n") + "\n")
}

test("passes when every added Service.qml line carries a fork marker", function() {
  var dir = makeRepo()
  editService(dir, [
    "Item {",
    "  id: service",
    "  // fork: centered instead of right-aligned -- SPEC.md",
    "  property int a: 99",
    "  property int b: 2",
    "  property int c: 3",
    "}"
  ])
  var r = check(dir)
  assert.strictEqual(r.code, 0, r.out)
})

test("fails on an added Service.qml line with no fork marker", function() {
  var dir = makeRepo()
  editService(dir, [
    "Item {",
    "  id: service",
    "  property int a: 99",
    "  property int b: 2",
    "  property int c: 3",
    "}"
  ])
  var r = check(dir)
  assert.notStrictEqual(r.code, 0)
  assert.match(r.out, /Service\.qml/)
  assert.match(r.out, /unmarked|marker/i)
})

// A hunk that only deletes upstream lines has no added line to carry a marker.
// Exempting it would create an unlabelled category of fork change, which is the
// exact thing this check exists to prevent -- so it must fail until a comment
// explaining the deletion is added in its place.
test("fails on a pure-deletion hunk with no marker comment", function() {
  var dir = makeRepo()
  editService(dir, [
    "Item {",
    "  id: service",
    "  property int a: 1",
    "  property int c: 3",
    "}"
  ])
  var r = check(dir)
  assert.notStrictEqual(r.code, 0)
  assert.match(r.out, /Service\.qml/)
})

test("passes when a deletion is explained by a fork marker in its place", function() {
  var dir = makeRepo()
  editService(dir, [
    "Item {",
    "  id: service",
    "  property int a: 1",
    "  // fork: b dropped, nothing centered needs it -- SPEC.md",
    "  property int c: 3",
    "}"
  ])
  var r = check(dir)
  assert.strictEqual(r.code, 0, r.out)
})

test("fails when a fork marker names a spec file that does not exist", function() {
  var dir = makeRepo()
  editService(dir, [
    "Item {",
    "  id: service",
    "  // fork: explained somewhere else -- SPEC-nonexistent.md",
    "  property int a: 99",
    "  property int b: 2",
    "  property int c: 3",
    "}"
  ])
  var r = check(dir)
  assert.notStrictEqual(r.code, 0)
  assert.match(r.out, /SPEC-nonexistent\.md/)
})

test("fails when added lines exceed the budget", function() {
  var dir = makeRepo()
  editService(dir, [
    "Item {",
    "  id: service",
    "  // fork: three new bindings -- SPEC.md",
    "  property int x: 1",
    "  property int y: 2",
    "  property int a: 1",
    "  property int b: 2",
    "  property int c: 3",
    "}"
  ])
  var r = check(dir, null, { DELTA_BUDGET: "2" })
  assert.notStrictEqual(r.code, 0)
  assert.match(r.out, /budget/i)
})

// Deleting is how the seam shrinks the conflict surface -- hook 7 moves ~60
// upstream lines out of the delegate. A budget counting deletions would fail
// the one change designed to make merges cheaper.
test("deletions do not count against the budget", function() {
  var dir = makeRepo()
  editService(dir, [
    "Item {",
    "  id: service",
    "  // fork: delegate body moved to a sidecar -- SPEC.md",
    "}"
  ])
  var r = check(dir, null, { DELTA_BUDGET: "2" })
  assert.strictEqual(r.code, 0, r.out)
})

test("reports the added-line count on a passing run", function() {
  var dir = makeRepo()
  var r = check(dir)
  assert.strictEqual(r.code, 0, r.out)
  assert.match(r.out, /\b0\b/)
})

// Regression. The first cut of check 3 asked "does this hunk contain a marker
// anywhere", and an unmarked line placed directly above a marked one was
// absorbed into the same hunk and sailed through -- the guard reporting ok on
// a tree with unlabelled fork code in it. Found by running the negative case
// against the real Service.qml, which the fixture had not reproduced because
// its unmarked line was nowhere near a marker.
//
// The rule is now: the FIRST added line of a hunk must carry the marker.
test("fails on an unmarked line sitting directly above a marked one", function() {
  var dir = makeRepo()
  editService(dir, [
    "Item {",
    "  id: service",
    "  property int sneaked: 1",
    "  // fork: centered instead of right-aligned -- SPEC.md",
    "  property int a: 99",
    "  property int b: 2",
    "  property int c: 3",
    "}"
  ])
  var r = check(dir)
  assert.notStrictEqual(r.code, 0, "unmarked line escaped: " + r.out)
  assert.match(r.out, /Service\.qml/)
})

// The limit of the check, stated as a test so nobody mistakes it for a
// guarantee it does not make: a marker covers the contiguous block of added
// lines it introduces. A line added *below* a marker is indistinguishable from
// a legitimate two-line hook, and no amount of parsing separates them -- only
// per-line markers would, and that would double the delta to police the delta.
// What bounds a labelled block from growing without limit is the budget check,
// not this one.
test("a marker covers the added block it introduces (documented limit)", function() {
  var dir = makeRepo()
  editService(dir, [
    "Item {",
    "  id: service",
    "  // fork: centered instead of right-aligned -- SPEC.md",
    "  property int a: 99",
    "  property int alsoCovered: 1",
    "  property int b: 2",
    "  property int c: 3",
    "}"
  ])
  var r = check(dir)
  assert.strictEqual(r.code, 0, r.out)
})
