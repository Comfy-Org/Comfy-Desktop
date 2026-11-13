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

const INSTALL_ID = 'inst-beta-notice-firstrun'
const INSTALL_NAME = 'Beta Notice Fixture'
let port = 0
const GRANT_ARG = '--enable-asset-hashing'
const GRANT_MIN_CORE = '0.3.80'

let ctx: AppContext
let installPath: string

function buildWindowCoachmark(app: ElectronApplication): WebContentsPage {
  return new WebContentsPage(app, 'comfyTitleTooltip', `:${port}`)
}

const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'
let previousPosthogHost: string | undefined

test.beforeAll(async () => {
  previousPosthogHost = process.env['POSTHOG_HOST']
  process.env['POSTHOG_HOST'] = UNREACHABLE_POSTHOG_HOST

  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-beta-notice-firstrun-'))
  port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })

  ctx = await launchApp({
    settings: {
      firstUseCompleted: true,
      telemetryEnabled: true,
      betaFeaturesEnabled: true
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

test('first run: with no pill hint to wait for, the beta card draws in the build window @linux', async () => {
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

  const popup = buildWindowCoachmark(ctx.app)
  await popup.waitFor(
    async () => {
      try {
        return (await popup.textOf('.coachmark-title')) === 'A beta feature is on'
      } catch {
        return false
      }
    },
    { timeout: 30_000, message: 'beta notice never drew on a first run' }
  )

  expect(await popup.textOf('.coachmark-text')).not.toContain(GRANT_ARG)
  expect(await popup.textOf('.coachmark-action')).toBe('Settings')
})
