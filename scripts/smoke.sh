#!/bin/bash
# Fires a fixed notification burst so capping, grouping and timing can be
# watched against a known input instead of whatever happened to arrive.
# Not shipped: install.sh prunes scripts/.

set -uo pipefail

COUNT=${COUNT:-20}
APPS=(${APPS:-Chatter Mailer Builder})
GAP=${GAP:-0.15}

usage() {
  cat <<USAGE
Usage: ./scripts/smoke.sh [--criticals] [--help]

Sends COUNT notifications round-robin across APPS, newest last.

  COUNT=20                   how many to send
  APPS="Chatter Mailer"      app names to spread them over
  GAP=0.15                   seconds between sends

  --criticals   send criticals instead, to check they survive the cap
USAGE
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac

command -v notify-send >/dev/null || { echo "smoke: notify-send not found" >&2; exit 1; }

urgency="normal"
[[ ${1:-} == --criticals ]] && urgency="critical"

printf 'smoke: %d notifications, %s urgency, apps: %s\n' "$COUNT" "$urgency" "${APPS[*]}"

for ((i = 1; i <= COUNT; i++)); do
  app=${APPS[$(( (i - 1) % ${#APPS[@]} ))]}
  notify-send -a "$app" -u "$urgency" "smoke $i of $COUNT" "from $app"
  sleep "$GAP"
done

printf 'smoke: sent. Newest is "smoke %d of %d".\n' "$COUNT" "$COUNT"
