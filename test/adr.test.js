// An ADR earns its keep by being findable and not drifting from the spec it
// explains. Whether the reasoning is good is not something a test can say.

var test = require("node:test")
var assert = require("node:assert")
var fs = require("node:fs")
var path = require("node:path")

var ROOT = path.join(__dirname, "..")
var ADR_DIR = path.join(ROOT, "docs", "adr")

function adrFiles() {
  if (!fs.existsSync(ADR_DIR)) return []
  return fs.readdirSync(ADR_DIR)
    .filter(function(name) { return /^\d{4}-.+\.md$/.test(name) })
    .sort()
}

function read(name) {
  return fs.readFileSync(path.join(ADR_DIR, name), "utf8")
}

test("there is at least one ADR, numbered and named", function() {
  var files = adrFiles()
  assert.ok(files.length > 0, "no ADR found in docs/adr/ matching NNNN-name.md")
  assert.strictEqual(files[0], "0001-sidecar-seam.md")
})

// The sections are what make an ADR readable by someone who was not in the
// room: what was true, what was chosen, and what it costs.
test("every ADR carries the standard sections", function() {
  adrFiles().forEach(function(name) {
    var text = read(name)
    assert.match(text, /^## Status$/m, name + " has no Status section")
    assert.match(text, /^## Context$/m, name + " has no Context section")
    assert.match(text, /^## Decision$/m, name + " has no Decision section")
    assert.match(text, /^## Consequences$/m, name + " has no Consequences section")
  })
})

// A decision recorded without its discarded alternative reads as the only
// option anyone considered, which is exactly how it gets re-litigated.
test("ADR 0001 records the rejected alternative and the accepted cost", function() {
  var text = read("0001-sidecar-seam.md")
  assert.match(text, /companion plugin/i, "the rejected alternative is not named")
  assert.match(text, /serviceFor/, "the reason it was rejected is not grounded in the API that removed its advantage")
  assert.match(text, /\b60\b/, "the accepted cost -- a 60-line budget -- is not recorded")
  assert.match(text, /\bseven\b|\b7\b/, "the delta it grew from is not recorded")
})

// The hook inventory lives in the spec and changes as modules land. An ADR that
// copied it would be wrong by the second module, and wrong in the more damaging
// direction: confidently, in a document nobody thinks to update.
test("ADR 0001 links the hook inventory rather than copying it", function() {
  var text = read("0001-sidecar-seam.md")
  assert.match(text, /SPEC-fork-seam\.md/, "does not point at the spec that holds the inventory")

  var tableRows = text.split("\n").filter(function(line) {
    return /^\s*\|/.test(line)
  })
  assert.deepStrictEqual(tableRows, [],
    "ADR 0001 contains a table; the hook inventory belongs in SPEC-fork-seam.md, linked not copied")
})

test("ADR 0001 is short enough to be read in one sitting", function() {
  var lines = read("0001-sidecar-seam.md").split("\n").length
  assert.ok(lines <= 70, "0001-sidecar-seam.md is " + lines + " lines; an ADR is a record, not an essay")
})
