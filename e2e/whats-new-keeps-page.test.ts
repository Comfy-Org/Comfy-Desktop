import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible, pickFromTitleMenu } from './support/chooserHelpers'

const BELL = '.title-announcement-button'
const WHATS_NEW_CLOSE = '[data-testid="announcement-close"]'
const PERFORMANCE_TEST = '[data-testid="performance-test"]'
const DASHBOARD_SEARCH = '.chooser-search input'

let ctx: AppContext

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
})

test.afterAll(async () => {
  await ctx.cleanup()
})

async function openWhatsNew(): Promise<void> {
  expect(await ctx.titleBar.click(BELL)).toBe(true)
  await ctx.panel.waitForVisible(WHATS_NEW_CLOSE)
}

async function settleClose(): Promise<void> {
  await expect.poll(() => ctx.panel.exists(WHATS_NEW_CLOSE)).toBe(false)
  await ctx.panel.evaluate(`window.api.getSetting('comfyApiAnnouncementSeen')`)
}

test("closing What's New stays on the Performance Tests page @windows @macos @linux", async () => {
  await pickFromTitleMenu(ctx.app, ctx.titleBar, 'Performance Tests')
  await ctx.panel.waitForVisible(PERFORMANCE_TEST)

  await openWhatsNew()
  expect(await ctx.panel.click(WHATS_NEW_CLOSE)).toBe(true)
  await settleClose()

  expect(await ctx.panel.isVisible(PERFORMANCE_TEST)).toBe(true)
  expect(await ctx.panel.isVisible('.panel-chooser')).toBe(false)
})

test("Escape closes What's New and stays on the same page @windows @macos @linux", async () => {
  await openWhatsNew()
  await ctx.panel.pressKey('Escape')
  await settleClose()

  expect(await ctx.panel.isVisible(PERFORMANCE_TEST)).toBe(true)
})

test("What's New keeps the dashboard's search text @windows @macos @linux", async () => {
  expect(await ctx.panel.click('[data-testid="app-sidebar-chooser"]')).toBe(true)
  await expectChooserVisible(ctx.panel)
  await ctx.panel.fill(DASHBOARD_SEARCH, 'flux')

  await openWhatsNew()
  expect(await ctx.panel.click(WHATS_NEW_CLOSE)).toBe(true)
  await settleClose()

  expect(
    await ctx.panel.evaluate<string>(
      `document.querySelector(${JSON.stringify(DASHBOARD_SEARCH)}).value`
    )
  ).toBe('flux')
})
