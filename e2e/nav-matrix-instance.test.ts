/**
 * E2E: instance/window navigation matrix — Instance → X (issue #926).
 *
 * Asserts the bridge → main → window wiring for the instance-host deltas via
 * recorded IPC + window counts. The decision logic is exhaustively unit tested
 * (`navDecision.test.ts`); this pins the side effects.
 *
 * NOTE on the 3-way "Switch / Open in new window / Cancel" modal: it fires in
 * main's `pickInstallFromPicker` only when the picker's PARENT host is an
 * install-backed LOCAL entry. Standing up a truly attached local host in e2e
 * needs a real ComfyUI process, which the harness fakes but does not attach — so
 * the modal's rendering is covered by unit + manual verification. Here we pin
 * the routing that the modal's "Open in new window" button triggers: the
 * `openInstallNewWindow` bridge → `open-install-new-window` IPC → fresh window,
 * which is the new behavior that matters.
 */
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
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
      { id: INSTALL_A_ID, name: INSTALL_A_NAME, installPath: installPathA, sourceId: 'standalone', status: 'installed' },
      { id: INSTALL_B_ID, name: INSTALL_B_NAME, installPath: installPathB, sourceId: 'standalone', status: 'installed' },
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

test('Instance B via "Open in new window": spawns a new window (no swap of the host) @lifecycle', async () => {
  // B has no window of its own, so the caret action spawns a fresh host for it
  // without touching the picker's host. Mirrors the passing dashboard→cloud case.
  const before = await liveWindowCount(ctx.app)
  await openPicker(ctx.app, ctx.panel, 'openInstallNewWindow')

  const popup = titlePopupPage(ctx.app)
  await popup.evaluate<void>(`window.__comfyTitlePopup.openInstallNewWindow(${JSON.stringify(INSTALL_B_ID)})`)

  await expect.poll(async () => {
    const calls = (await getIpcInvocations(ctx.app, 'open-install-new-window')) as
      { installationId?: string; focusedExisting?: boolean }[]
    return calls.some((c) => c.installationId === INSTALL_B_ID && c.focusedExisting === false)
  }, { timeout: 5_000, intervals: [100, 250] }).toBe(true)

  // A fresh window was added (a swap would keep the count flat) and the host was
  // not focused away — the picker's host is left untouched. Sample the full
  // window so a late `focus-comfy-window` IPC can't slip past.
  await expect.poll(() => liveWindowCount(ctx.app), { timeout: 5_000, intervals: [200, 400] }).toBe(before + 1)
  await expectNoIpcInvocation(ctx.app, 'focus-comfy-window', () => true, {
    message: 'unexpected focus-comfy-window when opening B in a new window',
  })
})

test('Instance B (running elsewhere): focus its existing window @lifecycle', async () => {
  await seedRunningSession(ctx.app, { installationId: INSTALL_B_ID, installationName: INSTALL_B_NAME })
  const before = await liveWindowCount(ctx.app)
  await openPicker(ctx.app, ctx.panel, 'openInstallNewWindow')

  const popup = titlePopupPage(ctx.app)
  await popup.evaluate<void>(`window.__comfyTitlePopup.pickInstall(${JSON.stringify(INSTALL_B_ID)})`)

  await expect.poll(async () => {
    const calls = (await getIpcInvocations(ctx.app, 'focus-comfy-window')) as { installationId?: string }[]
    return calls.some((c) => c.installationId === INSTALL_B_ID)
  }, { timeout: 5_000, intervals: [100, 250] }).toBe(true)

  // Focus path, NOT a relaunch: no `launch` run-action fired. Sample the full
  // window so a late `launch` IPC can't slip past.
  await expectNoIpcInvocation(ctx.app, 'run-action', (c) => c.actionId === 'launch', {
    message: 'unexpected run-action launch on a focus-existing path',
  })
  expect(await liveWindowCount(ctx.app)).toBe(before)
})

// NOTE: the "already-running local install focuses instead of duplicating"
// invariant (one process = one window) is covered reliably by the cloud spec's
// allowDuplicate control test, where the target genuinely owns a window. Standing
// up a real local-install window in e2e needs a live ComfyUI process, so it's not
// reproduced here.
