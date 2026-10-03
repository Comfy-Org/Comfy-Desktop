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
import type { WebContentsPage } from './support/cdpPages'
import {
  ARGS_FIELD,
  expectAnsweredWithNoPill,
  openStartupArgs,
  PILL,
  pillLabel,
} from './support/betaArgsPill'
import { opsFlagsGrantSeed, reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'

test.describe.configure({ mode: 'serial' })

const INSTALL_ID = 'inst-beta-args-commit'
const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'

let ctx: AppContext
let installPath: string
let repo: string
const sha: Record<string, string> = {}
let previousPosthogHost: string | undefined

/** Git variables a test run can inherit (from a hook, say) that would point git, the app's own
 *  calls included, at another repo. Cleared from the environment for the spec. */
const INHERITED_GIT_STATE = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES'
]
const inheritedGitState: Record<string, string | undefined> = {}

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
  for (const key of INHERITED_GIT_STATE) {
    inheritedGitState[key] = process.env[key]
    delete process.env[key]
  }
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
  for (const [key, value] of Object.entries(inheritedGitState)) {
    if (value !== undefined) process.env[key] = value
  }
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (previousPosthogHost === undefined) delete process.env['POSTHOG_HOST']
  else process.env['POSTHOG_HOST'] = previousPosthogHost
})

const open = (): Promise<WebContentsPage> => openStartupArgs(ctx.app, ctx.panel, INSTALL_ID)

test('a commit grant whose range contains HEAD shows before any launch @linux', async () => {
  const popup = await open()
  await popup.waitForVisible(PILL, { timeout: 15_000 })
  expect(await pillLabel(popup)).toBe('1 beta argument eligible for the next launch, show details')
})

test('moving HEAD below the range hides it @linux', async () => {
  git('reset', '-q', '--hard', sha.base!)
  const popup = await open()
  await expectAnsweredWithNoPill(popup, 'the grant was still shown with HEAD below its range')
  git('reset', '-q', '--hard', sha.head!)
  const back = await open()
  await back.waitForVisible(PILL, { timeout: 15_000 })
})

test('an object store git cannot read hides the grant, and the settings view still loads @linux', async () => {
  // Point HEAD at a commit no earlier open has proven, so nothing cached can answer for it.
  sha.next = commit('next')
  const objects = path.join(repo, '.git', 'objects')
  for (const entry of await readdir(objects)) {
    if (entry !== 'info') await rm(path.join(objects, entry), { recursive: true, force: true })
  }
  const popup = await open()
  await expectAnsweredWithNoPill(popup, 'the grant was shown though git could not prove it')
  expect(await popup.exists(`${ARGS_FIELD} input`)).toBe(true)
})
