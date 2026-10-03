/**
 * Beta-args pill for a STOPPED install — instance-picker Settings › Startup Args.
 *
 * While stopped, the pill shows the grants the install is eligible for at its next launch. Main decides
 * them with the launch's own pure function, fed only inputs it can read without side effects: the
 * seeded grant payload, the record's Core version, the user's args, and the args schema the
 * settings view itself discovers (the fake install answers `--help`). The pill therefore appears
 * only once that discovery has cached the schema, after which the pill asks again.
 *
 * The pill asks for its data itself, so the last case also pins what does NOT ask: a settings
 * edit to another field, and the sections re-read it triggers.
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
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'
import {
  commitArgs,
  expectAnsweredWithNoPill,
  MANAGE,
  MENU,
  openStartupArgs as openArgsFor,
  PILL,
  pillLabel,
} from './support/betaArgsPill'

test.describe.configure({ mode: 'serial' })

const INSTALL_ID = 'inst-beta-args-stopped'
const BETA_SWITCH = '.global-settings [data-field-id="betaFeaturesEnabled"] button[role="switch"]'
/** Keeps telemetry (needed so the opt-in can be turned back on) from leaving the machine. */
const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'

let ctx: AppContext
let installPath: string
let port: number
let previousPosthogHost: string | undefined

test.beforeAll(async () => {
  // Launching the app can run well past the 45s default on a loaded machine.
  test.setTimeout(120_000)
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

const openStartupArgs = (): Promise<WebContentsPage> =>
  openArgsFor(ctx.app, ctx.panel, INSTALL_ID)

test('shows the grants the next launch is eligible for @linux', async () => {
  const popup = await openStartupArgs()
  // First open: the field's own schema discovery fills the cache, then the pill asks again.
  await popup.waitForVisible(PILL, { timeout: 15_000 })
  expect(await pillLabel(popup)).toBe(
    '1 beta argument eligible for the next launch, show details',
  )
  await popup.clickUntilVisible(PILL, MENU, { timeout: 10_000 })
  const text = await popup.evaluate<string>(
    `document.querySelector(${JSON.stringify(MENU)}).textContent`,
  )
  expect(text).toContain('Eligible for next launch')
  expect(text).toContain('--enable-assets')
  expect(text).toContain('Asset library')
})

test('turning the beta opt-in off removes the pill on the next open, and on restores it @linux', async () => {
  let popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
  await popup.clickUntilVisible(PILL, MANAGE, { timeout: 10_000 })
  expect(await popup.click(MANAGE)).toBe(true)
  await popup.waitForVisible(BETA_SWITCH, { timeout: 10_000 })
  const checked = (): Promise<string | null> =>
    popup.evaluate<string | null>(
      `document.querySelector(${JSON.stringify(BETA_SWITCH)})?.getAttribute('aria-checked') ?? null`,
    )
  expect(await checked()).toBe('true')
  expect(await popup.click(BETA_SWITCH)).toBe(true)
  await popup.waitFor(async () => (await checked()) === 'false', { timeout: 5_000 })

  popup = await openStartupArgs()
  await expectAnsweredWithNoPill(popup, 'the pill survived an opt-out')

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

test('an opt-in change made while the picker is hidden shows on reopen @linux', async () => {
  let popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
  // Hidden, not swapped: the cached picker keeps its sections, which is what could go stale.
  await closeTitlePopupIfOpen(ctx.app)
  await ctx.panel.evaluate(`window.api.setSetting('betaFeaturesEnabled', false)`)

  popup = await openStartupArgs()
  await expectAnsweredWithNoPill(popup, 'the pill survived an opt-out made while the picker was hidden')

  await closeTitlePopupIfOpen(ctx.app)
  await ctx.panel.evaluate(`window.api.setSetting('betaFeaturesEnabled', true)`)
  popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
})

const betaArgsRequests = async (): Promise<number> =>
  (await getIpcInvocations(ctx.app, 'get-core-beta-args')).length

/** Fails if more than `expected` beta-args requests arrive over the next second and a half. */
async function expectNoRequestsBeyond(expected: number, message: string): Promise<void> {
  const deadline = Date.now() + 1_500
  while (Date.now() < deadline) {
    expect(await betaArgsRequests(), message).toBe(expected)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

test('only the pill asks: another field\'s save asks nothing, an args commit asks once @linux', async () => {
  const popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
  await resetIpcInvocations(ctx.app, 'get-core-beta-args')

  // Save an unrelated field through the settings UI, and wait until main has stored it.
  const PORT_CONFLICT = '[data-field-id="portConflict"] .ui-select-trigger'
  const OTHER_OPTION = '.ui-select-listbox [role="option"]:not([data-selected])'
  await popup.clickUntilVisible(PORT_CONFLICT, OTHER_OPTION, { timeout: 10_000 })
  expect(await popup.click(OTHER_OPTION)).toBe(true)
  const stored = (): Promise<unknown> =>
    ctx.panel.evaluate(
      `window.api.getInstallations().then((all) => all.find((i) => i.id === ${JSON.stringify(INSTALL_ID)})?.portConflict ?? null)`,
    )
  await expect.poll(stored, { timeout: 10_000, intervals: [100, 200] }).not.toBeNull()
  // A request would follow the save within milliseconds, so a quiet stretch after it is the answer.
  await expectNoRequestsBeyond(0, 'a save of another field asked for beta args')

  await commitArgs(popup, `--port ${port} --lowvram`)
  await expect.poll(betaArgsRequests, { timeout: 10_000, intervals: [100, 200] }).toBe(1)
  await expectNoRequestsBeyond(1, 'an args commit asked for beta args more than once')
})

test("adding the grant's opposite to the startup args removes it @linux", async () => {
  const popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
  await commitArgs(popup, `--port ${port} --disable-assets`)
  await popup.waitFor(async () => (await pillLabel(popup)) === null, {
    timeout: 10_000,
    message: 'the overridden grant was still shown after the args were committed',
  })
})
