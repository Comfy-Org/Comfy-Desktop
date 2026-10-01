/**
 * Beta-args pill for a STOPPED install whose grant is a Core commit range.
 *
 * The next launch runs the checkout's current HEAD, so the preview proves the range against it
 * with read-only git, before any launch has happened. The fixture's ComfyUI dir is a real git
 * repository the spec moves and then damages: a HEAD below the range, and an object store git
 * cannot read, must both hide the grant without disturbing the rest of the settings view.
 *
 * Linux-only: `writeFakeComfyInstall` builds a shell-script interpreter.
 */

import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import {
  closeTitlePopupIfOpen,
  titlePopupPage,
  TITLE_REOPEN_SUPPRESSION_MS,
  waitForWebContents,
  type WebContentsPage,
} from './support/cdpPages'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'
import { opsFlagsGrantSeed, reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'
import { byTestId, TID } from './support/testIds'

test.describe.configure({ mode: 'serial' })

const INSTALL_ID = 'inst-beta-args-commit'
const ARGS_FIELD = '[data-field-id="launchArgs"]'
const PILL = `${ARGS_FIELD} .beta-args button`
const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'

let ctx: AppContext
let installPath: string
let repo: string
const sha: Record<string, string> = {}
let previousPosthogHost: string | undefined

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: os.devNull,
    },
  }).trim()
}

function commit(message: string): string {
  git('commit', '--allow-empty', '-q', '-m', message)
  return git('rev-parse', 'HEAD')
}

test.beforeAll(async () => {
  // Launching the app can run well past the 45s default on a loaded machine.
  test.setTimeout(120_000)
  previousPosthogHost = process.env['POSTHOG_HOST']
  process.env['POSTHOG_HOST'] = UNREACHABLE_POSTHOG_HOST
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-beta-args-commit-'))
  const port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })
  repo = path.join(installPath, 'ComfyUI')
  git('init', '-q', '-b', 'master')
  sha.base = commit('base')
  sha.fix = commit('fix')
  sha.head = commit('head')
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
        name: 'Commit Beta Fixture',
        sourceId: 'comfybuilder',
        sourceLabel: 'ComfyBuilder',
        installPath,
        status: 'installed',
        launchArgs: `--port ${port}`,
        seen: true,
        comfyVersion: { commit: sha.head, baseTag: 'v0.3.99', commitsAhead: 0, baseTagVerified: true },
      },
    ],
    opsFlags: opsFlagsGrantSeed({
      arg: '--enable-assets',
      commitRanges: [[sha.fix!, null]],
      description: 'Asset library',
    }),
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
  await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))
  await ctx.panel.evaluate(
    `window.api.openInstancePicker({ installationId: ${JSON.stringify(INSTALL_ID)}, initialTab: 'config' })`,
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(byTestId(TID.pickerSettingsSections), { timeout: 15_000 })
  await popup.waitForVisible(`${ARGS_FIELD} .ui-input`, { timeout: 10_000 })
  return popup
}

const pillLabel = (popup: WebContentsPage): Promise<string | null> =>
  popup.evaluate<string | null>(
    `document.querySelector(${JSON.stringify(PILL)})?.getAttribute('aria-label') ?? null`,
  )

/** Open with the request count reset, so absence can be read against this open's own answers. */
async function openCounted(): Promise<WebContentsPage> {
  await resetIpcInvocations(ctx.app, 'get-core-beta-args')
  return openStartupArgs()
}

/**
 * The pill renders nothing both before its answer and for an empty one, so absence only means
 * something once the answers are in. A fresh open asks twice (on mount, and again once the args
 * field's schema load settles), so wait for both, then require no pill and no loading placeholder
 * for long enough that a late answer would have shown.
 */
async function expectAnsweredWithNoPill(popup: WebContentsPage, message: string): Promise<void> {
  await expect
    .poll(async () => (await getIpcInvocations(ctx.app, 'get-core-beta-args')).length, {
      timeout: 15_000,
      intervals: [100, 200],
    })
    .toBeGreaterThanOrEqual(2)
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    expect(await pillLabel(popup), message).toBeNull()
    expect(await popup.exists(`${ARGS_FIELD} .beta-args-loading`), message).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

test('a commit grant whose range contains HEAD shows before any launch @linux', async () => {
  const popup = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 15_000 })
  expect(await pillLabel(popup)).toBe('1 beta argument eligible for the next launch, show details')
})

test('moving HEAD below the range hides it @linux', async () => {
  git('reset', '-q', '--hard', sha.base!)
  const popup = await openCounted()
  await expectAnsweredWithNoPill(popup, 'the grant was still shown with HEAD below its range')
  git('reset', '-q', '--hard', sha.head!)
  const back = await openStartupArgs()
  await back.waitForVisible(PILL, { timeout: 15_000 })
})

test('an object store git cannot read hides the grant, and the settings view still loads @linux', async () => {
  // Point HEAD at a commit no earlier open has proven, so nothing cached can answer for it.
  sha.next = commit('next')
  const objects = path.join(repo, '.git', 'objects')
  for (const entry of await readdir(objects)) {
    if (entry !== 'info') await rm(path.join(objects, entry), { recursive: true, force: true })
  }
  const popup = await openCounted()
  await expectAnsweredWithNoPill(popup, 'the grant was shown though git could not prove it')
  expect(await popup.exists(`${ARGS_FIELD} input`)).toBe(true)
})
