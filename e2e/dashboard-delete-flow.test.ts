import os from 'node:os'
import path from 'node:path'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import {
  buildMenuItem,
  expectChooserVisible,
  pickFromBuildsTileMenu
} from './support/chooserHelpers'
import { byTestId, TID } from './support/testIds'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'

let ctx: AppContext
let installPath: string

const INSTALL_ID = 'inst-dashboard-delete-test'
const INSTALL_NAME = 'Delete Fast-Path Me'

const MARKER_FILENAME = '.comfyui-desktop-2'

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-dash-delete-e2e-'))
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

test('chooser shows the seeded tile @windows @macos @linux', async () => {
  await ctx.panel.waitForSelector(byTestId(TID.dashboardTile(INSTALL_ID)), { timeout: 10_000 })
  expect(
    await ctx.panel.textOf(`${byTestId(TID.dashboardTile(INSTALL_ID))} .chooser-tile-name`)
  ).toBe(INSTALL_NAME)
})

test('Uninstall from the ⋯ menu asks in the shared confirm box, with the folder, without invoking get-detail-sections @windows @macos @linux', async () => {
  await resetIpcInvocations(ctx.app, 'get-detail-sections')

  await pickFromBuildsTileMenu(ctx.panel, INSTALL_ID, 'delete')

  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 5_000 })
  expect(await ctx.panel.exists(buildMenuItem('delete')), 'the menu closed').toBe(false)
  expect(await ctx.panel.textOf('[role="alertdialog"]')).toContain(installPath)

  const invocations = await getIpcInvocations(ctx.app, 'get-detail-sections')
  expect(invocations, 'Delete dispatch must not call get-detail-sections').toEqual([])
})

test('Confirm removes the install directory and tile @windows @macos @linux', async () => {
  expect(await ctx.panel.click(byTestId(TID.baseAlertAction)), 'confirm click dispatched').toBe(
    true
  )

  await ctx.panel.waitFor(
    async () => !(await ctx.panel.exists(byTestId(TID.dashboardTile(INSTALL_ID)))),
    { timeout: 30_000, message: 'deleted tile never disappeared from chooser' }
  )

  await expect
    .poll(() => pathExists(installPath), { timeout: 30_000, intervals: [250, 500, 1000] })
    .toBe(false)
})
