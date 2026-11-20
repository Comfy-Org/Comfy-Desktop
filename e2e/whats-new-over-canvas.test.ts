import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { keepOnlyComfyHostWindow } from './support/comfyHostWindow'
import { launchApp, type AppContext } from './launchApp'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { isPopupVisible, titlePopupPage, waitForWebContents } from './support/cdpPages'
import { reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'

const INSTALL_NAME = "What's New Fixture"
const BELL = '.title-announcement-button'

let ctx: AppContext
let installPath: string
let port = 0

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-whats-new-'))
  port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })
  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: 'inst-whats-new',
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
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

async function panelViewVisible(): Promise<boolean> {
  return await ctx.app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      for (const view of window.contentView.children) {
        const webContents = (view as unknown as { webContents?: Electron.WebContents }).webContents
        if (webContents?.getURL().includes('panel.html')) return view.getVisible()
      }
    }
    return false
  })
}

test("the bell opens the What's new menu over the live canvas and leaves the canvas showing @linux @macos", async () => {
  await clickInstallTile(ctx.panel, INSTALL_NAME)
  await ctx.panel.waitFor(
    async () =>
      (await ctx.app.evaluate(
        ({ webContents }, p) =>
          webContents.getAllWebContents().some((wc) => wc.getURL().includes(String(p))),
        port
      )) === true,
    { timeout: 90_000, message: 'the ComfyUI stub never came up' }
  )
  await keepOnlyComfyHostWindow(ctx.app)
  await expect.poll(panelViewVisible, { timeout: 30_000 }).toBe(false)
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html', 10_000)

  expect(await ctx.titleBar.click(BELL)).toBe(true)

  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), { timeout: 5_000 })
    .toBe(true)
  await expect.poll(() => titlePopupPage(ctx.app).allText('li.item')).toEqual(['Take the tour'])
  expect(await panelViewVisible()).toBe(false)
})
