import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let installPath: string

const INSTALL_ID = 'inst-reboot-errored-test'
const INSTALL_NAME = 'Errored Reboot Install'
const MARKER_FILENAME = '.comfyui-desktop-2'
const OP_FAILURE_MESSAGE = 'Initial op failure: simulated pull failure'
const FAILED = '[data-testid="build-operation-failed"]'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-reboot-errored-e2e-'))
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
        status: 'installed'
      }
    ]
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

test('Try again on the build page re-runs the same apiCall after a task fails @windows @macos @linux', async () => {
  await ctx.panel.evaluate<void>(`(async () => {
    await window.__e2eRenderer.injectRetryableProgressError({
      installationId: ${JSON.stringify(INSTALL_ID)},
      title: 'Pulling changes',
      errorMessage: ${JSON.stringify(OP_FAILURE_MESSAGE)},
      failuresBeforeSuccess: 1,
    })
  })()`)

  await expect
    .poll(
      () =>
        ctx.panel.evaluate<boolean>(
          `window.__e2eRenderer.hasErrorInstance(${JSON.stringify(INSTALL_ID)})`
        ),
      { timeout: 10_000, intervals: [100, 200] }
    )
    .toBe(true)
  expect(await ctx.panel.exists('.brand-progress')).toBe(false)

  expect(await ctx.panel.click(byTestId(TID.dashboardTileKebab(INSTALL_ID)))).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="build-menu-manage"]', { timeout: 5_000 })
  expect(await ctx.panel.click('[data-testid="build-menu-manage"]')).toBe(true)

  await ctx.panel.waitForVisible(FAILED, { timeout: 10_000 })
  expect(
    await ctx.panel.evaluate<string>(
      `document.querySelector('[data-testid="build-operation-failed-reason"]')?.textContent ?? ''`
    )
  ).toContain(OP_FAILURE_MESSAGE)

  const beforeRetry = await ctx.panel.evaluate<number>(
    `window.__e2eRenderer.getInjectedApiCallCount(${JSON.stringify(INSTALL_ID)})`
  )
  expect(beforeRetry, 'apiCall must have run once for the first failure').toBe(1)

  expect(await ctx.panel.click('[data-testid="build-operation-retry"]')).toBe(true)

  await expect
    .poll(
      () =>
        ctx.panel.evaluate<number>(
          `window.__e2eRenderer.getInjectedApiCallCount(${JSON.stringify(INSTALL_ID)})`
        ),
      { timeout: 5_000, intervals: [100, 200] }
    )
    .toBeGreaterThanOrEqual(2)

  await expect
    .poll(() => ctx.panel.exists(FAILED), { timeout: 10_000, intervals: [100, 200] })
    .toBe(false)
})
