import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { Category, ViewKind } from '../shared/viewKind'
import { PICKER_SETTINGS_CHANNELS as CH, POPUP_KIND } from '../types/ipc'
import type { PopupTheme, TerminalRestore } from '../types/ipc'

export interface TitlePopupMenuItem {
  id?: string
  label?: string
  labelKey?: string
  checked?: boolean
  kind?: 'separator'
}

export interface PopupInstancePickerInstall {
  id: string
  name: string
  sourceLabel: string
  sourceCategory: string
  version?: string
  statusTag?: { style: string; label: string; detail?: string }
  lastLaunchedAt?: number
  installPath?: string
  status?: string
  [key: string]: unknown
}

export interface PopupInstancePickerSnapshot {
  installs: PopupInstancePickerInstall[]
  activeInstallationId: string | null
  currentView?: ViewKind
  currentCategory?: Category | null
  runningInstallationIds: string[]
  selectedInstallationId: string | null
  pickerSelectionEpoch?: number
  selectedSettings: Record<string, unknown>[] | null
  selectedSnapshots: Record<string, unknown> | null
  initialTab: string | null
  autoAction: string | null
  autoActionNonce: number
  operatingInstallationIds: string[]
  installOperationStatus: Record<
    string,
    {
      status: string
      percent: number
      done: boolean
      ok: boolean | null
      error: string | null
      cancellable: boolean
      title: string
      actionId: string
      actionData?: Record<string, unknown>
    }
  >
}

export interface PopupGlobalSettingsModelsDir {
  path: string
  isPrimary: boolean
}

export interface PopupGlobalSettingsSnapshot {
  initialTab: 'general' | 'updates' | 'storage' | 'advanced' | 'logs' | null
  languageFields: Record<string, unknown>[]
  generalFields: Record<string, unknown>[]
  telemetryFields: Record<string, unknown>[]
  desktopUpdateFields: Record<string, unknown>[]
  cacheFields: Record<string, unknown>[]
  advancedFields: Record<string, unknown>[]
  sharedDirectoriesFields: Record<string, unknown>[]
  installLocationFields: Record<string, unknown>[]
  modelsDirs: PopupGlobalSettingsModelsDir[]
  modelsSystemDefault: string
  telemetryGranted: boolean
  appUpdate: {
    state: Record<string, unknown>
    progress: Record<string, unknown> | null
    isDownloading: boolean
    capabilities: { systemManaged: boolean; canSelfUpdate: boolean }
    installedVersion: string
    platform: NodeJS.Platform
    lastCheckedAt: number | null
  }
  githubUrl: string
  githubStars: number | null
  githubStarsLoading: boolean
  i18n: {
    overview: string
    updates: string
    storage: string
    models: string
    advanced: string
    logs: string
    sharedDirectories: string
  }
}

export type TitlePopupConfig =
  | { kind: typeof POPUP_KIND.menu; items: TitlePopupMenuItem[]; theme: PopupTheme }
  | { kind: typeof POPUP_KIND.downloads; theme: PopupTheme }
  | { kind: typeof POPUP_KIND.downloadsFull; theme: PopupTheme }
  | {
      kind: typeof POPUP_KIND.instancePicker
      snapshot: PopupInstancePickerSnapshot
      theme: PopupTheme
    }
  | {
      kind: typeof POPUP_KIND.globalSettings
      snapshot: PopupGlobalSettingsSnapshot
      theme: PopupTheme
    }

export interface PopupDownloadEntry {
  id?: string
  url: string
  filename: string
  directory?: string
  savePath?: string
  progress: number
  receivedBytes?: number
  totalBytes?: number
  speedBytesPerSec?: number
  etaSeconds?: number
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'
  error?: string
  createdAt?: number
  isImage?: boolean
}

export interface PopupDownloadsState {
  active: PopupDownloadEntry[]
  recent: PopupDownloadEntry[]
}

export type PopupDownloadAction =
  | { action: 'pause'; ref?: string; url: string }
  | { action: 'resume'; ref?: string; url: string }
  | { action: 'cancel'; ref?: string; url: string }
  | { action: 'show-in-folder'; ref?: string; url: string; savePath: string }
  | { action: 'dismiss'; ref?: string; url: string }
  | { action: 'retry'; ref?: string; url: string }
  | { action: 'clear-finished' }

export type PopupSettingsTab = 'comfy' | 'directories' | 'downloads' | 'global' | 'global-storage'

export interface ComfyTitlePopupBridge {
  platform: NodeJS.Platform
  activate(id: string): void
  close(): void
  ready(): void
  notifyRendered(): void
  onConfig(cb: (config: TitlePopupConfig) => void): () => void
  onDownloadsChanged(cb: (state: PopupDownloadsState) => void): () => void
  downloadsAction(action: PopupDownloadAction): void
  openSettingsTab(tab: PopupSettingsTab): void
  openDownloadsModal(): void
  requestSize(height: number): void
  onInstancePickerSnapshot(cb: (snapshot: PopupInstancePickerSnapshot) => void): () => void
  pickInstall(installationId: string): void
  openInstallNewWindow(installationId: string, opts?: { allowDuplicate?: boolean }): void
  openNewInstall(): void
  restartInstall(installationId: string, opts?: { confirmed?: boolean }): void
  getDownloadThumbnail(savePath: string): Promise<string | null>
  setPickerSelectedInstall(installationId: string | null): void
  pickerUpdateField(
    installationId: string,
    fieldId: string,
    value: unknown
  ): Promise<{ ok: boolean; message?: string }>
  pickerRunAction(
    installationId: string,
    actionId: 'snapshot-save' | 'snapshot-restore' | 'snapshot-delete',
    actionData?: Record<string, unknown>
  ): Promise<{ ok: boolean; message?: string }>
  openInstallAction(installationId: string, actionId: string): void
  onWillShow(cb: (info: { kind: TitlePopupConfig['kind'] }) => void): () => void
  onGlobalSettingsSnapshot(cb: (snapshot: PopupGlobalSettingsSnapshot) => void): () => void
  globalSettingsUpdateField(
    fieldId: string,
    value: unknown
  ): Promise<{ ok: boolean; message?: string }>
  globalSettingsSetModelsDirs(dirs: string[]): Promise<{ ok: boolean }>
  globalSettingsBrowseFolder(defaultPath?: string): Promise<string | null>
  globalSettingsOpenPath(path: string): void
  globalSettingsOpenLogsFolder(): void
  globalSettingsRevealPath(path: string): void
  globalSettingsOpenExternal(url: string): void
  globalSettingsCheckForUpdate(): Promise<{ available: boolean; version?: string; error?: string }>
  globalSettingsDownloadUpdate(): Promise<void>
  globalSettingsInstallUpdate(): void
  globalSettingsSetLastCheckedAt(value: number): void

  pickerSettingsGetDetailSections(installationId: string): Promise<Record<string, unknown>[]>
  pickerSettingsGetDiskSpace(path: string): Promise<{ total: number; free: number }>
  pickerSettingsUpdateInstallation(
    installationId: string,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown> | void>
  pickerSettingsRunAction(
    installationId: string,
    actionId: string,
    actionData?: Record<string, unknown>
  ): Promise<Record<string, unknown>>
  pickerSettingsGetFieldOptions(
    sourceId: string,
    fieldId: string,
    selections: Record<string, unknown>
  ): Promise<Record<string, unknown>[]>
  pickerSettingsGetStableTags(): Promise<string[]>
  pickerSettingsGetUniqueName(baseName: string): Promise<string>
  pickerSettingsGetInstallations(): Promise<Record<string, unknown>[]>
  pickerSettingsGetInstallationSize(installationId: string): Promise<{ sizeBytes: number }>
  pickerSettingsStopComfyUI(installationId: string): Promise<void>
  pickerSettingsGetSnapshots(installationId: string): Promise<Record<string, unknown>>
  pickerSettingsGetSnapshotDetail(
    installationId: string,
    filename: string
  ): Promise<Record<string, unknown>>
  pickerSettingsGetSnapshotDiff(
    installationId: string,
    filename: string,
    mode: 'previous' | 'current'
  ): Promise<Record<string, unknown>>
  pickerSettingsExportSnapshot(
    installationId: string,
    filename: string
  ): Promise<{ ok: boolean; message?: string }>
  pickerSettingsExportAllSnapshots(
    installationId: string
  ): Promise<{ ok: boolean; message?: string }>
  pickerSettingsImportSnapshotsPreview(): Promise<{
    ok: boolean
    preview?: Record<string, unknown>
    message?: string
  }>
  pickerSettingsImportSnapshotsDiff(
    installationId: string
  ): Promise<{ ok: boolean; diff?: Record<string, unknown>; message?: string }>
  pickerSettingsImportSnapshotsConfirm(installationId: string): Promise<{
    ok: boolean
    imported?: number
    restoreToken?: string
    message?: string
  }>
  pickerSettingsPreviewSnapshotFile(): Promise<{
    ok: boolean
    preview?: Record<string, unknown>
    message?: string
  }>
  pickerSettingsGetComfyArgs(
    installationId: string
  ): Promise<{ args: Record<string, unknown>[]; error?: string } | null>
  pickerSettingsGetCoreBetaArgs(
    installationId: string,
    launchArgs?: string
  ): Promise<{ timing: 'session' | 'next-launch'; args: { arg: string; name: string | null }[] }>
  pickerSettingsBrowseFolder(opts?: { defaultPath?: string }): Promise<string | null>
  pickerSettingsCancelOperation(installationId: string): Promise<void>
  pickerSettingsPreviewLocalMigration(installationId: string): Promise<Record<string, unknown>>
  terminalSubscribe(installationId: string): Promise<TerminalRestore>
  terminalUnsubscribe(installationId: string): Promise<void>
  terminalWrite(installationId: string, data: string): Promise<void>
  terminalResize(installationId: string, cols: number, rows: number): Promise<void>
  terminalRestart(installationId: string): Promise<TerminalRestore>
  onTerminalOutput(callback: (data: { installationId: string; data: string }) => void): () => void
  onTerminalExited(callback: (data: { installationId: string }) => void): () => void
  pickerSettingsRelaunchApp(): void
  pickerSettingsOpenGlobalSettings(
    tab?: 'general' | 'updates' | 'storage' | 'advanced' | 'logs',
    opts?: { highlightField?: string }
  ): void
  pickerSettingsGetLocaleMessages(): Promise<Record<string, unknown>>
  pickerSettingsGetLocale(): Promise<string>
  pickerSettingsOnLocaleChanged(
    cb: (payload: { locale: string; messages: Record<string, unknown> }) => void
  ): () => void
  pickerSettingsOnReleaseCacheEnriched(callback: (data: { repo: string }) => void): () => void
  pickerForwardShowProgress(payload: {
    installationId: string
    actionId: string
    actionData?: Record<string, unknown>
    title: string
    cancellable?: boolean
    triggersInstanceStart?: boolean
    opKind?: 'launch' | 'install' | 'update' | 'destructive' | 'snapshot' | 'generic'
    isRestart?: boolean
    routing?: 'same-host' | 'target-host' | 'inline-picker'
    successChoice?: boolean
  }): void
  pickerStartBackgroundOp(payload: {
    installationId: string
    actionId: string
    actionData?: Record<string, unknown>
    title: string
    cancellable: boolean
  }): void
  pickerCancelBackgroundOp(installationId: string): void
  pickerDismissBackgroundOp(installationId: string): void
  onDismissModals(cb: () => void): () => void
}

function isPopupConfig(value: unknown): value is TitlePopupConfig {
  if (!value || typeof value !== 'object') return false
  const v = value as {
    kind?: unknown
    items?: unknown
    theme?: unknown
    snapshot?: unknown
  }
  if (
    v.kind !== POPUP_KIND.menu &&
    v.kind !== POPUP_KIND.downloads &&
    v.kind !== POPUP_KIND.downloadsFull &&
    v.kind !== POPUP_KIND.instancePicker &&
    v.kind !== POPUP_KIND.globalSettings
  )
    return false
  if (!v.theme || typeof v.theme !== 'object') return false
  const theme = v.theme as { bg?: unknown; text?: unknown }
  if (typeof theme.bg !== 'string' || typeof theme.text !== 'string') return false
  if (v.kind === POPUP_KIND.menu && !Array.isArray(v.items)) return false
  if (v.kind === POPUP_KIND.instancePicker && !isInstancePickerSnapshot(v.snapshot)) return false
  if (v.kind === POPUP_KIND.globalSettings && !isGlobalSettingsSnapshot(v.snapshot)) return false
  return true
}

function isGlobalSettingsSnapshot(value: unknown): value is PopupGlobalSettingsSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const tab = v['initialTab']
  if (
    tab !== null &&
    tab !== 'general' &&
    tab !== 'updates' &&
    tab !== 'storage' &&
    tab !== 'advanced' &&
    tab !== 'logs'
  ) {
    return false
  }
  if (!Array.isArray(v['languageFields'])) return false
  if (!Array.isArray(v['generalFields'])) return false
  if (!Array.isArray(v['telemetryFields'])) return false
  if (!Array.isArray(v['desktopUpdateFields'])) return false
  if (!Array.isArray(v['cacheFields'])) return false
  if (!Array.isArray(v['advancedFields'])) return false
  if (!Array.isArray(v['sharedDirectoriesFields'])) return false
  if (!Array.isArray(v['installLocationFields'])) return false
  if (!Array.isArray(v['modelsDirs'])) return false
  if (typeof v['modelsSystemDefault'] !== 'string') return false
  if (typeof v['telemetryGranted'] !== 'boolean') return false
  if (!v['appUpdate'] || typeof v['appUpdate'] !== 'object') return false
  return true
}

function isDownloadsState(value: unknown): value is PopupDownloadsState {
  if (!value || typeof value !== 'object') return false
  const v = value as { active?: unknown; recent?: unknown }
  return Array.isArray(v.active) && Array.isArray(v.recent)
}

function isInstancePickerSnapshot(value: unknown): value is PopupInstancePickerSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as {
    installs?: unknown
    activeInstallationId?: unknown
    runningInstallationIds?: unknown
    selectedInstallationId?: unknown
    pickerSelectionEpoch?: unknown
    selectedSettings?: unknown
    selectedSnapshots?: unknown
    mode?: unknown
    initialTab?: unknown
    autoAction?: unknown
  }
  if (!Array.isArray(v.installs)) return false
  if (v.activeInstallationId !== null && typeof v.activeInstallationId !== 'string') return false
  if (!Array.isArray(v.runningInstallationIds)) return false
  if (
    v.selectedInstallationId !== undefined &&
    v.selectedInstallationId !== null &&
    typeof v.selectedInstallationId !== 'string'
  )
    return false
  if (v.pickerSelectionEpoch !== undefined && typeof v.pickerSelectionEpoch !== 'number')
    return false
  if (
    v.selectedSettings !== undefined &&
    v.selectedSettings !== null &&
    !Array.isArray(v.selectedSettings)
  )
    return false
  if (
    v.selectedSnapshots !== undefined &&
    v.selectedSnapshots !== null &&
    typeof v.selectedSnapshots !== 'object'
  )
    return false
  if (v.initialTab !== undefined && v.initialTab !== null && typeof v.initialTab !== 'string')
    return false
  if (v.autoAction !== undefined && v.autoAction !== null && typeof v.autoAction !== 'string')
    return false
  return true
}

const bridge: ComfyTitlePopupBridge = {
  platform: process.platform,
  activate: (id) => {
    ipcRenderer.send('comfy-titlepopup:item-activated', { id })
  },
  close: () => {
    ipcRenderer.send('comfy-titlepopup:close')
  },
  ready: () => {
    ipcRenderer.send('comfy-titlepopup:ready')
  },
  notifyRendered: () => {
    ipcRenderer.send('comfy-titlepopup:rendered')
  },
  onConfig: (cb) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void => {
      if (isPopupConfig(data)) cb(data)
    }
    ipcRenderer.on('comfy-titlepopup:set-config', handler)
    return () => ipcRenderer.removeListener('comfy-titlepopup:set-config', handler)
  },
  onDownloadsChanged: (cb) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void => {
      if (isDownloadsState(data)) cb(data)
    }
    ipcRenderer.on('comfy-titlepopup:downloads-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlepopup:downloads-changed', handler)
  },
  downloadsAction: (action) => {
    ipcRenderer.send('comfy-titlepopup:downloads-action', action)
  },
  openSettingsTab: (tab) => {
    ipcRenderer.send('comfy-titlepopup:open-settings-tab', { tab })
  },
  openDownloadsModal: () => {
    ipcRenderer.send('comfy-titlepopup:open-downloads-modal')
  },
  requestSize: (height) => {
    if (!Number.isFinite(height) || height <= 0) return
    ipcRenderer.send('comfy-titlepopup:request-size', { height })
  },
  onInstancePickerSnapshot: (cb) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void => {
      if (isInstancePickerSnapshot(data)) cb(data)
    }
    ipcRenderer.on('comfy-titlepopup:installs-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlepopup:installs-changed', handler)
  },
  pickInstall: (installationId) => {
    ipcRenderer.send('comfy-titlepopup:pick-install', { installationId })
  },
  openInstallNewWindow: (installationId, opts) => {
    ipcRenderer.send('comfy-titlepopup:open-install-new-window', {
      installationId,
      allowDuplicate: opts?.allowDuplicate === true
    })
  },
  openNewInstall: () => {
    ipcRenderer.send('comfy-titlepopup:open-new-install')
  },
  restartInstall: (installationId, opts) => {
    ipcRenderer.send('comfy-titlepopup:restart-install', {
      installationId,
      confirmed: opts?.confirmed === true
    })
  },
  getDownloadThumbnail: (savePath: string) =>
    ipcRenderer.invoke('download-thumbnail', { savePath }),
  setPickerSelectedInstall: (installationId) => {
    ipcRenderer.send('comfy-titlepopup:set-picker-selected-install', { installationId })
  },
  pickerUpdateField: (installationId, fieldId, value) =>
    ipcRenderer.invoke('comfy-titlepopup:picker-update-field', {
      installationId,
      fieldId,
      value
    }),
  pickerRunAction: (installationId, actionId, actionData) =>
    ipcRenderer.invoke('comfy-titlepopup:picker-run-action', {
      installationId,
      actionId,
      actionData
    }),
  openInstallAction: (installationId, actionId) => {
    ipcRenderer.send('comfy-titlepopup:open-install-action', {
      installationId,
      actionId
    })
  },
  onWillShow: (cb) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void => {
      if (!data || typeof data !== 'object') return
      const kind = (data as { kind?: unknown }).kind
      if (
        kind !== POPUP_KIND.menu &&
        kind !== POPUP_KIND.downloads &&
        kind !== POPUP_KIND.downloadsFull &&
        kind !== POPUP_KIND.instancePicker &&
        kind !== POPUP_KIND.globalSettings
      )
        return
      cb({ kind })
    }
    ipcRenderer.on('comfy-titlepopup:will-show', handler)
    return () => ipcRenderer.removeListener('comfy-titlepopup:will-show', handler)
  },
  onGlobalSettingsSnapshot: (cb) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void => {
      if (isGlobalSettingsSnapshot(data)) cb(data)
    }
    ipcRenderer.on('comfy-titlepopup:global-settings-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlepopup:global-settings-changed', handler)
  },
  globalSettingsUpdateField: (fieldId, value) =>
    ipcRenderer.invoke('comfy-titlepopup:global-settings-update-field', { fieldId, value }),
  globalSettingsSetModelsDirs: (dirs) =>
    ipcRenderer.invoke('comfy-titlepopup:global-settings-set-models-dirs', { dirs }),
  globalSettingsBrowseFolder: (defaultPath) =>
    ipcRenderer.invoke('comfy-titlepopup:global-settings-browse-folder', { defaultPath }),
  globalSettingsOpenPath: (path) => {
    ipcRenderer.send('comfy-titlepopup:global-settings-open-path', { path })
  },
  globalSettingsOpenLogsFolder: () => {
    ipcRenderer.send('comfy-titlepopup:global-settings-open-logs-folder')
  },
  globalSettingsRevealPath: (path) => {
    ipcRenderer.send('comfy-titlepopup:global-settings-reveal-path', { path })
  },
  globalSettingsOpenExternal: (url) => {
    ipcRenderer.send('comfy-titlepopup:global-settings-open-external', { url })
  },
  globalSettingsCheckForUpdate: () =>
    ipcRenderer.invoke('comfy-titlepopup:global-settings-check-for-update'),
  globalSettingsDownloadUpdate: () =>
    ipcRenderer.invoke('comfy-titlepopup:global-settings-download-update'),
  globalSettingsInstallUpdate: () => {
    ipcRenderer.send('comfy-titlepopup:global-settings-install-update')
  },
  globalSettingsSetLastCheckedAt: (value) => {
    ipcRenderer.send('comfy-titlepopup:global-settings-set-last-checked', { value })
  },
  pickerSettingsGetDetailSections: (installationId) =>
    ipcRenderer.invoke(CH.getDetailSections, { installationId }),
  pickerSettingsGetDiskSpace: (path) => ipcRenderer.invoke(CH.getDiskSpace, { path }),
  pickerSettingsUpdateInstallation: (installationId, data) =>
    ipcRenderer.invoke(CH.updateInstallation, { installationId, data }),
  pickerSettingsRunAction: (installationId, actionId, actionData) =>
    ipcRenderer.invoke(CH.runAction, { installationId, actionId, actionData }),
  pickerSettingsGetFieldOptions: (sourceId, fieldId, selections) =>
    ipcRenderer.invoke(CH.getFieldOptions, { sourceId, fieldId, selections }),
  pickerSettingsGetInstallations: () => ipcRenderer.invoke(CH.getInstallations),
  pickerSettingsGetStableTags: () => ipcRenderer.invoke(CH.getStableTags),
  pickerSettingsGetUniqueName: (baseName) => ipcRenderer.invoke(CH.getUniqueName, { baseName }),
  pickerSettingsGetInstallationSize: (installationId) =>
    ipcRenderer.invoke(CH.getInstallationSize, { installationId }),
  pickerSettingsStopComfyUI: (installationId) =>
    ipcRenderer.invoke(CH.stopComfyUI, { installationId }),
  pickerSettingsGetSnapshots: (installationId) =>
    ipcRenderer.invoke(CH.getSnapshots, { installationId }),
  pickerSettingsGetSnapshotDetail: (installationId, filename) =>
    ipcRenderer.invoke(CH.getSnapshotDetail, { installationId, filename }),
  pickerSettingsGetSnapshotDiff: (installationId, filename, mode) =>
    ipcRenderer.invoke(CH.getSnapshotDiff, { installationId, filename, mode }),
  pickerSettingsExportSnapshot: (installationId, filename) =>
    ipcRenderer.invoke(CH.exportSnapshot, { installationId, filename }),
  pickerSettingsExportAllSnapshots: (installationId) =>
    ipcRenderer.invoke(CH.exportAllSnapshots, { installationId }),
  pickerSettingsImportSnapshotsPreview: () => ipcRenderer.invoke(CH.importSnapshotsPreview),
  pickerSettingsImportSnapshotsDiff: (installationId) =>
    ipcRenderer.invoke(CH.importSnapshotsDiff, { installationId }),
  pickerSettingsImportSnapshotsConfirm: (installationId) =>
    ipcRenderer.invoke(CH.importSnapshotsConfirm, { installationId }),
  pickerSettingsPreviewSnapshotFile: () => ipcRenderer.invoke(CH.previewSnapshotFile),
  pickerSettingsGetComfyArgs: (installationId) =>
    ipcRenderer.invoke(CH.getComfyArgs, { installationId }),
  pickerSettingsGetCoreBetaArgs: (installationId, launchArgs) =>
    ipcRenderer.invoke(CH.getCoreBetaArgs, { installationId, launchArgs }),
  pickerSettingsBrowseFolder: (opts) =>
    ipcRenderer.invoke(CH.browseFolder, { defaultPath: opts?.defaultPath }),
  pickerSettingsCancelOperation: (installationId) =>
    ipcRenderer.invoke(CH.cancelOperation, { installationId }),
  pickerSettingsPreviewLocalMigration: (installationId) =>
    ipcRenderer.invoke(CH.previewLocalMigration, { installationId }),
  terminalSubscribe: (installationId) => ipcRenderer.invoke('terminal-subscribe', installationId),
  terminalUnsubscribe: (installationId) =>
    ipcRenderer.invoke('terminal-unsubscribe', installationId),
  terminalWrite: (installationId, data) =>
    ipcRenderer.invoke('terminal-write', installationId, data),
  terminalResize: (installationId, cols, rows) =>
    ipcRenderer.invoke('terminal-resize', installationId, cols, rows),
  terminalRestart: (installationId) => ipcRenderer.invoke('terminal-restart', installationId),
  onTerminalOutput: (callback) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void =>
      callback(data as { installationId: string; data: string })
    ipcRenderer.on('terminal-output', handler)
    return () => ipcRenderer.removeListener('terminal-output', handler)
  },
  onTerminalExited: (callback) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void =>
      callback(data as { installationId: string })
    ipcRenderer.on('terminal-exited', handler)
    return () => ipcRenderer.removeListener('terminal-exited', handler)
  },
  pickerSettingsRelaunchApp: () => {
    ipcRenderer.send(CH.relaunchApp)
  },
  pickerSettingsOpenGlobalSettings: (tab, opts) => {
    ipcRenderer.send(CH.openGlobalSettings, { tab, highlightField: opts?.highlightField })
  },
  pickerSettingsGetLocaleMessages: () => ipcRenderer.invoke(CH.getLocaleMessages),
  pickerSettingsGetLocale: () => ipcRenderer.invoke(CH.getLocale),
  pickerSettingsOnLocaleChanged: (cb) => {
    const handler = (_event: IpcRendererEvent, payload: unknown): void =>
      cb(payload as { locale: string; messages: Record<string, unknown> })
    ipcRenderer.on('locale-changed', handler)
    return () => ipcRenderer.removeListener('locale-changed', handler)
  },
  pickerSettingsOnReleaseCacheEnriched: (callback) => {
    const handler = (_event: IpcRendererEvent, data: unknown) => callback(data as { repo: string })
    ipcRenderer.on('release-cache-enriched', handler)
    return () => ipcRenderer.removeListener('release-cache-enriched', handler)
  },
  pickerForwardShowProgress: (payload) => {
    ipcRenderer.send('comfy-titlepopup:forward-show-progress', payload)
  },
  pickerStartBackgroundOp: (payload) => {
    ipcRenderer.send('comfy-titlepopup:start-background-op', payload)
  },
  pickerCancelBackgroundOp: (installationId) => {
    ipcRenderer.send('comfy-titlepopup:cancel-background-op', { installationId })
  },
  pickerDismissBackgroundOp: (installationId) => {
    ipcRenderer.send('comfy-titlepopup:dismiss-background-op', { installationId })
  },
  onDismissModals: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on('comfy-titlepopup:dismiss-modals', handler)
    return () => ipcRenderer.removeListener('comfy-titlepopup:dismiss-modals', handler)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('__comfyTitlePopup', bridge)
} else {
  ;(globalThis as Record<string, unknown>).__comfyTitlePopup = bridge
}
