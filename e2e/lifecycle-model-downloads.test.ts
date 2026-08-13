/**
 * Lifecycle coverage for the managed model-download system (issue #1322):
 * startup hydration of interrupted downloads, and the real transfer controls
 * (Resume / Pause / Retry / Cancel) driven through the actual Downloads UI
 * against a real local HTTP server. Zero mocks: the app's own manager,
 * transport, staging layer, IPC bridge, and popup renderer are all exercised
 * end to end, including a quit + relaunch of the same profile.
 *
 * The suite seeds real staged pairs (`<final>.part` + `<final>.part.dl-meta`)
 * into an isolated models root before first launch, exactly what a prior
 * session's interrupted transfers leave behind, so no multi-gigabyte template
 * download is needed to reach the production code paths.
 *
 * Tagged @lifecycle only: runs under `pnpm run test:e2e:lifecycle`.
 */

import { expect, test } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchApp, type AppContext } from './launchApp'
import { openDownloadsTray } from './support/chooserHelpers'
import {
  closeTitlePopupIfOpen,
  isPopupVisible,
  titlePopupPage,
  TITLE_REOPEN_SUPPRESSION_MS,
  type WebContentsPage,
} from './support/cdpPages'
import { getTitlePopupBounds } from './support/devHooks'
import { deterministicBytes, ModelDownloadServer } from './support/modelDownloadServer'

// Profile reuse (quit + relaunch of the same dir) is unsupported on macOS:
// Electron resolves userData outside the isolated HOME there. The whole spec
// launches against an explicit profile dir so the restart test can rehydrate
// it, so it is skipped on macOS; Windows + Linux lifecycle runs cover it.
test.skip(process.platform === 'darwin', 'profile reuse (restart hydration) is unsupported on macOS')

test.describe.configure({ mode: 'serial' })

const ETAG = '"lc-model-e2e-v1"'
const LAST_MODIFIED = 'Wed, 01 Jan 2025 00:00:00 GMT'

interface SeededJob {
  file: string
  totalSize: number
  stagedSize: number
  seed: number
  chunkSize: number
  chunkDelayMs: number
}

/** Slow enough that Pause/Cancel reliably land mid-flight (~4s of body),
 *  fast enough to keep the suite quick. */
const JOBS: Record<'complete' | 'pause' | 'retry' | 'cancel', SeededJob> = {
  complete: {
    file: 'lc-complete.safetensors',
    totalSize: 1 * 1024 * 1024,
    stagedSize: 256 * 1024,
    seed: 1,
    chunkSize: 128 * 1024,
    chunkDelayMs: 5,
  },
  pause: {
    file: 'lc-pause.safetensors',
    totalSize: 6 * 1024 * 1024,
    stagedSize: 64 * 1024,
    seed: 2,
    chunkSize: 64 * 1024,
    chunkDelayMs: 40,
  },
  retry: {
    file: 'lc-retry.safetensors',
    totalSize: 1 * 1024 * 1024,
    stagedSize: 128 * 1024,
    seed: 3,
    chunkSize: 64 * 1024,
    chunkDelayMs: 5,
  },
  cancel: {
    file: 'lc-cancel.safetensors',
    totalSize: 6 * 1024 * 1024,
    stagedSize: 64 * 1024,
    seed: 4,
    chunkSize: 64 * 1024,
    chunkDelayMs: 40,
  },
}

let ctx: AppContext
let popup: WebContentsPage
let server: ModelDownloadServer
let modelRoot: string
let profileDir: string
/** Staged size of the pause job when the first launch quit, asserted to
 *  survive the restart untouched. */
let pausedPartSize = 0

function finalPath(job: SeededJob): string {
  return path.join(modelRoot, 'checkpoints', job.file)
}

function contentOf(job: SeededJob): Buffer {
  return deterministicBytes(job.totalSize, job.seed)
}

async function fileSize(p: string): Promise<number> {
  try {
    return (await stat(p)).size
  } catch {
    return -1
  }
}

/** Seed the exact on-disk state an interrupted transfer leaves behind:
 *  the first `stagedSize` bytes in `<final>.part` plus a v2 sidecar. */
async function seedStagedPair(job: SeededJob): Promise<void> {
  const dest = finalPath(job)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest + '.part', contentOf(job).subarray(0, job.stagedSize))
  await writeFile(
    dest + '.part.dl-meta',
    JSON.stringify({
      version: 2,
      jobId: `lc-e2e-${job.file}`,
      url: server.urlFor(job.file),
      expectedSize: job.totalSize,
      etag: ETAG,
      lastModified: LAST_MODIFIED,
      directory: 'checkpoints',
      filename: job.file,
    }),
  )
}

async function launch(): Promise<void> {
  ctx = await launchApp({
    profileDir,
    settings: {
      firstUseCompleted: true,
      telemetryEnabled: false,
      modelsDirs: [modelRoot],
    },
  })
  popup = titlePopupPage(ctx.app)
}

/** Open the full Downloads popup (tray -> "View All Downloads"). */
async function openFullDownloads(): Promise<void> {
  await closeTitlePopupIfOpen(ctx.app)
  await new Promise((r) => setTimeout(r, TITLE_REOPEN_SUPPRESSION_MS))
  await openDownloadsTray(ctx.titleBar)
  await expect.poll(() => isPopupVisible(ctx.app, 'comfyTitlePopup.html'), {
    timeout: 10_000,
    intervals: [100, 200],
  }).toBe(true)
  await popup.waitForSelector('.downloads-link', { timeout: 10_000 })
  await waitForStableBounds()
  expect(await popup.clickByText('.downloads-link', 'View All')).toBe(true)
  await popup.waitForSelector('.dlm-panel', { timeout: 10_000 })
}

/** Wait until the popup's height stops changing so the renderer's
 *  request-size round trip has settled before we click inside it. */
async function waitForStableBounds(timeoutMs = 5_000, settleMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastH = -1
  let lastChange = Date.now()
  while (Date.now() < deadline) {
    const bounds = await getTitlePopupBounds(ctx.app)
    const h = bounds?.bounds.height ?? 0
    if (h !== lastH) {
      lastH = h
      lastChange = Date.now()
    } else if (Date.now() - lastChange >= settleMs) {
      return
    }
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** The status class (`is-paused` etc.) of the row for `file`, or null. */
function rowStatus(file: string): Promise<string | null> {
  return popup.evaluate<string | null>(`(() => {
    const rows = Array.from(document.querySelectorAll('.dlm-row'))
    const row = rows.find(r => ((r.querySelector('.dlm-name')?.textContent) || '').includes(${JSON.stringify(file)}))
    if (!row) return null
    const status = Array.from(row.classList).find(c => c.startsWith('is-'))
    return status ?? ''
  })()`)
}

/** Click the control with `ariaLabel` inside the row for `file`. */
function clickRowButton(file: string, ariaLabel: string): Promise<boolean> {
  return popup.evaluate<boolean>(`(() => {
    const rows = Array.from(document.querySelectorAll('.dlm-row'))
    const row = rows.find(r => ((r.querySelector('.dlm-name')?.textContent) || '').includes(${JSON.stringify(file)}))
    if (!row) return false
    const btn = Array.from(row.querySelectorAll('button'))
      .find(b => (b.getAttribute('aria-label') || '') === ${JSON.stringify(ariaLabel)})
    if (!btn) return false
    btn.click()
    return true
  })()`)
}

async function expectRowStatus(file: string, status: string, timeout = 60_000): Promise<void> {
  await expect.poll(() => rowStatus(file), {
    timeout,
    intervals: [200, 400, 800],
    message: `row for ${file} did not reach ${status}`,
  }).toBe(status)
}

/** Assert a verified completion: exact final bytes, no staging left. */
async function expectCompletedOnDisk(job: SeededJob): Promise<void> {
  const dest = finalPath(job)
  const bytes = await readFile(dest)
  expect(bytes.length).toBe(job.totalSize)
  expect(bytes.equals(contentOf(job))).toBe(true)
  expect(await fileSize(dest + '.part')).toBe(-1)
  expect(await fileSize(dest + '.part.dl-meta')).toBe(-1)
}

test.beforeAll(async () => {
  server = new ModelDownloadServer()
  await server.start()
  for (const job of Object.values(JOBS)) {
    server.setModel(job.file, {
      bytes: contentOf(job),
      etag: ETAG,
      lastModified: LAST_MODIFIED,
      chunkSize: job.chunkSize,
      chunkDelayMs: job.chunkDelayMs,
    })
  }
  modelRoot = await mkdtemp(path.join(os.tmpdir(), 'launcher-e2e-models-'))
  profileDir = await mkdtemp(path.join(os.tmpdir(), 'launcher-e2e-profile-'))
  for (const job of Object.values(JOBS)) {
    await seedStagedPair(job)
  }
  await launch()
})

test.afterAll(async () => {
  await ctx?.cleanup()
  await server?.stop()
  // `profileDir` counts as a reuse dir, so harness cleanup preserved it.
  if (profileDir) await rm(profileDir, { recursive: true, force: true })
  if (modelRoot) await rm(modelRoot, { recursive: true, force: true })
})

test('startup hydrates interrupted downloads as actionable paused rows @lifecycle', async () => {
  await openFullDownloads()
  // The startup pass is fire-and-forget, so poll until all four staged pairs
  // have been hydrated and broadcast into the popup.
  await expect.poll(() => popup.count('.dlm-row'), {
    timeout: 30_000,
    intervals: [250, 500, 1000],
  }).toBe(4)
  for (const job of Object.values(JOBS)) {
    expect(await rowStatus(job.file)).toBe('is-paused')
    // Incomplete bytes are never visible under the final model name.
    expect(await fileSize(finalPath(job))).toBe(-1)
    expect(await fileSize(finalPath(job) + '.part')).toBe(job.stagedSize)
  }
})

test('resume continues from staged bytes with Range/If-Range and completes atomically @lifecycle', async () => {
  const job = JOBS.complete
  server.clearLog()
  expect(await clickRowButton(job.file, 'Resume')).toBe(true)
  await expectRowStatus(job.file, 'is-completed')
  await expectCompletedOnDisk(job)

  // The transport must have spliced onto the staged bytes, not restarted.
  const requests = server.requestsFor(job.file)
  expect(requests.length).toBe(1)
  expect(requests[0]!.range).toBe(`bytes=${job.stagedSize}-`)
  expect(requests[0]!.ifRange).toBe(ETAG)
  expect(requests[0]!.status).toBe(206)
})

test('pause stops network activity and preserves staged bytes @lifecycle', async () => {
  const job = JOBS.pause
  const part = finalPath(job) + '.part'
  expect(await clickRowButton(job.file, 'Resume')).toBe(true)
  // Wait until the transfer is provably mid-flight (staged bytes grew).
  await expect.poll(() => fileSize(part), {
    timeout: 30_000,
    intervals: [100, 200],
  }).toBeGreaterThan(job.stagedSize + job.chunkSize)

  expect(await clickRowButton(job.file, 'Pause')).toBe(true)
  await expectRowStatus(job.file, 'is-paused', 15_000)

  // No further network activity: the staged size stays frozen.
  const sizeAtPause = await fileSize(part)
  expect(sizeAtPause).toBeGreaterThan(job.stagedSize)
  await new Promise((r) => setTimeout(r, 800))
  expect(await fileSize(part)).toBe(sizeAtPause)
  // Final name absent, resume identity retained.
  expect(await fileSize(finalPath(job))).toBe(-1)
  expect(await fileSize(finalPath(job) + '.part.dl-meta')).toBeGreaterThan(0)
  pausedPartSize = sizeAtPause
})

test('network interruption preserves staged bytes and Retry resumes them @lifecycle', async () => {
  const job = JOBS.retry
  const part = finalPath(job) + '.part'
  // First resume: the server hard-drops the socket mid-body.
  server.configure(job.file, { failAfterBytes: 2 * job.chunkSize })
  expect(await clickRowButton(job.file, 'Resume')).toBe(true)
  await expectRowStatus(job.file, 'is-error', 30_000)

  // Failure keeps the partial: staged bytes + sidecar retained, final absent.
  const sizeAtError = await fileSize(part)
  expect(sizeAtError).toBeGreaterThanOrEqual(job.stagedSize)
  expect(sizeAtError).toBeLessThan(job.totalSize)
  expect(await fileSize(finalPath(job))).toBe(-1)
  expect(await fileSize(finalPath(job) + '.part.dl-meta')).toBeGreaterThan(0)

  // Retry resumes the retained bytes instead of restarting.
  server.configure(job.file, { failAfterBytes: undefined })
  server.clearLog()
  const sizeBeforeRetry = await fileSize(part)
  expect(await clickRowButton(job.file, 'Retry')).toBe(true)
  await expectRowStatus(job.file, 'is-completed')
  await expectCompletedOnDisk(job)

  const requests = server.requestsFor(job.file)
  expect(requests.length).toBe(1)
  expect(requests[0]!.range).toBe(`bytes=${sizeBeforeRetry}-`)
  expect(requests[0]!.ifRange).toBe(ETAG)
  expect(requests[0]!.status).toBe(206)
})

test('cancel stops the transfer and removes staged bytes and metadata @lifecycle', async () => {
  const job = JOBS.cancel
  const part = finalPath(job) + '.part'
  expect(await clickRowButton(job.file, 'Resume')).toBe(true)
  await expect.poll(() => fileSize(part), {
    timeout: 30_000,
    intervals: [100, 200],
  }).toBeGreaterThan(job.stagedSize + job.chunkSize)

  expect(await clickRowButton(job.file, 'Cancel')).toBe(true)
  await expectRowStatus(job.file, 'is-cancelled', 15_000)

  // Cancel semantics: staged bytes AND resume metadata removed (deletion is
  // deferred cleanup, so poll), final name never created.
  await expect.poll(() => fileSize(part), { timeout: 15_000, intervals: [200, 400] }).toBe(-1)
  await expect.poll(() => fileSize(finalPath(job) + '.part.dl-meta'), {
    timeout: 15_000,
    intervals: [200, 400],
  }).toBe(-1)
  expect(await fileSize(finalPath(job))).toBe(-1)
})

test('quit + relaunch rehydrates the paused job and resume completes it @lifecycle', async () => {
  const job = JOBS.pause
  const part = finalPath(job) + '.part'

  // Quit the app. The paused job's staged pair (written by the APP, not the
  // seed - its sidecar was rewritten during the real transfer) must survive.
  await ctx.cleanup()
  expect(await fileSize(part)).toBe(pausedPartSize)

  await launch()
  await openFullDownloads()
  await expect.poll(() => rowStatus(job.file), {
    timeout: 30_000,
    intervals: [250, 500, 1000],
  }).toBe('is-paused')
  // Completed files from the previous session are left untouched, and the
  // finished registry rows (completed/cancelled) are gone - only the
  // interrupted job hydrates.
  await expectCompletedOnDisk(JOBS.complete)
  await expectCompletedOnDisk(JOBS.retry)
  expect(await popup.count('.dlm-row')).toBe(1)

  // Resume continues from the exact preserved offset and completes.
  server.clearLog()
  const sizeBeforeResume = await fileSize(part)
  expect(sizeBeforeResume).toBe(pausedPartSize)
  expect(await clickRowButton(job.file, 'Resume')).toBe(true)
  await expectRowStatus(job.file, 'is-completed', 120_000)
  await expectCompletedOnDisk(job)

  const requests = server.requestsFor(job.file)
  expect(requests.length).toBe(1)
  expect(requests[0]!.range).toBe(`bytes=${sizeBeforeResume}-`)
  expect(requests[0]!.status).toBe(206)
})
