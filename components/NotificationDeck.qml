// One group of same-app notifications, drawn as a stack of cards.
//
// Collapsed it is the newest card with ghost edges peeking behind, so a glance
// says "there is more than one". Hovered it fans out. No count is drawn.

import QtQuick
import QtQuick.Layouts
import qs.Commons
import "../NotificationPolicy.js" as NotificationPolicy

Item {
  id: deck

  property var notificationState: null
  property var group: null

  readonly property var rows: deck.group && deck.group.rows ? deck.group.rows : []
  readonly property int total: deck.rows.length

  // Hovering anywhere in the deck expands it and pauses every countdown in it,
  // so a card cannot expire out from under the pointer while it is being read.
  readonly property bool expanded: hover.hovered && deck.total > 1

  readonly property int fanLimit: 5
  readonly property var layout: NotificationPolicy.deckLayout(deck.total, deck.expanded, deck.fanLimit)

  // Ghost edges peek below the front card, so the deck is taller than it looks.
  readonly property real ghostStep: Style.space(4)
  readonly property real ghostDepth: deck.layout.ghosts * deck.ghostStep

  implicitWidth: fan.implicitWidth
  implicitHeight: fan.implicitHeight + deck.ghostDepth
  Layout.preferredWidth: deck.implicitWidth
  Layout.alignment: Qt.AlignHCenter

  HoverHandler { id: hover }

  // Behind the fan: a plain card edge, same background, radius and border,
  // stepped down and dimmed. Shown collapsed, and while expanded if rows are
  // held back -- the same signal either way, and never a count.
  Repeater {
    model: deck.layout.ghosts

    delegate: Rectangle {
      required property int index
      readonly property real inset: Style.space(6) * (index + 1)

      x: fan.x + inset
      y: fan.y + fan.implicitHeight - height + deck.ghostStep * (index + 1)
      width: Math.max(0, fan.implicitWidth - inset * 2)
      height: deck.ghostStep * 2 + radius
      radius: deck.notificationState && deck.notificationState.service
        ? deck.notificationState.service.cornerRadius : 0
      color: Color.notifications.background
      border.width: 1
      border.color: Color.notifications.border
      opacity: 1.0 - 0.25 * (index + 1)
    }
  }

  Column {
    id: fan
    anchors.horizontalCenter: parent.horizontalCenter
    spacing: deck.expanded ? Style.space(8) : 0

    Repeater {
      model: deck.rows

      // Every row gets a slot even when it is not drawn: a slot owns the
      // countdown, so a row without one would never expire or reach history.
      delegate: PopupSlot {
        required property int index
        required property var modelData

        visible: index < deck.layout.shown
        height: visible ? implicitHeight : 0

        notificationState: deck.notificationState
        paused: deck.expanded
        originalId: modelData.originalId
        timestamp: modelData.timestamp
        app: modelData.app
        appIcon: modelData.appIcon
        summary: modelData.summary
        body: modelData.body
        image: modelData.image
        glyph: modelData.glyph
        urgency: modelData.urgency
        expireTimeout: modelData.expireTimeout
      }
    }

  }

  Behavior on implicitHeight {
    NumberAnimation { duration: 160; easing.type: Easing.OutCubic }
  }
}
