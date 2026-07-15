/**
 * Main-side catalog of PyTorch stacks an installation can switch to.
 *
 * Trust boundary: the renderer only ever sends an opaque `stackId`; every
 * mutation path re-resolves it here against a fresh R2 fetch. Compatibility
 * (same variant → same backend/OS, and same Python ABI) is enforced on this
 * side — renderer filtering is presentation only.
 *
 * A small in-memory + on-disk cache mirrors the release-cache pattern so the
 * synchronous `getDetailSections` can render stack cards; async refreshes are
 * triggered from the `check-update` action.
 */
import fs from 'fs'
import path from 'path'
import { dataDir } from '../../lib/paths'
import { writeFileSafe } from '../../lib/safe-file'
import { getInstalledTorchTuple, PLATFORM_PREFIX } from './envPaths'
import { fetchR2VendorReleases, r2BundleUrl } from './r2Catalog'
import type { R2Variant } from './r2Catalog'
import {
  makeBundleStackId, parseBundleStackId, parseIndexStackId, pythonAbiCompatible,
  torchTupleMatches, torchLocalTag, accelBaseForTag, torchTupleReacquirable,
} from './torchStackTypes'
import type { PersistedTorchStack, SnapshotTorchStack } from './torchStackTypes'
import { indexStacksForVariant, refreshComputeCaps } from './torchIndexManifest'
import type { InstallationRecord } from '../../installations'

/** A resolvable catalog entry: managed ref + acquisition info. Bundle
 *  entries carry the R2 download; index entries carry no bundle and are
 *  pip-applied from the trusted index their local tag names. */
export type TorchStackEntry = PersistedTorchStack & {
  /** Release date (ISO), for display ordering. */
  date: string
  /** ComfyUI version the bundle shipped with (display only; empty for
   *  index-served entries, which are not tied to a ComfyUI release). */
  comfyuiVersion: string
  /** i18n key suffix under `standalone.` describing an index-served entry
   *  (e.g. which GPU generations its kernels cover). */
  noteKey?: string
}

const CACHE_FILE = path.join(dataDir(), 'torch-stack-cache.json')

let _cache: Record<string, TorchStackEntry[]> = {}
let _loaded = false

function _ensureLoaded(): void {
  if (_loaded) return
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
    _cache = (raw.variants as Record<string, TorchStackEntry[]>) || {}
  } catch {
    _cache = {}
  }
  _loaded = true
}

function _persist(): void {
  try {
    writeFileSafe(CACHE_FILE, JSON.stringify({ schemaVersion: 1, variants: _cache }, null, 2))
  } catch {
    // cache persistence is best-effort
  }
}

/** Test-only: reset module state. */
export function _resetForTest(): void {
  _cache = {}
  _loaded = true
}

function entryFromRelease(variant: string, release: R2Variant): TorchStackEntry {
  return {
    stackId: makeBundleStackId(variant, release.tag),
    variant,
    pythonVersion: release.python_version,
    packages: {
      torch: release.torch_version,
      ...(release.torchvision_version ? { torchvision: release.torchvision_version } : {}),
      ...(release.torchaudio_version ? { torchaudio: release.torchaudio_version } : {}),
    },
    source: { kind: 'comfy-bundle', variant, bundleTag: release.tag },
    bundle: {
      url: r2BundleUrl(variant, release),
      filename: release.file,
      size: release.size,
    },
    date: release.date,
    comfyuiVersion: release.comfyui_version,
  }
}

function packagesKey(e: TorchStackEntry): string {
  return `${e.packages.torch}|${e.packages.torchvision ?? ''}|${e.packages.torchaudio ?? ''}`
}

/**
 * Build the list of stacks a variant's releases offer: valid entries only,
 * newest first. NOT deduplicated — deduplication is per-install (after ABI /
 * reacquirability filtering), or an entry dropped for one install could
 * shadow a compatible duplicate another install needs.
 *
 * `requirePythonAbi: false` skips the bundle-Python check: adopted (pip-
 * managed) installs never receive the bundle's interpreter — pip resolves
 * wheels against the venv's own Python, so the bundle's Python is irrelevant
 * (a tuple with no wheel for that Python fails cleanly and rolls back).
 */
export function filterCompatibleStacks(
  variant: string,
  pythonVersion: string | undefined,
  releases: R2Variant[],
  opts?: { requirePythonAbi?: boolean },
): TorchStackEntry[] {
  const requireAbi = opts?.requirePythonAbi !== false
  return releases
    .filter((r) => !!r.torch_version && !!r.tag && !!r.file)
    .filter((r) => !requireAbi || pythonAbiCompatible(pythonVersion, r.python_version))
    .map((r) => entryFromRelease(variant, r))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** Deduplicate by torch tuple, keeping the newest bundle of each (several
 *  bundles can ship the same stack — restores pull the freshest artifact).
 *  Expects newest-first input. */
function dedupeByTuple(entries: TorchStackEntry[]): TorchStackEntry[] {
  const seen = new Set<string>()
  const deduped: TorchStackEntry[] = []
  for (const e of entries) {
    const key = packagesKey(e)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(e)
  }
  return deduped
}

/** R2 vendor variant an adopted (Legacy Desktop) install maps to. Adoption
 *  records carry `variant: 'legacy-uv-py312'`, never an R2 vendor id, so the
 *  vendor is inferred from the platform plus the GPU detected at adoption
 *  (`adoptedFromGpu`), falling back to the installed torch's local tag. */
function inferAdoptedVariant(installation: InstallationRecord): string | null {
  const prefix = PLATFORM_PREFIX[process.platform]
  if (!prefix) return null
  if (process.platform === 'darwin') return 'mac-mps'
  const gpu = installation.adoptedFromGpu as string | undefined
  let base = gpu === 'nvidia' ? 'nvidia'
    : gpu === 'amd' ? 'amd'
    : gpu === 'intel' ? 'intel-xpu'
    : null
  if (!base) {
    base = accelBaseForTag(torchLocalTag(getInstalledTorchTuple(installation).torch)) ?? 'cpu'
  }
  return prefix + base
}

function installVariant(installation: InstallationRecord): string | null {
  if (installation.adopted === true) return inferAdoptedVariant(installation)
  const variant = installation.variant
  return typeof variant === 'string' && variant.length > 0 ? variant : null
}

function installPython(installation: InstallationRecord): string | undefined {
  const v = installation.pythonVersion
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** Per-install filter applied at read time: bundle-managed installs receive
 *  the bundle's interpreter payload, so its Python must match; adopted
 *  installs are pip-applied against their own Python, but only tuples a
 *  trusted index can serve are switchable (e.g. Windows ROCm builds have no
 *  pip source). Index-served entries pip-apply on every install type and
 *  are pre-filtered by the manifest (platform, index, GPU), so no per-
 *  install constraint applies. Deduplication runs after filtering so an
 *  entry dropped here can't shadow a compatible duplicate. */
function filterStacksForInstall(installation: InstallationRecord, stacks: TorchStackEntry[]): TorchStackEntry[] {
  const filtered = stacks.filter((e) => {
    if (e.source.kind !== 'comfy-bundle') return true
    return installation.adopted === true
      ? torchTupleReacquirable(e.packages)
      : pythonAbiCompatible(installPython(installation), e.pythonVersion)
  })
  return dedupeByTuple(filtered)
}

/** Bundle entries (cached from R2) plus the manifest's index-served entries
 *  for the variant. Bundles come first so a tuple served both ways
 *  deduplicates to the bundle (atomic swap beats pip mutation). */
function withIndexStacks(variant: string, bundleStacks: TorchStackEntry[]): TorchStackEntry[] {
  return [...bundleStacks, ...indexStacksForVariant(variant)]
}

/** Fetch + filter the switchable stacks for an installation and refresh the
 *  sync cache. Throws on network failure (callers treat it as best-effort).
 *  The cache stores the unfiltered, undeduplicated list (it is keyed by
 *  variant and shared between installs with different Pythons); per-install
 *  filtering + dedupe are applied on read. */
export async function refreshTorchStackCatalog(installation: InstallationRecord): Promise<TorchStackEntry[]> {
  const variant = installVariant(installation)
  if (!variant) return []
  // GPU probe first (best-effort, local): the R2 fetch below may throw, and
  // index-entry filtering should still have fresh capabilities.
  await refreshComputeCaps()
  const releases = await fetchR2VendorReleases(variant)
  const stacks = filterCompatibleStacks(variant, undefined, releases, { requirePythonAbi: false })
  _ensureLoaded()
  _cache[variant] = stacks
  _persist()
  return filterStacksForInstall(installation, withIndexStacks(variant, stacks))
}

/** Synchronous cached read for `getDetailSections`. Bundle entries are empty
 *  until the first refresh (triggered by check-update) lands; manifest index
 *  entries are always available. */
export function getCachedTorchStacks(installation: InstallationRecord): TorchStackEntry[] {
  const variant = installVariant(installation)
  if (!variant) return []
  _ensureLoaded()
  return filterStacksForInstall(installation, withIndexStacks(variant, _cache[variant] ?? []))
}

/**
 * Resolve a renderer-supplied stackId to a catalog entry for this
 * installation, against a fresh R2 fetch. This is the trust boundary for
 * `change-pytorch`: returns null when the id is malformed, belongs to a
 * different variant, is ABI-incompatible, or the bundle is no longer in R2.
 */
export async function resolveTorchStack(
  installation: InstallationRecord,
  stackId: string,
): Promise<TorchStackEntry | null> {
  const variant = installVariant(installation)
  if (!variant) return null

  // Index-served stacks resolve against the in-app manifest (already trusted
  // and machine-filtered) — no remote fetch involved.
  if (parseIndexStackId(stackId)) {
    return indexStacksForVariant(variant).find((e) => e.stackId === stackId) ?? null
  }

  const parsed = parseBundleStackId(stackId)
  if (!parsed) return null
  if (parsed.variant !== variant) return null
  const releases = await fetchR2VendorReleases(variant)
  const release = releases.find((r) => r.tag === parsed.bundleTag)
  if (!release || !release.torch_version) return null
  const entry = entryFromRelease(variant, release)
  if (installation.adopted === true) {
    // Adopted installs apply via pip against their own Python — the bundle's
    // interpreter never lands, so its ABI is not a constraint; instead the
    // tuple must be servable by a trusted index.
    if (!torchTupleReacquirable(entry.packages)) return null
  } else if (!pythonAbiCompatible(installPython(installation), release.python_version)) {
    return null
  }
  return entry
}

/** The persisted `lastVerifiedTorchStack`, validated in full — a partial
 *  record (e.g. from an older build or corrupted store) must not reach
 *  snapshot classification or the repair path with identity/acquisition
 *  fields undefined. */
export function getLastVerifiedTorchStack(installation: InstallationRecord): PersistedTorchStack | null {
  const ref = installation.lastVerifiedTorchStack as PersistedTorchStack | undefined
  if (!ref || typeof ref !== 'object') return null
  if (typeof ref.stackId !== 'string' || typeof ref.variant !== 'string' || typeof ref.pythonVersion !== 'string') return null
  if (!ref.packages || typeof ref.packages !== 'object' || typeof ref.packages.torch !== 'string') return null
  if (ref.packages.torchvision !== undefined && typeof ref.packages.torchvision !== 'string') return null
  if (ref.packages.torchaudio !== undefined && typeof ref.packages.torchaudio !== 'string') return null
  const src = ref.source
  if (!src || typeof src !== 'object' || typeof src.kind !== 'string') return null
  if (src.kind === 'comfy-bundle') {
    if (typeof src.variant !== 'string' || typeof src.bundleTag !== 'string') return null
    // Bundle stacks re-acquire from the persisted download info — required.
    const bundle = ref.bundle
    if (!bundle || typeof bundle !== 'object') return null
    if (typeof bundle.url !== 'string' || typeof bundle.filename !== 'string') return null
    if (typeof bundle.size !== 'number' || !Number.isFinite(bundle.size) || bundle.size <= 0) return null
  } else if (src.kind === 'pytorch-index') {
    if (typeof src.indexTag !== 'string' || typeof src.backend !== 'string') return null
  } else if (src.kind === 'pypi') {
    if (typeof src.backend !== 'string') return null
  } else {
    return null
  }
  return ref
}

/**
 * Prelaunch reconciliation: compare the venv's actual torch version with the
 * persisted stack state. The active environment is the source of truth — a
 * manual (terminal) change that matches a catalog stack is adopted as the new
 * verified stack; anything else is recorded as observed. Never mutates the
 * venv. Uses only the cached catalog so launch never blocks on the network.
 */
export async function reconcileTorchStack(
  installation: InstallationRecord,
  update: (data: Record<string, unknown>) => Promise<unknown>,
): Promise<void> {
  const variant = installVariant(installation)
  if (!variant) return
  const installed = getInstalledTorchTuple(installation)
  if (!installed.torch) return

  // Full-tuple comparison everywhere: two stacks can share a torch version
  // but differ in torchvision/torchaudio, and dist-info versions may carry a
  // local tag (+cu128) the catalog omits.
  const verified = getLastVerifiedTorchStack(installation)
  if (verified && torchTupleMatches(verified.packages, installed)) {
    // Consistent; clear any stale observed marker.
    if (installation.observedTorchStack) await update({ observedTorchStack: null })
    return
  }

  const match = getCachedTorchStacks(installation).find((e) => torchTupleMatches(e.packages, installed))
  if (match) {
    // Manual change to an official stack — adopt it as verified/restorable.
    await update({ lastVerifiedTorchStack: match, observedTorchStack: null })
    return
  }

  // Falling through to observed: any verified ref is stale (e.g. a torch
  // change persisted its metadata but was rolled back before commit) and MUST
  // be cleared — repair would otherwise trust it as the acquisition source.
  const prior = installation.observedTorchStack as
    { torchVersion?: string; torchvisionVersion?: string | null; torchaudioVersion?: string | null } | undefined
  if (
    !verified && prior?.torchVersion === installed.torch &&
    (prior?.torchvisionVersion ?? null) === installed.torchvision &&
    (prior?.torchaudioVersion ?? null) === installed.torchaudio
  ) return // already recorded
  await update({
    lastVerifiedTorchStack: null,
    observedTorchStack: {
      torchVersion: installed.torch,
      torchvisionVersion: installed.torchvision,
      torchaudioVersion: installed.torchaudio,
      observedAt: new Date().toISOString(),
    },
  })
}

/** Snapshot-time classification of the active stack. Observed records keep
 *  the full installed tuple (with local tags) so pip-managed installs can
 *  restore it from the derived index. */
export function classifyTorchStackForSnapshot(
  installation: InstallationRecord,
): SnapshotTorchStack {
  const installed = getInstalledTorchTuple(installation)
  const verified = getLastVerifiedTorchStack(installation)
  if (installed.torch && verified && torchTupleMatches(verified.packages, installed)) {
    // Strip acquisition info — snapshots carry identity; restore re-resolves.
    const { stackId, variant, pythonVersion, packages, source } = verified
    return { kind: 'managed', ref: { stackId, variant, pythonVersion, packages, source } }
  }
  return {
    kind: 'observed',
    torchVersion: installed.torch,
    torchvisionVersion: installed.torchvision,
    torchaudioVersion: installed.torchaudio,
    observedAt: new Date().toISOString(),
  }
}
