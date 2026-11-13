import {
  path,
  fs,
  ipcMain,
  sources,
  installations,
  settings,
  i18n,
  sourceMap,
  formatComfyVersion,
  scheduleResolveAndBroadcastVersions,
  findDuplicatePath,
  uniqueName,
  syncOemSeedBestEffort,
  isEffectivelyEmptyInstallDir,
  getCachedInstallDirState,
  refreshInstallDirStates,
  isInstallDirUnavailable,
  download,
  createCache,
  extract,
  deleteDir,
  formatDeleteStatus,
  deleteAction,
  untrackAction,
  MARKER_FILE,
  _operationAborts,
  _runningSessions,
  sanitizeEnvVars,
  getComfyArgsSchema,
  COMFYUI_REPO,
  snapshotRestoreFailureResult
} from './shared'
import type { ComfyVersion, ComfyArgDef, InstallationRecord } from './shared'
import { allocateInstallIdentity } from './installIdentity'
import * as releaseCache from '../release-cache'
import { runStartupReleaseChecks } from '../release-cache-startup'
import { _broadcastToRenderer } from './shared'
import { hasGitDir } from '../git'
import { parseUrl } from '../util'
import { restoreSnapshotIntoInstallation } from '../standaloneMigration'
import * as mainTelemetry from '../telemetry'
import { buildErrorFields } from '../../../shared/errorEvent'
import { appendLog } from '../logsBroadcast'
import { invalidateModelDownloadStartupPass } from '../comfyDownloadManager'
import {
  startTemplateDownload,
  abortTemplateDownload,
  requestSkipTemplateDownload
} from '../../sources/standalone/templateDownloadTask'
import { abortModelStaging } from '../../sources/comfybuilder/modelStagingTask'
import { recordIpcInvocation } from '../e2eOverrides'
import { DEFAULT_INSTALL_NAME } from '../../../shared/defaultInstallName'
import {
  isInstallationVisibleToRenderer,
  markInstallRunning,
  markInstallSettled
} from './installationVisibility'
import { answerCoreBetaArgs } from '../coreBetaPreview'

function _kickReleaseCachePrewarm(allInstalls: InstallationRecord[]): void {
  void runStartupReleaseChecks(allInstalls, {
    onRefreshed: () => _broadcastToRenderer('installations-changed', {})
  }).catch(() => {})
}

export function enrichInstallationsForRenderer(allInstalls: InstallationRecord[]): {
  visible: InstallationRecord[]
  enriched: Record<string, unknown>[]
} {
  const migratedSourceIds = new Set(
    allInstalls
      .filter(
        (i) =>
          (i.copyReason as string | undefined) === 'standalone-migration' &&
          isInstallationVisibleToRenderer(i)
      )
      .map((i) => i.copiedFrom as string)
      .filter(Boolean)
  )
  const visible = allInstalls.filter(
    (i) => isInstallationVisibleToRenderer(i) && !migratedSourceIds.has(i.id)
  )
  const enriched = visible.map((inst) => {
    const source = sourceMap[inst.sourceId]
    if (!source) return inst as unknown as Record<string, unknown>
    const listPreview = source.getListPreview ? source.getListPreview(inst) : undefined
    const dirState = source.skipInstall ? undefined : getCachedInstallDirState(inst.id)
    const dirUnavailable = isInstallDirUnavailable(dirState)
    const withInstallPath = (msg: string): string =>
      inst.installPath ? `${msg}\n\n${inst.installPath}` : msg
    const dirUnavailableTag =
      dirState === 'no-permission'
        ? {
            label: i18n.t('errors.installDirNoPermissionTag'),
            style: 'danger',
            detail: withInstallPath(i18n.t('errors.installDirNoPermission'))
          }
        : {
            label: i18n.t('errors.installDirNotFoundTag'),
            style: 'danger',
            detail: withInstallPath(i18n.t('errors.installDirNotFound'))
          }
    const statusTag =
      inst.status === 'partial-delete'
        ? {
            label: i18n.t('errors.deleteInterrupted'),
            style: 'danger',
            detail: i18n.t('errors.deleteInterruptedDetail')
          }
        : inst.status === 'failed'
          ? {
              label: i18n.t('errors.installFailed'),
              style: 'danger',
              detail: i18n.t('errors.installFailedDetail')
            }
          : dirUnavailable
            ? dirUnavailableTag
            : source.getStatusTag
              ? source.getStatusTag(inst)
              : undefined
    const isFromBuild = inst.sourceId === 'comfybuilder'
    const buildVersion = isFromBuild ? (inst.version as string | undefined) : undefined
    const cv = inst.comfyVersion as ComfyVersion | undefined
    const rawVersion = cv
      ? formatComfyVersion(cv, 'short')
      : isFromBuild
        ? undefined
        : (inst.version as string | undefined)
    const version = rawVersion === inst.sourceId ? undefined : rawVersion
    return {
      ...inst,
      version,
      sourceLabel: source.label,
      sourceCategory: source.category,
      hasConsole: source.hasConsole !== false,
      ...(buildVersion ? { distributionVersion: buildVersion } : {}),
      ...(listPreview != null ? { listPreview } : {}),
      ...(statusTag ? { statusTag } : {})
    }
  })
  return { visible, enriched }
}

export function registerInstallationHandlers(): void {
  ipcMain.handle('get-installations', async () => {
    const allInstalls = await installations.list()
    const { visible, enriched } = enrichInstallationsForRenderer(allInstalls)

    scheduleResolveAndBroadcastVersions(visible)

    _kickReleaseCachePrewarm(visible)

    void refreshInstallDirStates()
    return enriched
  })

  ipcMain.handle('get-unique-name', async (_event, baseName: string) => {
    return uniqueName(baseName)
  })

  ipcMain.handle('get-installations-summary', async () => {
    const all = await installations.list()
    const visible = all.filter((i) => i.status !== 'installing')
    return {
      localCount: visible.filter((i) => i.sourceId !== 'cloud').length,
      hasLaunchedCloud: visible.some((i) => i.sourceId === 'cloud' && !!i.lastLaunchedAt),
      hasLegacyDesktop: visible.some((i) => i.sourceId === 'desktop')
    }
  })

  ipcMain.handle('add-installation', async (_event, data: Record<string, unknown>) => {
    const identity = await allocateInstallIdentity(
      (data.name as string) || DEFAULT_INSTALL_NAME,
      (data.installPath as string | undefined) || undefined
    )
    if (!identity.ok) return identity
    data.name = identity.name
    if (identity.installPath) data.installPath = identity.installPath
    const entry = await installations.add({
      ...data,
      status: data.status ?? 'installing',
      seen: false
    })
    return { ok: true, entry }
  })

  ipcMain.handle('reorder-installations', async (_event, orderedIds: string[]) => {
    await installations.reorder(orderedIds)
  })

  ipcMain.handle('probe-installation', async (_event, dirPath: string) => {
    const results: Record<string, unknown>[] = []
    for (const source of sources) {
      if (source.probeInstallation) {
        const data = await source.probeInstallation(dirPath)
        if (data) {
          results.push({ sourceId: source.id, sourceLabel: source.label, ...data })
        }
      }
    }
    return results
  })

  ipcMain.handle('track-installation', async (_event, data: Record<string, unknown>) => {
    const duplicate = await findDuplicatePath(data.installPath as string)
    if (duplicate) {
      return { ok: false, message: `That directory is already used by "${duplicate.name}".` }
    }
    if (!fs.existsSync(data.installPath as string)) {
      return { ok: false, message: 'That directory does not exist.' }
    }
    try {
      fs.writeFileSync(path.join(data.installPath as string, MARKER_FILE), 'tracked')
    } catch (err) {
      return { ok: false, message: `Cannot write to directory: ${(err as Error).message}` }
    }
    const entry = await installations.add({ ...data, status: 'installed', seen: false })
    await syncOemSeedBestEffort()
    return { ok: true, entry }
  })

  ipcMain.handle('install-instance', async (event, installationId: string, express?: boolean) => {
    markInstallRunning(installationId)
    _broadcastToRenderer('installations-changed', {})
    try {
      return await installInstance(event, installationId, express)
    } finally {
      markInstallSettled(installationId)
      _broadcastToRenderer('installations-changed', {})
    }
  })

  async function installInstance(
    _event: Electron.IpcMainInvokeEvent,
    installationId: string,
    express?: boolean
  ): Promise<{ ok: boolean; message?: string; navigate?: string }> {
    const inst = await installations.get(installationId)
    if (!inst) return { ok: false, message: 'Installation not found.' }
    const source = sourceMap[inst.sourceId]
    if (!source) return { ok: false, message: i18n.t('errors.unknownSource') }
    if (_operationAborts.has(installationId)) {
      return { ok: false, message: 'Another operation is already running for this installation.' }
    }
    const sender = _event.sender

    const sendProgress = (phase: string, detail: Record<string, unknown>): void => {
      if (!sender.isDestroyed()) {
        sender.send('install-progress', { installationId, phase, ...detail })
      }
    }

    const priorComfyVersion = inst.comfyVersion as ComfyVersion | undefined
    const isComfyUpdate = priorComfyVersion != null

    if (source.install) {
      if (!isComfyUpdate) {
        mainTelemetry.registerPersonPropertiesOnce({
          first_local_install_dispatched_at: new Date().toISOString()
        })
      }
      fs.mkdirSync(inst.installPath, { recursive: true })
      fs.writeFileSync(path.join(inst.installPath, MARKER_FILE), installationId)
      if (source.installSteps) {
        let steps = [...source.installSteps]
        if (!inst.autoUpdateComfyUI) {
          steps = steps.filter((s) => s.phase !== 'update')
        }
        if (inst.pendingSnapshotRestore) {
          steps.push(
            { phase: 'restore-nodes', label: i18n.t('standalone.snapshotRestoreNodesPhase') },
            { phase: 'restore-pip', label: i18n.t('standalone.snapshotRestorePipPhase') }
          )
        }
        sendProgress('steps', { steps })
      }
      const abort = new AbortController()
      _operationAborts.set(installationId, abort)

      invalidateModelDownloadStartupPass()

      let snapshotRestoreError: string | null = null

      if (inst.bundledTemplateId && inst.downloadTemplateModels && inst.pendingTemplateOpen) {
        const sendTemplateOutput = (text: string): void => {
          try {
            if (!sender.isDestroyed()) sender.send('comfy-output', { installationId, text })
          } catch {}
          appendLog(installationId, text)
        }
        const sizeBytes = inst.bundledTemplateSizeBytes ?? 0
        startTemplateDownload(inst, sizeBytes, { sendOutput: sendTemplateOutput })
      }

      const cache = createCache(
        settings.get('cacheDir') as string,
        settings.get('maxCachedDownloads') as number
      )
      try {
        await source.install(inst, { sendProgress, download, cache, extract, signal: abort.signal })
        if (source.postInstall) {
          const update = (data: Record<string, unknown>): Promise<void> =>
            installations.update(installationId, data).then(() => {})
          await source.postInstall(inst, { sendProgress, update, signal: abort.signal })
        }

        const freshInst = await installations.get(installationId)
        const pendingFile = freshInst?.pendingSnapshotRestore as string | undefined
        if (freshInst && pendingFile) {
          const sendOutput = (text: string): void => {
            try {
              if (!sender.isDestroyed()) sender.send('comfy-output', { installationId, text })
            } catch {}
            appendLog(installationId, text)
          }
          const update = (data: Record<string, unknown>): Promise<void> =>
            installations.update(installationId, data).then(() => {})
          try {
            await restoreSnapshotIntoInstallation(
              freshInst,
              pendingFile,
              true,
              { sendProgress, sendOutput, signal: abort.signal },
              update
            )
          } catch (err) {
            if (abort.signal.aborted) throw err
            snapshotRestoreError = (err as Error).message
            await installations.update(installationId, { pendingSnapshotRestore: undefined })
            await fs.promises.unlink(pendingFile).catch(() => {})
          }
        }

        if (!snapshotRestoreError) sendProgress('done', { percent: 100, status: 'Complete' })
      } catch (err) {
        _operationAborts.delete(installationId)
        abortTemplateDownload(installationId)
        abortModelStaging(installationId)
        if (abort.signal.aborted) {
          if (isComfyUpdate) {
            mainTelemetry.emit('comfy.desktop.comfyui.update.applied', {
              installation_id: installationId,
              from_version: formatComfyVersion(priorComfyVersion, 'short'),
              to_version: null,
              result: 'cancelled'
            })
          }
          let cleaned = !fs.existsSync(inst.installPath)
          if (!cleaned) {
            try {
              fs.rmSync(inst.installPath, { recursive: true, force: true })
              cleaned = true
            } catch {}
          }
          if (cleaned) {
            await installations.remove(installationId)
            return { ok: true, navigate: 'list' }
          }
          const markerPath = path.join(inst.installPath, MARKER_FILE)
          try {
            fs.writeFileSync(markerPath, installationId)
          } catch {}
          await installations.update(installationId, { status: 'partial-delete' })
          const deleteAbort = new AbortController()
          _operationAborts.set(installationId, deleteAbort)
          sendProgress('delete', { percent: 0, status: 'Counting files…' })
          try {
            await deleteDir(
              inst.installPath,
              (p) => {
                sendProgress('delete', { percent: p.percent, status: formatDeleteStatus(p) })
              },
              { signal: deleteAbort.signal }
            )
            _operationAborts.delete(installationId)
            await installations.remove(installationId)
          } catch (_delErr) {
            _operationAborts.delete(installationId)
            if (deleteAbort.signal.aborted) {
              if (isEffectivelyEmptyInstallDir(inst.installPath)) {
                try {
                  fs.rmSync(inst.installPath, { recursive: true, force: true })
                } catch {}
                await installations.remove(installationId)
              } else {
                try {
                  fs.writeFileSync(markerPath, installationId)
                } catch {}
                await installations.update(installationId, { status: 'partial-delete' })
              }
            }
          }
          return { ok: true, navigate: 'list' }
        }
        await installations.update(installationId, { status: 'failed' })
        if (isComfyUpdate) {
          mainTelemetry.emit('comfy.desktop.comfyui.update.applied', {
            installation_id: installationId,
            from_version: formatComfyVersion(priorComfyVersion, 'short'),
            to_version: null,
            result: 'error',
            ...buildErrorFields(err)
          })
        }
        return { ok: false, message: (err as Error).message }
      }
      _operationAborts.delete(installationId)
      await installations.update(installationId, { status: 'installed' })
      await syncOemSeedBestEffort()
      if (isComfyUpdate) {
        const freshInst = await installations.get(installationId)
        const newComfyVersion = freshInst?.comfyVersion as ComfyVersion | undefined
        mainTelemetry.emit('comfy.desktop.comfyui.update.applied', {
          installation_id: installationId,
          from_version: formatComfyVersion(priorComfyVersion, 'short'),
          to_version: newComfyVersion ? formatComfyVersion(newComfyVersion, 'short') : null,
          result: 'success'
        })
      } else {
        mainTelemetry.captureInstallCompleted({
          installationId,
          method: express ? 'express' : 'manual',
          express: !!express
        })
      }
      if (snapshotRestoreError) {
        return snapshotRestoreFailureResult(installationId, snapshotRestoreError)
      }
      return { ok: true }
    }

    await installations.update(installationId, { status: 'failed' })
    return { ok: false, message: 'This source does not support installation.' }
  }

  ipcMain.handle('get-list-actions', async (_event, installationId: string) => {
    const inst = await installations.get(installationId)
    if (!inst) return []
    const source = sourceMap[inst.sourceId]
    if (!source) return []
    return source.getListActions ? source.getListActions(inst) : []
  })

  ipcMain.handle('skip-template-download', (_event, installationId: string) => {
    if (typeof installationId === 'string' && installationId) {
      requestSkipTemplateDownload(installationId)
    }
  })

  ipcMain.handle(
    'update-installation',
    async (_event, installationId: string, data: Record<string, unknown>) => {
      const inst = await installations.get(installationId)
      if (!inst) return { ok: false, message: 'Installation not found.' }
      const source = sourceMap[inst.sourceId]
      if (!source) return { ok: false, message: i18n.t('errors.unknownSource') }
      const sections = source.getDetailSections(inst)
      const allowedIds = new Set(['name', 'seen'])
      for (const section of sections) {
        const fields = (section as Record<string, unknown>).fields as
          | Record<string, unknown>[]
          | undefined
        if (!fields) continue
        for (const f of fields) {
          if ((f as Record<string, unknown>).editable && (f as Record<string, unknown>).id) {
            allowedIds.add((f as Record<string, unknown>).id as string)
          }
        }
      }
      if (inst.sourceId === installations.CLOUD_SOURCE_ID) {
        allowedIds.delete('name')
      }
      const filtered: Record<string, unknown> = {}
      for (const key of Object.keys(data)) {
        if (!allowedIds.has(key)) continue
        if (key === 'remoteUrl') {
          const parsed = parseUrl(data[key] as string)
          if (!parsed) return { ok: false, message: i18n.t('errors.invalidUrl') }
          filtered[key] = parsed.href
          continue
        }
        filtered[key] = key === 'envVars' ? sanitizeEnvVars(data[key]) : data[key]
      }
      if (filtered.name && filtered.name !== inst.name) {
        if (await installations.hasNameConflict(installationId, filtered.name as string)) {
          return {
            ok: false,
            message: i18n.t('errors.duplicateName', { name: filtered.name as string })
          }
        }
      }
      await installations.update(installationId, filtered)
      return { ok: true }
    }
  )

  ipcMain.handle('get-detail-sections', async (_event, installationId: string) => {
    recordIpcInvocation('get-detail-sections', installationId)
    const inst = await installations.get(installationId)
    if (!inst) return []
    _kickReleaseCachePrewarm([inst])
    const source = sourceMap[inst.sourceId]
    if (!source) {
      const actions = [untrackAction()]
      if (inst.installPath && fs.existsSync(inst.installPath)) {
        actions.unshift(deleteAction(inst))
      }
      return [
        {
          title: '',
          description: i18n.t('errors.unknownSource')
        },
        {
          pinBottom: true,
          actions
        }
      ]
    }
    if (inst.installPath) {
      const comfyuiDir = path.join(inst.installPath, 'ComfyUI')
      if (hasGitDir(comfyuiDir)) {
        void releaseCache.enrichCommitsAhead(COMFYUI_REPO, comfyuiDir).catch((err) => {
          console.warn('[get-detail-sections] enrichCommitsAhead failed:', err)
        })
      }
    }
    const sections = source.getDetailSections(inst)
    const running = _runningSessions.get(installationId)
    if (running?.port) {
      sections.push({
        tab: 'status',
        fields: [{ key: 'active-port', label: i18n.t('common.port'), value: String(running.port) }]
      })
    }
    return sections
  })

  ipcMain.handle('get-core-beta-args', (_event, installationId: string, launchArgs?: unknown) => {
    recordIpcInvocation('get-core-beta-args', installationId)
    return answerCoreBetaArgs(installationId, launchArgs, {
      sessionArgs: (id) => {
        const running = _runningSessions.get(id)
        return running ? (running.coreBetaArgs ?? []) : null
      },
      record: (id) => installations.get(id),
      launchCommand: (inst) => sourceMap[inst.sourceId]?.getLaunchCommand(inst) ?? null
    })
  })

  ipcMain.handle(
    'get-comfy-args',
    async (
      _event,
      installationId: string
    ): Promise<{ args: ComfyArgDef[]; error?: string } | null> => {
      const inst = await installations.get(installationId)
      if (!inst) return { args: [], error: 'Installation not found' }
      const source = sourceMap[inst.sourceId]
      if (!source) return { args: [], error: `Unknown source: ${inst.sourceId}` }
      const launchCmd = source.getLaunchCommand(inst)
      if (!launchCmd?.cmd || !launchCmd.args || !launchCmd.cwd) {
        return { args: [], error: `No launch command available (source: ${inst.sourceId})` }
      }
      const sIdx = launchCmd.args.indexOf('-s')
      if (sIdx === -1 || sIdx + 1 >= launchCmd.args.length) {
        return { args: [], error: `No -s flag in launch args: [${launchCmd.args.join(', ')}]` }
      }
      const mainPyRel = launchCmd.args[sIdx + 1]!
      const mainPyAbs = path.resolve(launchCmd.cwd, mainPyRel)
      try {
        const schema = await getComfyArgsSchema(
          launchCmd.cmd,
          mainPyAbs,
          launchCmd.cwd,
          installationId,
          inst.comfyVersion?.commit ?? (inst.version as string | undefined)
        )
        return { args: schema.args }
      } catch (err) {
        const msg = (err as Error).message ?? String(err)
        console.warn('[get-comfy-args] Failed to get schema:', msg)
        return { args: [], error: msg }
      }
    }
  )
}
