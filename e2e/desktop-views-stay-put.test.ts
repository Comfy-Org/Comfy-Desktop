import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { isPopupVisible, waitForWebContents } from './support/cdpPages'
import { evalWithRetry } from './support/evalRetry'
import { liveWindowCount } from './support/navMatrixHelpers'

const TITLE_POPUP = 'comfyTitlePopup.html'
const PAGES_OPEN_AT_LAUNCH = [
  'panel.html',
  'comfyTitleBar.html',
  TITLE_POPUP,
  'comfySystemModal.html'
]
const DESKTOP_PAGES = [...PAGES_OPEN_AT_LAUNCH, 'comfyTitleTooltip.html']
const DISMISS_GUARD_MS = 400

interface DesktopPage {
  id: number
  url: string
}

interface OverlayReport {
  id: number
  require: string
  process: string
  pressed: string
}

let elsewhere: Server | null = null
let elsewhereUrl = ''
const requestsElsewhere: string[] = []
let ctx: AppContext | null = null

function running(): AppContext {
  if (!ctx) throw new Error('app is not running')
  return ctx
}

function desktopPages(): Promise<DesktopPage[]> {
  return evalWithRetry(() =>
    running().app.evaluate(
      ({ webContents }, names) =>
        webContents
          .getAllWebContents()
          .filter((contents) => !contents.isDestroyed())
          .map((contents) => ({ id: contents.id, url: contents.getURL() }))
          .filter(({ url }) => names.some((name) => url.includes(name))),
      DESKTOP_PAGES
    )
  )
}

function tryToLeave(page: DesktopPage): Promise<void> {
  return evalWithRetry(() =>
    running().app.evaluate(
      ({ webContents }, { id, moveTo, openAt }) => {
        const script = `location.href = ${JSON.stringify(moveTo)}; window.open(${JSON.stringify(openAt)})`
        void webContents
          .fromId(id)
          ?.executeJavaScript(script)
          .catch(() => {})
      },
      {
        id: page.id,
        moveTo: `${elsewhereUrl}/moved-${page.id}`,
        openAt: `${elsewhereUrl}/opened-${page.id}`
      }
    )
  )
}

function dimmingOverlay(): Promise<OverlayReport | null> {
  return evalWithRetry(() =>
    running().app.evaluate(async ({ BrowserWindow, WebContentsView }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        for (const child of window.contentView.children) {
          if (!(child instanceof WebContentsView) || !child.getVisible()) continue
          const contents = child.webContents
          if (!decodeURIComponent(contents.getURL()).includes('class="scrim"')) continue
          const [require, process, pressed] = (await contents.executeJavaScript(
            '[typeof require, typeof process, typeof window.comfyOverlay?.pressed]'
          )) as string[]
          return { id: contents.id, require: require!, process: process!, pressed: pressed! }
        }
      }
      return null
    })
  )
}

function press(overlayId: number): Promise<void> {
  return evalWithRetry(() =>
    running().app.evaluate(({ webContents }, id) => {
      const contents = webContents.fromId(id)
      if (!contents) throw new Error('the overlay is gone')
      const point = { x: 12, y: 12, button: 'left' as const, clickCount: 1 }
      contents.sendInputEvent({ type: 'mouseDown', ...point })
      contents.sendInputEvent({ type: 'mouseUp', ...point })
    }, overlayId)
  )
}

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeAll(async () => {
  const server = createServer((req, res) => {
    requestsElsewhere.push(req.url ?? '')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><title>Another site (e2e)</title><p>Another site</p>')
  })
  elsewhere = server
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  elsewhereUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
  for (const name of PAGES_OPEN_AT_LAUNCH) await waitForWebContents(ctx.app, name)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  ctx = null
  const server = elsewhere
  elsewhere = null
  if (!server) return
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

test("Desktop's own screens cannot be sent to another site or open a window on one @macos @windows @linux", async () => {
  const before = await desktopPages()
  const windowsBefore = await liveWindowCount(running().app)
  expect(
    PAGES_OPEN_AT_LAUNCH.filter((name) => !before.some((page) => page.url.includes(name))),
    'the panel, title bar, menu and dialog are all open'
  ).toEqual([])

  for (const page of before) await tryToLeave(page)
  await new Promise((resolve) => setTimeout(resolve, 1_500))

  expect(await desktopPages(), 'every screen still shows its own page').toEqual(before)
  expect(requestsElsewhere, 'no screen asked the other site for anything').toEqual([])
  expect(await liveWindowCount(running().app), 'no window opened').toBe(windowsBefore)
})

test('The dimmed area behind a menu runs without Node, and pressing it still closes the menu @macos @windows @linux', async () => {
  await running().panel.evaluate<boolean>(
    `(() => { window.api.openInstancePicker({}); return true })()`
  )
  await expect
    .poll(() => isPopupVisible(running().app, TITLE_POPUP), { timeout: 15_000 })
    .toBe(true)
  await expect.poll(dimmingOverlay, { timeout: 15_000 }).not.toBeNull()

  const overlay = (await dimmingOverlay())!
  expect(overlay).toMatchObject({ require: 'undefined', process: 'undefined', pressed: 'function' })

  await new Promise((resolve) => setTimeout(resolve, DISMISS_GUARD_MS))
  await press(overlay.id)

  await expect
    .poll(() => isPopupVisible(running().app, TITLE_POPUP), { timeout: 10_000 })
    .toBe(false)
})
