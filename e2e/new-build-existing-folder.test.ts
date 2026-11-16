import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import {
  clickNewInstallTile,
  expectChooserVisible,
  expectNewBuildModalOpen,
  openNewBuildChangeSetup
} from './support/chooserHelpers'
import { evalWithRetry } from './support/evalRetry'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let stagedPath: string

const BUILD_NAME = 'Folder From The Sheet'
const ADD_BUILD = '[data-testid="config-use-existing"]'
const BUILD_TILE_NAMES =
  '.chooser-tile:not(.chooser-tile-new):not(.chooser-tile-cloud) .chooser-tile-name'

interface Installation {
  name: string
  installPath: string
  sourceId: string
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  stagedPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-sheet-folder-e2e-'))
  await mkdir(path.join(stagedPath, 'ComfyUI'), { recursive: true })
  await mkdir(path.join(stagedPath, 'standalone-env'), { recursive: true })
  await writeFile(path.join(stagedPath, 'ComfyUI', 'main.py'), '')
  await writeFile(
    path.join(stagedPath, 'manifest.json'),
    JSON.stringify({
      comfyui_ref: 'v0.3.10',
      version: 'v0.3.10',
      id: 'cpu',
      python_version: '3.12'
    })
  )

  ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
  await expectChooserVisible(ctx.panel)
  await evalWithRetry(() =>
    ctx.app.evaluate(({ dialog }, dirPath) => {
      ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dirPath]
      })
    }, stagedPath)
  )
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (stagedPath) await rm(stagedPath, { recursive: true, force: true })
})

test('Change setup adds a ComfyUI folder already on this computer, straight from the sheet @windows @macos @linux', async () => {
  await clickNewInstallTile(ctx.panel)
  await expectNewBuildModalOpen(ctx.panel)
  await openNewBuildChangeSetup(ctx.panel)

  expect(await ctx.panel.click('[data-testid="config-start-from-existing"]')).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="existing-comfy-folder-form"]')
  expect(
    await ctx.panel.exists(`${ADD_BUILD}:not([disabled])`),
    'Add build waits for a folder to be picked'
  ).toBe(false)

  expect(await ctx.panel.click(byTestId(TID.trackBrowse))).toBe(true)
  await ctx.panel.waitFor(
    async () =>
      (await ctx.panel.allText('.track-location .config-path-open')).some((text) =>
        text.includes(stagedPath)
      ),
    { timeout: 10_000, message: 'the picked folder never showed in the sheet' }
  )
  await ctx.panel.fill('#track-name', BUILD_NAME)
  await ctx.panel.waitForSelector(`${ADD_BUILD}:not([disabled])`, { timeout: 15_000 })
  expect(await ctx.panel.textOf(ADD_BUILD)).toBe('Add build')
  expect(await ctx.panel.click(ADD_BUILD), 'Add build pressed in the sheet').toBe(true)

  await expect.poll(() => ctx.panel.exists('[data-testid="new-build-modal"]')).toBe(false)
  await expectChooserVisible(ctx.panel)
  await ctx.panel.waitFor(
    async () => (await ctx.panel.allText(BUILD_TILE_NAMES)).includes(BUILD_NAME),
    { timeout: 10_000, message: 'the added folder never showed as a build' }
  )

  const installs = await ctx.panel.evaluate<Installation[]>(`window.api.getInstallations()`)
  const added = installs.find((install) => install.name === BUILD_NAME)
  expect(added, 'the folder is registered as a build').toBeDefined()
  expect(added!.sourceId).toBe('standalone')
  expect(added!.installPath).toBe(stagedPath)
})
