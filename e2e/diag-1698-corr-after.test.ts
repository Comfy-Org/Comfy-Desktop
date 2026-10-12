/**
 * diag(#1698), not for merge: post-fix (per-ask records) copy of core-beta-args-pill-commit with a late answer.
 * DIAG_LATE names when main releases an answer it computed for an ask sent before the open's
 * reset, while HEAD was still in the grant's range: `ask-N` when the open's Nth ask arrives,
 * `answer-N` after main answers it, `-hold` also holds that ask's own answer for 1.5 s.
 */
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
const LOADING = `${ARGS_FIELD} .beta-args-loading`
const ASKED = 'get-core-beta-args'
const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'

let ctx: AppContext

const LATE = process.env['DIAG_LATE'] ?? 'none'

/** Ask before the move with the stored args, and wait until main has computed a grant for it. */
async function injectLateAnswer(): Promise<void> {
  if (LATE === 'none') return
  await resetIpcInvocations(ctx.app, 'diag:late')
  await ctx.panel.evaluate(
    `void window.api.getCoreBetaArgs(${JSON.stringify(INSTALL_ID)}, { diagLate: ${JSON.stringify(LATE)} })`,
  )
  await expect
    .poll(() => getIpcInvocations(ctx.app, 'diag:late'), { timeout: 15_000 })
    .toEqual([{ phase: 'computed', args: ['--enable-assets'] }])
}

/** The late answer has landed, so this run exercised it. */
async function expectLateLanded(): Promise<void> {
  if (LATE === 'none') return
  const phases = async (): Promise<string[]> =>
    ((await getIpcInvocations(ctx.app, 'diag:late')) as { phase: string }[]).map(({ phase }) => phase)
  await expect.poll(phases, { timeout: 15_000 }).toEqual(['computed', 'landed'])
}

/** Main answered both of this open's asks before the wait returned. */
async function expectBothAnswered(): Promise<void> {
  const produced = (await getIpcInvocations(ctx.app, 'diag:answer')).length
  expect(produced, "the wait returned before main had answered both of this open's asks").toBeGreaterThanOrEqual(2)
}
let installPath: string
let repo: string
const sha: Record<string, string> = {}
let previousPosthogHost: string | undefined

/** Git variables a test run can inherit (from a hook, say) that would point git at another repo. */
const INHERITED_GIT_STATE = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES'
]
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !INHERITED_GIT_STATE.includes(key))
)

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    env: {
      ...gitEnv,
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

/** Main records each ask, and sets its answer on that record once answered. */
interface Ask {
  answer?: { args: { arg: string }[] }
}

interface Opened {
  popup: WebContentsPage
  /** Main's answer to every ask this open made. */
  answers: NonNullable<Ask['answer']>[]
}

/**
 * The picker stays mounted while hidden, so until this open's answers arrive its pill still shows
 * the previous open's. An open asks twice (when shown, and again once the args field's schema load
 * settles), so return only once main has answered both. The reset drops every earlier ask's record,
 * so a late answer to one cannot stand in for this open's.
 */
async function openStartupArgs(): Promise<Opened> {
  await closeTitlePopupIfOpen(ctx.app)
  await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))
  await resetIpcInvocations(ctx.app, ASKED)
  await resetIpcInvocations(ctx.app, 'diag:answer')
  await ctx.panel.evaluate(
    `window.api.openInstancePicker({ installationId: ${JSON.stringify(INSTALL_ID)}, initialTab: 'config' })`,
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(byTestId(TID.pickerSettingsSections), { timeout: 15_000 })
  await popup.waitForVisible(`${ARGS_FIELD} .ui-input`, { timeout: 10_000 })
  let answers: Opened['answers'] = []
  await expect
    .poll(
      async () => {
        const asks = (await getIpcInvocations(ctx.app, ASKED)) as Ask[]
        answers = asks.flatMap(({ answer }) => (answer ? [answer] : []))
        return asks.length >= 2 && answers.length === asks.length
      },
      { timeout: 15_000, intervals: [100, 200], message: 'this open never had both asks answered' },
    )
    .toBe(true)
  await expectBothAnswered()
  return { popup, answers }
}

const pillLabel = (popup: WebContentsPage): Promise<string | null> =>
  popup.evaluate<string | null>(
    `document.querySelector(${JSON.stringify(PILL)})?.getAttribute('aria-label') ?? null`,
  )

/** No answer this open got offered a grant, and once the pill has applied them it shows nothing. */
async function expectNoPill({ popup, answers }: Opened, message: string): Promise<void> {
  expect(answers.flatMap(({ args }) => args.map(({ arg }) => arg)), message).toEqual([])
  const shown = async (): Promise<string | null> =>
    (await pillLabel(popup)) ?? ((await popup.exists(LOADING)) ? 'loading' : null)
  await expect.poll(shown, { timeout: 10_000, message }).toBeNull()
}

test('a commit grant whose range contains HEAD shows before any launch @linux', async () => {
  const { popup } = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 15_000 })
  expect(await pillLabel(popup)).toBe('1 beta argument eligible for the next launch, show details')
})

test('moving HEAD below the range hides it @linux', async () => {
  await injectLateAnswer()
  git('reset', '-q', '--hard', sha.base!)
  await expectNoPill(await openStartupArgs(), 'the grant was still shown with HEAD below its range')
  await expectLateLanded()
  git('reset', '-q', '--hard', sha.head!)
  const { popup } = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 15_000 })
})

test('an object store git cannot read hides the grant, and the settings view still loads @linux', async () => {
  // Point HEAD at a commit no earlier open has proven, so nothing cached can answer for it.
  await injectLateAnswer()
  sha.next = commit('next')
  const objects = path.join(repo, '.git', 'objects')
  for (const entry of await readdir(objects)) {
    if (entry !== 'info') await rm(path.join(objects, entry), { recursive: true, force: true })
  }
  const opened = await openStartupArgs()
  await expectNoPill(opened, 'the grant was shown though git could not prove it')
  await expectLateLanded()
  expect(await opened.popup.exists(`${ARGS_FIELD} input`)).toBe(true)
})
