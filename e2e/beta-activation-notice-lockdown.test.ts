/**
 * E2E: first-use lockdown must never cost the user their beta notice.
 *
 * The card's anchor is the news bell, and the bell is `v-if="!isFirstUseLockdown"`. Reading
 * only that, it looks as though a brand-new user's notice is swallowed: no anchor, no card,
 * deferred to some later launch — a whole first session running the beta unannounced, which
 * would defeat a feature whose entire purpose is informed activation plus opt-out.
 *
 * It is not swallowed, and this spec pins the two independent reasons, because both are
 * load-bearing and neither is obvious from the code that gates the bell:
 *
 *   1. The launch that ARMS the notice also ends the lockdown. Attaching an install rebuilds
 *      the panel, and main resets `firstUseMode` to `'none'` on that rebuild
 *      (`host/panelView.ts`). So the anchor is back before the card is ever raised.
 *   2. If lockdown arrives LATER — the first-use chain re-asserts `'post-consent'` after
 *      attach — the gate watcher hides the card and re-raises it on the transition back,
 *      in the same session. Hiding retires nothing, so main still holds the pending notice
 *      and the card is not spent.
 *
 * Respecting the takeover stays deliberate: nothing is drawn while onboarding owns the screen.
 * What is pinned is that the deferral is temporary rather than terminal.
 *
 * VISIBILITY IS ASKED OF MAIN, NOT THE DOM. `EmbeddedPopupView.hide()` calls
 * `popup.setVisible(false)`; the popup keeps its markup and its renderer goes on reporting
 * `document.visibilityState === 'visible'`. Both of those read as "the card is up" and both
 * are wrong, so the assertions below read `getVisible()` off the attached view instead.
 *
 * Tagged `@linux` only, for the reasons in `fakeComfyInstall.ts`'s header.
 *
 * Run: `pnpm exec playwright test --project=linux e2e/beta-activation-notice-lockdown.test.ts`
 */
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

// A real launch (args-schema spawn, port wait, attach) does not fit the default 45s budget.
test.describe.configure({ mode: 'serial', timeout: 180_000 })

const INSTALL_ID = 'inst-beta-notice-lockdown'
const INSTALL_NAME = 'Beta Notice Lockdown Fixture'
let port = 0
const GRANT_ARG = '--enable-assets'
const GRANT_MIN_CORE = '0.3.80'

let ctx: AppContext
let installPath: string

function coachmarkPopup(app: ElectronApplication): WebContentsPage {
  return new WebContentsPage(app, 'comfyTitleTooltip')
}

/** Title of whatever card the shared popup is rendering, or null when it renders none.
 *  DOM-level, so it answers "which card" — never "can the user see it". */
async function cardTitle(popup: WebContentsPage): Promise<string | null> {
  try {
    if (!(await popup.exists('.coachmark'))) return null
    return await popup.textOf('.coachmark-title')
  } catch {
    return null
  }
}

/** Whether the coachmark popup is actually on screen, read from main.
 *  `'detached'` when the view does not exist yet — distinct from attached-but-hidden. */
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

/** Positive evidence that first-use lockdown is engaged, rather than the absence of one
 *  element: the bell is also absent on hosts that never had it, so `!bell` alone would pass
 *  in a run where the mode never reached the title bar at all. */
async function lockdownEngaged(titleBar: WebContentsPage): Promise<boolean> {
  const bell = await titleBar.exists('.title-announcement-button')
  const pill = await titleBar.exists('.title-install-pill.is-interactive')
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
      // Spent deliberately: the hint-versus-notice collision is
      // `beta-activation-notice-firstrun.test.ts`'s job, and leaving it unspent here would
      // put a second claimant on the shared popup and blur which gate released the card.
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

  // Onboarding is in progress when the first launch happens — the new user's real sequence.
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

  // Armed in main: the grant cleared every gate and the notice is waiting on the renderer.
  expect(
    await ctx.titleBar.evaluate(`window.api.getPendingBetaNotice(${JSON.stringify(INSTALL_ID)})`)
  ).not.toBeNull()

  // REASON 1. The launch ended the lockdown by itself, so the anchor is back and the card is
  // raised in this session rather than waiting for a later one.
  await popup.waitFor(async () => (await cardTitle(popup)) === 'A beta feature is on', {
    timeout: 30_000,
    message: 'beta notice never drew after the launch that armed it'
  })
  expect(await popupVisible(ctx.app)).toBe(true)
  expect(await lockdownEngaged(ctx.titleBar)).toBe(false)

  // REASON 2. Lockdown arrives again while the card is up — the chain re-asserting
  // `post-consent` after attach. The card must go away with the rest of the chrome.
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

  // Hidden, never retired: main still holds it, so it is not spent.
  expect(
    await ctx.titleBar.evaluate(`window.api.getPendingBetaNotice(${JSON.stringify(INSTALL_ID)})`)
  ).not.toBeNull()

  // THE ASSERTION. Lockdown ends, and the card comes back in the SAME session — no relaunch,
  // no reload. Without the gate watcher re-attempting on the transition, it would wait for
  // the user's next launch, which is the whole session of unannounced beta this pins against.
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
