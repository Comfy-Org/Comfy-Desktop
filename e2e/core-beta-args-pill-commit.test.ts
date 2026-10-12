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
/** Not an install: what the hidden picker asks for to mark where an open's asks start. */
const OPEN_MARK = 'e2e-open-mark'
const UNREACHABLE_POSTHOG_HOST = 'http://127.0.0.1:1'

let ctx: AppContext
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
  installationId: string
  answer?: { args: { arg: string }[] }
}

type Answer = NonNullable<Ask['answer']>

interface Opened {
  popup: WebContentsPage
  /** Whether a hidden picker was there to mark where this open's asks start. */
  marked: boolean
  /** Main's answer to every ask this open made. */
  answers: Answer[]
}

/** Whether an earlier open mounted the picker, whose pill can then ask while hidden. */
let pickerMounted = false

/**
 * Has the hidden picker ask for OPEN_MARK as the next config reaches it. This listener runs after
 * the picker's own, before Vue flushes the watchers that ask for the open, and main records one
 * renderer's asks in the order it sent them. So the asks after the mark are the open's, and none
 * the hidden picker sent before the config arrived is.
 */
async function markNextOpen(): Promise<void> {
  await titlePopupPage(ctx.app).evaluate(`(() => {
    window.__e2eUnmarkOpen?.()
    const off = window.__comfyTitlePopup.onConfig(() => {
      off()
      void window.api.getCoreBetaArgs(${JSON.stringify(OPEN_MARK)})
    })
    window.__e2eUnmarkOpen = off
  })()`)
}

/**
 * Main's answers once the open has asked at least twice (when shown, and again once the args
 * field's schema load settles) and every ask so far is answered. Until then the hidden picker's
 * pill still shows the previous open's answer.
 */
async function answersOf(marked: boolean): Promise<Answer[]> {
  let answers: Answer[] = []
  await expect
    .poll(
      async () => {
        const recorded = (await getIpcInvocations(ctx.app, ASKED)) as Ask[]
        const start = marked
          ? recorded.findIndex(({ installationId }) => installationId === OPEN_MARK) + 1
          : 0
        const asks = marked && start === 0 ? [] : recorded.slice(start)
        answers = asks.flatMap(({ answer }) => (answer ? [answer] : []))
        return asks.length >= 2 && answers.length === asks.length
      },
      { timeout: 15_000, intervals: [100, 200], message: 'this open never had both asks answered' },
    )
    .toBe(true)
  return answers
}

/** The reset drops every earlier ask's record, so a late answer to one cannot stand in for this open's. */
async function openStartupArgs(): Promise<Opened> {
  await closeTitlePopupIfOpen(ctx.app)
  await new Promise((resolve) => setTimeout(resolve, TITLE_REOPEN_SUPPRESSION_MS))
  await resetIpcInvocations(ctx.app, ASKED)
  const marked = pickerMounted
  if (marked) await markNextOpen()
  await ctx.panel.evaluate(
    `window.api.openInstancePicker({ installationId: ${JSON.stringify(INSTALL_ID)}, initialTab: 'config' })`,
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(byTestId(TID.pickerSettingsSections), { timeout: 15_000 })
  await popup.waitForVisible(`${ARGS_FIELD} .ui-input`, { timeout: 10_000 })
  const answers = await answersOf(marked)
  pickerMounted = true
  return { popup, marked, answers }
}

const pillLabel = (popup: WebContentsPage): Promise<string | null> =>
  popup.evaluate<string | null>(
    `document.querySelector(${JSON.stringify(PILL)})?.getAttribute('aria-label') ?? null`,
  )

const granted = (answers: Answer[]): string[] =>
  answers.flatMap(({ args }) => args.map(({ arg }) => arg))

/** No answer this open got offered a grant, the pill shows nothing once it has applied them, and
 *  no ask the open made by then offered one either. */
async function expectNoPill({ popup, marked, answers }: Opened, message: string): Promise<void> {
  expect(granted(answers), message).toEqual([])
  const shown = async (): Promise<string | null> =>
    (await pillLabel(popup)) ?? ((await popup.exists(LOADING)) ? 'loading' : null)
  await expect.poll(shown, { timeout: 10_000, message }).toBeNull()
  expect(granted(await answersOf(marked)), message).toEqual([])
}

test('a commit grant whose range contains HEAD shows before any launch @linux', async () => {
  const { popup } = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 15_000 })
  expect(await pillLabel(popup)).toBe('1 beta argument eligible for the next launch, show details')
})

test('moving HEAD below the range hides it @linux', async () => {
  git('reset', '-q', '--hard', sha.base!)
  await expectNoPill(await openStartupArgs(), 'the grant was still shown with HEAD below its range')
  git('reset', '-q', '--hard', sha.head!)
  const { popup } = await openStartupArgs()
  await popup.waitForVisible(PILL, { timeout: 15_000 })
})

test('an object store git cannot read hides the grant, and the settings view still loads @linux', async () => {
  // Point HEAD at a commit no earlier open has proven, so nothing cached can answer for it.
  sha.next = commit('next')
  const objects = path.join(repo, '.git', 'objects')
  for (const entry of await readdir(objects)) {
    if (entry !== 'info') await rm(path.join(objects, entry), { recursive: true, force: true })
  }
  const opened = await openStartupArgs()
  await expectNoPill(opened, 'the grant was shown though git could not prove it')
  expect(await opened.popup.exists(`${ARGS_FIELD} input`)).toBe(true)
})
