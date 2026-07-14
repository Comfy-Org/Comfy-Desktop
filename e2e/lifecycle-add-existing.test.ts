/**
 * Lifecycle E2E: Add Existing (track an externally-staged install).
 *
 * Pre-stages a standalone-shaped ComfyUI directory on disk (real git init
 * + tagged commit, empty `standalone-env/`, `ComfyUI/main.py`, a manifest)
 * and drives the real importer UI end-to-end:
 *   waffle menu → Add Existing Instance → TrackModal takeover →
 *   Browse (native dialog stubbed with the staged path) → real probe →
 *   Track Install → chooser tile.
 *
 * Only the OS directory picker is stubbed (Playwright cannot drive native
 * dialogs); the stub supplies the path and nothing else — the probe and
 * tracking run for real against the staged directory.
 */

import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { titlePopupPage, waitForWebContents } from './support/cdpPages'

let ctx: AppContext
let stagedPath: string

const TRACKED_NAME = 'Pre-Staged Install'

interface Installation {
  id: string
  name: string
  installPath: string
  sourceId: string
  comfyVersion?: { commit: string; baseTag?: string; commitsAhead?: number }
  version?: string
  [key: string]: unknown
}

function gitIn(cwd: string, args: string[]): void {
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Lifecycle Test',
      GIT_AUTHOR_EMAIL: 'lifecycle@example.com',
      GIT_COMMITTER_NAME: 'Lifecycle Test',
      GIT_COMMITTER_EMAIL: 'lifecycle@example.com',
    },
    stdio: 'pipe',
  })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  stagedPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-add-existing-e2e-'))
  const comfyuiDir = path.join(stagedPath, 'ComfyUI')
  await mkdir(comfyuiDir, { recursive: true })
  await mkdir(path.join(stagedPath, 'standalone-env'), { recursive: true })
  await writeFile(path.join(comfyuiDir, 'main.py'), '# placeholder for probe\n')
  // Standalone probe reads manifest.json from the install root for the
  // ref / releaseTag / variant / pythonVersion fields. Values don't drive
  // the assertion here — they exist so the renderer-facing payload is
  // populated end-to-end the way a real install would be.
  await writeFile(
    path.join(stagedPath, 'manifest.json'),
    JSON.stringify({
      comfyui_ref: 'main',
      version: 'v0.3.10',
      id: 'win-cpu',
      python_version: '3.12',
    }),
  )

  gitIn(comfyuiDir, ['init', '--quiet', '--initial-branch=main'])
  await writeFile(path.join(comfyuiDir, '.gitignore'), '')
  gitIn(comfyuiDir, ['add', '.'])
  gitIn(comfyuiDir, ['commit', '--quiet', '-m', 'staged commit'])

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
  })
  await expectChooserVisible(ctx.panel)

  // Stub only the native directory picker (Playwright cannot drive OS
  // dialogs) — it supplies the staged path; probe + track stay real.
  await ctx.app.evaluate(({ dialog }, dirPath) => {
    ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({
      canceled: false,
      filePaths: [dirPath],
    })
  }, stagedPath)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (stagedPath) await rm(stagedPath, { recursive: true, force: true })
})

test('waffle menu → Add Existing opens TrackModal; Browse probes the staged directory @lifecycle', async () => {
  // Real entry point: title-bar waffle menu → "Add Existing Instance".
  // On a dashboard host the flow takes over the current window's panel.
  expect(await ctx.titleBar.click('.title-menu-button')).toBe(true)
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible('li.item', { timeout: 10_000 })
  expect(await popup.clickByText('li.item', 'Add Existing Instance')).toBe(true)

  await ctx.panel.waitForVisible('[data-testid="track-modal"]', { timeout: 10_000 })

  // Browse — the stubbed OS dialog returns the staged path; TrackModal
  // then fires the real probe against it.
  expect(await ctx.panel.click('.track-path-row .brand-tertiary')).toBe(true)
  await ctx.panel.waitFor(
    async () => (await ctx.panel.allText('.track-path-open')).some((t) => t.includes(stagedPath)),
    { timeout: 10_000, message: 'picked directory never appeared in the path field' },
  )

  // The real probe resolves the staged git ref: the detected-type select
  // fills and the summary shows a version row (would fall back to the
  // manifest's raw ref string without ComfyUI/.git).
  await ctx.panel.waitFor(
    async () => {
      const values = await ctx.panel.allText('.brand-summary__value')
      return values.length > 0 && values.some((v) => v.trim().length > 0)
    },
    { timeout: 15_000, message: 'probe never populated the detected-install summary' },
  )
})

test('Track Install registers the directory and chooser shows the tile @lifecycle', async () => {
  await ctx.panel.evaluate<void>(
    `(() => {
      const el = document.querySelector('#track-name')
      if (!el) throw new Error('track name input not found')
      el.value = ${JSON.stringify(TRACKED_NAME)}
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })()`,
  )
  expect(await ctx.panel.click('.track-save')).toBe(true)

  // Save closes the takeover and lands back on the chooser.
  await expectChooserVisible(ctx.panel)
  await ctx.panel.waitFor(
    async () =>
      (await ctx.panel.allText(
        '.chooser-tile:not(.chooser-tile-new):not(.chooser-tile-cloud) .chooser-tile-name',
      )).includes(TRACKED_NAME),
    { timeout: 10_000, message: 'tracked install never appeared in chooser' },
  )

  const installs = await ctx.panel.evaluate<Installation[]>(
    `window.api.getInstallations()`,
  )
  const tracked = installs.find((i) => i.name === TRACKED_NAME)
  expect(tracked, 'tracked install not present in get-installations result').toBeDefined()
  expect(tracked!.sourceId).toBe('standalone')
  expect(tracked!.installPath).toBe(stagedPath)
  // The standalone probe attaches a resolved `comfyVersion` whenever the
  // ComfyUI/.git dir is reachable; the tracked record must carry it.
  expect(tracked!.comfyVersion?.commit).toMatch(/^[0-9a-f]{40}$/)
  // Renderer-facing `version` is derived from the resolved comfyVersion via
  // `enrichInstallationsForRenderer`; with git present it should not fall
  // back to the raw sourceId string.
  expect(tracked!.version, 'version label missing from renderer payload').toBeTruthy()
  expect(tracked!.version).not.toBe('standalone')
})
