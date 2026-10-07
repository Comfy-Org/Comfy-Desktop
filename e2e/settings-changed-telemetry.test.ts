/**
 * `comfy.desktop.settings.changed` is raised in MAIN for both kinds of setting write a renderer
 * can make: a global setting (`set-setting`) and a per-install field (`update-installation`).
 * Asserted through the E2E invocation log, which records every `telemetry.capture` before the
 * consent and PostHog checks, so no event leaves the machine.
 */

import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'

test.describe.configure({ mode: 'serial' })

const INSTALL_ID = 'inst-settings-changed'
const EVENT = 'telemetry:comfy.desktop.settings.changed'

let ctx: AppContext
let installPath: string

test.beforeAll(async () => {
  test.setTimeout(120_000)
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-settings-changed-'))
  ctx = await launchApp({
    settings: { firstUseCompleted: true, autoUpdate: true },
    installations: [
      {
        id: INSTALL_ID,
        name: 'Settings Changed Fixture',
        // Standalone: a shared-storage source, so the Storage fields (useSharedInput, inputDir) are editable.
        sourceId: 'standalone',
        installPath,
        status: 'installed',
        seen: true
      }
    ]
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

test('a global setting change raises the event with the key and new boolean @windows @macos @linux', async () => {
  await resetIpcInvocations(ctx.app, EVENT)

  await ctx.panel.evaluate(`window.api.setSetting('autoUpdate', false)`)

  expect(await getIpcInvocations(ctx.app, EVENT)).toEqual([
    { scope: 'global', setting_key: 'autoUpdate', bool_value: false }
  ])
})

test('a per-install change raises the event with the installation id and no path @windows @macos @linux', async () => {
  await resetIpcInvocations(ctx.app, EVENT)

  const result = await ctx.panel.evaluate<{ ok: boolean }>(
    `window.api.updateInstallation(${JSON.stringify(INSTALL_ID)}, { useSharedInput: false, inputDir: '/tmp/private-in' })`
  )

  expect(result.ok).toBe(true)
  const events = await getIpcInvocations(ctx.app, EVENT)
  expect(events).toEqual([
    {
      scope: 'install',
      installation_id: INSTALL_ID,
      setting_key: 'useSharedInput',
      bool_value: false
    },
    { scope: 'install', installation_id: INSTALL_ID, setting_key: 'inputDir' }
  ])
  expect(JSON.stringify(events)).not.toContain('private-in')
})
