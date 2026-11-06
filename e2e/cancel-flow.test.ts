
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { byTestId, TID } from './support/testIds'
import {
  clearRunningSessions,
  getIpcInvocations,
  resetIpcInvocations,
  seedRunningSession,
} from './support/devHooks'

let ctx: AppContext
let installPath: string

const INSTALL_ID = 'inst-cancel-flow-test'
const INSTALL_NAME = 'Cancel Me'
const MARKER_FILENAME = '.comfyui-desktop-2'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-cancel-flow-e2e-'))
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
  await clearRunningSessions(ctx.app)
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

test.beforeEach(async () => {
  await resetIpcInvocations(ctx.app, 'cancel-operation')
  await resetIpcInvocations(ctx.app, 'stop-comfyui')
  await clearRunningSessions(ctx.app)
  await settleInFlightOp({ ok: false, cancelled: true })
})

async function startInFlightOp(opts: { destroysInstance?: boolean } = {}): Promise<void> {
  await ctx.panel.evaluate<void>(
    `(async () => {
      await window.__e2eRenderer.startInFlightOp({
        installationId: ${JSON.stringify(INSTALL_ID)},
        title: 'Updating ComfyUI — ' + ${JSON.stringify(INSTALL_NAME)},
        opKind: 'update',
        destroysInstance: ${opts.destroysInstance ? 'true' : 'false'},
      })
    })()`,
  )
  await ctx.panel.waitForVisible('.brand-progress', { timeout: 10_000 })
}

async function settleInFlightOp(result: { ok: boolean; cancelled?: boolean }): Promise<void> {
  await ctx.panel.evaluate<boolean>(
    `window.__e2eRenderer.settleInFlightOp({
      installationId: ${JSON.stringify(INSTALL_ID)},
      result: ${JSON.stringify(result)},
    })`,
  )
}

async function runGuardInBackground(actionLabel: string): Promise<void> {
  await ctx.panel.evaluate<void>(
    `(() => {
      window.__guardPromise = window.__e2eRenderer.runActionGuard({
        installationId: ${JSON.stringify(INSTALL_ID)},
        actionLabel: ${JSON.stringify(actionLabel)},
      })
    })()`,
  )
}

function readGuardVerdict(): Promise<boolean> {
  return ctx.panel.evaluate<boolean>('window.__guardPromise')
}

test('useActionGuard fires cancel-operation when the user confirms cancelling the busy op @windows @macos @linux', async () => {
  await startInFlightOp()
  await runGuardInBackground('Restart ComfyUI')

  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await ctx.panel.click(byTestId(TID.baseAlertAction))).toBe(true)

  await expect
    .poll(async () => (await getIpcInvocations(ctx.app, 'cancel-operation')).length, {
      timeout: 5_000,
      intervals: [100, 200],
    })
    .toBeGreaterThanOrEqual(1)
  const cancelCalls = await getIpcInvocations(ctx.app, 'cancel-operation') as string[]
  expect(cancelCalls[0]).toBe(INSTALL_ID)

  await settleInFlightOp({ ok: false, cancelled: true })
  expect(await readGuardVerdict()).toBe(true)
})

test('useActionGuard returns false without cancelling when the user dismisses the confirm @windows @macos @linux', async () => {
  await startInFlightOp()
  await runGuardInBackground('Restart ComfyUI')

  await ctx.panel.waitForVisible(byTestId(TID.baseAlertCancel), { timeout: 10_000 })
  expect(await ctx.panel.click(byTestId(TID.baseAlertCancel))).toBe(true)
  expect(await readGuardVerdict()).toBe(false)

  const cancelCalls = await getIpcInvocations(ctx.app, 'cancel-operation')
  expect(cancelCalls.length).toBe(0)

  await settleInFlightOp({ ok: false, cancelled: true })
})

test('Return-to-Dashboard from in-flight op cancels and closes the takeover @windows @macos @linux', async () => {
  await seedRunningSession(ctx.app, {
    installationId: INSTALL_ID,
    installationName: INSTALL_NAME,
  })
  await expect
    .poll(
      async () => ctx.panel.evaluate<boolean>(
        `window.__e2eRenderer.isRunning(${JSON.stringify(INSTALL_ID)})`,
      ),
      { timeout: 5_000, intervals: [100, 200] },
    )
    .toBe(true)

  await startInFlightOp()
  expect(await ctx.panel.clickByText('button', 'Return to Dashboard')).toBe(true)

  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await ctx.panel.click(byTestId(TID.baseAlertAction))).toBe(true)

  await expect
    .poll(async () => (await getIpcInvocations(ctx.app, 'cancel-operation')).length, {
      timeout: 5_000,
      intervals: [100, 200],
    })
    .toBeGreaterThanOrEqual(1)
  await expect
    .poll(async () => (await getIpcInvocations(ctx.app, 'stop-comfyui')).length, {
      timeout: 5_000,
      intervals: [100, 200],
    })
    .toBeGreaterThanOrEqual(1)

  const cancelCalls = await getIpcInvocations(ctx.app, 'cancel-operation') as string[]
  expect(cancelCalls[0]).toBe(INSTALL_ID)

  await expect
    .poll(async () => ctx.panel.exists('.brand-progress'), {
      timeout: 5_000,
      intervals: [100, 200],
    })
    .toBe(false)

  await settleInFlightOp({ ok: false, cancelled: true })
})
