import type { KnownSettings } from '../../../main/settings'
import type {
  AuthStatus,
  ElectronApi,
  Installation,
  Unsubscribe,
  Workspace
} from '../../../types/ipc'
import { en } from '../lib/i18nMessages'
import {
  APP_CARDS,
  HOME_WORKFLOWS,
  SOURCES,
  fieldOptionsFor,
  previewMachine,
  type PreviewMachine,
  type PreviewPlatform
} from './fixtures'

type CloudApi = ElectronApi['comfybuilder']

export type BridgeEvent = Extract<keyof ElectronApi, `on${string}`>

type AnyListener = (...args: never[]) => void

type ListenerOf<K extends BridgeEvent> = ElectronApi[K] extends (
  callback: infer Callback extends AnyListener
) => Unsubscribe
  ? Callback
  : never

type BridgeCalls = Omit<ElectronApi, BridgeEvent | 'platform' | 'comfybuilder'>

export interface BridgeSeed {
  platform?: PreviewPlatform
  installations?: Installation[]
  settings?: Partial<KnownSettings>
  auth?: AuthStatus
  workspaces?: Workspace[]
  replies?: Partial<BridgeCalls>
  cloud?: Partial<Omit<CloudApi, 'onAuthChanged'>>
}

export interface FakeBridge {
  api: ElectronApi
  machine: PreviewMachine
  installations: Installation[]
  settings: KnownSettings
  emit<K extends BridgeEvent>(event: K, ...args: Parameters<ListenerOf<K>>): void
  emitAuthChanged(status: AuthStatus): void
  reply(replies: Partial<BridgeCalls>): void
  quiet(): Promise<void>
}

const QUIET_AFTER_MS = 120

const SIGNED_OUT: AuthStatus = { signedIn: false }

function defaultSettings(machine: PreviewMachine): KnownSettings {
  const root = machine.installRoot.replace(/ComfyUI-Installs$/, 'ComfyUI-Shared')
  const sep = machine.platform === 'win32' ? '\\' : '/'
  return {
    cacheDir: `${root}${sep}cache`,
    maxCachedDownloads: 5,
    onAppClose: 'tray',
    modelsDirs: [`${root}${sep}models`],
    inputDir: `${root}${sep}input`,
    outputDir: `${root}${sep}output`,
    installDir: machine.installRoot,
    firstUseCompleted: true,
    telemetryEnabled: false,
    betaFeaturesEnabled: false,
    autoUpdate: true
  }
}

export function createFakeBridge(seed: BridgeSeed = {}): FakeBridge {
  const machine = previewMachine(seed.platform ?? 'darwin')
  const installations = [...(seed.installations ?? [])]
  const settings: KnownSettings = { ...defaultSettings(machine), ...seed.settings }
  const listeners = new Map<string, Set<AnyListener>>()
  const authListeners = new Set<(status: AuthStatus) => void>()
  let auth = seed.auth ?? SIGNED_OUT
  let homeTourReplay = { id: 0, pending: false }
  let lastActivityAt = performance.now()

  function noteActivity(): void {
    lastActivityAt = performance.now()
  }

  function noteCallsTo<T extends object>(target: T): T {
    const members = target as Record<string, unknown>
    for (const [name, member] of Object.entries(members)) {
      if (typeof member !== 'function') continue
      members[name] = (...args: unknown[]): unknown => {
        noteActivity()
        const result: unknown = member(...args)
        if (result instanceof Promise) result.then(noteActivity, noteActivity)
        return result
      }
    }
    return target
  }

  function quiet(): Promise<void> {
    return new Promise((resolve) => {
      const check = (): void => {
        const remaining = QUIET_AFTER_MS - (performance.now() - lastActivityAt)
        if (remaining <= 0) resolve()
        else setTimeout(check, remaining)
      }
      check()
    })
  }

  function listen<K extends BridgeEvent>(event: K): ElectronApi[K] {
    const subscribe = (callback: AnyListener): Unsubscribe => {
      const set = listeners.get(event) ?? new Set<AnyListener>()
      listeners.set(event, set)
      set.add(callback)
      return () => set.delete(callback)
    }
    return subscribe as unknown as ElectronApi[K]
  }

  function emit<K extends BridgeEvent>(event: K, ...args: Parameters<ListenerOf<K>>): void {
    for (const listener of [...(listeners.get(event) ?? [])]) {
      ;(listener as (...values: unknown[]) => void)(...args)
    }
  }

  function emitAuthChanged(status: AuthStatus): void {
    auth = status
    for (const listener of [...authListeners]) listener(status)
  }

  const defaults: BridgeCalls = {
    getSources: async () => SOURCES,
    getFieldOptions: async (_sourceId, fieldId) => fieldOptionsFor(machine, fieldId),
    buildInstallation: async (sourceId, selections) => ({
      sourceId,
      sourceLabel: SOURCES.find((source) => source.id === sourceId)?.label ?? sourceId,
      sourceCategory: SOURCES.find((source) => source.id === sourceId)?.category ?? 'local',
      version: selections.comfyVersion?.value,
      variant: selections.variant?.value
    }),
    getDefaultInstallDir: async () => machine.installRoot,
    detectGPU: async () => machine.gpu,
    validateHardware: async () => ({ supported: true }),
    checkNvidiaDriver: async () => null,

    browseFolder: async () => null,
    importPerformanceTestWorkflow: async () => ({ ok: false, canceled: true }),
    getPerformanceTestExampleWorkflows: async () => ({ options: [], diskSpace: null }),
    preparePerformanceTestExampleWorkflow: async () => ({ ok: false, reason: 'unavailable' }),
    deletePerformanceTestWorkflow: async () => ({ ok: true, status: 'deleted' }),
    savePerformanceTestLogs: async () => ({ ok: true }),
    listPerformanceTestBenchmarks: async (folderPath) => ({
      folderPath: folderPath ?? settings.outputDir,
      benchmarks: []
    }),
    deletePerformanceTestBenchmark: async () => ({ ok: true }),
    renamePerformanceTestBenchmark: async (_folderPath, _sessionId, newSessionId) => ({
      ok: true,
      sessionId: newSessionId
    }),
    runPerformanceTestWorkflow: async () => ({
      ok: false,
      submitted: 0,
      preparationRuns: 0,
      totalSubmitted: 0,
      cancelled: true
    }),
    readPerformanceTestResultsSummary: async () => ({
      createdAt: '2026-11-14T09:30:00.000Z',
      instance: { id: '', name: '' },
      workspace: { id: null, name: null },
      workflowName: '',
      fastestJobDurationSeconds: null,
      slowestJobDurationSeconds: null,
      averageJobDurationSeconds: null,
      medianJobDurationSeconds: null,
      measuredJobCount: 0,
      failedRunCount: 0,
      hardware: null,
      systemInfo: machine.systemInfo
    }),
    exportResultsImage: async () => ({ ok: false, canceled: true }),
    openPath: async () => {},
    revealPath: () => {},
    openExternal: async () => {},
    getDiskSpace: async () => ({ free: machine.diskFreeBytes, total: machine.diskTotalBytes }),
    logsSnapshot: async () => '',
    openLogsWindow: async () => {},
    validateInstallPath: async () => [],
    getInstallationSize: async () => ({ sizeBytes: 0 }),
    cancelInstallationSize: async () => {},

    getLocaleMessages: async () => en,
    getAvailableLocales: async () => [{ value: 'en', label: 'English' }],
    getLocale: async () => 'en',

    getFirstUseState: async () => ({ skipPick: false, hasLegacyDesktop: false }),

    getInstallations: async () => installations.map((inst) => ({ ...inst })),
    getInstallationsSummary: async () => ({
      localCount: installations.filter((inst) => inst.sourceCategory === 'local').length,
      hasLaunchedCloud: installations.some(
        (inst) => inst.sourceCategory === 'cloud' && inst.lastLaunchedAt !== undefined
      ),
      hasLegacyDesktop: false
    }),
    addInstallation: async (data) => {
      const entry: Installation = {
        id: `inst-${installations.length + 1}`,
        name: String(data.name ?? 'ComfyUI'),
        sourceLabel: String(data.sourceLabel ?? 'Standalone'),
        sourceCategory: String(data.sourceCategory ?? 'local'),
        ...data,
        status: 'pending'
      }
      installations.push(entry)
      emit('onInstallationsChanged')
      return { ok: true, entry }
    },
    reorderInstallations: async (orderedIds) => {
      installations.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id))
    },
    probeInstallation: async () => [],
    trackInstallation: async () => ({ ok: true }),
    installInstance: async () => {},
    updateInstallation: async (installationId, data) => {
      const target = installations.find((inst) => inst.id === installationId)
      if (target) Object.assign(target, data)
      emit('onInstallationsChanged')
    },

    stopComfyUI: async () => {},
    focusComfyWindow: async () => false,

    terminalSubscribe: async () => ({ buffer: [], size: { cols: 80, rows: 24 }, exited: false }),
    terminalUnsubscribe: async () => {},
    terminalWrite: async () => {},
    terminalResize: async () => {},
    terminalRestart: async () => ({ buffer: [], size: { cols: 80, rows: 24 }, exited: false }),
    openInstallWindow: async () => true,
    closeComfyWindow: async () => true,
    closeHostWindow: async () => true,
    returnToDashboard: async () => true,
    closeCurrentPanel: () => {},
    closeAnnouncement: () => {},
    signalOverlayReady: () => {},
    navigatePanel: () => {},
    openPageInNewWindow: () => {},
    listAssets: async () => ({ assets: [], total: 0 }),
    listOutputFolders: async () => ({
      home: '/Users/you',
      shared: '/Users/you/Documents/ComfyUI/output',
      ofBuild: {}
    }),
    openOutputFolder: async () => true,
    listLocalAssets: async () => ({
      assets: [],
      total: 0,
      counts: { all: 0, image: 0, video: 0, audio: 0, '3d': 0 }
    }),
    downloadAsset: async () => true,
    revealAsset: async () => true,
    openAsset: async () => true,
    findCloudAsset: async () => ({ status: 'absent' }),
    copyAsset: async () => true,
    readAssetModel: async () => null,
    hasAssetWorkflow: async () => false,
    openAssetWorkflow: async () => ({ opened: true }),
    trashAsset: async () => true,
    listHomeWorkflows: async () => HOME_WORKFLOWS,
    openCatalogWorkflow: async () => true,
    getAppsEnabled: async () => true,
    listApps: async () => APP_CARDS,
    showAppPage: async () => 'ready',
    captureAppPage: async () => null,
    hideAppPage: () => {},
    sendAppOutputAction: () => {},
    sendAppRequest: async () => true,
    getBuildStorageSnapshot: async () => ({
      sharedDirectoriesFields: [],
      modelsDirs: settings.modelsDirs.map((path, index) => ({ path, isPrimary: index === 0 })),
      modelsSystemDefault: settings.modelsDirs[0] ?? ''
    }),
    openGlobalSettings: () => {},
    openInstancePicker: () => {},
    setFirstUseMode: () => {},
    respondCloseRequest: () => {},
    ackCloseRequest: () => {},
    respondReturnToDashboardRequest: () => {},
    ackReturnToDashboardRequest: () => {},
    transferHostBoundsToInstall: async () => true,
    claimAttachHost: async () => true,
    releaseAttachHostPreview: async () => true,
    getRunningInstances: async () => [],
    getLaunchingInstances: async () => [],
    getStoppingInstances: async () => [],
    getActiveOperations: async () => [],
    getLastCrashError: async () => null,
    getCrashInstances: async () => [],
    cancelLaunch: async () => {},
    cancelOperation: async () => {},
    killPortProcess: async () => ({ ok: true }),

    getListActions: async () => [],
    getDetailSections: async () => [],
    getComfyArgs: async () => ({ args: [] }),
    getCoreBetaArgs: async () => ({ timing: 'next-launch', args: [] }),
    runAction: async () => ({ ok: true }),

    getSnapshots: async () => ({
      snapshots: [],
      copyEvents: [],
      totalCount: 0,
      context: { updateChannel: 'stable', pythonVersion: '3.12.9', variant: '', variantLabel: '' }
    }),
    getSnapshotDetail: async (_installationId, filename) => ({
      filename,
      createdAt: '2026-11-14T09:30:00.000Z',
      trigger: 'manual',
      label: null,
      comfyuiVersion: '',
      comfyui: { ref: '', commit: null, releaseTag: '', variant: '' },
      customNodes: [],
      pipPackageCount: 0,
      pipPackages: {}
    }),
    getSnapshotDiff: async (_installationId, _filename, mode) => ({
      mode,
      baseLabel: '',
      empty: true,
      diff: {
        comfyuiChanged: false,
        updateChannelChanged: false,
        nodesAdded: [],
        nodesRemoved: [],
        nodesChanged: [],
        pipsAdded: [],
        pipsRemoved: [],
        pipsChanged: []
      }
    }),
    exportSnapshot: async () => ({ ok: true }),
    exportAllSnapshots: async () => ({ ok: true }),
    importSnapshotsPreview: async () => ({ ok: false }),
    importSnapshotsDiff: async () => ({ ok: false }),
    importSnapshotsConfirm: async () => ({ ok: false }),
    previewSnapshotFile: async () => ({ ok: false }),
    previewLocalMigration: async () => ({ ok: false }),
    previewSnapshotPath: async () => ({ ok: false }),
    createFromSnapshot: async () => ({ ok: false }),
    getPathForFile: (file) => file.name,

    getSettingsSections: async () => [],
    getModelsSections: async () => ({
      systemDefault: settings.modelsDirs[0] ?? '',
      sections: []
    }),
    getMediaSections: async () => [],
    getUniqueName: async (baseName) => {
      const taken = new Set(installations.map((inst) => inst.name))
      if (!taken.has(baseName)) return baseName
      let suffix = 2
      while (taken.has(`${baseName} ${suffix}`)) suffix += 1
      return `${baseName} ${suffix}`
    },
    setSetting: async (key, value) => {
      settings[key] = value
      emit('onSettingsChanged', { key })
    },
    getSetting: async (key) => settings[key],
    getHomeTourReplay: async () => ({ ...homeTourReplay }),
    showHome: () => {},
    requestHomeTourReplay: async () => {
      homeTourReplay = { id: homeTourReplay.id + 1, pending: true }
      emit('onHomeTourReplayChanged', { ...homeTourReplay, finished: false })
      return homeTourReplay.id
    },
    finishHomeTour: async (shownReplayId) => {
      if (shownReplayId === homeTourReplay.id)
        homeTourReplay = { ...homeTourReplay, pending: false }
      emit('onHomeTourReplayChanged', { ...homeTourReplay, finished: true })
    },

    getPendingBetaNotice: async () => null,
    acknowledgeBetaNotice: async () => {},

    getResolvedTheme: async () => 'dark',

    getAppVersion: async () => machine.systemInfo.app_version,
    getStableTags: async () => [],
    getCloudUserTier: async () => 'unknown',
    refreshCreditBalance: async () =>
      auth.signedIn ? { status: 'ready', cents: 2_000 } : { status: 'signed_out' },
    getCloudFreeRunsEnabled: async () => false,
    quitApp: async () => {},
    relaunchApp: async () => {},
    resetZoom: async () => {},
    getSystemInfo: async () => ({
      ...machine.systemInfo,
      installation_count: installations.length
    }),
    getInstallationDdContext: async () => null,
    getInstallsInventory: async () => ({
      total_install_count: installations.length,
      included_install_count: 0,
      truncated: false,
      installs: []
    }),
    getDeviceId: async () => 'preview-device',

    checkForUpdate: async () => ({ available: false }),
    downloadUpdate: async () => {},
    installUpdate: async () => {},
    getUpdateCapabilities: async () => ({ canAutoUpdate: true, systemManaged: false }),
    getAppUpdateState: async () => ({ kind: null, version: null, autoUpdate: true }),

    listModelDownloads: async () => [],
    pauseModelDownload: async () => true,
    resumeModelDownload: async () => true,
    cancelModelDownload: async () => true,
    dismissModelDownload: async () => true,
    clearFinishedModelDownloads: async () => 0,
    retryModelDownload: async () => true,
    showDownloadInFolder: async () => {},
    getDownloadThumbnail: async () => null,

    ackAdoptPrompt: () => {},
    respondAdoptPrompt: () => {},

    captureTelemetry: () => {},
    captureExceptionTelemetry: () => {},
    registerTelemetryProperties: () => {},
    telemetryGetExperimentFlag: async () => null,
    telemetryRecordExposure: () => {}
  }

  const cloud: CloudApi = {
    signIn: async () => auth,
    signOut: async () => {
      emitAuthChanged(SIGNED_OUT)
      return SIGNED_OUT
    },
    getAuthStatus: async () => auth,
    onAuthChanged: (callback) => {
      authListeners.add(callback)
      return () => authListeners.delete(callback)
    },
    listWorkspaces: async () => seed.workspaces ?? [],
    switchWorkspace: async () => auth,
    listBuilds: async () => [],
    openBuildsPage: async () => {},
    openSettingsPage: async () => {},
    installBuild: async () => ({ ok: false }),
    promoteLocalInstance: async () => ({ ok: false }),
    ...seed.cloud
  }

  const api: ElectronApi = noteCallsTo({
    platform: machine.platform,
    comfybuilder: noteCallsTo(cloud),
    ...defaults,
    ...seed.replies,

    onAppPageStatusChanged: listen('onAppPageStatusChanged'),
    onAppPageClosed: listen('onAppPageClosed'),
    onAppOutputs: listen('onAppOutputs'),
    onCreditBalanceChanged: listen('onCreditBalanceChanged'),
    onFirstUseSkip: listen('onFirstUseSkip'),
    onOpenFeedback: listen('onOpenFeedback'),
    onOpenAnnouncement: listen('onOpenAnnouncement'),
    onCloseRequest: listen('onCloseRequest'),
    onReturnToDashboardRequest: listen('onReturnToDashboardRequest'),
    onAdoptPrompt: listen('onAdoptPrompt'),
    onInstallProgress: listen('onInstallProgress'),
    onComfyOutput: listen('onComfyOutput'),
    onPerformanceTestProgress: listen('onPerformanceTestProgress'),
    onPerformanceTestExampleDownload: listen('onPerformanceTestExampleDownload'),
    onComfyExited: listen('onComfyExited'),
    onInstanceCrashed: listen('onInstanceCrashed'),
    onTerminalOutput: listen('onTerminalOutput'),
    onTerminalExited: listen('onTerminalExited'),
    onComfyBootLog: listen('onComfyBootLog'),
    onInstanceLaunching: listen('onInstanceLaunching'),
    onInstanceLaunchFailed: listen('onInstanceLaunchFailed'),
    onInstanceStarted: listen('onInstanceStarted'),
    onInstanceStopping: listen('onInstanceStopping'),
    onInstanceStopped: listen('onInstanceStopped'),
    onOperationChanged: listen('onOperationChanged'),
    onThemeChanged: listen('onThemeChanged'),
    onLocaleChanged: listen('onLocaleChanged'),
    onConfirmQuit: listen('onConfirmQuit'),
    onInstallationsChanged: listen('onInstallationsChanged'),
    onInstallationsVersionsUpdated: listen('onInstallationsVersionsUpdated'),
    onReleaseCacheEnriched: listen('onReleaseCacheEnriched'),
    onAppUpdatePromptRestart: listen('onAppUpdatePromptRestart'),
    onAppUpdateStateChanged: listen('onAppUpdateStateChanged'),
    onAppUpdateDownloadProgress: listen('onAppUpdateDownloadProgress'),
    onAppUpdateUserActionFailed: listen('onAppUpdateUserActionFailed'),
    onZoomChanged: listen('onZoomChanged'),
    onModelDownloadProgress: listen('onModelDownloadProgress'),
    onModelDownloadRemoved: listen('onModelDownloadRemoved'),
    onModelDownloadsClearedFinished: listen('onModelDownloadsClearedFinished'),
    onTelemetrySettingChanged: listen('onTelemetrySettingChanged'),
    onDatadogError: listen('onDatadogError'),
    onTelemetryActionFromMain: listen('onTelemetryActionFromMain'),
    onErrorDetail: listen('onErrorDetail'),
    onSuggestChineseMirrors: listen('onSuggestChineseMirrors'),
    onSettingsChanged: listen('onSettingsChanged'),
    onHomeTourReplayChanged: listen('onHomeTourReplayChanged'),
    onPanelSwitch: listen('onPanelSwitch'),
    onPanelTriggerOverlay: listen('onPanelTriggerOverlay')
  })

  return {
    api,
    machine,
    installations,
    settings,
    emit,
    emitAuthChanged,
    reply: (replies) => void Object.assign(api, noteCallsTo({ ...replies })),
    quiet
  }
}
