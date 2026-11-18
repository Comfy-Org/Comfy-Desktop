import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  return {
    app: {
      isPackaged: false,
      getPath: () => '/tmp',
      getVersion: () => '0.0.0-test',
      getLocale: () => 'en'
    },
    ipcMain: {
      handle: vi.fn(),
      off: vi.fn(),
      on: (channel: string, handler: (...args: unknown[]) => void) => {
        handlers.set(channel, handler)
      },
      _handlers: handlers
    },
    WebContentsView: class {},
    BrowserWindow: { getAllWindows: () => [] },
    nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
  }
})

vi.mock('./embeddedPopupView', () => {
  let seq = 0
  class FakeEmbeddedPopupView {
    static instances: FakeEmbeddedPopupView[] = []
    readonly popup: {
      webContents: {
        id: number
        send: (channel: string, payload: unknown) => void
        isDestroyed: () => boolean
      }
      setBounds: (...a: unknown[]) => void
      getBounds: () => { x: number; y: number; width: number; height: number }
    }
    readonly parentWindow: {
      id: number
      isDestroyed: () => boolean
      getContentBounds: () => { width: number; height: number }
    }
    readonly popupWebContentsId: number
    readonly parentWindowId: number
    rendererReady = false
    isOpen = false
    pendingShowTimer: unknown = null
    sends: Array<{ channel: string; payload: unknown }> = []
    showCount = 0
    private readonly onHide?: () => void
    constructor(opts: { parent: { id: number }; onHide?: () => void }) {
      this.popupWebContentsId = ++seq
      this.parentWindowId = opts.parent.id
      this.onHide = opts.onHide
      this.parentWindow = {
        id: opts.parent.id,
        isDestroyed: () => false,
        getContentBounds: () => ({ width: 1200, height: 800 })
      }
      this.popup = {
        webContents: {
          id: this.popupWebContentsId,
          send: (channel: string, payload: unknown) => {
            this.sends.push({ channel, payload })
          },
          isDestroyed: () => false
        },
        setBounds: () => {},
        getBounds: () => ({ x: 0, y: 0, width: 300, height: 96 })
      }
      FakeEmbeddedPopupView.instances.push(this)
    }
    isDestroyed(): boolean {
      return false
    }
    scheduleShowFallback(_ms: number, _cb: () => void): void {
      this.pendingShowTimer = Symbol('timer')
    }
    showOnTop(): void {
      this.pendingShowTimer = null
      this.isOpen = true
      this.showCount += 1
    }
    hide(): void {
      this.pendingShowTimer = null
      this.isOpen = false
      this.onHide?.()
    }
  }
  return { EmbeddedPopupView: FakeEmbeddedPopupView }
})

import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { EmbeddedPopupView } from './embeddedPopupView'
import {
  buildCoachmarkConfig,
  openCoachmarkPopup,
  positionCoachmark,
  registerTitleCoachmarkIpc,
  COACHMARK_BEAK_EDGE_MARGIN,
  COACHMARK_SHADOW_GUTTER,
  COACHMARK_VERTICAL_GAP
} from './titleCoachmark'

type FakeView = InstanceType<typeof EmbeddedPopupView> & {
  pendingShowTimer: unknown
  showCount: number
  sends: Array<{ channel: string; payload: unknown }>
}
const ipcHandlers = (ipcMain as unknown as { _handlers: Map<string, (...a: unknown[]) => void> })
  ._handlers
const viewInstances = (EmbeddedPopupView as unknown as { instances: FakeView[] }).instances

describe('buildCoachmarkConfig', () => {
  it('stamps the coachmark variant and carries title + body + dismiss copy', () => {
    const cfg = buildCoachmarkConfig({
      kind: 'beta-notice',
      title: 'A beta feature is on',
      body: 'This instance started with a beta feature enabled.',
      dismissLabel: 'Got it',
      token: 'cm-1'
    })
    expect(cfg.variant).toBe('coachmark')
    expect(cfg.kind).toBe('beta-notice')
    expect(cfg.title).toBe('A beta feature is on')
    expect(cfg.body).toBe('This instance started with a beta feature enabled.')
    expect(cfg.dismissLabel).toBe('Got it')
    expect(cfg.configToken).toBe('cm-1')
    expect(cfg.theme.accent).toMatch(/^#/)
  })

  it('omits actionLabel entirely for a card with no secondary action', () => {
    const cfg = buildCoachmarkConfig({
      kind: 'beta-notice',
      title: 'A beta feature is on',
      body: 'This instance started with a beta feature enabled.',
      dismissLabel: 'Got it',
      token: 'cm-1'
    })
    expect('actionLabel' in cfg).toBe(false)
  })

  it('carries the action label and kind for the beta activation notice', () => {
    const cfg = buildCoachmarkConfig({
      kind: 'beta-notice',
      title: 'A beta feature is on',
      body: 'This instance started with a beta feature enabled.',
      dismissLabel: 'Got it',
      actionLabel: 'Settings',
      token: 'cm-2'
    })
    expect(cfg.kind).toBe('beta-notice')
    expect(cfg.actionLabel).toBe('Settings')
  })
})

describe('positionCoachmark beak tracking', () => {
  const bubble = { width: 280, height: 90 }
  const cardWidth = bubble.width

  function beakX(placement: ReturnType<typeof positionCoachmark>): number {
    return placement.x + COACHMARK_SHADOW_GUTTER + placement.beakFraction * cardWidth
  }

  it.each([
    [200, { leftX: 500, rightX: 540 }],
    [280, { leftX: 500, rightX: 540 }],
    [280, { leftX: 1130, rightX: 1150 }]
  ])(
    'reports a card centre that lands on the anchor (card %s, clamped or not)',
    (width, anchor) => {
      const placement = positionCoachmark({
        anchor: { ...anchor, bottomY: 36 },
        bubble: { width, height: 90 },
        parentBounds: { width: 1200, height: 800 }
      })
      const anchorCentre = (anchor.leftX + anchor.rightX) / 2
      const cardCentreInWindow = placement.x + placement.cardCentreInView
      const clamped = placement.x <= 0 || placement.x + placement.width >= 1200
      if (clamped) {
        expect(placement.cardCentreInView).toBeCloseTo(placement.width / 2, 5)
      } else {
        expect(cardCentreInWindow).toBeCloseTo(anchorCentre, 5)
      }
    }
  )

  it('centres the beak when the card is not clamped', () => {
    const placement = positionCoachmark({
      anchor: { leftX: 500, rightX: 540, bottomY: 36 },
      bubble,
      parentBounds: { width: 1200, height: 800 }
    })
    expect(placement.beakFraction).toBeCloseTo(0.5, 5)
    expect(beakX(placement)).toBeCloseTo(520, 5)
  })

  it('keeps the beak on the anchor when the card clamps at the right edge', () => {
    const anchorCentre = 1140
    const placement = positionCoachmark({
      anchor: { leftX: 1130, rightX: 1150, bottomY: 36 },
      bubble,
      parentBounds: { width: 1200, height: 800 }
    })
    expect(placement.x + placement.width).toBeLessThanOrEqual(1200)
    expect(placement.beakFraction).toBeGreaterThan(0.5)
    expect(beakX(placement)).toBeCloseTo(anchorCentre, 5)
  })

  it('keeps the beak on the anchor when the card clamps at the left edge', () => {
    const anchorCentre = 45
    const placement = positionCoachmark({
      anchor: { leftX: 35, rightX: 55, bottomY: 36 },
      bubble,
      parentBounds: { width: 1200, height: 800 }
    })
    expect(placement.x).toBe(0)
    expect(placement.beakFraction).toBeLessThan(0.5)
    expect(beakX(placement)).toBeCloseTo(anchorCentre, 5)
  })

  it.each([
    ['right', { leftX: 1198, rightX: 1200, bottomY: 36 }],
    ['left', { leftX: 0, rightX: 2, bottomY: 36 }]
  ])('never lets the beak reach the card corners (%s)', (_side, anchor) => {
    const placement = positionCoachmark({
      anchor,
      bubble,
      parentBounds: { width: 1200, height: 800 }
    })
    const margin = COACHMARK_BEAK_EDGE_MARGIN / cardWidth
    expect(placement.beakFraction).toBeLessThanOrEqual(1 - margin + 1e-9)
    expect(placement.beakFraction).toBeGreaterThanOrEqual(margin - 1e-9)
  })
})

describe('positionCoachmark', () => {
  const parentBounds = { width: 1200, height: 800 }

  it('centers the card under the pill and offsets below it', () => {
    const bounds = positionCoachmark({
      anchor: { leftX: 500, rightX: 700, bottomY: 36 },
      bubble: { width: 260, height: 72 },
      parentBounds
    })
    const pillCenter = 600
    const viewWidth = 260 + COACHMARK_SHADOW_GUTTER * 2
    expect(bounds.width).toBe(viewWidth)
    expect(bounds.x).toBe(Math.round(pillCenter - viewWidth / 2))
    expect(bounds.y).toBe(Math.round(36 + COACHMARK_VERTICAL_GAP - COACHMARK_SHADOW_GUTTER / 2))
  })

  it('clamps to the parent content bounds so it never goes off-screen left', () => {
    const bounds = positionCoachmark({
      anchor: { leftX: 0, rightX: 20, bottomY: 36 },
      bubble: { width: 260, height: 72 },
      parentBounds
    })
    expect(bounds.x).toBeGreaterThanOrEqual(0)
  })

  it('clamps to the parent content bounds so it never overflows right', () => {
    const bounds = positionCoachmark({
      anchor: { leftX: 1180, rightX: 1200, bottomY: 36 },
      bubble: { width: 260, height: 72 },
      parentBounds
    })
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(parentBounds.width)
  })
})

describe('coachmark render-ack guard (first-use lockdown re-race)', () => {
  interface FakeParent {
    id: number
    isDestroyed: () => boolean
    on: () => void
  }
  let currentParent: FakeParent | null = null

  beforeAll(() => {
    registerTitleCoachmarkIpc({
      findParentByTitleBarSender: () =>
        currentParent ? (currentParent as unknown as BrowserWindow) : null,
      findTitleBarByParent: () => null
    })
  })

  function makeParent(id: number): FakeParent {
    const parent: FakeParent = { id, isDestroyed: () => false, on: () => {} }
    currentParent = parent
    return parent
  }

  function openCard(parent: FakeParent): { view: FakeView; token: string } {
    openCoachmarkPopup({
      parent: parent as unknown as BrowserWindow,
      title: 'A beta feature is on',
      body: 'This instance started with a beta feature enabled.',
      dismissLabel: 'Got it',
      actionLabel: 'Settings',
      leftX: 500,
      rightX: 540,
      bottomY: 36
    })
    const view = viewInstances[viewInstances.length - 1]!
    ipcHandlers.get('comfy-titletooltip:ready')?.({ sender: { id: view.popupWebContentsId } })
    const setConfig = view.sends.find((s) => s.channel === 'comfy-titletooltip:set-config')
    const token = (setConfig?.payload as { configToken: string }).configToken
    return { view, token }
  }

  function fireRendered(view: FakeView, token: string): void {
    ipcHandlers.get('comfy-titletooltip:rendered')?.(
      { sender: { id: view.popupWebContentsId } },
      { width: 280, height: 90, configToken: token }
    )
  }

  function reassertLockdownHide(): void {
    ipcHandlers.get('comfy-window:hide-titlebar-coachmark')?.({ sender: { id: 1 } })
  }

  it('shows the card when the render ack lands while a show is still pending', () => {
    const { view, token } = openCard(makeParent(9101))
    expect(view.showCount).toBe(0)
    expect(view.pendingShowTimer).not.toBeNull()

    fireRendered(view, token)

    expect(view.showCount).toBe(1)
    expect(view.isOpen).toBe(true)
  })

  it('does not resurrect a hidden card when a late render ack arrives', () => {
    const { view, token } = openCard(makeParent(9102))

    reassertLockdownHide()
    expect(view.isOpen).toBe(false)
    expect(view.pendingShowTimer).toBeNull()

    fireRendered(view, token)

    expect(view.showCount).toBe(0)
    expect(view.isOpen).toBe(false)
  })
})
