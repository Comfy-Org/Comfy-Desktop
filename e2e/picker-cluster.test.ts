import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible, expectTakeoverOpen } from './support/chooserHelpers'
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

const INSTALL_ID = 'inst-picker-cluster-test'
const INSTALL_NAME = 'Picker Cluster Me'
const MARKER_FILENAME = '.comfyui-desktop-2'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-picker-cluster-e2e-'))
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
  await resetIpcInvocations(ctx.app)
  await clearRunningSessions(ctx.app)
})

async function openExpandedPicker(): Promise<void> {
  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(INSTALL_ID)},
      })
      return true
    })()`
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitFor(
    async () =>
      popup.evaluate<boolean>('typeof window.__comfyTitlePopup?.pickInstall === "function"'),
    { timeout: 10_000, message: 'picker popup bridge never appeared on window.__comfyTitlePopup' }
  )
}

test('pick-install for a running install dismisses the popup and focuses the existing host @windows @macos @linux', async () => {
  await seedRunningSession(ctx.app, {
    installationId: INSTALL_ID,
    installationName: INSTALL_NAME
  })

  await openExpandedPicker()

  const popup = titlePopupPage(ctx.app)
  await popup.evaluate<void>(`window.__comfyTitlePopup.pickInstall(${JSON.stringify(INSTALL_ID)})`)

  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(false)

  const openNewWindowCalls = await getIpcInvocations(ctx.app, 'open-install-new-window')
  expect(openNewWindowCalls).toEqual([])
  const launchCalls = (await getIpcInvocations(ctx.app, 'run-action')) as { actionId?: string }[]
  expect(launchCalls.some((c) => c.actionId === 'launch')).toBe(false)
})

test('pick-install for a stopped install dismisses the popup and fires runAction(launch) @windows @macos @linux', async () => {
  await openExpandedPicker()

  const popup = titlePopupPage(ctx.app)
  await popup.evaluate<void>(`window.__comfyTitlePopup.pickInstall(${JSON.stringify(INSTALL_ID)})`)

  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(false)

  await expect
    .poll(
      async () => {
        const calls = (await getIpcInvocations(ctx.app, 'run-action')) as {
          installationId?: string
          actionId?: string
        }[]
        return calls.some((c) => c.installationId === INSTALL_ID && c.actionId === 'launch')
      },
      { timeout: 10_000, intervals: [200, 500] }
    )
    .toBe(true)

  const stopCalls = await getIpcInvocations(ctx.app, 'stop-comfyui')
  expect(stopCalls.length).toBe(0)

  const focusCalls = await getIpcInvocations(ctx.app, 'focus-comfy-window')
  expect(focusCalls.length).toBe(0)
})

test('open-new-install dismisses the popup and mounts the new-install takeover @windows @macos @linux', async () => {
  await openExpandedPicker()

  const popup = titlePopupPage(ctx.app)
  await popup.evaluate<void>(`window.__comfyTitlePopup.openNewInstall()`)

  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(false)

  await expectTakeoverOpen(ctx.panel)
  await ctx.panel.waitForVisible('.config-shell', { timeout: 10_000 })

  const tail = await ctx.panel.evaluate<number | null>(
    `(() => {
      const shell = document.querySelector('.config-shell')
      let box = shell.parentElement
      while (box && getComputedStyle(box).overflowY !== 'auto') box = box.parentElement
      if (!box) return null
      const top = box.getBoundingClientRect().top - box.scrollTop
      const contentEnd = shell.getBoundingClientRect().bottom - top
        + parseFloat(getComputedStyle(box).paddingBottom)
      return box.scrollHeight - Math.max(box.clientHeight, Math.ceil(contentEnd))
    })()`
  )
  expect(tail, 'Configure should have a scrolling box').not.toBeNull()
  expect(tail, 'Configure should not scroll past the end of its form').toBeLessThanOrEqual(2)
})

test('open-install-action with reveal-in-folder keeps the popup open and fires the action @windows @macos @linux', async () => {
  await openExpandedPicker()

  const popup = titlePopupPage(ctx.app)
  await popup.evaluate<void>(
    `window.__comfyTitlePopup.openInstallAction(${JSON.stringify(INSTALL_ID)}, 'reveal-in-folder')`
  )

  await expect
    .poll(
      async () => {
        const calls = (await getIpcInvocations(ctx.app, 'run-action')) as {
          installationId?: string
          actionId?: string
        }[]
        return calls.some((c) => c.installationId === INSTALL_ID && c.actionId === 'open-folder')
      },
      { timeout: 5_000, intervals: [100, 250] }
    )
    .toBe(true)

  expect(
    await isPopupVisible(ctx.app, 'comfyTitlePopup.html'),
    'picker popup should remain open for non-modal Open Folder action'
  ).toBe(true)
})
