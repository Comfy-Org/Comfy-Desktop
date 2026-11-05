import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'

let ctx: AppContext
let installPath: string

const INSTALL_ID = 'inst-deep-link-test'
const INSTALL_NAME = 'Deep Link Target'
const MARKER_FILENAME = '.comfyui-desktop-2'

interface OpenInstancePickerCall {
  installationId: string | null
  initialTab: string | null
  autoAction: string | null
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-deep-links-e2e-'))
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

const PICKER_CHANNEL = 'comfy-window:open-instance-picker-for-install'
const GLOBAL_SETTINGS_CHANNEL = 'comfy-titlepopup:open-global-settings'

test.beforeEach(async () => {
  await resetIpcInvocations(ctx.app, PICKER_CHANNEL)
  await resetIpcInvocations(ctx.app, GLOBAL_SETTINGS_CHANNEL)
})

async function fireDeepLink(payload: Record<string, unknown>): Promise<void> {
  await ctx.app.evaluate(({ webContents }, p) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('panel.html'))
    if (!wc) throw new Error('panel webContents not found')
    wc.send('panel-trigger-overlay', p)
  }, payload)
}

test('comfy://open-settings?tab=global opens Global Settings @windows @macos @linux', async () => {
  await fireDeepLink({ kind: 'open-settings', settingsTab: 'global' })

  await expect
    .poll(
      async () => (await getIpcInvocations(ctx.app, GLOBAL_SETTINGS_CHANNEL)).length,
      { timeout: 5_000, intervals: [100, 200] },
    )
    .toBe(1)

  const pickerCalls = await getIpcInvocations(ctx.app, PICKER_CHANNEL)
  expect(pickerCalls.length).toBe(0)
})

test('comfy://open-settings?tab=comfy on chooser host opens the picker (compact fallback) @windows @macos @linux', async () => {
  await fireDeepLink({ kind: 'open-settings', settingsTab: 'comfy' })

  await expect
    .poll(
      async () => (await getIpcInvocations(ctx.app, PICKER_CHANNEL)).length,
      { timeout: 5_000, intervals: [100, 200] },
    )
    .toBe(1)

  const calls = await getIpcInvocations(ctx.app, PICKER_CHANNEL) as OpenInstancePickerCall[]
  expect(calls[0]).toMatchObject({
    installationId: null,
    initialTab: null,
  })

  const globalCalls = await getIpcInvocations(ctx.app, GLOBAL_SETTINGS_CHANNEL)
  expect(globalCalls.length).toBe(0)
})

test('comfy://install-update with a non-matching installationId is ignored on chooser host @windows @macos @linux', async () => {
  await fireDeepLink({ kind: 'install-update', installationId: INSTALL_ID })

  await fireDeepLink({ kind: 'open-settings', settingsTab: 'global' })
  await expect
    .poll(
      async () => (await getIpcInvocations(ctx.app, GLOBAL_SETTINGS_CHANNEL)).length,
      { timeout: 5_000, intervals: [100, 200] },
    )
    .toBe(1)

  const pickerCalls = await getIpcInvocations(ctx.app, PICKER_CHANNEL)
  expect(pickerCalls.length).toBe(0)
})
