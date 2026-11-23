import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import type { WebContents } from 'electron'
import { launchApp, type AppContext } from './launchApp'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { waitForWebContents } from './support/cdpPages'
import { returnFirstInstallHostToDashboard } from './support/devHooks'

const REMOTE_ID = 'inst-return-replaces-remote'
const REMOTE_NAME = 'Return Replaces Remote'

test.describe.configure({ mode: 'serial' })

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

const DISCARD_MESSAGE = "This workflow has changes that haven't been saved. They will be lost."

let pageId: number

async function pageUrl(): Promise<string | null> {
  return ctx.app.evaluate(
    ({ webContents }, wcId) => webContents.fromId(wcId)?.getURL() ?? null,
    pageId
  )
}

interface AskedModal {
  wcId: number
  id: string
  message: string
}

function lastAskedModal(): Promise<AskedModal | null> {
  return ctx.app.evaluate(
    () => (globalThis as unknown as { __askedModals?: AskedModal[] }).__askedModals?.at(-1) ?? null
  )
}

async function answerDiscardPrompt(action: 'confirm' | 'cancel'): Promise<void> {
  await expect
    .poll(async () => (await lastAskedModal())?.message, {
      message: 'Desktop never asked about the unsaved changes'
    })
    .toBe(DISCARD_MESSAGE)
  const asked = (await lastAskedModal())!
  await ctx.app.evaluate(
    async ({ webContents }, { wcId, modalId, act }) => {
      const modal = webContents.fromId(wcId)!
      ;(globalThis as unknown as { __askedModals?: AskedModal[] }).__askedModals = []
      await modal.executeJavaScript(
        `window.__comfySystemModal.action(${JSON.stringify({ modalId, action: act })})`
      )
    },
    { wcId: asked.wcId, modalId: asked.id, act: action }
  )
}

test.beforeAll(async () => {
  ctx.app.context().on('dialog', () => {})
  await ctx.app.evaluate(({ app, webContents }) => {
    const record = (wc: WebContents): void => {
      const send = wc.send.bind(wc)
      wc.send = (channel: string, ...args: unknown[]) => {
        if (channel === 'comfy-systemmodal:set-modal') {
          const spec = args[0] as { id: string; message: string }
          const store = globalThis as unknown as { __askedModals?: unknown[] }
          ;(store.__askedModals ??= []).push({ wcId: wc.id, id: spec.id, message: spec.message })
        }
        send(channel, ...args)
      }
    }
    for (const wc of webContents.getAllWebContents()) record(wc)
    app.on('web-contents-created', (_event, wc) => record(wc))
  })
  await clickInstallTile(ctx.panel, REMOTE_NAME)
  pageId = await waitForWebContents(ctx.app, remoteUrl, 30_000)

  await expect
    .poll(() =>
      ctx.app.evaluate(({ webContents }, wcId) => {
        const wc = webContents.fromId(wcId)
        return !!wc && !wc.isLoading() && wc.getURL().startsWith('http')
      }, pageId)
    )
    .toBe(true)

  await ctx.app.evaluate(async ({ webContents }, wcId) => {
    const wc = webContents.fromId(wcId)!
    const flags = globalThis as unknown as { __unloadVetoes?: number }
    flags.__unloadVetoes = 0
    wc.on('will-prevent-unload', () => {
      flags.__unloadVetoes = (flags.__unloadVetoes ?? 0) + 1
    })
    await wc.executeJavaScript(
      `window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = '' }); true`,
      true
    )
  }, pageId)
})

function unloadVetoes(): Promise<number> {
  return ctx.app.evaluate(
    () => (globalThis as unknown as { __unloadVetoes?: number }).__unloadVetoes ?? 0
  )
}

function windowTitles(): Promise<string[]> {
  return ctx.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((win) => win.getTitle())
  )
}

test('cancelling the unsaved-changes prompt keeps the page @linux', async () => {
  const titlesBefore = await windowTitles()
  const returning = returnFirstInstallHostToDashboard(ctx.app)
  await answerDiscardPrompt('cancel')
  await returning

  expect(
    await windowTitles(),
    'the window went back to the dashboard although the person cancelled'
  ).toEqual(titlesBefore)
  expect(await pageUrl(), 'the page was replaced although the person cancelled').toBe(remoteUrl)
})

test('return to dashboard replaces a page that asks to stay once the person discards @linux', async () => {
  const vetoesBefore = await unloadVetoes()
  const returning = returnFirstInstallHostToDashboard(ctx.app)
  await answerDiscardPrompt('confirm')
  expect(await returning).not.toBeNull()

  await expect
    .poll(pageUrl, { message: 'the remote page stayed loaded after return to dashboard' })
    .toBe('about:blank')

  expect(
    (await unloadVetoes()) - vetoesBefore,
    'the page should veto both the attempt that asked and the unload Desktop then overrode'
  ).toBe(2)
})
