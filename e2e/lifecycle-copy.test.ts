/**
 * Lifecycle E2E: picker-driven plain Copy action (no chained update).
 *
 * Drives the instance picker's Settings footer More menu and copy prompt,
 * then verifies that the destination is registered and copied on disk with
 * a fresh marker while the source remains untouched.
 */

import os from 'node:os'
import path from 'node:path'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { closeTitlePopupIfOpen, titlePopupPage, waitForWebContents } from './support/cdpPages'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let sourcePath: string

const SOURCE_ID = 'inst-copy-plain-source'
const SOURCE_NAME = 'Plain Copy Source'
const COPY_NAME = 'Plain Copy Destination'
const EXTRA_FILENAME = 'workflow.json'
const EXTRA_CONTENTS = '{"copy":"me"}'

/** Same marker filename `performCopy` writes into the destination dir. */
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
  sourcePath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-copy-plain-e2e-'))
  await mkdir(sourcePath, { recursive: true })
  // Marker file is required for delete-style ops; performCopy doesn't gate
  // on it, but seeding it lets us assert the destination gets a FRESH
  // marker (containing the new id) rather than the source's copy.
  await writeFile(path.join(sourcePath, MARKER_FILENAME), SOURCE_ID)
  await writeFile(path.join(sourcePath, EXTRA_FILENAME), EXTRA_CONTENTS)

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: SOURCE_ID,
        name: SOURCE_NAME,
        installPath: sourcePath,
        sourceId: 'standalone',
        status: 'installed',
      },
    ],
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (sourcePath) await rm(sourcePath, { recursive: true, force: true })
})

test('Copy creates a new install on disk + in the registry, source untouched @lifecycle', async () => {
  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(SOURCE_ID)},
        initialTab: 'settings',
      })
      return true
    })()`,
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)

  await popup.waitForVisible('button.settings-v2-more', { timeout: 30_000 })
  // Opening Update can start its stale-channel refresh on the next tick. Let
  // that settle, then require the real control to be enabled before clicking.
  await popup.evaluate<void>('new Promise((resolve) => setTimeout(resolve, 1000))')
  await popup.waitFor(
    () => popup.evaluate<boolean>(
      `document.querySelector('button.settings-v2-more')?.hasAttribute('disabled') === false`,
    ),
    { timeout: 30_000, message: 'Settings More button did not become enabled' },
  )
  expect(await popup.click('button.settings-v2-more')).toBe(true)
  const copyAction = byTestId(TID.pinBottomAction('copy'))
  await popup.waitForVisible(copyAction, { timeout: 10_000 })
  expect(await popup.click(copyAction)).toBe(true)

  const promptInput = byTestId(TID.basePromptInput)
  const promptAction = byTestId(TID.basePromptAction)
  await popup.waitForVisible(promptInput, { timeout: 10_000 })
  expect(await popup.evaluate<boolean>(`(() => {
    const el = document.querySelector(${JSON.stringify(promptInput)})
    if (!(el instanceof HTMLInputElement)) return false
    el.value = ${JSON.stringify(COPY_NAME)}
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)).toBe(true)
  expect(await popup.click(promptAction)).toBe(true)

  await expect.poll(
    async () => {
      const current = await ctx.panel.evaluate<InstallationLike[]>('window.api.getInstallations()')
      return current.some((installation) =>
        installation.id !== SOURCE_ID && installation.name === COPY_NAME)
    },
    { timeout: 60_000, intervals: [500, 1_000] },
  ).toBe(true)

  // Registry: getInstallations() now enumerates the new entry alongside
  // the source. Name is uniqueified by `uniqueName` — first use of the
  // requested name is taken verbatim, so the seeded source dictates
  // there's no collision.
  const installations = await ctx.panel.evaluate<InstallationLike[]>(
    'window.api.getInstallations()',
  )
  const newEntry = installations.find((i) => i.id !== SOURCE_ID && i.name === COPY_NAME)
  expect(newEntry, 'new install not enumerated after copy').toBeDefined()
  expect(newEntry?.name).toBe(COPY_NAME)
  expect(newEntry?.installPath, 'new install must have a destination path').toBeTruthy()
  expect(installations.find((i) => i.id === SOURCE_ID), 'source install dropped after copy').toBeDefined()
  const newId = newEntry!.id

  // Disk: destination dir exists, contains the user-data file copied
  // from source, AND the marker file was rewritten with the NEW id (not
  // the source id).
  const destPath = newEntry!.installPath!
  expect(destPath).not.toBe(sourcePath)
  expect(await pathExists(destPath), `destination dir ${destPath} missing after copy`).toBe(true)

  const copiedExtra = await readFile(path.join(destPath, EXTRA_FILENAME), 'utf8')
  expect(copiedExtra, 'extra file did not copy through').toBe(EXTRA_CONTENTS)

  const destMarker = await readFile(path.join(destPath, MARKER_FILENAME), 'utf8')
  expect(destMarker, 'destination marker was not rewritten with the new install id').toBe(newId)

  // Source must remain pristine — same dir, same marker contents, same
  // user-data file. Plain copy is non-destructive on the source side.
  expect(await pathExists(sourcePath), 'source dir disappeared after copy').toBe(true)
  const sourceMarker = await readFile(path.join(sourcePath, MARKER_FILENAME), 'utf8')
  expect(sourceMarker, 'source marker was mutated by copy').toBe(SOURCE_ID)
  const sourceExtra = await readFile(path.join(sourcePath, EXTRA_FILENAME), 'utf8')
  expect(sourceExtra, 'source extra file was mutated by copy').toBe(EXTRA_CONTENTS)

  // Cleanup the per-run destination dir so a re-run of this suite
  // starts from a clean slate (registry entries are wiped by
  // `ctx.cleanup`, but `parentDir` is `os.tmpdir()` so leftover dirs
  // would accumulate across reruns).
  await rm(destPath, { recursive: true, force: true })
  await closeTitlePopupIfOpen(ctx.app)
})
