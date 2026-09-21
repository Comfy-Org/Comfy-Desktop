import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import {
  readGitHead,
  isGitAvailable,
  gitClone,
  gitCheckoutCommit,
  gitFetchAndCheckout,
  type ProcessResult
} from '../git'
import { rewriteCloneUrl } from '../github-mirror'
import { scanCustomNodes, nodeKey } from '../nodes'
import {
  pipFreeze,
  runUvPip as sharedRunUvPip,
  installFilteredRequirements,
  getPipIndexArgs,
  type PipMirrorConfig
} from '../pip'
import { installCnrNode, switchCnrVersion, isSafePathComponent } from '../cnr'
import { killProcTree } from '../process'
import { formatComfyVersion } from '../version'
import { getActivePythonPath, getActiveUvPath, getActiveVenvDir } from '../pythonEnv'
import { findSitePackages } from '../../sources/standalone/envPaths'
import type { Snapshot, RestoreResult, RestoreRevertOutcome, NodeRestoreResult } from './types'
import type { ScannedNode } from '../nodes'
import type { InstallationRecord } from '../../installations'
import type { ComfyVersion } from '../version'
import * as settings from '../../settings'

/** Packages never modified during snapshot restore: core tooling plus the
 *  torch stack itself (owned by the torch transaction, not pip sync). Stack
 *  packages are named EXACTLY — ordinary torch-ecosystem deps a snapshot can
 *  restore fine (torchsde, torchmetrics, torchdiffeq…) must stay managed by
 *  the pip sync, or v1 snapshots could never fully restore. */
const PROTECTED_EXACT = new Set([
  'pip',
  'setuptools',
  'wheel',
  'uv',
  'torch',
  'torchvision',
  'torchaudio',
  'torio',
  'functorch',
  'triton',
  // Intel XPU runtime family members protected by exact name because a
  // prefix would swallow unrelated user packages (mkl-fft, mkl-service,
  // intel-extension-for-pytorch, ...). 'pyelftools' is general-purpose but
  // a hard dependency of the XPU triton build - the sync removing it breaks
  // the protected triton, so it is protected with it (tradeoff: a snapshot
  // recording pyelftools for its own sake will not install it either).
  'mkl',
  'intel-opencl-rt',
  'intel-openmp',
  'intel-pti',
  'intel-sycl-rt',
  'tbb',
  'tcmlib',
  'umf',
  'pyelftools'
])
// Prefixes matched as `<prefix>` / `<prefix>-*` / `<prefix>_*` (never a bare
// substring — 'torchsde' must not match 'torch'): torch-tensorrt and
// torch_scatter compile against torch's ABI, 'nvidia' covers
// nvidia-cublas-cu12 etc., 'triton' covers triton-windows,
// 'pytorch-triton' covers pytorch-triton-rocm, 'cuda' covers cuda-bindings.
// The 'amd-*-device' prefixes cover AMD's multi-arch per-architecture
// device-overlay wheels (amd-torch-device-gfx*, amd-torchvision-device-gfx*):
// they only resolve from AMD's index via the torch [device-all] extras, so
// the torch phase owns them - a plain pip sync can neither install nor
// remove them safely. Deliberately NOT a bare 'amd' prefix, so ordinary
// AMD-published libraries (e.g. amd-quark) stay snapshot-restorable.
// The oneAPI prefixes cover the XPU stack's runtime family (dpcpp-cpp-rt,
// intel-cmplr-*, onemkl-sycl-*, oneccl/impi bindings, level-zero): pip
// installs them as ordinary dependencies of torch +xpu wheels, so without
// protection a snapshot from another vendor uninstalls them from an Intel
// install (breaking the local stack) and an Intel snapshot installs them
// onto AMD/NVIDIA installs. Deliberately NOT bare 'intel' or 'mkl'
// prefixes: ordinary Intel-published libraries (mkl-fft, mkl-service,
// intel-extension-for-pytorch) must stay snapshot-restorable - the
// remaining runtime members are protected by exact name above.
const PROTECTED_PREFIXES = [
  'torch',
  'nvidia',
  'triton',
  'pytorch-triton',
  'cuda',
  'rocm',
  'amd-torch-device',
  'amd-torchvision-device',
  'amd-torchaudio-device',
  'intel-cmplr',
  'onemkl',
  'dpcpp',
  'oneccl',
  'impi',
  'level-zero'
]

export function isProtectedPackage(name: string): boolean {
  const lower = name.toLowerCase()
  if (PROTECTED_EXACT.has(lower)) return true
  return PROTECTED_PREFIXES.some(
    (prefix) => lower === prefix || lower.startsWith(`${prefix}-`) || lower.startsWith(`${prefix}_`)
  )
}

/** Constraint pins for the currently installed protected packages. Only plain
 *  `name==version` pins are valid in a constraints file: editable installs
 *  (`-e ...`) and PEP 508 direct references (bare URL values from pipFreeze)
 *  are skipped — the post-repair freeze diff still flags any drift on them. */
export function buildProtectedConstraints(freeze: Record<string, string>): string[] {
  return Object.entries(freeze)
    .filter(
      ([name, version]) =>
        isProtectedPackage(name) && /^\d/.test(version) && !version.includes('://')
    )
    .map(([name, version]) => `${name}==${version}`)
}

export interface ProtectedDriftEntry {
  name: string
  /** Version the snapshot records; null when the package is not in the snapshot. */
  target: string | null
  /** Version installed now; null when the package is absent. */
  live: string | null
}

/**
 * Protected packages whose live version differs from the snapshot's freeze.
 * The exact pip sync never mutates protected packages (torch stack, CUDA
 * runtime, core tooling), so after a restore this diff is what tells the
 * caller whether the live state actually reached the snapshot's recorded
 * state — the torch transaction reconciles the stack itself, but e.g. a v1
 * snapshot with a different torchvision has no stack record to reconcile it.
 */
export async function protectedPackageDrift(
  installation: InstallationRecord,
  targetPips: Record<string, string>
): Promise<ProtectedDriftEntry[]> {
  const uvPath = getActiveUvPath(installation)
  const pythonPath = getActivePythonPath(installation)
  // Throw rather than return [] — "can't measure" must surface as unknown
  // drift, never as known-zero.
  if (!pythonPath || !fs.existsSync(uvPath)) {
    throw new Error('Python environment or uv not found')
  }
  const live = await pipFreeze(uvPath, pythonPath)
  // Compare under PEP 503 canonical names — distribution names are
  // case-insensitive and treat -/_/. as equivalent, so snapshot `Torch` and
  // live `torch` are the same package, not one missing and one extra.
  const canon = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, '-')
  const liveByCanon = new Map(
    Object.entries(live).map(([name, version]) => [canon(name), { name, version }])
  )
  const targetByCanon = new Map(
    Object.entries(targetPips).map(([name, version]) => [canon(name), { name, version }])
  )
  const drift: ProtectedDriftEntry[] = []
  for (const [key, target] of targetByCanon) {
    if (!isProtectedPackage(key)) continue
    const lv = liveByCanon.get(key)
    if ((lv?.version ?? null) !== target.version) {
      drift.push({ name: target.name, target: target.version, live: lv?.version ?? null })
    }
  }
  for (const [key, lv] of liveByCanon) {
    if (!isProtectedPackage(key)) continue
    if (!targetByCanon.has(key)) drift.push({ name: lv.name, target: null, live: lv.version })
  }
  return drift
}

/** Normalize a package name for dist-info directory matching (PEP 503). */
function normalizeDistInfoName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '_')
}

/** Find a package's dist-info directory in site-packages. */
function findDistInfoDir(sitePackages: string, packageName: string): string | null {
  const normalized = normalizeDistInfoName(packageName)
  try {
    for (const entry of fs.readdirSync(sitePackages)) {
      if (!entry.endsWith('.dist-info')) continue
      // Format {normalized_name}-{version}.dist-info; normalized name uses _, so the first
      // '-' separates name from version.
      const stem = entry.slice(0, -'.dist-info'.length)
      const dashIdx = stem.indexOf('-')
      if (dashIdx < 0) continue
      const dirName = stem.slice(0, dashIdx)
      if (normalizeDistInfoName(dirName) === normalized) {
        return entry
      }
    }
  } catch {}
  return null
}

/** Find all site-packages entries belonging to a package, via the dist-info RECORD file. */
function findPackageEntries(sitePackages: string, packageName: string): string[] {
  const entries: string[] = []
  const distInfo = findDistInfoDir(sitePackages, packageName)
  if (!distInfo) return entries

  entries.push(distInfo)

  const recordPath = path.join(sitePackages, distInfo, 'RECORD')
  try {
    const content = fs.readFileSync(recordPath, 'utf-8')
    const topLevels = new Set<string>()
    for (const line of content.split('\n')) {
      const filePath = line.split(',')[0]?.trim()
      if (!filePath || filePath.startsWith('..') || filePath === '') continue
      const topLevel = filePath.replace(/\\/g, '/').split('/')[0]!
      if (topLevel && topLevel !== distInfo) {
        topLevels.add(topLevel)
      }
    }
    for (const tl of topLevels) {
      if (fs.existsSync(path.join(sitePackages, tl))) {
        entries.push(tl)
      }
    }
  } catch {
    // Fallback: common name patterns
    const normalized = normalizeDistInfoName(packageName)
    for (const suffix of ['', '.py', '.libs', '.data']) {
      const candidate = normalized + suffix
      if (fs.existsSync(path.join(sitePackages, candidate)) && !entries.includes(candidate)) {
        entries.push(candidate)
      }
    }
  }

  return entries
}

/** Back up only the site-packages entries belonging to `packageNames`.
 *  `uncaptured` names the packages no entries were found for — `findPackageEntries`
 *  locates `.dist-info` only, so a legacy `.egg-info` / `.egg-link` install yields
 *  nothing. The revert cannot put those back, so it must not claim it did. */
async function createTargetedBackup(
  sitePackages: string,
  packageNames: string[]
): Promise<{ dir: string; uncaptured: string[] }> {
  const backupDir = path.join(path.dirname(sitePackages), `.restore-backup-${Date.now()}`)
  await fs.promises.mkdir(backupDir, { recursive: true })

  const failures: string[] = []
  const uncaptured: string[] = []
  for (const pkg of packageNames) {
    const pkgEntries = findPackageEntries(sitePackages, pkg)
    if (pkgEntries.length === 0) uncaptured.push(pkg)
    for (const entry of pkgEntries) {
      const src = path.join(sitePackages, entry)
      const dst = path.join(backupDir, entry)
      try {
        const stat = await fs.promises.stat(src)
        if (stat.isDirectory()) {
          await fs.promises.cp(src, dst, { recursive: true })
        } else {
          await fs.promises.mkdir(path.dirname(dst), { recursive: true })
          await fs.promises.copyFile(src, dst)
        }
      } catch (err) {
        failures.push(`${entry}: ${(err as Error).message}`)
      }
    }
  }

  if (failures.length > 0) {
    // Clean up incomplete backup
    await fs.promises.rm(backupDir, { recursive: true, force: true }).catch(() => {})
    throw new Error(`Backup failed for ${failures.length} entry(s): ${failures.join('; ')}`)
  }

  return { dir: backupDir, uncaptured }
}

/** Restore backed-up package files to site-packages. Returns false when any
 *  entry could not be put back — the caller must not then claim a clean revert.
 *
 *  Each entry is attempted independently: the loop deletes a destination before
 *  copying over it, so letting the first failure abort would leave the earlier
 *  entries removed and the remaining ones never restored — a revert that
 *  destroys more than it repairs. */
async function restoreFromBackup(backupDir: string, sitePackages: string): Promise<boolean> {
  let entries: string[]
  try {
    entries = await fs.promises.readdir(backupDir)
  } catch (err) {
    console.error('Failed to read backup directory:', (err as Error).message)
    return false
  }

  let allRestored = true
  for (const entry of entries) {
    const src = path.join(backupDir, entry)
    const dst = path.join(sitePackages, entry)
    try {
      const stat = await fs.promises.stat(src)
      await fs.promises.rm(dst, { recursive: true, force: true }).catch(() => {})
      if (stat.isDirectory()) {
        await fs.promises.cp(src, dst, { recursive: true })
      } else {
        await fs.promises.copyFile(src, dst)
      }
    } catch (err) {
      // Keep going: every remaining entry is another package the user gets back.
      console.error(`Failed to restore ${entry} from backup:`, (err as Error).message)
      allRestored = false
    }
  }
  return allRestored
}

/** Metadata entries that mark an installed distribution in site-packages.
 *  `.dist-info` is the modern form (PEP 376); `.egg-info` and `.egg-link` are
 *  legacy setuptools forms still produced by some installs. Any of them is
 *  evidence the package is present, and presence is what decides whether the
 *  revert may uninstall it — so the list errs towards recognising more. */
const DIST_METADATA_SUFFIXES = ['.dist-info', '.egg-info', '.egg-link']

/** Suffixes whose entry name never carries a version, so the stem is the whole
 *  distribution name. `.egg-link` points at a source tree and is always bare;
 *  `.egg-info` and `.dist-info` may or may not be versioned. */
const UNVERSIONED_METADATA_SUFFIXES = new Set(['.egg-link'])

/**
 * Does this site-packages metadata stem belong to `normalizedName`?
 *
 * Asked this way round deliberately. Parsing a name back out of an entry is
 * ambiguous — `my-package.egg-link` and `my-package-1.0.egg-info` both split
 * at the first hyphen and yield `my` — whereas testing a known package against
 * an entry is exact. `{name}{suffix}` is the bare legacy form; for the
 * versioned forms anything after the separator must start with a digit, so a
 * version matches but a longer package name (`foo` must not match
 * `foo-bar-1.0.dist-info`) does not. An always-bare suffix takes the exact
 * branch only, so `foo-2bar.egg-link` is `foo-2bar` and never `foo`.
 */
function stemBelongsTo(stem: string, normalizedName: string, versioned: boolean): boolean {
  if (stem === normalizedName) return true
  if (!versioned) return false
  if (!stem.startsWith(`${normalizedName}_`)) return false
  return /^\d/.test(stem.slice(normalizedName.length + 1))
}

/**
 * Packages the plan calls "new" that are in fact already installed, judged from
 * site-packages rather than from the freeze.
 *
 * The revert path may only uninstall packages this operation actually
 * installed. Deriving that set from the freeze diff alone is unsafe: any fault
 * that makes the freeze unreadable makes every target package look absent, and
 * the revert then uninstalls the user's whole environment (#1514 — a
 * colourised freeze produced exactly that, dropping 100 packages to 6).
 * Distribution metadata on disk is independent evidence that the package
 * predates this restore, so those names are excluded from the revert.
 */
export function preexistingOnDisk(sitePackages: string, packageNames: string[]): string[] {
  if (packageNames.length === 0) return []
  let entries: string[]
  try {
    entries = fs.readdirSync(sitePackages)
  } catch {
    // site-packages unreadable: "can't tell" must not read as "nothing was
    // installed before", which is the reading that uninstalls the user's
    // environment. Treat every candidate as pre-existing.
    return [...packageNames]
  }
  const stems: Array<{ stem: string; versioned: boolean }> = []
  for (const entry of entries) {
    const suffix = DIST_METADATA_SUFFIXES.find((s) => entry.endsWith(s))
    if (!suffix) continue
    stems.push({
      stem: normalizeDistInfoName(entry.slice(0, -suffix.length)),
      versioned: !UNVERSIONED_METADATA_SUFFIXES.has(suffix)
    })
  }
  return packageNames.filter((name) => {
    const normalized = normalizeDistInfoName(name)
    return stems.some(({ stem, versioned }) => stemBelongsTo(stem, normalized, versioned))
  })
}

const runUvPip = sharedRunUvPip

/** Restore the ComfyUI version to the snapshot's commit, checking it out if HEAD differs. */
export async function restoreComfyUIVersion(
  installPath: string,
  targetSnapshot: Snapshot,
  sendOutput: (text: string) => void,
  signal?: AbortSignal
): Promise<{ changed: boolean; commit: string | null; error?: string }> {
  const comfyuiDir = path.join(installPath, 'ComfyUI')
  const targetCommit = targetSnapshot.comfyui.commit
  if (!targetCommit) {
    return { changed: false, commit: null }
  }
  if (!/^[a-f0-9]{7,40}$/.test(targetCommit)) {
    return { changed: false, commit: null, error: 'Invalid commit hash in snapshot' }
  }

  const currentHead = readGitHead(comfyuiDir)
  if (
    currentHead &&
    (currentHead.startsWith(targetCommit) || targetCommit.startsWith(currentHead))
  ) {
    return { changed: false, commit: currentHead }
  }

  const gitDir = path.join(comfyuiDir, '.git')
  if (!fs.existsSync(gitDir)) {
    const msg = 'ComfyUI .git directory not found — cannot restore version'
    sendOutput(`⚠ ${msg}\n`)
    return { changed: false, commit: currentHead, error: msg }
  }

  sendOutput(`Checking out ComfyUI commit ${targetCommit.slice(0, 7)}…\n`)
  const gitResult = await gitFetchAndCheckout(comfyuiDir, targetCommit, sendOutput, signal)
  if (gitResult.exitCode !== 0) {
    const detail = (gitResult.stderr || gitResult.stdout).trim().split('\n').slice(-20).join('\n')
    const msg = detail
      ? `git checkout failed with exit code ${gitResult.exitCode}:\n${detail}`
      : `git checkout failed with exit code ${gitResult.exitCode}`
    sendOutput(`⚠ ${msg}\n`)
    return { changed: false, commit: currentHead, error: msg }
  }

  const newHead = readGitHead(comfyuiDir)
  return { changed: true, commit: newHead }
}

/**
 * Installation-record overrides that freeze a snapshot-created install to the
 * snapshot's pinned ComfyUI version. `autoUpdateComfyUI: false` stops the
 * post-install auto-update (the snapshot restore is the sole authority for the
 * core commit). Pass the snapshot's updateChannel to mirror it as the manual
 * update preference; omit it to leave whatever channel the install was built
 * with (the restore re-applies the channel via buildPostRestoreState).
 */
export function frozenSnapshotInstallOverrides(snapshotUpdateChannel?: string): {
  autoUpdateComfyUI: false
  updateChannel?: 'stable' | 'latest'
} {
  return {
    autoUpdateComfyUI: false,
    ...(snapshotUpdateChannel !== undefined
      ? { updateChannel: snapshotUpdateChannel === 'latest' ? 'latest' : 'stable' }
      : {})
  }
}

/**
 * Build the installation-state update to apply after a restore. Always updates updateChannel
 * + lastRollback; updates version + updateInfoByChannel to the snapshot when the version
 * restore succeeded, else keeps current state so the next update check detects the mismatch.
 */
export function buildPostRestoreState(
  targetSnapshot: Snapshot,
  comfyResult: { changed: boolean; commit: string | null; error?: string },
  existingUpdateInfo: Record<string, Record<string, unknown>> | undefined,
  currentComfyVersion?: ComfyVersion
): Record<string, unknown> {
  const targetChannel = targetSnapshot.updateChannel || 'stable'
  const headCommit = comfyResult.commit || targetSnapshot.comfyui.commit

  let restoredComfyVersion: ComfyVersion | undefined
  if (comfyResult.error) {
    restoredComfyVersion = currentComfyVersion
  } else if (headCommit) {
    restoredComfyVersion = {
      commit: headCommit,
      baseTag: targetSnapshot.comfyui.baseTag,
      commitsAhead: targetSnapshot.comfyui.commitsAhead
    }
  } else {
    restoredComfyVersion = currentComfyVersion
  }

  const installedTag = restoredComfyVersion
    ? formatComfyVersion(restoredComfyVersion, 'short')
    : 'unknown'

  const state: Record<string, unknown> = {
    updateChannel: targetChannel,
    ...(restoredComfyVersion ? { comfyVersion: restoredComfyVersion } : {}),
    lastRollback: {
      preUpdateHead: null,
      postUpdateHead: headCommit,
      backupBranch: null,
      channel: targetChannel,
      updatedAt: Date.now()
    },
    updateInfoByChannel: {
      ...(existingUpdateInfo || {}),
      [targetChannel]: { installedTag }
    }
  }

  return state
}

/** Restore pip packages to the snapshot, backing up affected packages first and reverting on failure. */
export async function restorePipPackages(
  installPath: string,
  installation: InstallationRecord,
  targetSnapshot: Snapshot,
  sendProgress: (phase: string, data: Record<string, unknown>) => void,
  sendOutput: (text: string) => void,
  signal?: AbortSignal,
  mirrors?: PipMirrorConfig
): Promise<RestoreResult> {
  const result: RestoreResult = {
    installed: [],
    removed: [],
    changed: [],
    protectedSkipped: [],
    failed: [],
    errors: []
  }

  const uvPath = getActiveUvPath(installation)
  const pythonPath = getActivePythonPath(installation)
  if (!pythonPath || !fs.existsSync(uvPath)) {
    throw new Error('Python environment or uv not found')
  }

  // 1. Capture current pip state
  sendProgress('restore', { percent: 5, status: 'Analyzing current environment…' })
  sendOutput('\nAnalyzing pip packages…\n')
  const currentPips = await pipFreeze(uvPath, pythonPath)
  const targetPips = targetSnapshot.pipPackages
  const currentCount = Object.keys(currentPips).length
  const targetCount = Object.keys(targetPips).length
  sendOutput(`Found ${currentCount} current package(s), target snapshot has ${targetCount}\n`)

  // 2. Compute what needs to change
  const toInstall: Array<{ name: string; version: string }> = []
  const toRemove: string[] = []

  for (const [name, version] of Object.entries(targetPips)) {
    if (isProtectedPackage(name)) {
      if (!(name in currentPips) || currentPips[name] !== version) {
        result.protectedSkipped.push(name)
      }
      continue
    }
    // Skip editable installs and direct references.
    if (version.startsWith('-e ') || version.includes('://')) continue

    if (!(name in currentPips)) {
      toInstall.push({ name, version })
    } else if (currentPips[name] !== version) {
      result.changed.push({ name, from: currentPips[name]!, to: version })
      toInstall.push({ name, version })
    }
  }

  for (const name of Object.keys(currentPips)) {
    if (!(name in targetPips)) {
      if (isProtectedPackage(name)) {
        result.protectedSkipped.push(name)
      } else {
        toRemove.push(name)
      }
    }
  }

  // Identify truly-new packages upfront so revert can uninstall them even if a bulk install
  // was killed mid-way before result.installed was populated.
  const newPkgNames = toInstall
    .filter((p) => !result.changed.some((c) => c.name === p.name))
    .map((p) => p.name)

  // Print the plan
  const newPkgs = newPkgNames
  const pipPlanParts: string[] = []
  if (newPkgs.length > 0) pipPlanParts.push(`install ${newPkgs.length}`)
  if (result.changed.length > 0) pipPlanParts.push(`change ${result.changed.length}`)
  if (toRemove.length > 0) pipPlanParts.push(`remove ${toRemove.length}`)
  if (result.protectedSkipped.length > 0)
    pipPlanParts.push(`${result.protectedSkipped.length} protected (skipped)`)
  if (pipPlanParts.length > 0) {
    sendOutput(`\nPlan: ${pipPlanParts.join(', ')} package(s)\n\n`)
  } else {
    sendOutput('\nNo package changes needed\n')
  }

  if (toInstall.length === 0 && toRemove.length === 0) {
    return result
  }

  // 3. Create targeted backup of packages that will be modified or removed
  sendProgress('restore', { percent: 10, status: 'Creating backup of affected packages…' })
  let envDir = getActiveVenvDir(installation)
  let sitePackages = findSitePackages(envDir)
  if (!sitePackages) {
    // Fallback: legacy envs/default/ layout (pre-migration).
    envDir = path.join(installPath, 'envs', 'default')
    sitePackages = findSitePackages(envDir)
  }
  if (!sitePackages) {
    throw new Error('Could not locate site-packages directory')
  }

  // Ground truth for the revert, taken before anything is installed: of the
  // packages the plan calls new, these are already on disk and therefore
  // predate this restore. They are never uninstalled by the revert, however
  // the freeze diff classified them (#1514).
  const alreadyInstalled = preexistingOnDisk(sitePackages, newPkgNames)
  const alreadyInstalledSet = new Set(alreadyInstalled)
  const revertUninstall = newPkgNames.filter((name) => !alreadyInstalledSet.has(name))
  if (alreadyInstalled.length > 0) {
    sendOutput(
      `Note: ${alreadyInstalled.length} package(s) planned as new are already installed on disk; ` +
        `a revert will leave them in place.\n`
    )
  }

  // Back up everything this operation may overwrite or delete. `alreadyInstalled`
  // has to be in here as well as excluded from the revert's uninstall list: the
  // freeze does not list those packages, so the install step still overwrites
  // them, and not uninstalling one is not the same as putting its original
  // version back. Without the backup a failed restore would leave them at the
  // snapshot's version while reporting a complete revert.
  const packagesToBackup = [
    ...new Set([
      ...toInstall.filter((p) => p.name in currentPips).map((p) => p.name),
      ...alreadyInstalled,
      ...toRemove
    ])
  ]

  let backupDir: string | null = null
  // Set when a revert could not put the backup back, so the `finally` keeps it.
  let keepBackup = false
  // Packages with no backed-up entries: a revert cannot restore these.
  let uncapturedByBackup: string[] = []
  if (packagesToBackup.length > 0) {
    const backup = await createTargetedBackup(sitePackages, packagesToBackup)
    backupDir = backup.dir
    uncapturedByBackup = backup.uncaptured
  }

  // Whether any pip mutation actually started. A cancel between taking the
  // backup and the first install leaves nothing to revert, so an uncaptured
  // backup is not a failure to revert — it is a revert with no work to do.
  let mutationAttempted = false

  try {
    // 4. Install missing + upgrade/downgrade changed packages
    if (toInstall.length > 0 && !signal?.aborted) {
      mutationAttempted = true
      const totalOps = toInstall.length + toRemove.length
      sendProgress('restore', { percent: 20, status: `Installing ${toInstall.length} package(s)…` })

      const specs = toInstall.map((p) => `${p.name}==${p.version}`)
      const indexArgs = getPipIndexArgs(mirrors?.pypiMirror, mirrors?.useChineseMirrors)

      // Try bulk install first
      sendOutput(`\nInstalling ${specs.length} package(s)…\n`)
      const bulkResult = await runUvPip(
        uvPath,
        ['pip', 'install', ...specs, '--python', pythonPath, ...indexArgs],
        installPath,
        sendOutput,
        signal
      )

      if (bulkResult !== 0) {
        sendOutput('\n⚠ Bulk install failed, falling back to one-by-one with --no-deps\n\n')

        for (let i = 0; i < specs.length; i++) {
          if (signal?.aborted) break
          const spec = specs[i]!
          const name = toInstall[i]!.name
          const percent = 20 + Math.round((i / totalOps) * 50)
          sendProgress('restore', { percent, status: `Installing ${name}…` })

          const singleResult = await runUvPip(
            uvPath,
            ['pip', 'install', spec, '--no-deps', '--python', pythonPath, ...indexArgs],
            installPath,
            sendOutput,
            signal
          )

          if (singleResult !== 0) {
            result.failed.push(name)
            result.errors.push(`Failed to install ${spec}`)
          } else if (!result.changed.some((c) => c.name === name)) {
            result.installed.push(name)
          }
        }
      } else {
        for (const p of toInstall) {
          if (!result.changed.some((c) => c.name === p.name)) {
            result.installed.push(p.name)
          }
        }
      }
    }

    // 5. Remove extra packages (present in current but absent from snapshot)
    if (toRemove.length > 0 && !signal?.aborted) {
      mutationAttempted = true
      sendProgress('restore', {
        percent: 75,
        status: `Removing ${toRemove.length} extra package(s)…`
      })
      sendOutput(`\nRemoving ${toRemove.length} extra package(s)…\n`)

      const removeResult = await runUvPip(
        uvPath,
        ['pip', 'uninstall', ...toRemove, '--python', pythonPath],
        installPath,
        sendOutput,
        signal
      )

      if (removeResult === 0) {
        result.removed.push(...toRemove)
      } else {
        for (const name of toRemove) {
          const singleResult = await runUvPip(
            uvPath,
            ['pip', 'uninstall', name, '--python', pythonPath],
            installPath,
            sendOutput,
            signal
          )
          if (singleResult === 0) {
            result.removed.push(name)
          } else {
            result.failed.push(name)
            result.errors.push(`Failed to remove ${name}`)
          }
        }
      }
    }

    // 6. If aborted or there were failures, revert the entire operation
    if (signal?.aborted || result.failed.length > 0) {
      const reason = signal?.aborted ? 'cancelled' : 'failures'
      sendProgress('restore', { percent: 90, status: `Reverting due to ${reason}…` })
      sendOutput(`\n⚠ Restore ${reason}. Reverting…\n`)

      let complete = true
      let restoredFromBackup = false
      if (backupDir) {
        restoredFromBackup = await restoreFromBackup(backupDir, sitePackages)
        if (!restoredFromBackup) {
          complete = false
          keepBackup = true
        }
      }
      if (mutationAttempted && uncapturedByBackup.length > 0) {
        // Nothing was saved for these, so whatever the install did to them
        // stands. Claiming a complete revert here would be the same false
        // reassurance this change exists to remove.
        complete = false
        sendOutput(
          `⚠ No backup was captured for ${uncapturedByBackup.length} package(s); ` +
            `their pre-restore state could not be put back: ${uncapturedByBackup.join(', ')}\n`
        )
      }

      // Use pre-computed revertUninstall (not result.installed): a killed bulk install may
      // have partially installed packages without populating result.installed. Packages that
      // were already on disk before the restore are excluded — uninstalling those is what
      // destroyed environments in #1514.
      const uninstalled: string[] = []
      if (revertUninstall.length > 0) {
        const code = await runUvPip(
          uvPath,
          ['pip', 'uninstall', ...revertUninstall, '--python', pythonPath],
          installPath,
          sendOutput
        ).catch(() => 1)
        if (code === 0) uninstalled.push(...revertUninstall)
        else complete = false
      }

      result.installed = []
      result.removed = []
      result.changed = []
      result.revert = {
        reason,
        uninstalled,
        keptPreexisting: alreadyInstalled,
        restoredFromBackup,
        complete
      }
      result.errors.push(
        complete
          ? `Restore reverted to pre-restore state due to ${reason}`
          : `Restore ${reason}, and the revert did not fully complete — see the log for details`
      )
    }
  } catch (err) {
    // Catastrophic failure — revert
    if (backupDir) {
      sendOutput(`\n⚠ Restore failed: ${(err as Error).message}\nReverting from backup…\n`)
      if (!(await restoreFromBackup(backupDir, sitePackages))) keepBackup = true
    }
    throw err
  } finally {
    // Only discard the backup once it is known to be unneeded. If putting it
    // back failed, it is the only remaining copy of the user's pre-restore
    // package files, and deleting it would turn a recoverable failure into
    // permanent data loss.
    if (backupDir && keepBackup) {
      sendOutput(`\nPre-restore package files were kept at ${backupDir}\n`)
    } else if (backupDir) {
      await fs.promises.rm(backupDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  return result
}

/**
 * One sentence describing what the pip phase's revert actually did, for the
 * failure dialog. The old text asserted that "package changes were reverted
 * where possible" whatever happened — in #1514 that ran alongside a revert that
 * had just deleted 94 pre-existing packages. The claim is now derived from the
 * recorded outcome, and stays deliberately vague only when there is no outcome
 * to report (the phase threw before it could record one).
 */
export function describePackageRevert(revert: RestoreRevertOutcome | undefined): string {
  // No recorded outcome means the phase threw before it could record one. That
  // path restores the file backup without checking the result and never
  // uninstalls what the run had already installed, so it is the least certain
  // of all — it must not read as the most reassuring.
  if (!revert) return 'The state of the package changes is unknown — see the log for details.'
  if (!revert.complete)
    return 'Some package changes could not be reverted — see the log for details.'
  // `keptPreexisting` packages had installs run against them, so "nothing was
  // applied" is not something the code can claim once any are present.
  if (
    revert.uninstalled.length === 0 &&
    !revert.restoredFromBackup &&
    revert.keptPreexisting.length === 0
  )
    return 'No package changes were applied.'
  return 'The package changes this restore made were reverted.'
}

export interface RequirementsRepairResult {
  /** Freeze diff of the repair pass: installs, version changes, and removals
   *  (`to: '(removed)'`). */
  changed: Array<{ name: string; from: string | null; to: string }>
  /** Non-fatal per-file install failures, plus any (should-be-impossible)
   *  protected-package drift the constraint pins failed to prevent. */
  errors: string[]
}

/**
 * Additive repair pass for compatible-mode restores, run AFTER the exact pip
 * sync: re-install ComfyUI core requirements and every enabled custom node's
 * requirements so the sync's remove-extras step can never leave the install
 * missing dependencies (the snapshot's freeze may not contain packages this
 * machine resolves differently). Only installs; never removes. The returned
 * freeze diff tells the caller whether the live state drifted from the
 * snapshot target.
 */
export async function repairNodeRequirements(
  installPath: string,
  installation: InstallationRecord,
  sendOutput: (text: string) => void,
  signal?: AbortSignal,
  mirrors?: PipMirrorConfig
): Promise<RequirementsRepairResult> {
  const result: RequirementsRepairResult = { changed: [], errors: [] }
  const uvPath = getActiveUvPath(installation)
  const pythonPath = getActivePythonPath(installation)
  if (!pythonPath || !fs.existsSync(uvPath)) return result

  const comfyuiDir = path.join(installPath, 'ComfyUI')
  const reqFiles: string[] = []
  const coreReq = path.join(comfyuiDir, 'requirements.txt')
  if (fs.existsSync(coreReq)) reqFiles.push(coreReq)
  const mgrReq = path.join(comfyuiDir, 'manager_requirements.txt')
  if (fs.existsSync(mgrReq)) reqFiles.push(mgrReq)
  const nodes = await scanCustomNodes(comfyuiDir)
  for (const node of nodes) {
    if (!node.enabled || node.type === 'file') continue
    const reqPath = path.join(comfyuiDir, 'custom_nodes', node.dirName, 'requirements.txt')
    if (fs.existsSync(reqPath)) reqFiles.push(reqPath)
  }
  if (reqFiles.length === 0) return result

  const before = await pipFreeze(uvPath, pythonPath)

  // Pin every currently installed protected package (torch stack, core
  // tooling) via a constraints file so a node requirement's transitive
  // dependencies can never swap the PyTorch stack out from under the restore.
  // A requirement that conflicts with the pins fails its install (recorded as
  // a repair error) instead of changing the stack.
  const constraintLines = buildProtectedConstraints(before)
  const constraintPath = path.join(installPath, '.repair-constraints.txt')
  await fs.promises.writeFile(constraintPath, constraintLines.join('\n'), 'utf-8')

  try {
    for (const reqPath of reqFiles) {
      if (signal?.aborted) break
      const label = path.relative(comfyuiDir, reqPath)
      try {
        const code = await installFilteredRequirements(
          reqPath,
          uvPath,
          pythonPath,
          installPath,
          `.repair-reqs-${normalizeDistInfoName(path.basename(path.dirname(reqPath)))}.txt`,
          sendOutput,
          signal,
          mirrors,
          constraintLines.length > 0 ? ['--constraint', constraintPath] : undefined
        )
        if (code !== 0) result.errors.push(`Requirements repair failed for ${label} (exit ${code})`)
      } catch (err) {
        result.errors.push(`Requirements repair failed for ${label}: ${(err as Error).message}`)
      }
    }
  } finally {
    await fs.promises.unlink(constraintPath).catch(() => {})
  }

  // Diff the freeze even when aborted mid-loop: callers must see any drift the
  // completed installs already caused. Union of keys so removals count too.
  const after = await pipFreeze(uvPath, pythonPath)
  const names = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const name of names) {
    const prev = before[name] ?? null
    const next = after[name] ?? null
    if (prev !== next) result.changed.push({ name, from: prev, to: next ?? '(removed)' })
  }
  const protectedChanged = result.changed.filter((c) => isProtectedPackage(c.name))
  if (protectedChanged.length > 0) {
    result.errors.push(
      `Requirements repair unexpectedly altered protected package(s): ${protectedChanged.map((c) => c.name).join(', ')}`
    )
  }
  return result
}

function isManagerNode(node: ScannedNode): boolean {
  return node.id.toLowerCase().includes('comfyui-manager')
}

async function disableNode(customNodesDir: string, dirName: string): Promise<void> {
  const src = path.join(customNodesDir, dirName)
  const disabledDir = path.join(customNodesDir, '.disabled')
  await fs.promises.mkdir(disabledDir, { recursive: true })
  const dst = path.join(disabledDir, dirName)
  await fs.promises.rm(dst, { recursive: true, force: true }).catch(() => {})
  await fs.promises.rename(src, dst)
}

async function enableNode(customNodesDir: string, dirName: string): Promise<void> {
  const src = path.join(customNodesDir, '.disabled', dirName)
  const dst = path.join(customNodesDir, dirName)
  await fs.promises.rm(dst, { recursive: true, force: true }).catch(() => {})
  await fs.promises.rename(src, dst)
}

async function runPostInstallScripts(
  nodePath: string,
  uvPath: string,
  pythonPath: string,
  installPath: string,
  sendOutput: (text: string) => void,
  signal?: AbortSignal,
  mirrors?: PipMirrorConfig
): Promise<void> {
  const reqPath = path.join(nodePath, 'requirements.txt')
  if (fs.existsSync(reqPath)) {
    try {
      await installFilteredRequirements(
        reqPath,
        uvPath,
        pythonPath,
        installPath,
        `.restore-reqs-${path.basename(nodePath)}.txt`,
        sendOutput,
        signal,
        mirrors
      )
    } catch (err) {
      sendOutput(
        `⚠ requirements.txt failed for ${path.basename(nodePath)}: ${(err as Error).message}\n`
      )
    }
  }

  const installScript = path.join(nodePath, 'install.py')
  if (fs.existsSync(installScript)) {
    try {
      await new Promise<void>((resolve) => {
        const proc = spawn(pythonPath, ['-s', installScript], {
          cwd: nodePath,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        })

        const onAbort = () => {
          killProcTree(proc)
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        if (signal?.aborted) onAbort()

        proc.stdout.on('data', (chunk: Buffer) => sendOutput(chunk.toString('utf-8')))
        proc.stderr.on('data', (chunk: Buffer) => sendOutput(chunk.toString('utf-8')))
        proc.on('error', (err) => {
          signal?.removeEventListener('abort', onAbort)
          sendOutput(`⚠ install.py error: ${err.message}\n`)
          resolve()
        })
        proc.on('exit', () => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        })
      })
    } catch (err) {
      sendOutput(`⚠ install.py failed for ${path.basename(nodePath)}: ${(err as Error).message}\n`)
    }
  }
}

/** Failure message for a git subprocess: action, exit code, and the output tail. */
function gitFailureMessage(action: string, result: ProcessResult): string {
  const detail = (result.stderr || result.stdout).trim().split('\n').slice(-20).join('\n')
  return detail
    ? `${action} failed (exit ${result.exitCode}):\n${detail}`
    : `${action} failed (exit ${result.exitCode})`
}

export async function restoreCustomNodes(
  installPath: string,
  installation: InstallationRecord,
  targetSnapshot: Snapshot,
  sendProgress: (phase: string, data: Record<string, unknown>) => void,
  sendOutput: (text: string) => void,
  signal?: AbortSignal,
  mirrors?: PipMirrorConfig
): Promise<NodeRestoreResult> {
  const result: NodeRestoreResult = {
    installed: [],
    switched: [],
    enabled: [],
    disabled: [],
    removed: [],
    skipped: [],
    failed: [],
    unreportable: []
  }

  const comfyuiDir = path.join(installPath, 'ComfyUI')
  const customNodesDir = path.join(comfyuiDir, 'custom_nodes')

  // 1. Scan current custom nodes
  sendProgress('restore-nodes', { percent: 5, status: 'Scanning custom nodes…' })
  sendOutput('Scanning current custom nodes…\n')
  const currentNodes = await scanCustomNodes(comfyuiDir)
  const currentByKey = new Map(currentNodes.map((n) => [nodeKey(n), n]))
  const targetByKey = new Map(targetSnapshot.customNodes.map((n) => [nodeKey(n), n]))
  sendOutput(
    `Found ${currentNodes.length} current node(s), target snapshot has ${targetSnapshot.customNodes.length}\n`
  )

  // Check git availability for git node operations
  const needsGit = targetSnapshot.customNodes.some(
    (n) =>
      n.type === 'git' &&
      (!currentByKey.has(nodeKey(n)) || currentByKey.get(nodeKey(n))?.commit !== n.commit)
  )
  const gitAvailable = needsGit ? await isGitAvailable() : false
  if (needsGit && !gitAvailable) {
    sendOutput('⚠ git is not available in PATH — git node operations will be skipped\n')
  }

  // Compute and print the plan
  const toRemove: string[] = []
  const toDisable: string[] = []
  const toInstallNodes: string[] = []
  const toSwitch: string[] = []
  const toEnable: string[] = []
  for (const [key, currentNode] of currentByKey) {
    if (isManagerNode(currentNode)) continue
    if (!targetByKey.has(key)) toRemove.push(currentNode.id)
  }
  for (const targetNode of targetSnapshot.customNodes) {
    if (isManagerNode(targetNode)) continue
    const currentNode = currentByKey.get(nodeKey(targetNode))
    if (!currentNode) {
      if (targetNode.type !== 'file') toInstallNodes.push(targetNode.id)
    } else if (!currentNode.enabled && targetNode.enabled) {
      toEnable.push(targetNode.id)
    } else if (currentNode.enabled && !targetNode.enabled) {
      toDisable.push(targetNode.id)
    } else if (targetNode.enabled || currentNode.enabled) {
      if (
        targetNode.type === 'cnr' &&
        targetNode.version &&
        currentNode.version !== targetNode.version
      ) {
        toSwitch.push(targetNode.id)
      } else if (
        targetNode.type === 'git' &&
        targetNode.commit &&
        currentNode.commit !== targetNode.commit
      ) {
        toSwitch.push(targetNode.id)
      }
    }
  }

  const planParts: string[] = []
  if (toInstallNodes.length > 0) planParts.push(`install ${toInstallNodes.length}`)
  if (toSwitch.length > 0) planParts.push(`switch ${toSwitch.length}`)
  if (toEnable.length > 0) planParts.push(`enable ${toEnable.length}`)
  if (toRemove.length > 0) planParts.push(`remove ${toRemove.length}`)
  if (toDisable.length > 0) planParts.push(`disable ${toDisable.length}`)
  if (planParts.length > 0) {
    sendOutput(`\nPlan: ${planParts.join(', ')} node(s)\n\n`)
  } else {
    sendOutput('\nNo node changes needed\n')
  }

  // 2. Remove extras: nodes not in target snapshot (enabled or disabled)
  for (const [key, currentNode] of currentByKey) {
    if (signal?.aborted) break
    if (isManagerNode(currentNode)) continue
    if (!targetByKey.has(key)) {
      if (!isSafePathComponent(currentNode.dirName)) {
        result.failed.push({ id: currentNode.id, error: 'invalid directory name' })
        continue
      }
      try {
        const nodePath = currentNode.enabled
          ? path.join(customNodesDir, currentNode.dirName)
          : path.join(customNodesDir, '.disabled', currentNode.dirName)
        await fs.promises.rm(nodePath, { recursive: true, force: true })
        result.removed.push(currentNode.id)
        sendOutput(`Removed ${currentNode.id}\n`)
      } catch (err) {
        result.failed.push({
          id: currentNode.id,
          error: `remove failed: ${(err as Error).message}`
        })
      }
    }
  }

  // 3. Process target nodes
  const targetList = targetSnapshot.customNodes.filter((n) => !isManagerNode(n))
  const nodesNeedingPostInstall: string[] = []

  for (let i = 0; i < targetList.length; i++) {
    if (signal?.aborted) break
    const targetNode = targetList[i]!
    const key = nodeKey(targetNode)
    const currentNode = currentByKey.get(key)
    const percent = 10 + Math.round((i / targetList.length) * 80)
    sendProgress('restore-nodes', { percent, status: `Processing ${targetNode.id}…` })

    if (!currentNode) {
      // Node not present — install or report
      if (targetNode.type === 'cnr') {
        if (!targetNode.version) {
          result.failed.push({ id: targetNode.id, error: 'no version in snapshot' })
          continue
        }
        if (!isSafePathComponent(targetNode.id)) {
          result.failed.push({ id: targetNode.id, error: 'invalid node ID' })
          continue
        }
        try {
          await installCnrNode(targetNode.id, targetNode.version, customNodesDir, sendOutput)
          result.installed.push(targetNode.id)
          nodesNeedingPostInstall.push(path.join(customNodesDir, targetNode.id))
          if (!targetNode.enabled) {
            await disableNode(customNodesDir, targetNode.id)
          }
        } catch (err) {
          if (signal?.aborted) break
          result.failed.push({ id: targetNode.id, error: (err as Error).message })
        }
      } else if (targetNode.type === 'git') {
        // Phantom entry from an older buggy scan (#1253): a directory recorded
        // with no source at all cannot be restored and never could — skip it
        // instead of failing the whole restore.
        if (!targetNode.url && !targetNode.commit) {
          result.skipped.push(targetNode.id)
          sendOutput(`Skipped ${targetNode.id}: snapshot records no source for it\n`)
          continue
        }
        if (!gitAvailable) {
          result.failed.push({ id: targetNode.id, error: 'git not available' })
          continue
        }
        if (!targetNode.url) {
          result.failed.push({ id: targetNode.id, error: 'no URL in snapshot' })
          continue
        }
        if (!isSafePathComponent(targetNode.dirName)) {
          result.failed.push({ id: targetNode.id, error: 'invalid directory name' })
          continue
        }
        try {
          const dest = path.join(customNodesDir, targetNode.dirName)
          const cloneUrl = rewriteCloneUrl(
            targetNode.url,
            settings.get('useChineseMirrors') === true
          )
          const cloneResult = await gitClone(cloneUrl, dest, sendOutput, signal)
          if (signal?.aborted) {
            await fs.promises.rm(dest, { recursive: true, force: true }).catch(() => {})
            break
          }
          if (cloneResult.exitCode !== 0) {
            result.failed.push({
              id: targetNode.id,
              error: gitFailureMessage('git clone', cloneResult)
            })
            continue
          }
          if (targetNode.commit) {
            const checkoutResult = await gitCheckoutCommit(
              dest,
              targetNode.commit,
              sendOutput,
              signal
            )
            if (signal?.aborted) {
              await fs.promises.rm(dest, { recursive: true, force: true }).catch(() => {})
              break
            }
            if (checkoutResult.exitCode !== 0) {
              // Remove the fresh clone so the failed restore doesn't leave a
              // wrong-commit node behind to be scanned as installed on next boot.
              await fs.promises.rm(dest, { recursive: true, force: true }).catch(() => {})
              result.failed.push({
                id: targetNode.id,
                error: gitFailureMessage('git checkout', checkoutResult)
              })
              continue
            }
          }
          result.installed.push(targetNode.id)
          nodesNeedingPostInstall.push(dest)
          if (!targetNode.enabled) {
            await disableNode(customNodesDir, targetNode.dirName)
          }
        } catch (err) {
          if (signal?.aborted) {
            // Clean up partial clone on abort
            const dest = path.join(customNodesDir, targetNode.dirName)
            await fs.promises.rm(dest, { recursive: true, force: true }).catch(() => {})
            break
          }
          result.failed.push({ id: targetNode.id, error: (err as Error).message })
        }
      } else if (targetNode.type === 'file') {
        result.unreportable.push(targetNode.id)
      }
      continue
    }

    // Node exists — handle enable/disable and version changes
    if (!currentNode.enabled && targetNode.enabled) {
      try {
        await enableNode(customNodesDir, currentNode.dirName)
        result.enabled.push(targetNode.id)
        sendOutput(`Enabled ${targetNode.id}\n`)
      } catch (err) {
        result.failed.push({ id: targetNode.id, error: `enable failed: ${(err as Error).message}` })
        continue
      }
    } else if (currentNode.enabled && !targetNode.enabled) {
      try {
        await disableNode(customNodesDir, currentNode.dirName)
        result.disabled.push(targetNode.id)
        sendOutput(`Disabled ${targetNode.id}\n`)
      } catch (err) {
        result.failed.push({
          id: targetNode.id,
          error: `disable failed: ${(err as Error).message}`
        })
      }
      continue
    }

    // Version/commit changes (only if the node is/will be enabled)
    if (targetNode.enabled || currentNode.enabled) {
      const nodePath = path.join(customNodesDir, currentNode.dirName)

      if (
        targetNode.type === 'cnr' &&
        targetNode.version &&
        currentNode.version !== targetNode.version
      ) {
        try {
          await switchCnrVersion(targetNode.id, targetNode.version, nodePath, sendOutput)
          result.switched.push(targetNode.id)
          nodesNeedingPostInstall.push(nodePath)
        } catch (err) {
          if (signal?.aborted) break
          result.failed.push({ id: targetNode.id, error: (err as Error).message })
        }
      } else if (
        targetNode.type === 'git' &&
        targetNode.commit &&
        currentNode.commit !== targetNode.commit
      ) {
        if (!gitAvailable) {
          result.failed.push({ id: targetNode.id, error: 'git not available' })
        } else {
          const checkoutResult = await gitCheckoutCommit(
            nodePath,
            targetNode.commit,
            sendOutput,
            signal
          )
          if (signal?.aborted) break
          if (checkoutResult.exitCode === 0) {
            result.switched.push(targetNode.id)
            nodesNeedingPostInstall.push(nodePath)
          } else {
            result.failed.push({
              id: targetNode.id,
              error: gitFailureMessage('git checkout', checkoutResult)
            })
          }
        }
      } else {
        result.skipped.push(targetNode.id)
      }
    } else {
      result.skipped.push(targetNode.id)
    }
  }

  // 4. Run post-install scripts for installed/switched nodes
  if (nodesNeedingPostInstall.length > 0 && !signal?.aborted) {
    const uvPath = getActiveUvPath(installation)
    const pythonPath = getActivePythonPath(installation)

    if (pythonPath && fs.existsSync(uvPath)) {
      sendProgress('restore-nodes', { percent: 92, status: 'Installing node dependencies…' })
      for (const nodePath of nodesNeedingPostInstall) {
        if (signal?.aborted) break
        sendOutput(`\nRunning post-install for ${path.basename(nodePath)}…\n`)
        await runPostInstallScripts(
          nodePath,
          uvPath,
          pythonPath,
          installPath,
          sendOutput,
          signal,
          mirrors
        )
      }
    } else {
      sendOutput('⚠ Cannot run post-install scripts: uv or Python environment not found\n')
    }
  }

  // 5. Install manager_requirements.txt from ComfyUI root if present
  {
    const mgrReqPath = path.join(comfyuiDir, 'manager_requirements.txt')
    if (fs.existsSync(mgrReqPath)) {
      const uvPath = getActiveUvPath(installation)
      const pythonPath = getActivePythonPath(installation)

      if (pythonPath && fs.existsSync(uvPath)) {
        sendOutput('\nInstalling manager requirements…\n')
        try {
          const mgrResult = await installFilteredRequirements(
            mgrReqPath,
            uvPath,
            pythonPath,
            installPath,
            '.restore-mgr-reqs.txt',
            sendOutput,
            signal,
            mirrors
          )
          if (mgrResult !== 0) {
            sendOutput(`⚠ manager requirements install exited with code ${mgrResult}\n`)
          }
        } catch (err) {
          sendOutput(`⚠ manager_requirements.txt failed: ${(err as Error).message}\n`)
        }
      }
    }
  }

  sendProgress('restore-nodes', { percent: 100, status: 'Node restore complete' })
  return result
}
