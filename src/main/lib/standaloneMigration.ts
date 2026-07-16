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
  frozenSnapshotInstallOverrides
} from './snapshots'

import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import * as settings from '../settings'
import * as i18n from './i18n'
import type { SourcePlugin, FieldOption } from '../types/sources'
import type { ComfyVersion } from './version'
import { assertReadable } from './desktopDetect'
import * as telemetry from './telemetry'

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

/**
 * Emit the standard migration step list for the progress UI.
 */
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

/**
 * Resolve the standalone release + variant, either from explicit selection
 * or by auto-detecting the GPU.
 */
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
    // `includeLatestStable: true` opens the standalone source's release list
    // (see `standalone/index.ts:328`). Without it the source returns an
    // empty array and the legacy-desktop migration silently bails with
    // "No releases available." instead of progressing.
    const releaseOptions = await standaloneSource.getFieldOptions!('release', {}, { includeLatestStable: true })
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
    // Migrating from a snapshot freezes the install to the snapshot's pinned
    // ComfyUI version: skip the post-install auto-update (the snapshot restore
    // re-pins the core commit). updateChannel is left as built here and
    // re-applied from the snapshot by buildPostRestoreState once restore runs.
    ...frozenSnapshotInstallOverrides()
  }

  return { instData, standaloneSource }
}

/**
 * Restore a snapshot (custom nodes + pip packages) into a freshly installed
 * standalone installation.
 */
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
    // Validate the envelope as a restore *target* only — do NOT commit it to
    // history yet. A snapshot in history must record a state the install has
    // actually been in, so the envelope is committed via `importSnapshots` only
    // after the restore below succeeds (see snapshots/AGENTS.md, #1137).
    const fileContent = await fs.promises.readFile(stagedFile, 'utf-8')
    const importEnvelope = validateExportEnvelope(JSON.parse(fileContent))
    const targetSnapshot = importEnvelope.snapshots[0]!

    // Restore ComfyUI version
    sendOutput('\n── Restore ComfyUI Version ──\n')
    const comfyResult = await telemetry.trackedStep(
      'comfy.desktop.snapshot.restore_comfyui_version',
      restoreContext,
      async () => {
        return restoreComfyUIVersion(freshInst.installPath, targetSnapshot, sendOutput)
      }
    )

    // Skip nodes/pip once the core checkout failed or the restore was
    // cancelled — don't keep mutating the environment toward a target state
    // that is already unreachable.
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

    // Update installation state with restored version/channel metadata
    const restoreState = buildPostRestoreState(
      targetSnapshot,
      comfyResult,
      freshInst.updateInfoByChannel as Record<string, Record<string, unknown>> | undefined,
      freshInst.comfyVersion as ComfyVersion | undefined
    )
    await update(restoreState)

    // The restore "succeeded" only if the target state was actually reached.
    // restoreComfyUIVersion/restorePipPackages report failures by RETURNING a
    // result (they revert their own changes) rather than throwing, so we must
    // inspect them — otherwise a pip install that can't be satisfied (the #1137
    // repro) would still commit the never-applied target to history.
    const restoreSucceeded =
      !comfyResult.error &&
      !signal.aborted &&
      nodeResult !== null &&
      nodeResult.failed.length === 0 &&
      nodeResult.unreportable.length === 0 &&
      (pipResult?.failed.length ?? 0) === 0

    const updatedInst = { ...freshInst, ...restoreState }
    currentForSnapshot = updatedInst

    // Only commit the imported envelope to history once the install has
    // actually been in that state (#1137).
    if (restoreSucceeded) {
      await importSnapshots(freshInst.installPath, importEnvelope, entry.id)
      try {
        // Make the newest snapshot reflect the real current state — normally a
        // no-op since the just-committed target already matches and stays Latest.
        const { filename } = await ensureCurrentSnapshotOnTop(freshInst.installPath, updatedInst)
        const snapshotCount = await getSnapshotCount(freshInst.installPath)
        await update({ lastSnapshot: filename ?? freshInst.lastSnapshot, snapshotCount })
      } catch (err) {
        console.warn('Failed to record restored snapshot state:', err)
      }
    }

    if (!restoreSucceeded) {
      const failures = [
        comfyResult.error ? `ComfyUI: ${comfyResult.error}` : '',
        ...(nodeResult?.failed.map((failure) => `Node ${failure.id}: ${failure.error}`) ?? []),
        ...(nodeResult?.unreportable.map((id) => `Standalone node ${id}: source file is unavailable`) ?? []),
        ...(pipResult?.errors ?? []),
      ].filter(Boolean)
      throw new Error(signal.aborted
        ? 'Snapshot restore cancelled.'
        : `Snapshot restore did not reach the target state.${failures.length > 0 ? ` ${failures.join('; ')}` : ''}`)
    }

    completed = true
  } catch (restoreErr) {
    sendOutput(
      `\n⚠ Snapshot restore failed: ${(restoreErr as Error).message}\n`
    )
    // The target was never committed to history (restore failed), but this
    // fresh-install migration has no source rollback, so the on-disk state can
    // be a novel partial-restore state that no existing snapshot matches.
    // Capture it so the newest snapshot still reflects the real current state.
    try {
      const { filename } = await ensureCurrentSnapshotOnTop(freshInst.installPath, currentForSnapshot)
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
      // Clear the retry pointer before deleting the staged file so a crash
      // between the two can't leave a pointer to a missing file.
      await update({ pendingSnapshotRestore: undefined })
      if (ownsStagedFile) await fs.promises.unlink(stagedFile).catch(() => {})
    }
  }
}

/**
 * Copy user data, input, output and add models to shared paths.
 */
async function copyMigrationData(
  sourcePaths: SharedMigrationInput['sourcePaths'],
  destComfyUIDir: string,
  labels: SharedMigrationInput['labels'],
  sendProgress: MigrationTools['sendProgress']
): Promise<void> {
  // Verify read access to source directories before copying (macOS TCC may block)
  for (const dir of [
    sourcePaths.userDir,
    sourcePaths.inputDir,
    sourcePaths.outputDir,
    sourcePaths.modelsDir
  ]) {
    if (dir && fs.existsSync(dir)) assertReadable(dir)
  }

  // User data
  if (sourcePaths.userDir && fs.existsSync(sourcePaths.userDir)) {
    await telemetry.trackedStep('comfy.desktop.migrate.user_files', {}, async () => {
      sendProgress('migrate', { percent: 0, status: labels.userData })
      const dstUserDir = path.join(destComfyUIDir, 'user')
      await mergeDirFlat(sourcePaths.userDir!, dstUserDir, (copied, skipped, fileTotal) => {
        const pct = fileTotal > 0 ? Math.round(((copied + skipped) / fileTotal) * 30) : 30
        sendProgress('migrate', { percent: pct, status: labels.userData })
      })
    })
  }

  // Input
  if (sourcePaths.inputDir && fs.existsSync(sourcePaths.inputDir)) {
    await telemetry.trackedStep('comfy.desktop.migrate.input', {}, async () => {
      const dstInput =
        (settings.get('inputDir') as string | undefined) || settings.defaults.inputDir
      sendProgress('migrate', { percent: 40, status: labels.input })
      await mergeDirFlat(sourcePaths.inputDir!, dstInput)
    })
  }

  // Output
  if (sourcePaths.outputDir && fs.existsSync(sourcePaths.outputDir)) {
    await telemetry.trackedStep('comfy.desktop.migrate.output', {}, async () => {
      const dstOutput =
        (settings.get('outputDir') as string | undefined) || settings.defaults.outputDir
      sendProgress('migrate', { percent: 60, status: labels.output })
      await mergeDirFlat(sourcePaths.outputDir!, dstOutput)
    })
  }

  // Models — add to shared paths, no copy
  if (sourcePaths.modelsDir) {
    await telemetry.trackedStep('comfy.desktop.migrate.models', {}, async () => {
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

/**
 * Shared migration flow: create a new standalone installation from a staged
 * snapshot, restore it, and copy user data from the source.
 */
export async function migrateToStandaloneFromSnapshot(
  input: SharedMigrationInput,
  tools: MigrationTools
): Promise<{ entry: InstallationRecord; destPath: string }> {
  const { sendProgress, signal, uniqueName } = tools
  const { stagedSnapshot, sourcePaths, labels, target } = input

  const cleanupStagedFile = (): void => {
    if (stagedSnapshot.owned) fs.promises.unlink(stagedSnapshot.path).catch(() => {})
  }

  // 1. Resolve release/variant
  const { instData, standaloneSource } = await resolveStandaloneInstallData(
    target,
    tools.sourceMap,
    cleanupStagedFile
  )

  // 2. Create new standalone installation record
  const name = await uniqueName(input.installNameBase)
  const dirName = sanitizeDirName(name)
  const installDir = defaultInstallDir()
  const destPath = allocateUniqueDir(installDir, dirName)

  const entry = await installations.add({
    name,
    installPath: destPath,
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

  try {
    // 3. Install standalone (download + extract + setup env)
    await fs.promises.mkdir(destPath, { recursive: true })
    await fs.promises.writeFile(path.join(destPath, MARKER_FILE), entry.id)
    const cache = createCache(
      settings.get('cacheDir') as string,
      settings.get('maxCachedDownloads') as number
    )
    const installRecord = { ...instData, installPath: destPath } as unknown as InstallationRecord

    const releaseTag = (instData['releaseTag'] as string | undefined) ?? null
    const variantId = (instData['variantId'] as string | undefined) ?? null
    const installContext = {
      installation_id: entry.id,
      release_tag: releaseTag,
      variant_id: variantId
    }

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

    // 4. Restore snapshot (custom nodes + pip packages)
    await restoreSnapshotIntoInstallation(
      entry,
      stagedSnapshot.path,
      stagedSnapshot.owned,
      tools,
      update
    )

    // 5. Copy user data, input, output, models
    const dstComfyUI = path.join(destPath, 'ComfyUI')
    await copyMigrationData(sourcePaths, dstComfyUI, labels, sendProgress)

    await installations.update(entry.id, { status: 'installed' })

    // Fire the once-per-install funnel event for the snapshot-based migrate-to-
    // standalone path (portable/git → standalone, and Desktop-1 snapshot
    // migrations). Fired once here at completion, the moment the new install is
    // ready to boot. This flow does NOT go through the `install-instance` IPC
    // handler, so there is no double-fire with the express/manual path. Best-
    // effort: `capture()` swallows its own errors and never aborts the migration.
    telemetry.captureInstallCompleted({
      installationId: entry.id,
      method: 'migrate',
      express: false
    })

    return { entry, destPath }
  } catch (err) {
    await installations.update(entry.id, { status: 'failed' }).catch(() => {})
    throw err
  }
}
