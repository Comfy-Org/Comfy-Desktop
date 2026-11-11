import os from 'node:os'
import path from 'node:path'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { closeTitlePopupIfOpen, titlePopupPage, waitForWebContents } from './support/cdpPages'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let untrackPath: string
let deletePath: string

const UNTRACK_ID = 'inst-untrack-test'
const UNTRACK_NAME = 'Untrack Me'
const DELETE_ID = 'inst-delete-test'
const DELETE_NAME = 'Delete Me'

const MARKER_FILENAME = '.comfyui-desktop-2'

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function tileExists(installationId: string): Promise<boolean> {
  return ctx.panel.exists(byTestId(TID.dashboardTile(installationId)))
}

async function openKebabAndClick(installationId: string, menuItemId: string): Promise<void> {
  const kebabClicked = await ctx.panel.click(byTestId(TID.dashboardTileKebab(installationId)))
  expect(kebabClicked, `kebab click on ${installationId}`).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.contextMenuItem(menuItemId)), { timeout: 5_000 })
  const itemClicked = await ctx.panel.click(byTestId(TID.contextMenuItem(menuItemId)))
  expect(itemClicked, `menu item click ${menuItemId}`).toBe(true)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  untrackPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-untrack-e2e-'))
  deletePath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-delete-e2e-'))
  await mkdir(untrackPath, { recursive: true })
  await mkdir(deletePath, { recursive: true })
  await writeFile(path.join(untrackPath, MARKER_FILENAME), UNTRACK_ID)
  await writeFile(path.join(deletePath, MARKER_FILENAME), DELETE_ID)

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: UNTRACK_ID,
        name: UNTRACK_NAME,
        installPath: untrackPath,
        sourceId: 'standalone',
        status: 'installed'
      },
      {
        id: DELETE_ID,
        name: DELETE_NAME,
        installPath: deletePath,
        sourceId: 'standalone',
        status: 'installed'
      }
    ]
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (untrackPath) await rm(untrackPath, { recursive: true, force: true })
  if (deletePath) await rm(deletePath, { recursive: true, force: true })
})

test('chooser lists both seeded installs @nightly', async () => {
  await ctx.panel.waitForSelector(byTestId(TID.dashboardTile(UNTRACK_ID)), { timeout: 10_000 })
  await ctx.panel.waitForSelector(byTestId(TID.dashboardTile(DELETE_ID)), { timeout: 10_000 })
})

test('Manage drawer Untrack drops the record but preserves the install directory @nightly', async () => {
  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(UNTRACK_ID)},
        initialTab: 'settings',
      })
      return true
    })()`
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(byTestId(TID.pickerMoreTrigger), { timeout: 30_000 })
  await popup.clickUntilVisible(
    byTestId(TID.pickerMoreTrigger),
    byTestId(TID.pinBottomAction('remove')),
    { timeout: 30_000 }
  )
  expect(await popup.click(byTestId(TID.pinBottomAction('remove')))).toBe(true)
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 15_000 })
  expect(await popup.click(byTestId(TID.baseAlertAction)), 'untrack confirm click dispatched').toBe(
    true
  )

  await ctx.panel.waitFor(async () => !(await tileExists(UNTRACK_ID)), {
    timeout: 15_000,
    message: 'untracked tile never disappeared from chooser'
  })
  await closeTitlePopupIfOpen(ctx.app)
  expect(await pathExists(untrackPath), 'untrack must leave the install directory on disk').toBe(
    true
  )
})

test('kebab Delete drops the record AND removes the install directory @nightly', async () => {
  await openKebabAndClick(DELETE_ID, 'delete')

  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 5_000 })
  const confirmed = await ctx.panel.click(byTestId(TID.baseAlertAction))
  expect(confirmed, 'delete confirm click dispatched').toBe(true)

  await ctx.panel.waitFor(async () => !(await tileExists(DELETE_ID)), {
    timeout: 30_000,
    message: 'deleted tile never disappeared from chooser'
  })
  await expect
    .poll(() => pathExists(deletePath), { timeout: 30_000, intervals: [250, 500, 1000] })
    .toBe(false)
})
