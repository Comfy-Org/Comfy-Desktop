# Proprietary fonts (do not commit binaries here)

This directory holds **PP Formula** (Pangram Pangram), the brand display face.
It is a paid, license-restricted font and **must never be committed to this
public repository**.

No heading uses it today: page, modal and takeover titles all render in Inter.
The `--font-display` token and the fetch step stay in place so the face can come
back without rebuilding the pipeline.

The font files in this folder are gitignored (see the repo `.gitignore`). Only
this README is tracked, so the directory and these instructions survive a clean
checkout.

## How it is loaded

`src/renderer/src/assets/proprietaryFonts.ts` registers the face at runtime with
`FontFace`, from `./fonts/PPFormula-Extrabold.otf` in this public dir. Each
renderer entry calls `loadProprietaryFonts()` on start. When the file is absent
(OSS clones, most dev and CI builds) the load fails silently and the
`--font-display` token in `design-system-theme.css` falls back to Inter.

## Release builds

`build-release.yml` authenticates to GCP via Workload Identity Federation and runs
`pnpm run font:fetch` before building, which downloads the font into this folder
from the private bucket `gs://comfy-org-fonts`.

## Local development

The font is not needed for dev: no screen renders it, so a checkout without it
looks the same as a release build. To fetch it anyway, authenticate with a
comfy.org Google account and run:

```bash
pnpm run font:fetch
```

This requires read access to `gs://comfy-org-fonts`.
