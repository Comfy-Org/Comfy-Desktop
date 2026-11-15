import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'
import { evalWithRetry } from './support/evalRetry'

const INSTALL_ID = 'inst-own-window'
const INSTALL_NAME = 'Own Window Fixture'
const CARD = `[data-testid="home-build"][data-build-id="${INSTALL_ID}"]`

let ctx: AppContext
let installPath: string
let port = 0

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-own-window-'))
  port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })
  ctx = await launchApp(
    {
      settings: { firstUseCompleted: true, telemetryEnabled: false },
      installations: [
        {
          id: INSTALL_ID,
          name: INSTALL_NAME,
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

interface WindowState {
  count: number
  comfyWindows: number
  dashboardShowsPanel: boolean
}

function windowState(): Promise<WindowState> {
  return evalWithRetry(() =>
    ctx.app.evaluate(({ BrowserWindow, WebContentsView }, p) => {
      const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
      const hostsComfy = (w: Electron.BrowserWindow): boolean =>
        w.contentView.children.some(
          (v) => v instanceof WebContentsView && v.webContents.getURL().includes(`:${p}`)
        )
      const dashboard = wins.find((w) => !hostsComfy(w))
      return {
        count: wins.length,
        comfyWindows: wins.filter(hostsComfy).length,
        dashboardShowsPanel:
          !!dashboard &&
          dashboard.contentView.children.some(
            (v) =>
              v instanceof WebContentsView &&
              v.getVisible() &&
              v.webContents.getURL().includes('panel.html')
          )
      }
    }, port)
  )
}

test('Start on a Home card opens ComfyUI in its own window and the dashboard stays on Home @linux', async () => {
  await ctx.panel.waitForVisible(CARD, { timeout: 15_000 })
  expect(await ctx.panel.click(CARD)).toBe(true)

  await expect
    .poll(windowState, { timeout: 90_000, intervals: [250, 500, 1_000] })
    .toEqual({ count: 2, comfyWindows: 1, dashboardShowsPanel: true })

  expect(await ctx.panel.isVisible('[data-testid="home-view"]')).toBe(true)
  expect(await ctx.panel.exists('.brand-progress')).toBe(false)
  await ctx.panel.waitFor(async () => !!(await ctx.panel.textOf(CARD))?.includes('Running'), {
    timeout: 15_000,
    message: 'the Home card never showed Running'
  })
})
