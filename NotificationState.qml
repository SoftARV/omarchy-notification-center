// The fork's own state, mounted into Service.qml by a single line.
//
// Everything the fork adds beyond upstream lives here rather than in
// Service.qml: the settings document, and later the grouped-popup view and the
// history model. A file upstream has never had cannot conflict with a vendor
// drop, which is the whole reason for the seam (docs/adr/0001-sidecar-seam.md).
//
// It deliberately owns no file handle. Service.qml already has a FileView with
// atomic writes and a 200 ms debounce timer for this exact path; a second
// handle on the same file would race that atomic write and could lose the
// user's DND setting.

import QtQuick
import "NotificationPolicy.js" as Policy

QtObject {
  id: root

  // The mounting service. Used to reach the debounced save; the fork never
  // writes the settings file itself.
  property var service: null

  // Complete and non-null from construction, before any file has been read.
  // Five modules read this -- timing, stacking, popup-cap, history-store and
  // center-ui -- and initialising it to null would put a null guard in every
  // one of them, where exactly one would eventually be forgotten.
  //
  // Reassigning this property is what emits settingsChanged(). QML generates
  // that signal for the property itself, so mutating a field in place
  // (settings.maxVisiblePopups = 3) would change the value while telling
  // nobody -- setters must replace the whole object.
  property var settings: Policy.defaultSettings()

  // Read the settings document, and hand back a result shaped like the one
  // upstream's own parser returns -- `dnd` is null when the file did not carry
  // one. That is deliberate: it lets Service.qml's DND hydration block stay
  // byte-identical to upstream, so two of the lines this module would otherwise
  // have had to fork stay unforked.
  //
  // The null matters. Clamping turns an absent `dnd` into `false`, and
  // PersistentProperties survives an in-process QML reload while the file may be
  // missing -- so writing that `false` through would switch do-not-disturb off
  // under a user who had it on.
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

  // What Service.qml writes through its FileView. Byte-stable for unchanged
  // settings, so a load that changed nothing cannot cause a write.
  function serialize(doNotDisturb) {
    var next = {}
    for (var key in root.settings) next[key] = root.settings[key]
    // DND still lives in upstream's PersistentProperties, so it is passed in at
    // write time rather than mirrored here and risking the two disagreeing.
    next.dnd = !!doNotDisturb
    return Policy.serializeSettings(next)
  }
}
