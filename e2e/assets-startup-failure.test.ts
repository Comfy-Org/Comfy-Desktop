/**
 * E2E: a ComfyUI that turns the assets system on by default refuses to start when its asset
 * database cannot open, printing `ASSETS_STARTUP_FAILED: <kind>` and a message for the user, then
 * exiting 1. Desktop shows that message instead of "Process exited with code 1", and when the
 * kind is `in_use` (another ComfyUI holds the database) it shows its own lock copy, even though
 * Desktop did not pass --enable-assets.
 *
 * Linux only: the ComfyUI stand-in is `fakeComfyInstall`, which is Linux-only (see its header).
 */

import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import en from '../locales/en.json'
import { launchApp, type AppContext } from './launchApp'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { hasActiveLaunch } from './support/devHooks'
import { byTestId, TID } from './support/testIds'
import { reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'

const INSTALL_ID = 'inst-assets-startup-failure'
const INSTALL_NAME = 'Assets Startup Failure Install'
const DISABLE_HINT = 'Or start ComfyUI without the assets system: --disable-assets'

let rootDir = ''
let installPath = ''
let ctx: AppContext | null = null

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

/** What ComfyUI's logger prints: alembic noise first, then the marker behind a coloured tag. */
function coreRefusal(kind: string, ...message: string[]): string {
  return (
    'INFO  [alembic.runtime.migration] Context impl SQLiteImpl.\n' +
    `\u001b[1m\u001b[31m[ERROR]\u001b[0m ASSETS_STARTUP_FAILED: ${kind}\n` +
    `${[...message, DISABLE_HINT].join('\n')}\n`
  )
}

async function launchAndReadError(stderr: string): Promise<string | null> {
  await writeFile(path.join(installPath, 'startup-failure'), stderr)
  await clickInstallTile(ctx!.panel, INSTALL_NAME)
  await ctx!.panel.waitForVisible(byTestId(TID.progressErrorMessage), { timeout: 60_000 })
  await expect.poll(() => hasActiveLaunch(ctx!.app, INSTALL_ID), { timeout: 30_000 }).toBe(false)
  const text = await ctx!.panel.textOf(byTestId(TID.progressErrorMessage))
  // Back to the chooser for the next case.
  expect(await ctx!.panel.click('.brand-progress__error-actions .brand-ghost')).toBe(true)
  await expectChooserVisible(ctx!.panel)
  return text
}

test.beforeAll(async () => {
  test.setTimeout(180_000)
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'comfyui-assets-startup-failure-'))
  installPath = path.join(rootDir, 'install')
  const { port } = await writeFakeComfyInstall({ installPath, port: await reserveFreePort() })
  ctx = await launchApp({
    profileDir: path.join(rootDir, 'profile'),
    cdpPort: await reserveFreePort(),
    settings: {
      firstUseCompleted: true,
      telemetryEnabled: false,
      // No beta grant may add --enable-assets: the lock case must hold without it.
      betaFeaturesEnabled: false,
      hasSeenCentralPillHint: true
    },
    installations: [
      {
        id: INSTALL_ID,
        name: INSTALL_NAME,
        sourceId: 'comfybuilder',
        sourceLabel: 'ComfyBuilder',
        installPath,
        status: 'installed',
        // No --enable-assets: the core under test has assets on by default.
        launchArgs: `--port ${port}`,
        launchMode: 'window',
        seen: true,
        comfyVersion: {
          commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          baseTag: 'v0.3.99',
          commitsAhead: 0,
          baseTagVerified: true
        }
      }
    ]
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (rootDir) await rm(rootDir, { recursive: true, force: true })
})

test("shows the core's message for an asset database it cannot open @linux", async () => {
  const what = "The asset database '/x/user/comfyui.db' is corrupt (file is not a database)."
  const fix = 'Move that file aside, or delete it, and start again.'

  const text = await launchAndReadError(coreRefusal('corrupt', what, fix))

  expect(text).toBe(`${what}\n${fix}\n${DISABLE_HINT}`)
})

test('shows the lock message when another ComfyUI holds the database, without --enable-assets @linux', async () => {
  const text = await launchAndReadError(
    coreRefusal(
      'in_use',
      "Another ComfyUI is already using this database: '/x/user/comfyui.db'.",
      'Close the other ComfyUI and start this one again.'
    )
  )

  expect(text).toBe(en.errors.comfyDbLocked)
})
