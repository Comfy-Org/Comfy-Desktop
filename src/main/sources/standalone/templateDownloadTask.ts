import fs from 'fs'
import path from 'path'
import { startManagedModelJob, type ModelJobOutcome } from '../../lib/comfyDownloadManager'
import {
  areModelsPresent,
  getModelsBaseDir,
  resolveDownloadContextById
} from '../../lib/modelDownloadPaths'
import { STAGING_META_SUFFIX, STAGING_META_TMP_SUFFIX } from '../../lib/modelDownloadStaging'
import { getDiskSpace } from '../../lib/disk'
import { resolveTemplateModels, resolveTemplateModelsFromJson } from './templateModels'
import { downloadTemplateInputAssets } from './templateInputAssets'
import {
  isTerminal,
  runPool,
  withRetry,
  truncateForMaxPath,
  describeDownloadFailure,
  gbStr,
  DISK_SPACE_ERROR,
  summarizeTemplateState,
  type TemplateDownloadState,
  type TemplateDownloadSummary
} from './templateDownloadCore'
import type { InstallationRecord } from '../../installations'

const MODEL_POOL_CONCURRENCY = 3
const DISK_HEADROOM = 1.05
const MODEL_DOWNLOAD_RETRIES = 2

const _templateDownloads = new Map<string, TemplateDownloadState>()
const _templateAborts = new Map<string, AbortController>()
const _templateJobLeases = new Map<string, Set<() => void>>()

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

const _templateSkips = new Set<string>()

export function requestSkipTemplateDownload(installationId: string): void {
  _templateSkips.add(installationId)
}

const SETTLE_POLL_MS = 250

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
    check()
  })
}

interface StartOpts {
  sendOutput: (text: string) => void
}

export function startTemplateDownload(
  installation: InstallationRecord,
  estimatedSizeBytes: number,
  opts: StartOpts
): void {
  const templateId = installation.bundledTemplateId
  if (!templateId) return
  startTemplateDownloadTask(installation.id, installation, templateId, estimatedSizeBytes, opts)
}

export function startTemplateDownloadTask(
  taskId: string,
  installation: InstallationRecord,
  templateId: string,
  estimatedSizeBytes: number,
  opts: StartOpts,
  workflowJson?: unknown
): void {
  const existing = _templateDownloads.get(taskId)
  if (existing && !isTerminal(existing.status)) return

  const state: TemplateDownloadState = {
    status: 'resolving',
    files: [],
    estimatedTotalBytes: estimatedSizeBytes,
    speedMBs: 0,
    etaSecs: -1
  }
  _templateDownloads.set(taskId, state)
  const abort = new AbortController()
  const jobLeases = new Set<() => void>()
  _templateAborts.set(taskId, abort)
  _templateJobLeases.set(taskId, jobLeases)

  const log = (text: string): void => {
    console.log(`[templateDownload:${taskId}] ${text.trimEnd()}`)
    opts.sendOutput(text)
  }
  const taskOpts: StartOpts = { sendOutput: log }

  log(
    `[templates] Starting background download for "${templateId}" (est. ${gbStr(estimatedSizeBytes)} GB)...\n`
  )

  const publisher = setInterval(() => publishProgress(taskId, state), PROGRESS_PUBLISH_MS)

  void runTask(taskId, installation, templateId, state, abort.signal, taskOpts, workflowJson)
    .catch((err) => {
      if (!isTerminal(state.status)) {
        state.status = 'error'
        state.error = (err as Error).message
      }
      log(`[templates] Download task failed: ${(err as Error).message}\n`)
    })
    .finally(() => {
      if (_templateAborts.get(taskId) === abort) _templateAborts.delete(taskId)
      if (_templateJobLeases.get(taskId) === jobLeases) {
        for (const release of [...jobLeases]) release()
        _templateJobLeases.delete(taskId)
      }
      clearInterval(publisher)
      publishProgress(taskId, state)
    })
}

const PROGRESS_PUBLISH_MS = 500
type TemplateDownloadListener = (summary: TemplateDownloadSummary) => void
const _templateListeners = new Map<string, Set<TemplateDownloadListener>>()

function publishProgress(taskId: string, state: TemplateDownloadState): void {
  const listeners = _templateListeners.get(taskId)
  if (!listeners?.size || _templateDownloads.get(taskId) !== state) return
  const summary = summarizeTemplateState(state)
  if (isTerminal(state.status)) _templateListeners.delete(taskId)
  for (const listener of listeners) listener(summary)
}

export function subscribeTemplateDownload(
  taskId: string,
  listener: TemplateDownloadListener
): () => void {
  const state = _templateDownloads.get(taskId)
  if (state) {
    listener(summarizeTemplateState(state))
    if (isTerminal(state.status)) return () => {}
  }
  let listeners = _templateListeners.get(taskId)
  if (!listeners) {
    listeners = new Set()
    _templateListeners.set(taskId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && _templateListeners.get(taskId) === listeners) {
      _templateListeners.delete(taskId)
    }
  }
}

export function forgetTemplateDownload(taskId: string): void {
  abortTemplateDownload(taskId)
  _templateDownloads.delete(taskId)
  _templateListeners.delete(taskId)
}

class ModelJobCancelledError extends Error {
  constructor() {
    super('Download cancelled')
    this.name = 'ModelJobCancelledError'
  }
}

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
  taskId: string,
  installation: InstallationRecord,
  templateId: string,
  state: TemplateDownloadState,
  signal: AbortSignal,
  { sendOutput }: StartOpts,
  workflowJson?: unknown
): Promise<void> {
  await downloadTemplateInputAssets(installation, templateId, sendOutput, signal, workflowJson)
  if (signal.aborted) {
    state.status = 'cancelled'
    return
  }

  sendOutput(`[templates] Resolving model list for "${templateId}"...\n`)
  const models = workflowJson
    ? resolveTemplateModelsFromJson(workflowJson)
    : await resolveTemplateModels(installation, templateId)

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

  const ctx = await resolveDownloadContextById(installation.id)
  const baseDir = ctx ? ctx.downloadBaseDir : getModelsBaseDir()

  if (state.estimatedTotalBytes > 0 && !(await areModelsPresent(installation.id, models))) {
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

  const activeJobLeases = _templateJobLeases.get(taskId)

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

      const safeName = truncateForMaxPath(
        destDir,
        f.name,
        process.platform,
        STAGING_META_SUFFIX.length + STAGING_META_TMP_SUFFIX.length
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
            const handle = await startManagedModelJob({
              url: model.url,
              filename: safeName,
              directory: f.directory,
              installationId: installation.id,
              onProgress: (receivedBytes, totalBytes) => {
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
            if (signal.aborted) handle.release()
            try {
              const outcome = await raceCompletionWithAbort(handle.completion, signal)
              if (outcome === 'aborted') {
                handle.release()
                throw new ModelJobCancelledError()
              }
              if (outcome.status === 'error') throw new Error(outcome.error)
              if (outcome.status === 'cancelled') throw new ModelJobCancelledError()
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
              handle.release()
            }
          },
          MODEL_DOWNLOAD_RETRIES,
          {
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

export {
  summarizeTemplateState,
  formatTemplateSubStatus,
  type TemplateDownloadState,
  type TemplateDownloadSummary,
  type FileProgress
} from './templateDownloadCore'
