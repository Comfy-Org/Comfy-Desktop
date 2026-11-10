import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { waitForWebContents } from './support/cdpPages'
import { returnFirstInstallHostToDashboard } from './support/devHooks'

const REMOTE_ID = 'inst-return-replaces-remote'
const REMOTE_NAME = 'Return Replaces Remote'
const PROBED_EVENTS = ['dom-ready', 'did-fail-load', 'ipc-message'] as const

interface ListenerProbe {
  attached: Record<string, number>
  atBlank: Record<string, number> | null
}

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

test('return to dashboard loads the blank page with the install listeners already detached @linux', async () => {
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
    ({ webContents }, { wcId, events }) => {
      const wc = webContents.fromId(wcId)!
      const atAttach = Object.fromEntries(events.map((name) => [name, wc.listeners(name)]))
      const stillRegistered = (): Record<string, number> =>
        Object.fromEntries(
          events.map((name) => {
            const now = wc.listeners(name)
            return [name, (atAttach[name] ?? []).filter((fn) => now.includes(fn)).length]
          })
        )
      const probe: ListenerProbe = { attached: stillRegistered(), atBlank: null }
      ;(globalThis as unknown as { __returnProbe: ListenerProbe }).__returnProbe = probe
      wc.on('dom-ready', () => {
        if (probe.atBlank || wc.getURL() !== 'about:blank') return
        probe.atBlank = stillRegistered()
      })
    },
    { wcId: id, events: [...PROBED_EVENTS] }
  )

  expect(await returnFirstInstallHostToDashboard(ctx.app)).not.toBeNull()

  const readProbe = (): Promise<ListenerProbe> =>
    ctx.app.evaluate(
      () => (globalThis as unknown as { __returnProbe: ListenerProbe }).__returnProbe
    )
  await expect
    .poll(async () => (await readProbe()).atBlank !== null, {
      message: 'the remote page was never replaced by a loaded about:blank'
    })
    .toBe(true)

  const probe = await readProbe()
  for (const name of PROBED_EVENTS) {
    expect(probe.atBlank![name], `${name} listeners at about:blank`).toBeLessThan(
      probe.attached[name] ?? 0
    )
  }
})
