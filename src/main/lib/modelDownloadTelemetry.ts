import { randomUUID } from 'crypto'
import { bucketError } from '../../shared/errorBucket'
import { capture, type TelemetryContext } from './telemetry'

export type ModelDownloadSource = 'comfyui' | 'template' | 'app' | 'restored' | 'unknown'

type DownloadStatus = 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'

interface DownloadState {
  status: DownloadStatus
  receivedBytes?: number
  totalBytes?: number
  error?: string
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

  constructor(url: string, source: ModelDownloadSource, isRetry = false) {
    this.properties = {
      download_id: randomUUID(),
      source,
      provider: providerOf(url),
      is_retry: isRetry
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
    } else if (state.status === 'completed' || state.status === 'cancelled') {
      this.settled = true
      this.send(state.status)
    } else if (state.status === 'error') {
      this.settled = true
      this.send('failed', failureProperties(state.error))
    }
    this.status = state.status
  }

  private send(event: string, extra: TelemetryContext = {}): void {
    try {
      capture(`comfy.desktop.model_download.${event}`, {
        ...this.properties,
        received_bytes: this.receivedBytes,
        total_bytes: this.totalBytes,
        duration_ms: Math.max(0, Date.now() - this.startedAt!),
        resume_count: this.resumeCount,
        ...extra
      })
    } catch {}
  }
}
