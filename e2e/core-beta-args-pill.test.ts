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
import type { WebContentsPage } from './support/cdpPages'
import { clearRunningSessions, seedRunningSession } from './support/devHooks'
import {
  expectAnsweredWithNoPill,
  MANAGE,
  MENU,
  openStartupArgs as openArgsFor,
  PILL,
} from './support/betaArgsPill'
import { opsFlagsGrantSeed } from './support/fakeComfyInstall'

test.describe.configure({ mode: 'serial' })

const INSTALL_ID = 'inst-beta-args-pill'
const INSTALL_NAME = 'Beta Args Install'
const MARKER_FILENAME = '.comfyui-desktop-2'


let ctx: AppContext
let installPath: string
let previousPosthogHost: string | undefined
/** Keeps telemetry, which the opt-in needs, from leaving the machine. */
const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'
/** macOS resolves the app's config dir to Electron's real userData, which ignores the harness's
 *  isolated home, so an ops-flag seed there would stay in the real profile after the run. */
const SEEDS_OPS_FLAGS = process.platform !== 'darwin'

test.beforeAll(async () => {
  // Launching the app can run well past the 45s default on a loaded machine.
  test.setTimeout(120_000)
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-beta-args-e2e-'))
  await mkdir(installPath, { recursive: true })
  await writeFile(path.join(installPath, MARKER_FILENAME), INSTALL_ID)
  previousPosthogHost = process.env['POSTHOG_HOST']
  process.env['POSTHOG_HOST'] = UNREACHABLE_POSTHOG_HOST
  ctx = await launchApp({
    // Opted in, with a grant this install's version qualifies for, so the only thing keeping the
    // stopped pill away is that its next launch cannot be predicted.
    settings: { firstUseCompleted: true, telemetryEnabled: true, betaFeaturesEnabled: true },
    installations: [
      {
        id: INSTALL_ID,
        name: INSTALL_NAME,
        installPath,
        sourceId: 'standalone',
        status: 'installed',
        comfyVersion: {
          commit: 'b1c2d3e4f5a6b1c2d3e4f5a6b1c2d3e4f5a6b1c2',
          baseTag: 'v0.3.99',
          commitsAhead: 0,
          baseTagVerified: true,
        },
      },
    ],
    opsFlags: SEEDS_OPS_FLAGS
      ? opsFlagsGrantSeed({ arg: '--enable-assets', minCoreVersion: '0.3.80' })
      : undefined,
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  if (ctx) await clearRunningSessions(ctx.app).catch(() => {})
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (previousPosthogHost === undefined) delete process.env['POSTHOG_HOST']
  else process.env['POSTHOG_HOST'] = previousPosthogHost
})

const openStartupArgs = (): Promise<WebContentsPage> =>
  openArgsFor(ctx.app, ctx.panel, INSTALL_ID)

// This fixture has no interpreter, so the settings view's schema discovery fails and the next-launch
// preview (which only reads a cached schema) cannot be computed: the pill must stay away rather than
// guess. The predictable stopped case is `core-beta-args-pill-stopped.test.ts`. Not on macOS: without
// the grant seed there, no pill would be expected anyway.
test('a stopped install whose next launch cannot be predicted shows no beta pill @windows @linux', async () => {
  const popup = await openStartupArgs()
  await expectAnsweredWithNoPill(popup, 'a stopped install with no launch command showed a pill')
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
