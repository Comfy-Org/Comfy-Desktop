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
import { getTorchVersion } from './envPaths'
import { fetchR2VendorReleases, r2BundleUrl } from './r2Catalog'
import type { R2Variant } from './r2Catalog'
import {
  makeBundleStackId, parseBundleStackId, pythonAbiCompatible,
} from './torchStackTypes'
import type { PersistedTorchStack, ManagedTorchStackRef } from './torchStackTypes'
import type { InstallationRecord } from '../../installations'

/** A resolvable catalog entry: managed ref + acquisition info. */
export type TorchStackEntry = PersistedTorchStack & {
  /** Bundle release date (ISO), for display ordering. */
  date: string
  /** ComfyUI version the bundle shipped with (display only). */
  comfyuiVersion: string
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
 * Build the list of stacks an installation may switch to: same variant (which
 * pins backend + OS + arch), compatible Python ABI, torch version present.
 * Deduplicated by torch tuple (several bundles can ship the same stack — keep
 * the newest bundle so restores pull the freshest artifact of that tuple).
 * Newest first.
 */
export function filterCompatibleStacks(
  variant: string,
  pythonVersion: string | undefined,
  releases: R2Variant[],
): TorchStackEntry[] {
  const entries = releases
    .filter((r) => !!r.torch_version && !!r.tag && !!r.file)
    .filter((r) => pythonAbiCompatible(pythonVersion, r.python_version))
    .map((r) => entryFromRelease(variant, r))
    .sort((a, b) => b.date.localeCompare(a.date))

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

function installVariant(installation: InstallationRecord): string | null {
  if (installation.adopted === true) return null
  const variant = installation.variant
  return typeof variant === 'string' && variant.length > 0 ? variant : null
}

function installPython(installation: InstallationRecord): string | undefined {
  const v = installation.pythonVersion
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** Fetch + filter the switchable stacks for an installation and refresh the
 *  sync cache. Throws on network failure (callers treat it as best-effort). */
export async function refreshTorchStackCatalog(installation: InstallationRecord): Promise<TorchStackEntry[]> {
  const variant = installVariant(installation)
  if (!variant) return []
  const releases = await fetchR2VendorReleases(variant)
  const stacks = filterCompatibleStacks(variant, installPython(installation), releases)
  _ensureLoaded()
  _cache[variant] = stacks
  _persist()
  return stacks
}

/** Synchronous cached read for `getDetailSections`. Empty until the first
 *  refresh (triggered by check-update) lands. */
export function getCachedTorchStacks(installation: InstallationRecord): TorchStackEntry[] {
  const variant = installVariant(installation)
  if (!variant) return []
  _ensureLoaded()
  const cached = _cache[variant] ?? []
  const py = installPython(installation)
  // Defence-in-depth: re-filter ABI on read in case the record changed since caching.
  return cached.filter((e) => pythonAbiCompatible(py, e.pythonVersion))
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
  const parsed = parseBundleStackId(stackId)
  if (!parsed) return null
  const variant = installVariant(installation)
  if (!variant || parsed.variant !== variant) return null
  const releases = await fetchR2VendorReleases(variant)
  const release = releases.find((r) => r.tag === parsed.bundleTag)
  if (!release || !release.torch_version) return null
  if (!pythonAbiCompatible(installPython(installation), release.python_version)) return null
  return entryFromRelease(variant, release)
}

/** The persisted `lastVerifiedTorchStack`, when valid. */
export function getLastVerifiedTorchStack(installation: InstallationRecord): PersistedTorchStack | null {
  const ref = installation.lastVerifiedTorchStack as PersistedTorchStack | undefined
  if (!ref || typeof ref !== 'object') return null
  if (typeof ref.stackId !== 'string' || !ref.packages || typeof ref.packages.torch !== 'string') return null
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
  const observed = getTorchVersion(installation)
  if (!observed) return

  const verified = getLastVerifiedTorchStack(installation)
  if (verified && verified.packages.torch === observed) {
    // Consistent; clear any stale observed marker.
    if (installation.observedTorchStack) await update({ observedTorchStack: null })
    return
  }

  const match = getCachedTorchStacks(installation).find((e) => e.packages.torch === observed)
  if (match) {
    // Manual change to an official stack — adopt it as verified/restorable.
    await update({ lastVerifiedTorchStack: match, observedTorchStack: null })
    return
  }

  const prior = installation.observedTorchStack as { torchVersion?: string } | undefined
  if (prior?.torchVersion === observed) return // already recorded
  await update({
    observedTorchStack: { torchVersion: observed, observedAt: new Date().toISOString() },
  })
}

/** Snapshot-time classification of the active stack. */
export function classifyTorchStackForSnapshot(
  installation: InstallationRecord,
): { kind: 'managed'; ref: ManagedTorchStackRef } | { kind: 'observed'; torchVersion: string | null; observedAt: string } {
  const observed = getTorchVersion(installation)
  const verified = getLastVerifiedTorchStack(installation)
  if (observed && verified && verified.packages.torch === observed) {
    // Strip acquisition info — snapshots carry identity; restore re-resolves.
    const { stackId, variant, pythonVersion, packages, source } = verified
    return { kind: 'managed', ref: { stackId, variant, pythonVersion, packages, source } }
  }
  return { kind: 'observed', torchVersion: observed, observedAt: new Date().toISOString() }
}
