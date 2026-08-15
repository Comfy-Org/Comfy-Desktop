/**
 * Model staging: the models half of a distribution install.
 *
 * A distribution archive carries only code and the environment (`venv/` +
 * `ComfyUI/`), never model weights. After the archive extracts, this stages the
 * distribution's declared models into the install's own ComfyUI model tree so
 * they are present before ComfyUI starts, mirroring how comfy-deploy provisions
 * weights onto a volume before boot.
 *
 * Placement is `<installPath>/ComfyUI/models/<type>/<filename>`, the install's
 * built-in model root. That root is always on ComfyUI's model search path, so a
 * staged model is found whether or not the user shares a global model library.
 *
 * Every model transfer is a REAL managed job in `comfyDownloadManager` - the
 * same job type as in-Comfy and starter-template model downloads. Jobs appear
 * in the Downloads tray, download to a staged `.part` + sidecar pair (never
 * partial bytes under a model extension), and their staged bytes survive
 * failures and app restarts, so a re-run resumes rather than re-fetching.
 * The job surface is INJECTED by the caller: the download manager imports the
 * source registry, which includes the ComfyBuilder plugin, so importing it
 * here at runtime would be a cycle.
 *
 * Integrity mirrors archive install: every model requires a sha256, verified
 * byte-for-byte by the managed transport before the file appears under its
 * final name. A file already at the destination must match the hash to be
 * kept; a mismatch is a conflict, never silently overwritten.
 */
import fs from 'fs'
import path from 'path'

import type { ModelJobHandle, ModelJobOptions, ModelJobOutcome } from '../lib/comfyDownloadManager'
import { isSecureDownloadUrl, isValidSha256, normalizeSha256 } from './integrity'
import type { ModelDescriptor, StageProgress } from './types'

export type StageModelsErrorKind = 'invalid-model' | 'model-checksum-mismatch' | 'model-conflict'

export class StageModelsError extends Error {
  override name = 'StageModelsError'
  readonly kind: StageModelsErrorKind
  constructor(kind: StageModelsErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

/** The managed model-download surface, narrowed to what staging needs and
 *  injected by the caller (import-cycle firewall; also lets tests fake it). */
export interface ModelJobSurface {
  start: (opts: ModelJobOptions) => Promise<ModelJobHandle>
  /** Destructive cancel by job id; used on abort so rollback never races a
   *  still-open download stream inside the install's model tree. */
  cancel: (id: string) => boolean
}

export interface StageModelsOptions {
  models: readonly ModelDescriptor[]
  /** The install root (the dir that contains `ComfyUI/`). */
  installPath: string
  /** Install record id, so jobs are attributed to this install. */
  installationId?: string | null
  jobs: ModelJobSurface
  onProgress?: (p: StageProgress) => void
  signal?: AbortSignal
}

/** Transient-failure retry budget per model. The managed job keeps its staged
 *  bytes on error, so a retry RESUMES from the prior byte count. Integrity
 *  failures (checksum/conflict) are deterministic and never retried. */
const MODEL_DOWNLOAD_RETRIES = 2

/** Progress is forwarded to the install stepper over IPC; the managed job's
 *  onProgress fires per chunk, so sample it down. */
const PROGRESS_REPORT_MS = 500

/** A single path segment that cannot escape its parent: no separators, no `..`,
 *  no drive/absolute markers. Guards `models/<type>/<filename>` against a
 *  manifest that tries to traverse out of the model tree. */
function isSafeSegment(seg: string): boolean {
  if (!seg || seg === '.' || seg === '..') return false
  if (seg.includes('/') || seg.includes('\\') || seg.includes('\0')) return false
  if (path.isAbsolute(seg) || /^[a-zA-Z]:/.test(seg)) return false
  return true
}

/** The real path of `dir` is inside `root` (defends against a symlinked model
 *  subdir in the extracted archive redirecting a write outside the install). */
function isContained(root: string, dir: string): boolean {
  try {
    const realRoot = fs.realpathSync(root)
    const realDir = fs.realpathSync(dir)
    return realDir === realRoot || realDir.startsWith(realRoot + path.sep)
  } catch {
    return false
  }
}

/** The install's built-in ComfyUI models root, `<installPath>/ComfyUI/models`. */
export function installModelsRoot(installPath: string): string {
  return path.join(installPath, 'ComfyUI', 'models')
}

/** Run one managed job to completion, translating its outcome. Abort cancels
 *  the job destructively and waits for its teardown to settle, so the staged
 *  files inside the install tree are gone before rollback renames it. */
async function runModelJob(
  jobs: ModelJobSurface,
  opts: ModelJobOptions,
  model: ModelDescriptor,
  signal: AbortSignal | undefined
): Promise<ModelJobOutcome> {
  const handle = await jobs.start(opts)
  const onAbort = (): void => {
    jobs.cancel(handle.id)
  }
  if (signal?.aborted) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const outcome = await handle.completion
    if (outcome.status === 'error') {
      if (outcome.code === 'checksum-mismatch') {
        throw new StageModelsError(
          'model-checksum-mismatch',
          `Model ${model.type}/${model.filename} checksum mismatch: ${outcome.error}`
        )
      }
      if (outcome.code === 'existing-file-mismatch') {
        throw new StageModelsError(
          'model-conflict',
          `Model ${model.type}/${model.filename} conflicts with a different existing file.`
        )
      }
    }
    return outcome
  } finally {
    signal?.removeEventListener('abort', onAbort)
    handle.release()
  }
}

/**
 * Download + verify + place each model under `<installPath>/ComfyUI/models`.
 * Throws {@link StageModelsError} on an unsafe path or a checksum mismatch. A
 * model already present with a matching hash is skipped, so a resumed or
 * repeated install does not re-download what is already staged.
 */
export async function stageModels(opts: StageModelsOptions): Promise<void> {
  const { models, installPath, installationId, jobs, onProgress, signal } = opts
  const total = models.length
  const modelsRoot = installModelsRoot(installPath)

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new Error('Cancelled')
    const model = models[i]!
    const index = i + 1

    if (!isSafeSegment(model.type) || !isSafeSegment(model.filename)) {
      throw new StageModelsError(
        'invalid-model',
        `Model ${model.type}/${model.filename} has an unsafe path.`
      )
    }
    if (!isSecureDownloadUrl(model.downloadUrl)) {
      throw new StageModelsError(
        'invalid-model',
        `Model ${model.type}/${model.filename} download URL must be https.`
      )
    }
    if (!isValidSha256(model.sha256)) {
      throw new StageModelsError(
        'invalid-model',
        `Model ${model.type}/${model.filename} has no valid SHA-256 integrity value.`
      )
    }

    const destDir = path.join(modelsRoot, model.type)
    // Create the target dir first, then confirm it really resolves inside the
    // install: a malicious archive can ship `ComfyUI/models/<type>` as a symlink
    // pointing outside, and writing through it would escape the install.
    fs.mkdirSync(destDir, { recursive: true })
    if (!isContained(installPath, destDir)) {
      throw new StageModelsError(
        'invalid-model',
        `Model directory ${model.type} escapes the install.`
      )
    }

    const dest = path.join(destDir, model.filename)
    // Legacy leftover from the pre-managed-job staging flow, which downloaded
    // to a bare `.partial` sibling; it can never be resumed or finalized now.
    await fs.promises.rm(`${dest}.partial`, { force: true }).catch(() => {})

    onProgress?.({ index, total, filename: model.filename, percent: 0 })
    let lastReport = 0
    let lastReportBytes = 0
    const jobOptions: ModelJobOptions = {
      url: model.downloadUrl,
      filename: model.filename,
      directory: model.type,
      installationId,
      sha256: normalizeSha256(model.sha256),
      // Always the install's own model tree, even when the install's model
      // settings would route interactive downloads to a shared root - and the
      // caller holds this root's download lock for the whole transaction.
      destinationBaseDir: modelsRoot,
      bypassRootLockFor: modelsRoot,
      onProgress: (receivedBytes, totalBytes) => {
        const now = Date.now()
        if (now - lastReport < PROGRESS_REPORT_MS) return
        // Rate over the sample window, not since the start: a resumed job
        // begins mid-file, so a from-zero average would overstate the speed.
        const windowSecs = lastReport > 0 ? (now - lastReport) / 1000 : 0
        const windowBytes = receivedBytes - lastReportBytes
        const speed = windowSecs > 0 && windowBytes > 0 ? windowBytes / windowSecs : undefined
        lastReport = now
        lastReportBytes = receivedBytes
        onProgress?.({
          index,
          total,
          filename: model.filename,
          percent: totalBytes > 0 ? Math.min(100, (receivedBytes / totalBytes) * 100) : 0,
          receivedBytes,
          ...(totalBytes > 0 ? { totalBytes } : {}),
          ...(speed !== undefined ? { speedBytesPerSec: speed } : {}),
          ...(speed !== undefined && totalBytes > 0
            ? { etaSecs: Math.max(0, totalBytes - receivedBytes) / speed }
            : {})
        })
      }
    }

    let outcome: ModelJobOutcome | undefined
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new Error('Cancelled')
      outcome = await runModelJob(jobs, jobOptions, model, signal)
      if (outcome.status !== 'error' || attempt >= MODEL_DOWNLOAD_RETRIES) break
    }
    if (signal?.aborted || outcome.status === 'cancelled') throw new Error('Cancelled')
    if (outcome.status === 'error') {
      // Integrity failures were already thrown as StageModelsError inside
      // runModelJob; whatever reaches here is a transport/filesystem failure.
      throw new Error(`Model ${model.type}/${model.filename} download failed: ${outcome.error}`)
    }
    onProgress?.({ index, total, filename: model.filename, percent: 100 })
  }
}
