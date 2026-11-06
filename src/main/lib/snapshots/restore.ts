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
  target: string | null
  live: string | null
}

export async function protectedPackageDrift(
  installation: InstallationRecord,
  targetPips: Record<string, string>
): Promise<ProtectedDriftEntry[]> {
  const uvPath = getActiveUvPath(installation)
  const pythonPath = getActivePythonPath(installation)
  if (!pythonPath || !fs.existsSync(uvPath)) {
    throw new Error('Python environment or uv not found')
  }
  const live = await pipFreeze(uvPath, pythonPath)
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

function normalizeDistInfoName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '_')
}

function findDistInfoDir(sitePackages: string, packageName: string): string | null {
  const normalized = normalizeDistInfoName(packageName)
  try {
    for (const entry of fs.readdirSync(sitePackages)) {
      if (!entry.endsWith('.dist-info')) continue
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
    await fs.promises.rm(backupDir, { recursive: true, force: true }).catch(() => {})
    throw new Error(`Backup failed for ${failures.length} entry(s): ${failures.join('; ')}`)
  }

  return { dir: backupDir, uncaptured }
}

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
      console.error(`Failed to restore ${entry} from backup:`, (err as Error).message)
      allRestored = false
    }
  }
  return allRestored
}

const DIST_METADATA_SUFFIXES = ['.dist-info', '.egg-info', '.egg-link']

const UNVERSIONED_METADATA_SUFFIXES = new Set(['.egg-link'])

function stemBelongsTo(stem: string, normalizedName: string, versioned: boolean): boolean {
  if (stem === normalizedName) return true
  if (!versioned) return false
  if (!stem.startsWith(`${normalizedName}_`)) return false
  return /^\d/.test(stem.slice(normalizedName.length + 1))
}

export function preexistingOnDisk(sitePackages: string, packageNames: string[]): string[] {
  if (packageNames.length === 0) return []
  let entries: string[]
  try {
    entries = fs.readdirSync(sitePackages)
  } catch {
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

  sendProgress('restore', { percent: 5, status: 'Analyzing current environment…' })
  sendOutput('\nAnalyzing pip packages…\n')
  const currentPips = await pipFreeze(uvPath, pythonPath)
  const targetPips = targetSnapshot.pipPackages
  const currentCount = Object.keys(currentPips).length
  const targetCount = Object.keys(targetPips).length
  sendOutput(`Found ${currentCount} current package(s), target snapshot has ${targetCount}\n`)

  const toInstall: Array<{ name: string; version: string }> = []
  const toRemove: string[] = []

  for (const [name, version] of Object.entries(targetPips)) {
    if (isProtectedPackage(name)) {
      if (!(name in currentPips) || currentPips[name] !== version) {
        result.protectedSkipped.push(name)
      }
      continue
    }
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

  const newPkgNames = toInstall
    .filter((p) => !result.changed.some((c) => c.name === p.name))
    .map((p) => p.name)

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

  sendProgress('restore', { percent: 10, status: 'Creating backup of affected packages…' })
  let envDir = getActiveVenvDir(installation)
  let sitePackages = findSitePackages(envDir)
  if (!sitePackages) {
    envDir = path.join(installPath, 'envs', 'default')
    sitePackages = findSitePackages(envDir)
  }
  if (!sitePackages) {
    throw new Error('Could not locate site-packages directory')
  }

  const alreadyInstalled = preexistingOnDisk(sitePackages, newPkgNames)
  const alreadyInstalledSet = new Set(alreadyInstalled)
  const revertUninstall = newPkgNames.filter((name) => !alreadyInstalledSet.has(name))
  if (alreadyInstalled.length > 0) {
    sendOutput(
      `Note: ${alreadyInstalled.length} package(s) planned as new are already installed on disk; ` +
        `a revert will leave them in place.\n`
    )
  }

  const packagesToBackup = [
    ...new Set([
      ...toInstall.filter((p) => p.name in currentPips).map((p) => p.name),
      ...alreadyInstalled,
      ...toRemove
    ])
  ]

  let backupDir: string | null = null
  let keepBackup = false
  let uncapturedByBackup: string[] = []
  if (packagesToBackup.length > 0) {
    const backup = await createTargetedBackup(sitePackages, packagesToBackup)
    backupDir = backup.dir
    uncapturedByBackup = backup.uncaptured
  }

  let mutationAttempted = false

  try {
    if (toInstall.length > 0 && !signal?.aborted) {
      mutationAttempted = true
      const totalOps = toInstall.length + toRemove.length
      sendProgress('restore', { percent: 20, status: `Installing ${toInstall.length} package(s)…` })

      const specs = toInstall.map((p) => `${p.name}==${p.version}`)
      const indexArgs = getPipIndexArgs(mirrors?.pypiMirror, mirrors?.useChineseMirrors)

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
        complete = false
        sendOutput(
          `⚠ No backup was captured for ${uncapturedByBackup.length} package(s); ` +
            `their pre-restore state could not be put back: ${uncapturedByBackup.join(', ')}\n`
        )
      }

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
    if (backupDir) {
      sendOutput(`\n⚠ Restore failed: ${(err as Error).message}\nReverting from backup…\n`)
      if (!(await restoreFromBackup(backupDir, sitePackages))) keepBackup = true
    }
    throw err
  } finally {
    if (backupDir && keepBackup) {
      sendOutput(`\nPre-restore package files were kept at ${backupDir}\n`)
    } else if (backupDir) {
      await fs.promises.rm(backupDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  return result
}

export function describePackageRevert(revert: RestoreRevertOutcome | undefined): string {
  if (!revert) return 'The state of the package changes is unknown — see the log for details.'
  if (!revert.complete)
    return 'Some package changes could not be reverted — see the log for details.'
  if (
    revert.uninstalled.length === 0 &&
    !revert.restoredFromBackup &&
    revert.keptPreexisting.length === 0
  )
    return 'No package changes were applied.'
  return 'The package changes this restore made were reverted.'
}

export interface RequirementsRepairResult {
  changed: Array<{ name: string; from: string | null; to: string }>
  errors: string[]
}

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

  sendProgress('restore-nodes', { percent: 5, status: 'Scanning custom nodes…' })
  sendOutput('Scanning current custom nodes…\n')
  const currentNodes = await scanCustomNodes(comfyuiDir)
  const currentByKey = new Map(currentNodes.map((n) => [nodeKey(n), n]))
  const targetByKey = new Map(targetSnapshot.customNodes.map((n) => [nodeKey(n), n]))
  sendOutput(
    `Found ${currentNodes.length} current node(s), target snapshot has ${targetSnapshot.customNodes.length}\n`
  )

  const needsGit = targetSnapshot.customNodes.some(
    (n) =>
      n.type === 'git' &&
      (!currentByKey.has(nodeKey(n)) || currentByKey.get(nodeKey(n))?.commit !== n.commit)
  )
  const gitAvailable = needsGit ? await isGitAvailable() : false
  if (needsGit && !gitAvailable) {
    sendOutput('⚠ git is not available in PATH — git node operations will be skipped\n')
  }

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
