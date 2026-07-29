import fs from 'fs'
import path from 'path'
import { copyDirWithProgress } from '../../lib/copy'

// Filesystem-level helpers for the torch-family packages in a site-packages
// dir. Shared by the startup repair (torchRepair) and the whole-venv stack
// transaction (torchStackTransaction); kept dependency-free of both so neither
// imports the other.

// Top-level names owned by the torch stack wheels themselves (torch ships
// torch/torchgen/functorch, torchaudio ships torio, plus dist-info and .libs
// sidecars, which packageKey/stripLibs map back to these).
const TORCH_FAMILY_EXACT = new Set(['torch', 'torchgen', 'torchvision', 'torchaudio', 'torio', 'functorch'])
// Separator-prefixed families, matched as `<p>` or `<p>_*` AFTER normalizing
// '-' to '_' - NEVER as a bare substring: ordinary ecosystem packages like
// torchsde/torchmetrics must not match, or a bundle graft would overwrite the
// version a snapshot restore just installed. 'torch' covers ABI-coupled
// torch_tensorrt/torch-scatter, 'nvidia' covers nvidia_cudnn_cu12 etc.,
// 'triton' covers triton_windows, 'cuda' covers cuda_bindings. '_rocm_sdk'
// covers the ROCm SDK wheels' underscore-prefixed payload packages
// (_rocm_sdk_core, _rocm_sdk_libraries_custom): rocm_sdk.find_libraries
// imports them under exactly that name, so a graft that replaced the
// dist-info without the payload would strand torch on the old SDK's DLLs.
const TORCH_FAMILY_PREFIXES = ['torch', 'nvidia', 'triton', 'pytorch_triton', 'cuda', 'rocm', '_rocm_sdk']
const STAGING_PREFIX = '.torchrepair-'
// Backup names taken by the old packages during the swap. Shares the staging
// prefix so the leftover sweep and the swap loop's skip check cover both.
const BACKUP_PREFIX = `${STAGING_PREFIX}old-`
// Journal for an in-flight swap. Present = the swap did NOT commit (rename
// phase may be anywhere between untouched and fully placed); absent = any
// backups on disk are debris of a committed swap. Deleted as the commit point.
const SWAP_MARKER = `${STAGING_PREFIX}swap.json`

interface SwapMarker {
  /** Original entry names renamed aside to BACKUP_PREFIX names. */
  backups: string[]
  /** Final entry names the staged copies are renamed to. */
  placed: string[]
  /** True when the on-disk marker existed but could not be parsed - the
   *  backup/placed lists are unknown and recovery must derive them. */
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

/** Project key of a site-packages entry, so a versioned dist-info maps to the
 *  same key as its package dir (torch-2.12.0.dist-info -> torch). */
function packageKey(entry: string): string {
  const base = entry.endsWith('.dist-info') ? entry.slice(0, -'.dist-info'.length) : entry
  // dist-info names are `<name>-<version>` and `<name>` never contains '-', so
  // the first '-' splits name from version. Non-dist-info entries have no '-'.
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
  } catch {
    /* fall through */
  }
  // Unreadable marker (should be impossible - it is written via tmp+rename):
  // recovery falls back to restoring every backup found on disk and leaves
  // everything else alone (see the corrupt branch in recoverTorchFamilyBackups).
  return { backups: [], placed: [], corrupt: true }
}

/** Written via tmp+rename so the marker is either absent or complete. */
async function writeSwapMarker(site: string, marker: SwapMarker): Promise<void> {
  const tmp = path.join(site, `${SWAP_MARKER}.tmp`)
  await fs.promises.writeFile(tmp, JSON.stringify(marker))
  await fs.promises.rename(tmp, path.join(site, SWAP_MARKER))
}

/**
 * Recover from a prior swap that died mid-way, using the swap marker to tell
 * the two interrupted states apart:
 *
 * - Marker present: the swap never committed. Roll it back - restore every
 *   backup over its original name (the backup holds the only good copy) and
 *   remove placed entries the plan introduced under new names. Throws if the
 *   rollback cannot complete (marker stays, so the next run retries); callers
 *   must not proceed against a venv missing torch-family packages.
 * - Marker absent but backups on disk: the swap COMMITTED and only its backup
 *   cleanup was interrupted. The backups are stale debris - restoring them
 *   would silently revert the swap - so they are deleted (best-effort;
 *   leftovers retry next run).
 *
 * Runs at every launch (before mismatch detection, which bails when torch is
 * unreadable) and at the start of every swap.
 */
export async function recoverTorchFamilyBackups(site: string): Promise<void> {
  // A venv without site-packages has no marker and no backups - nothing to
  // recover. Some callers (the launch gate) treat a recovery failure as
  // launch-blocking, so a benign absence must not read as a failed rollback.
  if (!fs.existsSync(site)) return
  const marker = readSwapMarker(site)
  const backupEntries = fs.readdirSync(site).filter((e) => e.startsWith(BACKUP_PREFIX))

  if (marker === null) {
    // Committed swap: backups are debris of the new, good state.
    for (const entry of backupEntries) {
      await fs.promises.rm(path.join(site, entry), { recursive: true, force: true }).catch(() => {})
    }
    return
  }

  // Interrupted swap: roll back. Restore backups first (a backup original can
  // share its name with a placed entry, e.g. the 'torch' dir - the restore
  // overwrites it), then drop placed entries introduced under NEW names (e.g.
  // the new dist-info); placed names that are also backup originals were just
  // restored and must not be touched.
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
    // The placed list is unknown, and a same-key stranger beside a restored
    // original is ambiguous: it may be a newly placed entry (crash mid-place)
    // or an original the backup loop never reached (crash mid-backup) - e.g.
    // the old torch dist-info. Deleting a good original would leave torch
    // invisible to pip and unrepairable, so never guess destructively: keep
    // the stranger. At worst that leaves duplicate metadata (two dist-infos
    // of one package), which the next successful swap backs up and cleans.
    console.warn('torch-family swap marker was unreadable; rolled backups back without sweeping placed entries - duplicate package metadata may remain until the next stack swap')
  }
  await fs.promises.rm(path.join(site, SWAP_MARKER), { force: true })
}

/**
 * Replace the bundle-provided torch-family packages in dstSite with the copies
 * from srcSite. Staged-then-swapped: the new packages are copied in full under
 * temp names before any old package is touched, and the swap itself only uses
 * renames - the old packages are renamed to backup names, the staged copies
 * renamed into place, and the backups deleted last. A swap marker journals the
 * rename phase, and on any failure the backups are renamed back, so an error,
 * cancellation, or hard kill never leaves dstSite without a complete torch
 * family (this runs against the LIVE venv during startup repair). Only
 * packages the bundle actually ships are replaced - unrelated torch-adjacent
 * deps a snapshot restore or custom node installed (torchsde, torchmetrics)
 * are left untouched.
 */
export async function copyTorchFamily(srcSite: string, dstSite: string, signal?: AbortSignal): Promise<void> {
  const srcEntries = fs.readdirSync(srcSite, { withFileTypes: true }).filter((e) => isTorchFamilyEntry(e.name))
  const providedKeys = new Set(srcEntries.map((e) => packageKey(e.name)))

  // Recover leftovers from a prior run that died mid-swap, then sweep pure
  // staging leftovers so the rename below can't collide with stale temp names.
  await recoverTorchFamilyBackups(dstSite)
  for (const entry of fs.readdirSync(dstSite)) {
    if (entry.startsWith(STAGING_PREFIX)) {
      await fs.promises.rm(path.join(dstSite, entry), { recursive: true, force: true })
    }
  }

  // 1. Stage full copies under temp names (old torch stays live meanwhile).
  const staged: Array<{ name: string; tmp: string }> = []
  for (const e of srcEntries) {
    if (signal?.aborted) throw new Error('Cancelled')
    const from = path.join(srcSite, e.name)
    const tmp = path.join(dstSite, `${STAGING_PREFIX}${e.name}`)
    if (e.isDirectory()) await copyDirWithProgress(from, tmp, null, { signal })
    else await fs.promises.copyFile(from, tmp)
    staged.push({ name: e.name, tmp })
  }

  // 2. Journal the swap plan BEFORE the first rename, so an interruption
  //    anywhere in the rename phase is distinguishable from committed debris.
  const toBackup = fs.readdirSync(dstSite).filter((entry) =>
    !entry.startsWith(STAGING_PREFIX) && isTorchFamilyEntry(entry) && providedKeys.has(packageKey(entry)))
  await writeSwapMarker(dstSite, { backups: toBackup, placed: staged.map((s) => s.name) })

  // 3. Swap via renames only (fast metadata ops, each individually atomic):
  //    old copies aside to backup names, staged copies into place.
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
    // Roll back: drop whatever was placed, restore the originals. A rollback
    // step failing is NOT swallowed - the marker is kept so the next run's
    // recovery retries, and the caller must know the live venv is incomplete.
    const rollbackErrors: string[] = []
    for (const final of placed) {
      await fs.promises.rm(final, { recursive: true, force: true })
        .catch((e: Error) => rollbackErrors.push(`remove ${path.basename(final)}: ${e.message}`))
    }
    for (const b of backups) {
      await fs.promises.rename(b.bak, path.join(dstSite, b.name))
        .catch((e: Error) => rollbackErrors.push(`restore ${b.name}: ${e.message}`))
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`${(err as Error).message}; rollback incomplete: ${rollbackErrors.join(', ')}`, { cause: err })
    }
    await fs.promises.rm(path.join(dstSite, SWAP_MARKER), { force: true }).catch(() => {})
    throw err
  }

  // 4. Commit: delete the marker FIRST (the atomic commit point - from here
  //    the backups are debris, never restored), then the backups themselves.
  //    Deletion failures are ignored; recovery collects debris next run.
  await fs.promises.rm(path.join(dstSite, SWAP_MARKER), { force: true })
  for (const b of backups) {
    await fs.promises.rm(b.bak, { recursive: true, force: true }).catch(() => {})
  }
}

// Top-level import packages a family distribution ships beyond its own name.
// They carry no dist-info of their own, so removal by distribution name alone
// would strand them (e.g. a stale torio from the previous torchaudio would
// import against the wrong torchaudio - or nothing at all).
const DIST_OWNED_EXTRAS: Record<string, readonly string[]> = {
  torch: ['torchgen', 'functorch'],
  torchaudio: ['torio'],
}

/** ROCm-SDK-ecosystem site-packages entry: the SDK distributions' metadata
 *  and payload (rocm, rocm-bootstrap, rocm-sdk-*, their `_`-prefixed python
 *  payload packages and pure shims like rocm_sdk_device) plus AMD's torch
 *  device-overlay dist-infos (amd-torch-device-gfx*, amd-torchvision-
 *  device-gfx* - overlay wheels whose file payload lives inside torch/
 *  and torchvision/ themselves). Deliberately NOT a bare 'rocm' prefix:
 *  unrelated ROCm-adjacent packages (e.g. rocm-docs-core) must never be
 *  swept as stack debris. */
function isRocmEcosystemEntry(name: string): boolean {
  const key = packageKey(stripLibs(name))
  const base = key.startsWith('_') ? key.slice(1) : key
  return base === 'rocm'
    || base === 'rocm_bootstrap'
    || base === 'rocm_sdk'
    || base.startsWith('rocm_sdk_')
    || base === 'amd_torch_device' || base.startsWith('amd_torch_device_')
    || base === 'amd_torchvision_device' || base.startsWith('amd_torchvision_device_')
}

/** Normalized dist names of every installed ROCm-ecosystem distribution in
 *  `site` (see isRocmEcosystemEntry). Input for the pip path's
 *  reconciliation: pip only mutates distributions the target dependency tree
 *  references, so these must be uninstalled explicitly when entering, moving
 *  within, or leaving the AMD multi-arch family. */
export function listRocmEcosystemDists(site: string): string[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(site)
  } catch {
    // findSitePackages does not stat on Windows; a missing dir has no dists.
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

/** True for the per-architecture distributions only the AMD multi-arch index
 *  installs (torch/torchvision device overlays and the SDK's device
 *  libraries) - their presence marks a venv as multi-arch-built. */
export function isAmdMultiArchOverlayDist(name: string): boolean {
  const key = name.toLowerCase().replace(/-/g, '_')
  return key.startsWith('amd_torch_device')
    || key.startsWith('amd_torchvision_device')
    || key.startsWith('rocm_sdk_device')
}

/**
 * Remove ROCm-ecosystem entries in dstSite that srcSite (the bundle payload)
 * does not ship. The graft only replaces same-key entries, so a switch away
 * from an AMD multi-arch stack would otherwise leave its rocm-sdk device and
 * library dists behind - lying dist-info beside the target's SDK, whose
 * library discovery then fails at import (universal target) or which shadow
 * nothing but waste gigabytes (non-AMD target). Returns the removed
 * distribution names (from dist-info entries) so verification can assert
 * they stayed gone. Operates on the transaction's candidate copy, never the
 * live venv.
 */
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

/**
 * Remove every site-packages entry (package dir, dist-info, auditwheel .libs
 * sidecar, distribution-owned extra top-level packages) belonging to the named
 * packages. Used by the stack transaction to drop optional family packages the
 * target stack omits - it operates on the transaction's candidate copy, never
 * the live venv.
 */
export async function removeTorchFamilyPackages(site: string, names: readonly string[]): Promise<void> {
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
