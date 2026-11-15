import { expect, type ElectronApplication } from '@playwright/test'
import { launchLauncherApp, type SeedOptions } from './support/electronHarness'
import {
  panelPage,
  titleBarPage,
  waitForWebContents,
  type WebContentsPage
} from './support/cdpPages'
import { evalWithRetry } from './support/evalRetry'
import { showBuildsPage } from './support/chooserHelpers'

async function waitForChooserWebContents(
  app: ElectronApplication,
  timeoutMs = 30_000
): Promise<void> {
  await expect
    .poll(
      () =>
        evalWithRetry(() =>
          app.evaluate(({ webContents }) => {
            const urls = webContents.getAllWebContents().map((wc) => wc.getURL())
            return {
              hasPanel: urls.some((u) => u.includes('panel.html')),
              hasTitleBar: urls.some((u) => u.includes('comfyTitleBar.html'))
            }
          })
        ).then((s) => s.hasPanel && s.hasTitleBar),
      { timeout: timeoutMs, intervals: [250, 500, 1000] }
    )
    .toBe(true)
}

export type { SeedOptions, SeedInstallation } from './support/electronHarness'

export interface AppContext {
  app: ElectronApplication
  panel: WebContentsPage
  titleBar: WebContentsPage
  homeDir: string
  cleanup: () => Promise<void>
}

export interface LaunchOptions {
  stayOnHome?: boolean
}

const HOME_VIEW = '[data-testid="home-view"]'

export async function launchApp(
  options?: SeedOptions,
  launchOptions: LaunchOptions = {}
): Promise<AppContext> {
  const { application, homeDir, cleanup: cleanupHarness } = await launchLauncherApp(options)

  await waitForChooserWebContents(application)

  await waitForWebContents(application, 'panel.html')
  await waitForWebContents(application, 'comfyTitleBar.html')

  const panel = panelPage(application)
  const titleBar = titleBarPage(application)

  await panel.waitForSelector('.panel-shell', { timeout: 30_000 })
  await panel.waitForSelector('.chooser-view, .panel-chooser, [data-testid="setup-screen"]', {
    timeout: 15_000
  })
  await titleBar.waitForSelector('.title-bar', { timeout: 15_000 })

  if (!launchOptions.stayOnHome && (await panel.isVisible(HOME_VIEW))) {
    await showBuildsPage(panel)
  }

  return {
    app: application,
    panel,
    titleBar,
    homeDir,
    cleanup: cleanupHarness
  }
}
