import type { Installation } from '../../src/renderer/src/types/ipc'

// Only the host boundary is replaced. Screens, stores, controls, and their
// interactions are production code. Fixtures perform no network or disk I/O.
export const installations: Installation[] = [
  {
    id: 'studio',
    name: 'Studio',
    sourceLabel: 'Standalone',
    sourceCategory: 'local',
    version: 'v0.3.76',
    status: 'installed',
    installPath: '/ComfyUI/Studio'
  },
  {
    id: 'experiments',
    name: 'Experiments with a longer installation name',
    sourceLabel: 'Standalone',
    sourceCategory: 'local',
    version: 'v0.3.76',
    status: 'installed',
    installPath: '/ComfyUI/Experiments'
  },
  {
    id: 'cloud',
    name: 'Comfy Cloud',
    sourceLabel: 'Cloud',
    sourceCategory: 'cloud'
  }
]

const subscribe = () => () => {}
const success = async () => ({ ok: true })

export function installFixtureBridge(): void {
  const firstUse = new URLSearchParams(location.search).get('scene') === 'first-use'
  const bridge = {
    getInstallations: async () => (firstUse ? [] : installations),
    onInstallationsChanged: subscribe,
    onInstallationsVersionsUpdated: subscribe,
    getSetting: async () => undefined,
    setSetting: async () => undefined,
    onSettingsChanged: subscribe,
    onErrorDetail: subscribe,
    runAction: success,
    focusComfyWindow: async () => true,
    getCloudFreeRunsEnabled: async () => false,
    getCloudUserTier: async () => 'unknown',
    getListActions: async () => [{ id: 'launch', style: 'primary' }],
    browseFolder: async () => null,
    openPath: async () => undefined,
    openExternal: async () => undefined,
    getLocale: async () => 'en',
    getSystemInfo: async () => null,
    validateHardware: async () => ({}),
    setFirstUseMode: async () => undefined,
    telemetryGetExperimentFlag: async () => 'control',
    telemetryRecordExposure: async () => undefined,
    comfybuilder: {
      getAuthStatus: async () => ({ signedIn: false }),
      onAuthChanged: subscribe,
      signIn: async () => undefined,
      signOut: async () => undefined,
      listWorkspaces: async () => [],
      switchWorkspace: async () => undefined,
      listBuilds: async () => [],
      installBuild: success,
      promoteLocalInstance: success
    }
  }
  Object.defineProperty(window, 'api', { configurable: true, value: bridge })
  Object.defineProperty(window, '__comfyTitlePopup', {
    configurable: true,
    value: {
      close: () => {},
      globalSettingsUpdateField: success,
      globalSettingsBrowseFolder: async () => null,
      globalSettingsOpenPath: () => {},
      globalSettingsOpenExternal: () => {},
      globalSettingsOpenLogsFolder: () => {},
      globalSettingsSetModelsDirs: success,
      globalSettingsCheckForUpdate: async () => ({ available: false }),
      globalSettingsDownloadUpdate: async () => undefined,
      globalSettingsInstallUpdate: () => {},
      globalSettingsSetLastCheckedAt: () => {}
    }
  })
}
