# Installing

```sh
./install.sh
```

Copies the runtime files into `~/.config/omarchy/plugins/nec.notifications/`
and asks the shell to rescan. Safe to re-run: files identical to what is
already installed are left alone.

## Why copied, not symlinked

`omarchy-plugin-validate` rejects a plugin folder containing any symlink, so a
linked install validates as broken and the shell quietly never loads it.

`install.sh` has two modes, chosen by where it is sitting. From a development
checkout it copies into the plugin directory. From inside that directory —
where `omarchy plugin add` leaves the whole repo — it copies nothing, because
that directory *is* the user's git checkout and overwriting it is what breaks
`omarchy plugin update`.

The file list is discovered rather than hardcoded: every `.qml` and `.js`
outside `test/ docs/ scripts/ tasks/ .git/` travels. A hardcoded list is how a
sibling plugin once shipped without its `Panel.qml`, with no symptom but a line
on the shell's console.

## Disabling the stock plugin

This plugin binds `org.freedesktop.Notifications`, so the stock
`omarchy.notifications` must be disabled or the two race for the name. Whichever
wins owns the popups; the loser fails silently. In
`~/.config/omarchy/shell.json`:

```json
"disabledPlugins": ["omarchy.notifications"],
"plugins": [{ "id": "nec.notifications" }]
```

`install.sh` warns if it finds the stock plugin still enabled.

## Rescan versus restart

`rescanPlugins` reloads plugin code but keeps the existing service instance, so
geometry changes appear not to apply. Those need a full restart:

```sh
omarchy restart shell
```
