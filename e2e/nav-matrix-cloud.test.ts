/**
 * E2E: instance/window navigation matrix — cloud-target deltas (issue #926).
 *
 * Pins the dashboard cloud target's "Open in new window" picker action via
 * recorded IPC + window count. No real cloud attach or network is needed.
 */
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
} from './support/devHooks'
import { liveWindowCount, openPicker } from './support/navMatrixHelpers'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext

const CLOUD_ID = 'inst-nav-cloud-target'
const CLOUD_NAME = 'Nav Cloud Target'

test.describe.configure({ mode: 'serial' })

async function newWindowCalls(): Promise<{ installationId?: string; focusedExisting?: boolean }[]> {
  return (await getIpcInvocations(ctx.app, 'open-install-new-window')) as never
}

async function openCloudInNewWindow(): Promise<void> {
  await openPicker(ctx.app, ctx.panel, 'openInstallNewWindow')
  const popup = titlePopupPage(ctx.app)
  const cloudRow = byTestId(TID.pickerRow(CLOUD_ID))
  await popup.waitForVisible(cloudRow)
  expect(await popup.click(cloudRow), 'Cloud instance selected').toBe(true)
  await popup.waitForVisible(byTestId(TID.pickerNewWindow))
  expect(await popup.click(byTestId(TID.pickerNewWindow)), 'Window options clicked').toBe(true)
  const openNewItem = byTestId(TID.pinBottomAction('nav:0'))
  await popup.waitForVisible(openNewItem)
  expect(await popup.click(openNewItem), 'Open in new window clicked').toBe(true)
  await expect.poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), { timeout: 5_000, intervals: [100, 200] }).toBe(false)
}

test.beforeAll(async () => {
  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      { id: CLOUD_ID, name: CLOUD_NAME, sourceId: 'cloud', status: 'installed' },
    ],
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
  await resetIpcInvocations(ctx.app, 'open-install-new-window')
  await clearRunningSessions(ctx.app)
})

test('cloud target with no window: opens a new window @lifecycle', async () => {
  const before = await liveWindowCount(ctx.app)
  await openCloudInNewWindow()

  await expect.poll(
    async () => (await newWindowCalls()).some((c) => c.installationId === CLOUD_ID && c.focusedExisting === false),
    { timeout: 5_000, intervals: [100, 250] },
  ).toBe(true)
  await expect.poll(() => liveWindowCount(ctx.app), { timeout: 5_000, intervals: [200, 400] }).toBe(before + 1)
})
