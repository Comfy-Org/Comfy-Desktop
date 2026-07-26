# Remote PyTorch index-stack manifest

The app offers index-served PyTorch stacks (pip-applied tuples with no bundle
artifact) in the Update tab's PyTorch picker. The list of stacks comes from a
remote manifest so new stacks can ship **without an app release**:

```text
https://desktop-assets.comfy.org/standalone-environments/torch-index-stacks.json
```

It lives in the same R2 namespace as the bundle catalog, so `fetchJSON` gives
it ETag caching and the GCS mirror fallback (China-reachable) automatically.
The app refreshes it on every check-update, persists the last valid copy for
offline reads, and falls back to the in-app curated list
(`src/main/sources/standalone/torchIndexManifest.ts`) until a remote manifest
has ever been fetched successfully. Publishing the file therefore *replaces*
the in-app list — include every stack that should be offered, and keep the
mirror sync covering it.

## Schema

```json
{
  "schemaVersion": 1,
  "stacks": [
    {
      "indexTag": "cu126",
      "accel": "nvidia",
      "platforms": ["win32", "linux"],
      "packages": {
        "torch": "2.11.0+cu126",
        "torchvision": "0.26.0+cu126",
        "torchaudio": "2.11.0+cu126"
      },
      "date": "2026-03-25",
      "computeCap": { "min": 5.0, "max": 9.0 },
      "noteKey": "pytorchIndexNoteCu126",
      "note": "For older NVIDIA GPUs (GTX 900/10-series and up)."
    },
    {
      "indexTag": "cu128",
      "accel": "nvidia",
      "platforms": ["win32", "linux"],
      "packages": {
        "torch": "2.11.0+cu128",
        "torchvision": "0.26.0+cu128",
        "torchaudio": "2.11.0+cu128"
      },
      "date": "2026-03-25",
      "computeCap": { "min": 7.5, "max": 12.0 },
      "noteKey": "pytorchIndexNoteCu128",
      "note": "For NVIDIA GPUs on CUDA 12.x drivers (RTX 20-series and up)."
    }
  ]
}
```

Field reference (validation is default-deny — an entry failing any rule is
dropped; other entries survive):

| Field | Required | Rules |
|---|---|---|
| `kind` | no | If present, must match the mechanism the accel implies: `pypi` for `mps`, `pytorch-index` for everything else. **Any new install mechanism must use a new kind** so app versions that don't implement it drop the entry instead of misapplying it (e.g. a future AMD-Windows channel). |
| `indexTag` | yes | Must be the tag the accel is served from: `cuN` for `nvidia`, `rocmN` for `amd`, `xpu` for `intel-xpu`, `cpu` for `cpu`, `pypi` for `mps`. Anything else drops the entry. |
| `accel` | yes | `nvidia`, `amd`, `intel-xpu`, `cpu`, or `mps`. `amd` entries must not list `win32` (see below); `mps` entries must list only `darwin`. |
| `platforms` | yes | Non-empty subset of `win32`, `linux`, `darwin`. |
| `packages` | yes | `torch` required; `torchvision`/`torchaudio` optional. Exact versions **with local tags** (`2.11.0+cu126`) so pip installs those exact builds. Versions are `[A-Za-z0-9._+]`. The torch local tag must equal `indexTag` (`mps` tuples must be untagged), and companion packages must carry the same tag or none — pip installs from the index the local tag derives, so a mismatched entry is dropped. Each `(indexTag, torch version)` pair must be unique: it IS the stack's identity (`stackId`), and all colliding entries are dropped. |
| `date` | yes | ISO date (`YYYY-MM-DD…`), used for display ordering. |
| `computeCap` | no | Inclusive NVIDIA compute-capability range the wheels ship kernels for. Informational only: an entry no detected GPU can run stays offered but carries a warning in the picker and the change-confirmation dialog (detection can be wrong or partial - multi-GPU boxes, eGPUs). |
| `pythonAbis` | no | Python `major.minor` list the index publishes wheels for (e.g. `["3.12"]` for AMD's universal ROCm package). Omit when any Python resolves; an empty list is rejected. |
| `noteKey` | no | i18n key suffix under `standalone.` for the picker description. Used when this app version has the translation. |
| `note` | no | Plain-text (English) picker description, max 300 chars; the fallback when `noteKey` is absent or unknown to the running app version. |

## Trust boundary

The manifest can only name **what** to install, never **where from**: pip is
always pointed at the trusted index derived from the tuple's local tag
(`torchIndexUrlFor` — download.pytorch.org or default PyPI). Consequences:

- A tuple with an unknown local tag is never offered (no trusted index).
- Windows AMD entries are rejected at parse time (pytorch.org publishes no
  Windows ROCm wheels; AMD's `repo.radeon.com` find-links + `rocm-sdk-*`
  mechanism is not a pip index this app supports). When AMD lands a standard
  channel, support ships in an app release first — typically as a new `kind`
  — and only then do manifest entries for it take effect.
- An unknown `schemaVersion` rejects the whole document (the app keeps its
  previous manifest); unknown *fields* on an entry are ignored, so additive
  metadata is safe to introduce.
- A non-empty document where no entry survives validation is rejected as a
  whole — it is indistinguishable from garbage, so it cannot replace the
  previous valid manifest. Withdrawing every stack must be the explicit
  `"stacks": []`.
