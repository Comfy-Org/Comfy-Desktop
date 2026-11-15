import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'

let ctx: AppContext

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

async function lastFirstUseMode(): Promise<string | undefined> {
  const calls = (await getIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode')) as Array<{
    mode: string
  }>
  return calls[calls.length - 1]?.mode
}

async function telemetrySettingSaves(): Promise<unknown[]> {
  const calls = (await getIpcInvocations(ctx.app, 'set-setting')) as Array<{
    key: string
    value: unknown
  }>
  return calls.filter((call) => call.key === 'telemetryEnabled').map((call) => call.value)
}

test('Change works before the EULA and opens the name with every option @lifecycle', async () => {
  await ctx.panel.waitForVisible('[data-testid="setup-screen"]', { timeout: 15_000 })
  await resetIpcInvocations(ctx.app, 'comfy-window:set-first-use-mode')

  expect(await ctx.panel.click('[data-testid="setup-change"]')).toBe(true)

  await ctx.panel.waitForVisible('[data-testid="config-change-form"]', { timeout: 10_000 })
  await ctx.panel.waitForVisible('#inst-name-standalone')
  await ctx.panel.waitForVisible('[data-testid="config-start-from-existing"]')
  expect(await ctx.panel.exists('[data-testid="config-summary"]')).toBe(false)
  expect(await ctx.panel.exists('[data-testid="config-change-setup"]')).toBe(false)
  expect(await ctx.titleBar.exists('.title-menu-button[aria-haspopup="menu"]')).toBe(false)
  await expect.poll(lastFirstUseMode, { timeout: 5_000 }).toBe('consent-lockdown')
  expect(
    await telemetrySettingSaves(),
    'usage data is not switched on before the EULA is accepted'
  ).toEqual([])
})

test('installing from Change still needs the EULA @lifecycle', async () => {
  await ctx.panel.waitForSelector('.config-continue:not([disabled])', { timeout: 60_000 })
  expect(await ctx.panel.click('.config-continue')).toBe(true)

  await ctx.panel.waitForVisible('[data-testid="config-agree-hint"]', { timeout: 5_000 })
  expect(await ctx.panel.exists('[data-testid="home-view"]')).toBe(false)
  expect(await ctx.panel.exists('.template-skip')).toBe(false)

  expect(await ctx.panel.click('[data-testid="config-consent-tos"] [role="checkbox"]')).toBe(true)
  await expect
    .poll(() => ctx.panel.exists('[data-testid="config-agree-hint"]'), { timeout: 5_000 })
    .toBe(false)
  await expect.poll(lastFirstUseMode, { timeout: 5_000 }).toBe('post-consent')
  await expect
    .poll(telemetrySettingSaves, {
      timeout: 5_000,
      message: 'the usage data choice from Set up is saved once the EULA is accepted'
    })
    .toEqual([false])
  await ctx.titleBar.waitForVisible('.title-menu-button[aria-haspopup="menu"]', { timeout: 15_000 })
})

test('Back returns to Set up with the EULA still agreed @lifecycle', async () => {
  expect(await ctx.panel.click('[data-testid="config-back-to-setup"]')).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="setup-screen"]', { timeout: 10_000 })
  await ctx.panel.waitForVisible(
    '[data-testid="setup-consent-tos"] [role="checkbox"][aria-checked="true"]',
    { timeout: 5_000 }
  )
  await expect.poll(lastFirstUseMode, { timeout: 5_000 }).toBe('consent-lockdown')
})
