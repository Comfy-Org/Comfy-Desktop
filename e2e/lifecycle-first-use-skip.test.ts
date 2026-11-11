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

test('cold start lands on first-use start screen with the waffle menu hidden @lifecycle', async () => {
  await ctx.panel.waitForVisible('.start-hero', { timeout: 15_000 })
  await ctx.panel.waitForVisible('[data-testid="first-use-continue"]')

  expect(await ctx.titleBar.exists('.title-menu-button')).toBe(false)
})

test('ToS + Local + Continue surfaces the waffle menu; Skip Onboarding reveals the chooser @lifecycle', async () => {
  expect(await ctx.panel.click('[data-testid="first-use-pick-local"]')).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="first-use-express-install"]', { timeout: 5_000 })
  await ctx.panel.evaluate<void>(
    `(() => {
      const wrap = document.querySelector('[data-testid="first-use-express-install"]')
      const cb = wrap && wrap.querySelector('[role="checkbox"]')
      if (cb && cb.getAttribute('aria-checked') === 'true') cb.click()
    })()`
  )
  expect(await ctx.panel.click('[data-testid="first-use-consent-tos"]')).toBe(true)
  await ctx.panel.waitFor(
    async () =>
      ctx.panel.evaluate<boolean>(
        `!document.querySelector('[data-testid="first-use-continue"]').disabled`
      ),
    { timeout: 5_000, message: 'Continue never became enabled after ticking ToS' }
  )

  await resetIpcInvocations(ctx.app, 'set-setting')

  expect(await ctx.panel.click('[data-testid="first-use-continue"]')).toBe(true)

  await ctx.titleBar.waitForVisible('.title-menu-button', { timeout: 15_000 })
  await resetIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode')

  expect(await ctx.titleBar.click('.title-menu-button')).toBe(true)
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
