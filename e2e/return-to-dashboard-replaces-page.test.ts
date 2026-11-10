import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { waitForWebContents } from './support/cdpPages'
import { returnFirstInstallHostToDashboard } from './support/devHooks'

const REMOTE_ID = 'inst-return-replaces-remote'
const REMOTE_NAME = 'Return Replaces Remote'

let ctx: AppContext
let server: http.Server
let remoteUrl: string

test.beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>remote</title><body>remote</body>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  remoteUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: REMOTE_ID,
        name: REMOTE_NAME,
        sourceId: 'remote',
        remoteUrl,
        version: 'remote',
        status: 'installed',
        launchMode: 'window',
        browserPartition: 'shared',
        seen: true
      }
    ]
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  await new Promise<void>((resolve) => server?.close(() => resolve()))
})

test('return to dashboard replaces a page that asks to stay @linux', async () => {
  ctx.app.context().on('dialog', () => {})
  await clickInstallTile(ctx.panel, REMOTE_NAME)
  const id = await waitForWebContents(ctx.app, remoteUrl, 30_000)

  await expect
    .poll(() =>
      ctx.app.evaluate(({ webContents }, wcId) => {
        const wc = webContents.fromId(wcId)
        return !!wc && !wc.isLoading() && wc.getURL().startsWith('http')
      }, id)
    )
    .toBe(true)

  await ctx.app.evaluate(
    ({ webContents }, wcId) =>
      webContents
        .fromId(wcId)!
        .executeJavaScript(
          `window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = '' }); true`,
          true
        ),
    id
  )

  expect(await returnFirstInstallHostToDashboard(ctx.app)).not.toBeNull()

  await expect
    .poll(
      () =>
        ctx.app.evaluate(({ webContents }, wcId) => webContents.fromId(wcId)?.getURL() ?? null, id),
      { message: 'the remote page stayed loaded after return to dashboard' }
    )
    .toBe('about:blank')
})
