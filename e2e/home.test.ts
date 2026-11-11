import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'

const HOME_VIEW = '[data-testid="home-view"]'
const SIDEBAR_HOME = '[data-testid="app-sidebar-home"]'
const SIDEBAR_BUILDS = '[data-testid="app-sidebar-chooser"]'

let ctx: AppContext

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp(
    { settings: { firstUseCompleted: true, telemetryEnabled: false } },
    { stayOnHome: true }
  )
})

test.afterAll(async () => {
  await ctx.cleanup()
})

function currentSidebarPage(selector: string): Promise<boolean> {
  return ctx.panel.evaluate<boolean>(
    `document.querySelector('${selector}')?.getAttribute('aria-current') === 'page'`
  )
}

test('Desktop opens on Home with Comfy Cloud among its builds @windows @macos @linux', async () => {
  await ctx.panel.waitForVisible(HOME_VIEW)
  expect(await currentSidebarPage(SIDEBAR_HOME)).toBe(true)
  expect(await ctx.panel.isVisible('.chooser-view')).toBe(false)

  await ctx.panel.waitForVisible('[data-testid="home-build"]')
  const builds = await ctx.panel.allText('[data-testid="home-build"]')
  expect(builds.some((text) => text.includes('Comfy Cloud') && text.includes('RTX 6000 Pro'))).toBe(
    true
  )
})

test('All builds on Home goes to the Builds page @windows @macos @linux', async () => {
  expect(await ctx.panel.click('[data-testid="home-all-builds"]')).toBe(true)

  await expectChooserVisible(ctx.panel)
  expect(await currentSidebarPage(SIDEBAR_BUILDS)).toBe(true)
  expect(await ctx.panel.exists(HOME_VIEW)).toBe(false)
})

test('Home in the sidebar returns to Home @windows @macos @linux', async () => {
  expect(await ctx.panel.click(SIDEBAR_HOME)).toBe(true)

  await ctx.panel.waitForVisible(HOME_VIEW)
  expect(await ctx.panel.isVisible('.chooser-view')).toBe(false)
})
