import fs from 'fs'
import path from 'path'
import { dataDir } from '../../lib/paths'
import { writeFileSafe } from '../../lib/safe-file'
import { getInstalledTorchTuple, PLATFORM_PREFIX } from './envPaths'
import { fetchR2VendorReleases, r2BundleUrl } from './r2Catalog'
import type { R2Variant } from './r2Catalog'
import {
  makeBundleStackId,
  parseBundleStackId,
  parseAnyIndexStackId,
  pythonAbiCompatible,
  torchTupleMatches,
  torchLocalTag,
  accelBaseForTag,
  torchTupleReacquirable,
  isValidAmdMultiArchSource,
  torchPackageTuplesEqual
} from './torchStackTypes'
import type { PersistedTorchStack, SnapshotTorchStack, TorchStackPackages } from './torchStackTypes'
import {
  indexStacksForVariant,
  refreshComputeCaps,
  refreshNvidiaDriver,
  refreshRemoteIndexStacks,
  ensureRemoteIndexStacks
} from './torchIndexManifest'
import type { InstallationRecord } from '../../installations'

export type TorchStackEntry = PersistedTorchStack & {
  date: string
  comfyuiVersion: string
  noteKey?: string
  note?: string
  pythonAbis?: string[]
  capWarning?: { min: number; max: number; detected: number[] }
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
  } catch {}
}

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
      ...(release.torchaudio_version ? { torchaudio: release.torchaudio_version } : {})
    },
    source: { kind: 'comfy-bundle', variant, bundleTag: release.tag },
    bundle: {
      url: r2BundleUrl(variant, release),
      filename: release.file,
      size: release.size
    },
    date: release.date,
    comfyuiVersion: release.comfyui_version
  }
}

function packagesKey(e: TorchStackEntry): string {
  return `${e.packages.torch}|${e.packages.torchvision ?? ''}|${e.packages.torchaudio ?? ''}`
}

export function filterCompatibleStacks(
  variant: string,
  pythonVersion: string | undefined,
  releases: R2Variant[],
  opts?: { requirePythonAbi?: boolean }
): TorchStackEntry[] {
  const requireAbi = opts?.requirePythonAbi !== false
  return releases
    .filter((r) => !!r.torch_version && !!r.tag && !!r.file)
    .filter((r) => !requireAbi || pythonAbiCompatible(pythonVersion, r.python_version))
    .map((r) => entryFromRelease(variant, r))
    .sort((a, b) => b.date.localeCompare(a.date))
}

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

function inferAdoptedVariant(installation: InstallationRecord): string | null {
  const prefix = PLATFORM_PREFIX[process.platform]
  if (!prefix) return null
  if (process.platform === 'darwin') return 'mac-mps'
  const gpu = installation.adoptedFromGpu as string | undefined
  let base =
    gpu === 'nvidia' ? 'nvidia' : gpu === 'amd' ? 'amd' : gpu === 'intel' ? 'intel-xpu' : null
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

function entryPythonCompatible(installation: InstallationRecord, e: TorchStackEntry): boolean {
  if (!e.pythonAbis || e.pythonAbis.length === 0) return true
  const python = installPython(installation)
  return e.pythonAbis.some((abi) => pythonAbiCompatible(python, abi))
}

function filterStacksForInstall(
  installation: InstallationRecord,
  stacks: TorchStackEntry[]
): TorchStackEntry[] {
  const filtered = stacks.filter((e) => {
    if (e.source.kind !== 'comfy-bundle') return entryPythonCompatible(installation, e)
    return installation.adopted === true
      ? torchTupleReacquirable(e.packages)
      : pythonAbiCompatible(installPython(installation), e.pythonVersion)
  })
  return dedupeByTuple(filtered)
}

function withIndexStacks(variant: string, bundleStacks: TorchStackEntry[]): TorchStackEntry[] {
  return [...bundleStacks, ...indexStacksForVariant(variant)]
}

function withoutCapWarning(entry: TorchStackEntry): TorchStackEntry {
  const persisted = { ...entry }
  delete persisted.capWarning
  return persisted
}

export async function refreshTorchStackCatalog(
  installation: InstallationRecord
): Promise<TorchStackEntry[]> {
  const variant = installVariant(installation)
  if (!variant) return []
  await refreshComputeCaps()
  await refreshNvidiaDriver()
  await refreshRemoteIndexStacks()
  const releases = await fetchR2VendorReleases(variant)
  const stacks = filterCompatibleStacks(variant, undefined, releases, { requirePythonAbi: false })
  _ensureLoaded()
  _cache[variant] = stacks
  _persist()
  return filterStacksForInstall(installation, withIndexStacks(variant, stacks))
}

export async function refreshTorchStackCatalogs(
  installations: InstallationRecord[]
): Promise<boolean> {
  const byVariant = new Map<string, InstallationRecord>()
  for (const inst of installations) {
    if (inst.status !== 'installed' || inst.sourceId !== 'standalone') continue
    const variant = installVariant(inst)
    if (!variant || byVariant.has(variant)) continue
    byVariant.set(variant, inst)
  }
  const results = await Promise.allSettled(
    [...byVariant.values()].map((inst) => refreshTorchStackCatalog(inst))
  )
  return results.every((r) => r.status === 'fulfilled')
}

export function getCachedTorchStacks(installation: InstallationRecord): TorchStackEntry[] {
  const variant = installVariant(installation)
  if (!variant) return []
  _ensureLoaded()
  return filterStacksForInstall(installation, withIndexStacks(variant, _cache[variant] ?? []))
}

export async function resolveTorchStack(
  installation: InstallationRecord,
  stackId: string
): Promise<TorchStackEntry | null> {
  const variant = installVariant(installation)
  if (!variant) return null

  if (parseAnyIndexStackId(stackId)) {
    await ensureRemoteIndexStacks()
    const entry = indexStacksForVariant(variant).find((e) => e.stackId === stackId) ?? null
    if (!entry || !entryPythonCompatible(installation, entry)) return null
    return withoutCapWarning(entry)
  }

  const parsed = parseBundleStackId(stackId)
  if (!parsed) return null
  if (parsed.variant !== variant) return null
  const releases = await fetchR2VendorReleases(variant)
  const release = releases.find((r) => r.tag === parsed.bundleTag)
  if (!release || !release.torch_version) return null
  const entry = entryFromRelease(variant, release)
  if (installation.adopted === true) {
    if (!torchTupleReacquirable(entry.packages)) return null
  } else if (!pythonAbiCompatible(installPython(installation), release.python_version)) {
    return null
  }
  return entry
}

export async function resolveSnapshotManagedTarget(
  installation: InstallationRecord,
  ref: { stackId: string; packages: TorchStackPackages }
): Promise<TorchStackEntry | null> {
  const entry = await resolveTorchStack(installation, ref.stackId)
  if (!entry || !torchPackageTuplesEqual(entry.packages, ref.packages)) return null
  return entry
}

export function getLastVerifiedTorchStack(
  installation: InstallationRecord
): PersistedTorchStack | null {
  const ref = installation.lastVerifiedTorchStack as PersistedTorchStack | undefined
  if (!ref || typeof ref !== 'object') return null
  if (
    typeof ref.stackId !== 'string' ||
    typeof ref.variant !== 'string' ||
    typeof ref.pythonVersion !== 'string'
  )
    return null
  if (!ref.packages || typeof ref.packages !== 'object' || typeof ref.packages.torch !== 'string')
    return null
  if (ref.packages.torchvision !== undefined && typeof ref.packages.torchvision !== 'string')
    return null
  if (ref.packages.torchaudio !== undefined && typeof ref.packages.torchaudio !== 'string')
    return null
  const src = ref.source
  if (!src || typeof src !== 'object' || typeof src.kind !== 'string') return null
  if (src.kind === 'comfy-bundle') {
    if (typeof src.variant !== 'string' || typeof src.bundleTag !== 'string') return null
    const bundle = ref.bundle
    if (!bundle || typeof bundle !== 'object') return null
    if (typeof bundle.url !== 'string' || typeof bundle.filename !== 'string') return null
    if (typeof bundle.size !== 'number' || !Number.isFinite(bundle.size) || bundle.size <= 0)
      return null
  } else if (src.kind === 'pytorch-index') {
    if (typeof src.indexTag !== 'string' || typeof src.backend !== 'string') return null
  } else if (src.kind === 'amd-multi-arch-index') {
    if (!isValidAmdMultiArchSource(src, ref.packages, ref.stackId)) return null
  } else if (src.kind === 'pypi') {
    if (typeof src.backend !== 'string') return null
  } else {
    return null
  }
  return ref
}

export async function reconcileTorchStack(
  installation: InstallationRecord,
  update: (data: Record<string, unknown>) => Promise<unknown>
): Promise<void> {
  const variant = installVariant(installation)
  if (!variant) return
  const installed = getInstalledTorchTuple(installation)
  if (!installed.torch) return

  const verified = getLastVerifiedTorchStack(installation)
  if (verified && torchTupleMatches(verified.packages, installed)) {
    if (installation.observedTorchStack) await update({ observedTorchStack: null })
    return
  }

  const match = getCachedTorchStacks(installation).find((e) =>
    torchTupleMatches(e.packages, installed)
  )
  if (match) {
    await update({ lastVerifiedTorchStack: withoutCapWarning(match), observedTorchStack: null })
    return
  }

  const prior = installation.observedTorchStack as
    | {
        torchVersion?: string
        torchvisionVersion?: string | null
        torchaudioVersion?: string | null
      }
    | undefined
  if (
    !verified &&
    prior?.torchVersion === installed.torch &&
    (prior?.torchvisionVersion ?? null) === installed.torchvision &&
    (prior?.torchaudioVersion ?? null) === installed.torchaudio
  )
    return
  await update({
    lastVerifiedTorchStack: null,
    observedTorchStack: {
      torchVersion: installed.torch,
      torchvisionVersion: installed.torchvision,
      torchaudioVersion: installed.torchaudio,
      observedAt: new Date().toISOString()
    }
  })
}

export function classifyTorchStackForSnapshot(
  installation: InstallationRecord
): SnapshotTorchStack {
  const installed = getInstalledTorchTuple(installation)
  const verified = getLastVerifiedTorchStack(installation)
  if (installed.torch && verified && torchTupleMatches(verified.packages, installed)) {
    const { stackId, variant, pythonVersion, packages, source } = verified
    return { kind: 'managed', ref: { stackId, variant, pythonVersion, packages, source } }
  }
  return {
    kind: 'observed',
    torchVersion: installed.torch,
    torchvisionVersion: installed.torchvision,
    torchaudioVersion: installed.torchaudio,
    observedAt: new Date().toISOString()
  }
}
