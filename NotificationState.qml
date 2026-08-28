// The fork's own state, mounted into Service.qml by one line. Owns no file
// handle: Service.qml already has an atomic FileView for this path, and a
// second one would race it. See docs/adr/0001-sidecar-seam.md.

import QtQuick
import Quickshell.Io
import Quickshell.Services.Notifications
import qs.Commons
import "NotificationPolicy.js" as Policy
import "NotificationLogic.js" as Logic

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

  // The history the center reads. Loaded once at startup and refreshed on
  // demand: a hundred small entries is ~50 KB, and keeping it warm means a
  // panel opens with content instead of flickering through empty.
  property alias historyModel: historyModel
  ListModel { id: historyModel }

  // Its own process: the service's file queue has no StdioCollector and cannot
  // carry output. Racing a write is self-healing -- a revision bump re-reads.
  Process {
    id: historyReadProc
    running: false
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.applyHistory(text)
    }
  }

  // awk 1, not cat: a torn file missing its trailing newline would otherwise
  // glue itself onto the next and take a valid entry down with it.
  function loadHistory() {
    if (!root.service || historyReadProc.running) return
    historyReadProc.command = ["bash", "-c",
      "awk 1 \"$1\"/*.json 2>/dev/null || true", "--", root.service.historyDir]
    historyReadProc.running = true
  }

  function applyHistory(raw) {
    var rows = Logic.historyRows(raw, [], NotificationUrgency.Normal, root.settings.historyLimit)
    historyModel.clear()
    for (var i = 0; i < rows.length; i++) historyModel.append(rows[i])
    // Rows are newest-first, so the first one dates the whole history.
    root.newestHistoryTimestamp = rows.length > 0 ? Number(rows[0].timestamp || 0) : 0
  }

  // Bumped whenever a history file is created or removed. Readers compare it
  // against the revision they rendered and re-read when it moves.
  property int historyRevision: 0

  // The newest entry's timestamp, kept as its own property so hasUnread has
  // something notifiable to bind to -- a ListModel's rows are not.
  property double newestHistoryTimestamp: 0

  // A dot, not a count: the useful signal is that there is something to look
  // at, and the list itself says how much.
  readonly property bool hasUnread:
    root.newestHistoryTimestamp > Number(root.settings.historyLastSeen || 0)

  // Called by the service whenever a history file appears or disappears.
  function noteHistoryChanged() {
    root.historyRevision += 1
    root.loadHistory()
  }

  // Hook 9 bumps the revision when the clear job lands, which re-reads and
  // empties the model. markHistorySeen darkens the dot straight away rather
  // than leaving it lit over an empty list.
  function clearHistory() {
    if (!root.service) return
    root.service.clearHistory()
    root.markHistorySeen()
  }

  // Attacker-influenced input ending in process execution: the argv is validated
  // by upstream's fail-closed parser and passed as argv, never as a string.
  // No live sender, so an entry without a valid execArgv does nothing at all.
  function invokeHistoryEntry(originalId, timestamp) {
    var index = Policy.historyRowIndex(root.historyAsArray(), originalId, timestamp)
    if (index < 0) return false

    var argv = Logic.parseExecArgv(historyModel.get(index).execArgv || "")
    if (!argv) return false

    Util.execArgv(argv)
    return true
  }

  function markHistorySeen() {
    root.applySetting("historyLastSeen", Date.now())
  }

  // After the service has had a tick to create its directories.
  Component.onCompleted: Qt.callLater(root.loadHistory)

  // Plain objects copied role by role: a ListModel element is not something
  // JSON.stringify can serialise directly.
  function historyAsArray() {
    var roles = Policy.historyRoles()
    var out = []
    for (var i = 0; i < historyModel.count; i++) {
      var row = historyModel.get(i)
      var plain = {}
      for (var r = 0; r < roles.length; r++) plain[roles[r]] = row[roles[r]]
      out.push(plain)
    }
    return out
  }

  // How long a toast of this urgency stays on screen. The enum is passed down
  // because NotificationUrgency is a QML type the policy cannot import.
  function durationFor(urgency, urgencyEnum) {
    return Policy.durationFor(urgency, root.settings, urgencyEnum)
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

  // Separate target from the settings one, and from upstream's "notifications".
  IpcHandler {
    target: "notification-history"

    // Returns the last completed read, and starts a fresh one. The read is a
    // subprocess and IPC cannot wait on it, so a call right after a write may
    // be one behind.
    function list(): string {
      var json = JSON.stringify(root.historyAsArray(), null, 2)
      root.loadHistory()
      return json
    }

    function reload(): string {
      root.loadHistory()
      return "ok"
    }

    function unread(): string {
      return root.hasUnread ? "yes" : "no"
    }

    function markSeen(): string {
      root.markHistorySeen()
      return "ok"
    }

    function revision(): string {
      return String(root.historyRevision)
    }

    function clear(): string {
      root.clearHistory()
      return "ok"
    }

    function invoke(originalId: string, timestamp: string): string {
      return root.invokeHistoryEntry(originalId, timestamp) ? "ok" : "none"
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
