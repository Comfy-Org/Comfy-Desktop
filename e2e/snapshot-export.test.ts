import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import en from '../locales/en.json'
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

  await answerSaveDialogs({ saveInto: exportDir })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (exportDir) await rm(exportDir, { recursive: true, force: true })
})

type SaveDialogAnswer = 'cancel' | { saveInto: string }

async function answerSaveDialogs(answer: SaveDialogAnswer): Promise<void> {
  await evalWithRetry(() =>
    ctx.app.evaluate(
      ({ dialog }, saveInto) => {
        ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async (
          _win: unknown,
          opts: { defaultPath?: string }
        ) => {
          const shown = globalThis as unknown as { __e2eSaveDialogsShown?: number }
          shown.__e2eSaveDialogsShown = (shown.__e2eSaveDialogsShown ?? 0) + 1
          if (saveInto === null) return { canceled: true, filePath: '' }
          const raw = opts.defaultPath ?? 'snapshot-export.json'
          const lastSep = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
          const base = lastSep >= 0 ? raw.slice(lastSep + 1) : raw
          const sep = saveInto.includes('\\') ? '\\' : '/'
          return { canceled: false, filePath: `${saveInto}${sep}${base}` }
        }
      },
      answer === 'cancel' ? null : answer.saveInto
    )
  )
}

function saveDialogsShown(): Promise<number> {
  return evalWithRetry(() =>
    ctx.app.evaluate(
      () => (globalThis as unknown as { __e2eSaveDialogsShown?: number }).__e2eSaveDialogsShown ?? 0
    )
  )
}

type TitlePopup = ReturnType<typeof titlePopupPage>

async function startRecordingSnapshotTelemetry(popup: TitlePopup): Promise<void> {
  await popup.evaluate<boolean>(`(() => {
    if (window.__e2eSnapshotActions) {
      window.__e2eSnapshotActions.length = 0
      return true
    }
    window.__e2eSnapshotActions = []
    window.addEventListener('launcher-telemetry-action', (event) => {
      const { actionName, context } = event.detail
      if (actionName === 'comfy.desktop.snapshot.flow') {
        window.__e2eSnapshotActions.push(context.action)
      }
    })
    return true
  })()`)
}

function recordedSnapshotTelemetry(popup: TitlePopup): Promise<string[]> {
  return popup.evaluate<string[]>('window.__e2eSnapshotActions.slice()')
}

async function openSnapshotsTab(): Promise<TitlePopup> {
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

async function findExportedFile(prefix: string, dir: string): Promise<string | null> {
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(dir)
  const match = entries.find((e) => e.startsWith(prefix) && e.endsWith('.json'))
  return match ? path.join(dir, match) : null
}

async function waitForExportedEnvelope<T>(prefix: string, dir = exportDir): Promise<T> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const match = await findExportedFile(prefix, dir)
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

test('a cancelled save dialog records no export and shows no error @windows @macos @linux', async () => {
  const popup = await openSnapshotsTab()
  await startRecordingSnapshotTelemetry(popup)
  await popup.waitForVisible(byTestId(TID.snapshotsExportAll), { timeout: 5_000 })

  const dialogsBefore = await saveDialogsShown()
  await answerSaveDialogs('cancel')
  expect(await popup.click(byTestId(TID.snapshotsExportAll))).toBe(true)
  await expect
    .poll(saveDialogsShown, {
      timeout: 10_000,
      message: 'Export All never asked where to save'
    })
    .toBe(dialogsBefore + 1)

  const laterExportDir = path.join(exportDir, 'exported-after-the-cancel')
  await mkdir(laterExportDir)
  await answerSaveDialogs({ saveInto: laterExportDir })
  expect(await popup.click(byTestId(TID.snapshotsExportAll))).toBe(true)
  await waitForExportedEnvelope('snapshots-', laterExportDir)

  await expect
    .poll(() => recordedSnapshotTelemetry(popup), {
      timeout: 10_000,
      message: 'only the export that wrote a file should be recorded'
    })
    .toEqual(['export_all'])
  expect(
    await popup.isVisible(byTestId(TID.baseAlertAction)),
    'cancelling the save dialog must not raise an error dialog'
  ).toBe(false)
})

test('a failed export shows the reason without Electron IPC wording @windows @macos @linux', async () => {
  const popup = await openSnapshotsTab()
  await startRecordingSnapshotTelemetry(popup)
  await popup.waitForVisible(byTestId(TID.snapshotsExportAll), { timeout: 5_000 })

  const folderThatIsGone = path.join(exportDir, 'folder-removed-after-it-was-picked')
  await answerSaveDialogs({ saveInto: folderThatIsGone })
  expect(await popup.click(byTestId(TID.snapshotsExportAll))).toBe(true)

  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await popup.textOf('.base-alert-title')).toBe(en.snapshots.exportAllErrorTitle)
  const reasonOnScreen = (await popup.textOf('.base-alert-message-text')) ?? ''
  expect(reasonOnScreen).toMatch(/^ENOENT: no such file or directory/)
  expect(reasonOnScreen).toContain(folderThatIsGone)
  expect(reasonOnScreen).not.toContain('Error invoking remote method')
  expect(await recordedSnapshotTelemetry(popup)).toEqual([])

  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)
  await answerSaveDialogs({ saveInto: exportDir })
})
