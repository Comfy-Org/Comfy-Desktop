import type { ComfyTitlePopupBridge } from '../../../preload/comfyTitlePopupPreload'
import type { ElectronApi } from '../types/ipc'
import type { LocaleSource } from '../lib/useAppLocale'

function buildPickerSettingsApi(bridge: ComfyTitlePopupBridge) {
  return {
    platform: bridge.platform,
    getDetailSections: (...args) => bridge.pickerSettingsGetDetailSections(...args),
    getDiskSpace: (...args) => bridge.pickerSettingsGetDiskSpace(...args),
    openPath: async (targetPath) => bridge.globalSettingsOpenPath(targetPath),
    revealPath: (targetPath) => bridge.globalSettingsRevealPath(targetPath),
    openExternal: async (url) => bridge.globalSettingsOpenExternal(url),
    updateInstallation: (...args) => bridge.pickerSettingsUpdateInstallation(...args),
    runAction: (...args) => bridge.pickerSettingsRunAction(...args),
    getFieldOptions: (...args) => bridge.pickerSettingsGetFieldOptions(...args),
    getInstallations: () => bridge.pickerSettingsGetInstallations(),
    getStableTags: () => bridge.pickerSettingsGetStableTags(),
    getUniqueName: (...args) => bridge.pickerSettingsGetUniqueName(...args),
    getInstallationSize: (...args) => bridge.pickerSettingsGetInstallationSize(...args),
    stopComfyUI: (...args) => bridge.pickerSettingsStopComfyUI(...args),
    cancelOperation: (...args) => bridge.pickerSettingsCancelOperation(...args),
    getSnapshots: (...args) => bridge.pickerSettingsGetSnapshots(...args),
    getSnapshotDetail: (...args) => bridge.pickerSettingsGetSnapshotDetail(...args),
    getSnapshotDiff: (...args) => bridge.pickerSettingsGetSnapshotDiff(...args),
    exportSnapshot: (...args) => bridge.pickerSettingsExportSnapshot(...args),
    exportAllSnapshots: (...args) => bridge.pickerSettingsExportAllSnapshots(...args),
    importSnapshotsPreview: () => bridge.pickerSettingsImportSnapshotsPreview(),
    importSnapshotsDiff: (...args) => bridge.pickerSettingsImportSnapshotsDiff(...args),
    importSnapshotsConfirm: (...args) => bridge.pickerSettingsImportSnapshotsConfirm(...args),
    previewSnapshotFile: () => bridge.pickerSettingsPreviewSnapshotFile(),
    getComfyArgs: (...args) => bridge.pickerSettingsGetComfyArgs(...args),
    getCoreBetaArgs: (...args) => bridge.pickerSettingsGetCoreBetaArgs(...args),
    openGlobalSettings: (...args) => bridge.pickerSettingsOpenGlobalSettings(...args),
    previewLocalMigration: (...args) => bridge.pickerSettingsPreviewLocalMigration(...args),
    browseFolder: (defaultPath) =>
      bridge.pickerSettingsBrowseFolder(defaultPath ? { defaultPath } : undefined),
    relaunchApp: async () => bridge.pickerSettingsRelaunchApp(),
    terminalSubscribe: (...args) => bridge.terminalSubscribe(...args),
    terminalUnsubscribe: (...args) => bridge.terminalUnsubscribe(...args),
    terminalWrite: (...args) => bridge.terminalWrite(...args),
    terminalResize: (...args) => bridge.terminalResize(...args),
    terminalRestart: (...args) => bridge.terminalRestart(...args),
    onTerminalOutput: (...args) => bridge.onTerminalOutput(...args),
    onTerminalExited: (...args) => bridge.onTerminalExited(...args),
    onReleaseCacheEnriched: (...args) => bridge.pickerSettingsOnReleaseCacheEnriched(...args),
    onSettingsChanged: (...args) => bridge.pickerSettingsOnSettingsChanged(...args),
    onInstallationsChanged: (callback) => bridge.onInstancePickerSnapshot(() => callback())
  } satisfies Partial<ElectronApi>
}

export type PickerSettingsApi = Pick<ElectronApi, keyof ReturnType<typeof buildPickerSettingsApi>>

export function installPickerSettingsApiShim(): void {
  const bridge = window.__comfyTitlePopup
  if (!bridge) return
  window.api = buildPickerSettingsApi(bridge)
}

export function popupLocaleSource(): LocaleSource {
  const bridge = window.__comfyTitlePopup
  return {
    getLocale: () => bridge?.pickerSettingsGetLocale?.() ?? Promise.resolve('en'),
    getMessages: () => bridge?.pickerSettingsGetLocaleMessages?.() ?? Promise.resolve({}),
    subscribe: (cb) => bridge?.pickerSettingsOnLocaleChanged?.(cb) ?? (() => {})
  }
}
