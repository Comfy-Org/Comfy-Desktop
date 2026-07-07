#!/usr/bin/env bash
set -euo pipefail

# Cross-compile the Windows installer from Linux/macOS using the
# electronuserland/builder:wine image. Adapted from the Glancy strategy:
# instead of compiling native modules for the target (which needs MSVC),
# we rely on the fact that Comfy Desktop's native deps already ship
# ready-to-run Windows binaries:
#
#   - node-pty  -> prebuilds/win32-x64/{pty,conpty,...}.node + winpty.dll
#                  (real Windows PE binaries, loaded at runtime by platform dir)
#   - 7zip-bin  -> win/x64/7za.exe (prebuilt exe, no native addon)
#
# The one hazard: a normal `pnpm install` on this Linux host runs
# electron-builder's install-app-deps, which rebuilds node-pty FOR LINUX
# into build/Release/pty.node. node-pty's loader (lib/utils.js) prefers
# build/Release OVER prebuilds/, so that Linux binary would shadow the
# correct Windows prebuild inside the packaged app. We avoid it entirely
# with a clean --ignore-scripts install, so build/Release never exists and
# only the Windows prebuilds remain.

cd "$(dirname "$0")/.."

ELECTRON_VERSION=$(node -e "console.log(require('./node_modules/electron/package.json').version)")

echo "Building Comfy Desktop for Windows (x64)"
echo "  Electron: ${ELECTRON_VERSION}"
echo "  Docker:   electronuserland/builder:wine"
echo ""

# bootstrap-python/win-x64 is a gitignored extraResource the win target
# needs. Fetch it on the HOST (pure download, no compilation) so it is
# present in the bind mount. Skip if already populated.
if [ ! -f "bootstrap-python/win-x64/python.exe" ]; then
  echo "==> Fetching bootstrap-python for win-x64 (host)..."
  corepack pnpm run bootstrap:fetch -- --platform win-x64
else
  echo "==> bootstrap-python/win-x64 already present; skipping fetch."
fi
echo ""

# --network host: use the host network stack instead of Docker's default
# bridge. A running `kind` cluster sets the host FORWARD policy to DROP and
# leaves other bridges' outbound traffic blackholed, so a bridged container
# cannot reach the npm registry (corepack/pnpm install fails). Host networking
# sidesteps the poisoned bridge and needs no root iptables changes.
docker run --rm \
  --network host \
  -v "$(pwd)":/project \
  -v "${HOME}/.cache/electron":/root/.cache/electron \
  -v "${HOME}/.cache/electron-builder":/root/.cache/electron-builder \
  -v comfy-desktop-win-node-modules:/project/node_modules \
  -v comfy-desktop-win-pnpm-store:/pnpm-store \
  -w /project \
  -e CI=true \
  -e PNPM_HOME=/pnpm-home \
  -e npm_config_store_dir=/pnpm-store \
  -e ELECTRON_VERSION="${ELECTRON_VERSION}" \
  electronuserland/builder:wine \
  /bin/bash -c '
    set -euo pipefail

    echo "==> Enabling pnpm via corepack..."
    corepack enable
    corepack prepare pnpm@10.28.1 --activate

    echo "==> Installing dependencies (ignore-scripts: no Linux native rebuild)..."
    # node_modules is a dedicated Docker volume (not the host bind mount), so
    # this clean install never touches your host node_modules / local dev setup.
    # store-dir=/pnpm-store (a volume outside /project) stops pnpm from writing
    # a root-owned .pnpm-store/ into the bind-mounted project, which would then
    # break lint/typecheck and dirty the working tree on the host.
    # --ignore-scripts skips postinstall.mjs -> install-app-deps, which would
    # otherwise compile node-pty for Linux and shadow the Windows prebuild.
    # CI=true lets pnpm clear a stale volume without a TTY prompt.
    pnpm install --frozen-lockfile --ignore-scripts --store-dir /pnpm-store

    echo "==> Verifying node-pty ships Windows prebuilds and NOT a Linux build/Release..."
    if [ -e node_modules/node-pty/build/Release/pty.node ]; then
      echo "    FAIL: node-pty/build/Release/pty.node exists — a Linux build would"
      echo "          shadow the Windows prebuild at runtime. Aborting."
      exit 1
    fi
    for f in pty.node conpty.node winpty.dll; do
      bin="node_modules/node-pty/prebuilds/win32-x64/${f}"
      [ -f "${bin}" ] || { echo "    FAIL: missing ${bin}"; exit 1; }
    done
    # pty.node / conpty.node are PE (MZ); winpty.dll is also PE.
    head -c 2 node_modules/node-pty/prebuilds/win32-x64/pty.node | grep -q "MZ" \
      && echo "    OK: node-pty Windows prebuild confirmed (MZ header)" \
      || { echo "    FAIL: node-pty/prebuilds/win32-x64/pty.node is not a Windows binary"; exit 1; }

    echo "==> Verifying 7zip-bin ships the Windows 7za.exe..."
    head -c 2 node_modules/7zip-bin/win/x64/7za.exe | grep -q "MZ" \
      && echo "    OK: 7za.exe confirmed (MZ header)" \
      || { echo "    FAIL: 7zip-bin/win/x64/7za.exe missing or not a Windows binary"; exit 1; }

    echo "==> Type-checking + building renderer/main (electron-vite)..."
    pnpm run build

    echo "==> Packaging Windows NSIS installer (electron-builder)..."
    # -c.npmRebuild=false: skip electron-builder pack-time @electron/rebuild,
    # which node-gyp cross-compiles node-pty and fails. We ship the verified
    # Windows prebuilds as-is. CLI override (not electron-builder.yml) so the
    # shared ToDesktop CI config is untouched. --publish never: no release feed.
    pnpm exec electron-builder --win --x64 -c.npmRebuild=false --publish never
  '

echo ""
echo "Build complete. Artifacts:"
ls -lh dist/*.exe 2>/dev/null || echo "  (check dist/ for output)"
