import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { closeTitlePopupIfOpen, isPopupVisible, titlePopupPage } from './support/cdpPages'
import { clearRunningSessions, getIpcInvocations, resetIpcInvocations } from './support/devHooks'
import { desktopWindowCount, openPicker } from './support/navMatrixHelpers'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext

const CLOUD_ID = 'inst-nav-cloud-target'
const CLOUD_NAME = 'Nav Cloud Target'

test.describe.configure({ mode: 'serial' })

async function cloudRunActions(): Promise<{ installationId?: string }[]> {
  return (await getIpcInvocations(ctx.app, 'run-action')) as never
}

async function openCloudFromPicker(): Promise<void> {
  await openPicker(ctx.app, ctx.panel, 'pickInstall')
  const popup = titlePopupPage(ctx.app)
  const cloudRow = byTestId(TID.pickerRow(CLOUD_ID))
  await popup.waitForVisible(cloudRow)
  expect(await popup.click(cloudRow), 'Cloud instance selected').toBe(true)
  await expect
    .poll(() => popup.textOf(byTestId(TID.pickerPrimaryCta)), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toContain('Open Cloud')
  expect(await popup.exists(byTestId(TID.pickerNewWindow)), 'no "Open in new window" caret').toBe(
    false
  )
  expect(await popup.click(byTestId(TID.pickerPrimaryCta)), 'Open Cloud clicked').toBe(true)
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(false)
}

test.beforeAll(async () => {
  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [{ id: CLOUD_ID, name: CLOUD_NAME, sourceId: 'cloud', status: 'installed' }]
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  if (!ctx) return
  await clearRunningSessions(ctx.app)
  await ctx.cleanup()
})

test.beforeEach(async () => {
  await closeTitlePopupIfOpen(ctx.app)
  await resetIpcInvocations(ctx.app, 'run-action')
  await clearRunningSessions(ctx.app)
})

test('cloud target with no window: Open Cloud starts it from the Desktop window, no second Desktop window @windows @macos @linux', async () => {
  const desktopWindowsBefore = await desktopWindowCount(ctx.app)
  await openCloudFromPicker()

  await expect
    .poll(async () => (await cloudRunActions()).some((c) => c.installationId === CLOUD_ID), {
      timeout: 10_000,
      intervals: [200, 500]
    })
    .toBe(true)
  expect(await desktopWindowCount(ctx.app), 'no second Desktop window').toBe(desktopWindowsBefore)
})
