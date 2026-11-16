import type { Category, ViewKind } from '../shared/viewKind'
import type { POPUP_KIND, PopupTheme } from './ipc'

export interface TitlePopupMenuItem {
  id?: string
  label?: string
  labelKey?: string
  kind?: 'separator'
}

export interface InstancePickerInstall {
  id: string
  name: string
  sourceLabel: string
  sourceCategory: string
  workspaceId?: string
  version?: string
  statusTag?: { style: string; label: string; detail?: string }
  lastLaunchedAt?: number
  installPath?: string
  status?: string
  [key: string]: unknown
}

export interface GlobalSettingsModelsDir {
  path: string
  isPrimary: boolean
}

export interface PickerStorageSlice {
  sharedDirectoriesFields: Record<string, unknown>[]
  modelsDirs: GlobalSettingsModelsDir[]
  modelsSystemDefault: string
}

export interface PickerOperationStatus {
  status: string
  percent: number
  speedBytesPerSec?: number | null
  done: boolean
  ok: boolean | null
  error: string | null
  cancellable: boolean
  title: string
  actionId: string
  actionData?: Record<string, unknown>
}

export interface InstancePickerSnapshot {
  installs: InstancePickerInstall[]
  activeInstallationId: string | null
  currentView: ViewKind
  currentCategory: Category | null
  runningInstallationIds: string[]
  runningSessionStartedAt: Record<string, number>
  launchingInstallationIds: string[]
  unhostedLaunchingInstallationIds: string[]
  selectedInstallationId: string | null
  pickerSelectionEpoch: number
  selectedSettings: Record<string, unknown>[] | null
  selectedSnapshots: Record<string, unknown> | null
  initialTab: string | null
  autoAction: string | null
  autoActionNonce: number
  storage: PickerStorageSlice
  operatingInstallationIds: string[]
  installOperationStatus: Record<string, PickerOperationStatus>
}

export type GlobalSettingsTab = 'general' | 'updates' | 'storage' | 'advanced' | 'logs'

export interface GlobalSettingsSnapshot {
  initialTab: GlobalSettingsTab | null
  highlightFieldId: string | null
  languageFields: Record<string, unknown>[]
  generalFields: Record<string, unknown>[]
  telemetryFields: Record<string, unknown>[]
  desktopUpdateFields: Record<string, unknown>[]
  cacheFields: Record<string, unknown>[]
  advancedFields: Record<string, unknown>[]
  sharedDirectoriesFields: Record<string, unknown>[]
  installLocationFields: Record<string, unknown>[]
  modelsDirs: GlobalSettingsModelsDir[]
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
  | { kind: typeof POPUP_KIND.instancePicker; snapshot: InstancePickerSnapshot; theme: PopupTheme }
  | { kind: typeof POPUP_KIND.globalSettings; snapshot: GlobalSettingsSnapshot; theme: PopupTheme }
