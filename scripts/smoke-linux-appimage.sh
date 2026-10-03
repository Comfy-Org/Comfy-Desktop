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

if ! file "$appimage" | grep -q 'ELF 64-bit.*x86-64'; then
  echo "AppImage is not a 64-bit x86-64 ELF executable" >&2
  file "$appimage" >&2
  exit 1
fi

smoke_dir="$(mktemp -d)"
app_pid=''
cleanup() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  rm -rf "$smoke_dir"
}
trap cleanup EXIT

(
  cd "$smoke_dir"
  "$appimage" --appimage-extract >/dev/null
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
if ! grep -Eq '^Exec=AppRun .*--no-sandbox|^Exec=AppRun --no-sandbox' "$desktop_file"; then
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
env \
  HOME="$smoke_dir/home" \
  XDG_CONFIG_HOME="$smoke_dir/config" \
  XDG_CACHE_HOME="$smoke_dir/cache" \
  E2E=1 \
  xvfb-run -a "$appimage" --no-sandbox --enable-logging=stderr >"$log" 2>&1 &
app_pid=$!

ready=0
for _ in $(seq 1 30); do
  if grep -q 'App started v' "$log"; then
    ready=1
    break
  fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "AppImage exited before startup completed" >&2
    sed -n '1,240p' "$log" >&2
    exit 1
  fi
  sleep 1
done

if [[ "$ready" -ne 1 ]]; then
  echo "AppImage did not report startup within 30 seconds" >&2
  sed -n '1,240p' "$log" >&2
  exit 1
fi
if [[ -n "$expected_version" ]] && ! grep -q "App started v${expected_version} " "$log"; then
  echo "AppImage startup log does not contain expected version ${expected_version}" >&2
  sed -n '1,120p' "$log" >&2
  exit 1
fi
if ! kill -0 "$app_pid" 2>/dev/null; then
  echo "AppImage did not remain running after startup" >&2
  sed -n '1,240p' "$log" >&2
  exit 1
fi

echo "Linux AppImage smoke test passed${expected_version:+ for v${expected_version}}"
