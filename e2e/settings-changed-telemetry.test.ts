/**
 * `comfy.desktop.settings.changed` is raised in MAIN for a user's own setting edits: a global
 * setting changed in the Global Settings popup, and a per-install field (`update-installation`).
 * App-state writes through the bare `set-setting` IPC are not edits and raise nothing.
 * Asserted through the E2E invocation log, which records every `telemetry.capture` before the
 * consent and PostHog checks; PostHog points at an unreachable host so nothing leaves the machine.
 */

import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import {
  closeTitlePopupIfOpen,
  titlePopupPage,
  TITLE_REOPEN_SUPPRESSION_MS,
  waitForWebContents
} from './support/cdpPages'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'

test.describe.configure({ mode: 'serial' })

const INSTALL_ID = 'inst-settings-changed'
const EVENT = 'telemetry:comfy.desktop.settings.changed'
const BETA_SWITCH = '.global-settings [data-field-id="betaFeaturesEnabled"] button[role="switch"]'
const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'

let ctx: AppContext
let installPath: string
let previousPosthogHost: string | undefined

test.beforeAll(async () => {
  test.setTimeout(120_000)
  previousPosthogHost = process.env['POSTHOG_HOST']
  process.env['POSTHOG_HOST'] = UNREACHABLE_POSTHOG_HOST
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-settings-changed-'))
  ctx = await launchApp({
    settings: {
      firstUseCompleted: true,
      telemetryEnabled: true,
      betaFeaturesEnabled: true,
      dashboardWorkspaceId: 'personal'
    },
    installations: [
      {
        id: INSTALL_ID,
        name: 'Settings Changed Fixture',
        // Standalone: a shared-storage source, so the Storage fields (useSharedInput, inputDir) are editable.
        sourceId: 'standalone',
        installPath,
        status: 'installed',
        // Unseen, so the update below also carries the first-open `seen` write.
        seen: false,
        useSharedInput: true,
        inputDir: '/tmp/private-in'
      }
    ]
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (previousPosthogHost === undefined) delete process.env['POSTHOG_HOST']
  else process.env['POSTHOG_HOST'] = previousPosthogHost
})

test('a Global Settings edit raises the event; an app-state write does not @windows @macos @linux', async () => {
  await resetIpcInvocations(ctx.app, EVENT)

  // App state through the bare IPC, awaited, so it has been handled before the edit below.
  await ctx.panel.evaluate(`window.api.setSetting('comfyApiAnnouncementSeen', true)`)

  await closeTitlePopupIfOpen(ctx.app)
  await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))
  await ctx.panel.evaluate(
    `window.api.openGlobalSettings('general', { highlightField: 'betaFeaturesEnabled' })`
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(BETA_SWITCH, { timeout: 10_000 })
  expect(await popup.click(BETA_SWITCH)).toBe(true)

  // Exactly the edit: the earlier app-state write would show up here as a second event.
  await expect
    .poll(() => getIpcInvocations(ctx.app, EVENT), { timeout: 5_000 })
    .toEqual([{ setting_key: 'betaFeaturesEnabled', bool_value: false }])
})

test('a per-install edit names the install, sends no path, and skips unchanged fields @windows @macos @linux', async () => {
  await resetIpcInvocations(ctx.app, EVENT)

  const result = await ctx.panel.evaluate<{ ok: boolean }>(
    `window.api.updateInstallation(${JSON.stringify(INSTALL_ID)}, { useSharedInput: false, useSharedOutput: true, inputDir: '/tmp/private-in', name: 'Renamed', seen: true })`
  )

  expect(result.ok).toBe(true)
  const events = await getIpcInvocations(ctx.app, EVENT)
  // inputDir is re-sent unchanged, useSharedOutput is unset but already shows as on, and the
  // rename and `seen` are not settings, so only the toggle counts.
  expect(events).toEqual([
    { install_id: INSTALL_ID, setting_key: 'useSharedInput', bool_value: false }
  ])
  expect(JSON.stringify(events)).not.toContain('private-in')
})
