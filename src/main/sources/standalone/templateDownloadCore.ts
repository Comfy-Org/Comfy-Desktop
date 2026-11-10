import { formatTime } from '../../lib/util'
import { t } from '../../lib/i18n'
import type { TemplateDownloadStatus } from '../../../types/ipc'

export interface FileProgress {
  name: string
  directory: string
  received: number
  total: number
  done: boolean
  failed: boolean
}

export type { TemplateDownloadStatus }

export interface TemplateDownloadState {
  status: TemplateDownloadStatus
  files: FileProgress[]
  estimatedTotalBytes: number
  speedMBs: number
  etaSecs: number
  error?: string
}

export interface TemplateDownloadSummary {
  status: TemplateDownloadStatus
  receivedBytes: number
  totalBytes: number
  doneCount: number
  fileCount: number
  fileIndex: number
  currentFile: string
  speedMBs: number
  etaSecs: number
  percent: number
  error?: string
}

export function isTerminal(status: TemplateDownloadStatus): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled'
}

export function describeDownloadFailure(filename: string, message: string): string {
  if (/\b(401|403)\b/.test(message)) {
    return `[templates] Couldn't download ${filename}: the model repo requires a login or license. Open the template in ComfyUI to sign in / accept it, then it'll download in-app.\n`
  }
  return `[templates] Failed ${filename}: ${message} — will fall back to in-app download.\n`
}

export async function withRetry<T>(
  attempt: () => Promise<T>,
  retries: number,
  opts?: {
    isFatal?: (err: unknown) => boolean
    onRetry?: (nextAttempt: number, err: unknown) => void
  }
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt()
    } catch (err) {
      lastErr = err
      if (opts?.isFatal?.(err)) throw err
      if (i < retries) opts?.onRetry?.(i + 2, err)
    }
  }
  throw lastErr
}

const WIN_MAX_PATH = 259

export function truncateForMaxPath(
  destDir: string,
  filename: string,
  platform: NodeJS.Platform = process.platform,
  reserveSuffixLen = 0
): string | null {
  if (platform !== 'win32') return filename
  const sep = '\\'
  const fullLen = destDir.length + sep.length + filename.length + reserveSuffixLen
  if (fullLen <= WIN_MAX_PATH) return filename
  const dot = filename.lastIndexOf('.')
  const ext = dot > 0 ? filename.slice(dot) : ''
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const available = WIN_MAX_PATH - destDir.length - sep.length - ext.length - reserveSuffixLen
  if (available <= 0) return null
  return stem.slice(0, available) + ext
}

export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (items.length === 0) return
  const cap = Math.max(1, Math.min(concurrency, items.length))
  let next = 0
  async function runner(): Promise<void> {
    for (;;) {
      if (signal?.aborted) return
      const i = next++
      if (i >= items.length) return
      await worker(items[i] as T, i)
    }
  }
  await Promise.all(Array.from({ length: cap }, () => runner()))
}

export function summarizeTemplateState(state: TemplateDownloadState): TemplateDownloadSummary {
  const fileCount = state.files.length
  let receivedBytes = 0
  let knownTotal = 0
  let doneCount = 0
  let activeIndex = 0
  for (let i = 0; i < fileCount; i++) {
    const f = state.files[i]!
    receivedBytes += f.received
    knownTotal += f.total
    if (f.done || f.failed) doneCount++
    else if (activeIndex === 0) activeIndex = i + 1
  }
  const fileIndex = activeIndex === 0 ? fileCount : activeIndex
  const current = fileCount > 0 ? state.files[Math.min(fileIndex, fileCount) - 1] : undefined
  const totalBytes =
    knownTotal > 0 ? Math.max(knownTotal, receivedBytes) : state.estimatedTotalBytes
  const percent =
    state.status === 'done'
      ? 100
      : totalBytes > 0
        ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100))
        : -1
  return {
    status: state.status,
    receivedBytes,
    totalBytes,
    doneCount,
    fileCount,
    fileIndex,
    currentFile: current?.name ?? '',
    speedMBs: state.speedMBs,
    etaSecs: state.etaSecs,
    percent,
    error: state.error
  }
}

export function gbStr(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 * 1024 ? 0 : 1)
}

export const DISK_SPACE_ERROR = 'insufficient-disk'

const STATUS_MESSAGE_KEY: Record<Exclude<TemplateDownloadStatus, 'downloading'>, string> = {
  resolving: 'standalone.templateModelsResolving',
  done: 'standalone.templateModelsDone',
  error: 'standalone.templateModelsError',
  cancelled: 'standalone.templateModelsCancelled'
}

export function formatTemplateSubStatus(summary: TemplateDownloadSummary): string {
  const { status } = summary

  if (status === 'error' && summary.error === DISK_SPACE_ERROR) {
    return t('standalone.templateModelsNoSpace')
  }
  if (status !== 'downloading') {
    return t(STATUS_MESSAGE_KEY[status])
  }

  const speed = summary.speedMBs > 0 ? summary.speedMBs.toFixed(1) : '0.0'
  const eta = summary.etaSecs >= 0 ? formatTime(summary.etaSecs) : '—'
  return t('standalone.templateModelsDownloading', {
    file: summary.currentFile,
    index: summary.fileIndex,
    count: summary.fileCount,
    doneGb: gbStr(summary.receivedBytes),
    totalGb: gbStr(summary.totalBytes),
    speed,
    eta
  })
}
