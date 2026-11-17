import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'

const MARKER_FILENAME = '.comfyui-desktop-2'
const BUILD = { id: 'inst-home-auto-start', name: 'Studio GPU' }
const TILE = `[data-testid="home-build"][data-build-id="${BUILD.id}"]`
const TILE_STATUS = `${TILE} [data-testid="home-build-status"]`
const MORE = `${TILE} [data-testid="home-build-more"]`
const AUTO_START_LINE = '[data-testid="build-menu-auto-start"]'

let ctx: AppContext
let installPath = ''

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-home-auto-start-e2e-'))
  await writeFile(path.join(installPath, MARKER_FILENAME), BUILD.id)
  ctx = await launchApp(
    {
      settings: { firstUseCompleted: true, telemetryEnabled: false },
      installations: [{ ...BUILD, installPath, sourceId: 'standalone', status: 'installed' }]
    },
    { stayOnHome: true }
  )
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

function savedAutoStart(): Promise<unknown> {
  return ctx.panel.evaluate("window.api.getSetting('autoLaunchOnStartup')")
}

async function pickAutoStartLine(expected: string): Promise<void> {
  expect(await ctx.panel.click(MORE), 'build menu opened from the tile ⋯').toBe(true)
  await ctx.panel.waitForVisible(AUTO_START_LINE)
  expect(await ctx.panel.textOf(AUTO_START_LINE)).toBe(expected)
  expect(await ctx.panel.click(AUTO_START_LINE), `${expected} picked`).toBe(true)
}

test('Auto start picked in a Home build menu saves that build and shows on its tile, and Turn off sets None @windows @macos @linux', async () => {
  await ctx.panel.waitForVisible(TILE)
  expect(await ctx.panel.textOf(TILE_STATUS)).toBe('Ready')

  await pickAutoStartLine('Auto start')

  await expect.poll(savedAutoStart).toBe(BUILD.id)
  await expect.poll(() => ctx.panel.textOf(TILE_STATUS)).toBe('Auto start')
  await expect
    .poll(() => ctx.panel.exists(`${TILE} [data-testid="home-build-starts-with-desktop"]`))
    .toBe(true)

  await pickAutoStartLine('Turn off Auto start')

  await expect.poll(savedAutoStart).toBe('none')
  await expect.poll(() => ctx.panel.textOf(TILE_STATUS)).toBe('Ready')
})
