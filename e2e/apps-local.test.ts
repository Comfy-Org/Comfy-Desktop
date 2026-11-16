import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { waitForWebContents, WebContentsPage } from './support/cdpPages'
import { getRunningSessionSnapshot } from './support/devHooks'
import {
  FAKE_COMFY_API_SERVER,
  FAKE_OUTPUT_TEXT,
  SOMEONE_ELSES_RUN,
  type FakeComfySeen
} from './support/fakeComfyApi'
import { reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'

const BUILD_ID = 'inst-apps-local'
const BUILD_NAME = 'Apps Test Build'
const SIDEBAR_APPS = '[data-testid="app-sidebar-apps"]'
const CUTOUT_CARD = '[data-testid="app-card-remove-background"]'
const CUTOUT_PAGE = '/apps/remove-background/desktop.html'
const LONG_WAIT = { timeout: 30_000 }

const APP_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Remove Background page</title></head>
  <body style="margin: 0; padding: 24px; background: #101010; color: #eee; font: 14px sans-serif">
    <a id="back" href="/apps/">All apps</a>
    <p id="local">pending</p>
    <button id="start" type="button">Start</button>
    <button id="run" type="button">Run</button>
    <p id="result"></p>
    <button id="pry" type="button">Pry</button>
    <p id="pried"></p>
    <script>
      const local = window.comfyDesktopLocal
      const want = { minVersion: '0.41.0' }
      const updates = []
      const show = (id, text) => { document.getElementById(id).textContent = text }
      const say = (s) => [s.state, s.name, s.version, s.error].filter(Boolean).join(' | ')
      const ask = async (request) => {
        const answer = await local.localFetch(request)
        return { status: answer.status, body: JSON.parse(new TextDecoder().decode(answer.body)) }
      }
      const until = async (done) => {
        for (let tries = 0; tries < 200 && !(await done()); tries++) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      }
      if (!local) show('local', 'no local bridge')
      else {
        local.onLocalEvent((update) => updates.push(update.type))
        local.getLocal(want).then((s) => show('local', say(s)))
      }
      document.getElementById('start').addEventListener('click', async () => {
        show('local', 'starting')
        show('local', say(await local.startLocal(want)))
      })
      document.getElementById('run').addEventListener('click', async () => {
        try {
          const sent = await ask({
            method: 'POST',
            path: '/upload/image',
            body: new Uint8Array([1, 2, 3, 4]),
            fileName: 'photo.png'
          })
          const image = sent.body.subfolder + '/' + sent.body.name
          const started = await ask({
            method: 'POST',
            path: '/prompt',
            body: JSON.stringify({
              prompt: { load: { class_type: 'LoadImage', inputs: { image } } },
              client_id: 'the-page',
              extra_data: { comfy_app: { name: 'Remove Background' } }
            })
          })
          const run = started.body.prompt_id
          await until(() => updates.includes('execution_success'))
          let entry
          await until(async () => (entry = (await ask({ path: '/history/' + run })).body[run]))
          const file = entry.outputs.save.images[0]
          const got = await local.localFetch({ path: '/view?' + new URLSearchParams(file) })
          const queue = await ask({ path: '/queue' })
          show('result', JSON.stringify({
            image,
            result: new TextDecoder().decode(got.body),
            type: got.contentType,
            updates,
            queue: queue.body
          }))
        } catch (err) {
          show('result', 'failed: ' + err.message)
        }
      })
      document.getElementById('pry').addEventListener('click', async () => {
        const post = (path, body) => ({ method: 'POST', path, body: JSON.stringify(body) })
        const statuses = []
        for (const request of [
          { path: '/system_stats' },
          { path: '/history/${SOMEONE_ELSES_RUN}' },
          { path: '/view?filename=private.png&type=output' },
          post('/interrupt', { prompt_id: '${SOMEONE_ELSES_RUN}' }),
          post('/queue', { clear: true })
        ]) statuses.push((await local.localFetch(request)).status)
        show('pried', statuses.join(','))
      })
    </script>
  </body>
</html>`

class FakeAppsSite {
  port = 0
  private server: Server | null = null

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

  private route(req: IncomingMessage, res: ServerResponse): void {
    const { pathname } = new URL(req.url ?? '/', this.url)
    if (pathname === '/apps/apps.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify([
          { id: 'remove-background', page: CUTOUT_PAGE, title: 'Remove Background', blurb: '' }
        ])
      )
      return
    }
    res.writeHead(pathname === CUTOUT_PAGE ? 200 : 404, {
      'content-type': 'text/html; charset=utf-8'
    })
    res.end(pathname === CUTOUT_PAGE ? APP_PAGE : 'Not found')
  }
}

let site: FakeAppsSite
let ctx: AppContext
let profileDir = ''
let installPath = ''
let comfyPort = 0
let inheritedAppsUrl: string | undefined

function appPage(): WebContentsPage {
  return new WebContentsPage(ctx.app, CUTOUT_PAGE)
}

function windowCount(): Promise<number> {
  return ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
}

async function whatComfySaw(): Promise<FakeComfySeen> {
  const port = (await getRunningSessionSnapshot(ctx.app, BUILD_ID))?.port
  return (await (await fetch(`http://127.0.0.1:${port}/e2e/seen`)).json()) as FakeComfySeen
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

test.beforeAll(async () => {
  inheritedAppsUrl = process.env['COMFY_APPS_URL']
  site = new FakeAppsSite()
  await site.start()
  process.env['COMFY_APPS_URL'] = `${site.url}/apps/`
  profileDir = await mkdtemp(path.join(os.tmpdir(), 'comfy-apps-local-profile-'))
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfy-apps-local-build-'))
  comfyPort = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port: comfyPort, serverScript: FAKE_COMFY_API_SERVER })
  await writeFile(
    path.join(installPath, 'ComfyUI', 'comfyui_version.py'),
    '__version__ = "0.42.1"\n'
  )
  ctx = await launchApp(
    {
      profileDir,
      settings: { firstUseCompleted: true, telemetryEnabled: false, language: 'en' },
      installations: [
        {
          id: BUILD_ID,
          name: BUILD_NAME,
          sourceId: 'comfybuilder',
          sourceLabel: 'ComfyBuilder',
          installPath,
          status: 'installed',
          launchArgs: `--port ${comfyPort}`,
          seen: true
        }
      ]
    },
    { stayOnHome: true }
  )
})

test.afterAll(async () => {
  await ctx?.panel.evaluate(`window.api.stopComfyUI(${JSON.stringify(BUILD_ID)})`).catch(() => {})
  await ctx?.cleanup()
  await site?.stop()
  if (profileDir) await rm(profileDir, { recursive: true, force: true })
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (inheritedAppsUrl === undefined) delete process.env['COMFY_APPS_URL']
  else process.env['COMFY_APPS_URL'] = inheritedAppsUrl
})

test('An app page is offered the build on this computer, stopped, by name and version @linux', async () => {
  await ctx.panel.waitForVisible(SIDEBAR_APPS)
  expect(await ctx.panel.click(SIDEBAR_APPS)).toBe(true)
  await ctx.panel.waitForVisible(CUTOUT_CARD)
  expect(await ctx.panel.click(CUTOUT_CARD)).toBe(true)
  await waitForWebContents(ctx.app, CUTOUT_PAGE)

  await expect
    .poll(() => appPage().textOf('#local'), LONG_WAIT)
    .toBe(`stopped | ${BUILD_NAME} | 0.42.1`)
  expect(await getRunningSessionSnapshot(ctx.app, BUILD_ID)).toBeNull()
})

test('Starting from the page runs that build with no ComfyUI window @linux', async () => {
  const windowsBefore = await windowCount()

  expect(await appPage().click('#start')).toBe(true)

  await expect
    .poll(() => appPage().textOf('#local'), { timeout: 120_000 })
    .toBe(`running | ${BUILD_NAME} | 0.42.1`)
  expect(await getRunningSessionSnapshot(ctx.app, BUILD_ID)).not.toBeNull()
  expect(await windowCount(), 'no window was opened for ComfyUI').toBe(windowsBefore)
})

test('A run goes from a picture to its result, with updates on the way, through Desktop only @linux', async () => {
  expect(await appPage().click('#run')).toBe(true)

  await expect.poll(() => appPage().textOf('#result'), LONG_WAIT).toContain('"result"')
  const result = JSON.parse((await appPage().textOf('#result')) ?? '{}') as Record<string, unknown>
  expect(result).toEqual({
    image: 'comfy-apps/photo.png',
    result: FAKE_OUTPUT_TEXT,
    type: 'image/png',
    updates: ['execution_start', 'executing', 'execution_success'],
    queue: { running: [{ n: 1, id: null, app: null, seconds: null }], pending: [] }
  })

  const seen = await whatComfySaw()
  expect(seen.sockets, 'Desktop listens as one client').toHaveLength(1)
  expect(seen.prompts).toEqual([
    { id: 'e2e-run-1', clientId: seen.sockets[0], app: 'Remove Background', nodes: ['load'] }
  ])
  expect(seen.uploads).toEqual([
    { name: 'photo.png', subfolder: 'comfy-apps', overwrite: false, bytes: expect.any(Number) }
  ])
})

test('The page cannot reach anything that is not its own run @linux', async () => {
  expect(await appPage().click('#pry')).toBe(true)

  await expect.poll(() => appPage().textOf('#pried'), LONG_WAIT).toBe('403,403,403,403,403')
  const seen = await whatComfySaw()
  expect(seen.asked).not.toContain('GET /system_stats')
  expect(seen.asked).not.toContain(`GET /history/${SOMEONE_ELSES_RUN}`)
  expect(
    seen.asked.filter((asked) => asked === 'GET /view'),
    'only the run fetched its own file'
  ).toHaveLength(1)
  expect(seen.interrupted).toEqual([])
})

test('Opening the build an app started shows ComfyUI in its own window @linux', async () => {
  const windowsBefore = await windowCount()

  expect(
    await ctx.panel.evaluate<boolean>(`window.api.focusComfyWindow(${JSON.stringify(BUILD_ID)})`)
  ).toBe(true)

  await expect.poll(() => windowCount(), LONG_WAIT).toBe(windowsBefore + 1)
  const port = (await getRunningSessionSnapshot(ctx.app, BUILD_ID))?.port
  await waitForWebContents(ctx.app, `127.0.0.1:${port}`)
})
