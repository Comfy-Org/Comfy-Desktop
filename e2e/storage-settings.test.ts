import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { openDesktopSettings } from './support/chooserHelpers'
import { titlePopupPage, type WebContentsPage } from './support/cdpPages'
import { evalWithRetry } from './support/evalRetry'

let ctx: AppContext
let popup: WebContentsPage
let fixtureRoot: string
let installPath: string
let defaultModelsDir: string
let addedModelsDir: string
let inputDir: string
let outputDir: string
let replacementOutputDir: string
let settingsDir: string

const INSTALL_ID = 'inst-storage-settings-test'
const MARKER_FILENAME = '.comfyui-desktop-2'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-storage-e2e-'))
  installPath = path.join(fixtureRoot, 'install')
  defaultModelsDir = path.join(fixtureRoot, 'models-default')
  addedModelsDir = path.join(fixtureRoot, 'models-added')
  inputDir = path.join(fixtureRoot, 'input')
  outputDir = path.join(fixtureRoot, 'output')
  replacementOutputDir = path.join(fixtureRoot, 'output-replacement')
  await Promise.all(
    [installPath, defaultModelsDir, addedModelsDir, inputDir, outputDir, replacementOutputDir].map(
      (dir) => mkdir(dir, { recursive: true })
    )
  )
  await writeFile(path.join(installPath, MARKER_FILENAME), INSTALL_ID)

  ctx = await launchApp({
    settings: {
      firstUseCompleted: true,
      telemetryEnabled: false,
      modelsDirs: [defaultModelsDir],
      inputDir,
      outputDir
    },
    installations: [
      {
        id: INSTALL_ID,
        name: 'Storage Settings Test',
        installPath,
        sourceId: 'standalone',
        status: 'installed'
      }
    ]
  })
  popup = titlePopupPage(ctx.app)
  settingsDir = await evalWithRetry(() =>
    ctx.app.evaluate(({ app }) => {
      if (process.platform !== 'linux') return app.getPath('userData')
      const base = process.env.XDG_CONFIG_HOME || `${app.getPath('home')}/.config`
      return `${base}/comfyui-desktop-2`
    })
  )
  await evalWithRetry(() =>
    ctx.app.evaluate(
      ({ dialog }, selectedPaths) => {
        const queue = [...selectedPaths]
        ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({
          canceled: false,
          filePaths: [queue.shift()]
        })
      },
      [addedModelsDir, replacementOutputDir]
    )
  )
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true })
})

test('Desktop Settings Folders renders the seeded shared model directory @windows @macos @linux', async () => {
  await openDesktopSettings(ctx.app, ctx.panel)
  expect(await popup.clickByText('.gs-tab', 'Folders')).toBe(true)
  await popup.waitFor(
    async () => (await popup.allText('.shared-folder-path')).includes(defaultModelsDir),
    { timeout: 10_000, message: 'seeded shared model directory did not render' }
  )
})

test('Add models folder persists the selected directory @windows @macos @linux', async () => {
  expect(await popup.click('.shared-folders-add')).toBe(true)
  await popup.waitFor(
    async () => (await popup.allText('.shared-folder-path')).includes(addedModelsDir),
    { timeout: 10_000, message: 'added shared model directory did not render' }
  )
  await expect
    .poll(() => readPersistedSettings(), { timeout: 10_000, intervals: [100, 250, 500] })
    .toMatchObject({ modelsDirs: [defaultModelsDir, addedModelsDir] })
})

test('Remove shared directory removes the row and persists the change @windows @macos @linux', async () => {
  const menuOpened = await popup.evaluate<boolean>(`(() => {
    const row = Array.from(document.querySelectorAll('.shared-folder-row')).find((candidate) =>
      candidate.querySelector('.shared-folder-path')?.textContent?.trim() === ${JSON.stringify(addedModelsDir)})
    const button = row?.querySelector('.shared-folder-more')
    if (!button) return false
    button.click()
    return true
  })()`)
  expect(menuOpened).toBe(true)
  await popup.waitForVisible('.shared-folder-menu [role="menuitem"]', { timeout: 5_000 })
  expect(await popup.clickByText('.shared-folder-menu [role="menuitem"]', 'Remove')).toBe(true)
  await popup.waitForVisible('[data-testid="base-alert-action"]', { timeout: 5_000 })
  expect(await popup.click('[data-testid="base-alert-action"]')).toBe(true)
  await popup.waitFor(
    async () => !(await popup.allText('.shared-folder-path')).includes(addedModelsDir),
    { timeout: 10_000, message: 'removed shared model directory row remained visible' }
  )
  await expect
    .poll(() => readPersistedSettings(), { timeout: 10_000, intervals: [100, 250, 500] })
    .toMatchObject({ modelsDirs: [defaultModelsDir] })
})

test('Shared Output browse persists the selected output directory @windows @macos @linux', async () => {
  await popup.waitFor(
    async () =>
      (await popup.count('.shared-folder-row[data-kind="output"] .shared-folder-action')) === 1,
    { timeout: 5_000, message: 'shared output browse control did not render' }
  )
  expect(
    await popup.clickNth('.shared-folder-row[data-kind="output"] .shared-folder-action', 0)
  ).toBe(true)
  await popup.waitFor(
    async () =>
      (await popup.allText('.shared-folder-row[data-kind="output"] .shared-folder-path')).includes(
        replacementOutputDir
      ),
    { timeout: 10_000, message: 'shared output directory did not update in the UI' }
  )
  await expect
    .poll(() => readPersistedSettings(), { timeout: 10_000, intervals: [100, 250, 500] })
    .toMatchObject({ outputDir: replacementOutputDir })
})

async function readPersistedSettings(): Promise<Record<string, unknown>> {
  const settingsPath = path.join(settingsDir, 'settings.json')
  return JSON.parse(await readFile(settingsPath, 'utf-8')) as Record<string, unknown>
}
