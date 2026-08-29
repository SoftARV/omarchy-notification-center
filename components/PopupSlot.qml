// One toast: the lifetime countdown, the hover pause, and the card.
//
// Lifted verbatim out of Service.qml's Repeater delegate so a deck can compose
// slots. Kept unchanged apart from dismissal, which is now by identity.

import QtQuick
import QtQuick.Layouts

Item {
  id: cardSlot

  // Not `state` (QQuickItem has one) and not `forkState` (that is the id in
  // Service.qml, and `forkState: forkState` binds the property to itself).
  property var notificationState: null
  readonly property var service: cardSlot.notificationState ? cardSlot.notificationState.service : null

  // Row identity. Never an index: inside a deck the local index is not the
  // model's, and a stored one is stale as soon as any row is removed.
  property double originalId: -1
  property double timestamp: 0

  property string app: ""
  property string appIcon: ""
  property string summary: ""
  property string body: ""
  property string image: ""
  property string glyph: ""
  property int urgency: 1
  property double expireTimeout: 0

  // Set by a deck to pause every countdown in it while the pointer is inside.
  property bool paused: false

  readonly property alias hovered: card.hovered

  // Each card sizes itself based on mode (text vs media); the slot tracks the
  // card so the column auto-fits to whichever is widest.
  Layout.preferredWidth: card.implicitWidth
  Layout.alignment: Qt.AlignHCenter
  implicitWidth: card.implicitWidth
  implicitHeight: card.implicitHeight

  readonly property real lifetime:
    cardSlot.service ? cardSlot.service.durationFor(cardSlot.urgency, cardSlot.expireTimeout) : 0
  property real remainingLifetime: 1.0
  readonly property bool ticking: cardSlot.lifetime > 0 && !card.hovered && !cardSlot.paused

  // A client updating this notification in place rewrites the row under the
  // card (see refreshPopup). New text deserves a full look, so the countdown
  // starts over instead of running out the superseded text's clock.
  onSummaryChanged: cardSlot.remainingLifetime = 1.0
  onBodyChanged: cardSlot.remainingLifetime = 1.0
  onImageChanged: cardSlot.remainingLifetime = 1.0

  Timer {
    interval: 50
    repeat: true
    running: cardSlot.ticking
    onTriggered: {
      if (cardSlot.lifetime <= 0) return
      cardSlot.remainingLifetime -= 50.0 / cardSlot.lifetime
      if (cardSlot.remainingLifetime <= 0) {
        cardSlot.remainingLifetime = 0
        if (cardSlot.notificationState) cardSlot.notificationState.expireRow(cardSlot.originalId, cardSlot.timestamp)
      }
    }
  }

  NotificationCard {
    id: card
    // fork: horizontalCenter, upstream anchors right -- SPEC.md
    anchors.horizontalCenter: parent.horizontalCenter
    app: cardSlot.app
    appIcon: cardSlot.appIcon
    summary: cardSlot.summary
    body: cardSlot.body
    image: cardSlot.image
    urgency: cardSlot.urgency
    timestamp: cardSlot.timestamp
    cornerRadius: cardSlot.service ? cardSlot.service.cornerRadius : 0
    fontFamily: cardSlot.service && cardSlot.service.shell && cardSlot.service.shell.bar
      ? cardSlot.service.shell.bar.fontFamily : ""
    glyph: cardSlot.glyph

    onCloseRequested: if (cardSlot.notificationState) cardSlot.notificationState.dismissRow(cardSlot.originalId, cardSlot.timestamp)
    onCardClicked: if (cardSlot.notificationState) cardSlot.notificationState.invokeRow(cardSlot.originalId, cardSlot.timestamp)
  }
}
