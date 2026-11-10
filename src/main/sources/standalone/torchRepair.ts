import fs from 'fs'
import path from 'path'
import { stripPlatform, findSitePackages, getTorchVersion } from './envPaths'
import { getActiveVenvDir } from '../../lib/pythonEnv'
import { torchTupleReacquirableFrom } from './torchStackTypes'
import { getLastVerifiedTorchStack } from './torchStackCatalog'
import {
  preparePipStack,
  applyTorchStackTransaction,
  preflightDiskSpace,
  DiskSpaceError
} from './torchStackTransaction'
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

const EXPECTED_FAMILY: Record<string, string> = {
  nvidia: 'cu',
  amd: 'rocm',
  'intel-xpu': 'xpu'
}

export interface TorchMismatch {
  variantBase: string
  expectedFamily: string
  installedVersion: string
  installedTag: string
}

interface AcceleratorEvidence {
  cuda: boolean
  hip: boolean
  rocm: boolean
  xpu: boolean
}

function readTorchAcceleratorEvidence(sitePackages: string): AcceleratorEvidence {
  const empty: AcceleratorEvidence = { cuda: false, hip: false, rocm: false, xpu: false }
  try {
    const txt = fs.readFileSync(path.join(sitePackages, 'torch', 'version.py'), 'utf-8')
    const field = (name: string): boolean => {
      const m = txt.match(
        new RegExp(`^${name}\\s*(?::[^=\\n]+)?=\\s*(None|'([^']*)'|"([^"]*)")`, 'm')
      )
      if (!m || m[1] === 'None') return false
      return (m[2] ?? m[3] ?? '').trim().length > 0
    }
    return { cuda: field('cuda'), hip: field('hip'), rocm: field('rocm'), xpu: field('xpu') }
  } catch {
    return empty
  }
}

function localTag(version: string | null): string {
  return version && version.includes('+')
    ? version.slice(version.indexOf('+') + 1).toLowerCase()
    : ''
}

function readTorchVersionFromSite(sitePackages: string): string | null {
  try {
    for (const entry of fs.readdirSync(sitePackages)) {
      const m = entry.match(/^torch-(.+?)\.dist-info$/i)
      if (m) return m[1]!
    }
  } catch {}
  return null
}

function hasExpectedAccelerator(
  variantBase: string,
  tag: string,
  ev: AcceleratorEvidence
): boolean {
  if (variantBase === 'nvidia') return tag.includes('cu') || ev.cuda
  if (variantBase === 'amd') return tag.includes('rocm') || ev.hip || ev.rocm
  if (variantBase === 'intel-xpu') return tag.includes('xpu') || ev.xpu
  return false
}

export function getTorchVendorMismatch(installation: InstallationRecord): TorchMismatch | null {
  if (installation.adopted === true) return null
  const variant = typeof installation.variant === 'string' ? installation.variant : ''
  if (!variant) return null

  const base = stripPlatform(variant)
  const variantBase = Object.keys(EXPECTED_FAMILY).find(
    (k) => base === k || base.startsWith(`${k}-`)
  )
  if (!variantBase) return null

  const sitePackages = findSitePackages(getActiveVenvDir(installation))
  if (!sitePackages) return null
  const installedVersion = getTorchVersion(installation)
  if (!installedVersion) return null

  const installedTag = localTag(installedVersion)
  const evidence = readTorchAcceleratorEvidence(sitePackages)
  if (hasExpectedAccelerator(variantBase, installedTag, evidence)) return null

  return {
    variantBase,
    expectedFamily: EXPECTED_FAMILY[variantBase]!,
    installedVersion,
    installedTag
  }
}

export interface TorchRepairTools {
  sendProgress: (phase: string, detail: Record<string, unknown>) => void
  sendOutput?: (text: string) => void
  update: (data: Record<string, unknown>) => Promise<unknown>
  signal?: AbortSignal
}

async function repairTorchViaPip(
  installation: InstallationRecord,
  verifiedRef: PersistedTorchStack,
  tools: TorchRepairTools
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
  if (!result.ok && tools.signal?.aborted) throw new Error('Cancelled')
  return result
}

export interface TorchRepairResult {
  ok: boolean
  message: string
  restoredRef?: PersistedTorchStack
}

export async function repairTorch(
  installation: InstallationRecord,
  tools: TorchRepairTools,
  verifiedRef: PersistedTorchStack | null = getLastVerifiedTorchStack(installation)
): Promise<TorchRepairResult> {
  const installPath = installation.installPath
  const tmpDir = path.join(installPath, '.torch-repair-tmp')

  if (verifiedRef && verifiedRef.source.kind !== 'comfy-bundle') {
    const result = await repairTorchViaPip(installation, verifiedRef, tools)
    return result.ok ? { ...result, restoredRef: verifiedRef } : result
  }

  try {
    const cache = createCache(
      settings.get('cacheDir') as string,
      settings.get('maxCachedDownloads') as number
    )
    const ctx = { sendProgress: tools.sendProgress, download, cache, extract, signal: tools.signal }

    await fs.promises.rm(tmpDir, { recursive: true, force: true })
    await fs.promises.mkdir(tmpDir, { recursive: true })

    const verifiedBundle = verifiedRef?.bundle
    const verifiedTag =
      verifiedRef?.source.kind === 'comfy-bundle' ? verifiedRef.source.bundleTag : undefined

    const files = verifiedBundle
      ? [verifiedBundle]
      : (installation.downloadFiles as
          | Array<{ url: string; filename: string; size: number }>
          | undefined)
    const releaseTag =
      verifiedBundle && verifiedTag ? verifiedTag : (installation.releaseTag as string | undefined)
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

    const srcVersion = readTorchVersionFromSite(srcSite)
    if (!srcVersion) {
      return { ok: false, message: 'bundle contains no PyTorch package' }
    }

    tools.sendProgress('torchRepair', { percent: -1 })
    await copyTorchFamily(srcSite, dstSite, tools.signal)

    const after = readTorchVersionFromSite(dstSite)
    if (after !== srcVersion) {
      return {
        ok: false,
        message: `PyTorch is "${after ?? 'absent'}" after copy, expected "${srcVersion}"`
      }
    }

    return {
      ok: true,
      message: `restored PyTorch ${after}`,
      ...(verifiedBundle && verifiedRef ? { restoredRef: verifiedRef } : {})
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

export async function maybeRepairTorch(
  installation: InstallationRecord,
  tools: TorchRepairTools,
  opts?: { preReconcileVerified?: PersistedTorchStack | null }
): Promise<boolean> {
  const orphan = path.join(installation.installPath, '.torch-repair-tmp')
  if (fs.existsSync(orphan))
    await fs.promises.rm(orphan, { recursive: true, force: true }).catch(() => {})

  const liveSite = findSitePackages(getActiveVenvDir(installation))
  if (liveSite) {
    try {
      await recoverTorchFamilyBackups(liveSite)
    } catch (err) {
      tools.sendOutput?.(
        `\nWARNING: could not recover PyTorch packages from an interrupted repair: ${(err as Error).message}\n`
      )
      telemetry.emit('comfy.desktop.torch_repair.recovery_failed', { ...buildErrorFields(err) })
    }
  }

  const state = installation.torchRepair as TorchRepairState | undefined
  const priorAttempts = state?.status === 'done' ? 0 : (state?.attempts ?? 0)
  if (priorAttempts >= MAX_REPAIR_ATTEMPTS) return false

  const mismatch = getTorchVendorMismatch(installation)
  if (!mismatch) return false

  telemetry.emit('comfy.desktop.torch_repair.detected', {
    variant: mismatch.variantBase,
    installed_version: mismatch.installedVersion,
    installed_tag: mismatch.installedTag || 'none'
  })
  tools.sendOutput?.(
    `\nDetected CPU PyTorch on a ${mismatch.variantBase.toUpperCase()} install; restoring the GPU build…\n`
  )

  let result: TorchRepairResult
  try {
    result = await repairTorch(
      installation,
      tools,
      opts?.preReconcileVerified ?? getLastVerifiedTorchStack(installation)
    )
  } catch (err) {
    if (tools.signal?.aborted) throw err
    result = { ok: false, message: (err as Error).message }
  }

  const attempts = priorAttempts + 1
  if (result.ok) {
    await tools.update({
      torchRepair: { status: 'done', attempts, at: Date.now() },
      ...(result.restoredRef
        ? { lastVerifiedTorchStack: result.restoredRef, observedTorchStack: null }
        : {})
    })
    telemetry.emit('comfy.desktop.torch_repair.succeeded', { variant: mismatch.variantBase })
    tools.sendOutput?.('GPU PyTorch restored.\n')
    return true
  }

  await tools.update({ torchRepair: { status: 'failed', attempts, at: Date.now() } })
  telemetry.emit('comfy.desktop.torch_repair.failed', {
    variant: mismatch.variantBase,
    attempts,
    ...buildErrorFields(result.message)
  })
  tools.sendOutput?.(`PyTorch repair failed (will retry on next launch): ${result.message}\n`)
  return false
}
