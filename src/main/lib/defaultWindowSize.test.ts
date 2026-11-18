import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cursor: { x: 0, y: 0 },
  displays: [] as { x: number; y: number; width: number; height: number }[]
}))

vi.mock('electron', () => ({
  screen: {
    getCursorScreenPoint: () => mocks.cursor,
    getDisplayNearestPoint: (point: { x: number; y: number }) => {
      const workArea =
        mocks.displays.find(
          (d) =>
            point.x >= d.x && point.x < d.x + d.width && point.y >= d.y && point.y < d.y + d.height
        ) ?? mocks.displays[0]
      return { workArea }
    },
    getDisplayMatching: (rect: { x: number; y: number }) => ({
      workArea:
        mocks.displays.find((d) => rect.x >= d.x && rect.x < d.x + d.width) ?? mocks.displays[0]
    })
  }
}))

import {
  defaultWindowBounds,
  defaultWindowBoundsNear,
  defaultWindowBoundsUnderCursor,
  fitWindowToDisplay,
  fitWindowToWorkArea
} from './defaultWindowSize'

describe('defaultWindowBounds', () => {
  it('opens at 85% of a 1920x1080 monitor, centered a little above the middle', () => {
    expect(defaultWindowBounds({ x: 0, y: 0, width: 1920, height: 1032 })).toEqual({
      x: 144,
      y: 70,
      width: 1632,
      height: 877,
      maximize: false
    })
  })

  it('opens at 85% of a 2560x1440 monitor', () => {
    expect(defaultWindowBounds({ x: 0, y: 0, width: 2560, height: 1392 })).toEqual({
      x: 192,
      y: 94,
      width: 2176,
      height: 1183,
      maximize: false
    })
  })

  it('stops growing at 2400x1500 on a very large work area', () => {
    const bounds = defaultWindowBounds({ x: 0, y: 0, width: 5120, height: 2840 })
    expect(bounds).toMatchObject({ width: 2400, height: 1500, maximize: false })
    expect(bounds.x).toBe(1360)
  })

  it('maximizes on a 14-inch MacBook Pro and keeps an 85% size to unmaximize to', () => {
    expect(defaultWindowBounds({ x: 0, y: 33, width: 1512, height: 889 })).toEqual({
      x: 114,
      y: 93,
      width: 1285,
      height: 756,
      maximize: true
    })
  })

  it('maximizes on a 1366x768 laptop', () => {
    expect(defaultWindowBounds({ x: 0, y: 0, width: 1366, height: 728 })).toMatchObject({
      maximize: true
    })
  })

  it('never opens wider or taller than the work area', () => {
    const bounds = defaultWindowBounds({ x: 0, y: 0, width: 1093, height: 566 })
    expect(bounds).toEqual({ x: 35, y: 0, width: 1024, height: 566, maximize: true })
  })

  it('places the window on the given work area, not the origin', () => {
    expect(defaultWindowBounds({ x: 1920, y: 0, width: 1920, height: 1032 })).toMatchObject({
      x: 2064,
      y: 70
    })
  })
})

describe('defaultWindowBoundsUnderCursor', () => {
  it('sizes the window to the display the cursor is on', () => {
    mocks.displays = [
      { x: 0, y: 25, width: 1512, height: 889 },
      { x: 1512, y: 0, width: 2560, height: 1392 }
    ]
    mocks.cursor = { x: 2000, y: 500 }
    expect(defaultWindowBoundsUnderCursor()).toEqual({
      x: 1704,
      y: 94,
      width: 2176,
      height: 1183,
      maximize: false,
      workArea: { x: 1512, y: 0, width: 2560, height: 1392 }
    })
  })
})

describe('defaultWindowBoundsNear', () => {
  it('sizes the window to the display that holds the point', () => {
    mocks.displays = [
      { x: 0, y: 25, width: 1512, height: 889 },
      { x: 1512, y: 0, width: 2560, height: 1392 }
    ]
    expect(defaultWindowBoundsNear({ x: 100, y: 100 })).toMatchObject({
      width: 1285,
      height: 756,
      maximize: true,
      workArea: { x: 0, y: 25, width: 1512, height: 889 }
    })
  })
})

describe('fitWindowToWorkArea', () => {
  const monitor = { x: 0, y: 0, width: 1920, height: 1032 }

  it('leaves a window that already fits where it is', () => {
    expect(fitWindowToWorkArea({ x: 144, y: 70, width: 1632, height: 877 }, monitor)).toEqual({
      x: 144,
      y: 70,
      width: 1632,
      height: 877,
      minWidth: 800,
      minHeight: 600
    })
  })

  it('moves a window opened next to another back inside the screen', () => {
    expect(fitWindowToWorkArea({ x: 330, y: 250, width: 1632, height: 877 }, monitor)).toEqual({
      x: 288,
      y: 155,
      width: 1632,
      height: 877,
      minWidth: 800,
      minHeight: 600
    })
  })

  it('shrinks a window larger than the screen and keeps it on the screen', () => {
    expect(
      fitWindowToWorkArea({ x: -200, y: 0, width: 2176, height: 1183 }, monitor)
    ).toMatchObject({ x: 0, y: 0, width: 1920, height: 1032 })
  })

  it('lowers the smallest window size on a screen shorter than 600', () => {
    const laptopAt125 = { x: 0, y: 0, width: 1093, height: 566 }
    const bounds = { x: 0, y: 0, width: 1024, height: 566 }
    expect(fitWindowToWorkArea(bounds, laptopAt125)).toMatchObject({
      minWidth: 800,
      minHeight: 566
    })
  })
})

describe('fitWindowToDisplay', () => {
  it('fits the window to the display it sits on', () => {
    mocks.displays = [
      { x: 0, y: 25, width: 1512, height: 889 },
      { x: 1512, y: 0, width: 2560, height: 1392 }
    ]
    expect(fitWindowToDisplay({ x: 3000, y: 300, width: 2176, height: 1183 })).toMatchObject({
      x: 1896,
      y: 209,
      width: 2176,
      height: 1183
    })
  })
})
