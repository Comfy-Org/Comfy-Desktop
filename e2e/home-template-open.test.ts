import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'
import { evalWithRetry } from './support/evalRetry'

const INSTALL_ID = 'inst-template-open'
const CARD = `[data-testid="home-build"][data-build-id="${INSTALL_ID}"]`

let ctx: AppContext
let installPath: string
let port = 0

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-template-open-'))
  port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })
  ctx = await launchApp(
    {
      settings: { firstUseCompleted: true, telemetryEnabled: false },
      installations: [
        {
          id: INSTALL_ID,
          name: 'Template Open Fixture',
          sourceId: 'comfybuilder',
          sourceLabel: 'ComfyBuilder',
          installPath,
          status: 'installed',
          launchArgs: `--port ${port}`,
          launchMode: 'window',
          browserPartition: 'unique',
          seen: true
        }
      ]
    },
    { stayOnHome: true }
  )
  await ctx.panel.waitForVisible('[data-testid="home-view"]', { timeout: 15_000 })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

function buildWindowUrl(): Promise<string | null> {
  return evalWithRetry(() =>
    ctx.app.evaluate(({ BrowserWindow, WebContentsView }, p) => {
      for (const win of BrowserWindow.getAllWindows()) {
        for (const view of win.contentView.children) {
          if (!(view instanceof WebContentsView)) continue
          const url = view.webContents.getURL()
          if (url.includes(`:${p}`)) return url
        }
      }
      return null
    }, port)
  )
}

function openTemplate(templateId: string): Promise<string> {
  return ctx.panel.evaluate<string>(
    `window.api.openTemplateInBuild(${JSON.stringify(INSTALL_ID)}, ${JSON.stringify(templateId)})`
  )
}

test('a template picked for a stopped build opens when that build starts @linux @macos', async () => {
  expect(await openTemplate('poster_template')).toBe('launch')
  await ctx.panel.waitForVisible(CARD, { timeout: 15_000 })
  expect(await ctx.panel.click(CARD)).toBe(true)

  await expect
    .poll(buildWindowUrl, { timeout: 90_000, intervals: [250, 500, 1_000] })
    .toContain('template=poster_template')
})

test('a template picked for a running build opens in its window straight away @linux @macos', async () => {
  expect(await openTemplate('banner_template')).toBe('opened')
  await expect
    .poll(buildWindowUrl, { timeout: 15_000, intervals: [250, 500] })
    .toContain('template=banner_template')
})
