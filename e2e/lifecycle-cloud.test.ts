import { test, expect } from '@playwright/test'
import { evalWithRetry } from './support/evalRetry'
import { launchApp, type AppContext } from './launchApp'
import { titlePopupPage, waitForWebContents } from './support/cdpPages'

let ctx: AppContext

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx.cleanup()
})

test('cold start lands on Set up @lifecycle', async () => {
  await ctx.panel.waitForVisible('[data-testid="setup-screen"]', { timeout: 15_000 })
  await ctx.panel.waitForVisible('[data-testid="setup-install"]')
})

test('skipping Set up and opening the Comfy Cloud card launches the seeded Cloud install @lifecycle', async () => {
  expect(await ctx.panel.click('[data-testid="setup-consent-tos"] [role="checkbox"]')).toBe(true)
  expect(await ctx.panel.click('[data-testid="setup-change"]')).toBe(true)

  await ctx.titleBar.waitForVisible('.title-menu-button[aria-haspopup="menu"]', { timeout: 15_000 })
  expect(await ctx.titleBar.click('.title-menu-button[aria-haspopup="menu"]')).toBe(true)
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible('li.item', { timeout: 10_000 })
  expect(await popup.clickByText('li.item', 'Skip Onboarding')).toBe(true)

  await ctx.panel.waitForVisible('[data-testid="home-view"]', { timeout: 10_000 })
  expect(await ctx.panel.clickByText('[data-testid="home-build"]', 'Comfy Cloud')).toBe(true)

  await expect
    .poll(
      () =>
        evalWithRetry(() =>
          ctx.app.evaluate(({ webContents }) =>
            webContents
              .getAllWebContents()
              .some((wc) => /^https:\/\/(cloud\.)?comfy\.org\//.test(wc.getURL()))
          )
        ),
      { timeout: 45_000, intervals: [200, 500, 1000] }
    )
    .toBe(true)
})
