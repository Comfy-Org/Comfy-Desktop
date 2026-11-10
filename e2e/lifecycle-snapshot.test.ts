import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { closeTitlePopupIfOpen, titlePopupPage, waitForWebContents } from './support/cdpPages'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let stagedInstallPath = ''

const INSTALL_ID = 'inst-snapshot-test'
const INSTALL_NAME = 'Snapshot Test Install'
const SEEDED_COMMIT = 'a'.repeat(40)
const SEEDED_BASE_TAG = 'v0.3.10'
const SEEDED_COMMITS_AHEAD = 2
const EXPECTED_VERSION = `${SEEDED_BASE_TAG}+${SEEDED_COMMITS_AHEAD}`

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  stagedInstallPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-snapshot-e2e-'))
  await mkdir(path.join(stagedInstallPath, 'ComfyUI'), { recursive: true })

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: INSTALL_ID,
        name: INSTALL_NAME,
        installPath: stagedInstallPath,
        sourceId: 'standalone',
        status: 'installed',
        snapshots: [
          {
            trigger: 'manual',
            comfyui: {
              ref: SEEDED_COMMIT,
              commit: SEEDED_COMMIT,
              releaseTag: SEEDED_BASE_TAG,
              variant: 'cpu',
              baseTag: SEEDED_BASE_TAG,
              commitsAhead: SEEDED_COMMITS_AHEAD
            }
          }
        ]
      }
    ]
  })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (stagedInstallPath) await rm(stagedInstallPath, { recursive: true, force: true })
})

test('seeded snapshot row renders the backend-formatted version @lifecycle', async () => {
  const opened = await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(INSTALL_ID)},
        initialTab: 'snapshots',
      })
      return true
    })()`
  )
  expect(opened).toBe(true)

  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible('.snapshot-row', { timeout: 15_000 })

  const versionText = await popup.textOf('.snap-pill--version')
  expect(versionText, 'snapshot version pill not rendered').not.toBeNull()
  expect(versionText!).toContain(EXPECTED_VERSION)

  await closeTitlePopupIfOpen(ctx.app)
})

test('captures a new snapshot through the picker UI and shows it at the top @lifecycle', async () => {
  const before = await ctx.panel.evaluate<number>(
    `window.api.getSnapshots(${JSON.stringify(INSTALL_ID)}).then(d => d.snapshots.length)`
  )
  expect(before).toBe(1)

  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(INSTALL_ID)},
        initialTab: 'snapshots',
      })
      return true
    })()`
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)

  await popup.waitForVisible(byTestId(TID.snapshotsSaveCta), { timeout: 15_000 })
  expect(await popup.click(byTestId(TID.snapshotsSaveCta))).toBe(true)

  await popup.waitForVisible(byTestId(TID.basePromptInput), { timeout: 15_000 })
  await popup.fill(byTestId(TID.basePromptInput), 'captured-by-test')
  expect(await popup.click(byTestId(TID.basePromptAction))).toBe(true)

  await expect
    .poll(
      async () =>
        ctx.panel.evaluate<number>(
          `window.api.getSnapshots(${JSON.stringify(INSTALL_ID)}).then(d => d.snapshots.length)`
        ),
      { timeout: 15_000, intervals: [250, 500] }
    )
    .toBe(2)

  const snapshots = await ctx.panel.evaluate<Array<{ filename: string; label: string | null }>>(
    `window.api.getSnapshots(${JSON.stringify(INSTALL_ID)}).then(d => d.snapshots.map(s => ({ filename: s.filename, label: s.label })))`
  )
  expect(snapshots[0]?.label).toBe('captured-by-test')
  await popup.waitForSelector(byTestId(TID.snapshotRow(snapshots[0]!.filename)), {
    timeout: 15_000
  })

  await closeTitlePopupIfOpen(ctx.app)
})
