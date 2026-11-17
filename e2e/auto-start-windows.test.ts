import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext, type SeedInstallation } from './launchApp'
import { evalWithRetry } from './support/evalRetry'
import { getIpcInvocations } from './support/devHooks'
import { reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'

const BUILD_ID = 'inst-auto-start-windows'
const CARD = `[data-testid="home-build"][data-build-id="${BUILD_ID}"]`
const HOME = '[data-testid="home-view"]'

let rootDir: string
let build: SeedInstallation
let port: number
let ctx: AppContext | undefined

test.setTimeout(120_000)

test.beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'comfyui-auto-start-windows-'))
  port = await reserveFreePort()
  const installPath = path.join(rootDir, 'build')
  await writeFakeComfyInstall({ installPath, port })
  build = {
    id: BUILD_ID,
    name: 'Auto start build',
    sourceId: 'comfybuilder',
    sourceLabel: 'ComfyBuilder',
    installPath,
    status: 'installed',
    launchArgs: `--port ${port}`,
    launchMode: 'window',
    seen: true
  }
})

test.afterEach(async () => {
  await ctx?.cleanup()
  ctx = undefined
  await rm(rootDir, { recursive: true, force: true })
})

async function windowState() {
  return evalWithRetry(() =>
    ctx!.app.evaluate(({ BrowserWindow, WebContentsView }, buildPort) => {
      const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
      const hostsBuild = (window: Electron.BrowserWindow): boolean =>
        window.contentView.children.some(
          (view) =>
            view instanceof WebContentsView &&
            view.webContents.getURL().startsWith(`http://127.0.0.1:${buildPort}`)
        )
      return {
        total: windows.length,
        visibleBuilds: windows.filter((window) => window.isVisible() && hostsBuild(window)).length,
        visibleDashboards: windows.filter(
          (window) =>
            window.isVisible() &&
            !hostsBuild(window) &&
            window.contentView.children.some(
              (view) =>
                view instanceof WebContentsView &&
                view.getVisible() &&
                view.webContents.getURL().includes('panel.html')
            )
        ).length
      }
    }, port)
  )
}

test('restarting Desktop with Auto start opens Home and a separate ComfyUI window @macos @linux', async () => {
  const profileDir = path.join(rootDir, 'profile')
  ctx = await launchApp(
    {
      profileDir,
      settings: { firstUseCompleted: true, telemetryEnabled: false, autoLaunchOnStartup: 'none' },
      installations: [build]
    },
    { stayOnHome: true }
  )
  await ctx.panel.waitForVisible(CARD)
  expect(await ctx.panel.click(`${CARD} [data-testid="home-build-more"]`)).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="build-menu-auto-start"]')
  expect(await ctx.panel.click('[data-testid="build-menu-auto-start"]')).toBe(true)
  await expect
    .poll(() => ctx!.panel.evaluate("window.api.getSetting('autoLaunchOnStartup')"))
    .toBe(BUILD_ID)
  await ctx.cleanup()
  ctx = undefined

  ctx = await launchApp({ profileDir }, { stayOnHome: true })
  await expect.poll(windowState, { timeout: 90_000 }).toEqual({
    total: 2,
    visibleBuilds: 1,
    visibleDashboards: 1
  })
  expect(await ctx.panel.isVisible(HOME)).toBe(true)
  await expect.poll(() => ctx!.panel.textOf(CARD)).toContain('Running')
})

test('an auto-start failure remains accessible from Home @macos @linux', async () => {
  await writeFile(path.join(build.installPath!, 'startup-failure'), 'E2E auto-start failure\n')
  ctx = await launchApp(
    {
      settings: { firstUseCompleted: true, telemetryEnabled: false, autoLaunchOnStartup: BUILD_ID },
      installations: [build]
    },
    { stayOnHome: true }
  )
  await expect.poll(() => ctx!.panel.textOf(CARD), { timeout: 90_000 }).toContain("Didn't start")
  expect(await ctx.panel.isVisible(HOME)).toBe(true)
  expect(await ctx.panel.click(CARD)).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="build-progress-dialog"]')
  await expect
    .poll(() => ctx!.panel.textOf('[data-testid="build-progress-dialog"]'))
    .toContain('E2E auto-start failure')
  await expect.poll(windowState).toEqual({ total: 1, visibleBuilds: 0, visibleDashboards: 1 })
})

test('Auto start waits for onboarding to finish @macos @linux', async () => {
  ctx = await launchApp(
    {
      settings: {
        firstUseCompleted: false,
        telemetryEnabled: false,
        autoLaunchOnStartup: BUILD_ID
      },
      installations: [build]
    },
    { stayOnHome: true }
  )
  await ctx.panel.waitForVisible('[data-testid="setup-screen"]')
  expect(await ctx.panel.isVisible(HOME)).toBe(false)
  expect(await getIpcInvocations(ctx.app, 'run-action')).toEqual([])
  await expect.poll(windowState).toEqual({ total: 1, visibleBuilds: 0, visibleDashboards: 1 })
})
