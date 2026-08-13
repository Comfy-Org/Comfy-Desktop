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
 *   5. mutate the copy (bundle torch-family graft, or pip install from the
 *      derived index for adopted installs)
 *   6. verify (exact tuple + import probe + accelerator evidence)
 *   7. persist lastVerifiedTorchStack
 *   8. commit: rename backup → .venv.torch-gc (atomic), then best-effort
 *      delete journal + gc dir
 *
 * Failure or process death in 4–7: delete the candidate, rename the backup
 * back. `recoverTorchStackTransaction` performs the same recovery at launch
 * whenever the backup dir exists; a leftover gc dir or journal without a
 * backup is post-commit debris and only swept.
 */
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
/** Post-commit trash path for the old venv: renaming the backup here IS the
 *  commit point (atomic), so a failed/killed deletion can never be confused
 *  with a rollback-eligible backup. */
const GC_SUFFIX = '.torch-gc'
const STAGING_DIR = '.torch-stack-tmp'
/** Compressed → extracted size headroom for the bundle staging estimate. */
const EXTRACT_FACTOR = 3
/** Safety margin on the whole disk requirement. */
const DISK_MARGIN = 0.1
const IMPORT_PROBE_TIMEOUT_MS = 180_000

/** Informational only — recovery never trusts paths read from disk; it
 *  derives them from the installation record. */
interface TorchStackJournal {
  version: 1
  startedAt: number
  stackId: string
}

function journalPath(installPath: string): string {
  return path.join(installPath, JOURNAL_FILE)
}

async function writeJournal(installPath: string, journal: TorchStackJournal): Promise<void> {
  // Atomic write (temp + rename) so a kill mid-write can't leave a torn file.
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

/** Bundle-acquired payload: torch-family packages grafted from an extracted
 *  standalone-env bundle. Used for managed (bundle-built) installs. */
export interface PreparedBundleStack {
  kind: 'bundle'
  /** site-packages of the extracted bundle env — the stack payload source. */
  srcSite: string
  /** Staging dir to clean up after the transaction. */
  stagingDir: string
  entry: TorchStackEntry
}

/** pip-acquired payload: exact versions installed from the derived index into
 *  the candidate venv. Used for adopted (pip-built) installs, whose venv the
 *  bundle payload was never built for — pip resolves wheels against the
 *  venv's actual Python instead. */
export interface PreparedPipStack {
  kind: 'pip'
  /** Exact versions to install; local tags (`+cu121`) are kept so the index
   *  serves the exact same builds. */
  packages: TorchStackPackages
  /** Acquisition source of the target stack; drives index selection and the
   *  AMD-multi-arch-specific install shape ([device-all] extras, stale SDK
   *  cleanup). Null for an observed-tuple restore (tag-derived index only). */
  source: TorchStackSource | null
  /** null → default PyPI. */
  indexUrl: string | null
  /** Catalog identity to persist as verified on success; null for an
   *  observed-tuple restore (persisted as observed instead). */
  entry: TorchStackEntry | null
  /** Variant base expected for accelerator verification ('nvidia' etc.). */
  accelVariant: string | null
}

export type PreparedStack = PreparedBundleStack | PreparedPipStack

/**
 * Build the pip payload for a stack change on a pip-managed (adopted) venv.
 * No download happens here — wheels are fetched by pip inside the
 * transaction. `entry` carries the catalog identity when the target is a
 * managed stack; `packages` alone drives an observed-tuple restore.
 */
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

/** Staging estimate for a pip-applied change with no catalog size to go by
 *  (observed-tuple restores): wheel downloads + unpacked payload for the
 *  largest realistic stack (CUDA torch). Deliberately conservative. */
const PIP_FALLBACK_STAGING_BYTES = 8 * 1024 ** 3

/** Staging estimate for an AMD multi-arch pip apply. The [device-all] extras
 *  pull per-architecture device wheels for every supported GPU plus the
 *  rocm-sdk core/libraries/device packages — roughly 7 GB of downloads
 *  unpacking to ~15 GB of installed payload. Conservative, like the generic
 *  pip estimate. */
const AMD_MULTI_ARCH_STAGING_BYTES = 24 * 1024 ** 3

/**
 * Hard preflight gate: measured venv size (the whole-venv copy) + download +
 * extraction staging + margin, checked on the volume hosting the venv.
 * Measures the real venv (walk), never a metadata estimate.
 *
 * `entry` sizes the pending payload; pass null for pip applies (observed-
 * tuple restores, adopted installs, index-served stacks) or an entry without
 * a bundle — both charge a conservative fixed estimate instead. Pip applies
 * should pass the target's source as `pipSource`: an AMD multi-arch apply
 * stages far more than the generic estimate covers. Pass `staged: true` for
 * the re-check after a bundle is already downloaded and extracted: the
 * staging space is then occupied, not pending, so charging it again would
 * double-book the bundle and reject safe installs.
 */
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

/**
 * Acquisition adapter for `comfy-bundle` stacks: download (through the shared
 * download cache) and extract into a staging dir under the install path (same
 * volume as the venv). Never touches the venv.
 */
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

  // This function owns the staging dir until it returns: any throw (download,
  // extract, missing site-packages) removes it so no caller path can leak a
  // multi-GB directory.
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
  // dist-info dir names carry the PEP 503 normalized name (`rocm-sdk-core`
  // → `rocm_sdk_core-7.2.1.dist-info`), so hyphens match either spelling.
  const re = new RegExp(`^${pkg.replace(/-/g, '[-_]')}-(.+?)\\.dist-info$`, 'i')
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

/** Tag-aware version check (see `stackVersionMatches`): local tags must
 *  match when both sides carry one — `2.10.0+cu128` after a swap that
 *  promised `2.10.0+cu130` is a failure, not a match — but either side may
 *  legitimately omit the tag (older R2 metadata, PyPI/mac builds). */
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

/** Backend evidence expected per vendor variant, read from torch/version.py.
 *  CPU and MPS builds carry no accelerator fields, so nothing to assert. */
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

/** Interpreter inside a venv dir. Unlike `getVenvPythonPath` this works on
 *  the ACTIVE venv (adopted installs live at `<adoptedBaseDir>/.venv`, not
 *  `<installPath>/ComfyUI/.venv`). */
function venvPython(venvDir: string): string {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python3')
}

/** uv binary inside a venv dir (Legacy Desktop pip-installs uv into its
 *  venv); null when absent. */
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

  // Packages the target tuple declares absent must actually be gone — a
  // leftover torchvision built against a different torch would import-crash
  // or silently misbehave later.
  for (const pkg of opts?.expectAbsent ?? []) {
    const installed = readDistInfoVersion(site, pkg)
    if (installed !== null) {
      return `${pkg} is "${installed}" after swap, expected it to be absent`
    }
  }

  // Multi-arch AMD targets: every device-overlay dist must version-track the
  // core tuple (a stale overlay of another minor claims a payload inside
  // torch/ that no longer exists).
  if (opts?.amdMultiArch) {
    const overlayErr = amdOverlayCoherenceError(site, packages)
    if (overlayErr) return overlayErr
  }

  if (accelVariant) {
    const accelErr = expectedAcceleratorOk(accelVariant, site)
    if (accelErr) return accelErr
  }

  // A candidate with valid dist-info but no interpreter must never commit.
  const pythonPath = venvPython(venvDir)
  if (!fs.existsSync(pythonPath)) return 'venv python not found after swap'
  const probeErr = await runImportProbe(pythonPath, installation.installPath, packages)
  if (probeErr) return `import probe failed: ${probeErr}`
  return null
}

/** Torch-family packages the pip path must reconcile even when the target
 *  tuple omits them. */
const PIP_FAMILY_OPTIONAL = ['torchvision', 'torchaudio'] as const
/** The full core tuple a pip stack can declare. */
const PIP_FAMILY = ['torch', ...PIP_FAMILY_OPTIONAL] as const

/** Family packages installed in `site` but not declared by the tuple — the
 *  pip path must remove them (a torchvision built against a different torch
 *  would break at import), and verification asserts they stayed gone. */
export function undeclaredFamilyPackages(
  packages: TorchStackPackages,
  site: string | null
): string[] {
  if (!site) return []
  return PIP_FAMILY_OPTIONAL.filter(
    (pkg) => !packages[pkg] && readDistInfoVersion(site, pkg) !== null
  )
}

/**
 * Reconciliation plan for a pip stack apply. pip only replaces distributions
 * the target dependency tree references, so packages tied to the outgoing
 * stack's acquisition family must be uninstalled explicitly, and
 * verification must know which of them may not reappear.
 *
 * - Entering or staying in the AMD multi-arch family: every installed
 *   ROCm-ecosystem dist is uninstalled first. The target's [device-all]
 *   extras reinstall the ones it needs at coherent versions; without the
 *   sweep a minor-to-minor switch leaves device overlays of the previous
 *   minor behind (dist-info claiming a torch payload that no longer exists),
 *   and a switch from the retired repo.radeon.com "universal" method leaves
 *   stale SDK DLLs shadowing the wheel-provided runtime. AMD's torch depends
 *   on its own `triton` build, so a pytorch.org `triton-rocm` must go too
 *   and stay gone.
 * - Leaving the multi-arch family (overlay dists present, non-multi-arch
 *   target): the whole ecosystem plus AMD's `triton` build is swept, and no
 *   ecosystem dist may survive verification - no target outside the family
 *   references any of them. `triton` itself is not asserted absent: some
 *   targets legitimately depend on a triton build of their own.
 */
export interface PipReconciliationPlan {
  /** Distributions to uninstall before the target install. */
  removals: string[]
  /** Distributions verification must find absent after the install. */
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
    // pip/uv treat an installed wheel of the requested version as satisfied
    // regardless of which index supplied it, so a same-version cross-index
    // switch would keep the other family's core wheels. Force the reinstall
    // by removing every installed core dist the target declares.
    removals.push(
      ...PIP_FAMILY.filter(
        (pkg) => prepared.packages[pkg] && readDistInfoVersion(site, pkg) !== null
      )
    )
  }
  if (amdMultiArchTarget) {
    // pytorch.org ROCm ships its triton build as `triton-rocm` (older
    // stacks: `pytorch-triton-rocm`); AMD's torch depends on its own
    // `triton`, so both upstream names must go and stay gone.
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

/** Multi-arch AMD device-overlay dists must version-track the core tuple: an
 *  `amd-torch-device-*` left at a previous version means its payload inside
 *  torch/ was built against a different torch and fails at kernel dispatch
 *  rather than import. dist-info dir names normalize '-' to '_' and never
 *  contain '-' in the name part, so the first '-' splits name from version. */
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
    // Strict comparison including the local tag: AMD overlay wheels always
    // carry the full core version, so a missing/foreign tag is incoherent
    // even though stackVersionMatches tolerates one-sided tags elsewhere.
    if (
      !stackVersionMatches(version!, expected) ||
      torchLocalTag(version) !== torchLocalTag(expected)
    ) {
      return `${name} is "${version}" after swap, expected "${expected}"`
    }
  }
  return null
}

/** pip requirement specs for a prepared pip stack. AMD multi-arch torch and
 *  torchvision wheels are thin meta-packages: the [device-all] extra pulls
 *  the per-architecture ROCm device libraries, and a bare pin would install
 *  a torch that cannot use any GPU. torchaudio publishes no such extra. */
export function pipInstallSpecs(prepared: PreparedPipStack): string[] {
  const extras = prepared.source?.kind === 'amd-multi-arch-index' ? '[device-all]' : ''
  const specs = [`torch${extras}==${prepared.packages.torch}`]
  if (prepared.packages.torchvision)
    specs.push(`torchvision${extras}==${prepared.packages.torchvision}`)
  if (prepared.packages.torchaudio) specs.push(`torchaudio==${prepared.packages.torchaudio}`)
  return specs
}

/** Index arguments for the install step. AMD multi-arch tuples need BOTH
 *  indexes: AMD's serves only the ROCm/torch family, plain dependencies
 *  (sympy, jinja2, ...) come from default PyPI. AMD must be the EXTRA
 *  index: uv gives --extra-index-url priority over --index-url and its
 *  default first-index strategy limits each package to the first index
 *  that carries it, so with PyPI as the extra the torch project would
 *  resolve against PyPI and the +rocm pins would fail. With AMD as the
 *  extra, the torch family pins to AMD's index and everything else falls
 *  through to PyPI; pip merges candidates from both indexes and only AMD's
 *  can serve the pinned local tags, so the order suits it too. */
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
    // Settle only once the process has actually exited: rejecting on 'error'
    // (an abort) while the child is still dying would let rollback race a
    // live pip/uv holding locks inside the venv it is about to replace.
    // 'close' always follows for a spawned child; only a spawn failure
    // (no pid) never emits it.
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

/**
 * Bundle-path venv mutation: graft the bundle's torch-family payload into the
 * candidate site, then remove survivors the bundle does not ship.
 *
 * The graft only replaces packages the bundle ships, so two kinds of
 * survivors must be swept afterwards:
 * - Optional family packages the target omits (e.g. the previous stack's
 *   torchvision, built against the old torch) would break at import.
 *   Ship-list is the bundle itself, not the catalog tuple: a package the
 *   bundle ships stays even if the tuple metadata omits it.
 * - ROCm-ecosystem packages an AMD multi-arch stack leaves behind
 *   (rocm-sdk device/library dists, AMD's device-overlay dist-infos): their
 *   lying dist-info beside the bundle's own SDK makes rocm_sdk library
 *   discovery fail at import on a universal AMD target.
 *
 * Returns the removed package names so verification can assert they stayed
 * gone. Operates on the transaction's candidate copy, never the live venv.
 */
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

/**
 * Mutate the candidate venv to the exact torch tuple: uninstall family
 * packages the tuple omits, then install the declared versions from the
 * derived index. Runs a uv OUTSIDE the candidate venv (never the
 * candidate's own — its binary must not be locked/replaced mid-mutation):
 * the pristine backup's uv on adopted installs (Legacy Desktop pip-installs
 * uv into its venv), the standalone-env uv on managed installs (their bare
 * venvs carry no uv). Falls back to the candidate's `python -m pip`.
 * Streams output to the logs panel.
 *
 * Returns the distributions verification must assert absent (see
 * `planPipReconciliation`).
 */
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

/** Windows releases directory handles a beat after the owning process dies
 *  (the ComfyUI tree is killed via fire-and-forget `taskkill /T`, and AV or
 *  indexer scans pile on), so the whole-venv renames can hit a transient
 *  EPERM/EACCES/EBUSY. Retry with backoff; once the handles drop, the
 *  rename is instant. */
const RENAME_LOCK_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_RETRY_TOTAL_MS = 30_000

/** The signal is only passed for the pre-mutation rename (venv -> backup):
 *  until that rename succeeds nothing has been touched, so aborting there is
 *  a clean cancel. Rollback and commit renames must never be cancellable. */
export async function renameWithLockRetry(
  src: string,
  dst: string,
  signal?: AbortSignal
): Promise<void> {
  const deadline = Date.now() + RENAME_RETRY_TOTAL_MS
  for (let delay = 250; ; delay = Math.min(delay * 2, 4_000)) {
    try {
      await fs.promises.rename(src, dst)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (!RENAME_LOCK_CODES.has(code ?? '') || Date.now() + delay > deadline) throw err
      if (signal?.aborted) throw new Error('Cancelled', { cause: err })
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
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

/**
 * Apply a prepared stack to the installation's venv under the journaled
 * whole-venv transaction. On success persists `lastVerifiedTorchStack`.
 * On any failure the original venv is restored intact.
 *
 * The signal is honoured before mutation starts and during the pip install
 * step (which kills the child and rolls back); the bundle graft and the
 * commit rename are not cancellable.
 */
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
  // Captured so a rollback after the metadata persist (step 7) can restore
  // them — a rolled-back venv with the NEW stack ref persisted would hand
  // repair a false acquisition source.
  const priorVerified = installation.lastVerifiedTorchStack ?? null
  const priorObserved = installation.observedTorchStack ?? null

  // From here this function owns the staging dir: every exit removes it.
  try {
    if (!fs.existsSync(venvPath)) return { ok: false, message: 'installation venv not found' }
    if (tools.signal?.aborted) return { ok: false, message: 'Cancelled' }

    // Refuse to start over the debris of a previous run (recovery owns that).
    if (fs.existsSync(backupPath)) {
      return {
        ok: false,
        message: 'a previous PyTorch change did not finish; relaunch the app to recover, then retry'
      }
    }
    // Post-commit trash from a previous run whose deletion failed/died —
    // sweep it now so the commit rename below can't collide.
    if (fs.existsSync(gcPath)) {
      await fs.promises.rm(gcPath, { recursive: true, force: true })
    }

    await writeJournal(installPath, {
      version: 1,
      startedAt: Date.now(),
      stackId: entry ? entry.stackId : `pip:${packages.torch}`
    })

    try {
      // 3. Move the live venv aside — from here the backup is the good copy.
      // The just-stopped ComfyUI process tree may still hold handles for a
      // few seconds; renameWithLockRetry absorbs that.
      await renameWithLockRetry(venvPath, backupPath, tools.signal)

      // 4. Rebuild the canonical venv path as a copy of the backup.
      tools.sendProgress('torch-swap', { percent: -1, status: 'Copying environment…' })
      await copyDirWithProgress(backupPath, venvPath, (copied, total) => {
        const percent = total > 0 ? Math.round((copied / total) * 60) : 0
        tools.sendProgress('torch-swap', {
          percent,
          status: `Copying environment…  ${copied} / ${total}`
        })
      })

      // 5. Swap the torch-family payload inside the copy: graft the bundle's
      // packages (bundle-managed installs) or pip-install the exact tuple
      // from the derived index (adopted installs).
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

      // 6. Verify before committing. Family packages the target omits must be
      // absent: the pip path asserts its reconciliation plan (omitted
      // optional packages + swept acquisition-family debris), the bundle
      // path asserts the survivors it just removed.
      tools.sendProgress('torch-swap', { percent: 85, status: 'Verifying PyTorch…' })
      const verifyErr = await verifyStack(installation, packages, accelVariant, {
        expectAbsent,
        amdMultiArch: prepared.kind === 'pip' && prepared.source?.kind === 'amd-multi-arch-index'
      })
      if (verifyErr) throw new Error(`verification failed: ${verifyErr}`)

      // 7. Persist the verified stack ref (with acquisition info for repair).
      // A pip apply without catalog identity (observed-tuple restore) is
      // recorded as observed — it is not resolvable for future restores.
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

      // 8. Commit: atomically rename the backup out of rollback scope. This
      // single rename is the commit point — after it, no failure path may
      // touch the verified venv. Deleting a large directory is neither atomic
      // nor reliable (Windows/AV locks), so it must never double as commit.
      tools.sendProgress('torch-swap', { percent: 95, status: 'Cleaning up…' })
      await renameWithLockRetry(backupPath, gcPath)
    } catch (err) {
      tools.sendOutput?.(
        `\nPyTorch change failed: ${(err as Error).message}\nRestoring previous environment…\n`
      )
      try {
        await rollback(venvPath, backupPath)
        // Undo the step-7 metadata persist if the failure came after it (e.g.
        // the commit rename itself failed) — a rolled-back venv with the NEW
        // stack ref persisted would hand repair a false acquisition source.
        // A failed undo is reported but does not propagate (only a failed
        // venv rollback may): launch-time reconciliation clears the stale ref
        // from the actual installed tuple, and repair is skipped until it does.
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
        // Leave the journal in place: launch-time recovery retries the rollback.
        return {
          ok: false,
          message: `${(err as Error).message} — rollback also failed (${(rbErr as Error).message}); it will be retried on next launch`
        }
      }
    }

    // Committed. Cleanup is best-effort: launch-time recovery sweeps a
    // leftover gc dir, and a leftover journal with no backup is recognized as
    // a completed commit (never rolled back).
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

/**
 * Launch-time recovery for a PyTorch change that died mid-flight. All paths
 * are derived from the installation record — the on-disk journal is never
 * trusted for filesystem targets (a tampered journal must not be able to
 * direct deletes/renames outside the install).
 *
 * State machine:
 * - backup dir present (journal or not): the swap never committed — the
 *   backup is authoritative; restore it over the candidate venv.
 * - no backup: the commit rename happened (or mutation never started); the
 *   canonical venv is good. Only debris (journal, gc dir, staging) remains.
 *
 * Throws when the rollback itself fails — launching over a half-swapped venv
 * would defeat the transaction, so callers must fail the launch closed.
 */
export async function recoverTorchStackTransaction(
  installation: InstallationRecord
): Promise<boolean> {
  const installPath = installation.installPath
  const venvPath = getActiveVenvDir(installation)
  const backupPath = venvPath + BACKUP_SUFFIX
  const gcPath = venvPath + GC_SUFFIX

  // Debris sweeps are best-effort: staging from a kill during prepare, gc
  // from a kill during post-commit deletion. Neither affects correctness.
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
    // Rollback failure throws to the caller — do NOT swallow it and launch.
    await rollback(venvPath, backupPath)
  }
  // Best-effort: once no rollback-eligible backup remains the canonical venv
  // is authoritative, so a locked journal (AV scan) must not block launch —
  // it is reclassified as debris on the next pass.
  await fs.promises.rm(journalPath(installPath), { force: true }).catch(() => {})
  return hasBackup
}
