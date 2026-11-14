import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { WebContentsPage } from './support/cdpPages'
import { getShellOpenExternalCalls } from './support/devHooks'
import { claimsOf, FakeCloud, reply, type BearerClaims } from './support/fakeCloud'

const SIDEBAR_APPS = '[data-testid="app-sidebar-apps"]'
const APPS_GRID = '[data-testid="apps-grid"]'
const CUTOUT_CARD = '[data-testid="app-card-remove-background"]'
const DOWN_CARD = '[data-testid="app-card-down-for-now"]'
const APP_HOST = '[data-testid="app-page-host"]'
const SIDEBAR = '[data-testid="app-sidebar"]'
const APP_FAILED = '[data-testid="app-page-failed"]'
const APP_RETRY = '[data-testid="app-page-retry"]'
const CUTOUT_PAGE = '/apps/remove-background/desktop.html'
const DOWN_PAGE = '/apps/down-for-now/desktop.html'
const OUTSIDE_LINK = 'https://docs.example.test/pricing'
const LONG_WAIT = { timeout: 20_000 }

function appPageHtml(title: string, cloudUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>${title}</title></head>
  <body style="margin: 0; padding: 24px; background: #101010; color: #eee; font: 14px sans-serif">
    <a id="back" href="/apps/">All apps</a>
    <h1 id="title">${title}</h1>
    <p id="who">pending</p>
    <button id="signin" type="button">Sign in</button>
    <button id="run" type="button">Run</button>
    <p id="result"></p>
    <a id="outside" href="${OUTSIDE_LINK}">Pricing</a>
    <script>
      const auth = window.comfyDesktopAuth
      const who = document.getElementById('who')
      const show = (state) => {
        who.textContent =
          state.status === 'signed_in' ? state.email + ' in ' + state.workspaceId : state.status
      }
      if (!auth) who.textContent = 'no Desktop sign-in'
      else {
        auth.getState().then(show)
        auth.onChanged(show)
      }
      document.getElementById('signin').addEventListener('click', () => {
        auth.requestSignIn().then(show)
      })
      document.getElementById('run').addEventListener('click', async () => {
        const state = await auth.getState()
        const token = await auth.getWorkspaceToken(state.workspaceId)
        const answer = await fetch('${cloudUrl}/api/prompt', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: {} })
        })
        document.getElementById('result').textContent = 'Comfy Cloud answered ' + answer.status
      })
    </script>
  </body>
</html>`
}

class FakeAppsSite {
  downPageAnswers = 503
  port = 0
  private server: Server | null = null

  constructor(private readonly cloudUrl: () => string) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => this.route(req, res))
    this.server = server
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    this.port = (server.address() as AddressInfo).port
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = null
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }

  private html(res: ServerResponse, status: number, body: string): void {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
    res.end(body)
  }

  private route(req: IncomingMessage, res: ServerResponse): void {
    const { pathname } = new URL(req.url ?? '/', this.url)
    if (pathname === '/apps/apps.json') {
      return reply(res, 200, [
        {
          id: 'remove-background',
          page: CUTOUT_PAGE,
          title: 'Remove Background',
          blurb: 'Cut the subject out of a picture or video.'
        },
        {
          id: 'down-for-now',
          page: DOWN_PAGE,
          title: 'Down For Now',
          blurb: 'Its page is not answering yet.'
        },
        { id: 'elsewhere', page: 'https://evil.example/apps/x', title: 'Elsewhere' }
      ])
    }
    if (pathname === CUTOUT_PAGE) {
      return this.html(res, 200, appPageHtml('Remove Background page', this.cloudUrl()))
    }
    if (pathname === DOWN_PAGE) {
      const status = this.downPageAnswers
      return this.html(res, status, appPageHtml('Down For Now page', this.cloudUrl()))
    }
    if (pathname === '/apps/') return this.html(res, 200, '<h1 id="title">The website list</h1>')
    this.html(res, 404, 'Not found')
  }
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface HostedView {
  visible: boolean
  bounds: Box
}

function viewShowing(app: ElectronApplication, marker: string): Promise<HostedView | null> {
  return app.evaluate(({ BrowserWindow, WebContentsView }, urlPart) => {
    for (const win of BrowserWindow.getAllWindows()) {
      for (const child of win.contentView.children) {
        if (!(child instanceof WebContentsView)) continue
        if (!child.webContents.getURL().includes(urlPart)) continue
        return { visible: child.getVisible(), bounds: child.getBounds() }
      }
    }
    return null
  }, marker)
}

let site: FakeAppsSite
let cloud: FakeCloud
let ctx: AppContext
let userDataDir: string
let promptBearers: BearerClaims[]
let stopBrowser: () => Promise<void> = async () => {}
let inheritedEnv: Record<string, string | undefined>

function cutoutPage(): WebContentsPage {
  return new WebContentsPage(ctx.app, CUTOUT_PAGE)
}

function sidebarHasFoldedToItsRail(): Promise<boolean> {
  return ctx.panel.evaluate<boolean>(
    `(() => { const sidebar = document.querySelector('${SIDEBAR}'); return sidebar.dataset.collapsed === 'true' && sidebar.getAnimations().length === 0 })()`
  )
}

async function appPageAreaInWindow(): Promise<Box> {
  const area = await ctx.panel.evaluate<Box>(
    `(() => { const r = document.querySelector('${APP_HOST}').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`
  )
  const panel = await viewShowing(ctx.app, 'panel.html')
  return {
    x: (panel?.bounds.x ?? 0) + Math.round(area.x),
    y: (panel?.bounds.y ?? 0) + Math.round(area.y),
    width: Math.round(area.width),
    height: Math.round(area.height)
  }
}

function allowPageToCallCloud(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'authorization, content-type')
}

function completeSignInsLikeABrowser(app: ElectronApplication): () => Promise<void> {
  let followed = 0
  let stopped = false
  const loop = (async () => {
    while (!stopped) {
      const opened = await getShellOpenExternalCalls(app).catch(() => [] as string[])
      for (const url of opened.slice(followed)) {
        followed += 1
        if (url.startsWith(cloud.url)) await fetch(url).catch(() => {})
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })()
  return async () => {
    stopped = true
    await loop
  }
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test.beforeAll(async () => {
  inheritedEnv = {
    COMFY_APPS_URL: process.env['COMFY_APPS_URL'],
    COMFY_CLOUD_ISSUER: process.env['COMFY_CLOUD_ISSUER'],
    COMFY_BUILDER_BASE_URL: process.env['COMFY_BUILDER_BASE_URL']
  }
  promptBearers = []
  cloud = new FakeCloud((req, res, url) => {
    if (url.pathname !== '/api/prompt') return false
    allowPageToCallCloud(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return true
    }
    promptBearers.push(claimsOf(req))
    reply(res, 200, { prompt_id: 'run-1' })
    return true
  })
  await cloud.start()
  site = new FakeAppsSite(() => cloud.url)
  await site.start()
  process.env['COMFY_APPS_URL'] = `${site.url}/apps/`
  process.env['COMFY_CLOUD_ISSUER'] = cloud.url
  process.env['COMFY_BUILDER_BASE_URL'] = cloud.url
  userDataDir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'comfy-apps-e2e-')))
  ctx = await launchApp(
    { userDataDir, settings: { firstUseCompleted: true, telemetryEnabled: false } },
    { stayOnHome: true }
  )
  stopBrowser = completeSignInsLikeABrowser(ctx.app)
})

test.afterAll(async () => {
  await stopBrowser()
  await ctx?.cleanup()
  await site?.stop()
  await cloud?.stop()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  for (const [key, value] of Object.entries(inheritedEnv ?? {})) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test("Apps lists the website's apps as cards, without the one that opens another site @macos @windows @linux", async () => {
  await ctx.panel.waitForVisible(SIDEBAR_APPS)
  expect(await ctx.panel.click(SIDEBAR_APPS)).toBe(true)

  await ctx.panel.waitForVisible(APPS_GRID)
  await expect
    .poll(() => ctx.panel.allText(`${APPS_GRID} button span.font-medium`), LONG_WAIT)
    .toEqual(['Remove Background', 'Down For Now'])
})

test('A card opens its app page inside Desktop, exactly over the Apps page beside the folded sidebar @macos @windows @linux', async () => {
  expect(await ctx.panel.click(CUTOUT_CARD)).toBe(true)

  await expect
    .poll(async () => (await viewShowing(ctx.app, CUTOUT_PAGE))?.visible ?? false, LONG_WAIT)
    .toBe(true)
  expect(await cutoutPage().textOf('#title')).toBe('Remove Background page')

  await expect.poll(sidebarHasFoldedToItsRail, LONG_WAIT).toBe(true)
  await expect(async () => {
    const area = await appPageAreaInWindow()
    expect((await viewShowing(ctx.app, CUTOUT_PAGE))?.bounds).toEqual(area)
  }).toPass(LONG_WAIT)
})

test("The app page sees Desktop's sign-in, signed out, and none of Desktop's other controls @macos @windows @linux", async () => {
  await expect.poll(() => cutoutPage().textOf('#who'), LONG_WAIT).toBe('signed_out')

  const exposed = await cutoutPage().evaluate<string[]>(
    `Object.keys(window.comfyDesktopAuth).sort()`
  )
  expect(exposed).toEqual([
    'getPartnerNodeToken',
    'getState',
    'getWorkspaceToken',
    'onChanged',
    'requestSignIn'
  ])
  expect(
    await cutoutPage().evaluate<string>(
      `[typeof window.api, typeof window.__comfyDesktop2, typeof window.require].join()`
    )
  ).toBe('undefined,undefined,undefined')
})

test('A link to another site goes to the browser and the app stays open @macos @windows @linux', async () => {
  expect(await cutoutPage().click('#outside')).toBe(true)

  await expect.poll(() => getShellOpenExternalCalls(ctx.app), LONG_WAIT).toContain(OUTSIDE_LINK)
  expect(await cutoutPage().url()).toBe(`${site.url}${CUTOUT_PAGE}`)
  expect((await viewShowing(ctx.app, CUTOUT_PAGE))?.visible).toBe(true)
})

test('Signing in from the app page signs Desktop in, and a run reaches Comfy Cloud with a workspace token @macos @windows', async () => {
  expect(await cutoutPage().click('#signin')).toBe(true)

  await expect.poll(() => cutoutPage().textOf('#who'), LONG_WAIT).toBe('e2e@example.com in A')
  expect(cloud.authorizeUrls, 'one consent in the browser').toHaveLength(1)

  expect(await cutoutPage().click('#run')).toBe(true)

  await expect
    .poll(() => cutoutPage().textOf('#result'), LONG_WAIT)
    .toBe('Comfy Cloud answered 200')
  expect(promptBearers).toHaveLength(1)
  expect(promptBearers[0]?.workspace_id).toBe('A')
  expect(promptBearers[0]?.scope, 'the page never holds the token that can mint others').toBe(
    undefined
  )
})

test('"All apps" on the app page returns to the cards without loading the website list @macos @windows @linux', async () => {
  expect(await cutoutPage().click('#back')).toBe(true)

  await ctx.panel.waitForVisible(APPS_GRID)
  await expect
    .poll(async () => (await viewShowing(ctx.app, CUTOUT_PAGE))?.visible, LONG_WAIT)
    .toBe(false)
  expect(await cutoutPage().textOf('#title')).toBe('Remove Background page')
})

test('An app whose page is down says so, and Try again opens it once the site answers @macos @windows @linux', async () => {
  expect(await ctx.panel.click(DOWN_CARD)).toBe(true)

  await ctx.panel.waitForVisible(APP_FAILED)
  expect(await ctx.panel.textOf(`${APP_FAILED} h1`)).toBe("Down For Now didn't load")
  expect((await viewShowing(ctx.app, DOWN_PAGE))?.visible ?? false).toBe(false)

  site.downPageAnswers = 200
  expect(await ctx.panel.click(APP_RETRY)).toBe(true)

  await expect
    .poll(async () => (await viewShowing(ctx.app, DOWN_PAGE))?.visible ?? false, LONG_WAIT)
    .toBe(true)
  expect(await new WebContentsPage(ctx.app, DOWN_PAGE).textOf('#title')).toBe('Down For Now page')
})
