import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import type { WebContentsPage } from './support/cdpPages'
import {
  dispatchPointerLeave,
  dispatchPointerMove,
  dispatchWindowBlur,
  dispatchWindowFocus,
  isHoverActive,
  waitForHoverActive
} from './support/hoverGate'

let ctx: AppContext
let titleBar: WebContentsPage

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
  titleBar = ctx.titleBar

  await ctx.panel.click('.chooser-tile[data-source-category="cloud"] .chooser-tile-launch')
  await expect
    .poll(() => titleBar.exists('.title-install-pill:not(.is-install-less)'), {
      timeout: 30_000,
      intervals: [100, 200, 500]
    })
    .toBe(true)
})

test.afterAll(async () => {
  await ctx.cleanup()
})

test.beforeEach(async () => {
  await dispatchWindowBlur(titleBar)
  await waitForHoverActive(titleBar, false)
})

test('hover gate is inert after mount on the comfy-window title bar @windows @macos @linux', async () => {
  expect(await isHoverActive(titleBar)).toBe(false)
})

test('pointermove enables the comfy-window hover gate @windows @macos @linux', async () => {
  await dispatchPointerMove(titleBar)
  await waitForHoverActive(titleBar, true)
})

test('window.blur drops the comfy-window hover gate @windows @macos @linux', async () => {
  await dispatchPointerMove(titleBar)
  await waitForHoverActive(titleBar, true)

  await dispatchWindowBlur(titleBar)
  await waitForHoverActive(titleBar, false)
})

test('window.focus alone does NOT re-enable the comfy-window hover gate — only pointermove does @windows @macos @linux', async () => {
  await dispatchPointerMove(titleBar)
  await waitForHoverActive(titleBar, true)
  await dispatchWindowBlur(titleBar)
  await waitForHoverActive(titleBar, false)

  await dispatchWindowFocus(titleBar)
  await new Promise((r) => setTimeout(r, 150))
  expect(await isHoverActive(titleBar)).toBe(false)

  await dispatchPointerMove(titleBar)
  await waitForHoverActive(titleBar, true)
})

test('pointerleave drops the comfy-window hover gate @windows @macos @linux', async () => {
  await dispatchPointerMove(titleBar)
  await waitForHoverActive(titleBar, true)

  await dispatchPointerLeave(titleBar)
  await waitForHoverActive(titleBar, false)
})
