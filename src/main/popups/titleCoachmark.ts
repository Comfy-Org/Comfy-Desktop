import type { CoachmarkBeakPayload } from '../../types/ipc'
import { ipcMain } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { TITLEBAR_HEIGHT } from '../lib/titleBarOverlay'
import { EmbeddedPopupView } from './embeddedPopupView'

/**
 * Sticky title-bar coachmark popup: a card with an upward beak pointing at a title-bar
 * element. Reuses the `comfyTitleTooltip` renderer (the `variant: 'coachmark'` config
 * switches it to the beak/accent/dismiss card) but owns a separate popup view so its sticky
 * lifecycle (no auto-hide on blur, since the dismiss button needs focus) doesn't fight the
 * tooltip's auto-dismiss.
 *
 * Two callers share it: the first-instance onboarding hint pointing at the centre pill, and
 * the Core beta activation notice pointing at the news bell. ONE popup per window on purpose
 * — two sticky cards over the same canvas at once is worse than the later one replacing the
 * earlier, and the renderer sequences them so that can only happen by accident. `kind` rides
 * along on the config and is echoed back on dismiss/action so the title bar can route the
 * result to the right owner.
 */

const COACHMARK_POPUP_INITIAL_WIDTH = 300
const COACHMARK_POPUP_INITIAL_HEIGHT = 96
/** Gap (px) between the pill bottom and card top, leaving room for the beak. */
export const COACHMARK_VERTICAL_GAP = 10
/** Gutter (px) reserved for the card's box-shadow + beak so neither gets clipped. */
export const COACHMARK_SHADOW_GUTTER = 18
/** Keep the beak this far from the card's corners, so it always overlaps a straight edge
 *  rather than floating off a rounded one. */
export const COACHMARK_BEAK_EDGE_MARGIN = 14
/** Fallback show timeout (ms) if the renderer's `:rendered` ack is slow. */
const COACHMARK_RENDER_ACK_TIMEOUT_MS = 120

export interface CoachmarkTheme {
  bg: string
  text: string
  border: string
  accent: string
}

/** Which feature owns the card. Echoed back on dismiss/action so one popup can serve
 *  several owners without either acting on the other's click. */
export type CoachmarkKind = 'pill-hint' | 'beta-notice'

export interface CoachmarkConfig {
  variant: 'coachmark'
  kind: CoachmarkKind
  title: string
  body: string
  dismissLabel: string
  /** Optional secondary action rendered beside dismiss. Omitted (not empty) when the card has
   *  no action, so the renderer can tell "no action" from "action with a missing label". */
  actionLabel?: string
  /** Horizontal position of the beak as a fraction of the card's width. Sent on the SHOW push
   *  (after measuring), never on the initial config, because it depends on the measured size. */
  beakFraction?: number
  theme: CoachmarkTheme
  configToken: string
}

/** Hardcoded mirror of the brand tokens; the popup renderer has no app stylesheet. */
function resolveCoachmarkTheme(): CoachmarkTheme {
  return { bg: '#211927', text: '#ffffff', border: '#38303d', accent: '#e3ff3c' }
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

/** Where the beak should sit, as a fraction of the CARD's width (0..1). `0.5` is the centre.
 *  Returned alongside the bounds because clamping moves the card without moving the anchor:
 *  a beak hard-fixed at 50% then points at whatever the clamp shifted it onto. */
export interface CoachmarkPlacement {
  x: number
  y: number
  width: number
  height: number
  beakFraction: number
  /** Where the card's midpoint belongs within the view, in CSS px. Sent so placement comes
   *  from the geometry main already computed rather than from the page's own idea of its
   *  width — and as a centre rather than an edge, so it holds whatever width the card
   *  actually renders at. */
  cardCentreInView: number
}

/** Compute popup bounds centering the card under the anchor, clamped to the parent, plus where
 *  the beak must sit within the card to keep pointing at the anchor after any clamp. */
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
  // The card is centred inside the view, so its left edge sits one gutter in. Express the
  // anchor's centre as a fraction of the card, then clamp to the card's rounded corners so the
  // beak can never detach from the card's own edge.
  const cardWidth = Math.max(1, viewWidth - COACHMARK_SHADOW_GUTTER * 2)
  const cardLeft = x + COACHMARK_SHADOW_GUTTER
  const rawFraction = (pillCenter - cardLeft) / cardWidth
  // Capped at the midpoint: for a card narrower than two margins the bounds would otherwise
  // cross over, and `Math.min(1 - margin, …)` would return something below `margin` — pinning
  // the beak to the very corner the margin exists to keep it off.
  const beakMargin = Math.min(0.5, COACHMARK_BEAK_EDGE_MARGIN / cardWidth)
  const beakFraction = Math.min(1 - beakMargin, Math.max(beakMargin, rawFraction))
  // The card's CENTRE inside the view, which is the view's own midpoint.
  //
  // Sent because the renderer cannot derive it safely. Centring with auto margins measures the
  // page's own width, and that width is sometimes still the pre-resize value — the page had
  // not processed the new bounds yet. Measured at 8px off, on a page still reporting 300
  // inside a 316-wide view.
  //
  // The CENTRE rather than the left edge, deliberately: a left offset is only correct while
  // the card renders exactly as wide as `bubble.width` said it would, so it would trade a
  // stale-viewport failure for a stale-width one — including on the fallback show, where the
  // view is sized before any measurement exists. Pinning the centre is right for any rendered
  // width, because the renderer offsets by half of whatever the card actually is.
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
  /** Owner of the card currently configured on this popup, so a dismiss or action click
   *  reaches the composable that raised it and not the other one. */
  kind: CoachmarkKind
  /** Debounce for "the host window has stopped moving". Lives here rather than in the
   *  renderer because only main sees every `move`: the popup hides on the FIRST one and
   *  `onHide` fires only on that open-to-hidden transition, so a renderer-side timer could
   *  never be extended by the rest of a drag. */
  settleTimer: ReturnType<typeof setTimeout> | null
}

/** The title-bar lookup, captured from `registerTitleCoachmarkIpc` so a popup built later
 *  can reach the title bar that owns it. Null until the IPC is registered. */
let findTitleBarByParent: ((parent: BrowserWindow) => WebContents | null) | null = null

/** True only while `retire` is driving the hide. Retirement reports itself on its own
 *  channel, so the auto-hide notice would be a duplicate — and a harmful one: it would tell
 *  the owner to FORGET a card it has just acknowledged. */
let retireDrivingHide = false

/** How long the host window must be still before a card is put back. Long enough that a
 *  drag made of many `move` events resolves to ONE re-show at the end. */
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
    // Sticky: hide only when the host window moves/resizes (stale anchor).
    // Not on blur — the dismiss button needs focus.
    hideOnParentEvents: ['will-move', 'move', 'resize'],
    /** The popup also hides for reasons the owning composable never sees — `will-move`,
     *  `move` and `resize` above, because the anchor it points at has gone stale. Without
     *  this the renderer still believes its card is up and turns away every later show for
     *  the rest of the session, so a notice the user never read ends up neither displayed
     *  nor acknowledged. Addressed with `kind` so it reaches the composable that raised it. */
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

  /** "The window has stopped moving." Separate from the auto-hide notice on purpose: the
   *  owner should FORGET its card immediately (that is a state correction), but only RE-SHOW
   *  once the drag is over. Debounced from every `move`/`resize`, which is why it has to live
   *  here — the popup is hidden after the first event, so no further `onHide` arrives to
   *  extend a renderer-side timer, and the card would reopen and steal focus mid-drag. */
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
  // Tell the card where to draw its beak now that the final, possibly clamped, x is known.
  const beakPayload: CoachmarkBeakPayload = { beakFraction, cardCentreInView }
  entry.view.popup.webContents.send('comfy-titletooltip:set-beak', beakPayload)
  // Focus so the dismiss button is keyboard-reachable.
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
  // One popup serves both cards, so configuring it for a NEW owner silently takes the screen
  // away from the old one. That is NOT a hide, so `onHide` — and therefore the auto-hidden
  // channel — never fires, and the displaced composable goes on believing its card is up and
  // refuses every later show. This is the displacement that left a beta notice armed but
  // invisible for the rest of a session once the onboarding hint landed on top of it.
  //
  // `pendingConfigToken` is null only before the FIRST configure, so this cannot fire on the
  // initial claim — only on a genuine hand-over between owners.
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

/** Wire the coachmark IPC. Shares the tooltip's `:ready` / `:rendered` channels,
 *  disambiguated by webContents id so only coachmark-popup acks land here. */
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
      // Renderer supplies the i18n labels; main only forwards them.
      const dismissLabel = typeof payload?.dismissLabel === 'string' ? payload.dismissLabel : ''
      const actionLabel = typeof payload?.actionLabel === 'string' ? payload.actionLabel : undefined
      // Unrecognised kinds fall back to the onboarding hint rather than being refused: an
      // unroutable retirement would leave a card the title bar can never retire.
      const kind: CoachmarkKind = payload?.kind === 'beta-notice' ? 'beta-notice' : 'pill-hint'
      // `Number.isFinite`, not `typeof`: NaN and Infinity survive `Math.round` and reach
      // `setBounds`, which throws in the main process.
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

  /** Hide the card and tell the parent's title bar what happened to it. Both outcomes —
   *  dismiss and the secondary action — are retirements: the title-bar renderer owns the
   *  once-ever persistence for whichever `kind` raised the card, so it is told either way and
   *  decides what else the click means. */
  const retire = (senderId: number, channel: string, token: string | null): void => {
    const entry = coachmarkPopupsByWebContents.get(senderId)
    if (!entry) return
    // The popup is reused, so a click can arrive from a card rendered for a PREVIOUS open —
    // a config push still queued, or a click already in flight when it was reconfigured.
    // `entry.kind` has moved on by then, and routing on it would attribute the click to the
    // new owner: an unseen beta notice acknowledged by a click on the onboarding hint.
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
