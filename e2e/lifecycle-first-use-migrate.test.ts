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
  test.skip(
    process.platform !== 'win32',
    'Legacy Desktop detection sandbox only works on Windows (APPDATA-based)'
  )

  legacyBasePath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-first-use-migrate-e2e-'))
  await mkdir(path.join(legacyBasePath, 'models'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'user'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'input'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'output'), { recursive: true })
  await mkdir(path.join(legacyBasePath, '.venv'), { recursive: true })

  ctx = await launchApp({
    async onSetup({ homeDir }) {
      const desktopConfigDir = path.join(homeDir, 'AppData', 'Roaming', 'ComfyUI')
      await mkdir(desktopConfigDir, { recursive: true })
      await writeFile(
        path.join(desktopConfigDir, 'config.json'),
        JSON.stringify({ basePath: legacyBasePath })
      )
    }
  })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (legacyBasePath) await rm(legacyBasePath, { recursive: true, force: true })
})

test('cold start with legacy desktop offers to migrate it on Set up, ticked by default @lifecycle', async () => {
  await ctx.panel.waitForVisible('[data-testid="setup-screen"]', { timeout: 15_000 })
  await ctx.panel.waitForVisible('[data-testid="setup-migrate-existing"]', { timeout: 5_000 })
  expect(
    await ctx.panel.evaluate<boolean>(
      `document.querySelector('[data-testid="setup-migrate-existing"] [role="checkbox"]')?.getAttribute('aria-checked') === 'true'`
    )
  ).toBe(true)
  expect(await ctx.panel.click('[data-testid="setup-consent-tos"] [role="checkbox"]')).toBe(true)
  expect(
    await ctx.panel.evaluate<string>(
      `document.querySelector('[data-testid="setup-install"]')?.textContent?.trim() ?? ''`
    )
  ).toBe('Migrate')
})

test('Migrate on Set up opens MigrateConfirmTakeover (takeover surface) @lifecycle', async () => {
  await resetIpcInvocations(ctx.app, 'run-action')
  await resetIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode')

  expect(await ctx.panel.click('[data-testid="setup-install"]')).toBe(true)

  await ctx.panel.waitForVisible('[data-testid="migrate-takeover-confirm"]', { timeout: 15_000 })
  await ctx.panel.waitForVisible('[data-testid="migrate-takeover-cancel"]')

  await ctx.panel.waitFor(
    async () =>
      ctx.panel.evaluate<boolean>(
        `!document.querySelector('[data-testid="migrate-takeover-confirm"]').disabled`
      ),
    { timeout: 15_000, message: 'migrate-takeover Confirm never became enabled (preview stalled)' }
  )

  expect(await ctx.panel.click('[data-testid="migrate-takeover-confirm"]')).toBe(true)

  type RunActionCall = { installationId: string; actionId: string }
  await expect
    .poll(
      async () => {
        const calls = (await getIpcInvocations(ctx.app, 'run-action')) as RunActionCall[]
        return calls.some((c) => c.actionId === 'migrate-to-standalone')
      },
      { timeout: 15_000, intervals: [200, 500] }
    )
    .toBe(true)

  await ctx.panel.waitForVisible(byTestId(TID.baseAlertCancel), { timeout: 60_000 })
  expect(await ctx.panel.click(byTestId(TID.baseAlertCancel))).toBe(true)

  await ctx.panel.waitForVisible(byTestId(TID.progressErrorMessage), { timeout: 30_000 })

  const legacyInstalls = await ctx.panel.evaluate<Array<{ id: string; sourceId: string }>>(
    `window.api.getInstallations()`
  )
  const legacy = legacyInstalls.find((i) => i.sourceId === 'desktop')
  expect(legacy, 'legacy desktop record must survive a failed adoption').toBeDefined()
  await expect
    .poll(() => hasActiveOperation(ctx.app, legacy!.id), {
      timeout: 30_000,
      intervals: [500, 1_000]
    })
    .toBe(false)

  const modeCalls = (await getIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode')) as Array<{
    mode: string
  }>
  const modes = modeCalls.map((c) => c.mode)
  expect(modes, 'chain-migrate should re-assert post-consent after dismiss').toContain(
    'post-consent'
  )
})
