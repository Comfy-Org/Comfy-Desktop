import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { WebContentsPage } from './support/cdpPages'

const SIDEBAR_APPS = '[data-testid="app-sidebar-apps"]'
const APPS_GRID = '[data-testid="apps-grid"]'
const CUTOUT_CARD = '[data-testid="app-card-remove-background"]'
const NEVER_CARD = '[data-testid="app-card-never-opened"]'
const APP_FAILED = '[data-testid="app-page-failed"]'
const CUTOUT_PAGE = '/apps/remove-background/desktop.html'
const NEVER_PAGE = '/apps/never-opened/desktop.html'
const PAGE_SCRIPT = '/apps/lib/page.js'
const COVER = '/catalog-media/cover-1/v1'
const STILL = '/catalog-media/still-1/v1'
const LAST_MODIFIED = 'Wed, 25 Nov 2026 04:35:42 GMT'
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
const LONG_WAIT = { timeout: 20_000 }

const CUTOUT_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Remove Background page</title></head>
  <body style="margin: 0; padding: 24px; background: #101010; color: #eee; font: 14px sans-serif">
    <a id="back" href="/apps/">All apps</a>
    <h1 id="title">Remove Background page</h1>
    <p id="script">pending</p>
    <p id="list">pending</p>
    <script src="${PAGE_SCRIPT}"></script>
  </body>
</html>`

const PAGE_JS = `document.getElementById('script').textContent = 'script ran'
fetch('/apps/apps.json')
  .then((answer) => answer.json())
  .then((apps) => {
    document.getElementById('list').textContent = apps.length + ' apps'
  })
  .catch(() => {
    document.getElementById('list').textContent = 'no list'
  })`

class OfflineAppsSite {
  port = 0
  readonly asked: string[] = []
  private server: Server | null = null

  get url(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async start(port = 0): Promise<void> {
    const server = createServer((req, res) => this.route(req, res))
    this.server = server
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    this.port = (server.address() as AddressInfo).port
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = null
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }

  private file(res: ServerResponse, type: string, body: string | Buffer, etag: string): void {
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'public, max-age=0, must-revalidate',
      'last-modified': LAST_MODIFIED,
      etag
    })
    res.end(body)
  }

  private route(req: IncomingMessage, res: ServerResponse): void {
    const { pathname } = new URL(req.url ?? '/', this.url)
    this.asked.push(pathname)
    if (pathname === '/apps/apps.json') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, no-store'
      })
      res.end(
        JSON.stringify([
          {
            id: 'remove-background',
            page: CUTOUT_PAGE,
            title: 'Remove Background',
            blurb: 'Cut the subject out of a picture or video.',
            covers: [{ cover: COVER, still: STILL }]
          },
          {
            id: 'never-opened',
            page: NEVER_PAGE,
            title: 'Never Opened',
            blurb: 'Nobody opened this one while online.'
          }
        ])
      )
      return
    }
    if (pathname === CUTOUT_PAGE) {
      return this.file(res, 'text/html; charset=utf-8', CUTOUT_HTML, '"page"')
    }
    if (pathname === PAGE_SCRIPT) return this.file(res, 'text/javascript', PAGE_JS, '"script"')
    if (pathname === STILL || pathname === COVER) {
      return this.file(res, 'image/png', ONE_PIXEL_PNG, '"still"')
    }
    if (pathname === NEVER_PAGE) {
      return this.file(res, 'text/html; charset=utf-8', '<h1 id="title">Never</h1>', '"never"')
    }
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    res.end('Not found')
  }
}

let site: OfflineAppsSite
let ctx: AppContext | null = null
let userDataDir: string
let inheritedAppsUrl: string | undefined

function cutoutPage(app: AppContext): WebContentsPage {
  return new WebContentsPage(app.app, CUTOUT_PAGE)
}

async function openApps(app: AppContext): Promise<void> {
  await app.panel.waitForVisible(SIDEBAR_APPS)
  expect(await app.panel.click(SIDEBAR_APPS)).toBe(true)
  await app.panel.waitForVisible(APPS_GRID)
}

function textOnPage(app: AppContext, selector: string): Promise<string | null> {
  return cutoutPage(app)
    .textOf(selector)
    .catch(() => null)
}

function cardPicture(app: AppContext): Promise<string | null> {
  return app.panel.evaluate<string | null>(
    `document.querySelector('${CUTOUT_CARD} img[data-loaded="true"]')?.getAttribute('src') ?? null`
  )
}

function keptStillStatus(app: AppContext): Promise<number> {
  return app.app.evaluate(async ({ session }, url) => {
    try {
      return (await session.defaultSession.fetch(url, { cache: 'force-cache' })).status
    } catch {
      return 0
    }
  }, `${site.url}${STILL}`)
}

function launch(): Promise<AppContext> {
  return launchApp(
    { userDataDir, settings: { firstUseCompleted: true, telemetryEnabled: false } },
    { stayOnHome: true }
  )
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test.beforeAll(async () => {
  inheritedAppsUrl = process.env['COMFY_APPS_URL']
  site = new OfflineAppsSite()
  await site.start()
  process.env['COMFY_APPS_URL'] = `${site.url}/apps/`
  userDataDir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'comfy-apps-offline-e2e-')))
  ctx = await launch()
})

test.afterAll(async () => {
  await ctx?.cleanup()
  await site?.stop()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (inheritedAppsUrl === undefined) delete process.env['COMFY_APPS_URL']
  else process.env['COMFY_APPS_URL'] = inheritedAppsUrl
})

test('An app opened while online runs its script and reads the apps list @macos @windows @linux', async () => {
  const app = ctx!
  await openApps(app)
  expect(await app.panel.click(CUTOUT_CARD)).toBe(true)
  await expect.poll(() => textOnPage(app, '#script'), LONG_WAIT).toBe('script ran')
  await expect.poll(() => textOnPage(app, '#list'), LONG_WAIT).toBe('2 apps')
  await expect
    .poll(() => site.asked.filter((asked) => asked === STILL).length, LONG_WAIT)
    .toBeGreaterThanOrEqual(1)

  await site.stop()
  await expect.poll(() => keptStillStatus(app), LONG_WAIT).toBe(200)
})

test('With the apps site gone after a restart, the card shows the still Desktop kept @macos @windows @linux', async () => {
  await ctx?.cleanup()
  ctx = null
  ctx = await launch()
  const app = ctx

  await openApps(app)
  await expect
    .poll(() => app.panel.allText(`${APPS_GRID} [data-testid="app-card-name"]`), LONG_WAIT)
    .toEqual(['Remove Background', 'Never Opened'])
  await expect.poll(() => cardPicture(app), LONG_WAIT).toMatch(/^data:image\/png;base64,/)
})

test('With the apps site gone, the app opened before runs its script and reads the saved list @macos @windows @linux', async () => {
  const app = ctx!
  expect(await app.panel.click(CUTOUT_CARD)).toBe(true)

  await expect.poll(() => textOnPage(app, '#title'), LONG_WAIT).toBe('Remove Background page')
  await expect.poll(() => textOnPage(app, '#script'), LONG_WAIT).toBe('script ran')
  await expect.poll(() => textOnPage(app, '#list'), LONG_WAIT).toBe('2 apps')
})

test("With the apps site gone, an app never opened says it didn't load @macos @windows @linux", async () => {
  const app = ctx!
  expect(await cutoutPage(app).click('#back')).toBe(true)
  await app.panel.waitForVisible(APPS_GRID)

  expect(await app.panel.click(NEVER_CARD)).toBe(true)

  await app.panel.waitForVisible(APP_FAILED, LONG_WAIT)
  expect(await app.panel.textOf(`${APP_FAILED} h1`)).toBe("Never Opened didn't load")
})
