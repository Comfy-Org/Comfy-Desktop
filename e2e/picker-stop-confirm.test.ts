import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import {
  closeTitlePopupIfOpen,
  isPopupVisible,
  titlePopupPage,
  waitForWebContents
} from './support/cdpPages'
import {
  clearRunningSessions,
  getIpcInvocations,
  resetIpcInvocations,
  seedRunningSession
} from './support/devHooks'

let ctx: AppContext
let installPath: string

const INSTALL_ID = 'inst-picker-stop-confirm-test'
const INSTALL_NAME = 'Stop Me Before Updating'
const MARKER_FILENAME = '.comfyui-desktop-2'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-stop-confirm-e2e-'))
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
  await clearRunningSessions(ctx.app)
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

test.beforeEach(async () => {
  await closeTitlePopupIfOpen(ctx.app)
  await resetIpcInvocations(ctx.app, 'stop-comfyui')
  await resetIpcInvocations(ctx.app, 'run-action')
  await clearRunningSessions(ctx.app)
  await expect
    .poll(
      async () =>
        ctx.panel.evaluate<boolean>(
          `(() => window.__e2eRenderer?.isRunning(${JSON.stringify(INSTALL_ID)}) ?? true)()`
        ),
      { timeout: 5_000, intervals: [100, 200] }
    )
    .toBe(false)
})

async function openExpandedPicker(): Promise<void> {
  const opened = await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(INSTALL_ID)},
        initialTab: 'update',
      })
      return true
    })()`
  )
  expect(opened).toBe(true)
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitFor(
    async () =>
      popup.evaluate<boolean>(
        'typeof window.__comfyTitlePopup?.pickerForwardShowProgress === "function"'
      ),
    { timeout: 10_000, message: 'picker popup bridge never appeared on window.__comfyTitlePopup' }
  )
}

async function forwardUpdateActionFromPicker(): Promise<void> {
  const popup = titlePopupPage(ctx.app)
  await popup.evaluate<void>(
    `window.__comfyTitlePopup.pickerForwardShowProgress({
      installationId: ${JSON.stringify(INSTALL_ID)},
      actionId: 'update-comfyui',
      title: 'Update ComfyUI — ' + ${JSON.stringify(INSTALL_NAME)},
      cancellable: false,
      triggersInstanceStart: false,
      opKind: 'update',
    })`
  )
}

async function pollForForwardedUpdateDispatch(): Promise<void> {
  await expect
    .poll(
      async () => {
        const calls = (await getIpcInvocations(ctx.app, 'run-action')) as {
          installationId?: string
          actionId?: string
        }[]
        return calls.some((c) => c.actionId === 'update-comfyui')
      },
      {
        timeout: 10_000,
        intervals: [200, 500]
      }
    )
    .toBe(true)
}

test('Self-stops the running session and dispatches the action @windows @macos @linux', async () => {
  await seedRunningSession(ctx.app, {
    installationId: INSTALL_ID,
    installationName: INSTALL_NAME
  })
  await openExpandedPicker()
  await resetIpcInvocations(ctx.app, 'run-action')
  await forwardUpdateActionFromPicker()

  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(false)

  await expect
    .poll(async () => (await getIpcInvocations(ctx.app, 'stop-comfyui')).length, {
      timeout: 5_000,
      intervals: [100, 250]
    })
    .toBeGreaterThanOrEqual(1)
  await pollForForwardedUpdateDispatch()

  const runCalls = (await getIpcInvocations(ctx.app, 'run-action')) as {
    installationId?: string
    actionId?: string
  }[]
  const updateCall = runCalls.find((c) => c.actionId === 'update-comfyui')
  expect(updateCall?.installationId).toBe(INSTALL_ID)

  const stopCalls = await getIpcInvocations(ctx.app, 'stop-comfyui')
  expect(stopCalls.length).toBe(1)
})

test('Skips self-stop when the install is NOT running @windows @macos @linux', async () => {
  await openExpandedPicker()
  await resetIpcInvocations(ctx.app, 'run-action')
  await forwardUpdateActionFromPicker()

  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(false)

  await pollForForwardedUpdateDispatch()

  const stopCalls = await getIpcInvocations(ctx.app, 'stop-comfyui')
  expect(stopCalls.length).toBe(0)
})
