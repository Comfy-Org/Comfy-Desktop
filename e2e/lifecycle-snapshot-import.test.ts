import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { titlePopupPage } from './support/cdpPages'
import { evalWithRetry } from './support/evalRetry'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let installPath = ''
let envelopeDir = ''
let envelopePath = ''

const INSTALL_ID = 'inst-snapshot-import-test'
const INSTALL_NAME = 'Snapshot Import Test'
const IMPORTED_COMMIT = 'c'.repeat(40)
const IMPORTED_LABEL = 'imported-from-envelope'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-snapshot-import-e2e-'))
  envelopeDir = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-snapshot-import-src-'))
  await mkdir(path.join(installPath, 'ComfyUI'), { recursive: true })

  envelopePath = path.join(envelopeDir, 'seed-envelope.json')
  const envelope = {
    type: 'comfyui-desktop-2-snapshot',
    version: 1,
    exportedAt: new Date().toISOString(),
    installationName: 'Source Install',
    snapshots: [
      {
        version: 1,
        createdAt: new Date().toISOString(),
        trigger: 'manual',
        label: IMPORTED_LABEL,
        comfyui: {
          ref: IMPORTED_COMMIT,
          commit: IMPORTED_COMMIT,
          releaseTag: 'v0.3.10',
          variant: 'cpu',
          baseTag: 'v0.3.10',
          commitsAhead: 0
        },
        customNodes: [],
        pipPackages: {},
        updateChannel: 'stable'
      }
    ]
  }
  await writeFile(envelopePath, JSON.stringify(envelope, null, 2))

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: INSTALL_ID,
        name: INSTALL_NAME,
        installPath,
        sourceId: 'standalone',
        status: 'installed'
      }
    ]
  })

  await evalWithRetry(() =>
    ctx.app.evaluate(({ dialog }, filePath) => {
      ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filePath]
      })
    }, envelopePath)
  )
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (envelopeDir) await rm(envelopeDir, { recursive: true, force: true })
})

test('Import via the toolbar stages a restore target without touching history @windows @macos @linux', async () => {
  const initialCount = await ctx.panel.evaluate<number>(
    `window.api.getSnapshots(${JSON.stringify(INSTALL_ID)}).then(d => d.snapshots.length)`
  )
  expect(initialCount).toBe(0)

  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(INSTALL_ID)},
        initialTab: 'snapshots',
      })
      return true
    })()`
  )
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(byTestId(TID.snapshotsImport), { timeout: 15_000 })

  expect(await popup.click(byTestId(TID.snapshotsImport))).toBe(true)

  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  await popup.waitFor(async () => ((await popup.textOf('body')) ?? '').includes(IMPORTED_LABEL), {
    timeout: 10_000,
    message: 'preview modal did not list the imported snapshot label'
  })
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)

  await popup.waitForVisible(
    `.snapshots-rail-save-box.is-op-error ${byTestId(TID.snapshotsOpCardRetry)}`,
    { timeout: 60_000 }
  )

  const snapshots = await ctx.panel.evaluate<Array<{ label: string | null; trigger?: string }>>(
    `window.api.getSnapshots(${JSON.stringify(INSTALL_ID)}).then(d => d.snapshots.map(s => ({ label: s.label, trigger: s.trigger })))`
  )
  expect(snapshots.some((s) => s.label === IMPORTED_LABEL)).toBe(false)
  expect(snapshots.some((s) => s.trigger === 'manual')).toBe(false)
})
