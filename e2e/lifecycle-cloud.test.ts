import { test, expect } from '@playwright/test'
import { evalWithRetry } from './support/evalRetry'
import { launchApp, type AppContext } from './launchApp'

let ctx: AppContext

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx.cleanup()
})

test('cold start lands on first-use start screen @lifecycle', async () => {
  await ctx.panel.waitForVisible('.start-hero', { timeout: 15_000 })
  await ctx.panel.waitForVisible('[data-testid="first-use-pick-cloud"]')
  await ctx.panel.waitForVisible('[data-testid="first-use-continue"]')
})

test('accept ToS + pick cloud auto-launches the seeded Cloud install @lifecycle', async () => {
  expect(await ctx.panel.click('[data-testid="first-use-pick-cloud"]')).toBe(true)

  expect(await ctx.panel.click('[data-testid="first-use-consent-tos"]')).toBe(true)
  await ctx.panel.waitFor(
    async () =>
      ctx.panel.evaluate<boolean>(
        `!document.querySelector('[data-testid="first-use-continue"]').disabled`
      ),
    { timeout: 5_000, message: 'Continue never became enabled after ticking ToS' }
  )

  expect(await ctx.panel.click('[data-testid="first-use-continue"]')).toBe(true)

  await expect
    .poll(() => ctx.titleBar.exists('[data-testid="title-build-tab"]'), {
      timeout: 30_000,
      intervals: [100, 200, 500]
    })
    .toBe(true)

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
      { timeout: 15_000, intervals: [200, 500, 1000] }
    )
    .toBe(true)
})
