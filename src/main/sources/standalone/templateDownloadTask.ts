import fs from 'fs'
import path from 'path'
import { startManagedModelJob, type ModelJobOutcome } from '../../lib/comfyDownloadManager'
import { getModelsBaseDir, resolveDownloadContextById } from '../../lib/modelDownloadPaths'
import { STAGING_META_SUFFIX } from '../../lib/modelDownloadStaging'
import { getDiskSpace } from '../../lib/disk'
import { resolveTemplateModels } from './templateModels'
import { downloadTemplateInputAssets } from './templateInputAssets'
import {
  isTerminal,
  runPool,
  withRetry,
  truncateForMaxPath,
  describeDownloadFailure,
  gbStr,
  DISK_SPACE_ERROR,
  type TemplateDownloadState
} from './templateDownloadCore'
import type { InstallationRecord } from '../../installations'

/**
 * Background template-model download task - the stateful half (the pure logic
 * lives in `templateDownloadCore.ts`).
 *
 * The download is kicked off the moment installation begins (so bytes flow
 * concurrently with env setup) but is *displayed* later, as a launch-span
 * stepper phase. The bridge is a process-global state map keyed by
 * installationId: the task is the SOLE writer; the install handler and the
 * launch driver are pure readers.
 *
 * Every model transfer is a REAL managed job in `comfyDownloadManager`
 * (issue #1322) - the same job type as in-Comfy model downloads. The jobs
 * appear in the title-bar Downloads tray automatically with fully working
 * pause/resume/cancel/retry, download to a staged `.part` file (never partial
 * bytes under a model extension), and resume across app restarts. This task
 * only orchestrates: discovery, disk preflight, bounded concurrency, aggregate
 * launch-step progress, and launch gating.
 *
 * Performance contract:
 *  - the manager's `onProgress` subscriber is a HOT PATH (hundreds/sec/file):
 *    ONLY O(1) counter writes - no allocations, strings, i18n, or IPC.
 *  - A single 500 ms reader in the launch process owns ALL formatting +
 *    `sendProgress`. Display cadence is decoupled from download speed.
 *  - Files download with bounded concurrency (`runPool`, cap 3).
 */

const MODEL_POOL_CONCURRENCY = 3
const DISK_HEADROOM = 1.05
/** Per-file auto-retry budget for transient failures. The managed job keeps
 *  its staged bytes on error, so each retry RESUMES from the prior byte count
 *  rather than restarting the file. Exhausted retries mark the file failed
 *  (the row stays in the Downloads tray with a working manual Retry). */
const MODEL_DOWNLOAD_RETRIES = 2

// --- Process-global state (mirrors _operationAborts). Task = sole writer. ---
const _templateDownloads = new Map<string, TemplateDownloadState>()
const _templateAborts = new Map<string, AbortController>()
/** Release functions for THIS install's leases on its currently-active
 *  managed model jobs, so an install-level abort can release the real
 *  transfers. Each entry is a caller-owned idempotent lease handle: releasing
 *  it can never cancel a lease another install (or a manual in-Comfy
 *  download) holds on a shared-destination job. */
const _templateJobLeases = new Map<string, Set<() => void>>()

/** True when any template-model download is still in flight (not terminal).
 *  Drives the "downloads still running" confirm on app quit. */
export function hasActiveTemplateDownloads(): boolean {
  for (const state of _templateDownloads.values()) {
    if (!isTerminal(state.status)) return true
  }
  return false
}

export function getTemplateDownloadState(
  installationId: string
): TemplateDownloadState | undefined {
  return _templateDownloads.get(installationId)
}

/**
 * Tear down this install's template download: stop scheduling new files and
 * release this install's lease on every in-flight managed model job. A job
 * with no other lease holders is cancelled (network stops, staged bytes +
 * sidecar removed); a job another caller also started/joined (same
 * destination from a concurrent install or a manual in-Comfy download) keeps
 * transferring for them. Used on install cancel/failure and host-window
 * teardown - an explicit abandonment, unlike app quit, which suspends jobs
 * resumably via the manager's quit path instead.
 */
export function abortTemplateDownload(installationId: string): void {
  const ctrl = _templateAborts.get(installationId)
  if (ctrl) {
    ctrl.abort()
    _templateAborts.delete(installationId)
  }
  const leases = _templateJobLeases.get(installationId)
  if (leases) {
    for (const release of [...leases]) release()
    _templateJobLeases.delete(installationId)
  }
  const state = _templateDownloads.get(installationId)
  if (state && !isTerminal(state.status)) {
    state.status = 'cancelled'
  }
}

// --- Launch-gate: hold the ComfyUI reveal until the download settles ---------
// When all real launch phases are done but a template download is still running,
// `handleLaunch` waits on `awaitTemplateDownloadSettled` before revealing ComfyUI
// (so the model-download step is the active row + the footer "Skip" is live). The
// user's Skip click resolves that wait via `requestSkipTemplateDownload`.

/** Installs whose download the user chose to skip (open ComfyUI now, finish in
 *  the tray). Checked by `awaitTemplateDownloadSettled`. */
const _templateSkips = new Set<string>()

/**
 * User asked to stop waiting on the download and open ComfyUI now. Releases any
 * pending launch gate. The still-running managed jobs keep going and stay
 * visible in the title-bar Downloads tray (they are real rows there for their
 * whole lifetime - no handoff needed). Idempotent.
 */
export function requestSkipTemplateDownload(installationId: string): void {
  _templateSkips.add(installationId)
}

const SETTLE_POLL_MS = 250

/**
 * Resolve once the launch gate should release: the download is terminal
 * (done/error/cancelled), the user skipped, the abort fired, or there's no task
 * to wait on. Polls the shared state (the task is its sole writer; there's no
 * event bus) on a light interval. Pure of any UI - `handleLaunch` owns what to
 * show while awaiting. Returns the reason so the caller can branch (e.g. show a
 * failure countdown only on `'error'`).
 */
export function awaitTemplateDownloadSettled(
  installationId: string,
  signal: AbortSignal
): Promise<'done' | 'error' | 'cancelled' | 'skipped' | 'aborted' | 'absent'> {
  return new Promise((resolve) => {
    const settle = (
      reason: 'done' | 'error' | 'cancelled' | 'skipped' | 'aborted' | 'absent'
    ): void => {
      clearInterval(timer)
      signal.removeEventListener('abort', onAbort)
      _templateSkips.delete(installationId)
      resolve(reason)
    }
    const onAbort = (): void => settle('aborted')

    const check = (): void => {
      if (signal.aborted) return settle('aborted')
      if (_templateSkips.has(installationId)) return settle('skipped')
      const state = _templateDownloads.get(installationId)
      if (!state) return settle('absent')
      if (isTerminal(state.status)) {
        settle(state.status === 'done' ? 'done' : state.status === 'error' ? 'error' : 'cancelled')
      }
    }

    signal.addEventListener('abort', onAbort, { once: true })
    const timer = setInterval(check, SETTLE_POLL_MS)
    check() // resolve synchronously if already settled (the common pre-done case)
  })
}

interface StartOpts {
  /** Human-readable log sink (already wired to `comfy-output` + `appendLog`). */
  sendOutput: (text: string) => void
}

/**
 * Kick off the background download. Synchronous + fire-and-forget. No-op if a
 * non-terminal task already exists for this install (guards install retry /
 * double-mount).
 */
export function startTemplateDownload(
  installation: InstallationRecord,
  estimatedSizeBytes: number,
  opts: StartOpts
): void {
  const installationId = installation.id
  const existing = _templateDownloads.get(installationId)
  if (existing && !isTerminal(existing.status)) return

  const state: TemplateDownloadState = {
    status: 'resolving',
    files: [],
    estimatedTotalBytes: estimatedSizeBytes,
    speedMBs: 0,
    etaSecs: -1
  }
  _templateDownloads.set(installationId, state)
  const abort = new AbortController()
  const jobLeases = new Set<() => void>()
  _templateAborts.set(installationId, abort)
  _templateJobLeases.set(installationId, jobLeases)

  /** Tees every task log line to the main-process console as well, so the
   *  lifecycle shows in the `pnpm dev` terminal even if the renderer panel drops. */
  const log = (text: string): void => {
    console.log(`[templateDownload:${installationId}] ${text.trimEnd()}`)
    opts.sendOutput(text)
  }
  const taskOpts: StartOpts = { sendOutput: log }

  log(
    `[templates] Starting background download for "${installation.bundledTemplateId}" (est. ${gbStr(estimatedSizeBytes)} GB)...\n`
  )

  void runTask(installation, state, abort.signal, taskOpts)
    .catch((err) => {
      if (!isTerminal(state.status)) {
        state.status = 'error'
        state.error = (err as Error).message
      }
      log(`[templates] Download task failed: ${(err as Error).message}\n`)
    })
    .finally(() => {
      // Terminal bookkeeping cleanup. Identity-guarded: abortTemplateDownload
      // (or a newer task restarted for this install) may already have removed
      // or replaced these entries - never delete a successor's controller or
      // leases. Any lease still tracked here (add-after-abort races) is
      // released so a parked job is not pinned by a dead task.
      if (_templateAborts.get(installationId) === abort) _templateAborts.delete(installationId)
      if (_templateJobLeases.get(installationId) === jobLeases) {
        for (const release of [...jobLeases]) release()
        _templateJobLeases.delete(installationId)
      }
    })
}

/** Thrown when the managed job reports 'cancelled' - never auto-retried. */
class ModelJobCancelledError extends Error {
  constructor() {
    super('Download cancelled')
    this.name = 'ModelJobCancelledError'
  }
}

/** Await a managed job's outcome, but stop waiting the moment the
 *  install-level abort fires. Releasing the last lease on a job PARKS it
 *  (its completion promise deliberately never settles for a paused job), so
 *  an abandoned plain `await handle.completion` after abort would hang its
 *  pool worker - and with it the whole template task - forever. */
function raceCompletionWithAbort(
  completion: Promise<ModelJobOutcome>,
  signal: AbortSignal
): Promise<ModelJobOutcome | 'aborted'> {
  if (signal.aborted) return Promise.resolve('aborted')
  return new Promise((resolve) => {
    const onAbort = (): void => resolve('aborted')
    signal.addEventListener('abort', onAbort, { once: true })
    void completion.then((outcome) => {
      signal.removeEventListener('abort', onAbort)
      resolve(outcome)
    })
  })
}

async function runTask(
  installation: InstallationRecord,
  state: TemplateDownloadState,
  signal: AbortSignal,
  { sendOutput }: StartOpts
): Promise<void> {
  const templateId = installation.bundledTemplateId as string
  await downloadTemplateInputAssets(installation, templateId, sendOutput, signal)
  if (signal.aborted) {
    state.status = 'cancelled'
    return
  }

  sendOutput(`[templates] Resolving model list for "${templateId}"...\n`)
  const models = await resolveTemplateModels(installation, templateId)

  if (signal.aborted) {
    state.status = 'cancelled'
    return
  }
  if (models.length === 0) {
    state.status = 'done'
    sendOutput('[templates] No models required for this template.\n')
    return
  }
  sendOutput(`[templates] ${models.length} model(s) to download.\n`)

  state.files = models.map((m) => ({
    name: m.filename,
    directory: m.directory,
    received: 0,
    total: 0,
    done: false,
    failed: false
  }))

  // Resolve the SAME base dir the manager will download into for this install
  // (respects useSharedModels / modelDirs / modelDirsPrimary, not the global
  // shared dir), through the same byId lookup the manager itself uses so
  // preflight/path checks and the actual writes can't disagree.
  const ctx = await resolveDownloadContextById(installation.id)
  const baseDir = ctx ? ctx.downloadBaseDir : getModelsBaseDir()

  // Pre-flight disk guard against the coarse estimate (+ headroom): a hard error
  // beats N failed writes when there's clearly no room.
  if (state.estimatedTotalBytes > 0) {
    try {
      const { free } = await getDiskSpace(baseDir)
      if (free < state.estimatedTotalBytes * DISK_HEADROOM) {
        state.status = 'error'
        state.error = DISK_SPACE_ERROR
        sendOutput(
          `[templates] Not enough disk space for template models: ~${gbStr(state.estimatedTotalBytes)} GB needed, ${gbStr(free)} GB free. Download cancelled - free up space and grab them in-app.\n`
        )
        return
      }
    } catch {
      sendOutput('[templates] Could not probe disk space; proceeding without a pre-check.\n')
    }
  }

  state.status = 'downloading'

  const activeJobLeases = _templateJobLeases.get(installation.id)

  // Aggregate speed/ETA sampled from the per-file counters at most every
  // 500 ms (state.files is small - a handful of models per template).
  const speedSample = { bytes: -1, time: Date.now() }
  const sampleSpeed = (): void => {
    const now = Date.now()
    const elapsed = (now - speedSample.time) / 1000
    if (speedSample.bytes >= 0 && elapsed < 0.5) return
    let received = 0
    let totalKnown = 0
    let allTotalsKnown = true
    for (const f of state.files) {
      received += f.received
      totalKnown += f.total
      if (!f.done && !f.failed && f.total === 0) allTotalsKnown = false
    }
    if (speedSample.bytes >= 0 && elapsed > 0) {
      const bytesPerSec = (received - speedSample.bytes) / elapsed
      state.speedMBs = bytesPerSec > 0 ? bytesPerSec / 1048576 : 0
    }
    speedSample.bytes = received
    speedSample.time = now
    state.etaSecs =
      state.speedMBs > 0 && allTotalsKnown && totalKnown > received
        ? (totalKnown - received) / (state.speedMBs * 1048576)
        : -1
  }

  await runPool(
    state.files,
    MODEL_POOL_CONCURRENCY,
    async (f, i) => {
      if (signal.aborted) return
      const model = models[i]!
      const destDir = path.join(baseDir, f.directory)

      // Defensively fit the on-disk name within Windows MAX_PATH before any
      // write (no-op elsewhere / on short paths), reserving room for the
      // staging sidecar suffix so `<name>.part.dl-meta` fits too. A too-long
      // name that can't be shortened is a per-file failure, not a task failure.
      const safeName = truncateForMaxPath(
        destDir,
        f.name,
        process.platform,
        STAGING_META_SUFFIX.length
      )
      if (safeName === null) {
        f.failed = true
        sendOutput(`[templates] Skipping ${f.name}: path too long for this filesystem.\n`)
        return
      }

      sendOutput(`[templates] Downloading ${f.name} (${i + 1}/${state.files.length})...\n`)
      let lastLoggedPct = 0
      try {
        await withRetry(
          async () => {
            // A real managed model job - the same job type as in-Comfy model
            // downloads. It stages to `.part`, appears in every Downloads
            // surface with working controls, and RESUMES retained bytes on
            // each retry attempt.
            const handle = await startManagedModelJob({
              url: model.url,
              filename: safeName,
              directory: f.directory,
              installationId: installation.id,
              onProgress: (receivedBytes, totalBytes) => {
                // HOT PATH: O(1) counter writes only (sampler self-throttles).
                f.received = receivedBytes
                if (totalBytes > 0) f.total = totalBytes
                sampleSpeed()
                if (totalBytes > 0) {
                  const pct = Math.floor((receivedBytes / totalBytes) * 100)
                  if (pct >= lastLoggedPct + 10) {
                    lastLoggedPct = pct - (pct % 10)
                    sendOutput(
                      `[templates]   ${f.name} - ${(receivedBytes / 1048576).toFixed(0)}/${(totalBytes / 1048576).toFixed(0)} MB\n`
                    )
                  }
                }
              }
            })
            activeJobLeases?.add(handle.release)
            // Close the start/abort race: the install may have been torn down
            // while the job was being dispatched. Release (not cancel) so a
            // job shared with another caller survives. The release is
            // idempotent, so even overlapping with abortTemplateDownload it
            // releases this caller's lease exactly once.
            if (signal.aborted) handle.release()
            try {
              const outcome = await raceCompletionWithAbort(handle.completion, signal)
              if (outcome === 'aborted') {
                // The install-level abort released this job's lease, which
                // PARKS the transfer (staged bytes kept, resumable from
                // Downloads) - so `completion` never settles. Stop waiting or
                // this pool worker would hang forever. Idempotent re-release
                // covers the add-after-abort race.
                handle.release()
                throw new ModelJobCancelledError()
              }
              if (outcome.status === 'error') throw new Error(outcome.error)
              if (outcome.status === 'cancelled') throw new ModelJobCancelledError()
              // completed
              try {
                const stat = await fs.promises.stat(outcome.savePath)
                f.total = stat.size
              } catch {}
              f.received = f.total || f.received
              f.done = true
              sendOutput(
                outcome.alreadyPresent
                  ? `[templates] Already have ${f.directory}/${f.name}, skipping.\n`
                  : `[templates] Saved ${f.directory}/${safeName}.\n`
              )
            } finally {
              activeJobLeases?.delete(handle.release)
            }
          },
          MODEL_DOWNLOAD_RETRIES,
          {
            // A cancel (user's tray action or install teardown) must not be
            // retried - bail immediately.
            isFatal: (err) => signal.aborted || err instanceof ModelJobCancelledError,
            onRetry: (attempt, err) =>
              sendOutput(
                `[templates] Retrying ${f.name} (attempt ${attempt}/${MODEL_DOWNLOAD_RETRIES + 1}): ${(err as Error).message}\n`
              )
          }
        )
      } catch (err) {
        if (signal.aborted) return
        f.failed = true
        if (err instanceof ModelJobCancelledError) {
          sendOutput(`[templates] ${f.name} was cancelled in Downloads.\n`)
        } else {
          sendOutput(describeDownloadFailure(f.name, (err as Error).message))
        }
      }
    },
    signal
  )

  if (signal.aborted) {
    state.status = 'cancelled'
    return
  }
  // Template models are ready ONLY when every required model landed. Any
  // failed/cancelled file means the template can't run as-is: surface an
  // error (persistent tray rows + launch failure status), never a partial
  // "ready". ComfyUI's missing-model prompt remains the in-app fallback.
  const failedCount = state.files.filter((f) => !f.done).length
  if (failedCount === 0) {
    state.status = 'done'
    sendOutput('[templates] Template models ready.\n')
  } else {
    state.status = 'error'
    state.error ??= `${failedCount} of ${state.files.length} template model(s) could not be downloaded`
    sendOutput(
      `[templates] ${failedCount} of ${state.files.length} model(s) could not be downloaded.\n`
    )
  }
}

// Re-export the read-side helpers so consumers import from one place.
export {
  summarizeTemplateState,
  formatTemplateSubStatus,
  type TemplateDownloadState,
  type TemplateDownloadSummary,
  type FileProgress
} from './templateDownloadCore'
