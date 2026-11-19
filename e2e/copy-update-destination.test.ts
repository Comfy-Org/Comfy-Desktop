import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible, showBuildsPage } from './support/chooserHelpers'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'

let ctx: AppContext
let sourcePath: string
let destPath: string

const SOURCE_ID = 'inst-copy-source-test'
const SOURCE_NAME = 'Source Install'
const DEST_ID = 'inst-copy-destination-test'
const DEST_NAME = 'Source Install copy'
const MARKER_FILENAME = '.comfyui-desktop-2'
const BUILD_PAGE = '[data-testid="build-details"]'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  sourcePath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-copy-dest-e2e-'))
  destPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-copy-dest-e2e-'))
  await mkdir(sourcePath, { recursive: true })
  await writeFile(path.join(sourcePath, MARKER_FILENAME), SOURCE_ID)
  await writeFile(path.join(destPath, MARKER_FILENAME), DEST_ID)

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: SOURCE_ID,
        name: SOURCE_NAME,
        installPath: sourcePath,
        sourceId: 'standalone',
        status: 'installed'
      },
      {
        id: DEST_ID,
        name: DEST_NAME,
        installPath: destPath,
        sourceId: 'standalone',
        status: 'installed'
      }
    ]
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (sourcePath) await rm(sourcePath, { recursive: true, force: true })
  if (destPath) await rm(destPath, { recursive: true, force: true })
})

test.beforeEach(async () => {
  await resetIpcInvocations(ctx.app, 'open-install-window')
  if (await ctx.panel.isVisible(BUILD_PAGE)) await showBuildsPage(ctx.panel)
  await ctx.panel.waitForVisible('.chooser-view')
})

test('A finished copy lands on the new build page, with no ComfyUI window @windows @macos @linux', async () => {
  await ctx.panel.evaluate<void>(
    `window.__e2eRenderer.injectProgressSuccess({
      installationId: ${JSON.stringify(SOURCE_ID)},
      title: 'Copy — ' + ${JSON.stringify(SOURCE_NAME)},
      newInstallationId: ${JSON.stringify(DEST_ID)},
    })`
  )

  await ctx.panel.waitForVisible(BUILD_PAGE, { timeout: 5_000 })
  await expect
    .poll(
      () =>
        ctx.panel.evaluate<string>(`document.querySelector('${BUILD_PAGE} h1')?.textContent ?? ''`),
      {
        timeout: 5_000,
        intervals: [100, 250]
      }
    )
    .toContain(DEST_NAME)
  expect(await ctx.panel.exists('.brand-progress')).toBe(false)
  expect(await getIpcInvocations(ctx.app, 'open-install-window')).toEqual([])
})

test('A finished task with no new build stays on the builds page @windows @macos @linux', async () => {
  await ctx.panel.evaluate<void>(
    `window.__e2eRenderer.injectProgressSuccess({
      installationId: ${JSON.stringify(SOURCE_ID)},
      title: 'Other op — ' + ${JSON.stringify(SOURCE_NAME)},
    })`
  )

  await new Promise((r) => setTimeout(r, 1_500))

  expect(await ctx.panel.exists(BUILD_PAGE)).toBe(false)
  expect(await getIpcInvocations(ctx.app, 'open-install-window')).toEqual([])
})
