import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { WebContentsPage } from './support/cdpPages'
import {
  opsFlagsGrantSeed,
  reserveFreePort,
  writeFakeComfyInstall
} from './support/fakeComfyInstall'
import { captureHostWindow } from './support/windowCapture'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

const INSTALL_ID = 'inst-beta-notice-named'
const INSTALL_NAME = 'Named Beta Fixture'
const GRANT_ARG = '--enable-asset-hashing'
const GRANT_MIN_CORE = '0.3.80'
const FEATURE_NAME = 'Asset hashing'

let ctx: AppContext
let installPath: string
let port: number
let previousPosthogHost: string | undefined

const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'

function coachmarkPopup(app: ElectronApplication): WebContentsPage {
  return new WebContentsPage(app, 'comfyTitleTooltip')
}

test.beforeAll(async () => {
  previousPosthogHost = process.env['POSTHOG_HOST']
  process.env['POSTHOG_HOST'] = UNREACHABLE_POSTHOG_HOST

  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-beta-notice-named-'))
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
          commit: 'b1c2d3e4f5a6b1c2d3e4f5a6b1c2d3e4f5a6b1c2',
          baseTag: 'v0.3.99',
          commitsAhead: 0,
          baseTagVerified: true
        }
      }
    ],
    opsFlags: opsFlagsGrantSeed({
      arg: GRANT_ARG,
      minCoreVersion: GRANT_MIN_CORE,
      description: FEATURE_NAME
    })
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (previousPosthogHost === undefined) delete process.env['POSTHOG_HOST']
  else process.env['POSTHOG_HOST'] = previousPosthogHost
})

test('a payload-supplied feature name reaches the card @linux', async () => {
  await clickInstallTile(ctx.panel, INSTALL_NAME)

  await ctx.panel.waitFor(
    async () =>
      (await ctx.app.evaluate(
        ({ webContents }, port) =>
          webContents.getAllWebContents().some((wc) => wc.getURL().includes(String(port))),
        port
      )) === true,
    { timeout: 90_000, message: 'ComfyUI stub never came up / the host never attached' }
  )

  const popup = coachmarkPopup(ctx.app)
  await popup.waitFor(
    async () => {
      try {
        return await popup.exists('.coachmark')
      } catch {
        return false
      }
    },
    { timeout: 30_000, message: 'beta activation notice never appeared' }
  )

  expect(await popup.textOf('.coachmark-title')).toBe(`The ${FEATURE_NAME} beta is on`)
  expect(await popup.textOf('.coachmark-text')).toContain(FEATURE_NAME)
  expect(await popup.textOf('.coachmark-action')).toBe('Settings')
  expect(await popup.textOf('.coachmark-text')).not.toContain(GRANT_ARG)

  const shotPath = path.join(test.info().outputDir, '03-notice-named-by-payload.png')
  await mkdir(path.dirname(shotPath), { recursive: true })
  const shot = await captureHostWindow(ctx.app, ctx.panel, shotPath)
  test.info().attach('named notice', { path: shot, contentType: 'image/png' })
})
