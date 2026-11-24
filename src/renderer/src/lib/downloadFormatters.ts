import { formatRelativeFromMs, type Translator } from './datetime'

export interface DownloadFormatInput {
  filename: string
  directory?: string
  progress: number
  receivedBytes?: number
  totalBytes?: number
  speedBytesPerSec?: number
  etaSeconds?: number
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'
  error?: string
}

export function fileLabel(d: Pick<DownloadFormatInput, 'filename' | 'directory'>): string {
  return d.directory ? `${d.directory} / ${d.filename}` : d.filename
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1048576) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
  return `${(bytesPerSec / 1048576).toFixed(1)} MB/s`
}

export function formatEta(seconds: number, t: Translator): string {
  if (seconds < 60) return t('downloadsPopup.etaSeconds', { seconds: Math.ceil(seconds) })
  if (seconds < 3600) {
    return t('downloadsPopup.etaMinutes', {
      minutes: Math.floor(seconds / 60),
      seconds: Math.ceil(seconds % 60)
    })
  }
  return t('downloadsPopup.etaHours', {
    hours: Math.floor(seconds / 3600),
    minutes: Math.ceil((seconds % 3600) / 60)
  })
}

export function formatTimeLeft(seconds: number, t: Translator): string {
  if (seconds < 60) return t('downloadsPopup.timeLeftUnderMinute')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t('downloadsPopup.timeLeftMinutes', { minutes })
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0
    ? t('downloadsPopup.timeLeftHours', { hours })
    : t('downloadsPopup.timeLeftHoursMinutes', { hours, minutes: rest })
}

function bytesSoFar(d: DownloadFormatInput, t: Translator): string | null {
  if (!d.totalBytes || d.totalBytes <= 0 || d.receivedBytes == null) return null
  return t('downloadsPopup.bytesOf', {
    received: formatBytes(d.receivedBytes),
    total: formatBytes(d.totalBytes)
  })
}

export function statusLine(
  d: DownloadFormatInput,
  t: Translator,
  opts: { completedShowsSize?: boolean } = {}
): string {
  const pct = Math.round(d.progress * 100)
  switch (d.status) {
    case 'pending':
      return t('downloadsPopup.statusWaiting')
    case 'downloading': {
      const parts = [bytesSoFar(d, t) ?? `${pct}%`]
      if (d.etaSeconds != null && d.etaSeconds > 0 && isFinite(d.etaSeconds)) {
        parts.push(formatTimeLeft(d.etaSeconds, t))
      }
      return parts.join(' · ')
    }
    case 'paused':
      return t('downloadsPopup.statusPaused', { progress: bytesSoFar(d, t) ?? `${pct}%` })
    case 'completed':
      return opts.completedShowsSize && d.totalBytes
        ? t('downloadsPopup.statusDownloadedSize', { size: formatBytes(d.totalBytes) })
        : t('downloadsPopup.statusDownloaded')
    case 'error':
      return d.error || t('downloadsPopup.statusFailed')
    case 'cancelled':
      return t('downloadsPopup.statusCancelled')
    default:
      return ''
  }
}

export function statusKindClass(d: Pick<DownloadFormatInput, 'status'>): string {
  switch (d.status) {
    case 'completed':
      return 'is-completed'
    case 'error':
      return 'is-error'
    case 'cancelled':
      return 'is-cancelled'
    case 'paused':
      return 'is-paused'
    default:
      return 'is-active'
  }
}

export interface ModalFormatInput extends DownloadFormatInput {
  createdAt?: number
  totalBytes?: number
}

export function modalSubtitle(d: ModalFormatInput, t: Translator, now = Date.now()): string {
  const pct = Math.round(d.progress * 100)
  switch (d.status) {
    case 'pending':
      return t('downloadsPopup.statusWaiting')
    case 'downloading': {
      const parts: string[] = [`${pct}%`]
      if (d.totalBytes && d.totalBytes > 0 && d.receivedBytes != null) {
        parts.push(`${formatBytes(d.receivedBytes)} / ${formatBytes(d.totalBytes)}`)
      }
      if (d.speedBytesPerSec && d.speedBytesPerSec > 0) {
        parts.push(formatSpeed(d.speedBytesPerSec))
      }
      if (d.etaSeconds != null && d.etaSeconds > 0 && isFinite(d.etaSeconds)) {
        parts.push(t('downloadsPopup.etaLeft', { eta: formatEta(d.etaSeconds, t) }))
      }
      return parts.join(' · ')
    }
    case 'paused': {
      const parts = [t('downloadsPopup.statusPaused', { progress: `${pct}%` })]
      if (d.totalBytes && d.totalBytes > 0 && d.receivedBytes != null) {
        parts.push(`${formatBytes(d.receivedBytes)} / ${formatBytes(d.totalBytes)}`)
      }
      return parts.join(' · ')
    }
    case 'completed': {
      const parts: string[] = []
      if (d.totalBytes) parts.push(formatBytes(d.totalBytes))
      const ago = d.createdAt ? formatRelativeFromMs(d.createdAt, t, now) : ''
      if (ago) parts.push(ago)
      return parts.join(' · ') || t('downloadsPopup.statusDownloaded')
    }
    case 'error':
      return d.error || t('downloadsPopup.statusFailed')
    case 'cancelled':
      return t('downloadsPopup.statusCancelled')
    default:
      return ''
  }
}
