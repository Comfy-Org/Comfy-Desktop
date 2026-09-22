/**
 * E2E: the Core beta activation notice, end to end through a real launch.
 *
 * Every gate the notice depends on is exercised for real here rather than stubbed:
 *
 *   - the grant arrives the way a returning user's does, from `ops-flags.json` (PostHog is
 *     unreachable under the harness, so `coreBetaGrants` falls back to the persisted value);
 *   - it clears the version window against the seeded `comfyVersion`;
 *   - it clears the running core's args schema, parsed from a real `main.py --help` spawn;
 *   - the launch spawns, the stub serves, the boot wait succeeds and the window attaches;
 *   - only then does the title bar drain the pending notice and raise the card.
 *
 * The card lives in its own WebContentsView, so assertions go through the popup's webContents
 * and the screenshots come from `BrowserWindow.capturePage()` — the whole host window,
 * chrome and canvas and floating card together, which is the thing a reviewer needs to see.
 *
 * Tagged `@linux` only — the fixture cannot run on Windows (no PE interpreter stub) or macOS
 * (nothing isolates `userData`, so the ops-flag seed would hit the real profile). Both reasons
 * are spelled out in `fakeComfyInstall.ts`'s header.
 *
 * Run: `pnpm exec playwright test --project=linux e2e/beta-activation-notice.test.ts`
 * Screenshots go to Playwright's own output dir and are attached to the report, not written
 * into the repo.
 */
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { WebContentsPage, titlePopupPage } from './support/cdpPages'
import {
  opsFlagsGrantSeed,
  reserveFreePort,
  writeFakeComfyInstall,
} from './support/fakeComfyInstall'
import { captureHostWindow } from './support/windowCapture'

// A real launch (args-schema spawn, port wait, attach) does not fit the default 45s budget.
test.describe.configure({ mode: 'serial', timeout: 180_000 })

const INSTALL_ID = 'inst-beta-notice'
const INSTALL_NAME = 'Beta Notice Fixture'
/** Chosen at run time rather than hard-coded: a constant collides with whatever else happens
 *  to be on the machine, and this repo does not tolerate flaky tests. Passed explicitly in
 *  `launchArgs` so the launcher's port-conflict auto-shift cannot move it afterwards. */
let port = 0
/** The grant under test. `--enable-assets` is on the real allowlist and the stub's `--help`
 *  advertises it, so it survives selection AND the schema filter. */
const GRANT_ARG = '--enable-assets'
/** Comfortably below the seeded `baseTag`, so the version window opens. */
const GRANT_MIN_CORE = '0.3.80'


let ctx: AppContext
let installPath: string

/** The coachmark popup, addressed by the card it is currently rendering. The hover-tooltip
 *  popup shares the same HTML entry point, so a URL marker alone could resolve to either;
 *  matching on `.coachmark` picks the one showing a card. */
function coachmarkPopup(app: ElectronApplication): WebContentsPage {
  return new WebContentsPage(app, 'comfyTitleTooltip')
}

/** The whole host window, every view composited — not a per-view crop, because the claim
 *  being evidenced is that the card floats OVER live ComfyUI.
 *
 *  Written under Playwright's per-test output dir, never into the repo: these are generated
 *  artifacts, and `.gitignore` already excludes every other one. `attach` puts them in the HTML
 *  report, which CI uploads. */
async function captureWindow(app: ElectronApplication, name: string): Promise<string> {
  const file = path.join(test.info().outputDir, `${name}.png`)
  await mkdir(path.dirname(file), { recursive: true })
  return captureHostWindow(app, ctx.panel, file)
}

/** PostHog's own value for the flag wins over the persisted one, and a live fetch would make
 *  this run depend on a real project's flag state. Pointing the SDK at a closed port makes the
 *  fetch `unreachable`, which is the documented path where `ops-flags.json` is authoritative —
 *  the same path an offline launch takes for a user who already has the grant. */
const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'
let previousPosthogHost: string | undefined

test.beforeAll(async () => {
  previousPosthogHost = process.env['POSTHOG_HOST']
  process.env['POSTHOG_HOST'] = UNREACHABLE_POSTHOG_HOST

  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-beta-notice-'))
  port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })

  ctx = await launchApp({
    settings: {
      firstUseCompleted: true,
      // Beta grants are gated on the opt-in, which is itself gated on consent.
      telemetryEnabled: true,
      betaFeaturesEnabled: true,
      // Spend the onboarding pill hint up front. Both cards share one popup per window, and
      // the hint wins when they collide — which is correct behaviour, and covered by a unit
      // test, but it would make this run assert the wrong card.
      hasSeenCentralPillHint: true,
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
        // What the version gate reads. `commitsAhead: 0` makes the tag exact and
        // `baseTagVerified` makes it ancestry-established; without both, the grant is refused.
        comfyVersion: {
          commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          baseTag: 'v0.3.99',
          commitsAhead: 0,
          baseTagVerified: true,
        },
      },
    ],
    // Delivered through `E2E_OPS_FLAGS_SEED` so main writes it to the real `configDir()`
    // before its first read — the harness cannot place that file on macOS, where `userData`
    // ignores the HOME override. Present from the app's first boot, which is how a returning
    // user's already-granted flag actually arrives.
    opsFlags: opsFlagsGrantSeed({ arg: GRANT_ARG, minCoreVersion: GRANT_MIN_CORE }),
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (previousPosthogHost === undefined) delete process.env['POSTHOG_HOST']
  else process.env['POSTHOG_HOST'] = previousPosthogHost
})

test('a first beta activation raises a nonblocking notice over live ComfyUI @linux', async () => {
  await clickInstallTile(ctx.panel, INSTALL_NAME)

  // The grant reaches the real command line, not just the selection step: this is what the
  // notice is claiming happened, so it is asserted from the launch's own output rather than
  // inferred from the card being up.
  await ctx.panel.waitFor(
    async () =>
      (await ctx.app.evaluate(
        ({ webContents }, p) =>
          webContents.getAllWebContents().some((wc) => wc.getURL().includes(String(p))),
        port,
      )) === true,
    { timeout: 90_000, message: 'ComfyUI stub never came up / the host never attached' },
  )

  const popup = coachmarkPopup(ctx.app)
  await popup.waitFor(
    async () => {
      try {
        return await popup.exists('.coachmark')
      } catch {
        // The popup view is created lazily, so "not found" is a normal pre-show state.
        return false
      }
    },
    { timeout: 30_000, message: 'beta activation notice never appeared' },
  )

  expect(await popup.textOf('.coachmark-title')).toBe('A beta feature is on')
  // Generic copy: the card must not name the arg, so it cannot be wrong about which feature.
  expect(await popup.textOf('.coachmark-text')).not.toContain(GRANT_ARG)
  // The way out is what makes this more than an FYI.
  expect(await popup.textOf('.coachmark-action')).toBe('Settings')
  expect(await popup.textOf('.coachmark-dismiss')).toBe('Got it')

  const shot = await captureWindow(ctx.app, '01-notice-over-comfyui')
  test.info().attach('notice over ComfyUI', { path: shot, contentType: 'image/png' })
})

test('the card is anchored on the bell it points at @linux', async () => {
  // Asserted on the BEAK's own position in window coordinates, not the popup view's.
  //
  // This test used to compare the VIEW's centre against the bell, on the reasoning that the
  // beak sits at a fixed position inside the card so centring the popup centres the beak. The
  // middle step was false: the card is narrower than the view by a shadow gutter each side,
  // and it was rendering flush-LEFT inside it rather than centred. So the view was centred on
  // the bell — which this test checked, and which was never broken — while the card and its
  // beak sat one gutter to the left, which is what a user sees. It shipped a real misalignment
  // (-18px on Windows) under a green assertion for exactly that reason.
  //
  // Measuring the beak end to end is the only version that cannot pass while the card is off.
  const bellCentre = await ctx.titleBar.evaluate<number>(`(() => {
    const el = document.querySelector('.title-announcement-button')
    if (!el) return -1
    const r = el.getBoundingClientRect()
    return (r.left + r.right) / 2
  })()`)
  expect(bellCentre).toBeGreaterThan(0)

  const popup = await ctx.app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
    if (!win) return null
    for (const child of win.contentView.children) {
      if (!(child instanceof WebContentsView)) continue
      if (!child.webContents.getURL().includes('comfyTitleTooltip')) continue
      const b = child.getBounds()
      return { centre: b.x + b.width / 2, x: b.x, right: b.x + b.width, width: b.width }
    }
    return null
  })
  expect(popup, 'coachmark popup view not found').not.toBeNull()

  // The card must COVER the bell horizontally — that holds whether or not the view clamped.
  expect(popup!.x).toBeLessThanOrEqual(bellCentre)
  expect(popup!.right).toBeGreaterThanOrEqual(bellCentre)

  // Where the beak actually is: its centre inside the popup page, plus the page's own
  // position in the window.
  //
  // POLLED, not sampled once. Main shows the popup at a provisional size and resizes it once
  // the card reports its measured width, and for a beat after that the page is still laid out
  // against the OLD viewport — measured mid-flight it reads several px off and settles to 0.
  // A single read can land in that window, which is a flaky test rather than a real failure,
  // and this repo does not tolerate those. Reading until it settles asserts the same property
  // without racing the resize.
  const beakCentre = async (): Promise<number> =>
    coachmarkPopup(ctx.app).evaluate<number>(`(() => {
      const card = document.querySelector('.coachmark')
      const beak = document.querySelector('.coachmark-beak')
      if (!card || !beak) return -1
      const b = beak.getBoundingClientRect()
      return (b.left + b.right) / 2
    })()`)

  /** Everything the offset is computed from, for the failure message.
   *
   *  A bare "expected <= 2, received 8" cannot say WHICH term is wrong, and this assertion
   *  has already failed on a runner where it passes locally at the same window size. The
   *  offset is `view.x + beak - bell`, so a failure is one of: the view not centred on the
   *  bell, the card not centred in the view, or the beak not centred in the card. Each has a
   *  different cause and a different fix, and one CI failure should be enough to tell them
   *  apart instead of costing another round trip. */
  const geometry = async (): Promise<string> => {
    const card = await coachmarkPopup(ctx.app).evaluate<string>(`(() => {
      const c = document.querySelector('.coachmark')
      const b = document.querySelector('.coachmark-beak')
      if (!c || !b) return 'card=<absent>'
      const cr = c.getBoundingClientRect(), br = b.getBoundingClientRect()
      return 'cardLeft=' + cr.left + ' cardWidth=' + cr.width +
             ' beakInCard=' + ((br.left + br.right) / 2 - cr.left) +
             ' beakInlineStyle=' + (b.style.left || '<none>') +
             ' pageWidth=' + window.innerWidth
    })()`)
    return (
      `bell=${bellCentre} viewX=${popup!.x} viewWidth=${popup!.width} ${card}` +
      ` | viewCentreVsBell=${popup!.x + popup!.width / 2 - bellCentre}`
    )
  }
  expect(await beakCentre(), 'no beak found on the card').toBeGreaterThanOrEqual(0)

  // When nothing clamped it, the beak must land ON the bell. Asserted only in the unclamped
  // case: with the bell too close to a window edge the card cannot centre, and the beak's
  // edge margin deliberately wins over exact tracking — `positionCoachmark`'s unit tests
  // cover that trade directly.
  const windowWidth = await ctx.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
    return win ? win.getContentBounds().width : 0
  })
  const clamped = popup!.x <= 0 || popup!.right >= windowWidth
  if (!clamped) {
    await expect
      .poll(async () => Math.abs(popup!.x + (await beakCentre()) - bellCentre), {
        timeout: 10_000,
        message:
          'the beak must point at the bell, not merely sit in a view that is centred on it. ' +
          (await geometry()),
      })
      .toBeLessThanOrEqual(2)
  }
})

test('the notice does not block the canvas underneath it @linux', async () => {
  // Nonblocking is the firm constraint, and it is a property of the popup's BOUNDS: the card
  // is its own small WebContentsView, so it takes clicks only where it is drawn. A full-window
  // overlay would report a height near the host window's.
  const bounds = await ctx.app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
    if (!win) throw new Error('no visible window')
    const content = win.getContentBounds()
    for (const child of win.contentView.children) {
      if (!(child instanceof WebContentsView) || !child.getVisible()) continue
      if (!child.webContents.getURL().includes('comfyTitleTooltip')) continue
      const b = child.getBounds()
      return { card: b, window: { width: content.width, height: content.height } }
    }
    return null
  })

  expect(bounds, 'coachmark popup view not found among the window children').not.toBeNull()
  expect(bounds!.card.height).toBeLessThan(bounds!.window.height / 2)
  expect(bounds!.card.width).toBeLessThan(bounds!.window.width / 2)
})

test('the settings link lands on the beta opt-in row and retires the card @linux', async () => {
  const popup = coachmarkPopup(ctx.app)
  expect(await popup.click('.coachmark-action')).toBe(true)

  const settings = titlePopupPage(ctx.app)
  await settings.waitForVisible('.global-settings', { timeout: 15_000 })
  await settings.waitForVisible('[data-field-id="betaFeaturesEnabled"]', { timeout: 15_000 })

  // Landing on the tab is not the claim — landing on the ROW is. The flash class is what
  // carries the user's eye to a control that sits below the fold.
  await settings.waitFor(
    () => settings.exists('[data-field-id="betaFeaturesEnabled"].gs-field-flash'),
    { timeout: 10_000, message: 'beta opt-in row was never highlighted' },
  )
  // The switch it points at is the real opt-out, and it is live (on, and not consent-blocked).
  const state = await settings.evaluate<{ checked: string | null; disabled: string | null }>(`(() => {
    const el = document.querySelector('[data-field-id="betaFeaturesEnabled"] button[role="switch"]')
    if (!el) return { checked: null, disabled: null }
    return {
      checked: el.getAttribute('aria-checked'),
      disabled: el.getAttribute('aria-disabled'),
    }
  })()`)
  expect(state.checked).toBe('true')
  expect(state.disabled).toBe('false')

  const shot = await captureWindow(ctx.app, '02-settings-beta-optout-highlighted')
  test.info().attach('settings opt-out highlighted', { path: shot, contentType: 'image/png' })
})

test('the notice is spent: a second launch stays silent @linux', async () => {
  // The whole point of persisting on retire rather than on show. Read through the same IPC
  // the title bar uses, so this asserts the contract the renderer actually depends on.
  const stillPending = await ctx.titleBar.evaluate<unknown>(
    `window.api.getPendingBetaNotice(${JSON.stringify(INSTALL_ID)})`,
  )
  expect(stillPending).toBeNull()

  const announced = await ctx.titleBar.evaluate<unknown>(
    `window.api.getSetting('betaNoticeAnnouncedArgs')`,
  )
  expect(announced).toEqual([GRANT_ARG])
})
