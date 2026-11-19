import fs from 'fs'
import path from 'path'
import { copyDirWithProgress } from '../../lib/copy'

const TORCH_FAMILY_EXACT = new Set([
  'torch',
  'torchgen',
  'torchvision',
  'torchaudio',
  'torio',
  'functorch'
])
const TORCH_FAMILY_PREFIXES = [
  'torch',
  'nvidia',
  'triton',
  'pytorch_triton',
  'cuda',
  'rocm',
  '_rocm_sdk'
]
const STAGING_PREFIX = '.torchrepair-'
const BACKUP_PREFIX = `${STAGING_PREFIX}old-`
const SWAP_MARKER = `${STAGING_PREFIX}swap.json`

interface SwapMarker {
  backups: string[]
  placed: string[]
  corrupt?: boolean
}

function stripLibs(name: string): string {
  return name.endsWith('.libs') ? name.slice(0, -'.libs'.length) : name
}

function isTorchFamilyEntry(name: string): boolean {
  const key = packageKey(stripLibs(name))
  if (TORCH_FAMILY_EXACT.has(key)) return true
  return TORCH_FAMILY_PREFIXES.some((p) => key === p || key.startsWith(`${p}_`))
}

function packageKey(entry: string): string {
  const base = entry.endsWith('.dist-info') ? entry.slice(0, -'.dist-info'.length) : entry
  const dash = base.indexOf('-')
  const name = dash >= 0 && entry.endsWith('.dist-info') ? base.slice(0, dash) : base
  return name.toLowerCase().replace(/-/g, '_')
}

function readSwapMarker(site: string): SwapMarker | null {
  const markerPath = path.join(site, SWAP_MARKER)
  if (!fs.existsSync(markerPath)) return null
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(markerPath, 'utf-8'))
    const m = parsed as SwapMarker
    if (Array.isArray(m.backups) && Array.isArray(m.placed)) return m
  } catch {}
  return { backups: [], placed: [], corrupt: true }
}

async function writeSwapMarker(site: string, marker: SwapMarker): Promise<void> {
  const tmp = path.join(site, `${SWAP_MARKER}.tmp`)
  await fs.promises.writeFile(tmp, JSON.stringify(marker))
  await fs.promises.rename(tmp, path.join(site, SWAP_MARKER))
}

export async function recoverTorchFamilyBackups(site: string): Promise<void> {
  if (!fs.existsSync(site)) return
  const marker = readSwapMarker(site)
  const backupEntries = fs.readdirSync(site).filter((e) => e.startsWith(BACKUP_PREFIX))

  if (marker === null) {
    for (const entry of backupEntries) {
      await fs.promises.rm(path.join(site, entry), { recursive: true, force: true }).catch(() => {})
    }
    return
  }

  const restored = new Set<string>()
  for (const entry of backupEntries) {
    const original = entry.slice(BACKUP_PREFIX.length)
    await fs.promises.rm(path.join(site, original), { recursive: true, force: true })
    await fs.promises.rename(path.join(site, entry), path.join(site, original))
    restored.add(original)
  }
  const backupOriginals = new Set(marker.backups)
  for (const name of marker.placed) {
    if (restored.has(name) || backupOriginals.has(name)) continue
    await fs.promises.rm(path.join(site, name), { recursive: true, force: true })
  }
  if (marker.corrupt) {
    console.warn(
      'torch-family swap marker was unreadable; rolled backups back without sweeping placed entries - duplicate package metadata may remain until the next stack swap'
    )
  }
  await fs.promises.rm(path.join(site, SWAP_MARKER), { force: true })
}

export async function copyTorchFamily(
  srcSite: string,
  dstSite: string,
  signal?: AbortSignal
): Promise<void> {
  const srcEntries = fs
    .readdirSync(srcSite, { withFileTypes: true })
    .filter((e) => isTorchFamilyEntry(e.name))
  const providedKeys = new Set(srcEntries.map((e) => packageKey(e.name)))

  await recoverTorchFamilyBackups(dstSite)
  for (const entry of fs.readdirSync(dstSite)) {
    if (entry.startsWith(STAGING_PREFIX)) {
      await fs.promises.rm(path.join(dstSite, entry), { recursive: true, force: true })
    }
  }

  const staged: Array<{ name: string; tmp: string }> = []
  for (const e of srcEntries) {
    if (signal?.aborted) throw new Error('Cancelled')
    const from = path.join(srcSite, e.name)
    const tmp = path.join(dstSite, `${STAGING_PREFIX}${e.name}`)
    if (e.isDirectory()) await copyDirWithProgress(from, tmp, null, { signal })
    else await fs.promises.copyFile(from, tmp)
    staged.push({ name: e.name, tmp })
  }

  const toBackup = fs
    .readdirSync(dstSite)
    .filter(
      (entry) =>
        !entry.startsWith(STAGING_PREFIX) &&
        isTorchFamilyEntry(entry) &&
        providedKeys.has(packageKey(entry))
    )
  await writeSwapMarker(dstSite, { backups: toBackup, placed: staged.map((s) => s.name) })

  const backups: Array<{ name: string; bak: string }> = []
  const placed: string[] = []
  try {
    for (const entry of toBackup) {
      const bak = path.join(dstSite, `${BACKUP_PREFIX}${entry}`)
      await fs.promises.rename(path.join(dstSite, entry), bak)
      backups.push({ name: entry, bak })
    }
    for (const s of staged) {
      const final = path.join(dstSite, s.name)
      await fs.promises.rename(s.tmp, final)
      placed.push(final)
    }
  } catch (err) {
    const rollbackErrors: string[] = []
    for (const final of placed) {
      await fs.promises
        .rm(final, { recursive: true, force: true })
        .catch((e: Error) => rollbackErrors.push(`remove ${path.basename(final)}: ${e.message}`))
    }
    for (const b of backups) {
      await fs.promises
        .rename(b.bak, path.join(dstSite, b.name))
        .catch((e: Error) => rollbackErrors.push(`restore ${b.name}: ${e.message}`))
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `${(err as Error).message}; rollback incomplete: ${rollbackErrors.join(', ')}`,
        { cause: err }
      )
    }
    await fs.promises.rm(path.join(dstSite, SWAP_MARKER), { force: true }).catch(() => {})
    throw err
  }

  await fs.promises.rm(path.join(dstSite, SWAP_MARKER), { force: true })
  for (const b of backups) {
    await fs.promises.rm(b.bak, { recursive: true, force: true }).catch(() => {})
  }
}

const DIST_OWNED_EXTRAS: Record<string, readonly string[]> = {
  torch: ['torchgen', 'functorch'],
  torchaudio: ['torio']
}

function isRocmEcosystemEntry(name: string): boolean {
  const key = packageKey(stripLibs(name))
  const base = key.startsWith('_') ? key.slice(1) : key
  return (
    base === 'rocm' ||
    base === 'rocm_bootstrap' ||
    base === 'rocm_sdk' ||
    base.startsWith('rocm_sdk_') ||
    base === 'amd_torch_device' ||
    base.startsWith('amd_torch_device_') ||
    base === 'amd_torchvision_device' ||
    base.startsWith('amd_torchvision_device_')
  )
}

export function listRocmEcosystemDists(site: string): string[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(site)
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.dist-info')) continue
    if (!isRocmEcosystemEntry(entry)) continue
    out.push(packageKey(entry))
  }
  return out
}

export function isAmdMultiArchOverlayDist(name: string): boolean {
  const key = name.toLowerCase().replace(/-/g, '_')
  return (
    key.startsWith('amd_torch_device') ||
    key.startsWith('amd_torchvision_device') ||
    key.startsWith('rocm_sdk_device')
  )
}

export async function removeStaleRocmEntries(srcSite: string, dstSite: string): Promise<string[]> {
  const provided = new Set(fs.readdirSync(srcSite).map((e) => packageKey(stripLibs(e))))
  const removedDists: string[] = []
  for (const entry of fs.readdirSync(dstSite)) {
    if (entry.startsWith(STAGING_PREFIX)) continue
    if (!isRocmEcosystemEntry(entry)) continue
    if (provided.has(packageKey(stripLibs(entry)))) continue
    if (entry.endsWith('.dist-info')) removedDists.push(packageKey(entry))
    await fs.promises.rm(path.join(dstSite, entry), { recursive: true, force: true })
  }
  return removedDists
}

export async function removeTorchFamilyPackages(
  site: string,
  names: readonly string[]
): Promise<void> {
  const keys = new Set(names.map((n) => n.toLowerCase().replace(/-/g, '_')))
  for (const name of [...keys]) {
    for (const extra of DIST_OWNED_EXTRAS[name] ?? []) keys.add(extra)
  }
  for (const entry of fs.readdirSync(site)) {
    if (keys.has(packageKey(stripLibs(entry)))) {
      await fs.promises.rm(path.join(site, entry), { recursive: true, force: true })
    }
  }
}
