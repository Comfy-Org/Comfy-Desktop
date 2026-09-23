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
 *
 * Tagged `@linux` only — the fixture cannot run on Windows (no PE interpreter stub) or macOS
 * (nothing isolates `userData`, so the ops-flag seed would hit the real profile). Both reasons
 * are spelled out in `fakeComfyInstall.ts`'s header.
 *
 * Run: `pnpm exec playwright test --project=linux e2e/beta-activation-notice-firstrun.test.ts`
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
  writeFakeComfyInstall,
} from './support/fakeComfyInstall'

// A real launch (args-schema spawn, port wait, attach) does not fit the default 45s budget.
test.describe.configure({ mode: 'serial', timeout: 180_000 })

const INSTALL_ID = 'inst-beta-notice-firstrun'
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


/** PostHog's own value for the flag wins over the persisted one, and a live fetch would make
 *  this run depend on a real project's flag state. Pointing the SDK at a closed port makes the
 *  fetch `unreachable`, which is the documented path where `ops-flags.json` is authoritative —
 *  the same path an offline launch takes for a user who already has the grant. */
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
      // Beta grants are gated on the opt-in, which is itself gated on consent.
      telemetryEnabled: true,
      betaFeaturesEnabled: true,
      // Deliberately NOT spent: this spec exists to drive the genuine first-run collision,
      // where the onboarding hint and the beta notice contend for the one shared popup.
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

/**
 * The regression this spec exists for.
 *
 * One popup serves both cards. On a real first run the beta notice can show FIRST and then be
 * displaced when the onboarding hint configures the same popup — which is not a hide, so the
 * composable was never told and went on believing its card was up, refusing every later show.
 * The notice stayed armed in main and invisible to the user for the rest of the session.
 *
 * Both other specs seed `hasSeenCentralPillHint: true`, so neither could ever see this. That
 * seeding is why a green suite shipped a build where the card never appeared.
 */
test('first run: the hint takes the popup, and dismissing it releases the beta card @linux', async () => {
  await clickInstallTile(ctx.panel, INSTALL_NAME)
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
        return false
      }
    },
    { timeout: 30_000, message: 'no coachmark appeared at all on a first run' },
  )

  // The hint wins the collision — that part is by design and is not what this pins.
  expect(await popup.textOf('.coachmark-title')).toBe('Switch & manage instances')

  // The notice is queued in main the whole time, waiting for the popup to free up.
  expect(await ctx.titleBar.evaluate(`window.api.getPendingBetaNotice(${JSON.stringify(INSTALL_ID)})`))
    .not.toBeNull()

  expect(await popup.click('.coachmark-dismiss')).toBe(true)

  // THE ASSERTION: the deferred card must actually arrive once the hint lets go of the popup.
  await popup.waitFor(
    async () => {
      try {
        return (await popup.textOf('.coachmark-title')) === 'A beta feature is on'
      } catch {
        return false
      }
    },
    { timeout: 30_000, message: 'beta notice never drew after the hint was dismissed' },
  )

  // Generic copy, and the way out is present — same contract the seeded spec asserts.
  expect(await popup.textOf('.coachmark-text')).not.toContain(GRANT_ARG)
  expect(await popup.textOf('.coachmark-action')).toBe('Settings')
})
