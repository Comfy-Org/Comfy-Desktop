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
 * A tuple is only ever installed from the trusted index its local tag names
 * (`torchIndexUrlFor`), so a manifest cannot point pip at an arbitrary index
 * — e.g. Windows ROCm builds come from AMD's own channels today, and stay
 * hidden until an app release explicitly supports that mechanism.
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
import { R2_BASE_URL } from '../../lib/r2Mirror'
import { stripPlatform } from './envPaths'
import { isDevVersion, makeIndexStackId, publicVersion, torchIndexUrlFor, torchLocalTag } from './torchStackTypes'
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
  /** Present on nightly entries; must survive the disk cache round-trip so
   *  re-validation on load still applies the nightly rules (a cached
   *  nightly re-parsed as stable would be dropped for its dev versions). */
  kind?: 'pytorch-nightly-index'
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
  // A future manifest can introduce another kind (e.g. AMD's own Windows
  // channel) and older app versions drop those entries instead of
  // misapplying them through the wrong mechanism.
  const stableKind = r.accel === 'mps' ? 'pypi' : 'pytorch-index'
  const nightly = r.kind === 'pytorch-nightly-index'
  if ('kind' in r && !nightly && r.kind !== stableKind) return null
  // PyPI serves no dev builds, so an MPS nightly has no install source.
  if (nightly && r.accel === 'mps') return null
  if (!Array.isArray(r.platforms) || r.platforms.length === 0) return null
  if (!r.platforms.every((p) => PLATFORMS.includes(p as NodeJS.Platform))) return null
  const pkgs = r.packages as Record<string, unknown> | undefined
  if (!pkgs || typeof pkgs !== 'object') return null
  if (typeof pkgs.torch !== 'string' || !SAFE_VERSION.test(pkgs.torch)) return null
  for (const opt of ['torchvision', 'torchaudio'] as const) {
    if (pkgs[opt] !== undefined && (typeof pkgs[opt] !== 'string' || !SAFE_VERSION.test(pkgs[opt] as string))) return null
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
    r.accel === 'nvidia' ? /^cu\d+$/.test(r.indexTag)
    : r.accel === 'amd' ? /^rocm[\d.]+$/.test(r.indexTag)
    : r.accel === 'intel-xpu' ? r.indexTag === 'xpu'
    : r.accel === 'cpu' ? r.indexTag === 'cpu'
    : r.indexTag === 'pypi'
  if (!tagOk) return null
  const torchTag = torchLocalTag(pkgs.torch)
  if (r.accel === 'mps') {
    // The only PyPI-served accel: untagged tuple, mac-only.
    if (torchTag !== '' || !r.platforms.every((p) => p === 'darwin')) return null
  } else if (torchTag !== r.indexTag) {
    return null
  }
  // pytorch.org publishes no Windows ROCm wheels; AMD's SDK/find-links
  // channel is not a mechanism schema 1 can express — reject rather than
  // rely on the runtime index gate alone.
  if (r.accel === 'amd' && r.platforms.includes('win32')) return null
  // Companion packages install from the same index — same tag (or none).
  for (const opt of ['torchvision', 'torchaudio'] as const) {
    const companionTag = torchLocalTag(pkgs[opt] as string | undefined)
    if (companionTag !== '' && companionTag !== torchTag) return null
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
  if (r.noteKey !== undefined && (typeof r.noteKey !== 'string' || !SAFE_SEGMENT.test(r.noteKey))) return null
  if (r.note !== undefined && !isSafeNote(r.note)) return null
  return {
    indexTag: r.indexTag,
    accel: r.accel as IndexAccel,
    ...(nightly ? { kind: 'pytorch-nightly-index' as const } : {}),
    platforms: r.platforms as NodeJS.Platform[],
    packages: {
      torch: pkgs.torch,
      ...(pkgs.torchvision ? { torchvision: pkgs.torchvision as string } : {}),
      ...(pkgs.torchaudio ? { torchaudio: pkgs.torchaudio as string } : {}),
    },
    date: r.date,
    ...(r.computeCap ? { computeCap: { min: (r.computeCap as { min: number }).min, max: (r.computeCap as { max: number }).max } } : {}),
    ...(r.pythonAbis ? { pythonAbis: r.pythonAbis as string[] } : {}),
    ...(r.noteKey ? { noteKey: r.noteKey } : {}),
    ...(r.note ? { note: r.note } : {}),
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
function parseRemoteManifest(data: unknown): TorchIndexStackDef[] | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const doc = data as Record<string, unknown>
  if (doc.schemaVersion !== 1) return null
  if (!Array.isArray(doc.stacks)) return null
  const defs = doc.stacks
    .map(parseRemoteStackDef)
    .filter((d): d is TorchIndexStackDef => d !== null)
  const ids = new Map<string, number>()
  for (const d of defs) {
    const id = makeIndexStackId(d.indexTag, d.packages.torch)
    ids.set(id, (ids.get(id) ?? 0) + 1)
  }
  const unique = defs.filter((d) => ids.get(makeIndexStackId(d.indexTag, d.packages.torch)) === 1)
  if (doc.stacks.length > 0 && unique.length === 0) return null
  return unique
}

/** Validated remote defs; null until a remote manifest has ever been loaded
 *  (then the in-app list is authoritative). An empty array is a valid remote
 *  state: it means "offer no index stacks". */
let _remoteDefs: TorchIndexStackDef[] | null = null
let _remoteDiskLoaded = false
let _remoteAttempted = false
let _remoteRefresh: Promise<void> | null = null

/** Test-only: reset/override remote manifest state. */
export function _setRemoteDefsForTest(defs: TorchIndexStackDef[] | null): void {
  _remoteDefs = defs
  _remoteDiskLoaded = true
  _remoteAttempted = true
}

/** Test-only: reset remote manifest state to cold start. */
export function _resetRemoteForTest(): void {
  _remoteDefs = null
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
      _remoteDefs = parseRemoteManifest(raw)
    } catch {
      // no cache / unreadable — keep built-ins
    }
  }
  return _remoteDefs ?? INDEX_STACKS
}

async function fetchRemoteIndexStacks(): Promise<void> {
  try {
    const data = await fetchJSON(REMOTE_MANIFEST_URL, { refresh: true })
    const defs = parseRemoteManifest(data)
    if (defs !== null) {
      _remoteDefs = defs
      _remoteDiskLoaded = true
      try {
        writeFileSafe(REMOTE_CACHE_FILE(), JSON.stringify({ schemaVersion: 1, stacks: defs }, null, 2))
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

/** Test-only: replace the nvidia-smi probe (child_process can't be mocked
 *  under the vitest setup). Pass undefined to restore the real probe. */
export function _setComputeCapProbeForTest(probe: (() => Promise<number[] | null>) | undefined): void {
  _probeFn = probe ?? probeComputeCaps
}

let _probe: Promise<void> | null = null

/** Probe the GPU only if it has never been probed. Awaited by resolve paths
 *  (snapshot restore, change-pytorch) so an exact restore of an index stack
 *  isn't rejected just because no check-update ran since app start; shares
 *  one in-flight probe across concurrent callers. */
export function ensureComputeCaps(): Promise<void> {
  if (_computeCaps !== undefined) return Promise.resolve()
  _probe ??= refreshComputeCaps().finally(() => {
    _probe = null
  })
  return _probe
}

/** The real nvidia-smi probe: caps on success, null on any failure. */
function probeComputeCaps(): Promise<number[] | null> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi', ['--query-gpu=compute_cap', '--format=csv,noheader'],
      { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null)
        const caps = stdout.split('\n')
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
 * synchronous catalog reads. Best-effort: any failure leaves filtering off.
 * Called from `refreshTorchStackCatalog` alongside the R2 fetch.
 */
export async function refreshComputeCaps(): Promise<void> {
  _computeCaps = await _probeFn()
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
    ...(def.noteKey ? { noteKey: def.noteKey } : {}),
    ...(def.note ? { note: def.note } : {}),
    ...(def.pythonAbis ? { pythonAbis: [...def.pythonAbis] } : {}),
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
 * matches, the platform has wheels, a trusted index serves the tuple, a
 * nightly entry is still young enough to install, and a detected GPU (if
 * any) has kernels in the build. Newest first.
 */
export function indexStacksForVariant(variant: string): TorchStackEntry[] {
  const accel = stripPlatform(variant)
  return activeDefs()
    .filter((def) => def.accel === accel)
    .filter((def) => def.platforms.includes(process.platform))
    .filter(nightlyFresh)
    // Only tuples a trusted index serves; MPS is PyPI-served and must be
    // untagged (a tagged build has no PyPI source).
    .filter((def) => torchIndexUrlFor(def.packages) !== null
      || (def.accel === 'mps' && torchLocalTag(def.packages.torch) === ''))
    .filter((def) => computeCapCompatible(def))
    .map((def) => entryFromDef(def, variant))
    .sort((a, b) => b.date.localeCompare(a.date))
}
