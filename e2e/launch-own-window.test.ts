import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'
import { evalWithRetry } from './support/evalRetry'
import { openPickerViaTitlePill } from './support/chooserHelpers'
import { WebContentsPage } from './support/cdpPages'
import { byTestId, TID } from './support/testIds'

const INSTALL_ID = 'inst-own-window'
const INSTALL_NAME = 'Own Window Fixture'
const CARD = `[data-testid="home-build"][data-build-id="${INSTALL_ID}"]`
const SECOND_INSTALL_ID = 'inst-own-window-second'
const SECOND_INSTALL_NAME = 'Second Window Fixture'

let ctx: AppContext
let installPath: string
let secondInstallPath: string
let port = 0
let secondPort = 0

function fakeComfyBuilderInstall(id: string, name: string, path: string, buildPort: number) {
  return {
    id,
    name,
    sourceId: 'comfybuilder',
    sourceLabel: 'ComfyBuilder',
    installPath: path,
    status: 'installed',
    launchArgs: `--port ${buildPort}`,
    launchMode: 'window',
    browserPartition: 'unique',
    seen: true
  }
}

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-own-window-'))
  secondInstallPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-own-window-second-'))
  port = await reserveFreePort()
  secondPort = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })
  await writeFakeComfyInstall({ installPath: secondInstallPath, port: secondPort })
  ctx = await launchApp(
    {
      settings: { firstUseCompleted: true, telemetryEnabled: false },
      installations: [
        fakeComfyBuilderInstall(INSTALL_ID, INSTALL_NAME, installPath, port),
        fakeComfyBuilderInstall(
          SECOND_INSTALL_ID,
          SECOND_INSTALL_NAME,
          secondInstallPath,
          secondPort
        )
      ]
    },
    { stayOnHome: true }
  )
  await ctx.panel.waitForVisible('[data-testid="home-view"]', { timeout: 15_000 })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (secondInstallPath) await rm(secondInstallPath, { recursive: true, force: true })
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

test('Start on a Home card opens ComfyUI in its own window and the dashboard stays on Home @linux @macos', async () => {
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

interface TwoBuildWindows {
  windows: number
  firstBuildWindowIds: number[]
  secondBuildWindows: number
  desktopWindows: number
}

function twoBuildWindows(): Promise<TwoBuildWindows> {
  return evalWithRetry(() =>
    ctx.app.evaluate(
      ({ BrowserWindow, WebContentsView }, ports) => {
        const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
        const hosts = (w: Electron.BrowserWindow, p: number): boolean =>
          w.contentView.children.some(
            (v) => v instanceof WebContentsView && v.webContents.getURL().includes(`:${p}`)
          )
        return {
          windows: wins.length,
          firstBuildWindowIds: wins.filter((w) => hosts(w, ports.first)).map((w) => w.id),
          secondBuildWindows: wins.filter((w) => hosts(w, ports.second)).length,
          desktopWindows: wins.filter((w) => !hosts(w, ports.first) && !hosts(w, ports.second))
            .length
        }
      },
      { first: port, second: secondPort }
    )
  )
}

test('Start on another build from a build window opens it in its own window and keeps this one @linux', async () => {
  const before = await twoBuildWindows()
  expect(before.firstBuildWindowIds, 'the first build is running in its own window').toHaveLength(1)
  const [firstBuildWindowId] = before.firstBuildWindowIds

  const firstBuildTitleBar = new WebContentsPage(
    ctx.app,
    `comfyTitleBar.html?installationId=${INSTALL_ID}`
  )
  const popup = await openPickerViaTitlePill(ctx.app, firstBuildTitleBar)
  const secondRow = byTestId(TID.pickerRow(SECOND_INSTALL_ID))
  await popup.waitForVisible(secondRow, { timeout: 15_000 })
  expect(await popup.click(secondRow), 'second build selected').toBe(true)
  await expect
    .poll(() => popup.textOf(byTestId(TID.pickerPrimaryCta)), {
      timeout: 10_000,
      intervals: [200, 400]
    })
    .toContain('Start')
  expect(await popup.click(byTestId(TID.pickerPrimaryCta)), 'Start clicked').toBe(true)

  const runAll = '[data-testid="base-alert-secondary"]'
  await ctx.panel.waitForVisible(runAll, { timeout: 15_000 })
  expect(
    await ctx.panel.textOf(runAll),
    'the Desktop window asks before running a second build'
  ).toContain('Run all')
  expect(await ctx.panel.click(runAll), 'Run all keeps the first build running').toBe(true)

  await expect.poll(twoBuildWindows, { timeout: 90_000, intervals: [250, 500, 1_000] }).toEqual({
    windows: 3,
    firstBuildWindowIds: [firstBuildWindowId],
    secondBuildWindows: 1,
    desktopWindows: 1
  })
})
