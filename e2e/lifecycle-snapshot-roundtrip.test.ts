/**
 * Lifecycle E2E: snapshot export -> import round-trip end-to-end
 * (lifecycle audit followup).
 *
 * The standalone export and import tests cover each direction
 * independently, but neither proves the envelope shape produced by
 * `buildExportEnvelope` is the SAME shape consumed by
 * `validateExportEnvelope` + `importSnapshots`. The import test uses
 * a hand-built envelope JSON, so a future schema drift on the export
 * side would not be caught.
 *
 * This test closes that loop:
 *   - INSTALL_A is seeded with two snapshots and exports them via
 *     the toolbar Export All button (stubbed `dialog.showSaveDialog`
 *     writes to a known tmp dir),
 *   - INSTALL_B starts with zero snapshots and imports the resulting
 *     envelope via the toolbar Import button (stubbed
 *     `dialog.showOpenDialog` returns the path saved by the save
 *     stub, shared via a globalThis property),
 *   - the import preview modal lists BOTH seeded labels, proving the
 *     full envelope (not just the newest entry) round-trips through
 *     the real production parse/preview code paths.
 *
 * Importing stages the envelope as a restore target; it only becomes
 * history once a restore from it succeeds (#1137). B has no git repos,
 * so the follow-on `snapshot-restore` fails for real and B's history
 * must stay free of the imported entries. Successful in-history restore
 * mechanics are covered by lifecycle-snapshot-restore.test.ts; the
 * commit-on-success leg of a staged import has no e2e coverage yet.
 */

import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { closeTitlePopupIfOpen, titlePopupPage } from './support/cdpPages'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let installPathA = ''
let installPathB = ''
let exportDir = ''

const INSTALL_ID_A = 'inst-snapshot-roundtrip-a'
const INSTALL_NAME_A = 'Snapshot Roundtrip Source'
const INSTALL_ID_B = 'inst-snapshot-roundtrip-b'
const INSTALL_NAME_B = 'Snapshot Roundtrip Target'
const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)
const BASE_TAG = 'v0.3.10'
const LABEL_FIRST = 'first-seeded'
const LABEL_SECOND = 'second-seeded'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installPathA = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-snapshot-rt-a-'))
  installPathB = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-snapshot-rt-b-'))
  exportDir = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-snapshot-rt-out-'))
  await mkdir(path.join(installPathA, 'ComfyUI'), { recursive: true })
  await mkdir(path.join(installPathB, 'ComfyUI'), { recursive: true })

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: INSTALL_ID_A,
        name: INSTALL_NAME_A,
        installPath: installPathA,
        sourceId: 'standalone',
        status: 'installed',
        snapshots: [
          {
            trigger: 'manual',
            label: LABEL_FIRST,
            comfyui: {
              ref: COMMIT_A,
              commit: COMMIT_A,
              releaseTag: BASE_TAG,
              variant: 'cpu',
              baseTag: BASE_TAG,
              commitsAhead: 1,
            },
          },
          {
            trigger: 'manual',
            label: LABEL_SECOND,
            comfyui: {
              ref: COMMIT_B,
              commit: COMMIT_B,
              releaseTag: BASE_TAG,
              variant: 'cpu',
              baseTag: BASE_TAG,
              commitsAhead: 2,
            },
          },
        ],
      },
      {
        id: INSTALL_ID_B,
        name: INSTALL_NAME_B,
        installPath: installPathB,
        sourceId: 'standalone',
        status: 'installed',
      },
    ],
  })

  // Stub both save + open dialogs at boot. The save stub returns a
  // deterministic path inside `exportDir` keyed off the requested
  // `defaultPath` filename and parks the resulting absolute path on
  // `globalThis` so the open stub can read it back without the test
  // having to plumb the value through across two evaluate calls.
  await ctx.app.evaluate(({ dialog }, dir) => {
    const g = globalThis as unknown as { __roundtripExportedPath?: string }
    ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async (
      _win: unknown,
      opts: { defaultPath?: string },
    ) => {
      const raw = opts.defaultPath ?? 'snapshot-export.json'
      const lastSep = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
      const base = lastSep >= 0 ? raw.slice(lastSep + 1) : raw
      const sep = dir.includes('\\') ? '\\' : '/'
      const filePath = `${dir}${sep}${base}`
      g.__roundtripExportedPath = filePath
      return { canceled: false, filePath }
    }
    ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => {
      const filePath = g.__roundtripExportedPath
      if (!filePath) return { canceled: true, filePaths: [] }
      return { canceled: false, filePaths: [filePath] }
    }
  }, exportDir)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPathA) await rm(installPathA, { recursive: true, force: true })
  if (installPathB) await rm(installPathB, { recursive: true, force: true })
  if (exportDir) await rm(exportDir, { recursive: true, force: true })
})

async function openSnapshotsTab(installId: string): Promise<ReturnType<typeof titlePopupPage>> {
  const expectedCount = await ctx.panel.evaluate<number>(
    `window.api.getSnapshots(${JSON.stringify(installId)}).then(d => d.snapshots.length)`,
  )
  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(installId)},
        initialTab: 'snapshots',
      })
      return true
    })()`,
  )
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(byTestId(TID.snapshotsImport), { timeout: 15_000 })
  await popup.waitFor(() => popup.count('.snapshot-row').then((count) => count === expectedCount), {
    timeout: 15_000,
    message: `snapshots for ${installId} did not finish loading`,
  })
  return popup
}

async function findExportedFile(prefix: string): Promise<string | null> {
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(exportDir)
  const match = entries.find((e) => e.startsWith(prefix) && e.endsWith('.json'))
  return match ? path.join(exportDir, match) : null
}

test('Export All from A writes an envelope containing both seeded snapshots @lifecycle', async () => {
  const popup = await openSnapshotsTab(INSTALL_ID_A)

  await popup.waitForVisible(byTestId(TID.snapshotsExportAll), { timeout: 5_000 })
  expect(await popup.click(byTestId(TID.snapshotsExportAll))).toBe(true)

  const exportedPath = await new Promise<string>((resolve, reject) => {
    const deadline = Date.now() + 10_000
    const poll = async (): Promise<void> => {
      const match = await findExportedFile('snapshots-')
      if (match) return resolve(match)
      if (Date.now() > deadline) return reject(new Error('export-all file did not appear within 10s'))
      setTimeout(poll, 200)
    }
    void poll()
  })

  const { readFile } = await import('node:fs/promises')
  const content = await readFile(exportedPath, 'utf-8')
  const envelope = JSON.parse(content) as {
    type?: string
    installationName?: string
    snapshots?: Array<{ label?: string }>
  }
  expect(envelope.type).toBe('comfyui-desktop-2-snapshot')
  expect(envelope.installationName).toBe(INSTALL_NAME_A)
  expect(envelope.snapshots?.length).toBe(2)
  const labels = envelope.snapshots?.map((s) => s.label) ?? []
  expect(labels).toContain(LABEL_FIRST)
  expect(labels).toContain(LABEL_SECOND)

  await closeTitlePopupIfOpen(ctx.app)
})

test('Import into B previews the full envelope and stages it without committing history @lifecycle', async () => {
  const initialCount = await ctx.panel.evaluate<number>(
    `window.api.getSnapshots(${JSON.stringify(INSTALL_ID_B)}).then(d => d.snapshots.length)`,
  )
  expect(initialCount).toBe(0)

  const popup = await openSnapshotsTab(INSTALL_ID_B)

  expect(await popup.click(byTestId(TID.snapshotsImport))).toBe(true)

  // The preview confirm modal lists BOTH exported labels - the proof that
  // the envelope written by `buildExportEnvelope` round-trips through
  // `validateExportEnvelope` into the import preview.
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  await popup.waitFor(
    async () => {
      const body = (await popup.textOf('body')) ?? ''
      return body.includes(LABEL_FIRST) && body.includes(LABEL_SECOND)
    },
    { timeout: 10_000, message: 'preview modal did not list both exported labels' },
  )
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)

  // Import-confirm stages the envelope and fires the follow-on
  // `snapshot-restore` op. B has no git repos, so the real restore fails;
  // the persistent error op card (with its Try again button) is the
  // terminal signal. Scope the retry button to the error rail state so a
  // cancelled op can never satisfy the wait.
  await popup.waitForVisible(
    `.snapshots-rail-save-box.is-op-error ${byTestId(TID.snapshotsOpCardRetry)}`,
    { timeout: 60_000 },
  )

  // Staging must not commit the envelope into B's history (#1137). A failed
  // restore may write a live-state `post-restore` correction snapshot on
  // top, so assert on the imported labels and trigger, not on the raw count.
  const snapshots = await ctx.panel.evaluate<Array<{ label: string | null; trigger?: string }>>(
    `window.api.getSnapshots(${JSON.stringify(INSTALL_ID_B)}).then(d => d.snapshots.map(s => ({ label: s.label, trigger: s.trigger })))`,
  )
  expect(snapshots.some((s) => s.label === LABEL_FIRST || s.label === LABEL_SECOND)).toBe(false)
  expect(snapshots.some((s) => s.trigger === 'manual')).toBe(false)
})
