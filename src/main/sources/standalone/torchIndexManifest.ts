/**
 * Curated manifest of index-served PyTorch stacks — known-good tuples the
 * official PyTorch indexes serve that the R2 bundle catalog does not cover
 * (e.g. CUDA variants that keep kernels for GPU generations newer CUDA
 * builds dropped). Entries are pip-applied inside the journaled venv
 * transaction on every install type; there is no bundle artifact.
 *
 * Ships with the app: tuples are slow-moving (one build per torch version
 * per index) and additions ride app releases. Each entry declares the
 * compute-capability range its wheels contain kernels for, so entries a
 * detected NVIDIA GPU cannot run are hidden rather than failing at runtime
 * with "no kernel image available".
 */
import { execFile } from 'child_process'
import { stripPlatform } from './envPaths'
import { makeIndexStackId, torchIndexUrlFor } from './torchStackTypes'
import type { TorchStackPackages, TorchStackSource } from './torchStackTypes'
import type { TorchStackEntry } from './torchStackCatalog'

type IndexAccel = 'nvidia' | 'amd' | 'intel-xpu' | 'cpu' | 'mps'

interface TorchIndexStackDef {
  /** Index tag on download.pytorch.org/whl (`cu126`, `rocm6.4`, …); `pypi`
   *  for untagged tuples served by default PyPI (mac/MPS). */
  indexTag: string
  /** Accelerator base this stack serves — matches `stripPlatform(variant)`. */
  accel: IndexAccel
  /** Platforms the index actually publishes wheels for. */
  platforms: readonly NodeJS.Platform[]
  /** Exact tuple with local tags, so pip installs the exact same builds. */
  packages: TorchStackPackages
  /** Upstream release date (ISO), for display ordering. */
  date: string
  /** Inclusive compute-capability range the wheels ship kernels for
   *  (NVIDIA only). Omit when the build has no such constraint. */
  computeCap?: { min: number; max: number }
  /** i18n key suffix under `standalone.` for the picker description. */
  noteKey: string
}

/**
 * The curated stacks. torch 2.11.0 is the newest release with a matching
 * torchaudio (torchaudio ended at 2.11); cu126 is PyTorch's designated
 * legacy build keeping Maxwell/Pascal/Volta (sm 5.0–7.0) kernels that
 * cu128+ dropped, and cu128 serves Turing+ GPUs on CUDA 12.x drivers that
 * cannot run the cu130 bundles.
 */
const INDEX_STACKS: readonly TorchIndexStackDef[] = [
  {
    indexTag: 'cu126',
    accel: 'nvidia',
    platforms: ['win32', 'linux'],
    packages: { torch: '2.11.0+cu126', torchvision: '0.26.0+cu126', torchaudio: '2.11.0+cu126' },
    date: '2026-03-25',
    computeCap: { min: 5.0, max: 9.0 },
    noteKey: 'pytorchIndexNoteCu126',
  },
  {
    indexTag: 'cu128',
    accel: 'nvidia',
    platforms: ['win32', 'linux'],
    packages: { torch: '2.11.0+cu128', torchvision: '0.26.0+cu128', torchaudio: '2.11.0+cu128' },
    date: '2026-03-25',
    computeCap: { min: 7.5, max: 12.0 },
    noteKey: 'pytorchIndexNoteCu128',
  },
]

function sourceFor(def: TorchIndexStackDef): TorchStackSource {
  if (def.accel === 'mps') return { kind: 'pypi', backend: 'mps' }
  const backend = def.accel === 'nvidia' ? 'cuda'
    : def.accel === 'amd' ? 'rocm'
    : def.accel === 'intel-xpu' ? 'xpu'
    : 'cpu'
  return { kind: 'pytorch-index', backend, indexTag: def.indexTag }
}

/** Detected NVIDIA compute capabilities, one per GPU. `undefined` = not yet
 *  probed (cap-constrained entries hidden), `null` = probe failed (no
 *  nvidia-smi / no NVIDIA GPU — don't filter). */
let _computeCaps: number[] | null | undefined

/** Test-only: reset/override the cached probe result. */
export function _setComputeCapsForTest(caps: number[] | null | undefined): void {
  _computeCaps = caps
}

/**
 * Probe GPU compute capabilities via nvidia-smi, caching the result for the
 * synchronous catalog reads. Best-effort: any failure leaves filtering off.
 * Called from `refreshTorchStackCatalog` alongside the R2 fetch.
 */
export function refreshComputeCaps(): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi', ['--query-gpu=compute_cap', '--format=csv,noheader'],
      { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 },
      (err, stdout) => {
        if (err) {
          _computeCaps = null
          return resolve()
        }
        const caps = stdout.split('\n')
          .map((line) => Number.parseFloat(line.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
        _computeCaps = caps.length > 0 ? caps : null
        resolve()
      }
    )
  })
}

/** Whether any detected GPU falls inside the entry's kernel range. With
 *  multiple GPUs an entry serving ANY of them stays visible. Before the
 *  first probe, cap-constrained entries stay hidden (an incompatible stack
 *  would pass verification but crash at runtime with "no kernel image");
 *  they appear once check-update refreshes the catalog — same cadence as
 *  bundle entries. A *failed* probe (null) disables filtering instead: it
 *  must not permanently hide every index stack. */
function computeCapCompatible(def: TorchIndexStackDef): boolean {
  if (!def.computeCap) return true
  if (_computeCaps === undefined) return false
  if (_computeCaps === null || _computeCaps.length === 0) return true
  const { min, max } = def.computeCap
  return _computeCaps.some((cap) => cap >= min && cap <= max)
}

function entryFromDef(def: TorchIndexStackDef, variant: string): TorchStackEntry {
  return {
    stackId: makeIndexStackId(def.indexTag, def.packages.torch),
    variant,
    // Index stacks are Python-agnostic: pip resolves wheels against the
    // venv's own interpreter (a tuple with no wheel fails cleanly and rolls
    // back), so no bundle-style ABI constraint applies.
    pythonVersion: '',
    packages: def.packages,
    source: sourceFor(def),
    date: def.date,
    comfyuiVersion: '',
    noteKey: def.noteKey,
  }
}

/**
 * Index-served stacks available to a variant on this machine: accelerator
 * matches, the platform has wheels, a trusted index serves the tuple, and a
 * detected GPU (if any) has kernels in the build. Newest first.
 */
export function indexStacksForVariant(variant: string): TorchStackEntry[] {
  const accel = stripPlatform(variant)
  return INDEX_STACKS
    .filter((def) => def.accel === accel)
    .filter((def) => def.platforms.includes(process.platform))
    .filter((def) => torchIndexUrlFor(def.packages) !== null || def.accel === 'mps')
    .filter((def) => computeCapCompatible(def))
    .map((def) => entryFromDef(def, variant))
    .sort((a, b) => b.date.localeCompare(a.date))
}
