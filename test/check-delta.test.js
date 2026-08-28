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
  write(dir, "Service.qml", "Item { id: service }\n")

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
function check(dir, cwd) {
  var result = cp.spawnSync("bash", [path.join(dir, "scripts", "check-delta.sh")], {
    cwd: cwd || dir,
    encoding: "utf8"
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
