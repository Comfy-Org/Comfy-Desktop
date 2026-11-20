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
const REASON = '[data-testid="build-operation-failed-reason"]'

const LONG_ERROR = Array.from({ length: 80 })
  .map(
    (_, i) =>
      `Step ${i + 1}: simulated long failure output that would normally fill many lines of the error block and force the modal to scroll on small windows.`
  )
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
        status: 'installed'
      }
    ]
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

test('A long task error on the build page caps its height and scrolls @windows @macos @linux', async () => {
  await ctx.panel.evaluate<void>(`(async () => {
    await window.__e2eRenderer.injectProgressError({
      installationId: ${JSON.stringify(INSTALL_ID)},
      title: 'Test failing op',
      errorMessage: ${JSON.stringify(LONG_ERROR)},
    })
  })()`)

  await expect
    .poll(
      () =>
        ctx.panel.evaluate<boolean>(
          `window.__e2eRenderer.hasErrorInstance(${JSON.stringify(INSTALL_ID)})`
        ),
      { timeout: 10_000, intervals: [100, 200] }
    )
    .toBe(true)
  expect(await ctx.panel.click(byTestId(TID.dashboardTileKebab(INSTALL_ID)))).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="build-menu-manage"]', { timeout: 5_000 })
  expect(await ctx.panel.click('[data-testid="build-menu-manage"]')).toBe(true)
  await ctx.panel.waitForVisible(REASON, { timeout: 10_000 })

  const layout = await ctx.panel.evaluate<{
    clientHeight: number
    scrollHeight: number
    maxHeightPx: number | null
    overflowY: string
    textLength: number
  }>(`(() => {
    const el = document.querySelector('${REASON}')
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

  expect(layout, 'task error element layout query returned null').not.toBeNull()
  expect(layout.textLength).toBeGreaterThan(2_000)
  expect(layout.clientHeight, 'error block should not exceed the 240px clamp').toBeLessThanOrEqual(
    241
  )
  expect(
    layout.scrollHeight,
    'error block scrollHeight must exceed clientHeight (overflow active)'
  ).toBeGreaterThan(layout.clientHeight)
  expect(layout.overflowY).toBe('auto')
})
