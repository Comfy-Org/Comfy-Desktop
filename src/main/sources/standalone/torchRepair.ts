import fs from 'fs'
import path from 'path'
import { stripPlatform, findSitePackages, getTorchVersion } from './envPaths'
import { getActiveVenvDir } from '../../lib/pythonEnv'
import { torchTupleReacquirableFrom } from './torchStackTypes'
import { getLastVerifiedTorchStack } from './torchStackCatalog'
import { preparePipStack, applyTorchStackTransaction, preflightDiskSpace, DiskSpaceError } from './torchStackTransaction'
import { copyTorchFamily, recoverTorchFamilyBackups } from './torchFamilyFs'
import type { PersistedTorchStack } from './torchStackTypes'
import { downloadAndExtract, downloadAndExtractMulti } from '../../lib/installer'
import { createCache } from '../../lib/cache'
import { download } from '../../lib/download'
import { extractNested as extract } from '../../lib/extract'
import * as settings from '../../settings'
import * as telemetry from '../../lib/telemetry'
import { buildErrorFields } from '../../../shared/errorEvent'
import type { InstallationRecord } from '../../installations'

// Vendor variant → the accelerator tag fragment its torch wheel carries. CPU and
// mac (MPS, no suffix) are intentionally absent: CPU is a deliberate choice, and
// the macOS wheel has no suffix and always supports MPS, so neither is "broken".
const EXPECTED_FAMILY: Record<string, string> = {
  nvidia: 'cu',
  amd: 'rocm',
  'intel-xpu': 'xpu',
}

export interface TorchMismatch {
  /** Vendor key, e.g. 'nvidia' | 'amd' | 'intel-xpu'. */
  variantBase: string
  /** Tag fragment the install should have, e.g. 'cu'. */
  expectedFamily: string
  /** Full installed torch version string, e.g. '2.12.0' or '2.10.0+cu128'. */
  installedVersion: string
  /** Local-version tag, e.g. 'cu128' | 'cpu' | '' (bare). */
  installedTag: string
}

interface AcceleratorEvidence {
  cuda: boolean
  hip: boolean
  rocm: boolean
  xpu: boolean
}

/**
 * Read accelerator evidence from `torch/version.py` (the authoritative signal
 * baked into the wheel: each backend field is a non-null string for an
 * accelerated build, None for CPU). This distinguishes the bug's CPU torch —
 * which on Windows is a *bare* version like `2.12.0` with `cuda = None` — from a
 * user-installed PyPI default wheel, which is also bare-versioned but CUDA-
 * capable. Without it we would wrongly "repair" a user's deliberately-chosen
 * torch. The fields are written with type annotations
 * (`cuda: Optional[str] = '13.0'`), so the regex tolerates an optional `: type`.
 */
function readTorchAcceleratorEvidence(sitePackages: string): AcceleratorEvidence {
  const empty: AcceleratorEvidence = { cuda: false, hip: false, rocm: false, xpu: false }
  try {
    const txt = fs.readFileSync(path.join(sitePackages, 'torch', 'version.py'), 'utf-8')
    const field = (name: string): boolean => {
      const m = txt.match(new RegExp(`^${name}\\s*(?::[^=\\n]+)?=\\s*(None|'([^']*)'|"([^"]*)")`, 'm'))
      if (!m || m[1] === 'None') return false
      return ((m[2] ?? m[3] ?? '').trim()).length > 0
    }
    return { cuda: field('cuda'), hip: field('hip'), rocm: field('rocm'), xpu: field('xpu') }
  } catch {
    return empty
  }
}

/** Local-version tag of a torch version string, e.g. '2.10.0+cu128' → 'cu128'. */
function localTag(version: string | null): string {
  return version && version.includes('+') ? version.slice(version.indexOf('+') + 1).toLowerCase() : ''
}

/** Read the installed torch version from a torch dist-info dir in site-packages. */
function readTorchVersionFromSite(sitePackages: string): string | null {
  try {
    for (const entry of fs.readdirSync(sitePackages)) {
      const m = entry.match(/^torch-(.+?)\.dist-info$/i)
      if (m) return m[1]!
    }
  } catch {
    /* ignore */
  }
  return null
}

/** Whether a torch install carries the accelerator its GPU variant requires,
 *  judged by either the wheel's local tag or the version.py backend fields. */
function hasExpectedAccelerator(variantBase: string, tag: string, ev: AcceleratorEvidence): boolean {
  if (variantBase === 'nvidia') return tag.includes('cu') || ev.cuda
  if (variantBase === 'amd') return tag.includes('rocm') || ev.hip || ev.rocm
  if (variantBase === 'intel-xpu') return tag.includes('xpu') || ev.xpu
  return false
}

/**
 * Detect a GPU-variant install whose torch lacks its expected accelerator — the
 * signature of the brief `--upgrade` bug that replaced the bundled CUDA/ROCm
 * torch with a CPU build. Keys on accelerator *capability* (version.py probe or
 * the wheel's local tag), never the version number, so a user freely choosing
 * any version is never flagged. Returns null when the install is fine, is
 * CPU/mac/adopted, or torch can't be read.
 */
export function getTorchVendorMismatch(installation: InstallationRecord): TorchMismatch | null {
  if (installation.adopted === true) return null
  const variant = typeof installation.variant === 'string' ? installation.variant : ''
  if (!variant) return null

  const base = stripPlatform(variant)
  const variantBase = Object.keys(EXPECTED_FAMILY).find((k) => base === k || base.startsWith(`${k}-`))
  if (!variantBase) return null // cpu, mps, or unknown — nothing to repair

  const sitePackages = findSitePackages(getActiveVenvDir(installation))
  if (!sitePackages) return null
  const installedVersion = getTorchVersion(installation)
  if (!installedVersion) return null // can't read torch — leave it alone

  const installedTag = localTag(installedVersion)
  const evidence = readTorchAcceleratorEvidence(sitePackages)
  if (hasExpectedAccelerator(variantBase, installedTag, evidence)) return null

  return { variantBase, expectedFamily: EXPECTED_FAMILY[variantBase]!, installedVersion, installedTag }
}

export interface TorchRepairTools {
  sendProgress: (phase: string, detail: Record<string, unknown>) => void
  sendOutput?: (text: string) => void
  update: (data: Record<string, unknown>) => Promise<unknown>
  signal?: AbortSignal
}

/**
 * Re-acquire a verified index-served stack via pip, through the journaled
 * whole-venv transaction: repair runs against the LIVE venv, and an in-place
 * pip install interrupted by a cancelled launch could remove the remaining
 * torch packages with no rollback. The transaction mutates a copy, verifies
 * it, and restores the original on any failure.
 */
async function repairTorchViaPip(
  installation: InstallationRecord,
  verifiedRef: PersistedTorchStack,
  tools: TorchRepairTools,
): Promise<{ ok: boolean; message: string }> {
  const packages = verifiedRef.packages
  if (!torchTupleReacquirableFrom(verifiedRef.source, packages)) {
    return { ok: false, message: `no trusted index serves torch ${packages.torch}` }
  }
  try {
    await preflightDiskSpace(installation, null, tools.signal, { pipSource: verifiedRef.source })
  } catch (err) {
    if (err instanceof DiskSpaceError) return { ok: false, message: err.message }
    throw err
  }
  tools.sendProgress('torchRepair', { percent: -1 })
  const prepared = preparePipStack(packages, { ...verifiedRef, date: '', comfyuiVersion: '' })
  const result = await applyTorchStackTransaction(installation, prepared, tools)
  // Cancellation surfaces as a throw so the caller doesn't count it as a
  // failed repair attempt (the transaction already rolled the venv back).
  if (!result.ok && tools.signal?.aborted) throw new Error('Cancelled')
  return result
}

export interface TorchRepairResult {
  ok: boolean
  message: string
  /** The verified stack ref repair restored, when it targeted one — the
   *  caller re-persists it (reconciliation cleared it when it saw the
   *  damaged tuple). Absent when the install-time bundle was used. */
  restoredRef?: PersistedTorchStack
}

/**
 * Restore the correct accelerated torch. Prefers the last *verified* stack
 * (set by a completed PyTorch change) over the install-time bundle, so
 * repair restores the stack the user actually chose instead of reverting a
 * deliberate switch. `verifiedRef` lets the launch path pass the ref it
 * captured BEFORE reconciliation (which clears a verified ref the moment it
 * sees the damaged tuple); defaults to the ref on the record. An
 * index-served ref is re-acquired via pip from its trusted index; bundle
 * refs and the install-time fallback re-download the bundle (reusing the
 * on-disk download cache — `maxCachedDownloads` defaults to 1, so it is
 * typically still cached) and copy its torch-family packages over the
 * install's venv. Never touches ComfyUI source, .git, models, or non-torch
 * packages.
 */
export async function repairTorch(
  installation: InstallationRecord,
  tools: TorchRepairTools,
  verifiedRef: PersistedTorchStack | null = getLastVerifiedTorchStack(installation),
): Promise<TorchRepairResult> {
  const installPath = installation.installPath
  const tmpDir = path.join(installPath, '.torch-repair-tmp')

  // Index-served stacks have no bundle at all — pip is their only source.
  if (verifiedRef && verifiedRef.source.kind !== 'comfy-bundle') {
    const result = await repairTorchViaPip(installation, verifiedRef, tools)
    return result.ok ? { ...result, restoredRef: verifiedRef } : result
  }

  try {
    const cache = createCache(settings.get('cacheDir') as string, settings.get('maxCachedDownloads') as number)
    const ctx = { sendProgress: tools.sendProgress, download, cache, extract, signal: tools.signal }

    await fs.promises.rm(tmpDir, { recursive: true, force: true })
    await fs.promises.mkdir(tmpDir, { recursive: true })

    // A verified comfy-bundle stack carries its own download info — restore
    // the stack the user actually chose, not the install-time bundle.
    const verifiedBundle = verifiedRef?.bundle
    const verifiedTag = verifiedRef?.source.kind === 'comfy-bundle' ? verifiedRef.source.bundleTag : undefined

    const files = verifiedBundle
      ? [verifiedBundle]
      : (installation.downloadFiles as Array<{ url: string; filename: string; size: number }> | undefined)
    const releaseTag = verifiedBundle && verifiedTag ? verifiedTag : (installation.releaseTag as string | undefined)
    const variant = installation.variant as string | undefined
    const downloadUrl = installation.downloadUrl as string | undefined

    if (files && files.length > 0 && releaseTag && variant) {
      await downloadAndExtractMulti(files, tmpDir, `${releaseTag}_${variant}`, ctx)
    } else if (downloadUrl && releaseTag) {
      const filename = downloadUrl.split('/').pop()!
      await downloadAndExtract(downloadUrl, tmpDir, `${releaseTag}_${filename}`, ctx)
    } else {
      return { ok: false, message: 'no bundle download info on the installation record' }
    }

    const srcSite = findSitePackages(path.join(tmpDir, 'standalone-env'))
    const dstSite = findSitePackages(getActiveVenvDir(installation))
    if (!srcSite || !fs.existsSync(srcSite)) {
      return { ok: false, message: 'could not locate the bundle PyTorch packages' }
    }
    if (!dstSite || !fs.existsSync(dstSite)) {
      return { ok: false, message: 'could not locate the installation venv' }
    }

    // Trust the shipped bundle for *which* torch is correct — it's our own
    // artifact, the same one every fresh install of this variant uses, so if it
    // lacked GPU torch every fresh install would be broken too. Only guard the
    // mechanics: the bundle must actually contain a torch package, and (below)
    // the venv's torch version must match the bundle's afterward. Both rely on
    // the dist-info dir name alone — nothing inside torch that breaks when
    // PyTorch changes how version.py is written.
    const srcVersion = readTorchVersionFromSite(srcSite)
    if (!srcVersion) {
      return { ok: false, message: 'bundle contains no PyTorch package' }
    }

    // Drives the synthetic `torchRepair` launch step (label carries the copy);
    // the caller emits the steps payload before this runs. See `handleLaunch`.
    tools.sendProgress('torchRepair', { percent: -1 })
    await copyTorchFamily(srcSite, dstSite, tools.signal)

    // Verify only the mechanics: the venv's torch version now matches the
    // bundle's. Uses the dist-info dir name alone, so it can't be broken by
    // PyTorch changing how version.py is written.
    const after = readTorchVersionFromSite(dstSite)
    if (after !== srcVersion) {
      return { ok: false, message: `PyTorch is "${after ?? 'absent'}" after copy, expected "${srcVersion}"` }
    }

    return {
      ok: true,
      message: `restored PyTorch ${after}`,
      ...(verifiedBundle && verifiedRef ? { restoredRef: verifiedRef } : {}),
    }
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

const MAX_REPAIR_ATTEMPTS = 3

interface TorchRepairState {
  status?: 'done' | 'failed'
  attempts?: number
  at?: number
}

/**
 * One-time, autorun-at-launch repair entry point. Detects the CPU-torch-on-
 * GPU-variant damage and, if found, restores the accelerated build from the
 * bundle. Bounded to MAX_REPAIR_ATTEMPTS so a repeatedly-failing download can't
 * nag forever. A failed repair is NON-fatal: CPU torch still runs (slowly), so
 * we let the launch proceed rather than block it. Cancellation propagates to the
 * caller and is not counted as a failed attempt. Returns true when a repair
 * succeeded (caller should refresh the installation record).
 *
 * `opts.preReconcileVerified` is the verified stack ref captured BEFORE
 * launch reconciliation ran: reconciliation clears a verified ref the moment
 * it sees the damaged tuple, so reading the record here would lose the stack
 * the user actually chose and revert to the install-time bundle.
 */
export async function maybeRepairTorch(
  installation: InstallationRecord,
  tools: TorchRepairTools,
  opts?: { preReconcileVerified?: PersistedTorchStack | null },
): Promise<boolean> {
  // Best-effort sweep of a multi-GB temp extraction orphaned by a hard kill.
  const orphan = path.join(installation.installPath, '.torch-repair-tmp')
  if (fs.existsSync(orphan)) await fs.promises.rm(orphan, { recursive: true, force: true }).catch(() => {})

  // Recover from a swap that died mid-way: an uncommitted swap's backups hold
  // the only good copies, and mismatch detection below bails when torch is
  // unreadable. The launch path already runs this recovery hard-gated (a
  // failed rollback fails the launch); this retry covers non-launch callers
  // and is best-effort - the marker survives a failure, so the next gated
  // recovery attempt retries the rollback.
  const liveSite = findSitePackages(getActiveVenvDir(installation))
  if (liveSite) {
    try {
      await recoverTorchFamilyBackups(liveSite)
    } catch (err) {
      tools.sendOutput?.(`\nWARNING: could not recover PyTorch packages from an interrupted repair: ${(err as Error).message}\n`)
      telemetry.emit('comfy.desktop.torch_repair.recovery_failed', { ...buildErrorFields(err) })
    }
  }

  // A completed repair must not latch repair off forever: new damage after a
  // successful repair is a new incident, so the attempt budget resets. Only a
  // string of *failed* attempts is bounded.
  const state = installation.torchRepair as TorchRepairState | undefined
  const priorAttempts = state?.status === 'done' ? 0 : (state?.attempts ?? 0)
  if (priorAttempts >= MAX_REPAIR_ATTEMPTS) return false

  const mismatch = getTorchVendorMismatch(installation)
  if (!mismatch) return false

  telemetry.emit('comfy.desktop.torch_repair.detected', {
    variant: mismatch.variantBase,
    installed_version: mismatch.installedVersion,
    installed_tag: mismatch.installedTag || 'none',
  })
  tools.sendOutput?.(`\nDetected CPU PyTorch on a ${mismatch.variantBase.toUpperCase()} install; restoring the GPU build…\n`)

  let result: TorchRepairResult
  try {
    result = await repairTorch(installation, tools, opts?.preReconcileVerified ?? getLastVerifiedTorchStack(installation))
  } catch (err) {
    if (tools.signal?.aborted) throw err // cancellation — let launch handle it, don't count
    result = { ok: false, message: (err as Error).message }
  }

  const attempts = priorAttempts + 1
  if (result.ok) {
    await tools.update({
      torchRepair: { status: 'done', attempts, at: Date.now() },
      // Re-persist the ref repair restored: reconciliation cleared it when it
      // saw the damaged tuple, and the cached catalog may not re-adopt it
      // (remote-only index entries are absent until a check-update runs).
      ...(result.restoredRef ? { lastVerifiedTorchStack: result.restoredRef, observedTorchStack: null } : {}),
    })
    telemetry.emit('comfy.desktop.torch_repair.succeeded', { variant: mismatch.variantBase })
    tools.sendOutput?.('GPU PyTorch restored.\n')
    return true
  }

  await tools.update({ torchRepair: { status: 'failed', attempts, at: Date.now() } })
  telemetry.emit('comfy.desktop.torch_repair.failed', {
    variant: mismatch.variantBase,
    attempts,
    ...buildErrorFields(result.message),
  })
  tools.sendOutput?.(`PyTorch repair failed (will retry on next launch): ${result.message}\n`)
  return false
}
