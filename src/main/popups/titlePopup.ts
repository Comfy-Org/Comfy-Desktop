import { ipcMain, shell, dialog, WebContentsView, BrowserWindow } from 'electron'
import { PICKER_SETTINGS_CHANNELS, POPUP_KIND } from '../../types/ipc'
import type { PopupTheme, TitlePopupKind } from '../../types/ipc'
import { TITLEBAR_HEIGHT } from '../lib/titleBarOverlay'
import {
  cancelModelDownload,
  clearFinishedDownloads,
  dismissRecentDownload,
  downloadEvents,
  getDownloadsTrayState,
  pauseModelDownload,
  resumeModelDownload,
  retryDownload
} from '../lib/comfyDownloadManager'
import { installationEvents } from '../installations'
import * as mainTelemetry from '../lib/telemetry'
import * as updater from '../lib/updater'
import * as i18n from '../lib/i18n'
import * as settings from '../settings'
import { defaultInstallDir } from '../lib/paths'
import { convertLevelToZoomPercent } from '../lib/zoom'
import { getAppLogDir } from '../lib/appLog'
import {
  openPath as openPathHelper,
  getAppVersion,
  _activeOperationStatus,
  _operationAborts,
  sessionLifecycleEvents,
  type PickerOperationStatus
} from '../lib/ipc/shared'
import {
  applySettingSet,
  buildSettingsSections,
  buildMediaSections,
  buildModelsPayload,
  buildInstallLocationFields
} from '../lib/ipc/registerSettingsHandlers'
import { globalSettingsEvents } from '../lib/globalSettingsEvents'
import * as installations from '../installations'
import { getCachedGithubStarCount, getGithubStarCount } from '../lib/githubStars'
import {
  comfyWindows,
  findEntryByComfySender,
  findEntryByTitleBarSender,
  getEntryByInstallationId,
  hostInstallEvents,
  isChooserHost,
  isPanelSender
} from '../host/registry'
import type { ComfyPanelKey, ComfyWindowEntry } from '../host/registry'
import { normaliseCategory, viewKindFor } from '../../shared/viewKind'
import type { Category, ViewKind } from '../../shared/viewKind'
import { getTitleTooltipForParent, hideTitleTooltipPopup } from './titleTooltip'
import { EmbeddedPopupView } from './embeddedPopupView'
import { recordIpcInvocation } from '../lib/e2eOverrides'

interface TitlePopupMenuItem {
  id?: string
  label?: string
  labelKey?: string
  checked?: boolean
  kind?: 'separator'
}

function kindUsesBackdrop(kind: TitlePopupKind): boolean {
  return (
    kind === POPUP_KIND.instancePicker ||
    kind === POPUP_KIND.globalSettings ||
    kind === POPUP_KIND.downloadsFull
  )
}

export interface InstancePickerInstall {
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

export interface PickerStorageSlice {
  sharedDirectoriesFields: Record<string, unknown>[]
  modelsDirs: GlobalSettingsModelsDir[]
  modelsSystemDefault: string
}

export interface InstancePickerSnapshot {
  installs: InstancePickerInstall[]
  activeInstallationId: string | null
  currentView: ViewKind
  currentCategory: Category | null
  runningInstallationIds: string[]
  runningSessionStartedAt: Record<string, number>
  launchingInstallationIds: string[]
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

export interface GlobalSettingsModelsDir {
  path: string
  isPrimary: boolean
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

interface BuildInstancePickerSnapshotArgs {
  installs: InstancePickerInstall[]
  hostInstallationId: string | null
  previewInstallationId?: string | null
  runningInstallationIds: string[]
  runningSessionStartedAt?: Record<string, number>
  launchingInstallationIds: string[]
  selectedInstallationId?: string | null
  pickerSelectionEpoch?: number
  selectedSettings?: Record<string, unknown>[] | null
  selectedSnapshots?: Record<string, unknown> | null
  initialTab?: string | null
  autoAction?: string | null
  autoActionNonce?: number
  storage: PickerStorageSlice
  operatingInstallationIds?: string[]
  installOperationStatus?: InstancePickerSnapshot['installOperationStatus']
}

function mostRecentlyLaunchedInstallId(installs: InstancePickerInstall[]): string | null {
  let best: InstancePickerInstall | undefined
  for (const inst of installs) {
    if (!best) {
      best = inst
      continue
    }
    const ts = inst.lastLaunchedAt ?? 0
    const bestTs = best.lastLaunchedAt ?? 0
    if (ts > bestTs) {
      best = inst
    } else if (
      ts === bestTs &&
      best.sourceCategory === 'cloud' &&
      inst.sourceCategory !== 'cloud'
    ) {
      best = inst
    }
  }
  return best?.id ?? null
}

export function resolvePickerSelectedInstallId(
  explicitSelection: string | null | undefined,
  hostInstallationId: string | null | undefined,
  installs: InstancePickerInstall[]
): string | null {
  const resolved = explicitSelection ?? hostInstallationId ?? null
  if (resolved) return resolved
  return mostRecentlyLaunchedInstallId(installs)
}

export function buildInstancePickerSnapshot(
  args: BuildInstancePickerSnapshotArgs
): InstancePickerSnapshot {
  const hideCloud = settings.get('hideCloudFromPicker') === true
  const installs = hideCloud
    ? args.installs.filter((i) => i.sourceCategory !== 'cloud')
    : args.installs
  const activeInstallationId = args.hostInstallationId ?? args.previewInstallationId ?? null
  const currentCategory: Category | null = activeInstallationId
    ? normaliseCategory(args.installs.find((i) => i.id === activeInstallationId)?.sourceCategory)
    : null
  const currentView: ViewKind = viewKindFor(activeInstallationId, currentCategory)
  return {
    installs,
    activeInstallationId,
    currentView,
    currentCategory,
    runningInstallationIds: args.runningInstallationIds,
    runningSessionStartedAt: args.runningSessionStartedAt ?? {},
    launchingInstallationIds: args.launchingInstallationIds,
    selectedInstallationId: args.selectedInstallationId ?? null,
    pickerSelectionEpoch: args.pickerSelectionEpoch ?? 0,
    selectedSettings: args.selectedSettings ?? null,
    selectedSnapshots: args.selectedSnapshots ?? null,
    initialTab: args.initialTab ?? null,
    autoAction: args.autoAction ?? null,
    autoActionNonce: args.autoActionNonce ?? 0,
    storage: args.storage,
    operatingInstallationIds: args.operatingInstallationIds ?? [],
    installOperationStatus: args.installOperationStatus ?? {}
  }
}

function buildPickerStorageSlice(): PickerStorageSlice {
  const mediaSections = buildMediaSections()
  const modelsPayload = buildModelsPayload()
  const sharedDirectoriesFields = (mediaSections[0]?.fields ?? []).map(
    toDetailField
  ) as unknown as Record<string, unknown>[]
  const modelsDirsRaw = (modelsPayload.sections[0]?.fields[0]?.value as string[] | undefined) ?? []
  const modelsDefault = modelsPayload.systemDefault
  return {
    sharedDirectoriesFields,
    modelsDirs: modelsDirsRaw.map((p, i) => ({
      path: p,
      isPrimary: i === 0
    })),
    modelsSystemDefault: modelsDefault
  }
}

type TitlePopupConfig =
  | { kind: typeof POPUP_KIND.menu; items: TitlePopupMenuItem[]; theme: PopupTheme }
  | { kind: typeof POPUP_KIND.downloads; theme: PopupTheme }
  | { kind: typeof POPUP_KIND.downloadsFull; theme: PopupTheme }
  | { kind: typeof POPUP_KIND.instancePicker; snapshot: InstancePickerSnapshot; theme: PopupTheme }
  | { kind: typeof POPUP_KIND.globalSettings; snapshot: GlobalSettingsSnapshot; theme: PopupTheme }

export interface TitlePopupEntry {
  view: EmbeddedPopupView
  parentEntryId: number
  kind: TitlePopupKind
  titleBarSender: Electron.WebContents
  pendingConfig: TitlePopupConfig | null
  lastConfigJson: string | null
  lastSyncedConfigJson: string | null
  pickerSelectedInstallationId: string | null
  pickerSelectionEpoch: number
  pickerInitialTab: string | null
  pickerAutoAction: string | null
  pickerAutoActionNonce: number
  lastPickerBroadcastJson: string | null
  lastGlobalSettingsBroadcastJson: string | null
  openedAt: number
}

const titlePopupsByParent = new Map<number, TitlePopupEntry>()
const titlePopupsByWebContents = new Map<number, TitlePopupEntry>()

export function isTitlePopupSender(sender: Electron.WebContents): boolean {
  return titlePopupsByWebContents.has(sender.id)
}

const downloadsHiddenAtByParent = new Map<number, number>()
const DOWNLOADS_REOPEN_SUPPRESS_MS = 250

const cachedInstallsForPicker: InstancePickerInstall[] = []
let cachedInstallsResolved = false

let _pickerAutoActionNonce = 0

let activeBindings: TitlePopupHostBindings | null = null

export function triggerPickerSnapshotBroadcast(): void {
  if (!activeBindings) return
  void broadcastInstancePickerSnapshotToTitlePopups(activeBindings)
}

async function refreshCachedInstallsForPicker(): Promise<void> {
  if (!activeBindings) return
  try {
    const installs = await activeBindings.getInstancePickerInstalls()
    cachedInstallsForPicker.length = 0
    for (const i of installs) cachedInstallsForPicker.push(i)
    cachedInstallsResolved = true
  } catch {}
}

interface PopupBackdropEntry {
  view: WebContentsView
  visible: boolean
}
const popupBackdropsByParent = new Map<number, PopupBackdropEntry>()
const popupBackdropsByWebContents = new Map<number, number>()

const POPUP_BACKDROP_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;-webkit-user-select:none;user-select:none}
  .scrim{position:fixed;inset:0;width:100%;height:100%;background:rgba(10,10,11,0.4);backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);cursor:default}
</style></head><body>
<div class="scrim" id="s"></div>
<script>
  const { ipcRenderer } = require('electron');
  document.getElementById('s').addEventListener('mousedown', () => {
    ipcRenderer.send('comfy-popup-backdrop:dismiss');
  });
</script>
</body></html>`

function ensurePopupBackdrop(parent: BrowserWindow): PopupBackdropEntry {
  const existing = popupBackdropsByParent.get(parent.id)
  if (existing && !existing.view.webContents.isDestroyed()) return existing
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false
    }
  })
  view.setBackgroundColor('#00000000')
  view.setVisible(false)
  view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
  parent.contentView.addChildView(view)
  void view.webContents
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(POPUP_BACKDROP_HTML)}`)
    .catch(() => {})
  const entry: PopupBackdropEntry = { view, visible: false }
  popupBackdropsByParent.set(parent.id, entry)
  popupBackdropsByWebContents.set(view.webContents.id, parent.id)
  parent.on('resize', () => {
    if (!entry.visible || parent.isDestroyed() || view.webContents.isDestroyed()) return
    const cb = parent.getContentBounds()
    view.setBounds({
      x: 0,
      y: TITLEBAR_HEIGHT,
      width: cb.width,
      height: Math.max(0, cb.height - TITLEBAR_HEIGHT)
    })
  })
  const onParentClosed = (): void => {
    try {
      parent.contentView.removeChildView(view)
    } catch {}
    if (!view.webContents.isDestroyed()) view.webContents.close()
    popupBackdropsByParent.delete(parent.id)
    popupBackdropsByWebContents.delete(view.webContents.id)
  }
  parent.once('closed', onParentClosed)
  return entry
}

function showPopupBackdrop(parent: BrowserWindow): void {
  const entry = ensurePopupBackdrop(parent)
  const cb = parent.getContentBounds()
  entry.view.setBounds({
    x: 0,
    y: TITLEBAR_HEIGHT,
    width: cb.width,
    height: Math.max(0, cb.height - TITLEBAR_HEIGHT)
  })
  try {
    parent.contentView.removeChildView(entry.view)
    parent.contentView.addChildView(entry.view)
  } catch {}
  entry.view.setVisible(true)
  entry.visible = true
}

function hidePopupBackdrop(parent: BrowserWindow): void {
  const entry = popupBackdropsByParent.get(parent.id)
  if (!entry || !entry.visible) return
  entry.visible = false
  if (entry.view.webContents.isDestroyed()) return
  entry.view.setVisible(false)
  if (!parent.isDestroyed()) {
    try {
      parent.contentView.removeChildView(entry.view)
    } catch {}
  }
}

const POPUP_WIDTH = 220
const POPUP_ITEM_HEIGHT = 32
const POPUP_SEPARATOR_HEIGHT = 9
const POPUP_VPADDING = 8
const POPUP_VBORDER = 2

export function computePopupHeight(items: readonly TitlePopupMenuItem[]): number {
  const content = items.reduce(
    (sum, item) => sum + (item.kind === 'separator' ? POPUP_SEPARATOR_HEIGHT : POPUP_ITEM_HEIGHT),
    0
  )
  return content + POPUP_VPADDING + POPUP_VBORDER
}

export function buildTitlePopupMenuItems(entry: ComfyWindowEntry): TitlePopupMenuItem[] {
  if (entry.firstUseMode === 'post-consent') {
    return [
      {
        id: 'skip-onboarding',
        label: 'Skip Onboarding',
        labelKey: 'fileMenu.skipOnboarding'
      }
    ]
  }
  const items: TitlePopupMenuItem[] = [
    { id: 'new-window', label: 'Open Dashboard', labelKey: 'fileMenu.newWindow' },
    { kind: 'separator' },
    { id: 'new-install', label: 'New Instance', labelKey: 'fileMenu.newInstall' },
    {
      id: 'track',
      label: 'Add Existing Instance',
      labelKey: 'fileMenu.addExistingInstall'
    },
    { id: 'load-snapshot', label: 'Load Snapshot', labelKey: 'fileMenu.loadSnapshot' },
    { kind: 'separator' },
    {
      id: 'performance-test',
      label: 'Performance Tests',
      labelKey: 'fileMenu.performanceTest'
    },
    { id: 'benchmarks', label: 'Benchmarks', labelKey: 'fileMenu.benchmarks' },
    { kind: 'separator' },
    {
      id: 'settings',
      label: 'Desktop Settings',
      labelKey: 'fileMenu.globalSettings'
    },
    { id: 'feedback', label: 'Send Beta Feedback', labelKey: 'fileMenu.sendFeedback' }
  ]
  if (entry.installationId !== null && !entry.comfyView.webContents.isDestroyed()) {
    const level = entry.comfyView.webContents.getZoomLevel()
    if (level !== 0) {
      const percent = convertLevelToZoomPercent(level)
      items.push({ id: 'reset-zoom', label: `Reset Zoom (${percent}%)` })
    }
  }
  items.push(
    { kind: 'separator' },
    { id: 'exit-window', label: 'Close Window', labelKey: 'fileMenu.exitWindow' },
    {
      id: 'close-all-windows',
      label: 'Quit Desktop',
      labelKey: 'fileMenu.exitAllWindows'
    }
  )
  return items
}

function notifyTitlePopupDownloads(popup: WebContentsView): void {
  if (popup.webContents.isDestroyed()) return
  popup.webContents.send('comfy-titlepopup:downloads-changed', getDownloadsTrayState())
}

function broadcastDownloadsToTitlePopups(): void {
  for (const entry of titlePopupsByParent.values()) {
    notifyTitlePopupDownloads(entry.view.popup)
  }
}

let pickerSnapshotBroadcastSeq = 0

async function broadcastInstancePickerSnapshotToTitlePopups(
  bindings: TitlePopupHostBindings
): Promise<void> {
  const mySeq = ++pickerSnapshotBroadcastSeq
  const hasActivePicker = Array.from(titlePopupsByParent.values()).some(
    (entry) =>
      entry.kind === 'instance-picker' &&
      (entry.view.isOpen || entry.view.pendingShowTimer !== null)
  )
  if (!hasActivePicker) return
  const installs = await bindings.getInstancePickerInstalls()
  if (mySeq !== pickerSnapshotBroadcastSeq) return
  const runningInstallationIds = bindings.getRunningInstallationIds()
  const runningSessionStartedAt = bindings.getRunningSessionStartedAt?.() ?? {}
  const launchingInstallationIds = bindings.getLaunchingInstallationIds()
  for (const entry of titlePopupsByParent.values()) {
    if (entry.kind !== 'instance-picker') continue
    if (!entry.view.isOpen && entry.view.pendingShowTimer === null) continue
    if (entry.view.popup.webContents.isDestroyed()) continue
    const parentEntry = comfyWindows.get(entry.parentEntryId)
    const effectiveHostInstallationId =
      parentEntry?.installationId ?? parentEntry?.previewInstallationId ?? null
    const selectedId = resolvePickerSelectedInstallId(
      entry.pickerSelectedInstallationId,
      effectiveHostInstallationId,
      installs
    )
    if (!entry.pickerSelectedInstallationId && selectedId) {
      entry.pickerSelectedInstallationId = selectedId
    }
    const details = selectedId
      ? await bindings.getPickerDetailsForInstall(selectedId).catch(() => ({
          settings: null,
          snapshots: null
        }))
      : { settings: null, snapshots: null }
    if (mySeq !== pickerSnapshotBroadcastSeq) return
    const snapshot = buildInstancePickerSnapshot({
      installs,
      hostInstallationId: parentEntry?.installationId ?? null,
      previewInstallationId: parentEntry?.previewInstallationId ?? null,
      runningInstallationIds,
      runningSessionStartedAt,
      launchingInstallationIds,
      selectedInstallationId: selectedId,
      pickerSelectionEpoch: entry.pickerSelectionEpoch,
      selectedSettings: details.settings,
      selectedSnapshots: details.snapshots,
      initialTab: entry.pickerInitialTab,
      autoAction: entry.pickerAutoAction,
      autoActionNonce: entry.pickerAutoActionNonce,
      storage: buildPickerStorageSlice(),
      operatingInstallationIds: [..._activeOperationStatus.entries()]
        .filter(([, v]) => !v.done)
        .map(([k]) => k),
      installOperationStatus: Object.fromEntries(_activeOperationStatus)
    })
    const snapshotJson = JSON.stringify(snapshot)
    if (entry.lastPickerBroadcastJson === snapshotJson) continue
    entry.lastPickerBroadcastJson = snapshotJson
    entry.view.popup.webContents.send('comfy-titlepopup:installs-changed', snapshot)
  }
}

export function prewarmTitlePopup(parent: BrowserWindow): void {
  ensureTitlePopup(parent)
  if (!cachedInstallsResolved) {
    void refreshCachedInstallsForPicker()
  }
}

export function hideTitlePopupForParent(parent: BrowserWindow): void {
  if (parent.isDestroyed()) return
  const entry = titlePopupsByParent.get(parent.id)
  if (!entry) return
  if (entry.view.isDestroyed()) return
  hideTitlePopup(entry, { releaseFocusToParent: false })
}

function ensureTitlePopup(parent: BrowserWindow): TitlePopupEntry {
  const existing = titlePopupsByParent.get(parent.id)
  if (existing && !existing.view.isDestroyed()) return existing

  const view = new EmbeddedPopupView({
    parent,
    htmlName: 'comfyTitlePopup',
    preloadName: 'comfyTitlePopupPreload.js',
    initialBounds: { x: 0, y: 0, width: POPUP_WIDTH, height: 100 },
    hideOnParentEvents: ['blur', 'will-move', 'move'],
    hideOnPopupBlur: true,
    onParentClosed: () => {
      titlePopupsByParent.delete(parent.id)
      titlePopupsByWebContents.delete(view.popupWebContentsId)
    },
    onDestroyed: () => {
      const cur = titlePopupsByParent.get(parent.id)
      if (cur && cur.view === view) {
        titlePopupsByParent.delete(parent.id)
      }
      titlePopupsByWebContents.delete(view.popupWebContentsId)
    },
    onHide: () => {
      if (!entry.titleBarSender.isDestroyed()) {
        entry.titleBarSender.send('comfy-titlebar:menu-closed', { menu: entry.kind })
      }
      if (entry.kind === 'downloads' && !view.parentWindow.isDestroyed()) {
        downloadsHiddenAtByParent.set(view.parentWindow.id, Date.now())
      }
      if (!view.parentWindow.isDestroyed()) hidePopupBackdrop(view.parentWindow)
    }
  })
  const entry: TitlePopupEntry = {
    view,
    parentEntryId: 0,
    kind: 'menu',
    titleBarSender: view.popup.webContents,
    pendingConfig: null,
    lastConfigJson: null,
    lastSyncedConfigJson: null,
    pickerSelectedInstallationId: null,
    pickerSelectionEpoch: 0,
    pickerInitialTab: null,
    pickerAutoAction: null,
    pickerAutoActionNonce: 0,
    openedAt: 0,
    lastPickerBroadcastJson: null,
    lastGlobalSettingsBroadcastJson: null
  }
  titlePopupsByParent.set(view.parentWindowId, entry)
  titlePopupsByWebContents.set(view.popupWebContentsId, entry)

  const onParentResize = (): void => refitPopupForParent(entry)
  parent.on('resize', onParentResize)

  return entry
}

const BACKDROP_DISMISS_GUARD_MS = 180

function hideTitlePopup(
  entry: TitlePopupEntry,
  opts: { releaseFocusToParent?: boolean } = {}
): void {
  const wasActive = entry.view.isOpen || entry.view.pendingShowTimer !== null
  entry.view.hide()
  if (!wasActive) return
  if (
    opts.releaseFocusToParent &&
    !entry.view.popup.webContents.isDestroyed() &&
    !entry.view.parentWindow.isDestroyed()
  ) {
    const comfyContents = comfyWindows.get(entry.parentEntryId)?.comfyView.webContents
    if (comfyContents && !comfyContents.isDestroyed()) {
      comfyContents.focus()
    } else if (!entry.titleBarSender.isDestroyed()) {
      entry.titleBarSender.focus()
    } else {
      entry.view.parentWindow.focus()
    }
  }
}

function showTitlePopupNow(entry: TitlePopupEntry): void {
  if (entry.view.popup.webContents.isDestroyed()) return
  if (kindUsesBackdrop(entry.kind) && !entry.view.parentWindow.isDestroyed()) {
    showPopupBackdrop(entry.view.parentWindow)
  }
  entry.view.popup.webContents.send('comfy-titlepopup:will-show', { kind: entry.kind })
  entry.view.showOnTop({ focus: true })
  entry.openedAt = Date.now()
  if (!entry.titleBarSender.isDestroyed()) {
    entry.titleBarSender.send('comfy-titlebar:menu-opened', { menu: entry.kind })
  }
}

const DOWNLOADS_POPUP_WIDTH = 405
const DOWNLOADS_POPUP_MAX_HEIGHT_PX = 396
const DOWNLOADS_POPUP_MAX_HEIGHT_RATIO = 0.6

const PICKER_SIDE_GUTTER = 24
const PICKER_BOTTOM_GUTTER = 24
const PICKER_TOP_GUTTER = 8
const PICKER_EXPANDED_MAX_WIDTH = 960
const PICKER_EXPANDED_MAX_HEIGHT_RATIO = 0.85
const PICKER_EXPANDED_MAX_HEIGHT = 720

interface PickerBounds {
  x: number
  y: number
  width: number
  height: number
}

function computePickerBounds(parent: BrowserWindow): PickerBounds {
  const content = parent.getContentBounds()
  const innerTop = TITLEBAR_HEIGHT + PICKER_TOP_GUTTER
  const innerHeight = Math.max(0, content.height - innerTop - PICKER_BOTTOM_GUTTER)
  const innerWidth = Math.max(0, content.width - 2 * PICKER_SIDE_GUTTER)

  const width = Math.min(PICKER_EXPANDED_MAX_WIDTH, innerWidth)
  const height = Math.min(
    innerHeight,
    Math.round(content.height * PICKER_EXPANDED_MAX_HEIGHT_RATIO),
    PICKER_EXPANDED_MAX_HEIGHT
  )
  const x = Math.max(PICKER_SIDE_GUTTER, Math.round((content.width - width) / 2))
  const slack = Math.max(0, innerHeight - height)
  const y = slack > 0 ? innerTop + Math.round(slack / 3) : innerTop
  return { x, y, width, height }
}

interface CenteredCardClamp {
  minWidth: number
  maxWidth: number
  widthRatio: number
  minHeight: number
  maxHeight: number
  heightRatio: number
}

type CenteredCardKind = typeof POPUP_KIND.globalSettings | typeof POPUP_KIND.downloadsFull

const CENTERED_CARD_CLAMPS: Record<CenteredCardKind, CenteredCardClamp> = {
  [POPUP_KIND.globalSettings]: {
    minWidth: 640,
    maxWidth: 880,
    widthRatio: 0.65,
    minHeight: 420,
    maxHeight: 560,
    heightRatio: 0.7
  },
  [POPUP_KIND.downloadsFull]: {
    minWidth: 640,
    maxWidth: 900,
    widthRatio: 0.7,
    minHeight: 440,
    maxHeight: 680,
    heightRatio: 0.75
  }
}

function kindIsCentered(kind: TitlePopupKind): kind is CenteredCardKind {
  return kind === POPUP_KIND.globalSettings || kind === POPUP_KIND.downloadsFull
}

function computeCenteredCardBounds(
  kind: CenteredCardKind,
  parent: BrowserWindow
): { x: number; y: number; width: number; height: number } {
  const clamp = CENTERED_CARD_CLAMPS[kind]
  const { width: cw, height: ch } = parent.getContentBounds()
  const width = Math.min(
    clamp.maxWidth,
    Math.max(clamp.minWidth, Math.round(cw * clamp.widthRatio))
  )
  const height = Math.min(
    clamp.maxHeight,
    Math.max(clamp.minHeight, Math.round(ch * clamp.heightRatio))
  )
  const x = Math.max(0, Math.round((cw - width) / 2))
  const y = Math.max(
    TITLEBAR_HEIGHT,
    Math.round(TITLEBAR_HEIGHT + (ch - TITLEBAR_HEIGHT - height) / 2)
  )
  return { x, y, width, height }
}

const POPUP_EDGE_GUTTER = 8

function clampPopupX(x: number, width: number, parent: BrowserWindow): number {
  const contentWidth = parent.getContentBounds().width
  const maxX = Math.max(0, contentWidth - width - POPUP_EDGE_GUTTER)
  return Math.min(x, maxX)
}

function refitPopupForParent(entry: TitlePopupEntry): void {
  if (!entry.view.isOpen) return
  if (entry.view.popup.webContents.isDestroyed()) return
  if (entry.view.parentWindow.isDestroyed()) return

  const cur = entry.view.popup.getBounds()
  const parent = entry.view.parentWindow

  if (entry.kind === 'instance-picker') {
    const target = computePickerBounds(parent)
    if (
      target.x === cur.x &&
      target.y === cur.y &&
      target.width === cur.width &&
      target.height === cur.height
    ) {
      return
    }
    entry.view.popup.setBounds(target)
    return
  }

  if (kindIsCentered(entry.kind)) {
    const target = computeCenteredCardBounds(entry.kind, parent)
    if (
      target.x === cur.x &&
      target.y === cur.y &&
      target.width === cur.width &&
      target.height === cur.height
    ) {
      return
    }
    entry.view.popup.setBounds(target)
    return
  }

  let height = cur.height
  if (entry.kind === 'downloads') {
    const ceiling = Math.min(
      DOWNLOADS_POPUP_MAX_HEIGHT_PX,
      Math.round(parent.getContentBounds().height * DOWNLOADS_POPUP_MAX_HEIGHT_RATIO)
    )
    height = Math.max(1, Math.min(cur.height, ceiling))
  }
  const x = clampPopupX(cur.x, cur.width, parent)
  if (x === cur.x && height === cur.height) return
  entry.view.popup.setBounds({ x, y: cur.y, width: cur.width, height })
}

type OpenTitlePopupOpts = {
  parent: BrowserWindow
  parentEntryId: number
  anchor: { x: number; y: number }
  theme: { bg: string; text: string }
  titleBarSender: Electron.WebContents
} & (
  | { kind: typeof POPUP_KIND.menu; items: TitlePopupMenuItem[] }
  | { kind: typeof POPUP_KIND.downloads }
  | { kind: typeof POPUP_KIND.downloadsFull }
  | { kind: typeof POPUP_KIND.instancePicker; snapshot: InstancePickerSnapshot }
  | { kind: typeof POPUP_KIND.globalSettings; snapshot: GlobalSettingsSnapshot }
)

export function requiresPerOpenConfigSync(
  opts: Pick<OpenTitlePopupOpts, 'kind'> & {
    snapshot?: { initialTab?: unknown; highlightFieldId?: unknown }
  }
): boolean {
  if (opts.kind !== POPUP_KIND.globalSettings) return false
  return opts.snapshot?.initialTab != null || opts.snapshot?.highlightFieldId != null
}

function openTitlePopup(opts: OpenTitlePopupOpts): void {
  hideTitleTooltipPopup(getTitleTooltipForParent(opts.parent.id))
  const entry = ensureTitlePopup(opts.parent)
  if (entry.view.popup.webContents.isDestroyed()) return

  const isOpenOrPending = entry.view.isOpen || entry.view.pendingShowTimer !== null
  if (isOpenOrPending && opts.kind !== entry.kind) {
    if (entry.kind === 'instance-picker' && !entry.view.popup.webContents.isDestroyed()) {
      entry.view.popup.webContents.send('comfy-titlepopup:dismiss-modals')
    }
    hideTitlePopup(entry, { releaseFocusToParent: false })
  }

  entry.parentEntryId = opts.parentEntryId
  entry.kind = opts.kind
  entry.titleBarSender = opts.titleBarSender
  entry.view.suppressBlurDismiss = kindUsesBackdrop(opts.kind)

  const rawX = Math.round(Math.max(0, opts.anchor.x))
  let y = Math.round(Math.max(0, opts.anchor.y))

  let width: number
  let height: number
  let x: number
  if (opts.kind === 'menu') {
    width = POPUP_WIDTH
    height = computePopupHeight(opts.items)
    x = clampPopupX(rawX, width, opts.parent)
  } else if (opts.kind === 'downloads') {
    width = DOWNLOADS_POPUP_WIDTH
    height = Math.min(
      DOWNLOADS_POPUP_MAX_HEIGHT_PX,
      Math.round(opts.parent.getContentBounds().height * DOWNLOADS_POPUP_MAX_HEIGHT_RATIO)
    )
    x = clampPopupX(rawX, width, opts.parent)
  } else if (opts.kind === 'instance-picker') {
    const bounds = computePickerBounds(opts.parent)
    width = bounds.width
    height = bounds.height
    x = bounds.x
    y = bounds.y
  } else {
    ;({ x, y, width, height } = computeCenteredCardBounds(opts.kind, opts.parent))
  }

  entry.view.popup.setBounds({ x, y, width, height })

  if (
    (opts.kind === POPUP_KIND.downloads || opts.kind === POPUP_KIND.downloadsFull) &&
    entry.view.rendererReady
  ) {
    notifyTitlePopupDownloads(entry.view.popup)
  }

  entry.view.cancelPendingShow()
  let config: TitlePopupConfig
  if (opts.kind === POPUP_KIND.menu) {
    config = { kind: POPUP_KIND.menu, items: opts.items, theme: opts.theme }
  } else if (opts.kind === POPUP_KIND.downloads) {
    config = { kind: POPUP_KIND.downloads, theme: opts.theme }
  } else if (opts.kind === POPUP_KIND.downloadsFull) {
    config = { kind: POPUP_KIND.downloadsFull, theme: opts.theme }
  } else if (opts.kind === POPUP_KIND.instancePicker) {
    config = { kind: POPUP_KIND.instancePicker, snapshot: opts.snapshot, theme: opts.theme }
    entry.lastPickerBroadcastJson = JSON.stringify(opts.snapshot)
  } else {
    config = { kind: POPUP_KIND.globalSettings, snapshot: opts.snapshot, theme: opts.theme }
    entry.lastGlobalSettingsBroadcastJson = JSON.stringify(opts.snapshot)
  }
  const configJson = JSON.stringify(config)

  if (
    !requiresPerOpenConfigSync(opts) &&
    entry.lastSyncedConfigJson === configJson &&
    !entry.view.popup.webContents.isDestroyed()
  ) {
    showTitlePopupNow(entry)
    return
  }

  entry.lastConfigJson = configJson
  if (entry.view.rendererReady && !entry.view.popup.webContents.isDestroyed()) {
    entry.view.popup.webContents.send('comfy-titlepopup:set-config', config)
  } else {
    entry.pendingConfig = config
  }

  showTitlePopupNow(entry)
}

export function openDownloadsTrayForInstall(installationId: string): void {
  const entry = getEntryByInstallationId(installationId)
  if (!entry || entry.window.isDestroyed()) return
  const existing = titlePopupsByParent.get(entry.window.id)
  if (existing && (existing.view.isOpen || existing.view.pendingShowTimer !== null)) {
    return
  }
  openTitlePopup({
    parent: entry.window,
    parentEntryId: entry.windowKey,
    kind: 'downloads',
    anchor: { x: entry.window.getContentBounds().width, y: TITLEBAR_HEIGHT },
    theme: entry.lastTheme,
    titleBarSender: entry.titleBarView.webContents
  })
}

export interface TitlePopupHostBindings {
  openChooserHostWindow: (initialPanel?: ComfyPanelKey) => void
  returnToDashboard: (parentEntryId: number) => Promise<void> | void
  confirmAndCloseAllHostWindows: (parentWindow: BrowserWindow | null) => Promise<void> | void
  confirmAndCloseHostWindow: (parentWindow: BrowserWindow) => Promise<void> | void
  setActivePanel: (windowKey: number, panel: ComfyPanelKey) => void
  triggerOpenFeedback: (entryId: number, source: 'titlebar' | 'menu') => void
  resetComfyZoom: (installationId: string) => void
  sendToPanelDeferred: (panelView: WebContentsView, channel: string, payload: unknown) => void
  ensurePanelViewForEntry: (entry: ComfyWindowEntry) => WebContentsView
  getInstancePickerInstalls: () => Promise<InstancePickerInstall[]>
  getRunningInstallationIds: () => string[]
  getRunningSessionStartedAt?: () => Record<string, number>
  getLaunchingInstallationIds: () => string[]
  pickInstallFromPicker: (
    installationId: string,
    parentEntryId: number,
    opts?: { confirmed?: boolean }
  ) => Promise<void> | void
  openInstallInNewWindow: (
    installationId: string,
    opts?: { allowDuplicate?: boolean }
  ) => Promise<void> | void
  restartInstallFromPicker: (
    installationId: string,
    parentEntryId: number,
    opts?: { confirmed?: boolean }
  ) => Promise<void> | void
  getPickerDetailsForInstall: (installationId: string) => Promise<{
    settings: Record<string, unknown>[] | null
    snapshots: Record<string, unknown> | null
  }>
  pickerUpdateField: (
    installationId: string,
    fieldId: string,
    value: unknown
  ) => Promise<{ ok: boolean; message?: string }>
  pickerRunAction: (
    installationId: string,
    actionId: string,
    actionData?: Record<string, unknown>
  ) => Promise<{ ok: boolean; message?: string }>
  pickerRunBackgroundOp: (payload: {
    installationId: string
    actionId: string
    actionData?: Record<string, unknown>
    title: string
    cancellable: boolean
  }) => void
  broadcastPickerSnapshot: () => void
}

export function parseGlobalSettingsTarget(
  payload: { tab?: unknown; highlightField?: unknown } | undefined
): { initialTab: GlobalSettingsTab | null; highlightFieldId: string | null } {
  const rawTab = payload?.tab
  const initialTab: GlobalSettingsTab | null =
    rawTab === 'general' ||
    rawTab === 'updates' ||
    rawTab === 'storage' ||
    rawTab === 'advanced' ||
    rawTab === 'logs'
      ? rawTab
      : null
  const rawHighlight = payload?.highlightField
  const highlightFieldId = typeof rawHighlight === 'string' && rawHighlight ? rawHighlight : null
  return { initialTab, highlightFieldId }
}

function openGlobalSettingsForHost(
  parentEntry: ComfyWindowEntry,
  parentEntryId: number,
  bindings: TitlePopupHostBindings,
  titleBarSender: Electron.WebContents,
  initialTab: GlobalSettingsTab | null = null,
  highlightFieldId: string | null = null
): void {
  if (parentEntry.window.isDestroyed()) return
  openTitlePopup({
    parent: parentEntry.window,
    parentEntryId,
    kind: 'global-settings',
    snapshot: buildGlobalSettingsSnapshot(undefined, initialTab, highlightFieldId),
    anchor: { x: 0, y: TITLEBAR_HEIGHT },
    theme: parentEntry.lastTheme,
    titleBarSender
  })
  void (async () => {
    await getGithubStarCount('comfy-org/ComfyUI').catch(() => null)
    githubStarsFetchAttempted = true
    if (parentEntry.window.isDestroyed()) return
    await broadcastGlobalSettingsSnapshotToTitlePopups(bindings)
  })()
}

function openDownloadsFullForHost(
  parentEntry: ComfyWindowEntry,
  parentEntryId: number,
  titleBarSender: Electron.WebContents
): void {
  if (parentEntry.window.isDestroyed()) return
  openTitlePopup({
    parent: parentEntry.window,
    parentEntryId,
    kind: POPUP_KIND.downloadsFull,
    anchor: { x: 0, y: TITLEBAR_HEIGHT },
    theme: parentEntry.lastTheme,
    titleBarSender
  })
}

function openInstancePickerForHost(
  parentEntry: ComfyWindowEntry,
  parentEntryId: number,
  bindings: TitlePopupHostBindings,
  titleBarSender: Electron.WebContents,
  anchor: { x: number; y: number },
  selectedInstallationId?: string | null,
  initialTab?: string | null,
  autoAction?: string | null
): void {
  if (parentEntry.window.isDestroyed()) return
  const installs: InstancePickerInstall[] = cachedInstallsForPicker.slice()
  const runningInstallationIds = bindings.getRunningInstallationIds()
  const runningSessionStartedAt = bindings.getRunningSessionStartedAt?.() ?? {}
  const launchingInstallationIds = bindings.getLaunchingInstallationIds()
  const effectiveHostInstallationId =
    parentEntry.installationId ?? parentEntry.previewInstallationId ?? null
  const initialSelectedId = resolvePickerSelectedInstallId(
    selectedInstallationId,
    effectiveHostInstallationId,
    installs
  )
  const autoActionNonce = autoAction ? (_pickerAutoActionNonce += 1) : _pickerAutoActionNonce
  const popupEntry = ensureTitlePopup(parentEntry.window)
  const pickerSelectionEpoch = popupEntry.pickerSelectionEpoch + 1
  popupEntry.pickerSelectedInstallationId = initialSelectedId
  popupEntry.pickerSelectionEpoch = pickerSelectionEpoch
  popupEntry.pickerInitialTab = initialTab ?? null
  popupEntry.pickerAutoAction = autoAction ?? null
  popupEntry.pickerAutoActionNonce = autoActionNonce
  const snapshot = buildInstancePickerSnapshot({
    installs,
    hostInstallationId: parentEntry.installationId,
    previewInstallationId: parentEntry.previewInstallationId,
    runningInstallationIds,
    runningSessionStartedAt,
    launchingInstallationIds,
    selectedInstallationId: initialSelectedId,
    pickerSelectionEpoch,
    selectedSettings: null,
    selectedSnapshots: null,
    initialTab: initialTab ?? null,
    autoAction: autoAction ?? null,
    autoActionNonce,
    storage: buildPickerStorageSlice(),
    operatingInstallationIds: [..._activeOperationStatus.keys()],
    installOperationStatus: Object.fromEntries(_activeOperationStatus)
  })
  openTitlePopup({
    parent: parentEntry.window,
    parentEntryId,
    kind: 'instance-picker',
    snapshot,
    anchor,
    theme: parentEntry.lastTheme,
    titleBarSender
  })

  const ensuredEntry = titlePopupsByParent.get(parentEntry.window.id)
  if (ensuredEntry) {
    ensuredEntry.pickerAutoAction = null
  }

  void (async () => {
    await refreshCachedInstallsForPicker()
    await broadcastInstancePickerSnapshotToTitlePopups(bindings)
  })()
}

export type FlowMenuItemId = 'new-install' | 'track' | 'load-snapshot' | 'quick-install'

const FLOW_MENU_ITEM_IDS: ReadonlySet<string> = new Set<FlowMenuItemId>([
  'new-install',
  'track',
  'load-snapshot',
  'quick-install'
])

export function isFlowMenuItemId(id: string): id is FlowMenuItemId {
  return FLOW_MENU_ITEM_IDS.has(id)
}

export function decideFlowMenuItemTarget(
  entry: ComfyWindowEntry,
  id: FlowMenuItemId
): { kind: 'set-active-panel' | 'open-chooser-host'; panel: ComfyPanelKey } {
  return isChooserHost(entry)
    ? { kind: 'set-active-panel', panel: id }
    : { kind: 'open-chooser-host', panel: id }
}

export function activateTitlePopupMenuItem(
  entry: TitlePopupEntry,
  id: string,
  bindings: TitlePopupHostBindings
): void {
  mainTelemetry.emit('comfy.desktop.title_menu.item_clicked', {
    item_id: id,
    menu_kind: entry.kind,
    parent_entry_id: entry.parentEntryId
  })
  let releaseFocusToParent = true
  const parentEntry = comfyWindows.get(entry.parentEntryId)
  if (id === 'new-window') {
    bindings.openChooserHostWindow()
    releaseFocusToParent = false
  } else if (id === 'performance-test' || id === 'benchmarks') {
    bindings.openChooserHostWindow(id)
    releaseFocusToParent = false
  } else if (id === 'return-to-dashboard') {
    void bindings.returnToDashboard(entry.parentEntryId)
  } else if (id === 'exit-window') {
    if (parentEntry && !parentEntry.window.isDestroyed()) {
      void bindings.confirmAndCloseHostWindow(parentEntry.window)
    }
  } else if (id === 'close-all-windows') {
    const parentWindow =
      parentEntry && !parentEntry.window.isDestroyed() ? parentEntry.window : null
    void bindings.confirmAndCloseAllHostWindows(parentWindow)
  } else if (id === 'settings') {
    if (parentEntry && !parentEntry.window.isDestroyed()) {
      openGlobalSettingsForHost(
        parentEntry,
        entry.parentEntryId,
        bindings,
        parentEntry.titleBarView.webContents
      )
    }
    return
  } else if (id === 'skip-onboarding') {
    if (parentEntry?.panelView && !parentEntry.panelView.webContents.isDestroyed()) {
      parentEntry.panelView.webContents.send('comfy-panel:first-use-skip')
    }
  } else if (id === 'feedback') {
    bindings.triggerOpenFeedback(entry.parentEntryId, 'menu')
  } else if (id === 'reset-zoom') {
    if (parentEntry != null && parentEntry.installationId !== null) {
      bindings.resetComfyZoom(parentEntry.installationId)
    }
  } else if (isFlowMenuItemId(id)) {
    if (parentEntry) {
      const target = decideFlowMenuItemTarget(parentEntry, id)
      if (target.kind === 'set-active-panel') {
        bindings.setActivePanel(entry.parentEntryId, target.panel)
      } else {
        bindings.openChooserHostWindow(target.panel)
        releaseFocusToParent = false
      }
    }
  }
  hideTitlePopup(entry, { releaseFocusToParent })
}

const GLOBAL_SETTINGS_GITHUB_URL = 'https://github.com/Comfy-Org/Comfy-Desktop'

let lastAppUpdateProgress: Record<string, unknown> | null = null
let globalSettingsLastCheckedAt: number | null = null

let githubStarsFetchAttempted = false

const SETTINGS_TYPE_TO_DETAIL_EDIT_TYPE: Record<string, string | undefined> = {
  text: 'text',
  number: 'number',
  path: 'path',
  select: 'select',
  boolean: 'boolean',
  pathList: undefined
}

function toDetailField(
  f: ReturnType<typeof buildSettingsSections>[number]['fields'][number]
): Record<string, unknown> {
  const editType = SETTINGS_TYPE_TO_DETAIL_EDIT_TYPE[f.type]
  return {
    id: f.id,
    label: f.label,
    value: f.value ?? null,
    editable: !f.readonly,
    editType,
    options: f.options?.map((o) => ({ value: o.value, label: o.label })),
    tooltip: f.tooltip,
    description: f.description,
    placeholder: f.placeholder,
    min: f.min,
    max: f.max,
    openable: f.openable,
    browseOnly: editType === 'path' ? true : undefined
  }
}

function findSettingsFields(
  sections: ReturnType<typeof buildSettingsSections>,
  titleKey: string,
  fallbackIndex: number
): Record<string, unknown>[] {
  const localised = i18n.t(titleKey)
  const found = sections.find((s) => s.title === localised)
  const src = found?.fields ?? sections[fallbackIndex]?.fields ?? []
  return src.map(toDetailField)
}

function buildGlobalSettingsSnapshot(
  installs?: Pick<{ id: string; name: string }, 'id' | 'name'>[],
  initialTab: GlobalSettingsTab | null = null,
  highlightFieldId: string | null = null
): GlobalSettingsSnapshot {
  const settingsSections = buildSettingsSections(installs)
  const mediaSections = buildMediaSections()
  const modelsPayload = buildModelsPayload()
  const generalRaw = findSettingsFields(settingsSections, 'settings.general', 0)
  const desktopUpdateFields = generalRaw.filter((f) => f.id === 'autoInstallUpdates')
  const languageFields = generalRaw.filter((f) => f.id === 'language')
  const generalFields = generalRaw.filter(
    (f) => f.id !== 'autoInstallUpdates' && f.id !== 'language'
  )
  const telemetryFields = findSettingsFields(settingsSections, 'settings.telemetry', 1)
  const cache = findSettingsFields(settingsSections, 'settings.cache', 2)
  const advanced = findSettingsFields(settingsSections, 'settings.advanced', 3)
  const shared = (mediaSections[0]?.fields ?? []).map(toDetailField)
  const installLocationFields = (buildInstallLocationFields()[0]?.fields ?? []).map(toDetailField)
  const modelsDirsRaw = (modelsPayload.sections[0]?.fields[0]?.value as string[] | undefined) ?? []
  const modelsDefault = modelsPayload.systemDefault
  const appUpdateState = updater.getCurrentUpdateState() as unknown as Record<string, unknown>
  const isDownloading = appUpdateState['kind'] === 'downloading'
  if (!isDownloading) lastAppUpdateProgress = null
  const githubStars = getCachedGithubStarCount('comfy-org/ComfyUI')
  const githubStarsLoading = githubStars == null && !githubStarsFetchAttempted
  return {
    initialTab,
    highlightFieldId,
    languageFields,
    generalFields,
    telemetryFields,
    desktopUpdateFields,
    cacheFields: cache,
    advancedFields: advanced,
    sharedDirectoriesFields: shared,
    installLocationFields,
    modelsDirs: modelsDirsRaw.map((p, i) => ({
      path: p,
      isPrimary: i === 0
    })),
    modelsSystemDefault: modelsDefault,
    telemetryGranted: settings.get('telemetryEnabled') === true,
    appUpdate: {
      state: appUpdateState,
      progress: lastAppUpdateProgress,
      isDownloading,
      capabilities: {
        systemManaged: false,
        canSelfUpdate: true
      },
      installedVersion: getAppVersion(),
      platform: process.platform,
      lastCheckedAt: globalSettingsLastCheckedAt
    },
    githubUrl: GLOBAL_SETTINGS_GITHUB_URL,
    githubStars,
    githubStarsLoading,
    i18n: {
      overview: i18n.t('settings.general'),
      updates: i18n.t('settings.updatesTab'),
      storage: i18n.t('settings.storageTab'),
      models: i18n.t('settings.models'),
      advanced: i18n.t('settings.advanced'),
      logs: i18n.t('settings.logs'),
      sharedDirectories: i18n.t('settings.sharedDirectories')
    }
  }
}

async function broadcastGlobalSettingsSnapshotToTitlePopups(
  _bindings: TitlePopupHostBindings
): Promise<void> {
  const hasOpen = Array.from(titlePopupsByParent.values()).some(
    (e) => e.kind === 'global-settings' && (e.view.isOpen || e.view.pendingShowTimer !== null)
  )
  if (!hasOpen) return
  const installs = (await installations.list()).map((i) => ({ id: i.id, name: i.name }))
  for (const entry of titlePopupsByParent.values()) {
    if (entry.kind !== 'global-settings') continue
    if (!entry.view.isOpen && entry.view.pendingShowTimer === null) continue
    if (entry.view.popup.webContents.isDestroyed()) continue
    const snapshot = buildGlobalSettingsSnapshot(installs)
    const snapshotJson = JSON.stringify(snapshot)
    if (entry.lastGlobalSettingsBroadcastJson === snapshotJson) continue
    entry.lastGlobalSettingsBroadcastJson = snapshotJson
    entry.view.popup.webContents.send('comfy-titlepopup:global-settings-changed', snapshot)
  }
}

export function registerTitlePopupIpc(bindings: TitlePopupHostBindings): void {
  activeBindings = bindings

  ipcMain.handle('comfy-window:build-storage-snapshot', () => buildPickerStorageSlice())

  ipcMain.handle('desktop2-open-terminal', (event): boolean => {
    const parentEntry = findEntryByComfySender(event.sender)
    if (!parentEntry?.installationId || parentEntry.sourceCategory !== 'local') return false
    openInstancePickerForHost(
      parentEntry,
      parentEntry.windowKey,
      bindings,
      parentEntry.titleBarView.webContents,
      { x: 0, y: TITLEBAR_HEIGHT },
      parentEntry.installationId,
      'console'
    )
    return true
  })

  ipcMain.on('comfy-titlepopup:ready', (event) => {
    const entry = titlePopupsByWebContents.get(event.sender.id)
    if (!entry) return
    entry.view.rendererReady = true
    entry.lastSyncedConfigJson = null
    const queuedConfig =
      entry.pendingConfig ??
      (entry.lastConfigJson ? (JSON.parse(entry.lastConfigJson) as TitlePopupConfig) : null)
    if (queuedConfig && !entry.view.popup.webContents.isDestroyed()) {
      const flushed = queuedConfig
      entry.lastConfigJson = JSON.stringify(flushed)
      entry.view.popup.webContents.send('comfy-titlepopup:set-config', flushed)
      entry.pendingConfig = null
      if (flushed.kind === POPUP_KIND.downloads || flushed.kind === POPUP_KIND.downloadsFull) {
        notifyTitlePopupDownloads(entry.view.popup)
      }
    }
  })

  ipcMain.on('comfy-titlepopup:rendered', (event) => {
    const entry = titlePopupsByWebContents.get(event.sender.id)
    if (!entry) return
    entry.lastSyncedConfigJson = entry.lastConfigJson
    if (entry.view.pendingShowTimer === null) return
    showTitlePopupNow(entry)
  })

  ipcMain.on('comfy-titlepopup:item-activated', (event, payload: { id?: unknown }) => {
    const entry = titlePopupsByWebContents.get(event.sender.id)
    if (!entry) return
    const id = payload?.id
    if (typeof id !== 'string') return
    activateTitlePopupMenuItem(entry, id, bindings)
  })

  ipcMain.on('comfy-titlepopup:close', (event) => {
    const entry = titlePopupsByWebContents.get(event.sender.id)
    if (!entry) return
    hideTitlePopup(entry, { releaseFocusToParent: true })
  })

  ipcMain.on('comfy-popup-backdrop:dismiss', (event) => {
    const parentId = popupBackdropsByWebContents.get(event.sender.id)
    if (parentId === undefined) return
    const popup = titlePopupsByParent.get(parentId)
    if (!popup) return
    const parent = popup.view.parentWindow
    if (!kindUsesBackdrop(popup.kind) || !popup.view.isOpen) {
      if (!parent.isDestroyed()) hidePopupBackdrop(parent)
      return
    }
    if (Date.now() - popup.openedAt < BACKDROP_DISMISS_GUARD_MS) return
    hideTitlePopup(popup, { releaseFocusToParent: true })
  })

  ipcMain.on('comfy-titlepopup:request-size', (event, payload: { height?: unknown }) => {
    const entry = titlePopupsByWebContents.get(event.sender.id)
    if (!entry) return
    if (entry.kind !== 'downloads') return
    const requested = payload?.height
    if (typeof requested !== 'number' || !Number.isFinite(requested)) return
    const parent = comfyWindows.get(entry.parentEntryId)?.window
    if (!parent || parent.isDestroyed()) return

    const contentHeight = parent.getContentBounds().height
    const ceiling = Math.min(
      DOWNLOADS_POPUP_MAX_HEIGHT_PX,
      Math.round(contentHeight * DOWNLOADS_POPUP_MAX_HEIGHT_RATIO)
    )
    const next = Math.max(1, Math.min(ceiling, Math.ceil(requested)))
    const cur = entry.view.popup.getBounds()
    if (cur.height === next) return
    entry.view.popup.setBounds({ x: cur.x, y: cur.y, width: cur.width, height: next })
  })

  ipcMain.on(
    'comfy-titlepopup:downloads-action',
    (_event, payload: { action?: unknown; ref?: unknown; url?: unknown; savePath?: unknown }) => {
      const { action, ref: rawRef, url, savePath } = payload ?? {}
      if (action === 'clear-finished') {
        clearFinishedDownloads()
        return
      }
      const ref =
        typeof rawRef === 'string' && rawRef.length > 0
          ? rawRef
          : typeof url === 'string' && url.length > 0
            ? url
            : null
      if (ref === null) return
      switch (action) {
        case 'pause':
          pauseModelDownload(ref)
          return
        case 'resume':
          resumeModelDownload(ref)
          return
        case 'cancel':
          cancelModelDownload(ref)
          return
        case 'dismiss':
          dismissRecentDownload(ref)
          return
        case 'retry':
          retryDownload(ref)
          return
        case 'show-in-folder':
          if (typeof savePath === 'string' && savePath.length > 0) {
            shell.showItemInFolder(savePath)
          }
          return
        default:
          return
      }
    }
  )

  // global settings, depending on `tab`. The popup dismisses first; the
  ipcMain.on('comfy-titlepopup:open-settings-tab', (event, payload: { tab?: unknown }) => {
    const popupEntry = titlePopupsByWebContents.get(event.sender.id)
    if (!popupEntry) return
    const tab = payload?.tab
    if (
      tab !== 'comfy' &&
      tab !== 'directories' &&
      tab !== 'downloads' &&
      tab !== 'global' &&
      tab !== 'global-storage'
    ) {
      return
    }
    const parentEntry = comfyWindows.get(popupEntry.parentEntryId)
    if (!parentEntry) return
    hideTitlePopup(popupEntry, { releaseFocusToParent: false })
    const panelView = parentEntry.panelView
    if (!panelView) return
    bindings.sendToPanelDeferred(panelView, 'panel-trigger-overlay', {
      kind: 'open-settings',
      installationId: parentEntry.installationId,
      settingsTab: tab
    })
  })

  ipcMain.on('comfy-titlepopup:open-downloads-modal', (event) => {
    const popupEntry = titlePopupsByWebContents.get(event.sender.id)
    if (!popupEntry) return
    const parentEntry = comfyWindows.get(popupEntry.parentEntryId)
    if (!parentEntry) return
    openDownloadsFullForHost(
      parentEntry,
      popupEntry.parentEntryId,
      parentEntry.titleBarView.webContents
    )
  })

  ipcMain.on(
    'comfy-window:click-downloads-tray',
    (event, payload: { anchor?: { x?: number; y?: number } } | undefined) => {
      const found = findEntryByTitleBarSender(event.sender)
      if (!found) return
      const { id: windowKey, entry } = found
      if (entry.window.isDestroyed()) return

      const parentId = entry.window.id
      const existingPopup = titlePopupsByParent.get(parentId)
      if (
        existingPopup &&
        existingPopup.kind === 'downloads' &&
        (existingPopup.view.isOpen || existingPopup.view.pendingShowTimer !== null)
      ) {
        hideTitlePopup(existingPopup, { releaseFocusToParent: true })
        return
      }
      const hiddenAt = downloadsHiddenAtByParent.get(parentId)
      if (hiddenAt !== undefined && Date.now() - hiddenAt < DOWNLOADS_REOPEN_SUPPRESS_MS) {
        downloadsHiddenAtByParent.delete(parentId)
        return
      }

      const x = Math.max(0, Math.round(payload?.anchor?.x ?? 0))
      const y = Math.max(0, Math.round(payload?.anchor?.y ?? TITLEBAR_HEIGHT))
      openTitlePopup({
        parent: entry.window,
        parentEntryId: windowKey,
        kind: 'downloads',
        anchor: { x, y },
        theme: entry.lastTheme,
        titleBarSender: entry.titleBarView.webContents
      })
    }
  )

  ipcMain.on(
    'comfy-window:open-title-menu',
    (event, payload: { menu?: 'file'; anchor?: { x?: number; y?: number } }) => {
      const found = findEntryByTitleBarSender(event.sender)
      if (!found) return
      const { id: windowKey, entry } = found
      if (entry.window.isDestroyed()) return
      if (payload?.menu !== 'file') return

      const x = Math.max(0, Math.round(payload?.anchor?.x ?? 0))
      const y = Math.max(0, Math.round(payload?.anchor?.y ?? TITLEBAR_HEIGHT))

      openTitlePopup({
        parent: entry.window,
        parentEntryId: windowKey,
        kind: 'menu',
        items: buildTitlePopupMenuItems(entry),
        anchor: { x, y },
        theme: entry.lastTheme,
        titleBarSender: entry.titleBarView.webContents
      })
    }
  )

  ipcMain.on('comfy-window:dismiss-title-menu', (event) => {
    const found = findEntryByTitleBarSender(event.sender)
    if (!found) return
    const popup = titlePopupsByParent.get(found.entry.window.id)
    if (!popup) return
    hideTitlePopup(popup, { releaseFocusToParent: true })
  })

  ipcMain.on(
    'comfy-window:click-install-pill',
    (event, payload: { anchor?: { x?: number; y?: number } } | undefined) => {
      const found = findEntryByTitleBarSender(event.sender)
      if (!found) return
      const { id: windowKey, entry } = found
      if (entry.window.isDestroyed()) return

      const existingPopup = titlePopupsByParent.get(entry.window.id)
      if (
        existingPopup &&
        existingPopup.kind === 'instance-picker' &&
        (existingPopup.view.isOpen || existingPopup.view.pendingShowTimer !== null)
      ) {
        hideTitlePopup(existingPopup, { releaseFocusToParent: true })
        return
      }

      const x = Math.max(0, Math.round(payload?.anchor?.x ?? 0))
      const y = Math.max(0, Math.round(payload?.anchor?.y ?? TITLEBAR_HEIGHT))

      openInstancePickerForHost(entry, windowKey, bindings, entry.titleBarView.webContents, {
        x,
        y
      })
    }
  )

  ipcMain.on(
    'comfy-window:open-instance-picker-for-install',
    (
      event,
      payload:
        | {
            installationId?: unknown
            initialTab?: unknown
            autoAction?: unknown
          }
        | undefined
    ) => {
      recordIpcInvocation('comfy-window:open-instance-picker-for-install', payload)
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      let parentEntryId: number | undefined
      let parentEntry: ComfyWindowEntry | undefined
      for (const [id, e] of comfyWindows) {
        if (e.window === win) {
          parentEntryId = id
          parentEntry = e
          break
        }
      }
      if (parentEntryId === undefined || !parentEntry) return
      const requestedId = payload?.installationId
      const selectedInstallationId =
        typeof requestedId === 'string' && requestedId.length > 0 ? requestedId : null
      const initialTab = typeof payload?.initialTab === 'string' ? payload.initialTab : null
      const autoAction = typeof payload?.autoAction === 'string' ? payload.autoAction : null
      openInstancePickerForHost(
        parentEntry,
        parentEntryId,
        bindings,
        parentEntry.titleBarView.webContents,
        { x: 0, y: TITLEBAR_HEIGHT },
        selectedInstallationId,
        initialTab,
        autoAction
      )
    }
  )

  ipcMain.on(
    'comfy-titlepopup:set-picker-selected-install',
    async (event, payload: { installationId?: unknown }) => {
      const popupEntry = titlePopupsByWebContents.get(event.sender.id)
      if (!popupEntry || popupEntry.kind !== 'instance-picker') return
      const id = payload?.installationId
      if (id !== null && typeof id !== 'string') return
      const nextId = typeof id === 'string' && id.length > 0 ? id : null
      if (popupEntry.pickerSelectedInstallationId === nextId) return
      popupEntry.pickerSelectedInstallationId = nextId
      await broadcastInstancePickerSnapshotToTitlePopups(bindings)
    }
  )

  ipcMain.handle(
    'comfy-titlepopup:picker-update-field',
    async (event, payload: { installationId?: unknown; fieldId?: unknown; value?: unknown }) => {
      const popupEntry = titlePopupsByWebContents.get(event.sender.id)
      if (!popupEntry || popupEntry.kind !== 'instance-picker') {
        return { ok: false, message: 'Picker not active.' }
      }
      const installationId = payload?.installationId
      const fieldId = payload?.fieldId
      if (typeof installationId !== 'string' || typeof fieldId !== 'string') {
        return { ok: false, message: 'Invalid payload.' }
      }
      const result = await bindings.pickerUpdateField(installationId, fieldId, payload.value)
      if (result.ok) {
        await broadcastInstancePickerSnapshotToTitlePopups(bindings)
      }
      return result
    }
  )

  const PICKER_ALLOWED_ACTIONS = new Set(['snapshot-save', 'snapshot-restore', 'snapshot-delete'])
  ipcMain.handle(
    'comfy-titlepopup:picker-run-action',
    async (
      event,
      payload: { installationId?: unknown; actionId?: unknown; actionData?: unknown }
    ) => {
      const popupEntry = titlePopupsByWebContents.get(event.sender.id)
      if (!popupEntry || popupEntry.kind !== 'instance-picker') {
        return { ok: false, message: 'Picker not active.' }
      }
      const installationId = payload?.installationId
      const actionId = payload?.actionId
      if (typeof installationId !== 'string' || typeof actionId !== 'string') {
        return { ok: false, message: 'Invalid payload.' }
      }
      if (!PICKER_ALLOWED_ACTIONS.has(actionId)) {
        return { ok: false, message: `Action '${actionId}' is not available from the picker.` }
      }
      const actionData =
        payload.actionData && typeof payload.actionData === 'object'
          ? (payload.actionData as Record<string, unknown>)
          : undefined
      const result = await bindings.pickerRunAction(installationId, actionId, actionData)
      if (result.ok) {
        await broadcastInstancePickerSnapshotToTitlePopups(bindings)
      }
      return result
    }
  )

  ipcMain.on(
    'comfy-titlepopup:pick-install',
    (event, payload: { installationId?: unknown; confirmed?: unknown }) => {
      const entry = titlePopupsByWebContents.get(event.sender.id)
      if (!entry || entry.kind !== POPUP_KIND.instancePicker) return
      const installationId = payload?.installationId
      if (typeof installationId !== 'string' || installationId.length === 0) return
      const confirmed = payload?.confirmed === true
      hideTitlePopup(entry, { releaseFocusToParent: false })
      Promise.resolve(
        bindings.pickInstallFromPicker(installationId, entry.parentEntryId, { confirmed })
      ).catch((err) => console.error('pickInstallFromPicker failed:', err))
    }
  )

  ipcMain.on(
    'comfy-titlepopup:open-install-new-window',
    (event, payload: { installationId?: unknown; allowDuplicate?: unknown }) => {
      const entry = titlePopupsByWebContents.get(event.sender.id)
      if (!entry || entry.kind !== POPUP_KIND.instancePicker) return
      const installationId = payload?.installationId
      if (typeof installationId !== 'string' || installationId.length === 0) return
      hideTitlePopup(entry, { releaseFocusToParent: false })
      Promise.resolve(
        bindings.openInstallInNewWindow(installationId, {
          allowDuplicate: payload?.allowDuplicate === true
        })
      ).catch((err) => console.error('openInstallInNewWindow failed:', err))
    }
  )

  ipcMain.on('comfy-window:open-install-new-window', (event, installationId: unknown) => {
    if (!isPanelSender(event.sender)) return
    if (typeof installationId !== 'string' || installationId.length === 0) return
    Promise.resolve(bindings.openInstallInNewWindow(installationId)).catch((err) =>
      console.error('openInstallInNewWindow failed:', err)
    )
  })

  ipcMain.on(
    'comfy-titlepopup:restart-install',
    (event, payload: { installationId?: unknown; confirmed?: unknown }) => {
      const entry = titlePopupsByWebContents.get(event.sender.id)
      if (!entry || entry.kind !== POPUP_KIND.instancePicker) return
      const installationId = payload?.installationId
      if (typeof installationId !== 'string' || installationId.length === 0) return
      const confirmed = payload?.confirmed === true
      hideTitlePopup(entry, { releaseFocusToParent: false })
      Promise.resolve(
        bindings.restartInstallFromPicker(installationId, entry.parentEntryId, { confirmed })
      ).catch((err) => console.error('restartInstallFromPicker failed:', err))
    }
  )

  ipcMain.on(
    'comfy-titlepopup:forward-show-progress',
    (event, payload: Record<string, unknown>) => {
      const popupEntry = titlePopupsByWebContents.get(event.sender.id)
      if (!popupEntry || popupEntry.kind !== 'instance-picker') return
      const installationId = payload?.installationId
      const actionId = payload?.actionId
      if (typeof installationId !== 'string' || installationId.length === 0) return
      if (typeof actionId !== 'string' || actionId.length === 0) return

      if (payload?.routing === 'inline-picker') {
        const title = typeof payload?.title === 'string' ? payload.title : actionId
        const cancellable = payload?.cancellable === true
        const actionData = payload?.actionData as Record<string, unknown> | undefined
        bindings.pickerRunBackgroundOp({ installationId, actionId, actionData, title, cancellable })
        return
      }

      hideTitlePopup(popupEntry, { releaseFocusToParent: false })

      const routing = payload?.routing === 'target-host' ? 'target-host' : 'same-host'
      const targetEntry =
        routing === 'target-host'
          ? (getEntryByInstallationId(installationId) ?? comfyWindows.get(popupEntry.parentEntryId))
          : comfyWindows.get(popupEntry.parentEntryId)
      if (!targetEntry) return

      if (routing === 'target-host' && !targetEntry.window.isDestroyed()) {
        targetEntry.window.show()
        targetEntry.window.focus()
      }

      const panelView = bindings.ensurePanelViewForEntry(targetEntry)
      if (panelView.webContents.isDestroyed()) return

      bindings.setActivePanel(targetEntry.windowKey, 'progress')

      bindings.sendToPanelDeferred(panelView, 'panel-trigger-overlay', {
        kind: 'picker-show-progress',
        installationId,
        actionId,
        actionData: payload?.actionData,
        title: payload?.title,
        cancellable: payload?.cancellable,
        triggersInstanceStart: payload?.triggersInstanceStart,
        opKind: payload?.opKind,
        isRestart: payload?.isRestart,
        successChoice: payload?.successChoice
      })
    }
  )

  ipcMain.on('comfy-titlepopup:start-background-op', (event, payload: Record<string, unknown>) => {
    const popupEntry = titlePopupsByWebContents.get(event.sender.id)
    if (!popupEntry || popupEntry.kind !== 'instance-picker') return
    const installationId = payload?.installationId
    const actionId = payload?.actionId
    if (typeof installationId !== 'string' || installationId.length === 0) return
    if (typeof actionId !== 'string' || actionId.length === 0) return
    const title = typeof payload?.title === 'string' ? payload.title : actionId
    const cancellable = payload?.cancellable === true
    const actionData = payload?.actionData as Record<string, unknown> | undefined
    recordIpcInvocation('comfy-titlepopup:start-background-op', {
      installationId,
      actionId,
      actionData
    })
    bindings.pickerRunBackgroundOp({ installationId, actionId, actionData, title, cancellable })
  })

  ipcMain.on(
    'comfy-titlepopup:cancel-background-op',
    (event, payload: { installationId?: unknown }) => {
      const popupEntry = titlePopupsByWebContents.get(event.sender.id)
      if (!popupEntry || popupEntry.kind !== 'instance-picker') return
      const installationId = payload?.installationId
      if (typeof installationId !== 'string' || installationId.length === 0) return
      recordIpcInvocation('comfy-titlepopup:cancel-background-op', { installationId })
      _operationAborts.get(installationId)?.abort()
    }
  )

  ipcMain.on(
    'comfy-titlepopup:dismiss-background-op',
    (event, payload: { installationId?: unknown }) => {
      const popupEntry = titlePopupsByWebContents.get(event.sender.id)
      if (!popupEntry || popupEntry.kind !== 'instance-picker') return
      const installationId = payload?.installationId
      if (typeof installationId !== 'string' || installationId.length === 0) return
      _activeOperationStatus.delete(installationId)
      bindings.broadcastPickerSnapshot()
    }
  )

  const PICKER_NON_MODAL_ACTIONS = new Set(['reveal-in-folder'])
  ipcMain.on(
    'comfy-titlepopup:open-install-action',
    (event, payload: { installationId?: unknown; actionId?: unknown }) => {
      const popupEntry = titlePopupsByWebContents.get(event.sender.id)
      if (!popupEntry || popupEntry.kind !== 'instance-picker') return
      const installationId = payload?.installationId
      const actionId = payload?.actionId
      if (typeof installationId !== 'string' || installationId.length === 0) return
      if (typeof actionId !== 'string' || actionId.length === 0) return
      const parentEntry = comfyWindows.get(popupEntry.parentEntryId)
      if (!parentEntry) return
      if (!PICKER_NON_MODAL_ACTIONS.has(actionId)) {
        hideTitlePopup(popupEntry, { releaseFocusToParent: false })
      }
      const panelView = bindings.ensurePanelViewForEntry(parentEntry)
      if (panelView.webContents.isDestroyed()) return
      bindings.sendToPanelDeferred(panelView, 'panel-trigger-overlay', {
        kind: 'picker-install-action',
        installationId,
        actionId
      })
    }
  )

  ipcMain.on('comfy-titlepopup:open-new-install', (event) => {
    const entry = titlePopupsByWebContents.get(event.sender.id)
    if (!entry) return
    const parentEntry = comfyWindows.get(entry.parentEntryId)
    if (!parentEntry) return
    hideTitlePopup(entry, { releaseFocusToParent: false })
    if (parentEntry.installationId === null) {
      bindings.setActivePanel(entry.parentEntryId, 'new-install')
    } else {
      bindings.openChooserHostWindow('new-install')
    }
  })

  ipcMain.on(
    'comfy-titlepopup:open-global-settings',
    (event, payload?: { tab?: unknown; highlightField?: unknown }) => {
      recordIpcInvocation('comfy-titlepopup:open-global-settings')
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      let parentEntryId: number | undefined
      let parentEntry: ComfyWindowEntry | undefined
      for (const [id, e] of comfyWindows) {
        if (e.window === win) {
          parentEntryId = id
          parentEntry = e
          break
        }
      }
      if (parentEntryId === undefined || !parentEntry) return
      const { initialTab, highlightFieldId } = parseGlobalSettingsTarget(payload)
      openGlobalSettingsForHost(
        parentEntry,
        parentEntryId,
        bindings,
        parentEntry.titleBarView.webContents,
        initialTab,
        highlightFieldId
      )
    }
  )

  const settingsEntryFor = (senderId: number): TitlePopupEntry | null => {
    const entry = titlePopupsByWebContents.get(senderId)
    if (!entry || (entry.kind !== 'global-settings' && entry.kind !== 'instance-picker')) {
      return null
    }
    return entry
  }

  ipcMain.on(
    PICKER_SETTINGS_CHANNELS.openGlobalSettings,
    (event, payload?: { tab?: unknown; highlightField?: unknown }) => {
      recordIpcInvocation(PICKER_SETTINGS_CHANNELS.openGlobalSettings)
      const entry = settingsEntryFor(event.sender.id)
      if (!entry) return
      const parentEntry = comfyWindows.get(entry.parentEntryId)
      if (!parentEntry || parentEntry.window.isDestroyed()) return
      const { initialTab, highlightFieldId } = parseGlobalSettingsTarget(payload)
      openGlobalSettingsForHost(
        parentEntry,
        entry.parentEntryId,
        bindings,
        parentEntry.titleBarView.webContents,
        initialTab,
        highlightFieldId
      )
    }
  )

  ipcMain.handle(
    'comfy-titlepopup:global-settings-update-field',
    (event, payload: { fieldId?: unknown; value?: unknown }) => {
      if (!settingsEntryFor(event.sender.id)) {
        return { ok: false, message: 'Global Settings popup not active.' }
      }
      const fieldId = payload?.fieldId
      if (typeof fieldId !== 'string' || fieldId.length === 0) {
        return { ok: false, message: 'Invalid field id.' }
      }
      try {
        applySettingSet(fieldId, payload.value)
        return { ok: true }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'comfy-titlepopup:global-settings-set-models-dirs',
    (event, payload: { dirs?: unknown }) => {
      if (!settingsEntryFor(event.sender.id)) return { ok: false }
      const dirs = payload?.dirs
      if (!Array.isArray(dirs) || dirs.some((d) => typeof d !== 'string')) {
        return { ok: false }
      }
      applySettingSet('modelsDirs', dirs)
      return { ok: true }
    }
  )

  ipcMain.handle(
    'comfy-titlepopup:global-settings-browse-folder',
    async (event, payload: { defaultPath?: unknown } | undefined) => {
      const popupEntry = settingsEntryFor(event.sender.id)
      if (!popupEntry) return null
      const parentEntry = comfyWindows.get(popupEntry.parentEntryId)
      if (!parentEntry || parentEntry.window.isDestroyed()) return null
      const defaultPath =
        typeof payload?.defaultPath === 'string' && payload.defaultPath.length > 0
          ? payload.defaultPath
          : defaultInstallDir()
      const { canceled, filePaths } = await dialog.showOpenDialog(parentEntry.window, {
        defaultPath,
        properties: ['openDirectory', 'createDirectory']
      })
      if (canceled || filePaths.length === 0) return null
      return filePaths[0]
    }
  )

  ipcMain.on('comfy-titlepopup:global-settings-open-path', (event, payload: { path?: unknown }) => {
    if (!settingsEntryFor(event.sender.id)) return
    const targetPath = payload?.path
    if (typeof targetPath !== 'string' || targetPath.length === 0) return
    void openPathHelper(targetPath)
  })

  ipcMain.on('comfy-titlepopup:global-settings-open-logs-folder', (event) => {
    if (!settingsEntryFor(event.sender.id)) return
    void openPathHelper(getAppLogDir())
  })

  ipcMain.on(
    'comfy-titlepopup:global-settings-reveal-path',
    (event, payload: { path?: unknown }) => {
      if (!settingsEntryFor(event.sender.id)) return
      const targetPath = payload?.path
      if (typeof targetPath !== 'string' || targetPath.length === 0) return
      shell.showItemInFolder(targetPath)
    }
  )

  ipcMain.on(
    'comfy-titlepopup:global-settings-open-external',
    (event, payload: { url?: unknown }) => {
      const popupEntry = titlePopupsByWebContents.get(event.sender.id)
      if (!popupEntry || popupEntry.kind !== 'global-settings') return
      const url = payload?.url
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return
      void shell.openExternal(url)
    }
  )

  ipcMain.handle('comfy-titlepopup:global-settings-check-for-update', async (event) => {
    const popupEntry = titlePopupsByWebContents.get(event.sender.id)
    if (!popupEntry || popupEntry.kind !== 'global-settings') {
      return { available: false, error: 'Global Settings popup not active.' }
    }
    try {
      return await updater.runCheck('global-settings')
    } catch (err) {
      return { available: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('comfy-titlepopup:global-settings-download-update', async (event) => {
    const popupEntry = titlePopupsByWebContents.get(event.sender.id)
    if (!popupEntry || popupEntry.kind !== 'global-settings') return
    await updater.downloadUpdate()
  })

  ipcMain.on('comfy-titlepopup:global-settings-install-update', (event) => {
    const popupEntry = titlePopupsByWebContents.get(event.sender.id)
    if (!popupEntry || popupEntry.kind !== 'global-settings') return
    updater.installUpdate()
  })

  ipcMain.on(
    'comfy-titlepopup:global-settings-set-last-checked',
    (event, payload: { value?: unknown }) => {
      const popupEntry = titlePopupsByWebContents.get(event.sender.id)
      if (!popupEntry || popupEntry.kind !== 'global-settings') return
      const value = payload?.value
      if (typeof value !== 'number' || !Number.isFinite(value)) return
      globalSettingsLastCheckedAt = value
      void broadcastGlobalSettingsSnapshotToTitlePopups(bindings)
    }
  )

  downloadEvents.on('tray-state-changed', broadcastDownloadsToTitlePopups)
  installationEvents.on('changed', () => {
    void refreshCachedInstallsForPicker()
    void broadcastInstancePickerSnapshotToTitlePopups(bindings)
    void broadcastGlobalSettingsSnapshotToTitlePopups(bindings)
  })
  hostInstallEvents.on('changed', () => {
    void broadcastInstancePickerSnapshotToTitlePopups(bindings)
  })
  sessionLifecycleEvents.on('changed', () => {
    void broadcastInstancePickerSnapshotToTitlePopups(bindings)
  })
  globalSettingsEvents.on('changed', () => {
    void broadcastGlobalSettingsSnapshotToTitlePopups(bindings)
    void broadcastInstancePickerSnapshotToTitlePopups(bindings)
  })
  updater.onUpdateStateChanged(() => {
    void broadcastGlobalSettingsSnapshotToTitlePopups(bindings)
  })
  ipcMain.on('comfy-popup-internal:noop', () => {})
}

export function notifyGlobalSettingsDownloadProgress(progress: Record<string, unknown>): void {
  lastAppUpdateProgress = progress
  if (!activeBindings) return
  void broadcastGlobalSettingsSnapshotToTitlePopups(activeBindings)
}

export function _test_setTitlePopupEntry(webContentsId: number, entry: TitlePopupEntry): void {
  titlePopupsByWebContents.set(webContentsId, entry)
}

export function _test_deleteTitlePopupEntry(webContentsId: number): void {
  titlePopupsByWebContents.delete(webContentsId)
}

export function _test_buildGlobalSettingsSnapshot(): GlobalSettingsSnapshot {
  return buildGlobalSettingsSnapshot()
}

export function _test_getOpenTitlePopupBounds(): {
  kind: TitlePopupKind
  bounds: Electron.Rectangle
} | null {
  for (const entry of titlePopupsByParent.values()) {
    if (!entry.view.isOpen) continue
    if (entry.view.popup.webContents.isDestroyed()) continue
    return { kind: entry.kind, bounds: entry.view.popup.getBounds() }
  }
  return null
}
