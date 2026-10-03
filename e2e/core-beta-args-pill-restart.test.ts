/**
 * Beta-args pill across a Restart from the instance picker.
 *
 * A restart replaces the session, but the picker that issued it is hidden for the restart and gets no
 * snapshots meanwhile, so on reopen it sees one running -> running change. The pill is session-derived, so it must follow the new session:
 * here the user adds the granted arg themselves, which overrides the grant, and after the restart
 * the pill must be gone. (It went stale before the picker snapshot carried session identity.)
 *
 * Real launch of a fake install (Linux-only `writeFakeComfyInstall`), so the grant is recorded by
 * the launch itself rather than seeded.
 */

import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { clickInstallTile, expectChooserVisible, openPickerViaTitlePill } from './support/chooserHelpers'
import { closeTitlePopupIfOpen, isPopupVisible, type WebContentsPage } from './support/cdpPages'
import { getRunningSessionSnapshot } from './support/devHooks'
import { opsFlagsGrantSeed, reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'
import { byTestId, TID } from './support/testIds'
import {
  ARGS_FIELD,
  commitArgs,
  notePillAnswers,
  PILL,
  pillLabel,
  waitForNewerAnswer,
} from './support/betaArgsPill'

// Two real launches do not fit the default budget.
test.describe.configure({ mode: 'serial', timeout: 240_000 })

const INSTALL_ID = 'inst-beta-args-restart'
const INSTALL_NAME = 'Restart Beta Fixture'
const RESTART_TAG = `${ARGS_FIELD} .settings-v2-restart-tag`
const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'

let ctx: AppContext
let installPath: string
let port: number
let previousPosthogHost: string | undefined

test.beforeAll(async () => {
  // Launching the app can run well past the 45s default on a loaded machine.
  test.setTimeout(120_000)
  previousPosthogHost = process.env['POSTHOG_HOST']
  process.env['POSTHOG_HOST'] = UNREACHABLE_POSTHOG_HOST
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-beta-args-restart-'))
  port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })
  ctx = await launchApp({
    settings: {
      firstUseCompleted: true,
      telemetryEnabled: true,
      betaFeaturesEnabled: true,
      hasSeenCentralPillHint: true,
    },
    installations: [
      {
        id: INSTALL_ID,
        name: INSTALL_NAME,
        sourceId: 'comfybuilder',
        sourceLabel: 'ComfyBuilder',
        installPath,
        status: 'installed',
        launchArgs: `--port ${port}`,
        launchMode: 'window',
        browserPartition: 'unique',
        seen: true,
        comfyVersion: {
          commit: 'b1c2d3e4f5a6b1c2d3e4f5a6b1c2d3e4f5a6b1c2',
          baseTag: 'v0.3.99',
          commitsAhead: 0,
          baseTagVerified: true,
        },
      },
    ],
    opsFlags: opsFlagsGrantSeed({ arg: '--enable-assets', minCoreVersion: '0.3.80', description: 'Asset library' }),
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (previousPosthogHost === undefined) delete process.env['POSTHOG_HOST']
  else process.env['POSTHOG_HOST'] = previousPosthogHost
})

async function openStartupArgs(): Promise<WebContentsPage> {
  await closeTitlePopupIfOpen(ctx.app)
  const popup = await openPickerViaTitlePill(ctx.app, ctx.titleBar, 'config')
  await popup.waitForVisible(`${ARGS_FIELD} .ui-input`, { timeout: 15_000 })
  return popup
}

test('the pill follows the new session after a Restart that drops a grant @linux', async () => {
  await clickInstallTile(ctx.panel, INSTALL_NAME)
  let before: Awaited<ReturnType<typeof getRunningSessionSnapshot>> = null
  await expect
    .poll(async () => (before = await getRunningSessionSnapshot(ctx.app, INSTALL_ID)), {
      timeout: 90_000,
      intervals: [500, 1_000],
    })
    .not.toBeNull()

  let popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 15_000 })
  expect(await pillLabel(popup)).toBe('1 beta argument added for this session, show details')

  // The user passes the granted arg themselves, which overrides the grant for the next launch.
  await notePillAnswers(popup)
  await commitArgs(popup, `--port ${port} --enable-assets`)
  // The edit has landed once the field asks for a restart and the pill has answered for it; the
  // pill still shows the running session's grant, which the edit cannot take back before the
  // restart.
  await popup.waitForVisible(RESTART_TAG, { timeout: 10_000 })
  await waitForNewerAnswer(popup, 'the pill never answered for the committed args')
  expect(await pillLabel(popup)).toBe('1 beta argument added for this session, show details')

  await expect
    .poll(() => popup.textOf(byTestId(TID.pickerPrimaryCta)), { timeout: 10_000, intervals: [200, 400] })
    .toContain('Restart')
  expect(await popup.click(byTestId(TID.pickerPrimaryCta))).toBe(true)
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)
  await expect
    .poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), { timeout: 10_000, intervals: [100, 200] })
    .toBe(false)

  await expect
    .poll(
      async () => {
        const after = await getRunningSessionSnapshot(ctx.app, INSTALL_ID)
        return (after?.startedAt ?? 0) > (before?.startedAt ?? 0)
      },
      {
        // A relaunch normally lands within about 2s of the first launch; 30s leaves room for a
        // loaded machine and fails fast on the known stall (the fake ComfyUI stops accepting).
        timeout: 30_000,
        intervals: [500, 1_000],
        message: 'restart never happened: startedAt did not advance after Restart',
      },
    )
    .toBe(true)

  popup = await openStartupArgs()
  await popup.waitFor(async () => (await pillLabel(popup)) === null, {
    timeout: 10_000,
    message: "the pill still showed the previous session's grant after the restart",
  })
  // The new session consumed the edit, so nothing is pending any more.
  await popup.waitFor(async () => !(await popup.exists(RESTART_TAG)), {
    timeout: 10_000,
    message: '"Restart to apply" was still shown after the restart',
  })
})
