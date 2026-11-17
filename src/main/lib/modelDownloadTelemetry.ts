import { randomUUID } from 'crypto'
import { bucketError } from '../../shared/errorBucket'
import { ALLOWED_EXTENSIONS } from './downloadFilename'
import { capture, type TelemetryContext } from './telemetry'

export type ModelDownloadSource = 'comfyui' | 'template' | 'app' | 'restored' | 'unknown'

type DownloadStatus = 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'

interface DownloadState {
  status: DownloadStatus
  receivedBytes?: number
  totalBytes?: number
  error?: string
}

interface ModelDownloadTelemetryOptions {
  url: string
  source: ModelDownloadSource
  filename: string
  directory: string
  installationId: string | null
  isRetry?: boolean
}

const MODEL_DIRECTORIES = new Set([
  'checkpoints',
  'loras',
  'vae',
  'controlnet',
  'embeddings',
  'upscale_models',
  'diffusion_models',
  'clip_vision',
  'clip',
  'text_encoders',
  'unet',
  'vae_approx'
])

function toModelDirectoryBucket(directory: string): string {
  if (!directory) return 'unknown'
  const leaf = directory.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean).at(-1)
  return leaf && MODEL_DIRECTORIES.has(leaf) ? leaf : 'other'
}

function toModelFileExtension(filename: string): string {
  if (!filename) return 'unknown'
  const index = filename.lastIndexOf('.')
  if (index < 0 || index === filename.length - 1) return 'none'
  const extension = filename.slice(index).toLowerCase()
  return ALLOWED_EXTENSIONS.includes(extension) ? extension.slice(1) : 'other'
}

function toSizeBucket(bytes: number | null): string {
  if (!bytes) return 'unknown'
  if (bytes < 10 * 1024 * 1024) return 'lt_10mb'
  if (bytes < 100 * 1024 * 1024) return '10_99mb'
  if (bytes < 1024 * 1024 * 1024) return '100mb_1gb'
  return 'gte_1gb'
}

function providerOf(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname
    if (host === 'huggingface.co' || host.endsWith('.huggingface.co')) return 'huggingface'
    if (host === 'civitai.com' || host.endsWith('.civitai.com')) return 'civitai'
  } catch {}
  return 'other'
}

function failureProperties(error: string | undefined): TelemetryContext {
  const status = /\bHTTP ([1-5]\d{2})\b/.exec(error ?? '')
  if (status) {
    const httpStatus = Number(status[1])
    return {
      error_bucket: httpStatus === 401 || httpStatus === 403 ? 'access_denied' : 'http',
      http_status: httpStatus
    }
  }
  if (/checksum/i.test(error ?? '')) return { error_bucket: 'checksum' }
  if (/\b(size mismatch|download incomplete|download corrupt)\b/i.test(error ?? '')) {
    return { error_bucket: 'size_mismatch' }
  }
  if (/download stalled/i.test(error ?? '')) return { error_bucket: 'timeout' }
  const systemCode =
    /\b(?:ENOSPC|EACCES|EPERM|EROFS|ENOENT|ENOTDIR|EISDIR|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ENETUNREACH|ETIMEDOUT)\b|net::ERR_[A-Z0-9_]+/.exec(
      error ?? ''
    )?.[0]
  if (systemCode) return { error_bucket: bucketError(systemCode) }
  return { error_bucket: bucketError(error) }
}

export class ModelDownloadTelemetry {
  private readonly properties: TelemetryContext
  private startedAt?: number
  private status?: DownloadStatus
  private receivedBytes = 0
  private totalBytes: number | null = null
  private resumeCount = 0
  private settled = false

  constructor({
    url,
    source,
    filename,
    directory,
    installationId,
    isRetry = false
  }: ModelDownloadTelemetryOptions) {
    this.properties = {
      download_id: randomUUID(),
      installation_id: installationId,
      source,
      provider: providerOf(url),
      is_retry: isRetry,
      directory_bucket: toModelDirectoryBucket(directory),
      file_ext: toModelFileExtension(filename)
    }
  }

  updateBytes(receivedBytes?: number, totalBytes?: number): void {
    if (receivedBytes !== undefined && Number.isSafeInteger(receivedBytes) && receivedBytes >= 0) {
      this.receivedBytes = receivedBytes
    }
    if (totalBytes !== undefined && Number.isSafeInteger(totalBytes) && totalBytes > 0) {
      this.totalBytes = totalBytes
    }
  }

  report(state: DownloadState): void {
    if (this.settled) return
    if (this.startedAt === undefined || state.status === 'completed') {
      this.updateBytes(state.receivedBytes, state.totalBytes)
    }
    if (this.startedAt === undefined) {
      if (state.status === 'paused') return
      this.startedAt = Date.now()
      this.send('started')
    }
    if (state.status === 'downloading' && this.status === 'paused') {
      this.resumeCount++
      this.send('resumed')
    } else if (state.status === 'paused' && this.status !== 'paused') {
      this.send('paused')
    } else if (
      state.status === 'completed' ||
      state.status === 'cancelled' ||
      state.status === 'error'
    ) {
      this.settled = true
      this.send('result', {
        result: state.status,
        ...(state.status === 'error' ? failureProperties(state.error) : {})
      })
    }
    this.status = state.status
  }

  private send(
    event: 'started' | 'paused' | 'resumed' | 'result',
    extra: TelemetryContext = {}
  ): void {
    try {
      capture(`comfy.desktop.model_download.${event}`, {
        ...this.properties,
        received_bytes: this.receivedBytes,
        total_bytes: this.totalBytes,
        size_bucket: toSizeBucket(this.totalBytes),
        duration_ms: Math.max(0, Date.now() - this.startedAt!),
        resume_count: this.resumeCount,
        ...extra
      })
    } catch {}
  }
}
