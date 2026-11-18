import { ipcMain } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { TITLEBAR_HEIGHT } from '../lib/titleBarOverlay'
import { EmbeddedPopupView } from './embeddedPopupView'

const TOOLTIP_POPUP_INITIAL_WIDTH = 280
const TOOLTIP_POPUP_INITIAL_HEIGHT = 36
const TOOLTIP_VERTICAL_GAP = 6
const TOOLTIP_POPUP_SHADOW_GUTTER = 16
const TOOLTIP_RENDER_ACK_TIMEOUT_MS = 80

interface TitleTooltipConfig {
  text: string
  theme: { bg: string; text: string; border: string }
  configToken: string
}

let _titleTooltipTokenSeq = 0
function nextTitleTooltipToken(): string {
  _titleTooltipTokenSeq = (_titleTooltipTokenSeq + 1) >>> 0
  return `tt-${_titleTooltipTokenSeq}`
}

export interface TitleTooltipPopupEntry {
  view: EmbeddedPopupView
  pendingConfig: TitleTooltipConfig | null
  pendingAnchor: { leftX: number; rightX: number; bottomY: number } | null
  pendingConfigJson: string | null
  pendingConfigToken: string | null
  lastSyncedConfigJson: string | null
}

const titleTooltipPopupsByParent = new Map<number, TitleTooltipPopupEntry>()
const titleTooltipPopupsByWebContents = new Map<number, TitleTooltipPopupEntry>()

export function getTitleTooltipForParent(parentId: number): TitleTooltipPopupEntry | undefined {
  return titleTooltipPopupsByParent.get(parentId)
}

function resolveTooltipTheme(): { bg: string; text: string; border: string } {
  return { bg: 'rgba(42, 42, 42, 0.94)', text: '#f0f0f0', border: 'rgba(241, 241, 241, 0.07)' }
}

function ensureTitleTooltipPopup(parent: BrowserWindow): TitleTooltipPopupEntry {
  const existing = titleTooltipPopupsByParent.get(parent.id)
  if (existing && !existing.view.isDestroyed()) return existing

  const view = new EmbeddedPopupView({
    parent,
    htmlName: 'comfyTitleTooltip',
    preloadName: 'comfyTitleTooltipPreload.js',
    initialBounds: {
      x: 0,
      y: 0,
      width: TOOLTIP_POPUP_INITIAL_WIDTH,
      height: TOOLTIP_POPUP_INITIAL_HEIGHT
    },
    hideOnParentEvents: ['blur', 'will-move', 'move', 'resize'],
    onParentClosed: () => {
      titleTooltipPopupsByParent.delete(parent.id)
      titleTooltipPopupsByWebContents.delete(view.popupWebContentsId)
    },
    onDestroyed: () => {
      const cur = titleTooltipPopupsByParent.get(parent.id)
      if (cur && cur.view === view) {
        titleTooltipPopupsByParent.delete(parent.id)
      }
      titleTooltipPopupsByWebContents.delete(view.popupWebContentsId)
    }
  })
  const entry: TitleTooltipPopupEntry = {
    view,
    pendingConfig: null,
    pendingAnchor: null,
    pendingConfigJson: null,
    pendingConfigToken: null,
    lastSyncedConfigJson: null
  }
  titleTooltipPopupsByParent.set(view.parentWindowId, entry)
  titleTooltipPopupsByWebContents.set(view.popupWebContentsId, entry)
  return entry
}

function positionTooltipPopup(
  entry: TitleTooltipPopupEntry,
  bubbleSize: { width: number; height: number }
): void {
  const anchor = entry.pendingAnchor
  if (!anchor) return
  if (entry.view.isDestroyed()) return

  const viewWidth = Math.max(
    bubbleSize.width + TOOLTIP_POPUP_SHADOW_GUTTER * 2,
    TOOLTIP_POPUP_SHADOW_GUTTER * 2 + 1
  )
  const viewHeight = Math.max(
    bubbleSize.height + TOOLTIP_POPUP_SHADOW_GUTTER,
    TOOLTIP_POPUP_SHADOW_GUTTER + 1
  )

  const parentBounds = entry.view.parentWindow.getContentBounds()
  let x = Math.round(anchor.leftX - TOOLTIP_POPUP_SHADOW_GUTTER)
  if (x + viewWidth > parentBounds.width) {
    x = Math.round(anchor.rightX + TOOLTIP_POPUP_SHADOW_GUTTER - viewWidth)
  }
  let y = Math.round(anchor.bottomY + TOOLTIP_VERTICAL_GAP - TOOLTIP_POPUP_SHADOW_GUTTER / 2)
  if (x < 0) x = 0
  if (x + viewWidth > parentBounds.width) x = Math.max(0, parentBounds.width - viewWidth)
  if (y < 0) y = 0
  if (y + viewHeight > parentBounds.height) y = Math.max(0, parentBounds.height - viewHeight)

  entry.view.popup.setBounds({ x, y, width: viewWidth, height: viewHeight })
}

export function hideTitleTooltipPopup(entry: TitleTooltipPopupEntry | undefined): void {
  if (!entry) return
  entry.view.hide()
}

export function openTitleTooltipPopup(opts: {
  parent: BrowserWindow
  text: string
  leftX: number
  rightX: number
  bottomY: number
}): void {
  const entry = ensureTitleTooltipPopup(opts.parent)
  if (entry.view.isDestroyed()) return

  entry.pendingAnchor = { leftX: opts.leftX, rightX: opts.rightX, bottomY: opts.bottomY }

  const tooltipBody = { text: opts.text, theme: resolveTooltipTheme() }
  const configBodyJson = JSON.stringify(tooltipBody)

  if (entry.lastSyncedConfigJson === configBodyJson && entry.pendingConfigJson === null) {
    const bounds = entry.view.popup.getBounds()
    positionTooltipPopup(entry, {
      width: Math.max(0, bounds.width - TOOLTIP_POPUP_SHADOW_GUTTER * 2),
      height: Math.max(0, bounds.height - TOOLTIP_POPUP_SHADOW_GUTTER)
    })
    entry.view.showOnTop()
    return
  }

  const token = nextTitleTooltipToken()
  const config: TitleTooltipConfig = { ...tooltipBody, configToken: token }
  entry.pendingConfigJson = configBodyJson
  entry.pendingConfigToken = token
  if (entry.view.rendererReady) {
    entry.view.popup.webContents.send('comfy-titletooltip:set-config', config)
  } else {
    entry.pendingConfig = config
  }
  entry.view.scheduleShowFallback(TOOLTIP_RENDER_ACK_TIMEOUT_MS, () => {
    const bounds = entry.view.popup.getBounds()
    positionTooltipPopup(entry, {
      width: Math.max(0, bounds.width - TOOLTIP_POPUP_SHADOW_GUTTER * 2),
      height: Math.max(0, bounds.height - TOOLTIP_POPUP_SHADOW_GUTTER)
    })
    entry.view.showOnTop()
  })
}

export function registerTitleTooltipIpc(opts: {
  findParentByTitleBarSender: (wc: WebContents) => BrowserWindow | null
}): void {
  ipcMain.on('comfy-titletooltip:ready', (event) => {
    const entry = titleTooltipPopupsByWebContents.get(event.sender.id)
    if (!entry) return
    entry.view.rendererReady = true
    if (entry.pendingConfig) {
      entry.view.popup.webContents.send('comfy-titletooltip:set-config', entry.pendingConfig)
      entry.pendingConfig = null
    }
  })

  ipcMain.on(
    'comfy-titletooltip:rendered',
    (event, payload: { width?: unknown; height?: unknown; configToken?: unknown }) => {
      const entry = titleTooltipPopupsByWebContents.get(event.sender.id)
      if (!entry) return
      const ackToken = typeof payload?.configToken === 'string' ? payload.configToken : ''
      if (!ackToken || ackToken !== entry.pendingConfigToken) return
      const width = typeof payload?.width === 'number' && payload.width > 0 ? payload.width : 0
      const height = typeof payload?.height === 'number' && payload.height > 0 ? payload.height : 0
      if (entry.pendingAnchor) {
        positionTooltipPopup(entry, { width, height })
      }
      if (entry.pendingConfigJson) {
        entry.lastSyncedConfigJson = entry.pendingConfigJson
        entry.pendingConfigJson = null
        entry.pendingConfigToken = null
      }
      if (entry.view.pendingShowTimer === null) return
      entry.view.showOnTop()
    }
  )

  ipcMain.on(
    'comfy-window:show-titlebar-tooltip',
    (
      event,
      payload: {
        text?: unknown
        leftX?: unknown
        rightX?: unknown
        bottomY?: unknown
      }
    ) => {
      const parent = opts.findParentByTitleBarSender(event.sender)
      if (!parent || parent.isDestroyed()) return
      const text = typeof payload?.text === 'string' ? payload.text : ''
      if (!text) return
      const leftX = typeof payload?.leftX === 'number' ? payload.leftX : 0
      const rightX = typeof payload?.rightX === 'number' ? payload.rightX : leftX
      const bottomY = typeof payload?.bottomY === 'number' ? payload.bottomY : TITLEBAR_HEIGHT
      openTitleTooltipPopup({
        parent,
        text,
        leftX: Math.round(leftX),
        rightX: Math.round(rightX),
        bottomY: Math.round(bottomY)
      })
    }
  )

  ipcMain.on('comfy-window:hide-titlebar-tooltip', (event) => {
    const parent = opts.findParentByTitleBarSender(event.sender)
    if (!parent) return
    hideTitleTooltipPopup(titleTooltipPopupsByParent.get(parent.id))
  })
}
