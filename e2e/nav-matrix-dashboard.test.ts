/**
 * E2E: instance/window navigation matrix — Dashboard → X (issue #926).
 *
 * Drives dashboard tiles and the picker bridge from a dashboard (chooser)
 * host, then asserts navigation via recorded IPC invocations + BrowserWindow
 * counts. Mirrors `picker-cluster.test.ts`.
 *
 * Covers: stopped instance → new window; running instance → focus;
 * cloud → new-window via the caret. The decision itself is exhaustively unit
 * tested (`navDecision.test.ts`); this pins the bridge → main → window wiring.
 */
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { byTestId, TID } from './support/testIds'
import {
  closeTitlePopupIfOpen,
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

test('Dashboard → stopped instance: opens a new window and preserves the dashboard @windows @macos @linux', async () => {
  const before = await liveWindowCount(ctx.app)
  expect(await ctx.panel.click(byTestId(TID.dashboardTile(INSTALL_A_ID)))).toBe(true)

  // The dashboard tile routes through main's new-window helper, which creates
  // the target host before dispatching its launch.
  await expect.poll(async () => {
    const calls = (await getIpcInvocations(ctx.app, 'open-install-new-window')) as { installationId?: string; focusedExisting?: boolean }[]
    return calls.some((c) => c.installationId === INSTALL_A_ID && c.focusedExisting === false)
  }, { timeout: 5_000, intervals: [100, 250] }).toBe(true)

  await expect.poll(() => liveWindowCount(ctx.app), { timeout: 5_000, intervals: [200, 400] }).toBe(before + 1)
  await expectNoIpcInvocation(ctx.app, 'focus-comfy-window', () => true, {
    message: 'unexpected focus-comfy-window on a stopped dashboard launch',
  })
})

test('Dashboard → running instance: focus existing window @windows @macos @linux', async () => {
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

test('Dashboard → cloud via "Open in new window": spawns a new window @windows @macos @linux', async () => {
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
