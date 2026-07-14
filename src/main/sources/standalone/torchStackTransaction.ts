/**
 * Journaled, whole-venv transaction for swapping the PyTorch stack.
 *
 * Guarantee: from the moment mutation starts there is always exactly one
 * complete, known-good venv on disk — either the untouched backup (until the
 * new venv verifies) or the verified target. `uv`/file copies are only the
 * mutation mechanism; the transaction boundary is the venv directory rename.
 *
 * Sequence:
 *   1. disk preflight (hard gate — nothing is touched on failure)
 *   2. write journal
 *   3. rename .venv → .venv.torch-backup   (atomic, instant)
 *   4. copy backup → .venv                  (slow; backup stays pristine)
 *   5. mutate the copy (bundle torch-family swap)
 *   6. verify (exact tuple + import probe + accelerator evidence)
 *   7. persist lastVerifiedTorchStack
 *   8. delete backup + journal
 *
 * Failure or process death in 4–6: delete the candidate, rename the backup
 * back. `recoverTorchStackTransaction` performs the same recovery at launch
 * when a journal is found.
 */
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { getActiveVenvDir, getVenvPythonPath } from '../../lib/pythonEnv'
import { getDiskSpace, getDirectorySize } from '../../lib/disk'
import { copyDirWithProgress } from '../../lib/copy'
import { downloadAndExtract, downloadAndExtractMulti } from '../../lib/installer'
import { createCache } from '../../lib/cache'
import { download } from '../../lib/download'
import { extractNested as extract } from '../../lib/extract'
import * as settings from '../../settings'
import { findSitePackages, stripPlatform } from './envPaths'
import { copyTorchFamily } from './torchRepair'
import type { TorchStackEntry } from './torchStackCatalog'
import type { TorchStackPackages } from './torchStackTypes'
import type { InstallationRecord } from '../../installations'

const JOURNAL_FILE = '.torch-stack-journal.json'
const BACKUP_SUFFIX = '.torch-backup'
const STAGING_DIR = '.torch-stack-tmp'
/** Compressed → extracted size headroom for the bundle staging estimate. */
const EXTRACT_FACTOR = 3
/** Safety margin on the whole disk requirement. */
const DISK_MARGIN = 0.1
const IMPORT_PROBE_TIMEOUT_MS = 180_000

interface TorchStackJournal {
  version: 1
  startedAt: number
  stackId: string
  venvPath: string
  backupPath: string
}

function journalPath(installPath: string): string {
  return path.join(installPath, JOURNAL_FILE)
}

async function readJournal(installPath: string): Promise<TorchStackJournal | null> {
  try {
    const raw = JSON.parse(await fs.promises.readFile(journalPath(installPath), 'utf-8')) as TorchStackJournal
    if (raw.version !== 1 || typeof raw.venvPath !== 'string' || typeof raw.backupPath !== 'string') return null
    return raw
  } catch {
    return null
  }
}

export interface TorchStackTools {
  sendProgress: (phase: string, detail: Record<string, unknown>) => void
  sendOutput?: (text: string) => void
  update: (data: Record<string, unknown>) => Promise<unknown>
  signal?: AbortSignal
}

export interface PreparedStack {
  /** site-packages of the extracted bundle env — the stack payload source. */
  srcSite: string
  /** Staging dir to clean up after the transaction. */
  stagingDir: string
  entry: TorchStackEntry
}

export class DiskSpaceError extends Error {
  constructor(
    public readonly requiredBytes: number,
    public readonly freeBytes: number,
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

/**
 * Hard preflight gate: measured venv size (the whole-venv copy) + download +
 * extraction staging + margin, checked on the volume hosting the venv.
 * Measures the real venv (walk), never a metadata estimate.
 */
export async function preflightDiskSpace(
  installation: InstallationRecord,
  entry: TorchStackEntry,
  signal?: AbortSignal,
): Promise<{ requiredBytes: number; freeBytes: number }> {
  const venvDir = getActiveVenvDir(installation)
  const venvSize = await getDirectorySize(venvDir, signal)
  const stagingBytes = entry.bundle.size * (1 + EXTRACT_FACTOR)
  const requiredBytes = Math.ceil((venvSize + stagingBytes) * (1 + DISK_MARGIN))
  const { free } = await getDiskSpace(venvDir)
  if (free < requiredBytes) throw new DiskSpaceError(requiredBytes, free)
  return { requiredBytes, freeBytes: free }
}

/**
 * Acquisition adapter for `comfy-bundle` stacks: download (through the shared
 * download cache) and extract into a staging dir under the install path (same
 * volume as the venv). Never touches the venv.
 */
export async function prepareBundleStack(
  installation: InstallationRecord,
  entry: TorchStackEntry,
  tools: TorchStackTools,
): Promise<PreparedStack> {
  const stagingDir = path.join(installation.installPath, STAGING_DIR)
  await fs.promises.rm(stagingDir, { recursive: true, force: true })
  await fs.promises.mkdir(stagingDir, { recursive: true })

  const cache = createCache(settings.get('cacheDir') as string, settings.get('maxCachedDownloads') as number)
  const ctx = { sendProgress: tools.sendProgress, download, cache, extract, signal: tools.signal }
  const bundleTag = entry.source.kind === 'comfy-bundle' ? entry.source.bundleTag : entry.stackId

  const files = [{ url: entry.bundle.url, filename: entry.bundle.filename, size: entry.bundle.size }]
  if (files[0]!.filename) {
    await downloadAndExtractMulti(files, stagingDir, `${bundleTag}_${entry.variant}`, ctx)
  } else {
    await downloadAndExtract(entry.bundle.url, stagingDir, `${bundleTag}_${entry.variant}`, ctx)
  }

  const srcSite = findSitePackages(path.join(stagingDir, 'standalone-env'))
  if (!srcSite || !fs.existsSync(srcSite)) {
    await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    throw new Error('Could not locate the PyTorch packages inside the downloaded bundle.')
  }
  return { srcSite, stagingDir, entry }
}

function readDistInfoVersion(sitePackages: string, pkg: string): string | null {
  const re = new RegExp(`^${pkg}-(.+?)\\.dist-info$`, 'i')
  try {
    for (const dirEntry of fs.readdirSync(sitePackages)) {
      const m = dirEntry.match(re)
      if (m) return m[1]!
    }
  } catch {
    /* ignore */
  }
  return null
}

/** dist-info version strings can carry a local tag the R2 metadata omits
 *  (e.g. `2.10.0+cu128` vs `2.10.0`); compare on the public version. */
function versionMatches(installed: string | null, expected: string): boolean {
  if (!installed) return false
  const pub = (v: string): string => (v.includes('+') ? v.slice(0, v.indexOf('+')) : v)
  return pub(installed) === pub(expected)
}

function runImportProbe(pythonPath: string, cwd: string, packages: TorchStackPackages): Promise<string | null> {
  const imports = ['torch']
  if (packages.torchvision) imports.push('torchvision')
  if (packages.torchaudio) imports.push('torchaudio')
  const script = `import ${imports.join(', ')}\nimport torch\nt = torch.ones(2) + torch.ones(2)\nassert float(t.sum()) == 4.0\nprint('ok')`
  return new Promise((resolve) => {
    execFile(
      pythonPath, ['-c', script],
      { cwd, windowsHide: true, timeout: IMPORT_PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) resolve(stderr ? stderr.slice(-1000) : err.message)
        else resolve(null)
      }
    )
  })
}

/** Backend evidence expected per vendor variant, read from torch/version.py.
 *  CPU and MPS builds carry no accelerator fields, so nothing to assert. */
function expectedAcceleratorOk(variant: string, sitePackages: string): string | null {
  const base = stripPlatform(variant)
  const wants = base === 'nvidia' || base.startsWith('nvidia-') ? 'cuda'
    : base === 'amd' || base.startsWith('amd-') ? 'hip'
    : base === 'intel-xpu' || base.startsWith('intel-xpu-') ? 'xpu'
    : null
  if (!wants) return null
  try {
    const txt = fs.readFileSync(path.join(sitePackages, 'torch', 'version.py'), 'utf-8')
    const m = txt.match(new RegExp(`^${wants}\\s*(?::[^=\\n]+)?=\\s*(None|'([^']*)'|"([^"]*)")`, 'm'))
    const present = !!m && m[1] !== 'None' && ((m[2] ?? m[3] ?? '').trim()).length > 0
    return present ? null : `installed torch has no ${wants} support (torch/version.py)`
  } catch {
    return `could not read torch/version.py to confirm ${wants} support`
  }
}

async function verifyStack(
  installation: InstallationRecord,
  entry: TorchStackEntry,
): Promise<string | null> {
  const venvDir = getActiveVenvDir(installation)
  const site = findSitePackages(venvDir)
  if (!site || !fs.existsSync(site)) return 'venv site-packages not found after swap'

  for (const [pkg, expected] of Object.entries(entry.packages)) {
    if (!expected) continue
    const installed = readDistInfoVersion(site, pkg)
    if (!versionMatches(installed, expected)) {
      return `${pkg} is "${installed ?? 'absent'}" after swap, expected "${expected}"`
    }
  }

  const accelErr = expectedAcceleratorOk(entry.variant, site)
  if (accelErr) return accelErr

  const pythonPath = getVenvPythonPath(installation.installPath)
  if (fs.existsSync(pythonPath)) {
    const probeErr = await runImportProbe(pythonPath, installation.installPath, entry.packages)
    if (probeErr) return `import probe failed: ${probeErr}`
  }
  return null
}

async function rollback(venvPath: string, backupPath: string): Promise<void> {
  if (fs.existsSync(backupPath)) {
    await fs.promises.rm(venvPath, { recursive: true, force: true })
    await fs.promises.rename(backupPath, venvPath)
  }
}

export interface TorchStackResult {
  ok: boolean
  message: string
}

/**
 * Apply a prepared stack to the installation's venv under the journaled
 * whole-venv transaction. On success persists `lastVerifiedTorchStack`.
 * On any failure the original venv is restored intact.
 *
 * Not cancellable once the venv rename has happened — the signal is only
 * honoured before mutation starts.
 */
export async function applyTorchStackTransaction(
  installation: InstallationRecord,
  prepared: PreparedStack,
  tools: TorchStackTools,
): Promise<TorchStackResult> {
  const { entry } = prepared
  const installPath = installation.installPath
  const venvPath = getActiveVenvDir(installation)
  const backupPath = venvPath + BACKUP_SUFFIX

  if (!fs.existsSync(venvPath)) return { ok: false, message: 'installation venv not found' }
  if (tools.signal?.aborted) return { ok: false, message: 'Cancelled' }

  // Refuse to start over the debris of a previous run (recovery owns that).
  if (fs.existsSync(backupPath)) {
    return { ok: false, message: 'a previous PyTorch change did not finish; relaunch the app to recover, then retry' }
  }

  const journal: TorchStackJournal = {
    version: 1,
    startedAt: Date.now(),
    stackId: entry.stackId,
    venvPath,
    backupPath,
  }
  await fs.promises.writeFile(journalPath(installPath), JSON.stringify(journal, null, 2))

  try {
    // 3. Move the live venv aside — from here the backup is the good copy.
    await fs.promises.rename(venvPath, backupPath)

    // 4. Rebuild the canonical venv path as a copy of the backup.
    tools.sendProgress('torch-swap', { percent: -1, status: 'Copying environment…' })
    await copyDirWithProgress(backupPath, venvPath, (copied, total) => {
      const percent = total > 0 ? Math.round((copied / total) * 60) : 0
      tools.sendProgress('torch-swap', { percent, status: `Copying environment…  ${copied} / ${total}` })
    })

    // 5. Swap the torch-family payload inside the copy.
    tools.sendProgress('torch-swap', { percent: 65, status: 'Installing PyTorch packages…' })
    const dstSite = findSitePackages(venvPath)
    if (!dstSite || !fs.existsSync(dstSite)) throw new Error('could not locate venv site-packages')
    await copyTorchFamily(prepared.srcSite, dstSite)

    // 6. Verify before committing.
    tools.sendProgress('torch-swap', { percent: 85, status: 'Verifying PyTorch…' })
    const verifyErr = await verifyStack(installation, entry)
    if (verifyErr) throw new Error(`verification failed: ${verifyErr}`)

    // 7. Persist the verified stack ref (with acquisition info for repair).
    await tools.update({ lastVerifiedTorchStack: entry, observedTorchStack: null })

    // 8. Commit: drop backup + journal.
    tools.sendProgress('torch-swap', { percent: 95, status: 'Cleaning up…' })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.rm(journalPath(installPath), { force: true })
    tools.sendProgress('torch-swap', { percent: 100, status: 'PyTorch updated' })
    return { ok: true, message: `PyTorch ${entry.packages.torch} installed` }
  } catch (err) {
    tools.sendOutput?.(`\nPyTorch change failed: ${(err as Error).message}\nRestoring previous environment…\n`)
    try {
      await rollback(venvPath, backupPath)
      await fs.promises.rm(journalPath(installPath), { force: true })
      return { ok: false, message: `${(err as Error).message} — the previous environment was restored` }
    } catch (rbErr) {
      // Leave the journal in place: launch-time recovery retries the rollback.
      return {
        ok: false,
        message: `${(err as Error).message} — rollback also failed (${(rbErr as Error).message}); it will be retried on next launch`,
      }
    }
  } finally {
    await fs.promises.rm(prepared.stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Launch-time recovery: if a journal exists, a PyTorch change died mid-flight.
 * The backup (when present) is authoritative — the candidate venv may be a
 * partial copy or partially-swapped. Restores the backup and clears the
 * journal. When no backup exists the rename never happened (or the commit
 * completed), so only the journal is stale.
 */
export async function recoverTorchStackTransaction(installation: InstallationRecord): Promise<boolean> {
  const installPath = installation.installPath
  const journal = await readJournal(installPath)
  // Also sweep staging debris from a hard kill during prepare.
  const staging = path.join(installPath, STAGING_DIR)
  if (fs.existsSync(staging)) await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {})
  if (!journal) return false

  try {
    if (fs.existsSync(journal.backupPath)) {
      await rollback(journal.venvPath, journal.backupPath)
    }
    await fs.promises.rm(journalPath(installPath), { force: true })
    return true
  } catch (err) {
    console.warn('PyTorch stack transaction recovery failed:', err)
    return false
  }
}
