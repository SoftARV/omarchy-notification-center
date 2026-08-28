// Loads a QML JavaScript resource so node can test it. Such a file has no
// exports -- QML reads the declarations off it -- so require() has nothing to
// take hold of, and the source is wrapped in a function instead.

var fs = require("node:fs")
var path = require("node:path")
var vm = require("node:vm")

var ROOT = path.join(__dirname, "..")

// Anchored at column 0: QML resources are written flat, and matching indented
// declarations would sweep up locals from inside function bodies.
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

  // This realm, not a fresh vm context: values crossing a context boundary
  // carry that realm's prototypes, so deepStrictEqual fails on arrays that are
  // correct in every observable way.
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
