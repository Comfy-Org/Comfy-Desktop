
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
const PRE_EXISTING_ERROR = 'Earlier crash: ComfyUI exited with code 1'
const OP_FAILURE_MESSAGE = 'Initial op failure: simulated launch failure'

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
        status: 'installed',
      },
    ],
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

test('ProgressModal Reboot re-runs the same apiCall to recover an errored install @windows @macos @linux', async () => {
  await ctx.panel.evaluate<void>(`(() => {
    window.__e2eRenderer.seedErrorInstance({
      installationId: ${JSON.stringify(INSTALL_ID)},
      installationName: ${JSON.stringify(INSTALL_NAME)},
      message: ${JSON.stringify(PRE_EXISTING_ERROR)},
    })
  })()`)
  const seeded = await ctx.panel.evaluate<boolean>(
    `window.__e2eRenderer.hasErrorInstance(${JSON.stringify(INSTALL_ID)})`,
  )
  expect(seeded, 'seedErrorInstance must register the install in errorInstances').toBe(true)

  await ctx.panel.evaluate<void>(`(async () => {
    await window.__e2eRenderer.injectRetryableProgressError({
      installationId: ${JSON.stringify(INSTALL_ID)},
      title: 'Launching ComfyUI',
      errorMessage: ${JSON.stringify(OP_FAILURE_MESSAGE)},
      failuresBeforeSuccess: 1,
    })
  })()`)

  await ctx.panel.waitForVisible(byTestId(TID.progressErrorMessage), { timeout: 10_000 })
  await ctx.panel.waitForVisible(byTestId(TID.progressReboot), { timeout: 10_000 })

  const beforeReboot = await ctx.panel.evaluate<number>(
    `window.__e2eRenderer.getInjectedApiCallCount(${JSON.stringify(INSTALL_ID)})`,
  )
  expect(beforeReboot, 'apiCall must have run once for the seeded failure').toBe(1)

  expect(await ctx.panel.click(byTestId(TID.progressReboot))).toBe(true)

  await expect
    .poll(
      () =>
        ctx.panel.evaluate<number>(
          `window.__e2eRenderer.getInjectedApiCallCount(${JSON.stringify(INSTALL_ID)})`,
        ),
      { timeout: 5_000, intervals: [100, 200] },
    )
    .toBeGreaterThanOrEqual(2)

  await expect
    .poll(() => ctx.panel.exists(byTestId(TID.progressErrorMessage)), {
      timeout: 10_000,
      intervals: [100, 200],
    })
    .toBe(false)
  await expect
    .poll(() => ctx.panel.exists('.brand-progress'), {
      timeout: 10_000,
      intervals: [200, 500],
    })
    .toBe(false)
})
