// Loads a QML JavaScript resource so node can test it.
//
// A QML .js resource is not a module. It declares bare functions and has no
// export statement, because QML imports it with `import "X.js" as X` and reads
// the declarations straight off the resulting object. require() has nothing to
// take hold of, so instead the source runs in a fresh V8 context and the
// declarations are read back out of it.
//
// This is why the pure logic in this repo lives in .js resources separate from
// the QML that uses it: NotificationPolicy.js is testable here, and every
// decision that can be made without a screen belongs in it. Logic that reaches
// for a QML global (Qt, Quickshell, NotificationUrgency) cannot be loaded here
// at all -- which is the point, and why durationFor() takes the urgency enum as
// an argument instead of importing it.

var fs = require("node:fs")
var path = require("node:path")
var vm = require("node:vm")

var ROOT = path.join(__dirname, "..")

// Top-level declarations, which is all a QML JS resource has. Anchored at
// column 0 deliberately: QML resources are written flat, and matching indented
// declarations would sweep up locals from inside function bodies. A top-level
// declaration that is somehow indented simply will not be returned, and the
// test that wanted it fails loudly on undefined rather than silently passing.
var DECLARATION = /^(?:function\s+([A-Za-z_$][\w$]*)|var\s+([A-Za-z_$][\w$]*))/gm

function declarationNames(source) {
  var names = []
  var match
  DECLARATION.lastIndex = 0
  while ((match = DECLARATION.exec(source)) !== null) {
    var name = match[1] || match[2]
    if (names.indexOf(name) === -1) names.push(name)
  }
  return names
}

// Paths are relative to the repo root rather than to test/, so a test reads
// `load("NotificationPolicy.js")` -- the same path QML uses in its import.
function load(resourcePath) {
  var full = path.join(ROOT, resourcePath)

  if (!fs.existsSync(full)) {
    throw new Error(
      "harness: no such QML JS resource: " + resourcePath + "\n" +
      "  looked in: " + full)
  }

  var source = fs.readFileSync(full, "utf8")
  var names = declarationNames(source)

  // The source runs inside a function in THIS realm, not in a fresh vm context.
  //
  // A fresh context was the obvious first choice -- clean isolation, no way for
  // a resource to touch node's globals. But every value crossing back out of it
  // carries that realm's prototypes, so `assert.deepStrictEqual(policy.groupPopups(...), [...])`
  // fails with "same structure but not reference-equal" on an array that is
  // correct in every observable way. Six modules of tests assert on returned
  // arrays and objects; making each of them work around the realm boundary
  // would be a tax on every test to buy isolation no test needed.
  //
  // A function wrapper keeps the declarations out of the host global just as
  // well, and QML-only globals (Qt, Quickshell, NotificationUrgency) are absent
  // from node either way -- which is the property that actually matters here,
  // and the reason durationFor() takes the urgency enum as an argument.
  var capture = names.map(function(name) {
    return "  declared." + name + " = typeof " + name + " !== \"undefined\" ? " + name + " : undefined"
  }).join("\n")

  var wrapped = "(function (declared) {\n" + source + "\n" + capture + "\n})"

  var factory
  try {
    factory = vm.runInThisContext(wrapped, { filename: full })
  } catch (e) {
    throw new Error(
      "harness: " + resourcePath + " failed to parse: " + e.message)
  }

  var declared = {}
  try {
    factory(declared)
  } catch (e) {
    // Name the resource. Without this the failure is a bare ReferenceError and
    // the useful part -- which file reached for something node cannot provide
    // -- is missing.
    throw new Error(
      "harness: " + resourcePath + " failed to load: " + e.message + "\n" +
      "  A QML-only global (Qt, Quickshell, NotificationUrgency) cannot be\n" +
      "  reached from node. Pass it in as an argument instead.")
  }

  return declared
}

module.exports = { load: load, declarationNames: declarationNames }
