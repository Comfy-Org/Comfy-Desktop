/**
 * Lifecycle E2E: snapshot import staged-restore handshake driven through
 * the Snapshots tab UI (lifecycle audit gap #10).
 *
 * Drives the production wiring from the toolbar Import button down to the
 * staged restore target:
 *   - toolbar Import button -> `handleImport` ->
 *     `window.api.importSnapshotsPreview` -> `dialog.showOpenDialog`
 *     (stubbed to return the seeded envelope path) -> preview confirm
 *     modal lists the envelope's snapshot,
 *   - Continue (BaseAlert action) -> `importSnapshotsDiff` +
 *     `importSnapshotsConfirm` stage the envelope as a restore target and
 *     fire the follow-on `snapshot-restore` runAction.
 *
 * Key invariant under test (#1137): importing does NOT commit the envelope
 * to history. The staged target only becomes history once a restore from
 * it succeeds; here the restore fails for real (the fixture install has no
 * git repos), the persistent error op card surfaces the failure, and the
 * imported snapshot must never appear in history (so it can never show as
 * "Latest"). Successful in-history restore mechanics are covered by
 * `lifecycle-snapshot-restore.test.ts`; the commit-on-success leg of a
 * staged import needs real git repos and has no e2e coverage yet.
 */

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
  // envelope path. Stubbed native OS dialogs are the one allowed
  // lifecycle exception.
  await evalWithRetry(() => ctx.app.evaluate(({ dialog }, filePath) => {
    ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    })
  }, envelopePath))
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
  if (envelopeDir) await rm(envelopeDir, { recursive: true, force: true })
})

test('Import via the toolbar stages a restore target without touching history @lifecycle', async () => {
  // Sanity: empty install starts with zero snapshots.
  const initialCount = await ctx.panel.evaluate<number>(
    `window.api.getSnapshots(${JSON.stringify(INSTALL_ID)}).then(d => d.snapshots.length)`,
  )
  expect(initialCount).toBe(0)

  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(INSTALL_ID)},
        initialTab: 'snapshots',
      })
      return true
    })()`,
  )
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(byTestId(TID.snapshotsImport), { timeout: 15_000 })

  expect(await popup.click(byTestId(TID.snapshotsImport))).toBe(true)

  // The preview confirm modal lists the envelope's snapshot label - proof
  // the stubbed open dialog fed the real preview/parse path.
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  await popup.waitFor(
    async () => ((await popup.textOf('body')) ?? '').includes(IMPORTED_LABEL),
    { timeout: 10_000, message: 'preview modal did not list the imported snapshot label' },
  )
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)

  // Import-confirm stages the envelope and fires the follow-on
  // `snapshot-restore` op. The fixture install has no git repos, so the
  // real restore fails; the persistent error op card (with its Try again
  // button) is the terminal signal. Scope the retry button to the error
  // rail state so a cancelled op can never satisfy the wait.
  await popup.waitForVisible(
    `.snapshots-rail-save-box.is-op-error ${byTestId(TID.snapshotsOpCardRetry)}`,
    { timeout: 60_000 },
  )

  // The crux of #1137: the imported snapshot never landed in history (and
  // so can never show as "Latest"). A failed restore may write a live-state
  // `post-restore` correction snapshot on top, so assert on the imported
  // label and trigger, not on the raw count.
  const snapshots = await ctx.panel.evaluate<Array<{ label: string | null; trigger?: string }>>(
    `window.api.getSnapshots(${JSON.stringify(INSTALL_ID)}).then(d => d.snapshots.map(s => ({ label: s.label, trigger: s.trigger })))`,
  )
  expect(snapshots.some((s) => s.label === IMPORTED_LABEL)).toBe(false)
  expect(snapshots.some((s) => s.trigger === 'manual')).toBe(false)
})
