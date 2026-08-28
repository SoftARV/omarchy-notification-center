// The fork's own state, mounted into Service.qml by one line. Owns no file
// handle: Service.qml already has an atomic FileView for this path, and a
// second one would race it. See docs/adr/0001-sidecar-seam.md.

import QtQuick
import "NotificationPolicy.js" as Policy

QtObject {
  id: root

  // The mounting service, used to reach its debounced save.
  property var service: null

  // Complete from construction, so the five modules that read it need no null
  // guard. Reassigning it emits settingsChanged() -- QML generates that signal
  // for the property -- so setters must replace the object, not mutate it.
  property var settings: Policy.defaultSettings()

  // Returns upstream's result shape -- dnd null when absent -- so Service.qml's
  // hydration block stays unforked. The null matters: an absent dnd clamps to
  // false, which would switch DND off under a user who had it on.
  function hydrate(raw) {
    var parsed = Policy.parseSettings(raw)
    if (parsed.error)
      console.warn("notifications: settings parse failed:", parsed.errorMessage || "")
    root.settings = parsed.settings
    return {
      dnd: parsed.dndPresent ? parsed.settings.dnd : null,
      needsRewrite: parsed.needsRewrite
    }
  }

  // What Service.qml writes through its FileView. Byte-stable, so a load that
  // changed nothing cannot cause a write.
  function serialize(doNotDisturb) {
    var next = {}
    for (var key in root.settings) next[key] = root.settings[key]
    // DND lives in upstream's PersistentProperties, so it is passed in at write
    // time rather than mirrored here where the two could disagree.
    next.dnd = !!doNotDisturb
    return Policy.serializeSettings(next)
  }
}
