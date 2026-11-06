
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import {
  dispatchPointerLeave,
  dispatchPointerMove,
  dispatchWindowBlur,
  dispatchWindowFocus,
  isHoverActive,
  waitForHoverActive,
} from './support/hoverGate'

let ctx: AppContext

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
})

test.afterAll(async () => {
  await ctx.cleanup()
})

test.beforeEach(async () => {
  await dispatchWindowBlur(ctx.titleBar)
  await waitForHoverActive(ctx.titleBar, false)
})

test('hover gate is inert immediately after mount @windows @macos @linux', async () => {
  expect(await isHoverActive(ctx.titleBar)).toBe(false)
})

test('pointermove inside the title bar enables the hover gate @windows @macos @linux', async () => {
  await dispatchPointerMove(ctx.titleBar)
  await waitForHoverActive(ctx.titleBar, true)
})

test('window.blur drops the hover gate @windows @macos @linux', async () => {
  await dispatchPointerMove(ctx.titleBar)
  await waitForHoverActive(ctx.titleBar, true)

  await dispatchWindowBlur(ctx.titleBar)
  await waitForHoverActive(ctx.titleBar, false)
})

test('window.focus alone does NOT re-enable the hover gate — only pointermove does @windows @macos @linux', async () => {
  await dispatchPointerMove(ctx.titleBar)
  await waitForHoverActive(ctx.titleBar, true)
  await dispatchWindowBlur(ctx.titleBar)
  await waitForHoverActive(ctx.titleBar, false)

  await dispatchWindowFocus(ctx.titleBar)
  await new Promise((r) => setTimeout(r, 150))
  expect(await isHoverActive(ctx.titleBar)).toBe(false)

  await dispatchPointerMove(ctx.titleBar)
  await waitForHoverActive(ctx.titleBar, true)
})

test('pointerleave on the document drops the hover gate @windows @macos @linux', async () => {
  await dispatchPointerMove(ctx.titleBar)
  await waitForHoverActive(ctx.titleBar, true)

  await dispatchPointerLeave(ctx.titleBar)
  await waitForHoverActive(ctx.titleBar, false)
})
