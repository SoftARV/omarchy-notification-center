// Tests for the documentation's structure, not its prose.
//
// Two things rot silently in a repo's docs: a link that points at a file
// somebody renamed, and a README that grows until nobody reads it. Both are
// mechanically checkable, so they are checked here rather than left to whoever
// notices.

var test = require("node:test")
var assert = require("node:assert")
var fs = require("node:fs")
var path = require("node:path")

var ROOT = path.join(__dirname, "..")

// The README is the one file a plugin user actually reads. Long explanations
// belong in docs/, with the README carrying a pointer -- so this is a budget,
// not a guideline.
var README_MAX_LINES = 60

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8")
}

function markdownFiles() {
  var found = []
  function walk(dir) {
    fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach(function(entry) {
      var rel = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") return
        walk(rel)
      } else if (entry.name.endsWith(".md")) {
        found.push(rel)
      }
    })
  }
  walk("docs")
  walk("tasks")
  found.push("README.md")
  return found
}

// [text](target) -- only relative targets. External URLs are not this test's
// business; a broken one is somebody else's server, not a rename here.
function localLinks(source) {
  var links = []
  var pattern = /\[[^\]]*\]\(([^)]+)\)/g
  var match
  while ((match = pattern.exec(source)) !== null) {
    var target = match[1].split("#")[0].trim()
    if (!target) continue
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    links.push(target)
  }
  return links
}

test("the README stays short enough that people read it", function() {
  var lines = read("README.md").split("\n").length
  assert.ok(lines <= README_MAX_LINES,
    "README.md is " + lines + " lines, over the " + README_MAX_LINES + "-line budget. " +
    "Move the explanation into docs/ and leave a pointer.")
})

test("every relative link in every markdown file resolves", function() {
  var broken = []
  markdownFiles().forEach(function(file) {
    localLinks(read(file)).forEach(function(target) {
      var resolved = path.resolve(ROOT, path.dirname(file), target)
      if (!fs.existsSync(resolved)) broken.push(file + " -> " + target)
    })
  })
  assert.deepStrictEqual(broken, [], "broken links: " + broken.join(", "))
})

// A pointer nobody can follow is worse than no pointer. These are the documents
// a reader of the README has to be able to reach.
test("the README points at the detail rather than inlining it", function() {
  var readme = read("README.md")
  var targets = localLinks(readme)
  var required = [
    "docs/install.md",
    "docs/upstream.md",
    "docs/spec/CAPABILITY-MAP.md"
  ]
  required.forEach(function(want) {
    assert.ok(targets.indexOf(want) !== -1,
      "README.md should link to " + want + "; links found: " + targets.join(", "))
  })
})

// Every doc reachable from somewhere. An unlinked file is one nobody finds and
// nobody updates.
test("no documentation file is orphaned", function() {
  var linked = {}
  markdownFiles().forEach(function(file) {
    localLinks(read(file)).forEach(function(target) {
      var resolved = path.resolve(ROOT, path.dirname(file), target)
      linked[path.relative(ROOT, resolved)] = true
    })
  })

  var orphans = markdownFiles().filter(function(file) {
    if (file === "README.md") return false          // the entry point
    if (file.startsWith("tasks/")) return false     // working files, not docs
    return !linked[file]
  })

  assert.deepStrictEqual(orphans, [],
    "not linked from anywhere: " + orphans.join(", "))
})
