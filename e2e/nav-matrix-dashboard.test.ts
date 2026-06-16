/**
 * E2E: instance/window navigation matrix — Dashboard → X (issue #926).
 *
 * Drives the real picker bridge (`window.__comfyTitlePopup`) from a dashboard
 * (chooser) host and asserts the navigation outcome via recorded IPC
 * invocations + BrowserWindow counts. Mirrors `lifecycle-picker-cluster.test.ts`.
 *
 * Covers: stopped instance → same-window launch; running instance → focus;
 * cloud → new-window via the caret. The decision itself is exhaustively unit
 * tested (`navDecision.test.ts`); this pins the bridge → main → window wiring.
 */
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
} from './support/cdpPages'
import {
  clearRunningSessions,
  getIpcInvocations,
  resetIpcInvocations,
  seedRunningSession,
} from './support/devHooks'
import { expectNoIpcInvocation, liveWindowCount, openPicker } from './support/navMatrixHelpers'

let ctx: AppContext
let installPathA: string
let installPathB: string

const INSTALL_A_ID = 'inst-nav-dash-a'
const INSTALL_A_NAME = 'Nav Dash A'
const INSTALL_B_ID = 'inst-nav-dash-b'
const INSTALL_B_NAME = 'Nav Dash B'
const CLOUD_ID = 'inst-nav-dash-cloud'
const CLOUD_NAME = 'Nav Dash Cloud'
const MARKER_FILENAME = '.comfyui-desktop-2'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installPathA = await mkdtemp(path.join(os.tmpdir(), 'comfyui-nav-dash-a-'))
  installPathB = await mkdtemp(path.join(os.tmpdir(), 'comfyui-nav-dash-b-'))
  await mkdir(installPathA, { recursive: true })
  await mkdir(installPathB, { recursive: true })
  await writeFile(path.join(installPathA, MARKER_FILENAME), INSTALL_A_ID)
  await writeFile(path.join(installPathB, MARKER_FILENAME), INSTALL_B_ID)

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      { id: INSTALL_A_ID, name: INSTALL_A_NAME, installPath: installPathA, sourceId: 'standalone', status: 'installed' },
      { id: INSTALL_B_ID, name: INSTALL_B_NAME, installPath: installPathB, sourceId: 'standalone', status: 'installed' },
      { id: CLOUD_ID, name: CLOUD_NAME, sourceId: 'cloud', status: 'installed' },
    ],
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

test('Dashboard → stopped instance: same-window launch, no new window @lifecycle', async () => {
  const before = await liveWindowCount(ctx.app)
  await openPicker(ctx.app, ctx.panel, 'pickInstall')

  const popup = titlePopupPage(ctx.app)
  await popup.evaluate<void>(`window.__comfyTitlePopup.pickInstall(${JSON.stringify(INSTALL_A_ID)})`)

  await expect.poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
    timeout: 5_000, intervals: [100, 200],
  }).toBe(false)

  // Stopped pick from the chooser host runs `runAction('launch')` in place.
  await expect.poll(async () => {
    const calls = (await getIpcInvocations(ctx.app, 'run-action')) as { installationId?: string; actionId?: string }[]
    return calls.some((c) => c.installationId === INSTALL_A_ID && c.actionId === 'launch')
  }, { timeout: 10_000, intervals: [200, 500] }).toBe(true)

  // Same window — no new host spawned, no focus-existing. Sample the full window
  // so a late `focus-comfy-window` IPC can't slip in (a poll would pass at t=0).
  expect(await liveWindowCount(ctx.app)).toBe(before)
  await expectNoIpcInvocation(ctx.app, 'focus-comfy-window', () => true, {
    message: 'unexpected focus-comfy-window on a same-window launch',
  })
})

test('Dashboard → running instance: focus existing window @lifecycle', async () => {
  await seedRunningSession(ctx.app, { installationId: INSTALL_A_ID, installationName: INSTALL_A_NAME })
  const before = await liveWindowCount(ctx.app)
  await openPicker(ctx.app, ctx.panel, 'pickInstall')

  const popup = titlePopupPage(ctx.app)
  await popup.evaluate<void>(`window.__comfyTitlePopup.pickInstall(${JSON.stringify(INSTALL_A_ID)})`)

  await expect.poll(async () => {
    const calls = (await getIpcInvocations(ctx.app, 'focus-comfy-window')) as { installationId?: string }[]
    return calls.some((c) => c.installationId === INSTALL_A_ID)
  }, { timeout: 5_000, intervals: [100, 250] }).toBe(true)

  // Focus path, NOT a relaunch: no `launch` run-action, and no new window.
  // Sample the full window so a late `launch` IPC can't slip past.
  await expectNoIpcInvocation(ctx.app, 'run-action', (c) => c.actionId === 'launch', {
    message: 'unexpected run-action launch on a focus-existing path',
  })
  expect(await liveWindowCount(ctx.app)).toBe(before)
})

test('Dashboard → cloud via "Open in new window": spawns a new window @lifecycle', async () => {
  const before = await liveWindowCount(ctx.app)
  await openPicker(ctx.app, ctx.panel, 'pickInstall')

  // The caret's secondary action calls openInstallNewWindow directly.
  const popup = titlePopupPage(ctx.app)
  await popup.evaluate<void>(`window.__comfyTitlePopup.openInstallNewWindow(${JSON.stringify(CLOUD_ID)})`)

  await expect.poll(async () => {
    const calls = (await getIpcInvocations(ctx.app, 'open-install-new-window')) as { installationId?: string; focusedExisting?: boolean }[]
    return calls.some((c) => c.installationId === CLOUD_ID && c.focusedExisting === false)
  }, { timeout: 5_000, intervals: [100, 250] }).toBe(true)

  // A fresh chooser host window was spawned for the cloud install.
  await expect.poll(() => liveWindowCount(ctx.app), { timeout: 5_000, intervals: [200, 400] }).toBe(before + 1)
})
