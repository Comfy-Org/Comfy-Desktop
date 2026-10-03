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
  isPopupVisible,
  titlePopupPage,
  TITLE_REOPEN_SUPPRESSION_MS,
  waitForWebContents,
  type WebContentsPage,
} from './support/cdpPages'
import { opsFlagsGrantSeed, reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'
import { byTestId, TID } from './support/testIds'
import {
  commitArgs,
  expectAnsweredWithNoPill,
  ARGS_FIELD,
  MANAGE,
  MENU,
  notePillAnswers,
  openStartupArgs as openArgsFor,
  PILL,
  pillLabel,
} from './support/betaArgsPill'

test.describe.configure({ mode: 'serial' })

const INSTALL_ID = 'inst-beta-args-stopped'
/** Listed first, with the same Startup Arguments, so a return to the wrong install is visible. */
const DECOY_ID = 'inst-beta-args-decoy'
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
        id: DECOY_ID,
        name: 'Decoy Fixture',
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

/** The beta opt-in switch's state in Desktop Settings. */
function betaSwitchChecked(popup: WebContentsPage): Promise<string | null> {
  return popup.evaluate<string | null>(
    `document.querySelector(${JSON.stringify(BETA_SWITCH)})?.getAttribute('aria-checked') ?? null`,
  )
}

test('turning the beta opt-in off removes the pill on the next open, and on restores it @linux', async () => {
  let popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
  await popup.clickUntilVisible(PILL, MANAGE, { timeout: 10_000 })
  expect(await popup.click(MANAGE)).toBe(true)
  await popup.waitForVisible(BETA_SWITCH, { timeout: 10_000 })
  const checked = (): Promise<string | null> => betaSwitchChecked(popup)
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

/** The install whose settings the picker is showing. */
async function shownInstallId(popup: WebContentsPage): Promise<string | null> {
  return popup.evaluate<string | null>(
    `document.querySelector(${JSON.stringify(byTestId(TID.pickerSettingsSections))})?.getAttribute('data-install-id') ?? null`,
  )
}

/** Press Escape in the title popup, the same path a user's key takes. */
async function pressEscape(popup: WebContentsPage): Promise<void> {
  await popup.evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`,
  )
}

/** Click the dimmed backdrop behind the title popup, as a click outside it would. */
async function clickBackdrop(): Promise<void> {
  await ctx.app.evaluate(({ webContents }) => {
    const wc = webContents
      .getAllWebContents()
      // The title popup's backdrop, by the dismiss channel in its inline script.
      .find((w) => w.getURL().includes('comfy-popup-backdrop'))
    if (!wc) throw new Error('no popup backdrop')
    return wc.executeJavaScript(
      `document.getElementById('s').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`,
    )
  })
}

test('a backdrop click on Desktop Settings opened from Manage returns to Startup Arguments @linux', async () => {
  // Opened on the decoy, then switched in the picker: the return goes to the install selected when
  // Manage was clicked, not the one the picker opened on.
  const popup = await openArgsFor(ctx.app, ctx.panel, DECOY_ID)
  expect(await popup.clickByText('[role="option"]', 'Stopped Beta Fixture')).toBe(true)
  await popup.waitFor(async () => (await shownInstallId(popup)) === INSTALL_ID, { timeout: 10_000 })
  await popup.waitForVisible(PILL, { timeout: 10_000 })
  await popup.clickUntilVisible(PILL, MANAGE, { timeout: 10_000 })
  expect(await popup.click(MANAGE)).toBe(true)
  await popup.waitForVisible(BETA_SWITCH, { timeout: 10_000 })
  // Past the guard that ignores a backdrop click landing in the same instant as the open.
  await new Promise((resolve) => setTimeout(resolve, 500))
  await clickBackdrop()
  await popup.waitForVisible(`${byTestId(TID.pickerSettingsSections)} ${PILL}`, { timeout: 10_000 })
  expect(await isPopupVisible(ctx.app, 'comfyTitlePopup.html')).toBe(true)
  expect(await shownInstallId(popup)).toBe(INSTALL_ID)
  await closeTitlePopupIfOpen(ctx.app)
})

test('closing Desktop Settings opened from Manage returns to Startup Arguments @linux', async () => {
  const popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
  await popup.clickUntilVisible(PILL, MANAGE, { timeout: 10_000 })
  expect(await popup.click(MANAGE)).toBe(true)
  await popup.waitForVisible(BETA_SWITCH, { timeout: 10_000 })
  const checked = (): Promise<string | null> => betaSwitchChecked(popup)
  expect(await popup.click(BETA_SWITCH)).toBe(true)
  await popup.waitFor(async () => (await checked()) === 'false', { timeout: 5_000 })

  await notePillAnswers(popup)
  await pressEscape(popup)

  // Back on the same install's Startup Arguments, and the pill reflects the opt-out.
  await popup.waitForVisible(`${byTestId(TID.pickerSettingsSections)} ${ARGS_FIELD} .ui-input`, {
    timeout: 10_000,
  })
  expect(await isPopupVisible(ctx.app, 'comfyTitlePopup.html')).toBe(true)
  expect(await shownInstallId(popup)).toBe(INSTALL_ID)
  await expectAnsweredWithNoPill(popup, 'the pill survived an opt-out made from Manage')

  await ctx.panel.evaluate(`window.api.setSetting('betaFeaturesEnabled', true)`)
  await closeTitlePopupIfOpen(ctx.app)
})

test('closing Desktop Settings opened any other way just closes it @linux', async () => {
  // Desktop Settings from Manage is still showing, with its return target set, when the panel
  // opens Desktop Settings over it: that open must not inherit the target.
  const picker = await openStartupArgs()
  await picker.waitForVisible(PILL, { timeout: 10_000 })
  await picker.clickUntilVisible(PILL, MANAGE, { timeout: 10_000 })
  expect(await picker.click(MANAGE)).toBe(true)
  await picker.waitForVisible(BETA_SWITCH, { timeout: 10_000 })

  await ctx.panel.evaluate(`window.api.openGlobalSettings('general')`)
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(BETA_SWITCH, { timeout: 10_000 })
  await pressEscape(popup)
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200],
    })
    .toBe(false)
})

test("adding the grant's opposite to the startup args removes it @linux", async () => {
  const popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
  await notePillAnswers(popup)
  await commitArgs(popup, `--port ${port} --disable-assets`)
  await expectAnsweredWithNoPill(popup, 'the overridden grant was still shown after the args were committed')
})
