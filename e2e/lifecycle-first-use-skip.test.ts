import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'
import { titlePopupPage, waitForWebContents } from './support/cdpPages'

let ctx: AppContext

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('cold start lands on Set up with the waffle menu hidden @lifecycle', async () => {
  await ctx.panel.waitForVisible('[data-testid="setup-screen"]', { timeout: 15_000 })
  await ctx.panel.waitForVisible('[data-testid="setup-install"]')

  expect(await ctx.titleBar.exists('.title-menu-button[aria-haspopup="menu"]')).toBe(false)
})

test('ToS + Change surfaces the waffle menu; Skip Onboarding reveals Home @lifecycle', async () => {
  expect(await ctx.panel.click('[data-testid="setup-consent-tos"] [role="checkbox"]')).toBe(true)

  await resetIpcInvocations(ctx.app, 'set-setting')

  expect(await ctx.panel.click('[data-testid="setup-change"]')).toBe(true)

  await ctx.titleBar.waitForVisible('.title-menu-button[aria-haspopup="menu"]', { timeout: 15_000 })
  await resetIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode')

  expect(await ctx.titleBar.click('.title-menu-button[aria-haspopup="menu"]')).toBe(true)
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible('li.item', { timeout: 10_000 })
  expect(await popup.clickByText('li.item', 'Skip Onboarding')).toBe(true)

  await ctx.panel.waitForVisible('[data-testid="home-view"]', { timeout: 10_000 })

  await expect
    .poll(
      async () => {
        const calls = (await getIpcInvocations(ctx.app, 'set-setting')) as Array<{
          key: string
          value: unknown
        }>
        return calls.filter((c) => c.key === 'firstUseCompleted' && c.value === true).length
      },
      { timeout: 5_000, intervals: [100, 250] }
    )
    .toBe(1)

  const modeCalls = (await getIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode')) as Array<{
    mode: string
  }>
  expect(modeCalls.length).toBeGreaterThan(0)
  expect(modeCalls[modeCalls.length - 1]!.mode).toBe('none')
})
