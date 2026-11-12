import { EventEmitter } from 'events'
import type { BrowserWindow, WebContents, WebContentsView } from 'electron'
import { _runningSessions, _isStopping } from '../lib/ipc/shared'
import type { FirstUseMode } from '../../shared/firstUseMode'
import { normaliseCategory, viewKindFor } from '../../shared/viewKind'
import type { ViewKind } from '../../shared/viewKind'

export const hostInstallEvents = new EventEmitter()

export type ComfyPanelKey =
  | 'comfy'
  | 'performance-test'
  | 'benchmarks'
  | 'feedback'
  | 'new-install'
  | 'track'
  | 'load-snapshot'
  | 'quick-install'
  | 'progress'
  | 'announcement'
  | 'mcp-setup'

export const VALID_PANELS: ReadonlySet<ComfyPanelKey> = new Set([
  'comfy',
  'performance-test',
  'benchmarks',
  'feedback',
  'new-install',
  'track',
  'load-snapshot',
  'quick-install',
  'progress',
  'announcement',
  'mcp-setup'
])

export type BodyMode =
  | 'comfy'
  | 'comfy-lifecycle'
  | 'feedback'
  | 'chooser'
  | 'performance-test'
  | 'benchmarks'
  | 'progress'
  | 'new-install'
  | 'track'
  | 'load-snapshot'
  | 'quick-install'
  | 'announcement'
  | 'mcp-setup'

export interface ComfyWindowEntry {
  windowKey: number
  window: BrowserWindow
  comfyView: WebContentsView
  titleBarView: WebContentsView
  panelView: WebContentsView | null
  activePanel: ComfyPanelKey
  pendingOverlayReveal?: boolean
  overlayRevealTimer?: ReturnType<typeof setTimeout>

  lastTheme: { bg: string; text: string }
  layoutViews: () => void
  comfyUrl: string
  installationId: string | null
  constructedPartition: string | null
  firstUseMode: FirstUseMode
  titleBarText: string
  sourceCategory: string | null
  previewInstallationId: string | null
  coldStartPendingReveal: boolean
  _installCleanup: (() => void) | null
  detachInstall: () => void
}

export const comfyWindows = new Map<number, ComfyWindowEntry>()
const installationIdToWindowKey = new Map<string, number>()

let lastFocusedInstallationId: string | null = null
export function getLastFocusedInstallationId(): string | null {
  return lastFocusedInstallationId
}
export function setLastFocusedInstallationId(id: string | null): void {
  lastFocusedInstallationId = id
}

const pendingAttachClaims = new Map<string, number>()

export function claimAttachHost(installationId: string, windowKey: number): void {
  pendingAttachClaims.set(installationId, windowKey)
}

export function consumeAttachClaim(installationId: string): number | undefined {
  const key = pendingAttachClaims.get(installationId)
  if (key === undefined) return undefined
  pendingAttachClaims.delete(installationId)
  return key
}

export function dropAttachClaimsForWindow(windowKey: number): void {
  for (const [installationId, claimedKey] of pendingAttachClaims) {
    if (claimedKey === windowKey) pendingAttachClaims.delete(installationId)
  }
}

export function _resetAttachClaimsForTest(): void {
  pendingAttachClaims.clear()
}

let _nextWindowKeyValue = 0
export function nextWindowKey(): number {
  return ++_nextWindowKeyValue
}

export function getEntryByInstallationId(installationId: string): ComfyWindowEntry | undefined {
  const key = installationIdToWindowKey.get(installationId)
  return key === undefined ? undefined : comfyWindows.get(key)
}

export function indexInstallationId(installationId: string, windowKey: number): void {
  installationIdToWindowKey.set(installationId, windowKey)
  hostInstallEvents.emit('changed')
}

export function dropInstallationIndex(installationId: string): void {
  const had = installationIdToWindowKey.delete(installationId)
  if (had) hostInstallEvents.emit('changed')
}

export function registerHostEntry(entry: ComfyWindowEntry): void {
  comfyWindows.set(entry.windowKey, entry)
  if (entry.installationId !== null) {
    installationIdToWindowKey.set(entry.installationId, entry.windowKey)
    hostInstallEvents.emit('changed')
  }
}

export function unregisterHostEntry(entry: ComfyWindowEntry): void {
  comfyWindows.delete(entry.windowKey)
  if (entry.installationId !== null) {
    const indexed = installationIdToWindowKey.get(entry.installationId)
    if (indexed === entry.windowKey) {
      installationIdToWindowKey.delete(entry.installationId)
      hostInstallEvents.emit('changed')
    }
  }
}

export function isChooserHost(
  entry: ComfyWindowEntry
): entry is ComfyWindowEntry & { installationId: null } {
  return entry.installationId === null
}

export function isInstallHost(
  entry: ComfyWindowEntry
): entry is ComfyWindowEntry & { installationId: string } {
  return entry.installationId !== null
}

export function shouldConfirmKillForEntry(
  entry: ComfyWindowEntry | null | undefined
): entry is ComfyWindowEntry & { installationId: string } {
  return !!entry && isInstallHost(entry) && entry.sourceCategory === 'local'
}

export function hasRunningSessionForEntry(
  entry: ComfyWindowEntry | null | undefined
): entry is ComfyWindowEntry & { installationId: string } {
  return !!entry && isInstallHost(entry) && _runningSessions.has(entry.installationId)
}

export function computeBodyMode(entry: ComfyWindowEntry): BodyMode {
  if (entry.installationId === null) {
    return entry.activePanel === 'comfy' ? 'chooser' : entry.activePanel
  }
  if (entry.activePanel !== 'comfy') return entry.activePanel
  if (_isStopping(entry.installationId)) return 'comfy-lifecycle'
  return _runningSessions.has(entry.installationId) ? 'comfy' : 'comfy-lifecycle'
}

export function computeViewKind(entry: ComfyWindowEntry): ViewKind {
  return viewKindFor(entry.installationId, normaliseCategory(entry.sourceCategory))
}

export function findEntryByTitleBarSender(
  wc: WebContents
): { id: number; entry: ComfyWindowEntry } | null {
  for (const [id, entry] of comfyWindows) {
    if (entry.titleBarView.webContents === wc) return { id, entry }
  }
  return null
}

export function isPanelSender(wc: WebContents): boolean {
  for (const entry of comfyWindows.values()) {
    if (entry.panelView?.webContents === wc) return true
  }
  return false
}

export function findEntryByComfySender(wc: WebContents): ComfyWindowEntry | null {
  for (const entry of comfyWindows.values()) {
    if (entry.comfyView.webContents === wc) return entry
  }
  return null
}

export function findInstallationIdByComfySender(wc: WebContents): string | null {
  return findEntryByComfySender(wc)?.installationId ?? null
}

export function findEntryByHostWindow(window: BrowserWindow): ComfyWindowEntry | null {
  for (const entry of comfyWindows.values()) {
    if (entry.window === window) return entry
  }
  return null
}

export function findPreferredHostByVisibility(
  pred: (entry: ComfyWindowEntry) => boolean
): ComfyWindowEntry | null {
  let minimisedFallback: ComfyWindowEntry | null = null
  for (const [, entry] of comfyWindows) {
    if (entry.window.isDestroyed() || !pred(entry)) continue
    if (!entry.window.isMinimized()) return entry
    if (minimisedFallback === null) minimisedFallback = entry
  }
  return minimisedFallback
}

export function findPreferredChooserHostWindow(): BrowserWindow | null {
  const entry = findPreferredHostByVisibility((e) => e.installationId === null)
  return entry?.window ?? null
}

export function findPreferredInstallHostWindow(): BrowserWindow | null {
  const mruEntry =
    lastFocusedInstallationId !== null
      ? getEntryByInstallationId(lastFocusedInstallationId)
      : undefined
  const mruAlive = mruEntry && !mruEntry.window.isDestroyed() ? mruEntry : null
  const fallback = findPreferredHostByVisibility((e) => e.installationId !== null)
  if (mruAlive && !mruAlive.window.isMinimized()) return mruAlive.window
  if (fallback && !fallback.window.isMinimized()) return fallback.window
  if (mruAlive) return mruAlive.window
  return fallback?.window ?? null
}

export function bringToFront(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  if (process.platform === 'win32') {
    win.setAlwaysOnTop(true)
    win.show()
    win.focus()
    win.setAlwaysOnTop(false)
  } else {
    win.show()
    win.focus()
  }
}

export function revealColdStartHostIfPending(windowKey: number): void {
  const entry = comfyWindows.get(windowKey)
  if (!entry?.coldStartPendingReveal || entry.window.isDestroyed()) return
  entry.coldStartPendingReveal = false
  entry.layoutViews()
  bringToFront(entry.window)
}

export function forceRevealHostWindow(windowKey: number): void {
  const entry = comfyWindows.get(windowKey)
  if (!entry || entry.window.isDestroyed()) return
  entry.coldStartPendingReveal = false
  entry.layoutViews()
  bringToFront(entry.window)
}

interface HostFactories {
  createChooser: () => BrowserWindow
}
let hostFactories: HostFactories | null = null
export function setHostFactories(factories: HostFactories): void {
  hostFactories = factories
}
function requireChooserFactory(): () => BrowserWindow {
  if (!hostFactories) {
    throw new Error('host registry: setHostFactories() must be called before openOrFocus*')
  }
  return hostFactories.createChooser
}

export function openOrFocusChooserHostWindow(): BrowserWindow {
  const existing = findPreferredChooserHostWindow()
  if (existing) {
    bringToFront(existing)
    return existing
  }
  return requireChooserFactory()()
}

export function openOrFocusAnyHostWindow(): BrowserWindow {
  const installWin = findPreferredInstallHostWindow()
  if (installWin) {
    bringToFront(installWin)
    return installWin
  }
  const chooser = findPreferredChooserHostWindow()
  if (chooser) {
    bringToFront(chooser)
    return chooser
  }
  return requireChooserFactory()()
}

export function raiseAllHostWindows(): BrowserWindow {
  const preferred = findPreferredInstallHostWindow() ?? findPreferredChooserHostWindow()
  if (!preferred) return requireChooserFactory()()

  for (const [, entry] of comfyWindows) {
    if (entry.window.isDestroyed() || entry.window === preferred) continue
    bringToFront(entry.window)
  }
  bringToFront(preferred)
  return preferred
}
