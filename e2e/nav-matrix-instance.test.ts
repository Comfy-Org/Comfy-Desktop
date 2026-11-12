import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { closeTitlePopupIfOpen, titlePopupPage } from './support/cdpPages'
import {
  clearRunningSessions,
  getIpcInvocations,
  resetIpcInvocations,
  seedRunningSession
} from './support/devHooks'
import { expectNoIpcInvocation, liveWindowCount, openPicker } from './support/navMatrixHelpers'

let ctx: AppContext
let installPathA: string
let installPathB: string

const INSTALL_A_ID = 'inst-nav-inst-a'
const INSTALL_A_NAME = 'Nav Inst A'
const INSTALL_B_ID = 'inst-nav-inst-b'
const INSTALL_B_NAME = 'Nav Inst B'
const MARKER_FILENAME = '.comfyui-desktop-2'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installPathA = await mkdtemp(path.join(os.tmpdir(), 'comfyui-nav-inst-a-'))
  installPathB = await mkdtemp(path.join(os.tmpdir(), 'comfyui-nav-inst-b-'))
  await mkdir(installPathA, { recursive: true })
  await mkdir(installPathB, { recursive: true })
  await writeFile(path.join(installPathA, MARKER_FILENAME), INSTALL_A_ID)
  await writeFile(path.join(installPathB, MARKER_FILENAME), INSTALL_B_ID)

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: INSTALL_A_ID,
        name: INSTALL_A_NAME,
        installPath: installPathA,
        sourceId: 'standalone',
        status: 'installed'
      },
      {
        id: INSTALL_B_ID,
        name: INSTALL_B_NAME,
        installPath: installPathB,
        sourceId: 'standalone',
        status: 'installed'
      }
    ]
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  if (ctx) {
    await clearRunningSessions(ctx.app)
    await ctx.cleanup()
  }
  if (installPathA) await rm(installPathA, { recursive: true, force: true })
  if (installPathB) await rm(installPathB, { recursive: true, force: true })
})

test.beforeEach(async () => {
  await closeTitlePopupIfOpen(ctx.app)
  await resetIpcInvocations(ctx.app, 'focus-comfy-window')
  await resetIpcInvocations(ctx.app, 'run-action')
  await resetIpcInvocations(ctx.app, 'open-install-new-window')
  await clearRunningSessions(ctx.app)
})

test('Instance B via "Open in new window": spawns a new window (no swap of the host) @windows @macos @linux', async () => {
  const before = await liveWindowCount(ctx.app)
  await openPicker(ctx.app, ctx.panel, 'openInstallNewWindow')

  const popup = titlePopupPage(ctx.app)
  await popup.evaluate<void>(
    `window.__comfyTitlePopup.openInstallNewWindow(${JSON.stringify(INSTALL_B_ID)})`
  )

  await expect
    .poll(
      async () => {
        const calls = (await getIpcInvocations(ctx.app, 'open-install-new-window')) as {
          installationId?: string
          focusedExisting?: boolean
        }[]
        return calls.some((c) => c.installationId === INSTALL_B_ID && c.focusedExisting === false)
      },
      { timeout: 5_000, intervals: [100, 250] }
    )
    .toBe(true)

  await expect
    .poll(() => liveWindowCount(ctx.app), { timeout: 5_000, intervals: [200, 400] })
    .toBe(before + 1)
  await expectNoIpcInvocation(ctx.app, 'focus-comfy-window', () => true, {
    message: 'unexpected focus-comfy-window when opening B in a new window'
  })
})

test('Instance B (running elsewhere): focus its existing window @windows @macos @linux', async () => {
  await seedRunningSession(ctx.app, {
    installationId: INSTALL_B_ID,
    installationName: INSTALL_B_NAME
  })
  const before = await liveWindowCount(ctx.app)
  await openPicker(ctx.app, ctx.panel, 'openInstallNewWindow')

  const popup = titlePopupPage(ctx.app)
  await popup.evaluate<void>(
    `window.__comfyTitlePopup.pickInstall(${JSON.stringify(INSTALL_B_ID)})`
  )

  await expectNoIpcInvocation(ctx.app, 'open-install-new-window', () => true, {
    message: 'unexpected new window for a build that is already running'
  })
  await expectNoIpcInvocation(ctx.app, 'run-action', (c) => c.actionId === 'launch', {
    message: 'unexpected run-action launch on a focus-existing path'
  })
  expect(await liveWindowCount(ctx.app)).toBe(before)
})
