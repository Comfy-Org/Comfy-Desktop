#!/usr/bin/env bash

set -u

usage() {
  cat <<'USAGE'
Comfy Desktop -- Linux reset script

Wipes app settings, caches, and the Chromium profile for the current build
AND for the older beta names (ComfyUI Launcher / comfyui-launcher), in case
leftovers from a previous version are breaking the UI (no styles, no i18n,
dropdowns not working, etc.) after a manual update.

Does NOT touch your actual ComfyUI installs at ~/ComfyUI-Installs. The
script DOES remove installations.json (the registry), so you may need to
re-add existing installs via "Add existing installation" on first launch.

Usage:
  bash reset-linux.sh         # asks for confirmation
  bash reset-linux.sh --yes   # skip confirmation
USAGE
}

YES=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
  esac
done

if [ "$(uname -s)" != "Linux" ]; then
  echo "This script is for Linux only." >&2
  exit 1
fi

if pgrep -f "comfyui-desktop-2|ComfyUI Desktop 2.0|Comfy Desktop|comfyui-launcher|ComfyUI Launcher" >/dev/null 2>&1; then
  echo "Comfy Desktop / Launcher is running. Please quit it first,"
  echo "then re-run this script."
  exit 1
fi

XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"

APP_NAMES=(
  "comfyui-desktop-2"
  "comfyui-launcher"
  "ComfyUI"
  "Comfy Desktop"
  "ComfyUI Desktop 2.0"
  "ComfyUI Launcher"
)

TARGETS=()

for name in "${APP_NAMES[@]}"; do
  TARGETS+=(
    "$XDG_CONFIG_HOME/$name"
    "$XDG_CACHE_HOME/$name"
    "$XDG_CACHE_HOME/${name}-updater"
    "$XDG_DATA_HOME/$name"
    "$XDG_STATE_HOME/$name"
  )
done

EXISTING=()
for t in "${TARGETS[@]}"; do
  if [ -e "$t" ]; then
    EXISTING+=("$t")
  fi
done

if [ ${#EXISTING[@]} -eq 0 ]; then
  echo "Nothing to remove. No Comfy Desktop / Launcher data found."
  exit 0
fi

echo "The following will be permanently deleted:"
echo
for t in "${EXISTING[@]}"; do
  echo "  $t"
done
echo
echo "Your ComfyUI installs at ~/ComfyUI-Installs will NOT be touched."
echo "(You may need to re-add them via 'Add existing installation' on first launch.)"
echo

if [ "$YES" -ne 1 ]; then
  printf "Proceed? [y/N] "
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

for t in "${EXISTING[@]}"; do
  echo "Removing: $t"
  rm -rf -- "$t"
done

echo
echo "Done. Reinstall Comfy Desktop from the latest .AppImage or .deb"
echo "if you haven't already, then launch it. The app should come up with a"
echo "clean profile."
