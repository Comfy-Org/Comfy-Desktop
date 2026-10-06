#!/usr/bin/env bash
set -euo pipefail

appimage="${1:-}"
expected_version="${2:-}"

if [[ -z "$appimage" || ! -f "$appimage" ]]; then
  echo "usage: $0 /path/to/Comfy-Desktop.AppImage [expected-version]" >&2
  exit 2
fi
if [[ ! -x "$appimage" ]]; then
  echo "AppImage is not executable: $appimage" >&2
  exit 1
fi
appimage="$(readlink -f "$appimage")"

file_description="$(file -- "$appimage")"
if [[ ! "$file_description" =~ ELF\ 64-bit.*x86-64 ]]; then
  echo "AppImage is not a 64-bit x86-64 ELF executable" >&2
  echo "$file_description" >&2
  exit 1
fi

smoke_dir="$(mktemp -d)"
app_pid=''
cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill -- "-$app_pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      if ! kill -0 -- "-$app_pid" 2>/dev/null; then break; fi
      sleep 0.25
    done
    if kill -0 -- "-$app_pid" 2>/dev/null; then
      kill -KILL -- "-$app_pid" 2>/dev/null || true
    fi
    wait "$app_pid" 2>/dev/null || true
    app_pid=''
  fi
  rm -rf "$smoke_dir" || true
}
handle_signal() {
  cleanup
  exit 130
}
trap cleanup EXIT
trap handle_signal INT TERM

(
  cd "$smoke_dir"
  env -i PATH="$PATH" HOME="$smoke_dir" "$appimage" --appimage-extract >/dev/null
)
appdir="$smoke_dir/squashfs-root"

required_executables=(
  "$appdir/AppRun"
  "$appdir/comfyui-desktop-2"
  "$appdir/resources/bootstrap-python/bin/python3"
)
for path in "${required_executables[@]}"; do
  if [[ ! -x "$path" ]]; then
    echo "Required executable is missing or not executable: $path" >&2
    exit 1
  fi
done

desktop_file="$appdir/comfyui-desktop-2.desktop"
if [[ ! -f "$desktop_file" ]]; then
  echo "Desktop entry is missing: $desktop_file" >&2
  exit 1
fi
desktop_exec="$(
  awk '
    /^\[Desktop Entry\]$/ { in_desktop = 1; next }
    /^\[/ { if (in_desktop) exit }
    in_desktop && /^Exec=/ { print; exit }
  ' "$desktop_file"
)"
if [[ ! "$desktop_exec" =~ ^Exec=AppRun([[:space:]]|$) ]] ||
  [[ ! "$desktop_exec" =~ (^|[[:space:]])--no-sandbox([[:space:]]|$) ]]; then
  echo "Desktop entry does not carry the AppImage's required --no-sandbox launch flag" >&2
  sed -n '1,120p' "$desktop_file" >&2
  exit 1
fi

required_resources=(
  "$appdir/resources/app.asar"
  "$appdir/resources/app-update.yml"
  "$appdir/resources/apparmor-profile"
)
for path in "${required_resources[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "Required packaged resource is missing: $path" >&2
    exit 1
  fi
done

mkdir -p "$smoke_dir/home" "$smoke_dir/config" "$smoke_dir/cache"
log="$smoke_dir/app.log"
dump_log() {
  sed "s|$smoke_dir|<smoke-dir>|g" "$log" | tail -n 120 >&2
}
setsid env -i \
  PATH="$PATH" \
  HOME="$smoke_dir/home" \
  XDG_CONFIG_HOME="$smoke_dir/config" \
  XDG_CACHE_HOME="$smoke_dir/cache" \
  xvfb-run -a "$appdir/AppRun" --no-sandbox --enable-logging=stderr >"$log" 2>&1 &
app_pid=$!

ready=0
for _ in $(seq 1 30); do
  sleep 1
  if grep -Fq 'App started v' "$log"; then
    ready=1
    break
  fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "AppImage exited before startup completed" >&2
    dump_log
    exit 1
  fi
done

if [[ "$ready" -ne 1 ]]; then
  echo "AppImage did not report startup within 30 seconds" >&2
  dump_log
  exit 1
fi
if [[ -n "$expected_version" ]] && ! grep -Fq "App started v${expected_version} pid=" "$log"; then
  echo "AppImage startup log does not contain expected version ${expected_version}" >&2
  dump_log
  exit 1
fi
# The startup marker is emitted before window and host initialization. Keep the production-mode
# process alive long enough for immediate initialization crashes to surface.
sleep 5
if ! kill -0 "$app_pid" 2>/dev/null; then
  echo "AppImage did not remain running after startup" >&2
  dump_log
  exit 1
fi

echo "Linux AppImage smoke test passed${expected_version:+ for v${expected_version}}"
