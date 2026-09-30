/**
 * Beta-args pill for a STOPPED install — instance-picker Settings › Startup Args.
 *
 * While stopped, the pill shows the grants the install's next launch would apply. Main computes
 * them with the launch's own resolution, fed only inputs it can read without side effects: the
 * seeded grant payload, the record's Core version, the user's args, and the args schema the
 * settings view itself discovers (the fake install answers `--help`). The pill therefore appears
 * only once that discovery has cached the schema, which the view follows with one re-read.
 *
 * Linux-only: `writeFakeComfyInstall` builds a shell-script interpreter.
 */

import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import {
  closeTitlePopupIfOpen,
  titlePopupPage,
  TITLE_REOPEN_SUPPRESSION_MS,
  waitForWebContents,
  type WebContentsPage,
} from './support/cdpPages'
import { opsFlagsGrantSeed, reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'
import { byTestId, TID } from './support/testIds'

test.describe.configure({ mode: 'serial' })

const INSTALL_ID = 'inst-beta-args-stopped'
const ARGS_FIELD = '[data-field-id="launchArgs"]'
const PILL = `${ARGS_FIELD} button.beta-args-pill`
const BETA_SWITCH = '.global-settings [data-field-id="betaFeaturesEnabled"] button[role="switch"]'
/** Keeps telemetry (needed so the opt-in can be turned back on) from leaving the machine. */
const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'

let ctx: AppContext
let installPath: string
let port: number
let previousPosthogHost: string | undefined

test.beforeAll(async () => {
  previousPosthogHost = process.env['POSTHOG_HOST']
  process.env['POSTHOG_HOST'] = UNREACHABLE_POSTHOG_HOST
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-beta-args-stopped-'))
  port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })
  ctx = await launchApp({
    settings: {
      firstUseCompleted: true,
      telemetryEnabled: true,
      betaFeaturesEnabled: true,
      hasSeenCentralPillHint: true,
    },
    installations: [
      {
        id: INSTALL_ID,
        name: 'Stopped Beta Fixture',
        sourceId: 'comfybuilder',
        sourceLabel: 'ComfyBuilder',
        installPath,
        status: 'installed',
        launchArgs: `--port ${port}`,
        seen: true,
        comfyVersion: {
          commit: 'b1c2d3e4f5a6b1c2d3e4f5a6b1c2d3e4f5a6b1c2',
          baseTag: 'v0.3.99',
          commitsAhead: 0,
          baseTagVerified: true,
        },
      },
    ],
    opsFlags: opsFlagsGrantSeed({
      arg: '--enable-assets',
      minCoreVersion: '0.3.80',
      description: 'Asset library',
    }),
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (previousPosthogHost === undefined) delete process.env['POSTHOG_HOST']
  else process.env['POSTHOG_HOST'] = previousPosthogHost
})

async function openStartupArgs(): Promise<WebContentsPage> {
  await closeTitlePopupIfOpen(ctx.app)
  await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))
  await ctx.panel.evaluate(
    `window.api.openInstancePicker({ installationId: ${JSON.stringify(INSTALL_ID)}, initialTab: 'config' })`,
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(byTestId(TID.pickerSettingsSections), { timeout: 15_000 })
  await popup.waitForVisible(`${ARGS_FIELD} .ui-input`, { timeout: 10_000 })
  return popup
}

async function pillAriaLabel(popup: WebContentsPage): Promise<string | null> {
  return popup.evaluate<string | null>(
    `document.querySelector(${JSON.stringify(PILL)})?.getAttribute('aria-label') ?? null`,
  )
}

/** Absence only counts once the view has settled: the field is up (waited by the caller) and the
 *  schema is cached, so no discovery-driven re-read is still coming. */
async function expectNoPillAfterSettling(popup: WebContentsPage): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  expect(await pillAriaLabel(popup)).toBeNull()
}

test('shows the grants the next launch would apply @linux', async () => {
  const popup = await openStartupArgs()
  // First open: the field's own schema discovery fills the cache, then the view re-reads.
  await popup.waitForVisible(PILL, { timeout: 15_000 })
  expect(await pillAriaLabel(popup)).toBe(
    '1 beta argument will be added at next launch, show details',
  )
  await popup.clickUntilVisible(PILL, `${ARGS_FIELD} .beta-args-popover`, { timeout: 10_000 })
  const text = await popup.evaluate<string>(
    `document.querySelector(${JSON.stringify(`${ARGS_FIELD} .beta-args-popover`)}).textContent`,
  )
  expect(text).toContain('Will be added at next launch by beta features')
  expect(text).toContain('--enable-assets')
  expect(text).toContain('Asset library')
})

test('turning the beta opt-in off removes the pill on the next open, and on restores it @linux', async () => {
  let popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
  await popup.clickUntilVisible(PILL, `${ARGS_FIELD} .beta-args-manage`, { timeout: 10_000 })
  expect(await popup.click(`${ARGS_FIELD} .beta-args-manage`)).toBe(true)
  await popup.waitForVisible(BETA_SWITCH, { timeout: 10_000 })
  const checked = (): Promise<string | null> =>
    popup.evaluate<string | null>(
      `document.querySelector(${JSON.stringify(BETA_SWITCH)})?.getAttribute('aria-checked') ?? null`,
    )
  expect(await checked()).toBe('true')
  expect(await popup.click(BETA_SWITCH)).toBe(true)
  await popup.waitFor(async () => (await checked()) === 'false', { timeout: 5_000 })

  popup = await openStartupArgs()
  await expectNoPillAfterSettling(popup)

  await closeTitlePopupIfOpen(ctx.app)
  await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))
  await ctx.panel.evaluate(
    `window.api.openGlobalSettings('general', { highlightField: 'betaFeaturesEnabled' })`,
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(BETA_SWITCH, { timeout: 10_000 })
  expect(await popup.click(BETA_SWITCH)).toBe(true)
  await popup.waitFor(async () => (await checked()) === 'true', { timeout: 5_000 })

  popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
})

test("adding the grant's opposite to the startup args removes it @linux", async () => {
  const popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
  // Commit through the input's own change event, as a blur would.
  await popup.evaluate(
    `(() => {
      const input = document.querySelector(${JSON.stringify(`${ARGS_FIELD} input`)})
      input.value = ${JSON.stringify(`--port ${port} --disable-assets`)}
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`,
  )
  await popup.waitFor(async () => (await pillAriaLabel(popup)) === null, {
    timeout: 10_000,
    message: 'the overridden grant was still shown after the args were committed',
  })
})
