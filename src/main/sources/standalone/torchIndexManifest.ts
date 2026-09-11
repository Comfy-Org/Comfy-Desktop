/**
 * Curated manifest of index-served PyTorch stacks — known-good tuples the
 * official PyTorch indexes serve that the R2 bundle catalog does not cover
 * (e.g. CUDA variants that keep kernels for GPU generations newer CUDA
 * builds dropped). Entries are pip-applied inside the journaled venv
 * transaction on every install type; there is no bundle artifact.
 *
 * Two sources, remote preferred:
 * - `torch-index-stacks.json` on the R2 assets host (same namespace as the
 *   bundle catalog, so `fetchJSON` gives ETag caching and the GCS mirror
 *   fallback for free). Refreshed on check-update; the last valid manifest
 *   is persisted so offline reads keep working. This lets new stacks ship
 *   without an app release.
 * - The in-app `INDEX_STACKS` list below, used until a remote manifest has
 *   ever been fetched successfully.
 *
 * Remote entries are untrusted input that ends up in pip install arguments,
 * so validation is default-deny: unknown `kind` values, unknown accelerators,
 * or malformed version strings drop the entry (never the whole manifest).
 * A tuple is only ever installed from a trusted index the app derives itself
 * (`torchIndexUrlForSource`), so a manifest cannot point pip at an arbitrary
 * index — a `kind` only ever selects between hardcoded mechanisms: the
 * pytorch.org index the local tag names, or AMD's multi-arch index constant
 * (`amd-multi-arch-index`, the only source of Windows ROCm wheels).
 *
 * Each entry declares the compute-capability range its wheels contain
 * kernels for, so entries a detected NVIDIA GPU cannot run are hidden rather
 * than failing at runtime with "no kernel image available". Entries can also
 * pin the Python ABIs their wheels exist for (e.g. AMD's universal ROCm
 * package requires exactly 3.12).
 */
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { dataDir } from '../../lib/paths'
import { writeFileSafe } from '../../lib/safe-file'
import { fetchJSON } from '../../lib/fetch'
import { compareVersions, detectNvidiaDriverVersion } from '../../lib/gpu'
import { R2_BASE_URL } from '../../lib/r2Mirror'
import { isArm64Variant, variantAccel } from './envPaths'
import {
  isDevVersion,
  makeAmdIndexStackId,
  makeIndexStackId,
  publicVersion,
  torchIndexUrlForSource,
  torchLocalTag
} from './torchStackTypes'
import type { TorchStackPackages, TorchStackSource } from './torchStackTypes'
import type { TorchStackEntry } from './torchStackCatalog'

type IndexAccel = 'nvidia' | 'amd' | 'intel-xpu' | 'cpu' | 'mps'

export interface TorchIndexStackDef {
  /** Index tag on download.pytorch.org/whl (`cu126`, `rocm6.4`, …); `pypi`
   *  for untagged tuples served by default PyPI (mac/MPS). */
  indexTag: string
  /** Accelerator base this stack serves — matches `stripPlatform(variant)`. */
  accel: IndexAccel
  /** Platforms the index actually publishes wheels for. */
  platforms: readonly NodeJS.Platform[]
  /** Exact tuple with local tags, so pip installs the exact same builds. */
  packages: TorchStackPackages
  /** Upstream release date (ISO), for display ordering. For nightly
   *  entries this is the wheel date the freshness gate keys on. */
  date: string
  /** Present on nightly entries and AMD multi-arch entries; must survive
   *  the disk cache round-trip so re-validation on load still applies the
   *  kind's rules (a cached nightly re-parsed as stable would be dropped for
   *  its dev versions; a cached AMD multi-arch entry re-parsed as plain
   *  pytorch-index would be dropped for targeting win32). */
  kind?: 'pytorch-nightly-index' | 'amd-multi-arch-index'
  /** Inclusive compute-capability range the wheels ship kernels for
   *  (NVIDIA only). Omit when the build has no such constraint. */
  computeCap?: { min: number; max: number }
  /** Python ABIs (`major.minor`) the index publishes wheels for. Omit when
   *  any Python resolves (pip fails cleanly and rolls back otherwise) —
   *  declare it when wheels are known to exist only for specific ABIs. */
  pythonAbis?: readonly string[]
  /** i18n key suffix under `standalone.` for the picker description. Remote
   *  entries may name a key this app version doesn't have — display falls
   *  back to `note`. */
  noteKey?: string
  /** Plain-text picker description fallback (not localized); used when
   *  `noteKey` is absent or unknown to this app version. */
  note?: string
}

/** Display metadata for one backend series (index tag), shown on the series
 *  dropdown of the grouped PyTorch picker. Sourced from the manifest's
 *  optional top-level `series` map, falling back to the in-app defaults. */
export interface TorchSeriesInfo {
  /** i18n key suffix under `standalone.` for the series description;
   *  display falls back to `note` when this app version lacks the key. */
  noteKey?: string
  /** Plain-text series description fallback (not localized). */
  note?: string
  /** Minimum NVIDIA driver version the series' wheels run on, per platform
   *  (NVIDIA's per-CUDA-major minimum). Informational only: a detected
   *  older driver adds a warning, never hides or blocks the series. */
  minDriver?: Partial<Record<'win32' | 'linux' | 'darwin', string>>
}

/** In-app series defaults, used until a remote manifest supplies a `series`
 *  map (a remote entry replaces the whole built-in entry for its tag).
 *  Driver minimums follow NVIDIA's minor-version-compatibility rule: any
 *  CUDA 12.x wheel runs on the CUDA 12.0 minimum driver, any CUDA 13.x
 *  wheel on the CUDA 13.0 minimum. */
const INDEX_SERIES: Readonly<Record<string, TorchSeriesInfo>> = {
  cu126: { noteKey: 'pytorchSeriesNoteCu126', minDriver: { win32: '527.41', linux: '525.60.13' } },
  cu128: { noteKey: 'pytorchSeriesNoteCu128', minDriver: { win32: '527.41', linux: '525.60.13' } },
  cu130: { noteKey: 'pytorchSeriesNoteCu130', minDriver: { win32: '580.88', linux: '580.65.06' } },
  cu132: { noteKey: 'pytorchSeriesNoteCu132', minDriver: { win32: '580.88', linux: '580.65.06' } },
  'rocm7.1': { noteKey: 'pytorchSeriesNoteRocm71' },
  'rocm7.14.0': { noteKey: 'pytorchSeriesNoteRocm714' },
  xpu: { noteKey: 'pytorchSeriesNoteXpu' },
  cpu: { noteKey: 'pytorchSeriesNoteCpu' }
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
    noteKey: 'pytorchIndexNoteCu126'
  },
  {
    indexTag: 'cu128',
    accel: 'nvidia',
    platforms: ['win32', 'linux'],
    packages: { torch: '2.11.0+cu128', torchvision: '0.26.0+cu128', torchaudio: '2.11.0+cu128' },
    date: '2026-03-25',
    computeCap: { min: 7.5, max: 12.0 },
    noteKey: 'pytorchIndexNoteCu128'
  }
]

// ---------------------------------------------------------------------------
// Remote manifest
// ---------------------------------------------------------------------------

const REMOTE_MANIFEST_URL = `${R2_BASE_URL}/torch-index-stacks.json`
const REMOTE_CACHE_FILE = (): string => path.join(dataDir(), 'torch-index-manifest-cache.json')

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
/** Package versions end up in pip `pkg==version` arguments — allowlist. */
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+]*$/
const PYTHON_ABI = /^\d+\.\d+$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/
/** Dated nightly spelling the refresh automation publishes; the date is
 *  what the freshness gates key on. Matched against the public version. */
const NIGHTLY_DEV_DATE = /\.dev(\d{8})$/
const ACCELS: readonly IndexAccel[] = ['nvidia', 'amd', 'intel-xpu', 'cpu', 'mps']
const PLATFORMS: readonly NodeJS.Platform[] = ['win32', 'linux', 'darwin']
const NOTE_MAX_LENGTH = 300

function isSafeNote(v: unknown): v is string {
  // eslint-disable-next-line no-control-regex
  return typeof v === 'string' && v.length <= NOTE_MAX_LENGTH && !/[\x00-\x1f\x7f]/.test(v)
}

/** Dotted numeric driver version (`580.88`, `525.60.13`) - compared
 *  numerically against the detected NVIDIA driver. */
const DRIVER_VERSION = /^\d+(\.\d+)*$/

/** Validate one remote series entry, default-deny like the stack entries:
 *  the text reaches the picker UI and the noteKey reaches i18n lookups. */
function parseRemoteSeriesEntry(v: unknown): TorchSeriesInfo | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (r.noteKey !== undefined && (typeof r.noteKey !== 'string' || !SAFE_SEGMENT.test(r.noteKey)))
    return null
  if (r.note !== undefined && !isSafeNote(r.note)) return null
  let minDriver: TorchSeriesInfo['minDriver']
  if (r.minDriver !== undefined) {
    if (!r.minDriver || typeof r.minDriver !== 'object' || Array.isArray(r.minDriver)) return null
    minDriver = {}
    for (const [plat, version] of Object.entries(r.minDriver)) {
      if (!PLATFORMS.includes(plat as NodeJS.Platform)) return null
      if (typeof version !== 'string' || !DRIVER_VERSION.test(version)) return null
      minDriver[plat as 'win32' | 'linux' | 'darwin'] = version
    }
    if (Object.keys(minDriver).length === 0) return null
  }
  return {
    ...(r.noteKey ? { noteKey: r.noteKey as string } : {}),
    ...(r.note ? { note: r.note as string } : {}),
    ...(minDriver ? { minDriver } : {})
  }
}

/** Parse the manifest's optional top-level `series` map. Invalid entries
 *  are dropped one by one; a missing or malformed map is just empty (the
 *  in-app defaults keep serving those tags). */
function parseRemoteSeries(v: unknown): Record<string, TorchSeriesInfo> {
  const out: Record<string, TorchSeriesInfo> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [key, entry] of Object.entries(v)) {
    if (!SAFE_SEGMENT.test(key)) continue
    const parsed = parseRemoteSeriesEntry(entry)
    if (parsed) out[key] = parsed
  }
  return out
}

/** Validate one remote entry, default-deny. Remote input reaches pip install
 *  arguments and i18n lookups, so every field is allowlisted; unknown extra
 *  fields are ignored (additive forward compat), but an unknown `kind` drops
 *  the entry — it announces an install mechanism this app doesn't have. */
function parseRemoteStackDef(v: unknown): TorchIndexStackDef | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.indexTag !== 'string' || !SAFE_SEGMENT.test(r.indexTag)) return null
  if (typeof r.accel !== 'string' || !ACCELS.includes(r.accel as IndexAccel)) return null
  // `kind` must match a mechanism this app has. Stable entries use the kind
  // `sourceFor` derives from the accelerator; `pytorch-nightly-index` marks
  // dev tuples served from the nightly namespace (`torchIndexUrlFor` derives
  // that from the version itself, so the source stays `pytorch-index`).
  // A future manifest can introduce another kind and older app versions
  // drop those entries instead of misapplying them through the wrong
  // mechanism — exactly how `amd-multi-arch-index` (AMD's own channel,
  // below) shipped without breaking older desktops.
  const stableKind = r.accel === 'mps' ? 'pypi' : 'pytorch-index'
  const nightly = r.kind === 'pytorch-nightly-index'
  // AMD's TheRock multi-arch index: stable AMD tuples pip-applied from the
  // hardcoded AMD_MULTI_ARCH_INDEX_URL constant — the only mechanism that
  // serves Windows ROCm wheels (it serves Linux too).
  const amdMultiArch = r.kind === 'amd-multi-arch-index'
  if (amdMultiArch && r.accel !== 'amd') return null
  if ('kind' in r && !nightly && !amdMultiArch && r.kind !== stableKind) return null
  // PyPI serves no dev builds, so an MPS nightly has no install source.
  if (nightly && r.accel === 'mps') return null
  if (!Array.isArray(r.platforms) || r.platforms.length === 0) return null
  if (!r.platforms.every((p) => PLATFORMS.includes(p as NodeJS.Platform))) return null
  const pkgs = r.packages as Record<string, unknown> | undefined
  if (!pkgs || typeof pkgs !== 'object') return null
  if (typeof pkgs.torch !== 'string' || !SAFE_VERSION.test(pkgs.torch)) return null
  for (const opt of ['torchvision', 'torchaudio'] as const) {
    if (
      pkgs[opt] !== undefined &&
      (typeof pkgs[opt] !== 'string' || !SAFE_VERSION.test(pkgs[opt] as string))
    )
      return null
  }
  // The kind and the versions must agree. Stable entries reject dev
  // versions: nightlies live in a separate index namespace with ~60-day
  // retention, and a stable entry claiming one would lie about both its
  // install source and its lifetime. Nightly entries require dev versions
  // throughout - a stable version under the nightly kind would dodge the
  // freshness gate that keeps decaying entries out of the picker.
  for (const v of [pkgs.torch, pkgs.torchvision, pkgs.torchaudio]) {
    if (typeof v === 'string' && isDevVersion(v) !== nightly) return null
  }
  // Nightly versions must be the dated spelling sharing ONE wheel date, and
  // `date` must be exactly that real, non-future UTC date - the freshness
  // gate trusts `date`, and R2 is untrusted, so a fabricated date must not
  // let a decaying pin dodge the dead-man's switch below.
  if (nightly) {
    const wheelDates = new Set<string>()
    for (const v of [pkgs.torch, pkgs.torchvision, pkgs.torchaudio]) {
      if (typeof v !== 'string') continue
      const day = NIGHTLY_DEV_DATE.exec(publicVersion(v))?.[1]
      if (!day) return null
      wheelDates.add(day)
    }
    if (wheelDates.size !== 1) return null
    const [d] = wheelDates
    if (!d) return null
    const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
    if (r.date !== iso) return null
    const parsed = Date.parse(`${iso}T00:00:00Z`)
    if (!Number.isFinite(parsed)) return null
    // round-trip catches non-dates like 2026-02-31 that Date.parse coerces
    if (new Date(parsed).toISOString().slice(0, 10) !== iso) return null
    if (parsed - Date.now() > 24 * 60 * 60 * 1000) return null
  }
  // One coherent source per accelerator: the accel must name an index tag it
  // can actually be served from, and the torch local tag must agree with it
  // — pip installs from whatever index the LOCAL TAG derives
  // (`torchIndexUrlFor`), so a disagreeing entry would mint a stackId lying
  // about its install source (e.g. accel `amd` served from the cpu index).
  const tagOk =
    r.accel === 'nvidia'
      ? /^cu\d+$/.test(r.indexTag)
      : r.accel === 'amd'
        ? /^rocm[\d.]+$/.test(r.indexTag)
        : r.accel === 'intel-xpu'
          ? r.indexTag === 'xpu'
          : r.accel === 'cpu'
            ? r.indexTag === 'cpu'
            : r.indexTag === 'pypi'
  if (!tagOk) return null
  const torchTag = torchLocalTag(pkgs.torch)
  if (r.accel === 'mps') {
    // The only PyPI-served accel: untagged tuple, mac-only.
    if (torchTag !== '' || !r.platforms.every((p) => p === 'darwin')) return null
  } else if (torchTag !== r.indexTag) {
    return null
  }
  // pytorch.org publishes no Windows ROCm wheels — only `amd-multi-arch-index`
  // entries (applied from AMD's own index) may target win32; plain
  // pytorch-index AMD entries are rejected rather than relying on the
  // runtime index gate alone.
  if (r.accel === 'amd' && r.platforms.includes('win32') && !amdMultiArch) return null
  // Companion packages install from the same index — same tag (or none).
  // AMD multi-arch tuples must be fully tagged: an untagged companion pin
  // would resolve against AMD's broad index to an arbitrary ROCm build.
  for (const opt of ['torchvision', 'torchaudio'] as const) {
    if (pkgs[opt] === undefined) continue
    const companionTag = torchLocalTag(pkgs[opt] as string)
    if (companionTag !== torchTag && !(companionTag === '' && !amdMultiArch)) return null
  }
  if (typeof r.date !== 'string' || !ISO_DATE.test(r.date)) return null
  if (r.computeCap !== undefined) {
    const cap = r.computeCap as Record<string, unknown>
    if (!cap || typeof cap !== 'object') return null
    if (typeof cap.min !== 'number' || !Number.isFinite(cap.min)) return null
    if (typeof cap.max !== 'number' || !Number.isFinite(cap.max)) return null
    if (cap.min > cap.max) return null
  }
  if (r.pythonAbis !== undefined) {
    // A present-but-empty declaration is ambiguous (the runtime treats empty
    // as unrestricted) — reject it rather than silently widen.
    if (!Array.isArray(r.pythonAbis) || r.pythonAbis.length === 0) return null
    if (!r.pythonAbis.every((a) => typeof a === 'string' && PYTHON_ABI.test(a))) return null
  }
  if (r.noteKey !== undefined && (typeof r.noteKey !== 'string' || !SAFE_SEGMENT.test(r.noteKey)))
    return null
  if (r.note !== undefined && !isSafeNote(r.note)) return null
  return {
    indexTag: r.indexTag,
    accel: r.accel as IndexAccel,
    ...(nightly ? { kind: 'pytorch-nightly-index' as const } : {}),
    ...(amdMultiArch ? { kind: 'amd-multi-arch-index' as const } : {}),
    platforms: r.platforms as NodeJS.Platform[],
    packages: {
      torch: pkgs.torch,
      ...(pkgs.torchvision ? { torchvision: pkgs.torchvision as string } : {}),
      ...(pkgs.torchaudio ? { torchaudio: pkgs.torchaudio as string } : {})
    },
    date: r.date,
    ...(r.computeCap
      ? {
          computeCap: {
            min: (r.computeCap as { min: number }).min,
            max: (r.computeCap as { max: number }).max
          }
        }
      : {}),
    ...(r.pythonAbis ? { pythonAbis: r.pythonAbis as string[] } : {}),
    ...(r.noteKey ? { noteKey: r.noteKey } : {}),
    ...(r.note ? { note: r.note } : {})
  }
}

/** Parse a whole manifest document. Invalid entries are dropped one by one
 *  (a future entry type must not kill the rest of a mixed document); an
 *  unknown schemaVersion rejects the document — its entries can't be assumed
 *  entry-shaped. A non-empty document where NO entry survives is also
 *  rejected (it can't be distinguished from garbage) so the previous valid
 *  state is kept: withdrawing every stack must be the explicit
 *  `stacks: []`. Entries whose stackId collides are all dropped — the
 *  renderer round-trips only the id, so duplicates could display one tuple
 *  and install another. */
function parseRemoteManifest(
  data: unknown
): { defs: TorchIndexStackDef[]; series: Record<string, TorchSeriesInfo> } | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const doc = data as Record<string, unknown>
  if (doc.schemaVersion !== 1) return null
  if (!Array.isArray(doc.stacks)) return null
  const defs = doc.stacks
    .map(parseRemoteStackDef)
    .filter((d): d is TorchIndexStackDef => d !== null)
  const ids = new Map<string, number>()
  for (const d of defs) {
    const id = stackIdForDef(d)
    ids.set(id, (ids.get(id) ?? 0) + 1)
  }
  const unique = defs.filter((d) => ids.get(stackIdForDef(d)) === 1)
  if (doc.stacks.length > 0 && unique.length === 0) return null
  return { defs: unique, series: parseRemoteSeries(doc.series) }
}

/** Validated remote defs; null until a remote manifest has ever been loaded
 *  (then the in-app list is authoritative). An empty array is a valid remote
 *  state: it means "offer no index stacks". */
let _remoteDefs: TorchIndexStackDef[] | null = null
/** Remote `series` map; null until a remote manifest has ever been loaded.
 *  Looked up per tag with the in-app defaults as fallback, so an older
 *  manifest without the map keeps the built-in notes and driver minimums. */
let _remoteSeries: Record<string, TorchSeriesInfo> | null = null
let _remoteDiskLoaded = false
let _remoteAttempted = false
let _remoteRefresh: Promise<void> | null = null

/** Test-only: reset/override remote manifest state. */
export function _setRemoteDefsForTest(
  defs: TorchIndexStackDef[] | null,
  series?: Record<string, TorchSeriesInfo> | null
): void {
  _remoteDefs = defs
  _remoteSeries = series ?? null
  _remoteDiskLoaded = true
  _remoteAttempted = true
}

/** Test-only: reset remote manifest state to cold start. */
export function _resetRemoteForTest(): void {
  _remoteDefs = null
  _remoteSeries = null
  _remoteDiskLoaded = false
  _remoteAttempted = false
  _remoteRefresh = null
}

/** The manifest in effect: remote (memory, then last-good disk cache), else
 *  the in-app list. Disk cache is re-validated on load — it is shared across
 *  app versions and could be stale or tampered. */
function activeDefs(): readonly TorchIndexStackDef[] {
  if (_remoteDefs === null && !_remoteDiskLoaded) {
    _remoteDiskLoaded = true
    try {
      const raw = JSON.parse(fs.readFileSync(REMOTE_CACHE_FILE(), 'utf-8'))
      const parsed = parseRemoteManifest(raw)
      if (parsed !== null) {
        _remoteDefs = parsed.defs
        _remoteSeries = parsed.series
      }
    } catch {
      // no cache / unreadable — keep built-ins
    }
  }
  return _remoteDefs ?? INDEX_STACKS
}

async function fetchRemoteIndexStacks(): Promise<void> {
  try {
    const data = await fetchJSON(REMOTE_MANIFEST_URL, { refresh: true })
    const parsed = parseRemoteManifest(data)
    if (parsed !== null) {
      _remoteDefs = parsed.defs
      _remoteSeries = parsed.series
      _remoteDiskLoaded = true
      try {
        writeFileSafe(
          REMOTE_CACHE_FILE(),
          JSON.stringify({ schemaVersion: 1, series: parsed.series, stacks: parsed.defs }, null, 2)
        )
      } catch {
        // cache persistence is best-effort
      }
    }
  } catch {
    // offline / not yet published — keep disk cache or built-ins
  } finally {
    _remoteAttempted = true
  }
}

/** Fetch + validate the remote manifest, replacing the in-app list and
 *  persisting the result for offline reads. Best-effort: network or schema
 *  failures keep the current state (never throws). Called from
 *  `refreshTorchStackCatalog` alongside the R2 releases fetch. All callers
 *  share one in-flight fetch — concurrent refreshes (multiple installs
 *  checking for updates) must not race each other's memory/disk writes. */
export function refreshRemoteIndexStacks(): Promise<void> {
  _remoteRefresh ??= fetchRemoteIndexStacks().finally(() => {
    _remoteRefresh = null
  })
  return _remoteRefresh
}

/** Fetch the remote manifest only if it was never attempted. Awaited by
 *  resolve paths (snapshot restore, change-pytorch) so an exact restore of a
 *  remote-manifest stack isn't rejected just because no check-update ran
 *  since app start; joins any in-flight refresh. */
export function ensureRemoteIndexStacks(): Promise<void> {
  if (_remoteAttempted) return Promise.resolve()
  return refreshRemoteIndexStacks()
}

function sourceFor(def: TorchIndexStackDef): TorchStackSource {
  if (def.kind === 'amd-multi-arch-index')
    return { kind: 'amd-multi-arch-index', indexTag: def.indexTag }
  if (def.accel === 'mps') return { kind: 'pypi', backend: 'mps' }
  const backend =
    def.accel === 'nvidia'
      ? 'cuda'
      : def.accel === 'amd'
        ? 'rocm'
        : def.accel === 'intel-xpu'
          ? 'xpu'
          : 'cpu'
  return { kind: 'pytorch-index', backend, indexTag: def.indexTag }
}

/** Detected NVIDIA compute capabilities, one per GPU. `undefined` = not yet
 *  probed, `null` = probe failed (no nvidia-smi / no NVIDIA GPU). Caps never
 *  hide an entry - they only feed the informational mismatch warning. */
let _computeCaps: number[] | null | undefined

/** Test-only: reset/override the cached probe result. */
export function _setComputeCapsForTest(caps: number[] | null | undefined): void {
  _computeCaps = caps
}

/** Test-only: replace the nvidia-smi probe (child_process can't be mocked
 *  under the vitest setup). Pass undefined to restore the real probe. */
export function _setComputeCapProbeForTest(
  probe: (() => Promise<number[] | null>) | undefined
): void {
  _probeFn = probe ?? probeComputeCaps
}

/** The real nvidia-smi probe: caps on success, null on any failure. */
function probeComputeCaps(): Promise<number[] | null> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=compute_cap', '--format=csv,noheader'],
      { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null)
        const caps = stdout
          .split('\n')
          .map((line) => Number.parseFloat(line.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
        resolve(caps.length > 0 ? caps : null)
      }
    )
  })
}

let _probeFn: () => Promise<number[] | null> = probeComputeCaps

/**
 * Probe GPU compute capabilities via nvidia-smi, caching the result for the
 * synchronous catalog reads. Best-effort: any failure just leaves the
 * mismatch warnings off. Called from `refreshTorchStackCatalog` alongside
 * the R2 fetch.
 */
export async function refreshComputeCaps(): Promise<void> {
  _computeCaps = await _probeFn()
}

/** Detected NVIDIA driver version. `undefined` = not yet probed, `null` =
 *  probe failed (no nvidia-smi / no NVIDIA GPU). Like compute caps, the
 *  driver version never hides an entry - it only feeds the informational
 *  too-old-driver warning. */
let _nvidiaDriver: string | null | undefined

/** Test-only: reset/override the cached driver probe result. */
export function _setNvidiaDriverForTest(version: string | null | undefined): void {
  _nvidiaDriver = version
}

let _driverProbeFn: () => Promise<string | null> = async () =>
  (await detectNvidiaDriverVersion()) ?? null

/** Test-only: replace the nvidia-smi driver probe. Pass undefined to
 *  restore the real probe. */
export function _setNvidiaDriverProbeForTest(
  probe: (() => Promise<string | null>) | undefined
): void {
  _driverProbeFn = probe ?? (async () => (await detectNvidiaDriverVersion()) ?? null)
}

/**
 * Probe the NVIDIA driver version via nvidia-smi, caching the result for the
 * synchronous catalog reads. Best-effort: any failure just leaves the
 * driver warnings off. Called from `refreshTorchStackCatalog` alongside
 * the compute-cap probe.
 */
export async function refreshNvidiaDriver(): Promise<void> {
  try {
    _nvidiaDriver = await _driverProbeFn()
  } catch {
    // A failed probe must neither abort the catalog refresh that awaits
    // this nor leave a stale version warning about a replaced driver.
    _nvidiaDriver = null
  }
}

/**
 * Display metadata for a backend series id (`cu126`, `rocm7.1`, ...):
 * the remote manifest's `series` entry when it has one, else the in-app
 * default. Nightly groups look up their base tag (`nightly-cu132` ->
 * `cu132`) on the caller's side.
 */
export function torchSeriesInfo(seriesId: string): TorchSeriesInfo | null {
  activeDefs() // ensure the disk cache (and its series map) is loaded
  return _remoteSeries?.[seriesId] ?? INDEX_SERIES[seriesId] ?? null
}

/**
 * The series' minimum NVIDIA driver for this platform when the detected
 * driver is older - the basis of the picker's informational warning.
 * Unknown driver (never probed, probe failed) or no declared minimum
 * produces no warning; like compute caps, a mismatch never hides or blocks
 * a series - detection can be wrong (multi-GPU, probe before a driver
 * install), so the user keeps the full catalog and the final word.
 */
export function nvidiaDriverMismatch(
  info: TorchSeriesInfo | null
): { required: string; detected: string } | null {
  const required = info?.minDriver?.[process.platform as 'win32' | 'linux' | 'darwin']
  if (!required || !_nvidiaDriver) return null
  if (compareVersions(_nvidiaDriver, required) >= 0) return null
  return { required, detected: _nvidiaDriver }
}

/** The entry's kernel range when NO detected GPU falls inside it - the
 *  basis of the picker's informational warning. With multiple GPUs an entry
 *  serving ANY of them warns about nothing. Caps never hide or block an
 *  entry: detection can be wrong or partial (multi-GPU boxes, eGPUs, a
 *  probe that ran before a driver install), so the user keeps the full
 *  catalog and the final word. Unknown caps (never probed, probe failed)
 *  produce no warning; warnings appear once check-update refreshes the
 *  catalog - same cadence as bundle entries. */
function capMismatch(
  def: TorchIndexStackDef
): { min: number; max: number; detected: number[] } | null {
  if (!def.computeCap) return null
  if (_computeCaps == null || _computeCaps.length === 0) return null
  const { min, max } = def.computeCap
  if (_computeCaps.some((cap) => cap >= min && cap <= max)) return null
  return { min, max, detected: [..._computeCaps] }
}

/** Entry identity. AMD multi-arch entries mint in their own `amd-index:`
 *  namespace so a pytorch.org entry sharing the tag + torch version can
 *  never collide with (or be dropped alongside) one. */
function stackIdForDef(def: TorchIndexStackDef): string {
  return def.kind === 'amd-multi-arch-index'
    ? makeAmdIndexStackId(def.indexTag, def.packages.torch)
    : makeIndexStackId(def.indexTag, def.packages.torch)
}

function entryFromDef(def: TorchIndexStackDef, variant: string): TorchStackEntry {
  const mismatch = capMismatch(def)
  return {
    stackId: stackIdForDef(def),
    variant,
    // Index stacks are Python-agnostic: pip resolves wheels against the
    // venv's own interpreter (a tuple with no wheel fails cleanly and rolls
    // back), so no bundle-style ABI constraint applies.
    pythonVersion: '',
    packages: def.packages,
    source: sourceFor(def),
    date: def.date,
    comfyuiVersion: '',
    ...(def.noteKey ? { noteKey: def.noteKey } : {}),
    ...(def.note ? { note: def.note } : {}),
    ...(def.pythonAbis ? { pythonAbis: [...def.pythonAbis] } : {}),
    ...(mismatch ? { capWarning: mismatch } : {})
  }
}

/** How long a nightly entry stays offered after its wheel date. PyTorch
 *  purges dated nightlies from the index after roughly 60 days; stopping
 *  well short of that avoids offering installs about to 404, and doubles
 *  as a dead-man's switch - if the manifest refresh automation stalls, the
 *  picker quietly stops offering nightlies instead of serving dying pins.
 *  Already-installed nightlies are unaffected (they stay pinned; only
 *  reacquisition eventually fails, cleanly). */
const NIGHTLY_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000

function nightlyFresh(def: TorchIndexStackDef): boolean {
  if (def.kind !== 'pytorch-nightly-index') return true
  // The parser guaranteed date is the tuple's real, non-future wheel date.
  const wheelDate = Date.parse(`${def.date}T00:00:00Z`)
  return Number.isFinite(wheelDate) && Date.now() - wheelDate <= NIGHTLY_MAX_AGE_MS
}

/**
 * Index-served stacks available to a variant on this machine: accelerator
 * matches, the platform has wheels, a trusted index serves the tuple, and a
 * nightly entry is still young enough to install. Newest first. An entry
 * whose kernel range misses every detected GPU is annotated with
 * `capWarning`, never dropped.
 *
 * Native Windows ARM64 bundles get no index stacks: no index this app trusts
 * publishes `win_arm64` wheels (pytorch.org and AMD's index are x64-only),
 * so every tuple here would fail at pip time. Their only switchable stacks
 * are their own bundles. Lift this once the manifest grows an architecture
 * dimension and a kind that serves NVIDIA's `cu134` ARM64 wheels.
 */
export function indexStacksForVariant(variant: string): TorchStackEntry[] {
  if (isArm64Variant(variant)) return []
  const accel = variantAccel(variant)
  return (
    activeDefs()
      .filter((def) => def.accel === accel)
      .filter((def) => def.platforms.includes(process.platform))
      .filter(nightlyFresh)
      // Only tuples a trusted index serves, judged from the entry's SOURCE
      // (an amd-multi-arch-index source is served by AMD's hardcoded index
      // even on Windows, where the tag-derived lookup refuses rocm tags);
      // MPS is PyPI-served and must be untagged (a tagged build has no PyPI
      // source).
      .filter(
        (def) =>
          torchIndexUrlForSource(sourceFor(def), def.packages) !== null ||
          (def.accel === 'mps' && torchLocalTag(def.packages.torch) === '')
      )
      .map((def) => entryFromDef(def, variant))
      .sort((a, b) => b.date.localeCompare(a.date))
  )
}
