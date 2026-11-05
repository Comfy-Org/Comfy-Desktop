import { test, expect, type ElectronApplication } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { openTitleMenu } from './support/chooserHelpers'
import {
  closeTitlePopupIfOpen,
  isPopupVisible,
  titlePopupPage,
  TITLE_REOPEN_SUPPRESSION_MS,
  waitForWebContents,
  type WebContentsPage
} from './support/cdpPages'
import { evalWithRetry } from './support/evalRetry'

let ctx: AppContext
let popup: WebContentsPage

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
  popup = titlePopupPage(ctx.app)
})

test.afterAll(async () => {
  await ctx.cleanup()
})

test.beforeEach(async () => {
  await closeTitlePopupIfOpen(ctx.app)
  await new Promise((r) => setTimeout(r, TITLE_REOPEN_SUPPRESSION_MS))
})

test('Reset Zoom menu item is absent on the dashboard even when the dummy comfyView zoom is non-zero @windows @macos @linux', async () => {
  await expectNoResetZoomAtLevel(ctx.app, 1)
})

test('title-popup webContents listener counts are stable across repeated opens @windows @macos @linux', async () => {
  await openTitleMenu(ctx.titleBar)
  await popup.waitForSelector('[role="menuitem"]', { timeout: 5_000 })
  await closeTitlePopupViaBridge(ctx.app)
  await waitForPopupHidden(ctx.app)
  await new Promise((r) => setTimeout(r, TITLE_REOPEN_SUPPRESSION_MS))

  const before = await getPopupListenerCount(ctx.app)
  expect(before).toBeGreaterThan(0)

  for (let i = 0; i < 5; i++) {
    await openTitleMenu(ctx.titleBar)
    await popup.waitForSelector('[role="menuitem"]', { timeout: 5_000 })
    await closeTitlePopupViaBridge(ctx.app)
    await waitForPopupHidden(ctx.app)
    await new Promise((r) => setTimeout(r, TITLE_REOPEN_SUPPRESSION_MS))
  }

  const after = await getPopupListenerCount(ctx.app)
  expect(after, `listener count grew from ${before} to ${after} across 5 open/close cycles`).toBe(
    before
  )
})

test('opening the title menu hides the title-bar tooltip @windows @macos @linux', async () => {
  await evalWithRetry(() =>
    ctx.app.evaluate(({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().includes('comfyTitleBar.html'))
      if (!wc) throw new Error('title-bar webContents missing')
      return wc.executeJavaScript(
        `(window).__comfyTitleBar.showTooltip({ text: 'g4 tooltip', leftX: 50, rightX: 200, bottomY: 30 })`
      )
    })
  )
  await waitForWebContents(ctx.app, 'comfyTitleTooltip.html', 5_000)
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitleTooltip.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(true)

  await openTitleMenu(ctx.titleBar)

  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitleTooltip.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(false)
})

async function setComfyViewZoomLevel(app: ElectronApplication, level: number): Promise<void> {
  await evalWithRetry(() =>
    app.evaluate(async ({ BrowserWindow, WebContentsView }, lvl) => {
      const KNOWN_HTML_MARKERS = [
        'panel.html',
        'comfyTitleBar.html',
        'comfyTitlePopup.html',
        'comfySystemModal.html',
        'comfyTitleTooltip.html'
      ]
      for (const win of BrowserWindow.getAllWindows()) {
        for (const child of win.contentView.children) {
          if (!(child instanceof WebContentsView)) continue
          const url = child.webContents.getURL()
          if (KNOWN_HTML_MARKERS.some((m) => url.includes(m))) continue
          if (url === '') {
            await child.webContents.loadURL('about:blank').catch(() => {})
          }
          child.webContents.setZoomLevel(lvl)
        }
      }
    }, level)
  )
}

async function expectNoResetZoomAtLevel(app: ElectronApplication, level: number): Promise<void> {
  await setComfyViewZoomLevel(app, level)
  try {
    await openTitleMenu(ctx.titleBar)
    await popup.waitForSelector('[role="menuitem"]', { timeout: 5_000 })

    const labels = await popup.allText('[role="menuitem"]')
    expect(labels.some((l) => /reset zoom/i.test(l))).toBe(false)
  } finally {
    await setComfyViewZoomLevel(app, 0)
  }
}

async function waitForPopupHidden(app: ElectronApplication): Promise<void> {
  await expect
    .poll(() => isPopupVisible(app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(false)
}

async function closeTitlePopupViaBridge(app: ElectronApplication): Promise<void> {
  await evalWithRetry(() =>
    app.evaluate(({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().includes('comfyTitlePopup.html'))
      if (!wc) return
      return wc.executeJavaScript(`(window).__comfyTitlePopup.close()`)
    })
  )
}

async function getPopupListenerCount(app: ElectronApplication): Promise<number> {
  return evalWithRetry(() =>
    app.evaluate(({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().includes('comfyTitlePopup.html'))
      if (!wc) return 0
      type EmitterLike = {
        eventNames(): (string | symbol)[]
        listenerCount(name: string | symbol): number
      }
      const emitter = wc as unknown as EmitterLike
      let total = 0
      for (const name of emitter.eventNames()) {
        total += emitter.listenerCount(name)
      }
      return total
    })
  )
}
