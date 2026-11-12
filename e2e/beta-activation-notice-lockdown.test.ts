import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { WebContentsPage } from './support/cdpPages'
import {
  opsFlagsGrantSeed,
  reserveFreePort,
  writeFakeComfyInstall
} from './support/fakeComfyInstall'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

const INSTALL_ID = 'inst-beta-notice-lockdown'
const INSTALL_NAME = 'Beta Notice Lockdown Fixture'
let port = 0
const GRANT_ARG = '--enable-asset-hashing'
const GRANT_MIN_CORE = '0.3.80'

let ctx: AppContext
let installPath: string

function coachmarkPopup(app: ElectronApplication): WebContentsPage {
  return new WebContentsPage(app, 'comfyTitleTooltip')
}

async function cardTitle(popup: WebContentsPage): Promise<string | null> {
  try {
    if (!(await popup.exists('.coachmark'))) return null
    return await popup.textOf('.coachmark-title')
  } catch {
    return null
  }
}

async function popupVisible(app: ElectronApplication): Promise<boolean | 'detached'> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return 'detached' as const
    const kids = (win.contentView?.children ?? []) as Array<{
      webContents?: { getURL?: () => string; isDestroyed?: () => boolean }
      getVisible?: () => boolean
    }>
    const hit = kids.find(
      (k) =>
        k.webContents &&
        !k.webContents.isDestroyed?.() &&
        (k.webContents.getURL?.() ?? '').includes('comfyTitleTooltip')
    )
    if (!hit?.getVisible) return 'detached' as const
    return hit.getVisible()
  })
}

async function lockdownEngaged(titleBar: WebContentsPage): Promise<boolean> {
  const bell = await titleBar.exists('.title-announcement-button')
  const pill = await titleBar.exists('[data-testid="title-home-tab"]')
  return !bell && !pill
}

const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'
let previousPosthogHost: string | undefined

test.beforeAll(async () => {
  previousPosthogHost = process.env['POSTHOG_HOST']
  process.env['POSTHOG_HOST'] = UNREACHABLE_POSTHOG_HOST

  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-beta-notice-lockdown-'))
  port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })

  ctx = await launchApp({
    settings: {
      firstUseCompleted: true,
      telemetryEnabled: true,
      betaFeaturesEnabled: true,
      hasSeenCentralPillHint: true
    },
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
        seen: true,
        comfyVersion: {
          commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          baseTag: 'v0.3.99',
          commitsAhead: 0,
          baseTagVerified: true
        }
      }
    ],
    opsFlags: opsFlagsGrantSeed({ arg: GRANT_ARG, minCoreVersion: GRANT_MIN_CORE })
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (previousPosthogHost === undefined) delete process.env['POSTHOG_HOST']
  else process.env['POSTHOG_HOST'] = previousPosthogHost
})

test('first-use lockdown never costs the user the beta notice @linux', async () => {
  const popup = coachmarkPopup(ctx.app)

  await ctx.panel.evaluate(`window.api.setFirstUseMode('post-consent')`)
  await ctx.titleBar.waitFor(async () => lockdownEngaged(ctx.titleBar), {
    timeout: 10_000,
    message: 'first-use lockdown never reached the title bar'
  })

  await clickInstallTile(ctx.panel, INSTALL_NAME)
  await ctx.panel.waitFor(
    async () =>
      (await ctx.app.evaluate(
        ({ webContents }, p) =>
          webContents.getAllWebContents().some((wc) => wc.getURL().includes(String(p))),
        port
      )) === true,
    { timeout: 90_000, message: 'ComfyUI stub never came up / the host never attached' }
  )

  expect(
    await ctx.titleBar.evaluate(`window.api.getPendingBetaNotice(${JSON.stringify(INSTALL_ID)})`)
  ).not.toBeNull()

  await popup.waitFor(async () => (await cardTitle(popup)) === 'A beta feature is on', {
    timeout: 30_000,
    message: 'beta notice never drew after the launch that armed it'
  })
  expect(await popupVisible(ctx.app)).toBe(true)
  expect(await lockdownEngaged(ctx.titleBar)).toBe(false)

  await ctx.panel.evaluate(`window.api.setFirstUseMode('post-consent')`)
  await ctx.titleBar.waitFor(async () => lockdownEngaged(ctx.titleBar), {
    timeout: 10_000,
    message: 'the re-asserted lockdown never reached the title bar'
  })
  await expect
    .poll(async () => popupVisible(ctx.app), {
      timeout: 15_000,
      message: 'the card stayed on screen through first-use lockdown'
    })
    .toBe(false)

  expect(
    await ctx.titleBar.evaluate(`window.api.getPendingBetaNotice(${JSON.stringify(INSTALL_ID)})`)
  ).not.toBeNull()

  await ctx.panel.evaluate(`window.api.setFirstUseMode('none')`)
  await expect
    .poll(async () => popupVisible(ctx.app), {
      timeout: 20_000,
      message: 'beta notice never came back after first-use lockdown cleared'
    })
    .toBe(true)
  expect(await cardTitle(popup)).toBe('A beta feature is on')
  expect(await popup.textOf('.coachmark-action')).toBe('Settings')
})
