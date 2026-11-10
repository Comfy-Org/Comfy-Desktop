import fs from 'fs'
import path from 'path'
import { execFile, spawn } from 'child_process'
import { getActiveVenvDir, getActiveUvPath } from '../../lib/pythonEnv'
import { getDiskSpace, getDirectorySize } from '../../lib/disk'
import { copyDirWithProgress } from '../../lib/copy'
import { downloadAndExtract, downloadAndExtractMulti } from '../../lib/installer'
import { createCache } from '../../lib/cache'
import { download } from '../../lib/download'
import { extractNested as extract } from '../../lib/extract'
import { renameWithLockRetry } from '../../lib/fsRetry'
import * as settings from '../../settings'
import { findSitePackages, stripPlatform } from './envPaths'
import {
  copyTorchFamily,
  isAmdMultiArchOverlayDist,
  listRocmEcosystemDists,
  removeStaleRocmEntries,
  removeTorchFamilyPackages
} from './torchFamilyFs'
import {
  stackVersionMatches,
  torchLocalTag,
  torchIndexUrlForSource,
  accelBaseForTag
} from './torchStackTypes'
import type { TorchStackEntry } from './torchStackCatalog'
import type { TorchStackPackages, TorchStackSource } from './torchStackTypes'
import type { InstallationRecord } from '../../installations'

const JOURNAL_FILE = '.torch-stack-journal.json'
const BACKUP_SUFFIX = '.torch-backup'
const GC_SUFFIX = '.torch-gc'
const STAGING_DIR = '.torch-stack-tmp'
const EXTRACT_FACTOR = 3
const DISK_MARGIN = 0.1
const IMPORT_PROBE_TIMEOUT_MS = 180_000

interface TorchStackJournal {
  version: 1
  startedAt: number
  stackId: string
}

function journalPath(installPath: string): string {
  return path.join(installPath, JOURNAL_FILE)
}

async function writeJournal(installPath: string, journal: TorchStackJournal): Promise<void> {
  const target = journalPath(installPath)
  const tmp = `${target}.tmp`
  await fs.promises.writeFile(tmp, JSON.stringify(journal, null, 2))
  await fs.promises.rename(tmp, target)
}

export interface TorchStackTools {
  sendProgress: (phase: string, detail: Record<string, unknown>) => void
  sendOutput?: (text: string) => void
  update: (data: Record<string, unknown>) => Promise<unknown>
  signal?: AbortSignal
}

export interface PreparedBundleStack {
  kind: 'bundle'
  srcSite: string
  stagingDir: string
  entry: TorchStackEntry
}

export interface PreparedPipStack {
  kind: 'pip'
  packages: TorchStackPackages
  source: TorchStackSource | null
  indexUrl: string | null
  entry: TorchStackEntry | null
  accelVariant: string | null
}

export type PreparedStack = PreparedBundleStack | PreparedPipStack

export function preparePipStack(
  packages: TorchStackPackages,
  entry: TorchStackEntry | null
): PreparedPipStack {
  const source = entry?.source ?? null
  return {
    kind: 'pip',
    packages,
    source,
    indexUrl: torchIndexUrlForSource(source, packages),
    entry,
    accelVariant: accelBaseForTag(torchLocalTag(packages.torch))
  }
}

export class DiskSpaceError extends Error {
  constructor(
    public readonly requiredBytes: number,
    public readonly freeBytes: number
  ) {
    super(
      `Not enough disk space for a safe PyTorch change: ` +
        `${formatGB(requiredBytes)} required (venv backup + bundle staging), ${formatGB(freeBytes)} free.`
    )
    this.name = 'DiskSpaceError'
  }
}

function formatGB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

const PIP_FALLBACK_STAGING_BYTES = 8 * 1024 ** 3

const AMD_MULTI_ARCH_STAGING_BYTES = 24 * 1024 ** 3

export async function preflightDiskSpace(
  installation: InstallationRecord,
  entry: TorchStackEntry | null,
  signal?: AbortSignal,
  opts?: { staged?: boolean; pipSource?: TorchStackSource | null }
): Promise<{ requiredBytes: number; freeBytes: number }> {
  const venvDir = getActiveVenvDir(installation)
  const venvSize = await getDirectorySize(venvDir, signal)
  const pipEstimate =
    opts?.pipSource?.kind === 'amd-multi-arch-index'
      ? AMD_MULTI_ARCH_STAGING_BYTES
      : PIP_FALLBACK_STAGING_BYTES
  const pendingBytes = entry?.bundle ? entry.bundle.size * (1 + EXTRACT_FACTOR) : pipEstimate
  const stagingBytes = opts?.staged ? 0 : pendingBytes
  const requiredBytes = Math.ceil((venvSize + stagingBytes) * (1 + DISK_MARGIN))
  const { free } = await getDiskSpace(venvDir)
  if (free < requiredBytes) throw new DiskSpaceError(requiredBytes, free)
  return { requiredBytes, freeBytes: free }
}

export async function prepareBundleStack(
  installation: InstallationRecord,
  entry: TorchStackEntry,
  tools: TorchStackTools
): Promise<PreparedBundleStack> {
  const bundle = entry.bundle
  if (!bundle) throw new Error(`stack ${entry.stackId} has no bundle artifact to download`)
  const stagingDir = path.join(installation.installPath, STAGING_DIR)
  await fs.promises.rm(stagingDir, { recursive: true, force: true })
  await fs.promises.mkdir(stagingDir, { recursive: true })

  try {
    const cache = createCache(
      settings.get('cacheDir') as string,
      settings.get('maxCachedDownloads') as number
    )
    const ctx = { sendProgress: tools.sendProgress, download, cache, extract, signal: tools.signal }
    const bundleTag = entry.source.kind === 'comfy-bundle' ? entry.source.bundleTag : entry.stackId

    const files = [{ url: bundle.url, filename: bundle.filename, size: bundle.size }]
    if (files[0]!.filename) {
      await downloadAndExtractMulti(files, stagingDir, `${bundleTag}_${entry.variant}`, ctx)
    } else {
      await downloadAndExtract(bundle.url, stagingDir, `${bundleTag}_${entry.variant}`, ctx)
    }

    const srcSite = findSitePackages(path.join(stagingDir, 'standalone-env'))
    if (!srcSite || !fs.existsSync(srcSite)) {
      throw new Error('Could not locate the PyTorch packages inside the downloaded bundle.')
    }
    return { kind: 'bundle', srcSite, stagingDir, entry }
  } catch (err) {
    await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

function readDistInfoVersion(sitePackages: string, pkg: string): string | null {
  const re = new RegExp(`^${pkg.replace(/-/g, '[-_]')}-(.+?)\\.dist-info$`, 'i')
  try {
    for (const dirEntry of fs.readdirSync(sitePackages)) {
      const m = dirEntry.match(re)
      if (m) return m[1]!
    }
  } catch {}
  return null
}

function versionMatches(installed: string | null, expected: string): boolean {
  if (!installed) return false
  return stackVersionMatches(installed, expected)
}

function runImportProbe(
  pythonPath: string,
  cwd: string,
  packages: TorchStackPackages
): Promise<string | null> {
  const imports = ['torch']
  if (packages.torchvision) imports.push('torchvision')
  if (packages.torchaudio) imports.push('torchaudio')
  const script = `import ${imports.join(', ')}\nimport torch\nt = torch.ones(2) + torch.ones(2)\nassert float(t.sum()) == 4.0\nprint('ok')`
  return new Promise((resolve) => {
    execFile(
      pythonPath,
      ['-c', script],
      { cwd, windowsHide: true, timeout: IMPORT_PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) resolve(stderr ? stderr.slice(-1000) : err.message)
        else resolve(null)
      }
    )
  })
}

function expectedAcceleratorOk(variant: string, sitePackages: string): string | null {
  const base = stripPlatform(variant)
  const wants =
    base === 'nvidia' || base.startsWith('nvidia-')
      ? 'cuda'
      : base === 'amd' || base.startsWith('amd-')
        ? 'hip'
        : base === 'intel-xpu' || base.startsWith('intel-xpu-')
          ? 'xpu'
          : null
  if (!wants) return null
  try {
    const txt = fs.readFileSync(path.join(sitePackages, 'torch', 'version.py'), 'utf-8')
    const m = txt.match(
      new RegExp(`^${wants}\\s*(?::[^=\\n]+)?=\\s*(None|'([^']*)'|"([^"]*)")`, 'm')
    )
    const present = !!m && m[1] !== 'None' && (m[2] ?? m[3] ?? '').trim().length > 0
    return present ? null : `installed torch has no ${wants} support (torch/version.py)`
  } catch {
    return `could not read torch/version.py to confirm ${wants} support`
  }
}

function venvPython(venvDir: string): string {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python3')
}

function venvUv(venvDir: string): string | null {
  const p =
    process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'uv.exe')
      : path.join(venvDir, 'bin', 'uv')
  return fs.existsSync(p) ? p : null
}

async function verifyStack(
  installation: InstallationRecord,
  packages: TorchStackPackages,
  accelVariant: string | null,
  opts?: { expectAbsent?: readonly string[]; amdMultiArch?: boolean }
): Promise<string | null> {
  const venvDir = getActiveVenvDir(installation)
  const site = findSitePackages(venvDir)
  if (!site || !fs.existsSync(site)) return 'venv site-packages not found after swap'

  for (const [pkg, expected] of Object.entries(packages)) {
    if (!expected) continue
    const installed = readDistInfoVersion(site, pkg)
    if (!versionMatches(installed, expected)) {
      return `${pkg} is "${installed ?? 'absent'}" after swap, expected "${expected}"`
    }
  }

  for (const pkg of opts?.expectAbsent ?? []) {
    const installed = readDistInfoVersion(site, pkg)
    if (installed !== null) {
      return `${pkg} is "${installed}" after swap, expected it to be absent`
    }
  }

  if (opts?.amdMultiArch) {
    const overlayErr = amdOverlayCoherenceError(site, packages)
    if (overlayErr) return overlayErr
  }

  if (accelVariant) {
    const accelErr = expectedAcceleratorOk(accelVariant, site)
    if (accelErr) return accelErr
  }

  const pythonPath = venvPython(venvDir)
  if (!fs.existsSync(pythonPath)) return 'venv python not found after swap'
  const probeErr = await runImportProbe(pythonPath, installation.installPath, packages)
  if (probeErr) return `import probe failed: ${probeErr}`
  return null
}

const PIP_FAMILY_OPTIONAL = ['torchvision', 'torchaudio'] as const
const PIP_FAMILY = ['torch', ...PIP_FAMILY_OPTIONAL] as const

export function undeclaredFamilyPackages(
  packages: TorchStackPackages,
  site: string | null
): string[] {
  if (!site) return []
  return PIP_FAMILY_OPTIONAL.filter(
    (pkg) => !packages[pkg] && readDistInfoVersion(site, pkg) !== null
  )
}

export interface PipReconciliationPlan {
  removals: string[]
  expectAbsent: string[]
}

export function planPipReconciliation(
  prepared: Pick<PreparedPipStack, 'packages' | 'source'>,
  site: string | null
): PipReconciliationPlan {
  const removals = [...undeclaredFamilyPackages(prepared.packages, site)]
  const expectAbsent: string[] = PIP_FAMILY_OPTIONAL.filter((pkg) => !prepared.packages[pkg])
  if (!site) return { removals, expectAbsent }

  const rocmDists = listRocmEcosystemDists(site)
  const amdMultiArchTarget = prepared.source?.kind === 'amd-multi-arch-index'
  const leavingMultiArch = !amdMultiArchTarget && rocmDists.some(isAmdMultiArchOverlayDist)
  if (amdMultiArchTarget || leavingMultiArch) {
    removals.push(...rocmDists)
    removals.push(
      ...PIP_FAMILY.filter(
        (pkg) => prepared.packages[pkg] && readDistInfoVersion(site, pkg) !== null
      )
    )
  }
  if (amdMultiArchTarget) {
    for (const pkg of ['triton-rocm', 'pytorch-triton-rocm']) {
      if (readDistInfoVersion(site, pkg) !== null) removals.push(pkg)
      expectAbsent.push(pkg)
    }
  } else if (leavingMultiArch) {
    expectAbsent.push(...rocmDists)
    if (readDistInfoVersion(site, 'triton') !== null) removals.push('triton')
  }
  return { removals: [...new Set(removals)], expectAbsent }
}

export function amdOverlayCoherenceError(
  site: string,
  packages: TorchStackPackages
): string | null {
  let entries: string[]
  try {
    entries = fs.readdirSync(site)
  } catch {
    return null
  }
  for (const entry of entries) {
    const m = entry.match(/^(amd_(torch|torchvision)_device\w*)-(.+)\.dist-info$/i)
    if (!m) continue
    const [, name, kind, version] = m
    const expected = kind!.toLowerCase() === 'torchvision' ? packages.torchvision : packages.torch
    if (!expected)
      return `${name} is "${version}" after swap, but the target stack declares no ${kind}`
    if (
      !stackVersionMatches(version!, expected) ||
      torchLocalTag(version) !== torchLocalTag(expected)
    ) {
      return `${name} is "${version}" after swap, expected "${expected}"`
    }
  }
  return null
}

export function pipInstallSpecs(prepared: PreparedPipStack): string[] {
  const extras = prepared.source?.kind === 'amd-multi-arch-index' ? '[device-all]' : ''
  const specs = [`torch${extras}==${prepared.packages.torch}`]
  if (prepared.packages.torchvision)
    specs.push(`torchvision${extras}==${prepared.packages.torchvision}`)
  if (prepared.packages.torchaudio) specs.push(`torchaudio==${prepared.packages.torchaudio}`)
  return specs
}

export function pipIndexArgs(prepared: Pick<PreparedPipStack, 'source' | 'indexUrl'>): string[] {
  if (!prepared.indexUrl) return []
  if (prepared.source?.kind === 'amd-multi-arch-index') {
    return ['--index-url', 'https://pypi.org/simple', '--extra-index-url', prepared.indexUrl]
  }
  return ['--index-url', prepared.indexUrl]
}

export function runStreamed(
  cmd: string,
  args: string[],
  failMessage: string,
  tools: TorchStackTools
): Promise<void> {
  tools.sendOutput?.(`\n$ ${path.basename(cmd)} ${args.join(' ')}\n`)
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, signal: tools.signal })
    child.stdout.on('data', (d: Buffer) => tools.sendOutput?.(d.toString()))
    child.stderr.on('data', (d: Buffer) => tools.sendOutput?.(d.toString()))
    let failure: Error | null = null
    child.on('error', (err) => {
      failure = err
      if (child.pid === undefined) reject(err)
    })
    child.on('close', (code) => {
      if (failure) reject(failure)
      else if (code === 0) resolve()
      else reject(new Error(`${failMessage} (exit code ${code})`))
    })
  })
}

export async function applyBundleGraft(
  prepared: PreparedBundleStack,
  dstSite: string
): Promise<string[]> {
  await copyTorchFamily(prepared.srcSite, dstSite)
  const familyRemoved = undeclaredFamilyPackages(prepared.entry.packages, dstSite).filter(
    (pkg) => readDistInfoVersion(prepared.srcSite, pkg) === null
  )
  if (familyRemoved.length > 0) {
    await removeTorchFamilyPackages(dstSite, familyRemoved)
  }
  const staleRocm = await removeStaleRocmEntries(prepared.srcSite, dstSite)
  return [...familyRemoved, ...staleRocm]
}

async function runPipTorchInstall(
  installation: InstallationRecord,
  prepared: PreparedPipStack,
  candidateVenv: string,
  backupVenv: string,
  tools: TorchStackTools
): Promise<string[]> {
  const python = venvPython(candidateVenv)
  const activeUv = getActiveUvPath(installation)
  const uv = venvUv(backupVenv) ?? (fs.existsSync(activeUv) ? activeUv : null)
  const pipCmd = (verb: string, args: string[]): [string, string[]] =>
    uv
      ? [uv, ['pip', verb, '--python', python, ...args]]
      : [python, ['-m', 'pip', verb, ...(verb === 'uninstall' ? ['-y'] : []), ...args]]

  const candidateSite = findSitePackages(candidateVenv)
  const plan = planPipReconciliation(prepared, candidateSite)
  if (plan.removals.length > 0) {
    const [cmd, args] = pipCmd('uninstall', plan.removals)
    await runStreamed(cmd, args, 'PyTorch package uninstall failed', tools)
  }

  const specs = pipInstallSpecs(prepared)
  const [cmd, args] = pipCmd('install', [...pipIndexArgs(prepared), ...specs])
  await runStreamed(cmd, args, 'PyTorch package install failed', tools)
  return plan.expectAbsent
}

async function rollback(venvPath: string, backupPath: string): Promise<void> {
  if (fs.existsSync(backupPath)) {
    await fs.promises.rm(venvPath, { recursive: true, force: true })
    await renameWithLockRetry(backupPath, venvPath)
  }
}

export interface TorchStackResult {
  ok: boolean
  message: string
}

export async function applyTorchStackTransaction(
  installation: InstallationRecord,
  prepared: PreparedStack,
  tools: TorchStackTools
): Promise<TorchStackResult> {
  const { entry, packages } =
    prepared.kind === 'bundle'
      ? { entry: prepared.entry, packages: prepared.entry.packages }
      : { entry: prepared.entry, packages: prepared.packages }
  const accelVariant = prepared.kind === 'bundle' ? prepared.entry.variant : prepared.accelVariant
  const installPath = installation.installPath
  const venvPath = getActiveVenvDir(installation)
  const backupPath = venvPath + BACKUP_SUFFIX
  const gcPath = venvPath + GC_SUFFIX
  const priorVerified = installation.lastVerifiedTorchStack ?? null
  const priorObserved = installation.observedTorchStack ?? null

  try {
    if (!fs.existsSync(venvPath)) return { ok: false, message: 'installation venv not found' }
    if (tools.signal?.aborted) return { ok: false, message: 'Cancelled' }

    if (fs.existsSync(backupPath)) {
      return {
        ok: false,
        message: 'a previous PyTorch change did not finish; relaunch the app to recover, then retry'
      }
    }
    if (fs.existsSync(gcPath)) {
      await fs.promises.rm(gcPath, { recursive: true, force: true })
    }

    await writeJournal(installPath, {
      version: 1,
      startedAt: Date.now(),
      stackId: entry ? entry.stackId : `pip:${packages.torch}`
    })

    try {
      await renameWithLockRetry(venvPath, backupPath, tools.signal)

      tools.sendProgress('torch-swap', { percent: -1, status: 'Copying environment…' })
      await copyDirWithProgress(backupPath, venvPath, (copied, total) => {
        const percent = total > 0 ? Math.round((copied / total) * 60) : 0
        tools.sendProgress('torch-swap', {
          percent,
          status: `Copying environment…  ${copied} / ${total}`
        })
      })

      tools.sendProgress('torch-swap', { percent: 65, status: 'Installing PyTorch packages…' })
      let expectAbsent: string[]
      if (prepared.kind === 'bundle') {
        const dstSite = findSitePackages(venvPath)
        if (!dstSite || !fs.existsSync(dstSite))
          throw new Error('could not locate venv site-packages')
        expectAbsent = await applyBundleGraft(prepared, dstSite)
      } else {
        expectAbsent = await runPipTorchInstall(installation, prepared, venvPath, backupPath, tools)
      }

      tools.sendProgress('torch-swap', { percent: 85, status: 'Verifying PyTorch…' })
      const verifyErr = await verifyStack(installation, packages, accelVariant, {
        expectAbsent,
        amdMultiArch: prepared.kind === 'pip' && prepared.source?.kind === 'amd-multi-arch-index'
      })
      if (verifyErr) throw new Error(`verification failed: ${verifyErr}`)

      if (entry) {
        await tools.update({ lastVerifiedTorchStack: entry, observedTorchStack: null })
      } else {
        await tools.update({
          lastVerifiedTorchStack: null,
          observedTorchStack: {
            torchVersion: packages.torch,
            torchvisionVersion: packages.torchvision ?? null,
            torchaudioVersion: packages.torchaudio ?? null,
            observedAt: new Date().toISOString()
          }
        })
      }

      tools.sendProgress('torch-swap', { percent: 95, status: 'Cleaning up…' })
      await renameWithLockRetry(backupPath, gcPath)
    } catch (err) {
      tools.sendOutput?.(
        `\nPyTorch change failed: ${(err as Error).message}\nRestoring previous environment…\n`
      )
      try {
        await rollback(venvPath, backupPath)
        let metadataNote = ''
        try {
          await tools.update({
            lastVerifiedTorchStack: priorVerified,
            observedTorchStack: priorObserved
          })
        } catch (mdErr) {
          metadataNote = ` (stack metadata could not be reset: ${(mdErr as Error).message}; it will be reconciled on next launch)`
        }
        await fs.promises.rm(journalPath(installPath), { force: true }).catch(() => {})
        return {
          ok: false,
          message: `${(err as Error).message} — the previous environment was restored${metadataNote}`
        }
      } catch (rbErr) {
        return {
          ok: false,
          message: `${(err as Error).message} — rollback also failed (${(rbErr as Error).message}); it will be retried on next launch`
        }
      }
    }

    await fs.promises.rm(journalPath(installPath), { force: true }).catch(() => {})
    await fs.promises.rm(gcPath, { recursive: true, force: true }).catch(() => {})
    tools.sendProgress('torch-swap', { percent: 100, status: 'PyTorch updated' })
    return { ok: true, message: `PyTorch ${packages.torch} installed` }
  } finally {
    if (prepared.kind === 'bundle') {
      await fs.promises.rm(prepared.stagingDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export async function recoverTorchStackTransaction(
  installation: InstallationRecord
): Promise<boolean> {
  const installPath = installation.installPath
  const venvPath = getActiveVenvDir(installation)
  const backupPath = venvPath + BACKUP_SUFFIX
  const gcPath = venvPath + GC_SUFFIX

  const staging = path.join(installPath, STAGING_DIR)
  if (fs.existsSync(staging))
    await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {})
  if (fs.existsSync(gcPath))
    await fs.promises.rm(gcPath, { recursive: true, force: true }).catch(() => {})
  await fs.promises.rm(`${journalPath(installPath)}.tmp`, { force: true }).catch(() => {})

  const hasJournal = fs.existsSync(journalPath(installPath))
  const hasBackup = fs.existsSync(backupPath)
  if (!hasJournal && !hasBackup) return false

  if (hasBackup) {
    await rollback(venvPath, backupPath)
  }
  await fs.promises.rm(journalPath(installPath), { force: true }).catch(() => {})
  return hasBackup
}
