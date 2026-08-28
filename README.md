# nec.notifications

A fork of Omarchy's built-in `omarchy.notifications` service — the notification
daemon, toast popups, do-not-disturb, and history panel — with toasts moved
from the top-right corner to the top-center of the screen.

Upstream lives at `/usr/share/omarchy/shell/plugins/notifications`.

## What differs from upstream

Currently tracking **omarchy 4.0.1-1**. The whole fork is seven lines:

| File | Change |
| --- | --- |
| `manifest.json` | id `nec.notifications`, name "My Notifications", `omarchy.clonedFrom` |
| `Service.qml` | popup column, layout alignment and card anchored to `horizontalCenter` instead of `right`; the bar's right margin is dropped |

`NotificationLogic.js` and `components/NotificationCard.qml` are byte-identical
to upstream. Keeping it that way is the point: the smaller the delta, the more
often an upstream merge lands without a conflict.

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

The `upstream` branch carries pristine snapshots of
`/usr/share/omarchy/shell/plugins/notifications` and nothing else — no fork
edits ever land on it. That gives a real three-way base, so picking up an
omarchy release is a merge rather than a re-application by hand.

Its root commit is a reconstruction of the fork point (see that commit message
for what pins each file); every commit after it is a verbatim vendor drop.

To pick up a new omarchy release:

```sh
git checkout upstream
cp -r /usr/share/omarchy/shell/plugins/notifications/. .
git commit -am "Vendor omarchy.notifications from omarchy <version>"

git checkout main
git merge upstream
```

Then check the delta is still only the fork's own lines, and that the result
lints no worse than upstream does:

```sh
git diff upstream -- Service.qml NotificationLogic.js manifest.json components/
/usr/lib/qt6/bin/qmllint Service.qml
```

`qmllint` cannot resolve the `qs.*` imports outside the shell, so it reports
unqualified-access and uncreatable-type warnings on upstream's own files too.
Compare against upstream rather than expecting silence.

## License

MIT, the same as Omarchy. Nearly every line here is upstream's, so upstream's
copyright is kept alongside the fork's — see `LICENSE`.
