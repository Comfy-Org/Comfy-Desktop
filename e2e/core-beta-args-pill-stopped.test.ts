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
  type WebContentsPage
} from './support/cdpPages'
import {
  opsFlagsGrantSeed,
  reserveFreePort,
  writeFakeComfyInstall
} from './support/fakeComfyInstall'
import { byTestId, TID } from './support/testIds'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'

test.describe.configure({ mode: 'serial' })

const INSTALL_ID = 'inst-beta-args-stopped'
const ARGS_FIELD = '[data-field-id="launchArgs"]'
const PILL = `${ARGS_FIELD} .beta-args button`
const MENU = '.beta-args-menu'
const MANAGE = `${MENU} .ui-menu-item:not([aria-disabled])`
const BETA_SWITCH = '.global-settings [data-field-id="betaFeaturesEnabled"] button[role="switch"]'
const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'

let ctx: AppContext
let installPath: string
let port: number
let previousPosthogHost: string | undefined

test.beforeAll(async () => {
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
      hasSeenCentralPillHint: true
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
          baseTagVerified: true
        }
      }
    ],
    opsFlags: opsFlagsGrantSeed({
      arg: '--enable-asset-hashing',
      minCoreVersion: '0.3.80',
      description: 'Asset hashing'
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

async function openStartupArgs(): Promise<WebContentsPage> {
  await closeTitlePopupIfOpen(ctx.app)
  await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))
  await ctx.panel.evaluate(
    `window.api.openInstancePicker({ installationId: ${JSON.stringify(INSTALL_ID)}, initialTab: 'config' })`
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(byTestId(TID.pickerSettingsSections), { timeout: 15_000 })
  await popup.waitForVisible(`${ARGS_FIELD} .ui-input`, { timeout: 10_000 })
  return popup
}

async function pillAriaLabel(popup: WebContentsPage): Promise<string | null> {
  return popup.evaluate<string | null>(
    `document.querySelector(${JSON.stringify(PILL)})?.getAttribute('aria-label') ?? null`
  )
}

async function expectNoPill(popup: WebContentsPage): Promise<void> {
  expect(await pillAriaLabel(popup)).toBeNull()
}

test('shows the grants the next launch is eligible for @linux', async () => {
  const popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 15_000 })
  expect(await pillAriaLabel(popup)).toBe(
    '1 beta argument eligible for the next launch, show details'
  )
  await popup.clickUntilVisible(PILL, MENU, { timeout: 10_000 })
  const text = await popup.evaluate<string>(
    `document.querySelector(${JSON.stringify(MENU)}).textContent`
  )
  expect(text).toContain('Eligible for next launch')
  expect(text).toContain('--enable-asset-hashing')
  expect(text).toContain('Asset hashing')
})

test('turning the beta opt-in off removes the pill on the next open, and on restores it @linux', async () => {
  let popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
  await popup.clickUntilVisible(PILL, MANAGE, { timeout: 10_000 })
  expect(await popup.click(MANAGE)).toBe(true)
  await popup.waitForVisible(BETA_SWITCH, { timeout: 10_000 })
  const checked = (): Promise<string | null> =>
    popup.evaluate<string | null>(
      `document.querySelector(${JSON.stringify(BETA_SWITCH)})?.getAttribute('aria-checked') ?? null`
    )
  expect(await checked()).toBe('true')
  expect(await popup.click(BETA_SWITCH)).toBe(true)
  await popup.waitFor(async () => (await checked()) === 'false', { timeout: 5_000 })

  popup = await openStartupArgs()
  await expectNoPill(popup)

  await closeTitlePopupIfOpen(ctx.app)
  await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))
  await ctx.panel.evaluate(
    `window.api.openGlobalSettings('general', { highlightField: 'betaFeaturesEnabled' })`
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
  await closeTitlePopupIfOpen(ctx.app)
  await ctx.panel.evaluate(`window.api.setSetting('betaFeaturesEnabled', false)`)

  popup = await openStartupArgs()
  await popup.waitFor(async () => (await pillAriaLabel(popup)) === null, {
    timeout: 10_000,
    message: 'the pill survived an opt-out made while the picker was hidden'
  })

  await closeTitlePopupIfOpen(ctx.app)
  await ctx.panel.evaluate(`window.api.setSetting('betaFeaturesEnabled', true)`)
  popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
})

const betaArgsRequests = async (): Promise<number> =>
  (await getIpcInvocations(ctx.app, 'get-core-beta-args')).length

async function commitArgs(popup: WebContentsPage, value: string): Promise<void> {
  await popup.evaluate(
    `(() => {
      const input = document.querySelector(${JSON.stringify(`${ARGS_FIELD} input`)})
      input.value = ${JSON.stringify(value)}
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`
  )
}

test("only the pill asks: another field's save asks nothing, an args commit asks once @linux", async () => {
  const popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
  await resetIpcInvocations(ctx.app, 'get-core-beta-args')

  const PORT_CONFLICT = '[data-field-id="portConflict"] .ui-select-trigger'
  const OTHER_OPTION = '.ui-select-listbox [role="option"]:not([data-state="checked"])'
  await popup.clickUntilVisible(PORT_CONFLICT, OTHER_OPTION, { timeout: 10_000 })
  expect(await popup.click(OTHER_OPTION)).toBe(true)
  const stored = (): Promise<unknown> =>
    ctx.panel.evaluate(
      `window.api.getInstallations().then((all) => all.find((i) => i.id === ${JSON.stringify(INSTALL_ID)})?.portConflict ?? null)`
    )
  await expect.poll(stored, { timeout: 10_000, intervals: [100, 200] }).not.toBeNull()
  await expect.poll(() => popup.exists(PILL), { timeout: 5_000 }).toBe(true)
  expect(await betaArgsRequests(), 'a save of another field asked for beta args').toBe(0)

  await commitArgs(popup, `--port ${port} --lowvram`)
  await expect.poll(betaArgsRequests, { timeout: 10_000, intervals: [100, 200] }).toBe(1)
  await popup.waitForVisible(PILL, { timeout: 10_000 })
  expect(await betaArgsRequests()).toBe(1)
})

test("adding the grant's opposite to the startup args removes it @linux", async () => {
  const popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 10_000 })
  await popup.evaluate(
    `(() => {
      const input = document.querySelector(${JSON.stringify(`${ARGS_FIELD} input`)})
      input.value = ${JSON.stringify(`--port ${port} --disable-asset-hashing`)}
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`
  )
  await popup.waitFor(async () => (await pillAriaLabel(popup)) === null, {
    timeout: 10_000,
    message: 'the overridden grant was still shown after the args were committed'
  })
})
