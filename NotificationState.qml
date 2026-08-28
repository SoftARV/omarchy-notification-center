// The fork's own state, mounted into Service.qml by one line. Owns no file
// handle: Service.qml already has an atomic FileView for this path, and a
// second one would race it. See docs/adr/0001-sidecar-seam.md.

import QtQuick
import Quickshell.Io
import "NotificationPolicy.js" as Policy

// Item, not QtObject: QtObject has no default property, and every IpcHandler
// in the shell lives in an Item. Non-visual -- no size, no anchors.
Item {
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

  // Change one setting. False means the value was unusable and nothing moved.
  // The save is debounced by Service.qml, so a slider drag writes once.
  function applySetting(key, value) {
    var next = Policy.withSetting(root.settings, key, value)
    if (next === null) return false
    root.settings = next
    if (root.service) root.service.scheduleSettingsSave()
    return true
  }

  // Its own target, so it costs no further Service.qml hook and cannot collide
  // with an IPC name a future upstream adds to "notifications".
  IpcHandler {
    target: "notification-settings"

    function getSettings(): string {
      return JSON.stringify(root.settings, null, 2)
    }

    function setDuration(urgency: string, ms: string): string {
      return root.applySetting("duration." + String(urgency), ms) ? "ok" : "invalid"
    }

    function setMaxVisible(count: string): string {
      return root.applySetting("maxVisiblePopups", count) ? "ok" : "invalid"
    }

    function setGrouping(on: string): string {
      return root.applySetting("groupByApp", on) ? "ok" : "invalid"
    }

    function setHistoryLimit(count: string): string {
      return root.applySetting("historyLimit", count) ? "ok" : "invalid"
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
