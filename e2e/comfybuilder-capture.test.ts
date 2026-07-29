/**
 * Screen-capture harness for the Comfy Builder flow.
 *
 *   pnpm run build && pnpm run test:e2e:capture
 *
 * Writes one PNG per screen plus `manifest.json` into `captures/` (gitignored;
 * override with `COMFY_CAPTURE_DIR`). The directory is wiped per run, so the set
 * is REGENERATED rather than accumulated — a screen deleted from `SCREENS`
 * disappears instead of going stale. Filenames carry their index from
 * declaration order, so the set sorts the way the flow reads.
 *
 * NOT RUN IN CI. It is the only member of the `capture` Playwright project
 * (`grep: /@capture/`); the CI matrix runs `--project={macos,windows,linux}`,
 * whose greps a `@capture`-only test matches none of. Same mechanism the
 * `lifecycle` project uses.
 *
 * COVERAGE. Signed out, the harness reaches the log-in chooser, the host title
 * bar, and — from two seeded `comfybuilder` records — the workspace shelf tile,
 * its kebab, the Manage popup, the not-ready alert, and an install's progress
 * and failure states. It does NOT implement or fake auth. It asks
 * `getAuthStatus()` after launch: with a real session it also captures the
 * signed-in chip, the workspace switcher and the distribution cards; without
 * one those land in `manifest.skipped` with a reason. A signed-in profile
 * conversely cannot show the log-in chip, so `chooser-signed-out` is skipped
 * there — the chooser's identity corner is one screen or the other, never both.
 * On macOS `app.getPath('userData')` ignores the harness HOME override, so an
 * operator already signed in to the dev app is signed in here too; on
 * Windows/Linux the isolated HOME means those screens are always skipped.
 *
 * SAFETY. It drives the real app, so it never clicks Log in (opens a browser),
 * Sign out, a workspace row (a switch re-runs the browser handoff), or a
 * distribution card / its "Install" item (would start a real multi-GB
 * download). Menus are opened and dismissed, never selected.
 *
 * macOS PROFILE. `dataDir()` resolves to `app.getPath('userData')`
 * (`src/main/lib/paths.ts`), which ignores the harness HOME override on macOS,
 * so seeding rewrites the operator's REAL `installations.json`. It is snapshot
 * before launch and restored in `afterAll`. The same path lets `E2E_SETTINGS_SEED`
 * replace the operator's `settings.json` wholesale — that is pre-existing
 * behaviour of every e2e run here and is deliberately not addressed by this file.
 */

import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import en from '../locales/en.json'
import { launchApp, type AppContext, type SeedInstallation } from './launchApp'
import { clickInstallTile, dismissOverlay, expectChooserVisible } from './support/chooserHelpers'
import { closeTitlePopupIfOpen, isPopupVisible, waitForWebContents } from './support/cdpPages'
import {
  captureDir,
  resetCaptureDir,
  ScreenCapturer,
  type CaptureTarget,
} from './support/screenCapture'
import { byTestId, TID } from './support/testIds'

const PANEL = 'panel.html'
const TITLE_BAR = 'comfyTitleBar.html'
const TITLE_POPUP = 'comfyTitlePopup.html'

const INSTALLED_ID = 'inst-capture-builder-installed'
const INSTALLED_NAME = 'desktop-4target-stg-v0190'
const FAILED_ID = 'inst-capture-builder-failed'
const FAILED_NAME = 'desktop-4target-stg-v0192'

/** Statuses the seeded records put on screen, echoed into the manifest. */
const DISTRIBUTION_STATES = ['installed', 'failed']

const SIGNED_IN_ONLY = 'requires a signed-in dev-platform session'

/** Declaration order IS file order. */
const SCREENS: readonly CaptureTarget[] = [
  { id: 'chooser-signed-out', surface: PANEL, anchor: '.chooser-view .account-chip__signin' },
  { id: 'chooser-signed-in', surface: PANEL, anchor: '.chooser-view .account-chip__face' },
  { id: 'workspace-switcher', surface: PANEL, anchor: '.account-chip__menu' },
  // Cropped for the same reason as the shelf below: the row of not-yet-installed
  // distributions, not another shot of the whole chooser.
  {
    id: 'distribution-cards',
    surface: PANEL,
    anchor: '.dist-tile--chooser',
    crop: '.chooser-family-grid:has(.dist-tile--chooser)',
  },
  { id: 'title-bar', surface: TITLE_BAR, anchor: '.title-bar' },
  // Cropped: uncropped this is the same viewport as the chooser above, and two
  // identical PNGs in the set would be a lie about coverage. `:has()` picks the
  // workspace shelf — the only one carrying a header.
  {
    id: 'builder-install-tile',
    surface: PANEL,
    anchor: byTestId(TID.dashboardTile(INSTALLED_ID)),
    crop: '.chooser-shelf:has(.chooser-shelf-head)',
  },
  { id: 'builder-install-tile-kebab', surface: PANEL, anchor: '.context-menu' },
  { id: 'builder-install-manage', surface: TITLE_POPUP, anchor: byTestId(TID.pickerRow(INSTALLED_ID)) },
  { id: 'builder-install-not-ready', surface: PANEL, anchor: byTestId(TID.baseAlertAction) },
  { id: 'builder-install-progress', surface: PANEL, anchor: '.brand-progress__bar' },
  { id: 'builder-install-failed', surface: PANEL, anchor: byTestId(TID.progressErrorMessage) },
]

/** macOS only — see the header. Null everywhere else, where the harness HOME
 *  override does isolate `userData`. */
const realInstallationsFile = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'comfyui-desktop-2', 'installations.json')
  : null

let ctx: AppContext
let rootDir: string
let outDir: string
let capturer: ScreenCapturer
let realInstallationsBackup: string | null = null

test.describe.configure({ mode: 'serial' })

/** Mirrors what `installDistribution` writes for a real distribution install. */
function distributionRecord(id: string, name: string, status: string): SeedInstallation {
  return {
    id,
    name,
    sourceId: 'comfybuilder',
    sourceLabel: 'ComfyBuilder',
    installPath: path.join(rootDir, id),
    distributionId: `d-${id}`,
    distributionName: name,
    version: '1',
    artifactId: 'a-1',
    artifactOs: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
    artifactGpu: 'cpu',
    artifactAccelVariant: 'cpu',
    launchArgs: '--enable-manager',
    launchMode: 'window',
    browserPartition: 'unique',
    status,
    seen: true,
  }
}

test.beforeAll(async () => {
  if (realInstallationsFile) {
    realInstallationsBackup = await readFile(realInstallationsFile, 'utf8').catch(() => null)
  }

  rootDir = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-capture-e2e-'))
  // A missing folder earns the tile a "Folder Not Found" danger pill
  // (`enrichInstallationsForRenderer`), which would be a lie in the screenshot.
  for (const id of [INSTALLED_ID, FAILED_ID]) {
    await mkdir(path.join(rootDir, id, 'ComfyUI'), { recursive: true })
    await writeFile(path.join(rootDir, id, 'ComfyUI', 'main.py'), '')
  }

  outDir = captureDir()
  await resetCaptureDir(outDir)
  console.log(`[capture] writing to ${outDir}`)

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      distributionRecord(INSTALLED_ID, INSTALLED_NAME, 'installed'),
      distributionRecord(FAILED_ID, FAILED_NAME, 'failed'),
    ],
  })
  await expectChooserVisible(ctx.panel)
  await waitForSeededTiles()
  capturer = new ScreenCapturer(ctx.app, outDir, SCREENS)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (rootDir) await rm(rootDir, { recursive: true, force: true })
  if (realInstallationsFile) {
    if (realInstallationsBackup !== null) await writeFile(realInstallationsFile, realInstallationsBackup)
    else await rm(realInstallationsFile, { force: true })
  }
})

test('chooser identity corner @capture', async () => {
  const status = await ctx.panel.evaluate<{ signedIn?: boolean }>(
    'window.api.comfybuilder.getAuthStatus()',
  )

  if (!status?.signedIn) {
    await capturer.capture('chooser-signed-out')
    capturer.skip('chooser-signed-in', SIGNED_IN_ONLY)
    capturer.skip('workspace-switcher', SIGNED_IN_ONLY)
    capturer.skip('distribution-cards', SIGNED_IN_ONLY)
    return
  }

  capturer.skip(
    'chooser-signed-out',
    'a dev-platform session is active in this profile, so the log-in chip is not on screen',
  )
  await capturer.capture('chooser-signed-in')

  // An empty or unreachable catalog is a real product state, not a harness
  // failure — record it as a gap rather than failing the run.
  const hasCards = await ctx.panel
    .waitForVisible('.dist-tile--chooser', { timeout: 10_000 })
    .then(() => true, () => false)
  if (hasCards) await capturer.capture('distribution-cards')
  else capturer.skip('distribution-cards', 'the signed-in workspace publishes no installable distribution')

  // The menu only. Selecting a row re-runs the browser handoff and Sign out is
  // real, so neither is ever clicked.
  expect(await ctx.panel.click('.account-chip__face'), 'account chip click dispatched').toBe(true)
  await capturer.capture('workspace-switcher')
  await closeAccountMenu()
})

test('host title bar @capture', async () => {
  await capturer.capture('title-bar')
})

test('workspace shelf tile and its kebab @capture', async () => {
  await capturer.capture('builder-install-tile')

  expect(
    await ctx.panel.click(byTestId(TID.dashboardTileKebab(INSTALLED_ID))),
    'install tile kebab click dispatched',
  ).toBe(true)
  await capturer.capture('builder-install-tile-kebab')

  await dismissOverlay(ctx.panel)
  await ctx.panel.waitFor(async () => !(await ctx.panel.exists('.context-menu')), {
    message: 'kebab menu never closed',
  })
})

test('manage popup for a distribution install @capture', async () => {
  await ctx.panel.evaluate<boolean>(
    `(() => { window.api.openInstancePicker({ installationId: ${JSON.stringify(INSTALLED_ID)} }); return true })()`,
  )
  await waitForWebContents(ctx.app, TITLE_POPUP)
  await expect
    .poll(() => isPopupVisible(ctx.app, TITLE_POPUP), { timeout: 10_000, intervals: [100, 200] })
    .toBe(true)

  await capturer.capture('builder-install-manage')
  await closeTitlePopupIfOpen(ctx.app)
})

test('not-ready alert on a failed distribution install @capture', async () => {
  await clickInstallTile(ctx.panel, FAILED_NAME)
  await capturer.capture('builder-install-not-ready')

  await ctx.panel.click(byTestId(TID.baseAlertAction))
  await expectChooserVisible(ctx.panel)
})

test('install progress and its failure @capture', async () => {
  // No real install: `startInFlightOp` opens the same ProgressModal the
  // distribution flow drives, with an apiCall that stays pending until settled.
  const title = `${en.newInstall.installing}: ${INSTALLED_NAME}`
  await ctx.panel.evaluate<void>(`(async () => {
    await window.__e2eRenderer.startInFlightOp({
      installationId: ${JSON.stringify(INSTALLED_ID)},
      title: ${JSON.stringify(title)},
      opKind: 'install',
    })
  })()`)
  await capturer.capture('builder-install-progress')

  // Same op, now failed — the transition a real install makes.
  expect(
    await ctx.panel.evaluate<boolean>(`window.__e2eRenderer.settleInFlightOp({
      installationId: ${JSON.stringify(INSTALLED_ID)},
      result: { ok: false, message: ${JSON.stringify(en.errors.installFailedDetail)} },
    })`),
    'in-flight op settled',
  ).toBe(true)
  await capturer.capture('builder-install-failed')
})

test('every declared screen is captured or explained @capture', async () => {
  const manifest = await capturer.writeManifest(DISTRIBUTION_STATES)
  console.log(`[capture] ${manifest.captured.length} captured, ${manifest.skipped.length} skipped`)
  // A screen that is neither shot nor explained fails the run rather than
  // quietly shrinking the set.
  expect(capturer.accountedIds()).toEqual(capturer.declaredIds())

  // Two identical PNGs mean a screen was shot before the compositor caught up
  // and the set silently under-covers — the whole point of the harness.
  const byDigest = new Map<string, string>()
  for (const record of manifest.captured) {
    const digest = createHash('sha256')
      .update(await readFile(path.join(outDir, record.file)))
      .digest('hex')
    expect(byDigest.get(digest), `${record.file} is byte-identical to ${byDigest.get(digest)}`).toBeUndefined()
    byDigest.set(digest, record.file)
  }
})

/**
 * The harness seeds `installations.json` after launch, so the chooser may
 * already have fetched an empty list and nothing tells it otherwise. Nudge it
 * down the app's own `installations-changed` path, then hold until both seeded
 * tiles are on screen — every capture assumes they are.
 */
async function waitForSeededTiles(): Promise<void> {
  await ctx.app.evaluate(({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      if (wc.getURL().includes('panel.html')) wc.send('installations-changed', {})
    }
  })
  for (const id of [INSTALLED_ID, FAILED_ID]) {
    await ctx.panel.waitForVisible(byTestId(TID.dashboardTile(id)), { timeout: 15_000 })
  }
}

/** The chip's Escape handler is bound to its own root, so a document-level key
 *  event never reaches it; the outside-pointer dismissal does. */
async function closeAccountMenu(): Promise<void> {
  await ctx.panel.evaluate<boolean>(
    `(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true })()`,
  )
  await ctx.panel.waitFor(async () => !(await ctx.panel.exists('.account-chip__menu')), {
    message: 'account menu never closed',
  })
}
