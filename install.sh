#!/bin/bash

# Installs the forked notifications service into the Omarchy shell.
#
# Two modes, chosen by where this script is sitting:
#
#   * from a development checkout -- copies the runtime files into
#     ~/.config/omarchy/plugins/<id>/
#   * from inside that directory, which is where `omarchy plugin add` leaves
#     the whole repo -- copies nothing, because that directory *is* the user's
#     git checkout and overwriting it is what breaks `omarchy plugin update`
#
# Copied rather than symlinked: omarchy-plugin-validate rejects a plugin folder
# containing any symlink, so a linked install would validate as broken and the
# shell would quietly never load it.
#
# Safe to re-run. Files identical to what is already installed are left alone.

set -euo pipefail

REPO=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
MANIFEST="$REPO/manifest.json"

if [[ ${1:-} == -h || ${1:-} == --help ]]; then
  cat <<USAGE
Usage: ./install.sh

Copies the plugin into \$XDG_CONFIG_HOME/omarchy/plugins/<id>/ and asks the
shell to rescan. Run from the installed copy it does nothing but confirm.

Re-running is safe: unchanged files are not rewritten.
USAGE
  exit 0
fi

say() { printf '  %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }

command -v jq >/dev/null 2>&1 || {
  warn "jq is required to read the manifest"
  exit 1
}

[[ -f $MANIFEST ]] || {
  warn "no manifest.json beside this script; is this the plugin repo?"
  exit 1
}

PLUGIN_ID=$(jq -r '.id // ""' "$MANIFEST")
[[ -n $PLUGIN_ID ]] || {
  warn "manifest.json declares no id"
  exit 1
}
PLUGIN_DIR="$CONFIG_HOME/omarchy/plugins/$PLUGIN_ID"

printf '\n%s installer\n\n' "$PLUGIN_ID"

# --- which mode ------------------------------------------------------------
if [[ $(readlink -f "$REPO") == "$(readlink -f "$PLUGIN_DIR" 2>/dev/null || echo "")" ]]; then
  say "plugin: this checkout is already the installed plugin"
else
  # The file list is discovered, not hardcoded. A hardcoded list is how
  # pip-plugin silently shipped without Panel.qml when a bar widget was added,
  # and the only symptom was a line on the shell's console. Every .qml/.js
  # outside the non-runtime directories travels, so components/ comes along --
  # Service.qml does `import "components"` and renders nothing without it.
  mapfile -t files < <(
    printf 'manifest.json\n'
    cd "$REPO" && find . \
      \( -path ./.git -o -path ./test -o -path ./docs -o -path ./scripts -o -path ./tasks \) -prune -o \
      -type f \( -name '*.qml' -o -name '*.js' \) -print |
      sed 's|^\./||' | sort
  )

  changed=0
  for file in "${files[@]}"; do
    [[ -f $REPO/$file ]] || {
      warn "plugin: $file is declared but missing"
      continue
    }
    mkdir -p "$PLUGIN_DIR/$(dirname "$file")"
    if ! cmp -s "$REPO/$file" "$PLUGIN_DIR/$file"; then
      cp "$REPO/$file" "$PLUGIN_DIR/$file"
      changed=1
    fi
  done

  if (( changed )); then
    say "plugin: installed to $PLUGIN_DIR"
  else
    say "plugin: already up to date at $PLUGIN_DIR"
  fi
fi

# --- the plugin it replaces ------------------------------------------------
# Two notification services both binding org.freedesktop.Notifications is a
# race, not a merge: whichever wins the name owns the popups, and the loser
# fails quietly. Say so rather than leaving it to be discovered from a bar
# that shows nothing.
SHELL_JSON="$CONFIG_HOME/omarchy/shell.json"
if [[ -f $SHELL_JSON ]]; then
  if ! jq -e '.disabledPlugins // [] | index("omarchy.notifications")' "$SHELL_JSON" >/dev/null 2>&1; then
    warn "omarchy.notifications is still enabled; disable it or the two will fight over the D-Bus name"
  fi
fi

# --- tell the shell --------------------------------------------------------
if command -v omarchy-plugin-validate >/dev/null 2>&1; then
  omarchy-plugin-validate "$PLUGIN_DIR" >/dev/null 2>&1 ||
    warn "omarchy-plugin-validate is unhappy with $PLUGIN_DIR"
fi

if command -v omarchy-shell >/dev/null 2>&1; then
  omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
fi

printf '\n'
# rescanPlugins reloads plugin code but keeps the existing service instance, so
# geometry changes appear not to apply until the shell restarts.
say "if toasts look unchanged, run:  omarchy restart shell"
printf '\n'
