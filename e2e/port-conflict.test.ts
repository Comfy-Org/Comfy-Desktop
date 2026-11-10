import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { byTestId, TID } from './support/testIds'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'

let ctx: AppContext
let installPath: string

const INSTALL_ID = 'inst-port-conflict-test'
const INSTALL_NAME = 'Port Conflict Install'
const MARKER_FILENAME = '.comfyui-desktop-2'
const OCCUPIED_PORT = 65432
const NEXT_PORT = 65433

interface RunActionInvocation {
  installationId: string
  actionId: string
  actionData?: Record<string, unknown>
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-port-conflict-e2e-'))
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

test.beforeEach(async () => {
  await resetIpcInvocations(ctx.app, 'run-action')
  await resetIpcInvocations(ctx.app, 'kill-port-process')
})

async function injectConflict(): Promise<void> {
  await ctx.panel.evaluate<void>(`(async () => {
    await window.__e2eRenderer.injectPortConflictResult({
      installationId: ${JSON.stringify(INSTALL_ID)},
      title: 'Launching ComfyUI',
      port: ${OCCUPIED_PORT},
      nextPort: ${NEXT_PORT},
      isComfy: true,
    })
  })()`)
}

test('port-conflict banner + dual-action footer render when result.portConflict is set @windows @macos @linux', async () => {
  await injectConflict()

  await ctx.panel.waitForVisible(byTestId(TID.progressPortConflictBanner), { timeout: 10_000 })
  await ctx.panel.waitForVisible(byTestId(TID.progressPortConflictUsePort), { timeout: 5_000 })
  await ctx.panel.waitForVisible(byTestId(TID.progressPortConflictKill), { timeout: 5_000 })

  expect(await ctx.panel.exists(byTestId(TID.progressReboot))).toBe(false)
})

test('Kill Process confirms, hits killPortProcess, then re-invokes op.apiCall @windows @macos @linux', async () => {
  await injectConflict()
  await ctx.panel.waitForVisible(byTestId(TID.progressPortConflictKill), { timeout: 10_000 })

  const beforeCount = await ctx.panel.evaluate<number>(
    `window.__e2eRenderer.getInjectedApiCallCount(${JSON.stringify(INSTALL_ID)})`
  )
  expect(beforeCount, 'apiCall must have run once for the initial conflict').toBe(1)

  expect(await ctx.panel.click(byTestId(TID.progressPortConflictKill))).toBe(true)

  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 5_000 })
  expect(await ctx.panel.click(byTestId(TID.baseAlertAction))).toBe(true)

  await expect
    .poll(async () => (await getIpcInvocations(ctx.app, 'kill-port-process')).length, {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(1)
  const killCalls = await getIpcInvocations(ctx.app, 'kill-port-process')
  expect(killCalls).toEqual([OCCUPIED_PORT])

  await expect
    .poll(
      () =>
        ctx.panel.evaluate<number>(
          `window.__e2eRenderer.getInjectedApiCallCount(${JSON.stringify(INSTALL_ID)})`
        ),
      { timeout: 5_000, intervals: [100, 200] }
    )
    .toBeGreaterThanOrEqual(2)

  const runCalls = (await getIpcInvocations(ctx.app, 'run-action')) as RunActionInvocation[]
  expect(
    runCalls.filter((c) => c.installationId === INSTALL_ID && c.actionId === 'launch'),
    'Kill Process must re-invoke op.apiCall, not the fresh-launch fallback'
  ).toEqual([])
})

test('Use Next Port fires runAction(launch) with portOverride @windows @macos @linux', async () => {
  await injectConflict()
  await ctx.panel.waitForVisible(byTestId(TID.progressPortConflictUsePort), { timeout: 10_000 })

  expect(await ctx.panel.click(byTestId(TID.progressPortConflictUsePort))).toBe(true)

  await expect
    .poll(async () => (await getIpcInvocations(ctx.app, 'run-action')).length, {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBeGreaterThanOrEqual(1)

  const runCalls = (await getIpcInvocations(ctx.app, 'run-action')) as RunActionInvocation[]
  const launchCall = runCalls.find(
    (c) => c.installationId === INSTALL_ID && c.actionId === 'launch'
  )
  expect(launchCall, 'Use Next Port must fire runAction("launch") for the install').toBeDefined()
  expect(launchCall!.actionData).toEqual({ portOverride: NEXT_PORT })
})
