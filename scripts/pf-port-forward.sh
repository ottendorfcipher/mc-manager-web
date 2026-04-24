#!/usr/bin/env bash
# Load (or unload) the pf rule that maps :443 -> :5173 on loopback.
#
# Usage:
#   scripts/pf-port-forward.sh on
#   scripts/pf-port-forward.sh off
#
# Requires sudo (pf is a kernel-level firewall).

set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RULE="$ROOT/scripts/pf-port-forward.conf"

case "${1:-}" in
  on)
    sudo pfctl -e -f "$RULE"
    echo "pf rule loaded: 443 -> 5173"
    ;;
  off)
    sudo pfctl -d
    echo "pf disabled"
    ;;
  *)
    echo "usage: $0 {on|off}" >&2
    exit 1
    ;;
esac
