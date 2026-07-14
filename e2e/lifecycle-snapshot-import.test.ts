/**
 * Lifecycle E2E: snapshot import handshake (lifecycle audit gap #10).
 *
 * Drives the production import wiring through the IPC API:
 *   - `importSnapshotsPreview` → `dialog.showOpenDialog` (stubbed to
 *     return the seeded envelope path) → returns the parsed envelope,
 *   - `importSnapshotsDiff` resolves the diff against the empty install,
 *   - `importSnapshotsConfirm` STAGES the envelope as a restore target
 *     and returns an opaque `restoreToken`.
 *
 * Key invariant under test (#1137): importing does NOT commit the
 * envelope to history. An imported snapshot is a restore *target*, not
 * history, until a restore from it succeeds — so a never-applied import
 * must never appear as "Latest". We assert the install's snapshot
 * history stays empty after confirm. The actual restore (which commits
 * the staged target on success) needs real git repos and is covered by
 * `lifecycle-snapshot-restore.test.ts`.
 */

import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'

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

  // Build a valid export envelope on disk; the import handler's
  // `validateExportEnvelope` checks the version/type/trigger/snapshot
  // shape, and the snapshot fields drive the diff against the empty
  // install state (which mismatches on every comfyui field, so the
  // diff is non-empty and import-confirm proceeds).
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
          commitsAhead: 0,
        },
        customNodes: [],
        pipPackages: {},
        updateChannel: 'stable',
      },
    ],
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
        status: 'installed',
      },
    ],
  })

  // Monkey-patch `dialog.showOpenDialog` so the Electron native open
  // dialog never opens during the test; the stub returns the seeded
  // envelope path. The snapshot-restore that fires after a successful
  // import would otherwise need real git repos on disk; the test
  // captures the snapshot count BEFORE the restore op can interfere.
  await ctx.app.evaluate(({ dialog }, filePath) => {
    ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    })
  }, envelopePath)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (envelopeDir) await rm(envelopeDir, { recursive: true, force: true })
})

test('Import confirm stages the target as a restoreToken without touching history @lifecycle', async () => {
  // Sanity: empty install starts with zero snapshots.
  const initialCount = await ctx.panel.evaluate<number>(
    `window.api.getSnapshots(${JSON.stringify(INSTALL_ID)}).then(d => d.snapshots.length)`,
  )
  expect(initialCount).toBe(0)

  // Preview reads the (stubbed) open dialog and parses the seeded envelope.
  const preview = await ctx.panel.evaluate<{ ok: boolean; message?: string }>(
    `window.api.importSnapshotsPreview()`,
  )
  expect(preview.ok, `preview failed: ${preview.message ?? ''}`).toBe(true)

  // Diff against the empty install — every comfyui field mismatches so the diff
  // is non-empty and confirm is allowed to proceed.
  const diff = await ctx.panel.evaluate<{ ok: boolean; message?: string }>(
    `window.api.importSnapshotsDiff(${JSON.stringify(INSTALL_ID)})`,
  )
  expect(diff.ok, `diff failed: ${diff.message ?? ''}`).toBe(true)

  // Confirm STAGES the envelope as a restore target and returns an opaque
  // token. It must NOT commit anything to history (#1137).
  const confirm = await ctx.panel.evaluate<{
    ok: boolean
    imported?: number
    restoreToken?: string
    message?: string
  }>(`window.api.importSnapshotsConfirm(${JSON.stringify(INSTALL_ID)})`)
  expect(confirm.ok, `confirm failed: ${confirm.message ?? ''}`).toBe(true)
  expect(confirm.imported).toBe(1)
  expect(confirm.restoreToken).toMatch(/^[a-f0-9]{32}$/)

  // The crux of #1137: the install's snapshot history is untouched — the
  // imported, not-yet-applied target never lands in history (and so can never
  // show as "Latest"). It is only committed once a restore from it succeeds.
  const afterConfirm = await ctx.panel.evaluate<Array<{ label: string | null }>>(
    `window.api.getSnapshots(${JSON.stringify(INSTALL_ID)}).then(d => d.snapshots.map(s => ({ label: s.label })))`,
  )
  expect(afterConfirm.length).toBe(0)
  expect(afterConfirm.some((s) => s.label === IMPORTED_LABEL)).toBe(false)
})
