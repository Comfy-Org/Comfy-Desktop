import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { titlePopupPage } from './support/cdpPages'
import { evalWithRetry } from './support/evalRetry'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let installPath = ''
let exportDir = ''

const INSTALL_ID = 'inst-snapshot-export-test'
const INSTALL_NAME = 'Snapshot Export Test'
const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)
const BASE_TAG = 'v0.3.10'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-snapshot-export-e2e-'))
  exportDir = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-snapshot-export-out-'))
  await mkdir(path.join(installPath, 'ComfyUI'), { recursive: true })

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: INSTALL_ID,
        name: INSTALL_NAME,
        installPath,
        sourceId: 'standalone',
        status: 'installed',
        snapshots: [
          {
            trigger: 'manual',
            label: 'first-seeded',
            createdAt: '2026-01-01T00:00:00.000Z',
            comfyui: {
              ref: COMMIT_A,
              commit: COMMIT_A,
              releaseTag: BASE_TAG,
              variant: 'cpu',
              baseTag: BASE_TAG,
              commitsAhead: 1
            }
          },
          {
            trigger: 'manual',
            label: 'second-seeded',
            createdAt: '2026-01-02T00:00:00.000Z',
            comfyui: {
              ref: COMMIT_B,
              commit: COMMIT_B,
              releaseTag: BASE_TAG,
              variant: 'cpu',
              baseTag: BASE_TAG,
              commitsAhead: 2
            }
          }
        ]
      }
    ]
  })

  await evalWithRetry(() =>
    ctx.app.evaluate(({ dialog }, dir) => {
      ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async (
        _win: unknown,
        opts: { defaultPath?: string }
      ) => {
        const raw = opts.defaultPath ?? 'snapshot-export.json'
        const lastSep = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
        const base = lastSep >= 0 ? raw.slice(lastSep + 1) : raw
        const sep = dir.includes('\\') ? '\\' : '/'
        return { canceled: false, filePath: `${dir}${sep}${base}` }
      }
    }, exportDir)
  )
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (exportDir) await rm(exportDir, { recursive: true, force: true })
})

async function openSnapshotsTab(): Promise<ReturnType<typeof titlePopupPage>> {
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
  await popup.waitForVisible('.snapshot-row', { timeout: 15_000 })
  return popup
}

async function findExportedFile(prefix: string): Promise<string | null> {
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(exportDir)
  const match = entries.find((e) => e.startsWith(prefix) && e.endsWith('.json'))
  return match ? path.join(exportDir, match) : null
}

async function waitForExportedEnvelope<T>(prefix: string): Promise<T> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const match = await findExportedFile(prefix)
    if (match) {
      try {
        return JSON.parse(await readFile(match, 'utf-8')) as T
      } catch {}
    }
    if (Date.now() > deadline) {
      throw new Error(`exported ${prefix}*.json did not appear (or never parsed) within 10s`)
    }
    await new Promise((r) => setTimeout(r, 200))
  }
}

test('per-row Export writes a valid envelope JSON to disk @windows @macos @linux', async () => {
  const popup = await openSnapshotsTab()

  const filenames = await ctx.panel.evaluate<string[]>(
    `window.api.getSnapshots(${JSON.stringify(INSTALL_ID)}).then(d => d.snapshots.map(s => s.filename))`
  )
  expect(filenames.length).toBe(2)
  const firstFilename = filenames[0]!

  await popup.waitForSelector('.snapshot-row.is-expanded', { timeout: 5_000 })
  await popup.clickUntilVisible(
    byTestId(TID.snapshotRowMore(firstFilename)),
    byTestId(TID.snapshotRowExport(firstFilename)),
    { timeout: 5_000 }
  )

  expect(await popup.click(byTestId(TID.snapshotRowExport(firstFilename)))).toBe(true)

  const envelope = await waitForExportedEnvelope<{
    type?: string
    installationName?: string
    snapshots?: Array<{ label?: string; trigger?: string; comfyui?: { commit?: string } }>
  }>('snapshot-')
  expect(envelope.type).toBe('comfyui-desktop-2-snapshot')
  expect(envelope.installationName).toBe(INSTALL_NAME)
  expect(envelope.snapshots?.length).toBe(1)
  expect(envelope.snapshots?.[0]?.label).toBe('second-seeded')
  expect(envelope.snapshots?.[0]?.comfyui?.commit).toBe(COMMIT_B)
})

test('Export All writes an envelope containing every seeded snapshot @windows @macos @linux', async () => {
  const popup = await openSnapshotsTab()

  await popup.waitForVisible(byTestId(TID.snapshotsExportAll), { timeout: 5_000 })
  expect(await popup.click(byTestId(TID.snapshotsExportAll))).toBe(true)

  const envelope = await waitForExportedEnvelope<{
    type?: string
    installationName?: string
    snapshots?: Array<{ label?: string }>
  }>('snapshots-')
  expect(envelope.type).toBe('comfyui-desktop-2-snapshot')
  expect(envelope.installationName).toBe(INSTALL_NAME)
  expect(envelope.snapshots?.length).toBe(2)
  const labels = envelope.snapshots?.map((s) => s.label) ?? []
  expect(labels).toContain('first-seeded')
  expect(labels).toContain('second-seeded')
})
