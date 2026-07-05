{
  description = "Comfy Desktop (Electron + Vue 3 + TypeScript) development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };

        # Node.js and pnpm. package.json requires node >=22, pnpm >=10.
        nodejs = pkgs.nodejs_22;
        pnpm = pkgs.pnpm.override { nodejs-slim = nodejs; };

        # Shared libraries that the prebuilt Electron/Chromium binary and the
        # native node addons (node-pty) dlopen() at runtime. On NixOS these are
        # not on a global library path, so nix-ld needs them via
        # NIX_LD_LIBRARY_PATH for the unpatched npm-shipped binaries to launch.
        runtimeLibs = with pkgs; [
          # Core C/C++ runtime
          stdenv.cc.cc.lib
          glibc
          zlib

          # Chromium / Electron GUI stack
          glib
          nss
          nspr
          at-spi2-atk
          at-spi2-core
          atk
          cairo
          cups
          dbus
          expat
          gtk3
          pango
          gdk-pixbuf

          # X11
          libx11
          libxcomposite
          libxdamage
          libxext
          libxfixes
          libxrandr
          libxrender
          libxtst
          libxi
          libxcursor
          libxscrnsaver
          libxcb
          libxkbfile

          # Rendering / audio / input
          libgbm
          libdrm
          libxkbcommon
          mesa
          alsa-lib
          libpulseaudio
          libGL

          # Misc Electron deps
          libnotify
          libuuid
          systemd # libudev
          fontconfig
          freetype
        ];

        libraryPath = pkgs.lib.makeLibraryPath runtimeLibs;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            nodejs
            pnpm
            pkgs.node-gyp

            # Build toolchain for native addons (node-pty).
            pkgs.python313 # scripts/build-bootstrap-python.mjs also downloads its own standalone python, but node-gyp needs a system python
            pkgs.gcc
            pkgs.gnumake
            pkgs.pkg-config

            pkgs.git
          ];

          # nix-ld uses these to resolve the loader + libs for unpatched
          # binaries (electron, node-pty .node). Prepend our runtime libs to
          # whatever the host nix-ld already provides.
          NIX_LD_LIBRARY_PATH = "${libraryPath}:${builtins.getEnv "NIX_LD_LIBRARY_PATH"}";
          NIX_LD = pkgs.lib.fileContents "${pkgs.stdenv.cc}/nix-support/dynamic-linker";

          # Also expose to LD_LIBRARY_PATH so dlopen() from already-running
          # node/electron processes (e.g. node-pty) finds the libs too.
          LD_LIBRARY_PATH = libraryPath;

          shellHook = ''
            echo "Comfy Desktop dev shell"
            echo "  node   $(node --version)"
            echo "  pnpm   $(pnpm --version)"
            echo "  python $(python3 --version)"
            echo ""
            echo "First-time setup:  pnpm run init      # install deps + build bootstrap python"
            echo "Run (Linux):       ./linux-dev.sh     # electron-vite dev with sandbox disabled"
            echo ""
          '';
        };
      }
    );
}
