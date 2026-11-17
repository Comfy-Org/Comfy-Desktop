import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { WebContentsPage, waitForWebContents } from './support/cdpPages'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { getShellOpenExternalCalls } from './support/devHooks'
import { evalWithRetry } from './support/evalRetry'

const INSTALL_ID = 'inst-remote-own-site'
const INSTALL_NAME = 'Remote Own Site Fixture'
const ANOTHER_INSTALL_ID = 'inst-someone-else'
const LONG_WAIT = { timeout: 20_000 }
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

type Route = (req: IncomingMessage, res: ServerResponse) => void

interface Site {
  url: string
  stop: () => Promise<void>
}

async function startSite(route: Route): Promise<Site> {
  const server: Server = createServer(route)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    stop: async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

function sendPage(res: ServerResponse, title: string, body: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>${title}</title></head>
  <body style="margin: 0; padding: 24px; background: #101010; color: #eee; font: 14px sans-serif">
    ${body}
  </body>
</html>`)
}

function sendPng(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'image/png', 'content-length': ONE_PIXEL_PNG.length })
  res.end(ONE_PIXEL_PNG)
}

function installPage(elsewhereUrl: string): string {
  return `
    <p><a id="follow-link" href="${elsewhereUrl}/guide?via=link">A link with no target</a></p>
    <p><button id="set-location" type="button">A script that sets location</button></p>
    <p><a id="sign-in" href="/sign-in">Sign in through another site</a></p>
    <p><button id="save-fox" type="button">Save the fox output</button></p>
    <p><button id="save-owl" type="button">Save the owl output</button></p>
    <pre id="bridge">pending</pre>
    <script>
      const desktop = window.__comfyDesktop2
      document.getElementById('set-location').addEventListener('click', () => {
        location.href = ${JSON.stringify(`${elsewhereUrl}/guide?via=script`)}
      })
      for (const name of ['fox', 'owl']) {
        document.getElementById('save-' + name).addEventListener('click', () => {
          desktop.downloadAsset(location.origin + '/outputs/' + name + '.png', name + '.png')
        })
      }
      ;(async () => {
        const own = await desktop.Logs.subscribe()
        const another = await desktop.Logs.subscribe(${JSON.stringify(ANOTHER_INSTALL_ID)})
        document.getElementById('bridge').textContent = JSON.stringify({
          remote: desktop.isRemote(),
          ownLogs: own.installationId,
          anotherInstallLogs: another.installationId
        })
      })()
    </script>`
}

function elsewherePage(installUrl: string): string {
  return `
    <p><a id="back" href="${installUrl}/">Back to ComfyUI</a></p>
    <pre id="bridge">pending</pre>
    <script>
      ;(async () => {
        const ask = async (call) => {
          try {
            return await call(window.__comfyDesktop2)
          } catch {
            return 'unavailable'
          }
        }
        const origin = location.origin
        const logs = await ask((desktop) => desktop.Logs.subscribe())
        const namedLogs = await ask((desktop) =>
          desktop.Logs.subscribe(${JSON.stringify(INSTALL_ID)})
        )
        await ask((desktop) => desktop.Logs.openPopout())
        document.getElementById('bridge').textContent = JSON.stringify({
          remote: await ask((desktop) => desktop.isRemote()),
          savedOutput: await ask((desktop) =>
            desktop.downloadAsset(origin + '/outputs/taken.png', 'taken.png')
          ),
          startedModel: await ask((desktop) =>
            desktop.downloadModel(
              origin + '/models/taken.safetensors',
              'taken.safetensors',
              'checkpoints'
            )
          ),
          logs: logs.installationId,
          namedLogs: namedLogs.installationId
        })
      })()
    </script>`
}

let install: Site | null = null
let elsewhere: Site | null = null
let scratchDir = ''
let outputDir = ''
let ctx: AppContext | null = null

function running(): AppContext {
  if (!ctx) throw new Error('app is not running')
  return ctx
}

function siteUrl(site: Site | null): string {
  if (!site) throw new Error('site is not running')
  return site.url
}

function viewOn(site: Site | null): WebContentsPage {
  return new WebContentsPage(running().app, siteUrl(site))
}

async function bridgeReport(page: WebContentsPage): Promise<unknown> {
  await page.waitFor(async () => (await page.textOf('#bridge')) !== 'pending', {
    ...LONG_WAIT,
    message: 'the page never finished asking Desktop'
  })
  return JSON.parse((await page.textOf('#bridge')) ?? 'null')
}

function windowCount(): Promise<number> {
  return evalWithRetry(() =>
    running().app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length
    )
  )
}

async function savedOutputs(): Promise<string[]> {
  return (await readdir(outputDir)).sort()
}

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.beforeAll(async () => {
  scratchDir = await mkdtemp(path.join(os.tmpdir(), 'comfy-e2e-own-site-'))
  outputDir = path.join(scratchDir, 'output')
  await mkdir(outputDir)
  elsewhere = await startSite((req, res) => {
    if (req.url?.startsWith('/outputs/') || req.url?.startsWith('/models/')) return sendPng(res)
    if (req.url?.startsWith('/sign-in')) {
      return sendPage(res, 'Another site (e2e)', elsewherePage(siteUrl(install)))
    }
    sendPage(res, 'Another site (e2e)', '<p id="guide">A guide on another site</p>')
  })
  install = await startSite((req, res) => {
    if (req.url === '/queue') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ queue_running: [], queue_pending: [] }))
      return
    }
    if (req.url === '/sign-in') {
      res.writeHead(302, { location: `${siteUrl(elsewhere)}/sign-in` })
      res.end()
      return
    }
    if (req.url?.startsWith('/outputs/')) return sendPng(res)
    sendPage(res, 'Remote ComfyUI (e2e)', installPage(siteUrl(elsewhere)))
  })
  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: INSTALL_ID,
        name: INSTALL_NAME,
        sourceId: 'remote',
        sourceLabel: 'Remote',
        version: 'remote',
        remoteUrl: `${install.url}/`,
        status: 'installed',
        launchMode: 'window',
        browserPartition: 'shared',
        useSharedOutputDir: false,
        outputDir,
        seen: true
      }
    ]
  })
  await expectChooserVisible(ctx.panel)
  await clickInstallTile(ctx.panel, INSTALL_NAME)
  await waitForWebContents(ctx.app, install.url, 90_000)
  await viewOn(install).waitForVisible('#save-fox', { timeout: 30_000 })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  ctx = null
  await install?.stop()
  await elsewhere?.stop()
  if (scratchDir) await rm(scratchDir, { recursive: true, force: true })
})

test('A ComfyUI window stays on its install, and a page from another site gets nothing from Desktop @macos @windows @linux', async () => {
  const installUrl = siteUrl(install)
  const elsewhereUrl = siteUrl(elsewhere)
  const openedBefore = (await getShellOpenExternalCalls(running().app)).length
  const windowsBefore = await windowCount()
  const openedSince = async (): Promise<string[]> =>
    (await getShellOpenExternalCalls(running().app)).slice(openedBefore)

  await test.step("the install's own page uses Desktop, for its own install only", async () => {
    expect(await bridgeReport(viewOn(install))).toEqual({
      remote: true,
      ownLogs: INSTALL_ID,
      anotherInstallLogs: ''
    })
    expect(await viewOn(install).click('#save-fox'), 'clicked save-fox').toBe(true)
    await expect.poll(savedOutputs, LONG_WAIT).toEqual(['fox.png'])
  })

  await test.step('a link or a script that leaves the install opens outside the app', async () => {
    expect(await viewOn(install).click('#follow-link'), 'clicked follow-link').toBe(true)
    await expect.poll(openedSince, LONG_WAIT).toEqual([`${elsewhereUrl}/guide?via=link`])
    expect(await viewOn(install).click('#set-location'), 'clicked set-location').toBe(true)
    await expect
      .poll(openedSince, LONG_WAIT)
      .toEqual([`${elsewhereUrl}/guide?via=link`, `${elsewhereUrl}/guide?via=script`])
    expect(await viewOn(install).url(), 'the view stayed on its install').toBe(`${installUrl}/`)
  })

  await test.step('a page the install redirects to is shown, and gets nothing from Desktop', async () => {
    expect(await viewOn(install).click('#sign-in'), 'clicked sign-in').toBe(true)
    await waitForWebContents(running().app, `${elsewhereUrl}/sign-in`, 30_000)

    expect(await bridgeReport(viewOn(elsewhere))).toEqual({
      remote: false,
      savedOutput: false,
      startedModel: false,
      logs: '',
      namedLogs: ''
    })
    expect(await savedOutputs(), 'nothing new in the output folder').toEqual(['fox.png'])
  })

  await test.step('that page can send the view back, and the install works as before', async () => {
    expect(await viewOn(elsewhere).click('#back'), 'clicked back').toBe(true)
    await viewOn(install).waitForVisible('#save-owl', { timeout: 30_000 })
    expect(await viewOn(install).url()).toBe(`${installUrl}/`)

    expect(await viewOn(install).click('#save-owl'), 'clicked save-owl').toBe(true)
    await expect.poll(savedOutputs, LONG_WAIT).toEqual(['fox.png', 'owl.png'])
  })

  expect(await openedSince(), 'nothing else was opened outside the app').toHaveLength(2)
  expect(await windowCount(), 'the app opened no window of its own').toBe(windowsBefore)
})
