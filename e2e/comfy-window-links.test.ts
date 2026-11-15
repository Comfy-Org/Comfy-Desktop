import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { WebContentsPage, waitForWebContents } from './support/cdpPages'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { getShellOpenExternalCalls } from './support/devHooks'
import { evalWithRetry } from './support/evalRetry'

const INSTALL_NAME = 'Remote Links Fixture'
const DOCS_LINK = 'https://docs.example.test/guide'
const MAIL_LINK = 'mailto:support@example.test'
const LONG_WAIT = { timeout: 20_000 }

const NEW_WINDOW_LINKS = {
  'open-file': 'file:///etc/hosts',
  'open-windows-program': 'file:///C:/Windows/System32/calc.exe',
  'open-file-on-a-share': 'file://files.example.test/share/report.pdf',
  'open-share': 'smb://files.example.test/share',
  'open-app': 'search-ms:query=report',
  'open-docs': DOCS_LINK
}

const SAME_PAGE_LINKS = {
  'go-share': 'smb://files.example.test/share',
  'go-app': 'search-ms:query=report',
  'go-mail': MAIL_LINK
}

const NEW_TAB_FILE_LINK = 'open-file-in-new-tab'

function pageHtml(): string {
  const buttons = Object.keys(NEW_WINDOW_LINKS)
    .map((id) => `<p><button id="${id}" type="button">${id}</button></p>`)
    .join('\n    ')
  const anchors = Object.entries(SAME_PAGE_LINKS)
    .map(([id, href]) => `<p><a id="${id}" href="${href}">${id}</a></p>`)
    .join('\n    ')
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Remote ComfyUI (e2e)</title></head>
  <body style="margin: 0; padding: 24px; background: #101010; color: #eee; font: 14px sans-serif">
    ${buttons}
    <p><a id="${NEW_TAB_FILE_LINK}" href="file:///etc/hosts" target="_blank">${NEW_TAB_FILE_LINK}</a></p>
    ${anchors}
    <script>
      const links = ${JSON.stringify(NEW_WINDOW_LINKS)}
      for (const [id, url] of Object.entries(links)) {
        document.getElementById(id).addEventListener('click', () => window.open(url))
      }
    </script>
  </body>
</html>`
}

let site: Server | null = null
let siteUrl = ''
let ctx: AppContext | null = null

async function startSite(): Promise<void> {
  const server = createServer((req, res) => {
    if (req.url === '/queue') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ queue_running: [], queue_pending: [] }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(pageHtml())
  })
  site = server
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  siteUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function stopSite(): Promise<void> {
  const server = site
  if (!server) return
  site = null
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}

function running(): AppContext {
  if (!ctx) throw new Error('app is not running')
  return ctx
}

function comfyPage(): WebContentsPage {
  return new WebContentsPage(running().app, siteUrl)
}

function windowCount(): Promise<number> {
  return evalWithRetry(() =>
    running().app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length
    )
  )
}

async function clickEach(ids: string[]): Promise<void> {
  for (const id of ids) {
    expect(await comfyPage().click(`#${id}`), `clicked ${id}`).toBe(true)
  }
}

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.beforeAll(async () => {
  await startSite()
  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: 'inst-remote-links',
        name: INSTALL_NAME,
        sourceId: 'remote',
        sourceLabel: 'Remote',
        version: 'remote',
        remoteUrl: `${siteUrl}/`,
        status: 'installed',
        launchMode: 'window',
        browserPartition: 'shared',
        seen: true
      }
    ]
  })
  await expectChooserVisible(ctx.panel)
  await clickInstallTile(ctx.panel, INSTALL_NAME)
  await waitForWebContents(ctx.app, siteUrl, 90_000)
  await comfyPage().waitForVisible('#open-docs', { timeout: 30_000 })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  ctx = null
  await stopSite()
})

test('A page in a ComfyUI window gets web and mail links opened outside the app, and no file, share or app link @macos @windows @linux', async () => {
  const openedBefore = (await getShellOpenExternalCalls(running().app)).length
  const windowsBefore = await windowCount()
  const openedSince = async (): Promise<string[]> =>
    (await getShellOpenExternalCalls(running().app)).slice(openedBefore)

  await test.step('links that ask for a new window', async () => {
    await clickEach([
      'open-file',
      'open-windows-program',
      'open-file-on-a-share',
      'open-share',
      'open-app',
      NEW_TAB_FILE_LINK
    ])
    await clickEach(['open-docs'])
    await expect.poll(openedSince, LONG_WAIT).toEqual([DOCS_LINK])
  })

  await test.step('links that navigate the page', async () => {
    await clickEach(['go-share', 'go-app'])
    await clickEach(['go-mail'])
    await expect.poll(openedSince, LONG_WAIT).toEqual([DOCS_LINK, MAIL_LINK])
  })

  expect(await comfyPage().url(), 'the page stayed where it was').toBe(`${siteUrl}/`)
  expect(await windowCount(), 'the app opened no window of its own').toBe(windowsBefore)
})
