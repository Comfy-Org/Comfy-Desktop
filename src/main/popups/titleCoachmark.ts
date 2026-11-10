import type { CoachmarkBeakPayload } from '../../types/ipc'
import { ipcMain } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { TITLEBAR_HEIGHT } from '../lib/titleBarOverlay'
import { EmbeddedPopupView } from './embeddedPopupView'

const COACHMARK_POPUP_INITIAL_WIDTH = 300
const COACHMARK_POPUP_INITIAL_HEIGHT = 96
export const COACHMARK_VERTICAL_GAP = 10
export const COACHMARK_SHADOW_GUTTER = 18
export const COACHMARK_BEAK_EDGE_MARGIN = 14
const COACHMARK_RENDER_ACK_TIMEOUT_MS = 120

export interface CoachmarkTheme {
  bg: string
  text: string
  border: string
  accent: string
}

export type CoachmarkKind = 'pill-hint' | 'beta-notice'

export interface CoachmarkConfig {
  variant: 'coachmark'
  kind: CoachmarkKind
  title: string
  body: string
  dismissLabel: string
  actionLabel?: string
  beakFraction?: number
  theme: CoachmarkTheme
  configToken: string
}

function resolveCoachmarkTheme(): CoachmarkTheme {
  return { bg: '#1c1c21', text: '#f0f0f1', border: '#2d2d31', accent: '#f0f0f1' }
}

export function buildCoachmarkConfig(opts: {
  kind: CoachmarkKind
  title: string
  body: string
  dismissLabel: string
  actionLabel?: string
  token: string
}): CoachmarkConfig {
  return {
    variant: 'coachmark',
    kind: opts.kind,
    title: opts.title,
    body: opts.body,
    dismissLabel: opts.dismissLabel,
    ...(opts.actionLabel ? { actionLabel: opts.actionLabel } : {}),
    theme: resolveCoachmarkTheme(),
    configToken: opts.token
  }
}

export interface CoachmarkPlacement {
  x: number
  y: number
  width: number
  height: number
  beakFraction: number
  cardCentreInView: number
}

export function positionCoachmark(opts: {
  anchor: { leftX: number; rightX: number; bottomY: number }
  bubble: { width: number; height: number }
  parentBounds: { width: number; height: number }
}): CoachmarkPlacement {
  const viewWidth = Math.max(
    opts.bubble.width + COACHMARK_SHADOW_GUTTER * 2,
    COACHMARK_SHADOW_GUTTER * 2 + 1
  )
  const viewHeight = Math.max(
    opts.bubble.height + COACHMARK_SHADOW_GUTTER,
    COACHMARK_SHADOW_GUTTER + 1
  )
  const pillCenter = (opts.anchor.leftX + opts.anchor.rightX) / 2
  let x = Math.round(pillCenter - viewWidth / 2)
  let y = Math.round(opts.anchor.bottomY + COACHMARK_VERTICAL_GAP - COACHMARK_SHADOW_GUTTER / 2)
  if (x < 0) x = 0
  if (x + viewWidth > opts.parentBounds.width) {
    x = Math.max(0, opts.parentBounds.width - viewWidth)
  }
  if (y < 0) y = 0
  if (y + viewHeight > opts.parentBounds.height) {
    y = Math.max(0, opts.parentBounds.height - viewHeight)
  }
  const cardWidth = Math.max(1, viewWidth - COACHMARK_SHADOW_GUTTER * 2)
  const cardLeft = x + COACHMARK_SHADOW_GUTTER
  const rawFraction = (pillCenter - cardLeft) / cardWidth
  const beakMargin = Math.min(0.5, COACHMARK_BEAK_EDGE_MARGIN / cardWidth)
  const beakFraction = Math.min(1 - beakMargin, Math.max(beakMargin, rawFraction))
  const cardCentreInView = viewWidth / 2
  return { x, y, width: viewWidth, height: viewHeight, beakFraction, cardCentreInView }
}

let _coachmarkTokenSeq = 0
function nextCoachmarkToken(): string {
  _coachmarkTokenSeq = (_coachmarkTokenSeq + 1) >>> 0
  return `cm-${_coachmarkTokenSeq}`
}

interface CoachmarkPopupEntry {
  view: EmbeddedPopupView
  pendingConfig: CoachmarkConfig | null
  pendingAnchor: { leftX: number; rightX: number; bottomY: number } | null
  pendingConfigToken: string | null
  kind: CoachmarkKind
  settleTimer: ReturnType<typeof setTimeout> | null
}

let findTitleBarByParent: ((parent: BrowserWindow) => WebContents | null) | null = null

let retireDrivingHide = false

const COACHMARK_MOVE_SETTLE_MS = 250

const coachmarkPopupsByParent = new Map<number, CoachmarkPopupEntry>()
const coachmarkPopupsByWebContents = new Map<number, CoachmarkPopupEntry>()

function ensureCoachmarkPopup(parent: BrowserWindow): CoachmarkPopupEntry {
  const existing = coachmarkPopupsByParent.get(parent.id)
  if (existing && !existing.view.isDestroyed()) return existing

  const view = new EmbeddedPopupView({
    parent,
    htmlName: 'comfyTitleTooltip',
    preloadName: 'comfyTitleTooltipPreload.js',
    initialBounds: {
      x: 0,
      y: 0,
      width: COACHMARK_POPUP_INITIAL_WIDTH,
      height: COACHMARK_POPUP_INITIAL_HEIGHT
    },
    hideOnParentEvents: ['will-move', 'move', 'resize'],
    onHide: () => {
      if (retireDrivingHide) return
      const entry = coachmarkPopupsByParent.get(parent.id)
      if (!entry || parent.isDestroyed()) return
      const tb = findTitleBarByParent?.(parent)
      if (tb && !tb.isDestroyed()) {
        tb.send('comfy-titlebar:coachmark-auto-hidden', { kind: entry.kind })
      }
    },
    onParentClosed: () => {
      const entry = coachmarkPopupsByParent.get(parent.id)
      if (entry?.settleTimer) clearTimeout(entry.settleTimer)
      coachmarkPopupsByParent.delete(parent.id)
      coachmarkPopupsByWebContents.delete(view.popupWebContentsId)
    },
    onDestroyed: () => {
      const cur = coachmarkPopupsByParent.get(parent.id)
      if (cur && cur.view === view) coachmarkPopupsByParent.delete(parent.id)
      coachmarkPopupsByWebContents.delete(view.popupWebContentsId)
    }
  })
  const entry: CoachmarkPopupEntry = {
    view,
    pendingConfig: null,
    pendingAnchor: null,
    pendingConfigToken: null,
    kind: 'pill-hint',
    settleTimer: null
  }
  coachmarkPopupsByParent.set(view.parentWindowId, entry)
  coachmarkPopupsByWebContents.set(view.popupWebContentsId, entry)

  const scheduleSettled = (): void => {
    const cur = coachmarkPopupsByParent.get(parent.id)
    if (!cur) return
    if (cur.settleTimer) clearTimeout(cur.settleTimer)
    cur.settleTimer = setTimeout(() => {
      cur.settleTimer = null
      if (parent.isDestroyed()) return
      const tb = findTitleBarByParent?.(parent)
      if (tb && !tb.isDestroyed()) {
        tb.send('comfy-titlebar:coachmark-settled', { kind: cur.kind })
      }
    }, COACHMARK_MOVE_SETTLE_MS)
  }
  for (const event of ['move', 'resize'] as const) {
    ;(parent as unknown as { on: (e: string, cb: () => void) => void }).on(event, scheduleSettled)
  }

  return entry
}

function repositionAndShow(
  entry: CoachmarkPopupEntry,
  bubble: { width: number; height: number }
): void {
  if (!entry.pendingAnchor || entry.view.isDestroyed()) return
  const parentBounds = entry.view.parentWindow.getContentBounds()
  const { beakFraction, cardCentreInView, ...bounds } = positionCoachmark({
    anchor: entry.pendingAnchor,
    bubble,
    parentBounds
  })
  entry.view.popup.setBounds(bounds)
  const beakPayload: CoachmarkBeakPayload = { beakFraction, cardCentreInView }
  entry.view.popup.webContents.send('comfy-titletooltip:set-beak', beakPayload)
  entry.view.showOnTop({ focus: true })
}

export function hideCoachmarkPopup(entry: CoachmarkPopupEntry | undefined): void {
  if (!entry) return
  entry.view.hide()
}

export function openCoachmarkPopup(opts: {
  parent: BrowserWindow
  kind?: CoachmarkKind
  title: string
  body: string
  dismissLabel: string
  actionLabel?: string
  leftX: number
  rightX: number
  bottomY: number
}): void {
  const entry = ensureCoachmarkPopup(opts.parent)
  if (entry.view.isDestroyed()) return

  entry.pendingAnchor = { leftX: opts.leftX, rightX: opts.rightX, bottomY: opts.bottomY }
  const token = nextCoachmarkToken()
  const kind = opts.kind ?? 'pill-hint'
  const config = buildCoachmarkConfig({
    kind,
    title: opts.title,
    body: opts.body,
    dismissLabel: opts.dismissLabel,
    actionLabel: opts.actionLabel,
    token
  })
  if (entry.pendingConfigToken !== null && entry.kind !== kind) {
    const previous = entry.kind
    const parent = entry.view.parentWindow
    if (parent && !parent.isDestroyed()) {
      const tb = findTitleBarByParent?.(parent)
      if (tb && !tb.isDestroyed()) {
        tb.send('comfy-titlebar:coachmark-displaced', { kind: previous })
      }
    }
  }
  entry.kind = kind
  entry.pendingConfigToken = token
  if (entry.view.rendererReady) {
    entry.view.popup.webContents.send('comfy-titletooltip:set-config', config)
  } else {
    entry.pendingConfig = config
  }
  entry.view.scheduleShowFallback(COACHMARK_RENDER_ACK_TIMEOUT_MS, () => {
    const bounds = entry.view.popup.getBounds()
    repositionAndShow(entry, {
      width: Math.max(0, bounds.width - COACHMARK_SHADOW_GUTTER * 2),
      height: Math.max(0, bounds.height - COACHMARK_SHADOW_GUTTER)
    })
  })
}

export function registerTitleCoachmarkIpc(opts: {
  findParentByTitleBarSender: (wc: WebContents) => BrowserWindow | null
  findTitleBarByParent: (parent: BrowserWindow) => WebContents | null
}): void {
  findTitleBarByParent = opts.findTitleBarByParent
  ipcMain.on('comfy-titletooltip:ready', (event) => {
    const entry = coachmarkPopupsByWebContents.get(event.sender.id)
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
      const entry = coachmarkPopupsByWebContents.get(event.sender.id)
      if (!entry) return
      const ackToken = typeof payload?.configToken === 'string' ? payload.configToken : ''
      if (!ackToken || ackToken !== entry.pendingConfigToken) return
      const width = typeof payload?.width === 'number' && payload.width > 0 ? payload.width : 0
      const height = typeof payload?.height === 'number' && payload.height > 0 ? payload.height : 0
      if (entry.pendingAnchor) repositionAndShow(entry, { width, height })
    }
  )

  ipcMain.on(
    'comfy-window:show-titlebar-coachmark',
    (
      event,
      payload: {
        kind?: unknown
        title?: unknown
        body?: unknown
        dismissLabel?: unknown
        actionLabel?: unknown
        leftX?: unknown
        rightX?: unknown
        bottomY?: unknown
      }
    ) => {
      const parent = opts.findParentByTitleBarSender(event.sender)
      if (!parent || parent.isDestroyed()) return
      const title = typeof payload?.title === 'string' ? payload.title : ''
      const body = typeof payload?.body === 'string' ? payload.body : ''
      if (!title && !body) return
      const dismissLabel = typeof payload?.dismissLabel === 'string' ? payload.dismissLabel : ''
      const actionLabel = typeof payload?.actionLabel === 'string' ? payload.actionLabel : undefined
      const kind: CoachmarkKind = payload?.kind === 'beta-notice' ? 'beta-notice' : 'pill-hint'
      const finite = (v: unknown, fallback: number): number =>
        typeof v === 'number' && Number.isFinite(v) ? v : fallback
      const leftX = finite(payload?.leftX, 0)
      const rightX = finite(payload?.rightX, leftX)
      const bottomY = finite(payload?.bottomY, TITLEBAR_HEIGHT)
      openCoachmarkPopup({
        parent,
        kind,
        title,
        body,
        dismissLabel,
        actionLabel,
        leftX: Math.round(leftX),
        rightX: Math.round(rightX),
        bottomY: Math.round(bottomY)
      })
    }
  )

  ipcMain.on('comfy-window:hide-titlebar-coachmark', (event) => {
    const parent = opts.findParentByTitleBarSender(event.sender)
    if (!parent) return
    hideCoachmarkPopup(coachmarkPopupsByParent.get(parent.id))
  })

  const retire = (senderId: number, channel: string, token: string | null): void => {
    const entry = coachmarkPopupsByWebContents.get(senderId)
    if (!entry) return
    if (token !== null && entry.pendingConfigToken !== null && token !== entry.pendingConfigToken) {
      return
    }
    retireDrivingHide = true
    try {
      entry.view.hide()
    } finally {
      retireDrivingHide = false
    }
    const parent = entry.view.parentWindow
    if (parent && !parent.isDestroyed()) {
      const tb = opts.findTitleBarByParent(parent)
      if (tb && !tb.isDestroyed()) tb.send(channel, { kind: entry.kind })
    }
  }

  const tokenOf = (payload?: { configToken?: unknown }): string | null =>
    typeof payload?.configToken === 'string' ? payload.configToken : null

  ipcMain.on('comfy-titlecoachmark:dismiss', (event, payload?: { configToken?: unknown }) => {
    retire(event.sender.id, 'comfy-titlebar:coachmark-dismissed', tokenOf(payload))
  })

  ipcMain.on('comfy-titlecoachmark:action', (event, payload?: { configToken?: unknown }) => {
    retire(event.sender.id, 'comfy-titlebar:coachmark-action', tokenOf(payload))
  })
}
