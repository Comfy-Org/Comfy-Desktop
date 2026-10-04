/**
 * Beta-args pill — instance-picker Settings › Startup Args.
 *
 * While an install runs, the Core beta grants on its command line are shown as a read-only
 * "+N beta" pill after the user's own args. The grants live on the main-process session record,
 * the pill asks for them itself (`get-core-beta-args`), and its "Manage beta features" swaps the
 * popup to Global Settings on the beta opt-in row.
 *
 * The session is seeded (`seedRunningSession` with `coreBetaArgs`) rather than launched: a real
 * launch needs a ComfyUI to spawn. That makes the seeded link — launch recording the applied
 * grants on the session — the one seam this spec does not cover; the launch unit tests
 * (`launch.test.ts`, "session record of the applied grants") pin it against a real
 * `handleLaunch`. Seeding happens before the picker opens because the seed, unlike a real
 * launch, does not emit the session-lifecycle change the picker refreshes on.
 */

import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
import { clearRunningSessions, seedRunningSession } from './support/devHooks'
import { byTestId, TID } from './support/testIds'

test.describe.configure({ mode: 'serial' })

const INSTALL_ID = 'inst-beta-args-pill'
const INSTALL_NAME = 'Beta Args Install'
const MARKER_FILENAME = '.comfyui-desktop-2'

const ARGS_FIELD = '[data-field-id="launchArgs"]'
const PILL = `${ARGS_FIELD} .beta-args button`
/** Teleported to <body>, so not under the field. */
const MENU = '.beta-args-menu'
const MANAGE = `${MENU} .ui-menu-item:not([aria-disabled])`

let ctx: AppContext
let installPath: string

test.beforeAll(async () => {
  // Launching the app can run well past the 45s default on a loaded machine.
  test.setTimeout(120_000)
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-beta-args-e2e-'))
  await mkdir(installPath, { recursive: true })
  await writeFile(path.join(installPath, MARKER_FILENAME), INSTALL_ID)
  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: INSTALL_ID,
        name: INSTALL_NAME,
        installPath,
        sourceId: 'standalone',
        status: 'installed',
      },
    ],
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  if (ctx) await clearRunningSessions(ctx.app).catch(() => {})
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

/** Open the picker on the install's Startup Args and wait until its args field has rendered. */
async function openStartupArgs(): Promise<WebContentsPage> {
  await closeTitlePopupIfOpen(ctx.app)
  await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))
  const opened = await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({ installationId: ${JSON.stringify(INSTALL_ID)}, initialTab: 'config' })
      return true
    })()`,
  )
  expect(opened).toBe(true)
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(byTestId(TID.pickerSettingsSections), { timeout: 15_000 })
  await popup.waitForVisible(`${ARGS_FIELD} .ui-input`, { timeout: 10_000 })
  return popup
}

// This fixture has no interpreter, so the settings view's schema discovery fails and the next-launch
// preview (which only reads a cached schema) cannot be computed: the pill must stay away rather than
// guess. The predictable stopped case is `core-beta-args-pill-stopped.test.ts`.
test('a stopped install whose next launch cannot be predicted shows no beta pill @windows @macos @linux', async () => {
  const popup = await openStartupArgs()
  // The args field is on screen (waited above), so the pill's absence is a real answer.
  expect(await popup.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(PILL)})`)).toBe(
    false,
  )
})

test('a running install shows its grants and links to the beta opt-in @windows @macos @linux', async () => {
  await seedRunningSession(ctx.app, {
    installationId: INSTALL_ID,
    installationName: INSTALL_NAME,
    coreBetaArgs: [
      { arg: '--enable-assets', name: 'Asset browser' },
      { arg: '--enable-asset-hashing', name: null },
    ],
  })
  const popup = await openStartupArgs()

  await popup.waitForVisible(PILL, { timeout: 10_000 })
  const pill = await popup.evaluate<{ text: string; expanded: string | null }>(
    `(() => {
      const el = document.querySelector(${JSON.stringify(PILL)})
      return { text: (el.textContent || '').trim(), expanded: el.getAttribute('aria-expanded') }
    })()`,
  )
  expect(pill).toEqual({ text: '+2 beta', expanded: 'false' })

  await popup.clickUntilVisible(PILL, MENU, { timeout: 10_000 })
  const rows = await popup.evaluate<string[][]>(
    `Array.from(document.querySelectorAll(${JSON.stringify(`${MENU} .ui-menu-item[aria-disabled]`)}))
      .map((row) => [
        row.querySelector('.ui-menu-item-label').textContent.trim(),
        row.querySelector('.ui-menu-item-detail').textContent.trim(),
      ])`,
  )
  expect(rows).toEqual([
    ['--enable-assets', 'Asset browser'],
    ['--enable-asset-hashing', 'Beta feature'],
  ])

  // The flash lasts ~2s, so record it as it happens rather than polling for it afterwards. The
  // popup swaps kind in place (same WebContents), so the observer survives the switch.
  await popup.evaluate(
    `(() => {
      window.__betaRowFlashed = false
      new MutationObserver(() => {
        if (document.querySelector('[data-field-id="betaFeaturesEnabled"].gs-field-flash')) {
          window.__betaRowFlashed = true
        }
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
    })()`,
  )
  expect(await popup.click(MANAGE)).toBe(true)

  await popup.waitForVisible('.global-settings [data-field-id="betaFeaturesEnabled"]', {
    timeout: 10_000,
  })
  await popup.waitFor(
    async () => (await popup.evaluate<boolean>('window.__betaRowFlashed === true')) === true,
    { timeout: 5_000, message: 'the beta opt-in row was never flashed' },
  )
})
