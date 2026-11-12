import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { buildElectronApi } from './api'
import { normaliseFirstUseMode, type FirstUseMode } from '../shared/firstUseMode'

export type ComfyPanelKey =
  | 'comfy'
  | 'home'
  | 'performance-test'
  | 'benchmarks'
  | 'new-install'
  | 'track'
  | 'load-snapshot'
  | 'quick-install'

export type CoachmarkKind = 'pill-hint' | 'beta-notice'

function coachmarkKindOf(payload?: { kind?: unknown }): CoachmarkKind {
  return payload?.kind === 'beta-notice' ? 'beta-notice' : 'pill-hint'
}

export interface TitleMenuAnchor {
  x: number
  y: number
}

export interface DownloadsTrayEntry {
  id?: string
  url: string
  filename: string
  directory?: string
  progress: number
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'
  error?: string
}

export interface DownloadsTrayState {
  active: DownloadsTrayEntry[]
  recent: DownloadsTrayEntry[]
}

export interface ComfyTitleBarBridge {
  getInstallationId(): string | null
  isMac(): boolean
  setPanel(panel: ComfyPanelKey): void
  closeBuildTab(): void
  openNewWindow(): void
  openFileMenu(anchor: TitleMenuAnchor): void
  dismissFileMenu(): void

  onPanelChanged(cb: (panel: ComfyPanelKey) => void): () => void
  onTitleChanged(cb: (title: string) => void): () => void
  onSourceCategoryChanged(cb: (category: string | null) => void): () => void
  onZoomChanged(cb: (level: number) => void): () => void
  onThemeChanged(cb: (theme: { bg: string; text: string }) => void): () => void
  onFullscreenChanged(cb: (fullscreen: boolean) => void): () => void
  onMenuOpened(cb: (info: { menu: 'menu' | 'downloads' | 'instance-picker' }) => void): () => void
  onMenuClosed(cb: (info: { menu: 'menu' | 'downloads' | 'instance-picker' }) => void): () => void
  onFirstUseModeChanged(cb: (mode: FirstUseMode) => void): () => void
  onPreviewModeChanged(cb: (preview: boolean) => void): () => void
  onInstallationIdChanged(cb: (installationId: string | null) => void): () => void
  onAppUpdateStateChanged(
    cb: (state: {
      kind: 'available' | 'downloading' | 'ready' | null
      version: string | null
      autoUpdate: boolean
    }) => void
  ): () => void
  onInstallUpdateAvailable(
    cb: (state: { available: boolean; version: string | null }) => void
  ): () => void
  clickAppUpdatePill(): void
  clickInstallUpdatePill(): void
  onDownloadsChanged(cb: (state: DownloadsTrayState) => void): () => void
  clickDownloadsTray(anchor: TitleMenuAnchor): void
  clickInstallPill(anchor: TitleMenuAnchor): void
  clickFeedback(): void
  clickAnnouncement(): void
  clickRefreshInstance(): void
  resetZoom(): void
  showTooltip(payload: { text: string; leftX: number; rightX: number; bottomY: number }): void
  hideTooltip(): void
  showCoachmark(payload: {
    kind?: CoachmarkKind
    title: string
    body: string
    dismissLabel: string
    actionLabel?: string
    leftX: number
    rightX: number
    bottomY: number
  }): void
  hideCoachmark(): void
  onCoachmarkDismissed(cb: (payload: { kind: CoachmarkKind }) => void): () => void
  onCoachmarkAction(cb: (payload: { kind: CoachmarkKind }) => void): () => void
  onCoachmarkAutoHidden(cb: (payload: { kind: CoachmarkKind }) => void): () => void
  onCoachmarkSettled(cb: (payload: { kind: CoachmarkKind }) => void): () => void
  onCoachmarkDisplaced(cb: (payload: { kind: CoachmarkKind }) => void): () => void
  ready(): void
}

interface PreloadGlobals {
  location?: { href: string }
  navigator?: { userAgent: string }
}
const g = globalThis as unknown as PreloadGlobals

function readInstallationId(): string | null {
  try {
    const href = g.location?.href
    if (!href) return null
    return new URL(href).searchParams.get('installationId')
  } catch {
    return null
  }
}

const bridge: ComfyTitleBarBridge = {
  getInstallationId: () => readInstallationId(),
  isMac: () => (g.navigator?.userAgent ?? '').toLowerCase().includes('mac'),
  setPanel: (panel) => {
    ipcRenderer.send('comfy-window:set-panel', { panel })
  },
  closeBuildTab: () => {
    ipcRenderer.send('comfy-window:close-build-tab')
  },
  openNewWindow: () => {
    ipcRenderer.send('comfy-window:new-chooser-window')
  },
  openFileMenu: (anchor) => {
    ipcRenderer.send('comfy-window:open-title-menu', { menu: 'file', anchor })
  },
  dismissFileMenu: () => {
    ipcRenderer.send('comfy-window:dismiss-title-menu')
  },

  onPanelChanged: (cb) => {
    const handler = (_event: IpcRendererEvent, panel: unknown): void => {
      if (typeof panel === 'string') cb(panel as ComfyPanelKey)
    }
    ipcRenderer.on('comfy-titlebar:panel-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:panel-changed', handler)
  },
  onTitleChanged: (cb) => {
    const handler = (_event: IpcRendererEvent, title: unknown): void => {
      if (typeof title === 'string') cb(title)
    }
    ipcRenderer.on('comfy-titlebar:title-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:title-changed', handler)
  },
  onSourceCategoryChanged: (cb) => {
    const handler = (_event: IpcRendererEvent, category: unknown): void => {
      cb(typeof category === 'string' ? category : null)
    }
    ipcRenderer.on('comfy-titlebar:source-category-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:source-category-changed', handler)
  },
  onZoomChanged: (cb) => {
    const handler = (_event: IpcRendererEvent, level: unknown): void => {
      cb(typeof level === 'number' ? level : 0)
    }
    ipcRenderer.on('comfy-titlebar:zoom-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:zoom-changed', handler)
  },
  onThemeChanged: (cb) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void => {
      const { bg, text } = (data || {}) as { bg?: string; text?: string }
      if (typeof bg === 'string' && typeof text === 'string') cb({ bg, text })
    }
    ipcRenderer.on('comfy-titlebar:theme-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:theme-changed', handler)
  },
  onFullscreenChanged: (cb) => {
    const handler = (_event: IpcRendererEvent, fullscreen: unknown): void => {
      cb(!!fullscreen)
    }
    ipcRenderer.on('comfy-titlebar:fullscreen-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:fullscreen-changed', handler)
  },
  onMenuOpened: (cb) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void => {
      const { menu } = (data || {}) as { menu?: unknown }
      if (menu === 'menu' || menu === 'downloads' || menu === 'instance-picker') cb({ menu })
    }
    ipcRenderer.on('comfy-titlebar:menu-opened', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:menu-opened', handler)
  },
  onMenuClosed: (cb) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void => {
      const { menu } = (data || {}) as { menu?: unknown }
      if (menu === 'menu' || menu === 'downloads' || menu === 'instance-picker') cb({ menu })
    }
    ipcRenderer.on('comfy-titlebar:menu-closed', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:menu-closed', handler)
  },
  onFirstUseModeChanged: (cb) => {
    const handler = (_event: IpcRendererEvent, mode: unknown): void => {
      cb(normaliseFirstUseMode(mode))
    }
    ipcRenderer.on('comfy-titlebar:first-use-mode-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:first-use-mode-changed', handler)
  },
  onPreviewModeChanged: (cb) => {
    const handler = (_event: IpcRendererEvent, preview: unknown): void => {
      cb(!!preview)
    }
    ipcRenderer.on('comfy-titlebar:preview-mode-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:preview-mode-changed', handler)
  },
  onInstallationIdChanged: (cb) => {
    const handler = (_event: IpcRendererEvent, installationId: unknown): void => {
      cb(typeof installationId === 'string' ? installationId : null)
    }
    ipcRenderer.on('comfy-titlebar:installation-id-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:installation-id-changed', handler)
  },
  onAppUpdateStateChanged: (cb) => {
    const handler = (_event: IpcRendererEvent, state: unknown): void => {
      const data = (state || {}) as { kind?: unknown; version?: unknown; autoUpdate?: unknown }
      const kind =
        data.kind === 'available' || data.kind === 'downloading' || data.kind === 'ready'
          ? data.kind
          : null
      const version = typeof data.version === 'string' ? data.version : null
      const autoUpdate = data.autoUpdate !== false
      cb({ kind, version, autoUpdate })
    }
    ipcRenderer.on('comfy-titlebar:app-update-state-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:app-update-state-changed', handler)
  },
  onInstallUpdateAvailable: (cb) => {
    const handler = (_event: IpcRendererEvent, state: unknown): void => {
      const data = (state || {}) as { available?: unknown; version?: unknown }
      const available = !!data.available
      const version = typeof data.version === 'string' ? data.version : null
      cb({ available, version })
    }
    ipcRenderer.on('comfy-titlebar:install-update-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:install-update-changed', handler)
  },
  clickAppUpdatePill: () => {
    ipcRenderer.send('comfy-window:click-app-update-pill')
  },
  clickInstallUpdatePill: () => {
    ipcRenderer.send('comfy-window:click-install-update-pill')
  },
  onDownloadsChanged: (cb) => {
    const handler = (_event: IpcRendererEvent, state: unknown): void => {
      const data = (state || {}) as { active?: unknown; recent?: unknown }
      const active = Array.isArray(data.active) ? (data.active as DownloadsTrayEntry[]) : []
      const recent = Array.isArray(data.recent) ? (data.recent as DownloadsTrayEntry[]) : []
      cb({ active, recent })
    }
    ipcRenderer.on('comfy-titlebar:downloads-changed', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:downloads-changed', handler)
  },
  clickDownloadsTray: (anchor) => {
    ipcRenderer.send('comfy-window:click-downloads-tray', { anchor })
  },
  clickInstallPill: (anchor) => {
    ipcRenderer.send('comfy-window:click-install-pill', { anchor })
  },
  clickFeedback: () => {
    ipcRenderer.send('comfy-window:click-feedback')
  },
  clickAnnouncement: () => {
    ipcRenderer.send('comfy-window:click-announcement')
  },
  clickRefreshInstance: () => {
    ipcRenderer.send('comfy-window:click-refresh-instance')
  },
  resetZoom: () => {
    ipcRenderer.send('comfy-window:reset-zoom')
  },
  showTooltip: (payload) => {
    ipcRenderer.send('comfy-window:show-titlebar-tooltip', payload)
  },
  hideTooltip: () => {
    ipcRenderer.send('comfy-window:hide-titlebar-tooltip')
  },
  showCoachmark: (payload) => {
    ipcRenderer.send('comfy-window:show-titlebar-coachmark', payload)
  },
  hideCoachmark: () => {
    ipcRenderer.send('comfy-window:hide-titlebar-coachmark')
  },
  onCoachmarkDismissed: (cb) => {
    const handler = (_event: IpcRendererEvent, payload?: { kind?: unknown }): void =>
      cb({ kind: coachmarkKindOf(payload) })
    ipcRenderer.on('comfy-titlebar:coachmark-dismissed', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:coachmark-dismissed', handler)
  },
  onCoachmarkAction: (cb) => {
    const handler = (_event: IpcRendererEvent, payload?: { kind?: unknown }): void =>
      cb({ kind: coachmarkKindOf(payload) })
    ipcRenderer.on('comfy-titlebar:coachmark-action', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:coachmark-action', handler)
  },
  onCoachmarkAutoHidden: (cb: (payload: { kind: CoachmarkKind }) => void) => {
    const handler = (_e: unknown, payload?: { kind?: unknown }): void =>
      cb({ kind: coachmarkKindOf(payload) })
    ipcRenderer.on('comfy-titlebar:coachmark-auto-hidden', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:coachmark-auto-hidden', handler)
  },
  onCoachmarkSettled: (cb: (payload: { kind: CoachmarkKind }) => void) => {
    const handler = (_e: unknown, payload?: { kind?: unknown }): void =>
      cb({ kind: coachmarkKindOf(payload) })
    ipcRenderer.on('comfy-titlebar:coachmark-settled', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:coachmark-settled', handler)
  },
  onCoachmarkDisplaced: (cb: (payload: { kind: CoachmarkKind }) => void) => {
    const handler = (_e: unknown, payload?: { kind?: unknown }): void =>
      cb({ kind: coachmarkKindOf(payload) })
    ipcRenderer.on('comfy-titlebar:coachmark-displaced', handler)
    return () => ipcRenderer.removeListener('comfy-titlebar:coachmark-displaced', handler)
  },
  ready: () => {
    ipcRenderer.send('comfy-window:title-bar-ready')
  }
}

const api = buildElectronApi()

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('__comfyTitleBar', bridge)
  contextBridge.exposeInMainWorld('api', api)
} else {
  ;(globalThis as Record<string, unknown>).__comfyTitleBar = bridge
  ;(globalThis as Record<string, unknown>).api = api
}
