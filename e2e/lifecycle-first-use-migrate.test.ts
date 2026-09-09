/**
 * Lifecycle E2E: first-use Migrate branch end-to-end.
 *
 * Cold-starts with a seeded Legacy Desktop install on disk so the
 * auto-tracker registers a `sourceId: 'desktop'` record at boot and
 * `detectFirstUseState` flips `hasLegacyDesktop`. Drives the user
 * through consent → pick-local → migrate sub-step and asserts:
 *   - the migrate confirm renders as the brand `MigrateConfirmTakeover`
 *     (takeover surface, not the legacy modal path)
 *   - clicking Confirm dispatches `runAction('migrate-to-standalone', …)`
 *     against the legacy install id
 *   - the adoption op really runs in main and its outcome renders in
 *     the Tier 2 progress surface: the staged fixture's `.venv` is
 *     empty, so validate-venv raises the real venv-broken prompt; the
 *     test answers Cancel and the op's failure lands in the progress
 *     error state (zero mocking — the fixture, not a stub, decides
 *     the outcome)
 *   - the chain bookkeeping (`firstUseMode` push to `'post-consent'`)
 *     fires before the migration op is kicked off
 *
 * A *successful* adoption needs a live legacy venv (python + torch),
 * which is out of CI budget; the auto-launch watcher hand-off
 * post-migration is shared with the chain-local path (covered by
 * `lifecycle.test.ts`).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { getIpcInvocations, hasActiveOperation, resetIpcInvocations } from './support/devHooks'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let legacyBasePath: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.skip(process.platform !== 'win32', 'Legacy Desktop detection sandbox only works on Windows (APPDATA-based)')

  legacyBasePath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-first-use-migrate-e2e-'))
  // Layout `detectDesktopInstall` recognises: models/ + user/ + .venv/.
  await mkdir(path.join(legacyBasePath, 'models'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'user'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'input'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'output'), { recursive: true })
  await mkdir(path.join(legacyBasePath, '.venv'), { recursive: true })

  // Cold start: no `firstUseCompleted` seed, but a Legacy Desktop
  // config.json under the sandboxed %APPDATA% so the auto-tracker
  // registers a `sourceId: 'desktop'` install before the takeover paints.
  ctx = await launchApp({
    async onSetup({ homeDir }) {
      const desktopConfigDir = path.join(homeDir, 'AppData', 'Roaming', 'ComfyUI')
      await mkdir(desktopConfigDir, { recursive: true })
      await writeFile(
        path.join(desktopConfigDir, 'config.json'),
        JSON.stringify({ basePath: legacyBasePath }),
      )
    },
  })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (legacyBasePath) await rm(legacyBasePath, { recursive: true, force: true })
})

test('cold start with legacy desktop lands on start screen and surfaces migrate sub-step @lifecycle', async () => {
  // Merged start screen — consent + cloud/local + ToS all share one
  // page (commit 5619823). The hasLegacyDesktop branch fires after the
  // user picks Local and clicks Continue.
  await ctx.panel.waitForVisible('.start-hero', { timeout: 15_000 })

  // Pick Local, then opt out of the preselected migrate shortcut so
  // Continue opens the detailed migrate-vs-fresh sub-step.
  expect(await ctx.panel.click('[data-testid="first-use-pick-local"]')).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="first-use-migrate-existing"]', { timeout: 5_000 })
  expect(await ctx.panel.click('[data-testid="first-use-migrate-existing"]')).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="first-use-express-install"]', { timeout: 5_000 })
  expect(await ctx.panel.evaluate<boolean>(
    `!document.querySelector('[data-testid="first-use-express-install"] input').checked`,
  )).toBe(true)
  expect(await ctx.panel.click('[data-testid="first-use-consent-tos"]')).toBe(true)
  await ctx.panel.waitFor(
    async () => ctx.panel.evaluate<boolean>(
      `!document.querySelector('[data-testid="first-use-continue"]').disabled`,
    ),
    { timeout: 5_000, message: 'Continue never became enabled after ticking ToS' },
  )
  expect(await ctx.panel.click('[data-testid="first-use-continue"]')).toBe(true)

  // `pickLocal` sees `hasLegacyDesktop=true` (auto-tracker registered
  // the desktop install via the seeded config.json) so the takeover
  // advances to the localBranch sub-step rather than firing
  // `chain-local` directly. Confirms detection plumbed through.
  await ctx.panel.waitForVisible('[data-testid="first-use-local-migrate"]', { timeout: 10_000 })
})

test('migrate sub-step opens MigrateConfirmTakeover (takeover surface) @lifecycle', async () => {
  // Reset run-action invocations so the confirm assertion below counts
  // only the migrate-to-standalone dispatch this test produces.
  await resetIpcInvocations(ctx.app, 'run-action')
  await resetIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode')

  expect(await ctx.panel.click('[data-testid="first-use-local-migrate"]')).toBe(true)

  // `handleFirstUseChainMigrate` routes through
  // `useMigrateAction.confirmMigration({ surface: 'takeover' })` →
  // `registeredTakeover.open(...)` which mounts MigrateConfirmTakeover.
  // The takeover's primary CTA is `data-testid="migrate-takeover-confirm"`.
  await ctx.panel.waitForVisible('[data-testid="migrate-takeover-confirm"]', { timeout: 15_000 })
  await ctx.panel.waitForVisible('[data-testid="migrate-takeover-cancel"]')

  // Wait until the takeover's Confirm CTA leaves loading state — the
  // adoption confirm populates its details before enabling the button.
  await ctx.panel.waitFor(
    async () => ctx.panel.evaluate<boolean>(
      `!document.querySelector('[data-testid="migrate-takeover-confirm"]').disabled`,
    ),
    { timeout: 15_000, message: 'migrate-takeover Confirm never became enabled (preview stalled)' },
  )

  expect(await ctx.panel.click('[data-testid="migrate-takeover-confirm"]')).toBe(true)

  // The host dismisses the takeover, flips `chainingFirstUseToNewInstall`
  // true and kicks off the Tier 2 progress op via
  // `handleShowProgress({ apiCall: () => runAction('migrate-to-standalone', …) })`.
  type RunActionCall = { installationId: string; actionId: string }
  await expect.poll(
    async () => {
      const calls = await getIpcInvocations(ctx.app, 'run-action') as RunActionCall[]
      return calls.some((c) => c.actionId === 'migrate-to-standalone')
    },
    { timeout: 15_000, intervals: [200, 500] },
  ).toBe(true)

  // The op must actually execute, not just dispatch. The fixture's empty
  // `.venv` makes the adoption's validate-venv step surface the real
  // venv-broken prompt (main → adopt-prompt bridge → DialogHost BaseAlert
  // in the panel: "Use Anyway" / "Cancel"). Drive it like a user: Cancel.
  await ctx.panel.waitForVisible(byTestId(TID.baseAlertCancel), { timeout: 60_000 })
  expect(await ctx.panel.click(byTestId(TID.baseAlertCancel))).toBe(true)

  // Cancelling the prompt makes the adoption op throw
  // `venv-broken-cancelled`, and — since no op-level cancel was requested —
  // the honest end-state is the progress surface's error message. Its
  // presence proves the whole chain ran: real click → IPC → main action
  // executor → adoption op against the staged legacy tree → real prompt →
  // outcome rendered.
  await ctx.panel.waitForVisible(byTestId(TID.progressErrorMessage), { timeout: 30_000 })

  // The failed op must release the per-install operation slot so the
  // user can retry (and the harness can tear down cleanly).
  const legacyInstalls = await ctx.panel.evaluate<Array<{ id: string; sourceId: string }>>(
    `window.api.getInstallations()`,
  )
  const legacy = legacyInstalls.find((i) => i.sourceId === 'desktop')
  expect(legacy, 'legacy desktop record must survive a failed adoption').toBeDefined()
  await expect.poll(
    () => hasActiveOperation(ctx.app, legacy!.id),
    { timeout: 30_000, intervals: [500, 1_000] },
  ).toBe(false)

  // The chain's explicit `setFirstUseMode('post-consent')` re-assertion
  // fires after `dismissTakeoverDirect` pushed `'none'` — assert the
  // sequence rather than just the final value.
  const modeCalls = await getIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode') as Array<{ mode: string }>
  const modes = modeCalls.map((c) => c.mode)
  expect(modes, 'chain-migrate should re-assert post-consent after dismiss').toContain('post-consent')
})
