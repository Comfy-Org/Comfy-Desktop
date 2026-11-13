import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'

const SIDEBAR_ASSETS = '[data-testid="app-sidebar-assets"]'
const ASSETS_GRID = '[data-testid="assets-grid"]'
const SAMPLE_IMAGE = path.resolve('src/renderer/src/assets/sidebar/hills-sunset.jpg')

let ctx: AppContext
let outputDir: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  outputDir = await mkdtemp(path.join(os.tmpdir(), 'comfy-assets-output-'))
  await mkdir(path.join(outputDir, 'landscapes'), { recursive: true })
  await copyFile(SAMPLE_IMAGE, path.join(outputDir, 'landscapes', 'ComfyUI_00001_.jpg'))
  ctx = await launchApp(
    { settings: { firstUseCompleted: true, telemetryEnabled: false, outputDir } },
    { stayOnHome: true }
  )
})

test.afterAll(async () => {
  await ctx.cleanup()
  await rm(outputDir, { recursive: true, force: true })
})

test('Assets shows the images in the output folder with no build running and no login @windows @macos @linux', async () => {
  expect(await ctx.panel.click(SIDEBAR_ASSETS)).toBe(true)

  await ctx.panel.waitForVisible(ASSETS_GRID)
  await expect
    .poll(() =>
      ctx.panel.evaluate<boolean>(
        `(() => {
          const img = document.querySelector('${ASSETS_GRID} img')
          return !!img && img.complete && img.naturalWidth > 0
        })()`
      )
    )
    .toBe(true)
  const src = await ctx.panel.evaluate<string>(
    `document.querySelector('${ASSETS_GRID} img').getAttribute('src')`
  )
  expect(src.startsWith('comfy-output://file/')).toBe(true)
  expect(decodeURIComponent(src)).toContain('ComfyUI_00001_.jpg')
})
