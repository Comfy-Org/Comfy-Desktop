/**
 * Lifecycle E2E: picker-driven copy-and-update failure branch.
 *
 * `handleCopyUpdate` runs the copy first, then chains an
 * `update-comfyui` against the freshly-copied install. When the update
 * leg fails (here: the seeded source has a real ComfyUI/.git — so the
 * picker actually offers Copy & Update — but no standalone Python env,
 * so `handleUpdateComfyUI` bails with "Master Python not found.")
 * the handler must NOT roll back the copy — the user already paid the
 * cost of duplicating the install, so we keep the new install and let
 * them retry the update from it. Pinned contract:
 *
 *   - returns `{ ok: true, newInstallationId, navigate: 'list' }` so
 *     ProgressModal's handleDone still opens the destination,
 *   - new install dir + registry entry survive,
 *   - source dir + marker untouched,
 *   - the user-facing output banner contains both the update failure
 *     and the "retry the update from the new installation" hint.
 */

import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { closeTitlePopupIfOpen, titlePopupPage, waitForWebContents } from './support/cdpPages'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let sourcePath: string

const SOURCE_ID = 'inst-copy-update-fail-source'
const SOURCE_NAME = 'Copy-Update Fail Source'
const COPY_NAME = 'Copy-Update Fail Destination'
const MARKER_FILENAME = '.comfyui-desktop-2'

interface InstallationLike {
  id: string
  name: string
  installPath?: string
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  sourcePath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-copy-update-fail-e2e-'))
  await mkdir(sourcePath, { recursive: true })
  await writeFile(path.join(sourcePath, MARKER_FILENAME), SOURCE_ID)
  // A real ComfyUI/.git so the Update tab's channel card gates
  // (`updateAvailable && hasGit`) actually expose the Copy & Update
  // button — without it the flow is unreachable through the UI. The
  // update leg still fails for real: there is no standalone Python env
  // in the fixture, so `handleUpdateComfyUI` bails with "Master Python
  // not found." AFTER the copy succeeded (performCopy is dumb-recursive
  // over whatever's in the source dir).
  const comfyuiDir = path.join(sourcePath, 'ComfyUI')
  await mkdir(comfyuiDir, { recursive: true })
  execFileSync('git', ['init', '--quiet', comfyuiDir], { stdio: 'ignore' })

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: SOURCE_ID,
        name: SOURCE_NAME,
        installPath: sourcePath,
        sourceId: 'standalone',
        status: 'installed',
        updateChannel: 'stable',
        comfyVersion: { commit: 'a'.repeat(40), baseTag: 'v0.1.0', commitsAhead: 0 },
        releaseTag: 'v0.1.0',
        variant: 'cpu',
        pythonVersion: '3.12',
      },
    ],
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (sourcePath) await rm(sourcePath, { recursive: true, force: true })
})

test('copy-update keeps the new install when the chained update fails @lifecycle', async () => {
  test.setTimeout(120_000)

  await ctx.panel.evaluate<void>(
    `window.api.openInstancePicker({ installationId: ${JSON.stringify(SOURCE_ID)}, initialTab: 'update' })`,
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)

  const copyUpdateButton = byTestId(TID.updateActionButton('copy-update'))
  await popup.waitForVisible(copyUpdateButton, { timeout: 30_000 })
  await popup.waitFor(
    () => popup.evaluate<boolean>(
      `(() => { const el = document.querySelector(${JSON.stringify(copyUpdateButton)}); return !!el && !el.disabled })()`,
    ),
    { timeout: 30_000, message: 'copy-update button never became enabled' },
  )
  expect(await popup.click(copyUpdateButton)).toBe(true)

  const promptInput = byTestId(TID.basePromptInput)
  await popup.waitForVisible(promptInput, { timeout: 10_000 })
  await popup.evaluate<void>(`(() => {
    const el = document.querySelector(${JSON.stringify(promptInput)})
    el.value = ${JSON.stringify(COPY_NAME)}
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  expect(await popup.click(byTestId(TID.basePromptAction))).toBe(true)

  // The action may or may not interpose a confirmation, and on a slow run
  // it can appear well after any fixed guess. Poll for EITHER the confirm
  // control (click it) OR evidence the copy already ran without one (the
  // new install landing in the registry), whichever comes first.
  const confirmSelector = `${byTestId(TID.modalConfirm)}, ${byTestId(TID.baseAlertAction)}`
  const copyRegistered = async (): Promise<boolean> => {
    const installs = await ctx.panel.evaluate<InstallationLike[]>('window.api.getInstallations()')
    return installs.some((i) => i.id !== SOURCE_ID && i.name === COPY_NAME)
  }
  const confirmDeadline = Date.now() + 30_000
  while (Date.now() < confirmDeadline) {
    if (await popup.isVisible(confirmSelector).catch(() => false)) {
      // A false click return means the surface vanished between the
      // visibility check and the click — keep polling.
      if (await popup.click(confirmSelector)) break
    } else if (await copyRegistered()) {
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  let installations: InstallationLike[] = []
  await expect.poll(async () => {
    installations = await ctx.panel.evaluate<InstallationLike[]>('window.api.getInstallations()')
    return installations.some((i) => i.id !== SOURCE_ID && i.name === COPY_NAME)
  }, { timeout: 60_000, intervals: [250, 500, 1_000] }).toBe(true)

  // Registry survives the update failure — new install is enumerated
  // alongside the source.
  const newEntry = installations.find((i) => i.id !== SOURCE_ID && i.name === COPY_NAME)
  expect(newEntry, 'new install id missing from registry after copy-update failure').toBeDefined()
  expect(newEntry?.installPath, 'new install must carry an installPath').toBeTruthy()
  const newId = newEntry!.id

  const destPath = newEntry!.installPath!
  expect(await pathExists(destPath), `destination dir ${destPath} missing after copy-update`).toBe(true)
  const destMarker = await readFile(path.join(destPath, MARKER_FILENAME), 'utf8')
  expect(destMarker, 'destination marker should carry the new install id').toBe(newId)

  // Source untouched.
  expect(await pathExists(sourcePath)).toBe(true)
  const sourceMarker = await readFile(path.join(sourcePath, MARKER_FILENAME), 'utf8')
  expect(sourceMarker).toBe(SOURCE_ID)

  // Failure trail: picker-driven ops run as main-side background ops, so
  // the handler's sendOutput text never reaches a renderer — it lands in
  // the durable per-user app log (`appendLog` → app.log), which is where
  // a user chasing "why did my update not apply?" ends up. Both the
  // update-failure marker AND the retry hint must be on disk. The
  // registry entry lands when the copy finishes — the update leg (and
  // its failure output) completes after that, so poll.
  const logsDir = await ctx.app.evaluate(({ app }) => app.getPath('logs'))
  const appLogPath = path.join(logsDir, 'app.log')
  await expect
    .poll(async () => {
      try {
        return await readFile(appLogPath, 'utf8')
      } catch {
        return ''
      }
    }, { timeout: 30_000, intervals: [250, 500, 1_000] })
    .toContain('retry the update from the new installation')
  const logText = await readFile(appLogPath, 'utf8')
  expect(logText, `app.log never carried the update-failure marker`).toMatch(/Update/)

  // Cleanup so reruns start clean.
  await rm(destPath, { recursive: true, force: true })
  await closeTitlePopupIfOpen(ctx.app)
})
