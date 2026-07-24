/**
 * Lifecycle E2E: Desktop 1.x → Standalone migration trigger wiring.
 *
 * Pre-stages a Legacy Desktop layout on disk (Windows only — detection on
 * macOS reads `~/Library/Application Support/ComfyUI` from the real OS
 * home, and Linux has no Legacy Desktop path at all) so the launcher's
 * auto-tracker registers a `sourceId: 'desktop'` install on boot. The
 * test then exercises the migration trigger surface:
 *   - the auto-tracker actually creates the desktop install record
 *   - the chooser tile's kebab exposes the real Migrate entry point,
 *     which opens the adoption confirm; Cancel backs out without
 *     dispatching the migration action or touching the record
 *   - the standalone source advertises a release + CPU variant the
 *     migration flow's silent variant pick would consume
 *
 * The confirmed adoption op itself (validate legacy venv → copy source →
 * reuse .venv) is exercised end-to-end by
 * `lifecycle-first-use-migrate.test.ts` from the first-use branch; the
 * download/extract phase of a fresh standalone install is left to
 * `lifecycle.test.ts`, which already exercises the same
 * `standaloneSource.install + postInstall` code at the same cost.
 */

import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { closeTitlePopupIfOpen, titlePopupPage, waitForWebContents } from './support/cdpPages'
import { expectChooserVisible } from './support/chooserHelpers'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let legacyBasePath: string
let legacyInstallId = ''

const LEGACY_NAME = 'ComfyUI Legacy Desktop'

interface FieldOption {
  value: string
  label: string
  recommended?: boolean
  [key: string]: unknown
}

interface Installation {
  id: string
  name: string
  sourceId: string
  installPath?: string
  [key: string]: unknown
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.skip(process.platform !== 'win32', 'Legacy Desktop detection sandbox only works on Windows (APPDATA-based)')
  // Recreate lifecycle.test.ts's depth-search so this test works whether
  // it's run from the launcher repo or from the multi-repo workspace.
  if (!process.env['GITHUB_TOKEN']) {
    for (let depth = 2; depth <= 8; depth++) {
      const segments = Array(depth).fill('..')
      const p = resolve(__dirname, ...segments, 'githubtoken.txt')
      try { process.env['GITHUB_TOKEN'] = readFileSync(p, 'utf-8').trim(); break } catch { /* try next depth */ }
    }
  }

  legacyBasePath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-legacy-desktop-e2e-'))
  // Layout `detectDesktopInstall` recognizes: models/ + user/ + .venv/.
  // Empty dirs are enough for detection + the confirm surface; the
  // confirmed adoption op (not driven here) is what needs a live venv.
  await mkdir(path.join(legacyBasePath, 'models'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'user'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'input'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'output'), { recursive: true })
  await mkdir(path.join(legacyBasePath, '.venv'), { recursive: true })

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    async onSetup({ homeDir }) {
      // Write the legacy Desktop config.json the auto-tracker reads at
      // boot. On Windows it lives under %APPDATA%/ComfyUI/, which the
      // harness already sandboxes via the APPDATA env override.
      const desktopConfigDir = path.join(homeDir, 'AppData', 'Roaming', 'ComfyUI')
      await mkdir(desktopConfigDir, { recursive: true })
      await writeFile(
        path.join(desktopConfigDir, 'config.json'),
        JSON.stringify({ basePath: legacyBasePath }),
      )
    },
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (legacyBasePath) await rm(legacyBasePath, { recursive: true, force: true })
})

test('auto-tracker registers Legacy Desktop install on boot @lifecycle', async () => {
  await ctx.panel.waitFor(
    async () => {
      const names = await ctx.panel.allText(
        '.chooser-tile:not(.chooser-tile-new):not(.chooser-tile-cloud) .chooser-tile-name',
      )
      return names.includes(LEGACY_NAME)
    },
    { timeout: 15_000, message: 'auto-tracked Legacy Desktop tile never appeared in chooser' },
  )

  const installs = await ctx.panel.evaluate<Installation[]>(`window.api.getInstallations()`)
  const desktop = installs.find((i) => i.sourceId === 'desktop')
  expect(desktop, 'desktop install not present in get-installations result').toBeDefined()
  expect(desktop!.installPath).toBe(legacyBasePath)
  // Capture the auto-allocated id so subsequent tests can address the
  // tile's kebab menu.
  legacyInstallId = desktop!.id
})

test('chooser kebab Migrate opens the real adoption confirm; Cancel backs out cleanly @lifecycle', async () => {
  expect(legacyInstallId, 'legacyInstallId not captured by the prior test').toBeTruthy()
  await resetIpcInvocations(ctx.app, 'run-action')

  // Kebab → Migrate. The menu item only renders when the backend tagged
  // the install with a `migrate` status tag, so its presence is itself
  // an assertion that the Legacy Desktop record is migratable.
  expect(
    await ctx.panel.click(byTestId(TID.dashboardTileKebab(legacyInstallId))),
    'kebab click on legacy desktop tile',
  ).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.contextMenuItem('migrate')), { timeout: 5_000 })
  expect(await ctx.panel.click(byTestId(TID.contextMenuItem('migrate')))).toBe(true)

  // The item routes through Manage with `autoAction: 'migrate-to-standalone'`,
  // which opens the picker popup and lands in the desktop-adoption confirm.
  // The confirm carries `messageDetails` (the reuse list), so ModalDialog
  // renders it as a rich confirm (`modal-confirm-button` / `modal-cancel`),
  // not a BaseAlert. Cancel must exist alongside the primary CTA.
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(byTestId(TID.modalConfirm), { timeout: 15_000 })
  await popup.waitForVisible(byTestId(TID.modalCancel))

  expect(await popup.click(byTestId(TID.modalCancel))).toBe(true)
  await popup.waitFor(
    async () => !(await popup.exists(byTestId(TID.modalConfirm))),
    { timeout: 10_000, message: 'adoption confirm never dismissed after Cancel' },
  )

  // Cancel means no dispatch and an untouched record.
  type RunActionCall = { installationId: string; actionId: string }
  const calls = await getIpcInvocations(ctx.app, 'run-action') as RunActionCall[]
  expect(
    calls.some((c) => c.actionId === 'migrate-to-standalone'),
    'cancelled adoption confirm must not dispatch migrate-to-standalone',
  ).toBe(false)
  const installs = await ctx.panel.evaluate<Installation[]>(`window.api.getInstallations()`)
  const desktop = installs.find((i) => i.id === legacyInstallId)
  expect(desktop, 'legacy desktop record must survive a cancelled migrate').toBeDefined()
  expect(desktop!.sourceId).toBe('desktop')

  // Close the Manage popup the autoAction route left open.
  await closeTitlePopupIfOpen(ctx.app)
})

test('standalone source exposes a CPU variant the migration variant pick can pin @lifecycle', async () => {
  // Read-only contract guard: `useMigrateAction` silently picks the
  // recommended variant from these same field-option IPCs before
  // dispatching `migrate-to-standalone`, and the CI lifecycle suite
  // pins CPU on Windows — without a CPU variant the migrate path would
  // download a GPU payload that blows the budget. Asserting the pick is
  // reachable guards the upstream R2 contract (`latest.json` +
  // per-vendor `releases.json`) that pick depends on.
  const releaseOptions = await ctx.panel.evaluate<FieldOption[]>(
    `window.api.getFieldOptions('standalone', 'release', {}, { includeLatestStable: true })`,
  )
  expect(releaseOptions.length, 'no standalone releases available').toBeGreaterThan(0)
  const release = releaseOptions.find((r) => r.recommended) ?? releaseOptions[0]!

  const variantOptions = await ctx.panel.evaluate<FieldOption[]>(
    `window.api.getFieldOptions('standalone', 'variant', ${JSON.stringify({ release })})`,
  )
  expect(variantOptions.length, 'no standalone variants available').toBeGreaterThan(0)
  const cpuVariant = variantOptions.find((v) => /cpu/i.test(v.value))
  expect(cpuVariant, `no CPU variant exposed for release ${release.value}: ${JSON.stringify(variantOptions.map((v) => v.value))}`).toBeDefined()
})
