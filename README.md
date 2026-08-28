# nec.notifications

A fork of Omarchy's built-in `omarchy.notifications` service — the notification
daemon, toast popups, do-not-disturb, and history panel — with toasts moved
from the top-right corner to the top-center of the screen.

Upstream lives at `/usr/share/omarchy/shell/plugins/notifications`.

## What differs from upstream

| File | Change |
| --- | --- |
| `manifest.json` | id `nec.notifications`, name "My Notifications", `omarchy.clonedFrom` |
| `Service.qml` | toast column anchored to `horizontalCenter` instead of `right` |

## Install

```sh
./install.sh
```

Copies the runtime files into `~/.config/omarchy/plugins/nec.notifications/`
and asks the shell to rescan. Copied rather than symlinked because
`omarchy-plugin-validate` rejects a plugin folder containing any symlink.

This plugin binds `org.freedesktop.Notifications`, so the stock
`omarchy.notifications` must be disabled or the two race for the name. In
`~/.config/omarchy/shell.json`:

```json
"disabledPlugins": ["omarchy.notifications"],
"plugins": [{ "id": "nec.notifications" }]
```

Geometry changes need a full `omarchy restart shell`; `rescanPlugins` reloads
the code but keeps the live service instance.

## Tracking upstream

Omarchy ships updates to the stock plugin, and this fork does not pick them up
automatically. To see what has moved:

```sh
diff -ru /usr/share/omarchy/shell/plugins/notifications .
```
