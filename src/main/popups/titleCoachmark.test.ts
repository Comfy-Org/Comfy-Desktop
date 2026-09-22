import { describe, expect, it, vi } from 'vitest'

// Module loads electron at import even though the pure helpers under test never use it.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

// Stub embeddedPopupView so its electron usage doesn't load.
vi.mock('./embeddedPopupView', () => ({ EmbeddedPopupView: class {} }))

import {
  buildCoachmarkConfig,
  positionCoachmark,
  COACHMARK_BEAK_EDGE_MARGIN,
  COACHMARK_SHADOW_GUTTER,
  COACHMARK_VERTICAL_GAP
} from './titleCoachmark'

describe('buildCoachmarkConfig', () => {
  it('stamps the coachmark variant and carries title + body + dismiss copy', () => {
    const cfg = buildCoachmarkConfig({
      kind: 'pill-hint',
      title: 'Switch & manage instances',
      body: 'Click here to switch instances.',
      dismissLabel: 'Got it',
      token: 'cm-1'
    })
    expect(cfg.variant).toBe('coachmark')
    expect(cfg.kind).toBe('pill-hint')
    expect(cfg.title).toBe('Switch & manage instances')
    expect(cfg.body).toBe('Click here to switch instances.')
    expect(cfg.dismissLabel).toBe('Got it')
    expect(cfg.configToken).toBe('cm-1')
    expect(cfg.theme.accent).toMatch(/^#/)
  })

  // One popup backs both cards, and the renderer resets `actionLabel` on every config push.
  // An action-less card must therefore omit the key outright rather than send an empty
  // string, which the renderer would read the same way but which would also let a typo'd
  // label reach the card as a blank button.
  it('omits actionLabel entirely for a card with no secondary action', () => {
    const cfg = buildCoachmarkConfig({
      kind: 'pill-hint',
      title: 'Switch & manage instances',
      body: 'Click here to switch instances.',
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

  /** Where the beak actually lands in parent coordinates. */
  function beakX(placement: ReturnType<typeof positionCoachmark>): number {
    return placement.x + COACHMARK_SHADOW_GUTTER + placement.beakFraction * cardWidth
  }

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
    // The bell is the first right-edge anchor; on macOS the card does not fit beside it, so
    // the view clamps. A beak fixed at 50% would then point at whatever the clamp slid it onto.
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
    // 45 is inside the card once clamped, but far enough from its left corner that the
    // edge margin does not bite — so the beak can track the anchor exactly.
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
    // An anchor hard against the window edge sits outside the clamped card, so exact tracking
    // would put the beak off a rounded corner, detached from the edge it grows out of. The
    // margin wins over tracking in that case, on purpose.
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
