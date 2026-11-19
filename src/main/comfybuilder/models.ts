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

export interface ModelJobSurface {
  start: (opts: ModelJobOptions) => Promise<ModelJobHandle>
  cancel: (id: string) => boolean
}

export interface StageModelsOptions {
  models: readonly ModelDescriptor[]
  installPath: string
  installationId?: string | null
  jobs: ModelJobSurface
  onProgress?: (p: StageProgress) => void
  signal?: AbortSignal
}

const MODEL_DOWNLOAD_RETRIES = 2

const PROGRESS_REPORT_MS = 500

function isSafeSegment(seg: string): boolean {
  if (!seg || seg === '.' || seg === '..') return false
  if (seg.includes('/') || seg.includes('\\') || seg.includes('\0')) return false
  if (path.isAbsolute(seg) || /^[a-zA-Z]:/.test(seg)) return false
  return true
}

function isContained(root: string, dir: string): boolean {
  try {
    const realRoot = fs.realpathSync(root)
    const realDir = fs.realpathSync(dir)
    return realDir === realRoot || realDir.startsWith(realRoot + path.sep)
  } catch {
    return false
  }
}

export function installModelsRoot(installPath: string): string {
  return path.join(installPath, 'ComfyUI', 'models')
}

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
    const rawSha256 = model.sha256?.trim()
    if (rawSha256 && !isValidSha256(rawSha256)) {
      throw new StageModelsError(
        'invalid-model',
        `Model ${model.type}/${model.filename} has an invalid SHA-256 integrity value.`
      )
    }
    const sha256 = normalizeSha256(rawSha256)

    const destDir = path.join(modelsRoot, model.type)
    fs.mkdirSync(destDir, { recursive: true })
    if (!isContained(installPath, destDir)) {
      throw new StageModelsError(
        'invalid-model',
        `Model directory ${model.type} escapes the install.`
      )
    }

    const dest = path.join(destDir, model.filename)
    await fs.promises.rm(`${dest}.partial`, { force: true }).catch(() => {})

    onProgress?.({ index, total, filename: model.filename, percent: 0 })
    let lastReport = 0
    let lastReportBytes = 0
    const jobOptions: ModelJobOptions = {
      url: model.downloadUrl,
      filename: model.filename,
      directory: model.type,
      installationId,
      ...(sha256 ? { sha256 } : {}),
      destinationBaseDir: modelsRoot,
      bypassRootLockFor: modelsRoot,
      onProgress: (receivedBytes, totalBytes) => {
        const now = Date.now()
        if (now - lastReport < PROGRESS_REPORT_MS) return
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
      throw new Error(`Model ${model.type}/${model.filename} download failed: ${outcome.error}`)
    }
    onProgress?.({ index, total, filename: model.filename, percent: 100 })
  }
}
