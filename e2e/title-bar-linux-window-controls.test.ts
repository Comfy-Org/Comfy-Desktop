import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'

const CLOSE_AND_MINIMIZE_LEFT_MAXIMIZE_RIGHT = 'close,minimize:maximize'
const MINIMUM_WINDOW_WIDTH = 800

interface Span {
  left: number
  right: number
}

interface TitleBarGeometry {
  windowWidth: number
  freeOfWindowControls: Span
  buttons: Span
}

const READ_TITLE_BAR_GEOMETRY = `(() => {
  const free = navigator.windowControlsOverlay.getTitlebarAreaRect()
  const rects = Array.from(document.querySelectorAll('header button, header [role="button"]'))
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
  return {
    windowWidth: window.innerWidth,
    freeOfWindowControls: { left: free.x, right: free.x + free.width },
    buttons: {
      left: Math.min(...rects.map((rect) => rect.left)),
      right: Math.max(...rects.map((rect) => rect.right))
    }
  }
})()`

let ctx: AppContext

async function putWindowControlsOnBothSides(homeDir: string): Promise<void> {
  for (const gtkVersion of ['gtk-3.0', 'gtk-4.0']) {
    const settingsDir = path.join(homeDir, '.config', gtkVersion)
    await mkdir(settingsDir, { recursive: true })
    await writeFile(
      path.join(settingsDir, 'settings.ini'),
      `[Settings]\ngtk-decoration-layout=${CLOSE_AND_MINIMIZE_LEFT_MAXIMIZE_RIGHT}\n`
    )
  }
}

function titleBarGeometry(): Promise<TitleBarGeometry> {
  return ctx.titleBar.evaluate<TitleBarGeometry>(READ_TITLE_BAR_GEOMETRY)
}

async function expectButtonsClearOfWindowControls(): Promise<void> {
  await expect(async () => {
    const { windowWidth, freeOfWindowControls, buttons } = await titleBarGeometry()
    expect(
      freeOfWindowControls.left,
      'the desktop drew no window controls on the left'
    ).toBeGreaterThan(0)
    expect(
      freeOfWindowControls.right,
      'the desktop drew no window controls on the right'
    ).toBeLessThan(windowWidth)
    expect(
      buttons.left,
      'the leftmost title bar button sits under the window controls on the left'
    ).toBeGreaterThanOrEqual(freeOfWindowControls.left)
    expect(
      buttons.right,
      'the rightmost title bar button sits under the window controls on the right'
    ).toBeLessThanOrEqual(freeOfWindowControls.right)
  }).toPass({ timeout: 15_000 })
}

test.beforeAll(async () => {
  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    onSetup: ({ homeDir }) => putWindowControlsOnBothSides(homeDir)
  })
})

test.afterAll(async () => {
  await ctx.cleanup()
})

test('title bar buttons stay clear of the window controls a Linux desktop puts on either side @linux', async () => {
  await test.step('at the size the window opens with', expectButtonsClearOfWindowControls)

  await test.step('at the narrowest the window can get', async () => {
    await ctx.app.evaluate(({ BrowserWindow }, width) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
      win?.setSize(width, win.getSize()[1] ?? 600)
    }, MINIMUM_WINDOW_WIDTH)
    await expect
      .poll(async () => (await titleBarGeometry()).windowWidth, { timeout: 15_000 })
      .toBe(MINIMUM_WINDOW_WIDTH)
    await expectButtonsClearOfWindowControls()
  })
})
