# nec.notifications

A fork of Omarchy's built-in `omarchy.notifications` — the notification daemon,
toast popups, do-not-disturb and history — with toasts moved from the top-right
corner to the top-center of the screen.

Tracking **omarchy 4.0.1-1**. Upstream lives at
`/usr/share/omarchy/shell/plugins/notifications`.

## Install

```sh
./install.sh
```

Then disable the stock plugin, or the two race for the D-Bus name. In
`~/.config/omarchy/shell.json`:

```json
"disabledPlugins": ["omarchy.notifications"],
"plugins": [{ "id": "nec.notifications" }]
```

Geometry changes need a full `omarchy restart shell`.

→ [docs/install.md](docs/install.md)

## How the fork is built

Upstream's files stay upstream's. `NotificationLogic.js` and
`components/NotificationCard.qml` are byte-identical to upstream;
`Service.qml` carries only budgeted hook lines, each marked `// fork:` and
naming its spec. Everything the fork adds lives in sidecar files upstream will
never have, so a vendor drop cannot touch them.

→ [docs/spec/SPEC-fork-seam.md](docs/spec/SPEC-fork-seam.md)

## Taking an upstream release

The `upstream` branch carries pristine vendor drops and no fork edits, so
picking up an omarchy release is a merge rather than a re-application by hand.

→ [docs/upstream.md](docs/upstream.md)

## Development

```sh
node --test "test/**/*.test.js"   # unit tests, no dependencies
./scripts/check-delta.sh          # the fork is still inside its seam
```

→ [docs/spec/CAPABILITY-MAP.md](docs/spec/CAPABILITY-MAP.md) for planned work

## License

MIT, the same as [Omarchy](https://github.com/basecamp/omarchy), which this is
a fork of. Nearly every line here is upstream's, so upstream's copyright notice
is kept in `LICENSE` alongside the fork's rather than replaced by it.
