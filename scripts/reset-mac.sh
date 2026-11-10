#!/usr/bin/env bash

set -u

usage() {
  cat <<'USAGE'
Comfy Desktop -- macOS reset script

Wipes app settings, caches, and the Chromium profile for the current build
AND for the older beta names (ComfyUI Launcher / com.kosinkadink.* /
org.comfy.comfyui-launcher), in case leftovers from a previous version are
breaking the UI (no styles, no i18n, dropdowns not working, etc.) after a
manual update.

Does NOT touch your actual ComfyUI installs at ~/ComfyUI-Installs. The
script DOES remove installations.json (the registry), so you may need to
re-add existing installs via "Add existing installation" on first launch.

Usage:
  bash reset-mac.sh           # asks for confirmation
  bash reset-mac.sh --yes     # skip confirmation
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

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script is for macOS only." >&2
  exit 1
fi

if pgrep -x "Comfy Desktop"     >/dev/null 2>&1 \
   || pgrep -x "ComfyUI Desktop 2.0" >/dev/null 2>&1 \
   || pgrep -x "ComfyUI Launcher"  >/dev/null 2>&1; then
  echo "Comfy Desktop / Launcher is running. Please quit it first (Cmd+Q),"
  echo "then re-run this script."
  exit 1
fi

PRODUCT_NAMES=(
  "ComfyUI"
  "Comfy Desktop"
  "ComfyUI Desktop 2.0"
  "ComfyUI Launcher"
)

PACKAGE_NAMES=(
  "comfyui-desktop-2"
  "comfyui-launcher"
)

BUNDLE_IDS=(
  "org.comfy.comfyui-desktop-2"
  "org.comfy.comfyui-launcher"
  "com.kosinkadink.comfyui-launcher"
)

TARGETS=()

for name in "${PRODUCT_NAMES[@]}"; do
  TARGETS+=(
    "$HOME/Library/Application Support/$name"
    "$HOME/Library/Logs/$name"
  )
done

for name in "${PACKAGE_NAMES[@]}"; do
  TARGETS+=(
    "$HOME/Library/Application Support/$name"
    "$HOME/Library/Caches/${name}-updater"
  )
done

shopt -s nullglob

for id in "${BUNDLE_IDS[@]}"; do
  TARGETS+=(
    "$HOME/Library/Preferences/${id}.plist"
    "$HOME/Library/Caches/${id}"
    "$HOME/Library/Caches/${id}.ShipIt"
    "$HOME/Library/Saved Application State/${id}.savedState"
    "$HOME/Library/WebKit/${id}"
  )
  for p in "$HOME/Library/HTTPStorages/${id}" \
           "$HOME/Library/HTTPStorages/${id}.binarycookies"; do
    TARGETS+=("$p")
  done
  TARGETS+=("$HOME/Library/Cookies/${id}.binarycookies")
  for p in "$HOME/Library/Preferences/ByHost/${id}".*.plist; do
    TARGETS+=("$p")
  done
done

shopt -u nullglob

APP_LOCATIONS=()
for app_name in "${PRODUCT_NAMES[@]}"; do
  while IFS= read -r line; do
    [ -n "$line" ] && APP_LOCATIONS+=("$line")
  done < <(mdfind "kMDItemFSName == '${app_name}.app'" 2>/dev/null)
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

if [ ${#APP_LOCATIONS[@]} -gt 0 ]; then
  echo "Found these app copies on disk (NOT deleted — verify you launch the right one):"
  for app in "${APP_LOCATIONS[@]}"; do
    echo "  $app"
  done
  echo
fi

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
echo "Done. Reinstall Comfy Desktop from the latest .dmg if you haven't already,"
echo "then launch it. The app should come up with a clean profile."
