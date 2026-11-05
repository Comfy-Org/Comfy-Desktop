import path from 'path'
import fs from 'fs'
import { detectGPU } from './gpu'
import { mergeDirFlat } from './migrate'
import { download } from './download'
import { createCache } from './cache'
import { extractNested as extract } from './extract'
import { defaultInstallDir, sanitizeDirName, allocateUniqueDir } from './paths'
import {
  validateExportEnvelope,
  importSnapshots,
  ensureCurrentSnapshotOnTop,
  getSnapshotCount,
  restoreCustomNodes,
  restorePipPackages,
  restoreComfyUIVersion,
  buildPostRestoreState,
  frozenSnapshotInstallOverrides,
  repairNodeRequirements,
  protectedPackageDrift
} from './snapshots'
import type { Snapshot, RequirementsRepairResult } from './snapshots'
import { getInstalledTorchTuple } from '../sources/standalone/envPaths'
import {
  torchTupleMatches,
  stackVersionMatches,
  observedTuple,
  hasFullObservedTuple
} from '../sources/standalone/torchStackTypes'

import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import * as settings from '../settings'
import * as i18n from './i18n'
import type { SourcePlugin, FieldOption } from '../types/sources'
import type { ComfyVersion } from './version'
import { assertReadable } from './desktopDetect'
import * as telemetry from './telemetry'
import { buildErrorFields } from '../../shared/errorEvent'

const MARKER_FILE = '.comfyui-desktop-2'

export interface MigrationTools {
  sendProgress: (phase: string, detail: Record<string, unknown>) => void
  sendOutput: (text: string) => void
  signal: AbortSignal
  sourceMap: Record<string, SourcePlugin>
  uniqueName: (baseName: string) => Promise<string>
}

export interface SharedMigrationInput {
  installNameBase: string
  stagedSnapshot: {
    path: string
    owned: boolean
  }
  sourcePaths: {
    userDir?: string
    inputDir?: string
    outputDir?: string
    modelsDir?: string
  }
  labels: {
    userData: string
    input: string
    output: string
    models: string
  }
  target?: StandaloneTargetSelection
  sourceInstallationId?: string
  sourceInstallationName?: string
}

export type StandaloneTargetSelection =
  | { mode: 'auto' }
  | { mode: 'selected'; release: FieldOption; variant: FieldOption }

export function sendMigrationSteps(
  sendProgress: MigrationTools['sendProgress'],
  opts: { includeScan: boolean; scanLabel: string; dataPhaseLabel: string }
): void {
  sendProgress('steps', {
    steps: [
      ...(opts.includeScan ? [{ phase: 'scan', label: opts.scanLabel }] : []),
      { phase: 'download', label: i18n.t('common.download') },
      { phase: 'extract', label: i18n.t('common.extract') },
      { phase: 'setup', label: i18n.t('standalone.setupEnv') },
      { phase: 'restore-nodes', label: i18n.t('standalone.snapshotRestoreNodesPhase') },
      { phase: 'migrate', label: opts.dataPhaseLabel }
    ]
  })
}

async function resolveStandaloneInstallData(
  target: StandaloneTargetSelection | undefined,
  sourceMap: Record<string, SourcePlugin>,
  cleanupOnError: () => void
): Promise<{ instData: Record<string, unknown>; standaloneSource: SourcePlugin }> {
  const standaloneSource = sourceMap['standalone']!

  let release: FieldOption
  let variant: FieldOption

  if (target?.mode === 'selected') {
    release = target.release
    variant = target.variant
  } else {
    const releaseOptions = await standaloneSource.getFieldOptions!(
      'release',
      {},
      { includeLatestStable: true }
    )
    if (releaseOptions.length === 0) {
      cleanupOnError()
      throw new Error('No releases available.')
    }
    release = releaseOptions[0]!

    const gpu = await detectGPU()
    const variantOptions = await standaloneSource.getFieldOptions!(
      'variant',
      { release },
      { gpu: gpu?.id }
    )
    if (variantOptions.length === 0) {
      cleanupOnError()
      throw new Error('No compatible variants found for this platform.')
    }
    variant = variantOptions.find((v) => v.recommended) || variantOptions[0]!
  }

  const instData = {
    sourceId: 'standalone',
    sourceLabel: standaloneSource.label,
    ...standaloneSource.buildInstallation({ release, variant }),
    ...frozenSnapshotInstallOverrides()
  }

  return { instData, standaloneSource }
}

function torchSubstitutionNote(
  installation: InstallationRecord,
  targetSnapshot: Snapshot
): string | null {
  const snapTorch = targetSnapshot.torchStack
  if (!snapTorch) return null
  const installed = getInstalledTorchTuple(installation)
  if (snapTorch.kind === 'managed') {
    if (torchTupleMatches(snapTorch.ref.packages, installed)) return null
    return i18n.t('standalone.pytorchSnapshotStackKeptLocal', {
      version: snapTorch.ref.packages.torch
    })
  }
  if (snapTorch.torchVersion) {
    const matches = hasFullObservedTuple(snapTorch)
      ? torchTupleMatches(observedTuple(snapTorch), installed)
      : Boolean(installed.torch && stackVersionMatches(installed.torch, snapTorch.torchVersion))
    if (matches) return null
    return i18n.t('standalone.pytorchSnapshotObservedSkip', { version: snapTorch.torchVersion })
  }
  return null
}

export async function restoreSnapshotIntoInstallation(
  entry: InstallationRecord,
  stagedFile: string,
  ownsStagedFile: boolean,
  tools: Pick<MigrationTools, 'sendProgress' | 'sendOutput' | 'signal'>,
  update: (data: Record<string, unknown>) => Promise<void>
): Promise<void> {
  const { sendProgress, sendOutput, signal } = tools
  const freshInst = await installations.get(entry.id)
  if (!freshInst) throw new Error('Snapshot restore installation no longer exists.')
  if (!fs.existsSync(stagedFile)) throw new Error('Staged snapshot restore file is missing.')

  const restoreContext = { installation_id: entry.id }
  let completed = false
  let currentForSnapshot = freshInst
  try {
    const fileContent = await fs.promises.readFile(stagedFile, 'utf-8')
    const importEnvelope = validateExportEnvelope(JSON.parse(fileContent))
    const targetSnapshot = importEnvelope.snapshots[0]!

    sendOutput('\n── Restore ComfyUI Version ──\n')
    const comfyResult = await telemetry.trackedStep(
      'comfy.desktop.snapshot.restore_comfyui_version',
      restoreContext,
      async () => {
        return restoreComfyUIVersion(freshInst.installPath, targetSnapshot, sendOutput)
      }
    )

    const coreOk = !comfyResult.error && !signal.aborted
    let nodeResult: Awaited<ReturnType<typeof restoreCustomNodes>> | null = null
    if (coreOk) {
      sendOutput('\n── Restore Nodes ──\n')
      nodeResult = await telemetry.trackedStep(
        'comfy.desktop.snapshot.restore_custom_nodes',
        restoreContext,
        async () => {
          return restoreCustomNodes(
            freshInst.installPath,
            freshInst,
            targetSnapshot,
            sendProgress,
            sendOutput,
            signal,
            settings.getMirrorConfig()
          )
        }
      )
    }

    let pipResult: Awaited<ReturnType<typeof restorePipPackages>> | null = null
    if (coreOk && !signal.aborted && !targetSnapshot.skipPipSync) {
      sendOutput('\n── Restore Packages ──\n')
      pipResult = await telemetry.trackedStep(
        'comfy.desktop.snapshot.restore_pip_packages',
        restoreContext,
        async () => {
          return restorePipPackages(
            freshInst.installPath,
            freshInst,
            targetSnapshot,
            (phase, data) => sendProgress(phase === 'restore' ? 'restore-pip' : phase, data),
            sendOutput,
            signal,
            settings.getMirrorConfig()
          )
        }
      )
    }

    let repairResult: RequirementsRepairResult = { changed: [], errors: [] }
    if (
      coreOk &&
      !signal.aborted &&
      !targetSnapshot.skipPipSync &&
      pipResult &&
      pipResult.failed.length === 0
    ) {
      sendOutput('\n── Repair Requirements ──\n')
      sendProgress('restore-pip', { percent: -1, status: i18n.t('standalone.snapshotRepairPhase') })
      try {
        repairResult = await repairNodeRequirements(
          freshInst.installPath,
          freshInst,
          sendOutput,
          signal,
          settings.getMirrorConfig()
        )
      } catch (err) {
        repairResult = {
          changed: [],
          errors: [`Requirements repair failed: ${(err as Error).message}`]
        }
      }
      if (repairResult.changed.length > 0) {
        sendOutput(`Requirements repair adjusted ${repairResult.changed.length} package(s)\n`)
      }
    }

    const torchNote = coreOk ? torchSubstitutionNote(freshInst, targetSnapshot) : null
    if (torchNote) sendOutput(`\n${torchNote}\n`)

    let protectedDriftCount = 0
    let protectedDriftUnknown = false
    if (coreOk && !signal.aborted && !targetSnapshot.skipPipSync && pipResult) {
      try {
        const drift = await protectedPackageDrift(freshInst, targetSnapshot.pipPackages)
        protectedDriftCount = drift.length
        if (drift.length > 0) {
          const note = i18n.t('standalone.snapshotProtectedDrift', { count: drift.length })
          sendOutput(
            `\n${note}\n${drift.map((d) => `  ${d.name}: ${d.live ?? '(absent)'} (snapshot: ${d.target ?? '(absent)'})`).join('\n')}\n`
          )
        }
      } catch (err) {
        protectedDriftUnknown = true
        console.warn('Protected package drift check failed:', err)
        sendOutput(`\n${i18n.t('standalone.snapshotProtectedDriftUnknown')}\n`)
      }
    }

    const restoreState = buildPostRestoreState(
      targetSnapshot,
      comfyResult,
      freshInst.updateInfoByChannel as Record<string, Record<string, unknown>> | undefined,
      freshInst.comfyVersion as ComfyVersion | undefined
    )
    await update(restoreState)

    const restoreSucceeded =
      !comfyResult.error &&
      !signal.aborted &&
      nodeResult !== null &&
      nodeResult.failed.length === 0 &&
      nodeResult.unreportable.length === 0 &&
      (pipResult?.failed.length ?? 0) === 0

    const reachedTarget =
      restoreSucceeded &&
      !torchNote &&
      repairResult.changed.length === 0 &&
      repairResult.errors.length === 0 &&
      protectedDriftCount === 0 &&
      !protectedDriftUnknown

    const updatedInst = { ...freshInst, ...restoreState }
    currentForSnapshot = updatedInst

    if (reachedTarget) {
      await importSnapshots(
        freshInst.installPath,
        { ...importEnvelope, snapshots: [targetSnapshot] },
        entry.id
      )
    }
    if (restoreSucceeded) {
      try {
        const { filename } = await ensureCurrentSnapshotOnTop(freshInst.installPath, updatedInst)
        const snapshotCount = await getSnapshotCount(freshInst.installPath)
        await update({ lastSnapshot: filename ?? freshInst.lastSnapshot, snapshotCount })
      } catch (err) {
        if (!reachedTarget) {
          throw new Error(
            `Snapshot restore applied, but the resulting state could not be saved: ${(err as Error).message}`,
            { cause: err }
          )
        }
        console.warn('Failed to record restored snapshot state:', err)
      }
    }

    if (!restoreSucceeded) {
      const failures = [
        comfyResult.error ? `ComfyUI: ${comfyResult.error}` : '',
        ...(nodeResult?.failed.map((failure) => `Node ${failure.id}: ${failure.error}`) ?? []),
        ...(nodeResult?.unreportable.map(
          (id) => `Standalone node ${id}: source file is unavailable`
        ) ?? []),
        ...(pipResult?.errors ?? [])
      ].filter(Boolean)
      throw new Error(
        signal.aborted
          ? 'Snapshot restore cancelled.'
          : `Snapshot restore did not reach the target state.${failures.length > 0 ? ` ${failures.join('; ')}` : ''}`
      )
    }

    completed = true
  } catch (restoreErr) {
    sendOutput(`\nWarning: Snapshot restore failed: ${(restoreErr as Error).message}\n`)
    try {
      const { filename } = await ensureCurrentSnapshotOnTop(
        freshInst.installPath,
        currentForSnapshot
      )
      if (filename) {
        const snapshotCount = await getSnapshotCount(freshInst.installPath)
        await update({ lastSnapshot: filename, snapshotCount })
      }
    } catch (err) {
      console.warn('Failed to record rolled-back restore state:', err)
    }
    throw restoreErr
  } finally {
    if (completed) {
      await update({ pendingSnapshotRestore: undefined })
      if (ownsStagedFile) await fs.promises.unlink(stagedFile).catch(() => {})
    }
  }
}

async function copyMigrationData(
  sourcePaths: SharedMigrationInput['sourcePaths'],
  destComfyUIDir: string,
  labels: SharedMigrationInput['labels'],
  sendProgress: MigrationTools['sendProgress'],
  context: telemetry.TelemetryContext
): Promise<void> {
  await telemetry.trackedStep('comfy.desktop.migrate.source_preflight', context, async () => {
    for (const dir of [
      sourcePaths.userDir,
      sourcePaths.inputDir,
      sourcePaths.outputDir,
      sourcePaths.modelsDir
    ]) {
      if (dir && fs.existsSync(dir)) assertReadable(dir)
    }
  })

  if (sourcePaths.userDir && fs.existsSync(sourcePaths.userDir)) {
    await telemetry.trackedStep('comfy.desktop.migrate.user_files', context, async () => {
      sendProgress('migrate', { percent: 0, status: labels.userData })
      const dstUserDir = path.join(destComfyUIDir, 'user')
      await mergeDirFlat(sourcePaths.userDir!, dstUserDir, (copied, skipped, fileTotal) => {
        const pct = fileTotal > 0 ? Math.round(((copied + skipped) / fileTotal) * 30) : 30
        sendProgress('migrate', { percent: pct, status: labels.userData })
      })
    })
  }

  if (sourcePaths.inputDir && fs.existsSync(sourcePaths.inputDir)) {
    await telemetry.trackedStep('comfy.desktop.migrate.input', context, async () => {
      const dstInput =
        (settings.get('inputDir') as string | undefined) || settings.defaults.inputDir
      sendProgress('migrate', { percent: 40, status: labels.input })
      await mergeDirFlat(sourcePaths.inputDir!, dstInput)
    })
  }

  if (sourcePaths.outputDir && fs.existsSync(sourcePaths.outputDir)) {
    await telemetry.trackedStep('comfy.desktop.migrate.output', context, async () => {
      const dstOutput =
        (settings.get('outputDir') as string | undefined) || settings.defaults.outputDir
      sendProgress('migrate', { percent: 60, status: labels.output })
      await mergeDirFlat(sourcePaths.outputDir!, dstOutput)
    })
  }

  if (sourcePaths.modelsDir) {
    await telemetry.trackedStep('comfy.desktop.migrate.models', context, async () => {
      sendProgress('migrate', { percent: 90, status: labels.models })
      const resolved = path.resolve(sourcePaths.modelsDir!)
      const currentModelsDirs = (settings.get('modelsDirs') as string[] | undefined) || [
        ...settings.defaults.modelsDirs
      ]
      const normalizedCurrent = currentModelsDirs.map((d) => path.resolve(d))
      if (fs.existsSync(resolved) && !normalizedCurrent.includes(resolved)) {
        currentModelsDirs.push(resolved)
        settings.set('modelsDirs', currentModelsDirs)
      }
    })
  }

  sendProgress('migrate', { percent: 100, status: i18n.t('common.done') })
}

export async function migrateToStandaloneFromSnapshot(
  input: SharedMigrationInput,
  tools: MigrationTools
): Promise<{ entry: InstallationRecord; destPath: string; restoreError?: string }> {
  const { sendProgress, signal, uniqueName } = tools
  const { stagedSnapshot, sourcePaths, labels, target } = input

  const cleanupStagedFile = (): void => {
    if (stagedSnapshot.owned) fs.promises.unlink(stagedSnapshot.path).catch(() => {})
  }

  const { instData, standaloneSource } = await telemetry.trackedStep(
    'comfy.desktop.migrate.resolve_target',
    {},
    async () => resolveStandaloneInstallData(target, tools.sourceMap, cleanupStagedFile)
  )

  const { entry, destPath } = await telemetry.trackedStep(
    'comfy.desktop.migrate.allocate',
    {},
    async () => {
      const name = await uniqueName(input.installNameBase)
      const dirName = sanitizeDirName(name)
      const installDir = defaultInstallDir()
      const allocatedPath = allocateUniqueDir(installDir, dirName)
      const createdEntry = await installations.add({
        name,
        installPath: allocatedPath,
        pendingSnapshotRestore: stagedSnapshot.path,
        ...instData,
        status: 'installing',
        seen: false,
        ...(input.sourceInstallationId
          ? {
              copiedFrom: input.sourceInstallationId,
              copiedFromName: input.sourceInstallationName,
              copiedAt: new Date().toISOString(),
              copyReason: 'standalone-migration'
            }
          : {})
      })
      return { entry: createdEntry, destPath: allocatedPath }
    }
  )

  try {
    const releaseTag = (instData['releaseTag'] as string | undefined) ?? null
    const variantId = (instData['variantId'] as string | undefined) ?? null
    const installContext = {
      installation_id: entry.id,
      release_tag: releaseTag,
      variant_id: variantId
    }

    await telemetry.trackedStep(
      'comfy.desktop.migrate.prepare_target',
      installContext,
      async () => {
        await fs.promises.mkdir(destPath, { recursive: true })
        await fs.promises.writeFile(path.join(destPath, MARKER_FILE), entry.id)
      }
    )
    const cache = createCache(
      settings.get('cacheDir') as string,
      settings.get('maxCachedDownloads') as number
    )
    const installRecord = { ...instData, installPath: destPath } as unknown as InstallationRecord

    await telemetry.trackedStep('comfy.desktop.install.standalone', installContext, async () => {
      await standaloneSource.install!(installRecord, {
        sendProgress,
        download,
        cache,
        extract,
        signal
      })
    })

    const update = (data: Record<string, unknown>): Promise<void> =>
      installations.update(entry.id, data).then(() => {})
    await telemetry.trackedStep('comfy.desktop.install.post_install', installContext, async () => {
      await standaloneSource.postInstall!(installRecord, { sendProgress, update })
    })

    let restoreError: string | undefined
    const restoreStartedAt = Date.now()
    try {
      await telemetry.trackedStep(
        'comfy.desktop.migrate.restore_snapshot',
        installContext,
        async () => {
          await restoreSnapshotIntoInstallation(
            entry,
            stagedSnapshot.path,
            stagedSnapshot.owned,
            tools,
            update
          )
        },
        { canonicalError: true, emitError: false }
      )
    } catch (err) {
      if (signal.aborted) throw err
      restoreError = buildErrorFields(err).error_message
      telemetry.emit('comfy.desktop.migrate.restore_snapshot.error', {
        ...installContext,
        duration_ms: Date.now() - restoreStartedAt,
        ...buildErrorFields(err)
      })
      await update({ pendingSnapshotRestore: undefined })
      if (stagedSnapshot.owned) await fs.promises.unlink(stagedSnapshot.path).catch(() => {})
    }

    const dstComfyUI = path.join(destPath, 'ComfyUI')
    await copyMigrationData(sourcePaths, dstComfyUI, labels, sendProgress, installContext)

    await telemetry.trackedStep('comfy.desktop.migrate.finalize', installContext, async () => {
      await installations.update(entry.id, { status: 'installed' })
    })

    telemetry.captureInstallCompleted({
      installationId: entry.id,
      method: 'migrate',
      express: false
    })

    return { entry, destPath, restoreError }
  } catch (err) {
    if (signal.aborted) {
      await installations.remove(entry.id).catch(() => {})
      await fs.promises.rm(destPath, { recursive: true, force: true }).catch(() => {})
      cleanupStagedFile()
    } else {
      await installations.update(entry.id, { status: 'failed' }).catch(() => {})
    }
    throw err
  }
}
