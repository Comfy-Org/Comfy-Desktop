import type { ComfyTitlePopupBridge } from '../../../preload/comfyTitlePopupPreload'
import type { LocaleSource } from '../lib/useAppLocale'

const API_MAP = {
  getDetailSections: 'pickerSettingsGetDetailSections',
  getDiskSpace: 'pickerSettingsGetDiskSpace',
  openPath: 'globalSettingsOpenPath',
  revealPath: 'globalSettingsRevealPath',
  updateInstallation: 'pickerSettingsUpdateInstallation',
  runAction: 'pickerSettingsRunAction',
  getFieldOptions: 'pickerSettingsGetFieldOptions',
  getInstallations: 'pickerSettingsGetInstallations',
  getStableTags: 'pickerSettingsGetStableTags',
  getUniqueName: 'pickerSettingsGetUniqueName',
  getInstallationSize: 'pickerSettingsGetInstallationSize',
  stopComfyUI: 'pickerSettingsStopComfyUI',
  cancelOperation: 'pickerSettingsCancelOperation',
  getSnapshots: 'pickerSettingsGetSnapshots',
  getSnapshotDetail: 'pickerSettingsGetSnapshotDetail',
  getSnapshotDiff: 'pickerSettingsGetSnapshotDiff',
  exportSnapshot: 'pickerSettingsExportSnapshot',
  exportAllSnapshots: 'pickerSettingsExportAllSnapshots',
  importSnapshotsPreview: 'pickerSettingsImportSnapshotsPreview',
  importSnapshotsDiff: 'pickerSettingsImportSnapshotsDiff',
  importSnapshotsConfirm: 'pickerSettingsImportSnapshotsConfirm',
  previewSnapshotFile: 'pickerSettingsPreviewSnapshotFile',
  getComfyArgs: 'pickerSettingsGetComfyArgs',
  getCoreBetaArgs: 'pickerSettingsGetCoreBetaArgs',
  openGlobalSettings: 'pickerSettingsOpenGlobalSettings',
  previewLocalMigration: 'pickerSettingsPreviewLocalMigration',
  onReleaseCacheEnriched: 'pickerSettingsOnReleaseCacheEnriched',
  terminalSubscribe: 'terminalSubscribe',
  terminalUnsubscribe: 'terminalUnsubscribe',
  terminalWrite: 'terminalWrite',
  terminalResize: 'terminalResize',
  terminalRestart: 'terminalRestart',
  onTerminalOutput: 'onTerminalOutput',
  onTerminalExited: 'onTerminalExited'
} as const satisfies Record<string, keyof ComfyTitlePopupBridge>

type ShimApi = {
  [K in keyof typeof API_MAP]: ComfyTitlePopupBridge[(typeof API_MAP)[K]]
} & {
  platform: NodeJS.Platform
  browseFolder: (
    defaultPath?: string
  ) => ReturnType<ComfyTitlePopupBridge['pickerSettingsBrowseFolder']>
  relaunchApp: () => void
  onInstallationsChanged: (cb: () => void) => () => void
}

export function installPickerSettingsApiShim(): void {
  const bridge = (window as unknown as { __comfyTitlePopup?: ComfyTitlePopupBridge })
    .__comfyTitlePopup
  if (!bridge) {
    return
  }

  const api = {} as ShimApi
  for (const [apiKey, bridgeKey] of Object.entries(API_MAP)) {
    const method = bridge[bridgeKey as keyof ComfyTitlePopupBridge] as (
      ...args: unknown[]
    ) => unknown
    ;(api as Record<string, unknown>)[apiKey] = method.bind(bridge)
  }
  api.platform = bridge.platform
  api.browseFolder = (defaultPath?: string) =>
    bridge.pickerSettingsBrowseFolder(defaultPath ? { defaultPath } : undefined)
  api.relaunchApp = () => bridge.pickerSettingsRelaunchApp()
  api.onInstallationsChanged = (cb: () => void) => bridge.onInstancePickerSnapshot(() => cb())
  ;(window as unknown as { api: ShimApi }).api = api
}

export function popupLocaleSource(): LocaleSource {
  const bridge = (window as unknown as { __comfyTitlePopup?: ComfyTitlePopupBridge })
    .__comfyTitlePopup
  return {
    getLocale: () => bridge?.pickerSettingsGetLocale?.() ?? Promise.resolve('en'),
    getMessages: () => bridge?.pickerSettingsGetLocaleMessages?.() ?? Promise.resolve({}),
    subscribe: (cb) => bridge?.pickerSettingsOnLocaleChanged?.(cb) ?? (() => {})
  }
}
