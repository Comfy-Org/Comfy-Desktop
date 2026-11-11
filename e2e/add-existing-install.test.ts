import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { evalWithRetry } from './support/evalRetry'
import { byTestId, TID } from './support/testIds'

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
      GIT_AUTHOR_NAME: 'E2E Test',
      GIT_AUTHOR_EMAIL: 'e2e@example.com',
      GIT_COMMITTER_NAME: 'E2E Test',
      GIT_COMMITTER_EMAIL: 'e2e@example.com'
    },
    stdio: 'pipe'
  })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  stagedPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-add-existing-e2e-'))
  const comfyuiDir = path.join(stagedPath, 'ComfyUI')
  await mkdir(comfyuiDir, { recursive: true })
  await mkdir(path.join(stagedPath, 'standalone-env'), { recursive: true })
  await writeFile(path.join(comfyuiDir, 'main.py'), '# placeholder for probe\n')
  await writeFile(
    path.join(stagedPath, 'manifest.json'),
    JSON.stringify({
      comfyui_ref: 'main',
      version: 'v0.3.10',
      id: 'win-cpu',
      python_version: '3.12'
    })
  )

  gitIn(comfyuiDir, ['init', '--quiet', '--initial-branch=main'])
  await writeFile(path.join(comfyuiDir, '.gitignore'), '')
  gitIn(comfyuiDir, ['add', '.'])
  gitIn(comfyuiDir, ['commit', '--quiet', '-m', 'staged commit'])

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false }
  })
  await expectChooserVisible(ctx.panel)

  await evalWithRetry(() =>
    ctx.app.evaluate(({ dialog }, dirPath) => {
      ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dirPath]
      })
    }, stagedPath)
  )
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (stagedPath) await rm(stagedPath, { recursive: true, force: true })
})

test('Builds menu → Add Existing → Browse probes the staged directory → Add Build registers it @nightly', async () => {
  expect(await ctx.panel.click('[data-testid="build-actions-menu-trigger"]')).toBe(true)
  await ctx.panel.waitForVisible('[data-testid="build-actions-add-existing"]')
  expect(await ctx.panel.click('[data-testid="build-actions-add-existing"]')).toBe(true)

  await ctx.panel.waitForVisible('[data-testid="track-modal"]', { timeout: 10_000 })

  expect(await ctx.panel.click(byTestId(TID.trackBrowse))).toBe(true)
  await ctx.panel.waitFor(
    async () => (await ctx.panel.allText('.track-path-open')).some((t) => t.includes(stagedPath)),
    { timeout: 10_000, message: 'picked directory never appeared in the path field' }
  )

  await ctx.panel.waitFor(
    async () => {
      const values = await ctx.panel.allText('.track-summary-value')
      return values.length > 0 && values.some((v) => v.trim().length > 0)
    },
    { timeout: 15_000, message: 'probe never populated the detected-install summary' }
  )

  await ctx.panel.evaluate<void>(
    `(() => {
      const el = document.querySelector('#track-name')
      if (!el) throw new Error('track name input not found')
      el.value = ${JSON.stringify(TRACKED_NAME)}
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })()`
  )
  expect(await ctx.panel.click('.track-save')).toBe(true)

  await expectChooserVisible(ctx.panel)
  await ctx.panel.waitFor(
    async () =>
      (
        await ctx.panel.allText(
          '.chooser-tile:not(.chooser-tile-new):not(.chooser-tile-cloud) .chooser-tile-name'
        )
      ).includes(TRACKED_NAME),
    { timeout: 10_000, message: 'tracked install never appeared in chooser' }
  )

  const installs = await ctx.panel.evaluate<Installation[]>(`window.api.getInstallations()`)
  const tracked = installs.find((i) => i.name === TRACKED_NAME)
  expect(tracked, 'tracked install not present in get-installations result').toBeDefined()
  expect(tracked!.sourceId).toBe('standalone')
  expect(tracked!.installPath).toBe(stagedPath)
  expect(tracked!.comfyVersion?.commit).toMatch(/^[0-9a-f]{40}$/)
  expect(tracked!.version, 'version label missing from renderer payload').toBeTruthy()
  expect(tracked!.version).not.toBe('standalone')
})
