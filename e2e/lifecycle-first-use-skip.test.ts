/**
 * Lifecycle E2E: file-menu Skip Onboarding entry point.
 *
 * Cold-start drops the user on the merged first-use start screen, where
 * the title-bar waffle menu is hidden (`'consent-lockdown'`). Completing
 * the start step (ToS + Local + Continue) moves first-use to
 * `'post-consent'`, which surfaces the menu with its single Skip
 * Onboarding entry. The test drives that real chain: tick ToS, pick
 * Local (non-express), Continue into the New Install takeover, then
 * click the waffle menu's Skip Onboarding item.
 *
 * Asserts `completeFirstUseAndDismiss` runs end-to-end:
 *   - persists `firstUseCompleted: true` (one set-setting call)
 *   - drops the takeover chain and reveals the chooser body
 *   - pushes `'none'` as the host's `firstUseMode`
 */

import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'
import { titlePopupPage, waitForWebContents } from './support/cdpPages'

let ctx: AppContext

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  // True cold start — no `firstUseCompleted` seed, so the host opens
  // on the first-use takeover.
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('cold start lands on first-use start screen with the waffle menu hidden @lifecycle', async () => {
  // Consent + cloud/local pick share a single merged start screen
  // (commit 5619823). The hero + Continue CTA prove we've reached the
  // takeover.
  await ctx.panel.waitForVisible('.start-hero', { timeout: 15_000 })
  await ctx.panel.waitForVisible('[data-testid="first-use-continue"]')

  // `'consent-lockdown'` hides the waffle menu — Skip Onboarding must
  // not be reachable before the ToS step completes.
  expect(await ctx.titleBar.exists('.title-menu-button')).toBe(false)
})

test('ToS + Local + Continue surfaces the waffle menu; Skip Onboarding reveals the chooser @lifecycle', async () => {
  // Complete the merged start step the way a user would: pick Local,
  // uncheck the express-install default (the express path would start a
  // real download), tick ToS, Continue → New Install takeover. This is
  // what flips first-use to `'post-consent'` and unhides the menu.
  expect(await ctx.panel.click('[data-testid="first-use-pick-local"]')).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="first-use-express-install"]', { timeout: 5_000 })
  await ctx.panel.evaluate<void>(
    `(() => {
      const wrap = document.querySelector('[data-testid="first-use-express-install"]')
      const cb = wrap && wrap.querySelector('input[type="checkbox"]')
      if (cb && cb.checked) cb.click()
    })()`,
  )
  expect(await ctx.panel.click('[data-testid="first-use-consent-tos"]')).toBe(true)
  await ctx.panel.waitFor(
    async () => ctx.panel.evaluate<boolean>(
      `!document.querySelector('[data-testid="first-use-continue"]').disabled`,
    ),
    { timeout: 5_000, message: 'Continue never became enabled after ticking ToS' },
  )

  // Reset so the assertions below count only the calls produced by the
  // Skip Onboarding click (boot exercised consent-step mounting which
  // pushed `'consent-lockdown'`; Continue pushes `'post-consent'`).
  await resetIpcInvocations(ctx.app, 'set-setting')

  expect(await ctx.panel.click('[data-testid="first-use-continue"]')).toBe(true)

  // The waffle menu unhides once the mode leaves consent-lockdown.
  await ctx.titleBar.waitForVisible('.title-menu-button', { timeout: 15_000 })
  await resetIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode')

  // Real trigger: open the waffle menu and click its Skip Onboarding
  // item (the popup's only entry in post-consent mode).
  expect(await ctx.titleBar.click('.title-menu-button')).toBe(true)
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible('li.item', { timeout: 10_000 })
  expect(await popup.clickByText('li.item', 'Skip Onboarding')).toBe(true)

  // Takeover chain dismisses → chooser body becomes visible. The cloud +
  // new-install tiles are always rendered, so polling the chooser-view
  // selector is enough to confirm the host body unblocked.
  await ctx.panel.waitForVisible('.chooser-view', { timeout: 10_000 })

  // `completeFirstUseAndDismiss` calls `markFirstUseCompleted` then
  // pushes `'none'` as the firstUseMode. set-setting is idempotent
  // (useLauncherPrefs short-circuits when the ref is already true),
  // so this is the single persist call expected from the skip path.
  await expect.poll(
    async () => {
      const calls = await getIpcInvocations(ctx.app, 'set-setting') as Array<{ key: string; value: unknown }>
      return calls.filter((c) => c.key === 'firstUseCompleted' && c.value === true).length
    },
    { timeout: 5_000, intervals: [100, 250] },
  ).toBe(1)

  const modeCalls = await getIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode') as Array<{ mode: string }>
  // The takeover's `onUnmounted` push and the chain's explicit push
  // both land here — either is acceptable, but the FINAL value the
  // host sees must be `'none'` so the file-menu builder stops
  // surfacing the Skip Onboarding entry.
  expect(modeCalls.length).toBeGreaterThan(0)
  expect(modeCalls[modeCalls.length - 1]!.mode).toBe('none')
})
