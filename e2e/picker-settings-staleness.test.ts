
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { titlePopupPage, waitForWebContents } from './support/cdpPages'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let installAPath: string
let installBPath: string

const INSTALL_A_ID = 'inst-picker-a'
const INSTALL_A_NAME = 'Install A'
const INSTALL_B_ID = 'inst-picker-b'
const INSTALL_B_NAME = 'Install B'

const MARKER_FILENAME = '.comfyui-desktop-2'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installAPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-picker-a-e2e-'))
  installBPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-picker-b-e2e-'))
  await mkdir(installAPath, { recursive: true })
  await mkdir(installBPath, { recursive: true })
  await writeFile(path.join(installAPath, MARKER_FILENAME), INSTALL_A_ID)
  await writeFile(path.join(installBPath, MARKER_FILENAME), INSTALL_B_ID)

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: INSTALL_A_ID,
        name: INSTALL_A_NAME,
        installPath: installAPath,
        sourceId: 'standalone',
        status: 'installed',
      },
      {
        id: INSTALL_B_ID,
        name: INSTALL_B_NAME,
        installPath: installBPath,
        sourceId: 'standalone',
        status: 'installed',
      },
    ],
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installAPath) await rm(installAPath, { recursive: true, force: true })
  if (installBPath) await rm(installBPath, { recursive: true, force: true })
})

test('right pane clears stale sections when switching install A → B @windows @macos @linux', async () => {
  const opened = await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(INSTALL_A_ID)},
        initialTab: 'config',
      })
      return true
    })()`,
  )
  expect(opened).toBe(true)

  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)

  await popup.waitForVisible(byTestId(TID.pickerSettingsSections), { timeout: 15_000 })
  await popup.waitFor(
    async () => (await popup.evaluate<string | null>(
      `(() => { const el = document.querySelector('${byTestId(TID.pickerSettingsSections)}'); return el ? el.getAttribute('data-install-id') : null })()`,
    )) === INSTALL_A_ID,
    { timeout: 10_000, message: 'right pane never settled on Install A' },
  )

  const clickedB = await popup.click(byTestId(TID.pickerRow(INSTALL_B_ID)))
  expect(clickedB, 'Install B row click dispatched').toBe(true)

  await popup.waitFor(
    async () => {
      const state = await popup.evaluate<{ sectionsId: string | null; loadingVisible: boolean }>(
        `(() => {
          const sec = document.querySelector('${byTestId(TID.pickerSettingsSections)}')
          const sectionsId = sec ? sec.getAttribute('data-install-id') : null
          const loading = document.querySelector('${byTestId(TID.pickerSettingsLoading)}')
          return { sectionsId, loadingVisible: !!loading }
        })()`,
      )
      return state.loadingVisible || state.sectionsId === INSTALL_B_ID
    },
    {
      timeout: 5_000,
      message: 'right pane stayed on Install A after switching to B (stale-data regression)',
    },
  )

  await popup.waitFor(
    async () => (await popup.evaluate<string | null>(
      `(() => { const el = document.querySelector('${byTestId(TID.pickerSettingsSections)}'); return el ? el.getAttribute('data-install-id') : null })()`,
    )) === INSTALL_B_ID,
    { timeout: 15_000, message: 'right pane never settled on Install B after switch' },
  )
})
