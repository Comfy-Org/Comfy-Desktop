/**
 * Long ProgressModal errors must scroll within the message block and leave
 * the footer visible. The max-height is clamp(120px, 22vh, 240px), with
 * overflow-y: auto.
 *
 * This browser test injects an approximately 5,000-character error and checks
 * computed styles and scroll/client heights, which a DOM-only test cannot measure.
 */

import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let installPath: string

const INSTALL_ID = 'inst-progress-error-test'
const INSTALL_NAME = 'Progress Error Me'
const MARKER_FILENAME = '.comfyui-desktop-2'

/** Long enough that the natural rendered height comfortably exceeds
 *  240px even at the smallest viewport widths the harness uses. Built
 *  as repeated sentences rather than a single non-breaking token so
 *  wrapping behaves like a real error trace. */
const LONG_ERROR = Array.from({ length: 80 })
  .map((_, i) => `Step ${i + 1}: simulated long failure output that would normally fill many lines of the error block and force the modal to scroll on small windows.`)
  .join(' ')

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-progress-error-e2e-'))
  await mkdir(installPath, { recursive: true })
  await writeFile(path.join(installPath, MARKER_FILENAME), INSTALL_ID)

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: INSTALL_ID,
        name: INSTALL_NAME,
        installPath,
        sourceId: 'standalone',
        status: 'installed',
      },
    ],
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

test('ProgressModal error block caps its height and scrolls @windows @macos @linux', async () => {
  // Drive the renderer-side dev hook: opens the ProgressModal overlay
  // for the seeded install and resolves the apiCall immediately with
  // `{ ok: false, message: LONG_ERROR }` so the store writes the long
  // string into `currentOp.error`.
  await ctx.panel.evaluate<void>(`(async () => {
    await window.__e2eRenderer.injectProgressError({
      installationId: ${JSON.stringify(INSTALL_ID)},
      title: 'Test failing op',
      errorMessage: ${JSON.stringify(LONG_ERROR)},
    })
  })()`)

  // Wait for the error message element to mount.
  await ctx.panel.waitForVisible(byTestId(TID.progressErrorMessage), { timeout: 10_000 })

  // Read the layout state of the error block. The fix is purely CSS,
  // so the assertion is purely on computed style + measured DOM.
  const layout = await ctx.panel.evaluate<{
    clientHeight: number
    scrollHeight: number
    maxHeightPx: number | null
    overflowY: string
    textLength: number
  }>(`(() => {
    const el = document.querySelector('${byTestId(TID.progressErrorMessage)}')
    if (!el) return null
    const cs = getComputedStyle(el)
    const maxH = parseFloat(cs.maxHeight)
    return {
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      maxHeightPx: Number.isFinite(maxH) ? maxH : null,
      overflowY: cs.overflowY,
      textLength: (el.textContent || '').length,
    }
  })()`)

  expect(layout, 'progress error message element layout query returned null').not.toBeNull()
  // Sanity-check the helper delivered the long message.
  expect(layout.textLength).toBeGreaterThan(2_000)
  // The fix uses `clamp(120px, 22vh, 240px)`. The upper bound is 240
  // — assert clientHeight is strictly below that with a small fudge
  // for browser sub-pixel rounding.
  expect(layout.clientHeight, 'error block should not exceed the 240px clamp').toBeLessThanOrEqual(241)
  // The content must overflow vertically — that's what proves the cap
  // is real (otherwise the block would just grow to fit).
  expect(layout.scrollHeight, 'error block scrollHeight must exceed clientHeight (overflow active)')
    .toBeGreaterThan(layout.clientHeight)
  // Style: scrolling is enabled.
  expect(layout.overflowY).toBe('auto')
})
