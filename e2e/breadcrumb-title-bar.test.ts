/**
 * E2E: the breadcrumb title bar (redesign Milestone 3).
 *
 * The dashboard window's bar reads "Builds › Open a build"; its chevron opens
 * the build switcher, listing the seeded builds. Picking a build hands it to
 * main to open in a window of its own, and the dashboard window stays as it
 * is. What the new window loads is Comfy Cloud's, so it is not asserted here.
 */
import { test, expect } from '@playwright/test'
import { launchApp } from './launchApp'
import type { AppContext } from './launchApp'
import { isPopupVisible, titlePopupPage, WebContentsPage } from './support/cdpPages'
import { clearRunningSessions, getIpcInvocations } from './support/devHooks'

let ctx: AppContext

const CLOUD_ID = 'inst-breadcrumb-cloud'
const CLOUD_NAME = 'Comfy Cloud'
const SWITCHER = '[data-testid="title-crumb-switcher"]'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false, newDashboardEnabled: true },
    installations: [{ id: CLOUD_ID, name: CLOUD_NAME, sourceId: 'cloud', status: 'installed' }]
  })
  await ctx.titleBar.waitForSelector('[data-testid="title-breadcrumb"]', { timeout: 15_000 })
})

test.afterAll(async () => {
  if (!ctx) return
  await clearRunningSessions(ctx.app)
  await ctx.cleanup()
})

test('the dashboard window offers to open a build @windows @macos @linux', async () => {
  expect(await ctx.titleBar.textOf('[data-testid="title-crumb-root"]')).toContain('Builds')
  expect(await ctx.titleBar.textOf(SWITCHER)).toContain('Open a build')
  expect(await ctx.titleBar.exists('[data-testid="title-crumb-build"]')).toBe(false)
})

test('the chevron opens the build switcher @windows @macos @linux', async () => {
  expect(await ctx.titleBar.click(SWITCHER)).toBe(true)
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), { timeout: 5_000 })
    .toBe(true)
  const popup = titlePopupPage(ctx.app)
  await expect.poll(() => popup.textOf('.menu')).toContain(CLOUD_NAME)
  expect(await popup.textOf('.menu')).toContain('Manage builds')
})

test('a picked build opens in its own window and the dashboard stays @windows @macos @linux', async () => {
  expect(await titlePopupPage(ctx.app).clickByText('[role="menuitem"]', CLOUD_NAME)).toBe(true)

  await expect
    .poll(async () => {
      const calls = (await getIpcInvocations(ctx.app, 'open-install-new-window')) as {
        installationId?: string
      }[]
      return calls.some((call) => call.installationId === CLOUD_ID)
    })
    .toBe(true)
  // The dashboard's own bar: ctx.titleBar could match the new window's too.
  const dashboardBar = new WebContentsPage(ctx.app, 'comfyTitleBar.html?installationId=&')
  expect(await dashboardBar.textOf(SWITCHER)).toContain('Open a build')
})
