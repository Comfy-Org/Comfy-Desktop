import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'
import { evalWithRetry } from './support/evalRetry'
import { titlePopupPage, waitForWebContents } from './support/cdpPages'
import { openPickerInWindow } from './support/chooserHelpers'
import { byTestId, TID } from './support/testIds'

const STOPPED_ID = 'inst-stop-window'
const RUNNING_ID = 'inst-keep-window'
const HOME = '[data-testid="home-view"]'

let ctx: AppContext
let fixturePath: string
let stoppedPort: number
let runningPort: number

function card(id: string): string {
  return `[data-testid="home-build"][data-build-id="${id}"]`
}

async function openStopConfirmation(): Promise<void> {
  expect(await ctx.panel.click(`${card(STOPPED_ID)} [data-testid="home-build-more"]`)).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="build-menu-stop"]')
  expect(await ctx.panel.click('[data-testid="build-menu-stop"]')).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction))
}

function windowState() {
  return evalWithRetry(() =>
    ctx.app.evaluate(
      ({ BrowserWindow, WebContentsView }, ports) => {
        const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
        const hostsPort = (win: Electron.BrowserWindow, port: number): boolean =>
          win.contentView.children.some(
            (view) =>
              view instanceof WebContentsView &&
              view.webContents.getURL().startsWith(`http://127.0.0.1:${port}/`)
          )
        return {
          total: windows.length,
          stoppedBuild: windows.filter((win) => hostsPort(win, ports.stopped)).map((win) => win.id),
          runningBuild: windows.filter((win) => hostsPort(win, ports.running)).map((win) => win.id)
        }
      },
      { stopped: stoppedPort, running: runningPort }
    )
  )
}

test.beforeAll(async () => {
  fixturePath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-stop-window-'))
  stoppedPort = await reserveFreePort()
  runningPort = await reserveFreePort()
  const builds = [
    { id: STOPPED_ID, name: 'Stop this build', port: stoppedPort },
    { id: RUNNING_ID, name: 'Keep this build', port: runningPort }
  ]
  for (const build of builds) {
    await writeFakeComfyInstall({ installPath: path.join(fixturePath, build.id), port: build.port })
  }
  ctx = await launchApp(
    {
      settings: {
        firstUseCompleted: true,
        telemetryEnabled: false,
        hideCloudFromPicker: true,
        warnBeforeRunningMultipleInstances: false,
        confirmBeforeClosingWindow: true
      },
      installations: builds.map((build) => ({
        id: build.id,
        name: build.name,
        sourceId: 'comfybuilder',
        installPath: path.join(fixturePath, build.id),
        status: 'installed',
        launchArgs: `--port ${build.port}`,
        launchMode: 'window',
        browserPartition: 'unique',
        seen: true
      }))
    },
    { stayOnHome: true }
  )
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (fixturePath) await rm(fixturePath, { recursive: true, force: true })
})

test('Home Stop closes only the confirmed build window after stopping ComfyUI @macos @linux', async () => {
  test.setTimeout(180_000)
  for (const id of [STOPPED_ID, RUNNING_ID]) {
    await ctx.panel.waitForVisible(card(id))
    expect(await ctx.panel.click(card(id))).toBe(true)
    await expect
      .poll(() => ctx.panel.textOf(`${card(id)} [data-testid="home-build-status"]`), {
        timeout: 90_000
      })
      .toContain('Running')
  }
  await expect.poll(windowState, { timeout: 30_000 }).toMatchObject({
    total: 3,
    stoppedBuild: [expect.any(Number)],
    runningBuild: [expect.any(Number)]
  })
  const before = await windowState()

  await test.step('Cancel preserves both running builds and their windows', async () => {
    await openStopConfirmation()
    expect(await ctx.panel.textOf('.base-alert-message-text')).toBe(
      'This will stop ComfyUI. Any unsaved work will be lost.'
    )
    expect(await ctx.panel.click(byTestId(TID.baseAlertCancel))).toBe(true)
    await ctx.panel.waitFor(async () => !(await ctx.panel.isVisible(byTestId(TID.baseAlertAction))))
    expect(await windowState()).toEqual(before)
    expect((await fetch(`http://127.0.0.1:${stoppedPort}/queue`)).ok).toBe(true)
    expect((await fetch(`http://127.0.0.1:${runningPort}/queue`)).ok).toBe(true)
  })

  await test.step('Confirm stops the selected server and closes its window without another prompt', async () => {
    await openStopConfirmation()
    expect(await ctx.panel.click(byTestId(TID.baseAlertAction))).toBe(true)
    await expect.poll(windowState, { timeout: 30_000 }).toEqual({
      total: 2,
      stoppedBuild: [],
      runningBuild: before.runningBuild
    })
    await expect
      .poll(async () => {
        try {
          await fetch(`http://127.0.0.1:${stoppedPort}/queue`)
          return true
        } catch {
          return false
        }
      })
      .toBe(false)
    expect((await fetch(`http://127.0.0.1:${runningPort}/queue`)).ok).toBe(true)
    expect(await ctx.panel.isVisible(HOME)).toBe(true)
    await expect
      .poll(() => ctx.panel.textOf(`${card(STOPPED_ID)} [data-testid="home-build-status"]`))
      .toContain('Ready')
    expect(
      await ctx.panel.textOf(`${card(RUNNING_ID)} [data-testid="home-build-status"]`)
    ).toContain('Running')
  })

  await test.step('The build-settings popup also stops and closes its selected build', async () => {
    await ctx.panel.evaluate(
      `window.api.openInstancePicker({ installationId: '${RUNNING_ID}', initialTab: 'settings' })`
    )
    await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
    const popup = titlePopupPage(ctx.app)
    await popup.waitForVisible(byTestId(TID.pickerMoreTrigger))
    await popup.clickUntilVisible(
      byTestId(TID.pickerMoreTrigger),
      byTestId(TID.pinBottomAction('stop'))
    )
    expect(await popup.click(byTestId(TID.pinBottomAction('stop')))).toBe(true)
    await popup.waitForVisible(byTestId(TID.baseAlertAction))
    expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)

    await expect.poll(windowState, { timeout: 30_000 }).toEqual({
      total: 1,
      stoppedBuild: [],
      runningBuild: []
    })
    expect(await ctx.panel.isVisible(HOME)).toBe(true)
    await expect
      .poll(() => ctx.panel.textOf(`${card(RUNNING_ID)} [data-testid="home-build-status"]`))
      .toContain('Ready')
  })
})

test('Stop in the only Desktop window shows the dashboard there and keeps Desktop open @macos @linux', async () => {
  test.setTimeout(180_000)
  await ctx.panel.waitForVisible(card(STOPPED_ID))
  expect(await ctx.panel.click(card(STOPPED_ID))).toBe(true)
  await expect
    .poll(windowState, { timeout: 90_000 })
    .toMatchObject({ total: 2, stoppedBuild: [expect.any(Number)], runningBuild: [] })
  const [buildWindowId] = (await windowState()).stoppedBuild

  await test.step('Closing Home leaves the build window as the only Desktop window', async () => {
    await evalWithRetry(() =>
      ctx.app.evaluate(({ BrowserWindow }, keepId) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed() && win.id !== keepId) win.close()
        }
      }, buildWindowId)
    )
    await expect
      .poll(windowState, { timeout: 30_000 })
      .toEqual({ total: 1, stoppedBuild: [buildWindowId], runningBuild: [] })
  })

  await test.step('Confirming Stop in the build settings stops ComfyUI and shows the dashboard in the same window', async () => {
    const popup = await openPickerInWindow(ctx.app, ctx.titleBar)
    await popup.waitForVisible(byTestId(TID.pickerMoreTrigger))
    await popup.clickUntilVisible(
      byTestId(TID.pickerMoreTrigger),
      byTestId(TID.pinBottomAction('stop'))
    )
    expect(await popup.click(byTestId(TID.pinBottomAction('stop')))).toBe(true)
    await popup.waitForVisible(byTestId(TID.baseAlertAction))
    expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)

    await expect
      .poll(windowState, { timeout: 30_000 })
      .toEqual({ total: 1, stoppedBuild: [], runningBuild: [] })
    await waitForWebContents(ctx.app, 'panel.html')
    await ctx.panel.waitFor(
      async () => (await ctx.panel.isVisible(HOME)) || (await ctx.panel.isVisible('.chooser-view'))
    )
    const openWindowIds = await evalWithRetry(() =>
      ctx.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .filter((win) => !win.isDestroyed())
          .map((win) => win.id)
      )
    )
    expect(openWindowIds, 'Desktop keeps the window the build was in').toEqual([buildWindowId])
    await expect
      .poll(async () => {
        try {
          await fetch(`http://127.0.0.1:${stoppedPort}/queue`)
          return true
        } catch {
          return false
        }
      })
      .toBe(false)
  })
})
