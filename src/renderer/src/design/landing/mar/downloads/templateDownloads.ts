import { computed, reactive } from 'vue'
import type { ProtoInstance, Template } from '../../mock'
import { instanceById, proto } from '../../useProto'
import { notify } from '../pages/undo'
import { isOffline, needsFor, totalGb, tplById } from '../templateModal/templateData'
import { downloadFinished, openWithExample } from '../templateOpen/openTemplate'
import { prepOfTemplate } from '../templateOpen/prepTabs'
import { markDownloaded } from '../templateOpen/installed'
import { offline } from '../offline/connection'

export type DownloadScenario = 'normal' | 'fail' | 'disk' | 'slow'

export const DOWNLOAD_SCENARIOS: { value: DownloadScenario; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'fail', label: 'Stalls, then fails at 60%' },
  { value: 'disk', label: 'Low disk' },
  { value: 'slow', label: 'Slow' }
]

export const downloadScenario = reactive<{ id: DownloadScenario }>({ id: 'normal' })

export type DownloadStatus = 'downloading' | 'paused' | 'failed' | 'cancelled' | 'done'

export interface TemplateDownload {
  id: string
  title: string
  instId: string
  totalGb: number
  doneGb: number
  status: DownloadStatus
  mbps: number
  error?: string
  disk?: boolean
  failedOnce: boolean
  diskCleared: boolean
  stalledAt?: number
  seen: boolean
  opens: boolean
}

export const DOWNLOAD_COPY = {
  title: 'Downloads',
  empty: 'No downloads yet',
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel',
  retry: 'Try again',
  showInFolder: 'Show in Finder',
  remove: 'Remove from list',
  viewAll: 'View all',
  viewAllLabel: 'View all downloads',
  waiting: 'Waiting…',
  downloaded: 'Downloaded',
  cancelled: 'Cancelled',
  failed: 'Download failed',
  open: 'Open'
} as const

const RUN_MS: Record<DownloadScenario, number> = {
  normal: 24000,
  fail: 24000,
  disk: 24000,
  slow: 120000
}
const NOMINAL_MBPS: Record<DownloadScenario, number> = {
  normal: 84,
  fail: 84,
  disk: 84,
  slow: 6
}
const FAIL_AT = 0.6
const STALL_MS = 5000
const OFFLINE_FAIL_MS = 900
export const DISK_FREE_GB = 2.1
const DISK_RESERVE_GB = (512 * 1024 * 1024) / 1e9
const TICK_MS = 200

export const templateDownloads = reactive<{ list: TemplateDownload[] }>({ list: [] })

export const diskRoom = reactive({ freedGb: 0, otherDrive: false, removed: [] as string[] })

export const THIS_DRIVE = { name: 'Macintosh HD' }

export const OTHER_DRIVE = {
  name: 'Studio SSD',
  path: '/Volumes/Studio SSD/ComfyUI/models',
  freeGb: 1600
}

export function diskNeedGb(d: TemplateDownload): number {
  if (diskRoom.otherDrive) return 0
  const needed = d.totalGb - d.doneGb + DISK_RESERVE_GB
  return Math.max(0, needed - DISK_FREE_GB - diskRoom.freedGb)
}

export function downloadFor(templateId: string): TemplateDownload | undefined {
  return templateDownloads.list.find((d) => d.id === templateId)
}

export const activeDownloads = computed(() =>
  templateDownloads.list.filter((d) => d.status === 'downloading')
)

export const needsAttention = computed(() =>
  templateDownloads.list.some((d) => d.status === 'failed' && !d.seen)
)

export const unseenDone = computed(() =>
  templateDownloads.list.some((d) => d.status === 'done' && !d.seen)
)

export function markSeen(): void {
  for (const d of templateDownloads.list) d.seen = true
}

export const overallProgress = computed(() => {
  const live = templateDownloads.list.filter(
    (d) => d.status === 'downloading' || d.status === 'paused'
  )
  const total = live.reduce((n, d) => n + d.totalGb, 0)
  return total ? live.reduce((n, d) => n + d.doneGb, 0) / total : 0
})

export const progressOf = (d: TemplateDownload): number =>
  d.totalGb ? Math.min(1, d.doneGb / d.totalGb) : 1

export const percentOf = (d: TemplateDownload): number => Math.round(progressOf(d) * 100)

export const secsLeft = (d: TemplateDownload): number =>
  d.mbps > 0 ? ((d.totalGb - d.doneGb) * 1024) / d.mbps : Infinity

const BYTES_GB = 1073741824

export function formatGb(gb: number): string {
  const bytes = gb * BYTES_GB
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < BYTES_GB) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / BYTES_GB).toFixed(2)} GB`
}

export const formatSpeed = (mbps: number): string => `${mbps.toFixed(1)} MB/s`

export function formatTimeLeft(secs: number): string {
  if (secs < 60) return 'Less than a minute left'
  const minutes = Math.round(secs / 60)
  if (minutes < 60) return `${minutes} min left`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h left` : `${hours} h ${rest} min left`
}

export function formatEta(secs: number): string {
  if (secs < 60) return `${Math.ceil(secs)}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.ceil(secs % 60)}s`
  return `${Math.floor(secs / 3600)}h ${Math.ceil((secs % 3600) / 60)}m`
}

const hasEta = (d: TemplateDownload): boolean => d.mbps > 0 && isFinite(secsLeft(d))

export function statusLine(d: TemplateDownload): string {
  switch (d.status) {
    case 'downloading': {
      const parts = [`${percentOf(d)}%`]
      if (d.mbps > 0) parts.push(formatSpeed(d.mbps))
      if (hasEta(d)) parts.push(formatTimeLeft(secsLeft(d)))
      return parts.join(' · ')
    }
    case 'paused':
      return `Paused · ${formatGb(d.doneGb)} of ${formatGb(d.totalGb)}`
    case 'done':
      return `${DOWNLOAD_COPY.downloaded} · ${formatGb(d.totalGb)}`
    case 'failed':
      return d.error || DOWNLOAD_COPY.failed
    case 'cancelled':
      return DOWNLOAD_COPY.cancelled
  }
}

export function detailLine(d: TemplateDownload): string {
  const sizes = `${formatGb(d.doneGb)} / ${formatGb(d.totalGb)}`
  switch (d.status) {
    case 'downloading': {
      const parts = [`${percentOf(d)}%`, sizes]
      if (d.mbps > 0) parts.push(formatSpeed(d.mbps))
      if (hasEta(d)) parts.push(`~${formatEta(secsLeft(d))} left`)
      return parts.join(' · ')
    }
    case 'paused':
      return `Paused · ${percentOf(d)}% · ${sizes}`
    case 'done':
      return formatGb(d.totalGb)
    default:
      return statusLine(d)
  }
}

export interface DownloadFileRow {
  key: string
  name: string
  download: TemplateDownload
  status: DownloadStatus | 'pending'
  progress: number
  line: string
}

export function fileRowsOf(d: TemplateDownload): DownloadFileRow[] {
  const t = tplById(d.id)
  const files = t ? needsFor(t) : []
  const total = files.reduce((n, f) => n + f.gb, 0) || d.totalGb
  const rows: DownloadFileRow[] = []
  let at = 0
  for (const f of files) {
    const share = (f.gb / total) * d.totalGb
    const got = Math.max(0, Math.min(share, d.doneGb - at))
    const row = { key: `${d.id}~${f.name}`, name: f.name, download: d }
    at += share
    if (d.status === 'done' || got >= share - 1e-9) {
      rows.push({
        ...row,
        status: 'done',
        progress: 1,
        line: `${DOWNLOAD_COPY.downloaded} · ${formatGb(f.gb)}`
      })
      continue
    }
    const current = rows.every((r) => r.status === 'done')
    if (current) {
      const part: TemplateDownload = { ...d, totalGb: share, doneGb: got }
      rows.push({ ...row, status: d.status, progress: got / share, line: statusLine(part) })
      continue
    }
    if (d.status === 'downloading' || d.status === 'paused')
      rows.push({ ...row, status: 'pending', progress: 0, line: DOWNLOAD_COPY.waiting })
  }
  return rows
}

export function currentFile(d: TemplateDownload): { name: string; index: number; count: number } {
  const rows = fileRowsOf(d)
  const i = Math.max(
    0,
    rows.findIndex((r) => r.status !== 'done')
  )
  return { name: rows[i]?.name ?? d.title, index: i + 1, count: Math.max(1, rows.length) }
}

export const trayLabel = computed(() => {
  const rows = templateDownloads.list.flatMap(fileRowsOf)
  const active = rows.filter(
    (r) => r.status === 'downloading' || r.status === 'paused' || r.status === 'pending'
  ).length
  const errors = templateDownloads.list.filter((d) => d.status === 'failed' && !d.seen).length
  const failedLine = `${errors} ${errors === 1 ? 'download' : 'downloads'} failed. Click to review`
  if (active > 0) {
    const inProgress = `${active} ${active === 1 ? 'download' : 'downloads'} in progress`
    return errors > 0 ? `${inProgress} · ${failedLine}` : inProgress
  }
  if (errors > 0) return failedLine
  const unseen = templateDownloads.list.filter((d) => d.status === 'done' && !d.seen).length
  if (unseen > 0)
    return `${unseen} ${unseen === 1 ? 'download' : 'downloads'} finished. Click to review`
  return DOWNLOAD_COPY.title
})

const watching = (d: TemplateDownload): boolean =>
  (proto.detail?.kind === 'template' && proto.detail.id === d.id) ||
  prepOfTemplate(d.id)?.tabId === proto.activeTab

let timer: ReturnType<typeof setInterval> | undefined
let tickCount = 0

function ensureTimer(): void {
  if (timer || !activeDownloads.value.length) return
  timer = setInterval(tick, TICK_MS)
}

const cutOff = (d: TemplateDownload): boolean => {
  const t = tplById(d.id)
  return offline.value || (!!t && isOffline(t))
}

function tick(): void {
  tickCount++
  const live = activeDownloads.value
  if (!live.length) {
    clearInterval(timer)
    timer = undefined
    return
  }
  const scenario = downloadScenario.id
  const now = Date.now()
  for (const d of live) {
    if (cutOff(d) || (d.stalledAt !== undefined && scenario === 'fail')) {
      d.stalledAt ??= now
      d.mbps = Math.max(0, Math.floor(d.mbps * 0.6))
      const limit = cutOff(d) && d.doneGb === 0 ? OFFLINE_FAIL_MS : STALL_MS
      if (now - d.stalledAt >= limit) fail(d)
      continue
    }
    const step = (d.totalGb * TICK_MS) / RUN_MS[scenario]
    d.doneGb = Math.min(d.totalGb, d.doneGb + step)
    const wobble = 1 + 0.08 * Math.sin(tickCount / 3 + d.totalGb)
    d.mbps = Math.max(1, NOMINAL_MBPS[scenario] * wobble)
    const p = progressOf(d)
    if (scenario === 'fail' && !d.failedOnce && p >= FAIL_AT) d.stalledAt = now
    else if (p >= 1) finish(d)
  }
}

function fail(d: TemplateDownload, error?: string): void {
  d.status = 'failed'
  d.error = error
  d.mbps = 0
  d.stalledAt = undefined
  d.failedOnce = true
  d.seen = false
  if (!watching(d))
    notify(`${d.title}: ${error ?? DOWNLOAD_COPY.failed}`, () => retry(d.id), 'error', 'Try again')
}

function diskShortfall(d: TemplateDownload): string | undefined {
  if (downloadScenario.id !== 'disk' || d.diskCleared) return undefined
  const short = diskNeedGb(d)
  if (short <= 0) return undefined
  return `Free up ${(Math.ceil(short * 10) / 10).toFixed(1)} GB of space, then try again`
}

export const diskFull = (d: TemplateDownload): boolean =>
  d.status === 'failed' && Boolean(d.disk) && downloadScenario.id === 'disk'

export function failNow(id: string): void {
  const d = downloadFor(id)
  if (!d || d.status !== 'downloading') return
  d.doneGb = d.totalGb * FAIL_AT
  fail(d)
}

function finish(d: TemplateDownload): void {
  d.status = 'done'
  d.doneGb = d.totalGb
  d.seen = false
  if (d.opens) downloadFinished(d.id, d.instId)
  else markDownloaded(d.id, d.instId)
}

function run(d: TemplateDownload): void {
  d.error = undefined
  d.stalledAt = undefined
  d.status = 'downloading'
  d.mbps = 0
  const shortfall = diskShortfall(d)
  d.disk = Boolean(shortfall)
  if (shortfall) {
    fail(d, shortfall)
    return
  }
  ensureTimer()
}

export function startDownload(
  t: Template,
  inst: ProtoInstance,
  { opens = true }: { opens?: boolean } = {}
): void {
  const was = downloadFor(t.id)
  if (was && was.status !== 'cancelled' && was.status !== 'done') return
  const next: TemplateDownload = {
    id: t.id,
    title: t.title,
    instId: inst.id,
    totalGb: totalGb(t),
    doneGb: 0,
    status: 'downloading',
    mbps: 0,
    failedOnce: false,
    diskCleared: false,
    seen: true,
    opens
  }
  templateDownloads.list = [next, ...templateDownloads.list.filter((d) => d.id !== t.id)]
  run(downloadFor(t.id)!)
}

export function pause(id: string): void {
  const d = downloadFor(id)
  if (d?.status !== 'downloading') return
  d.status = 'paused'
  d.mbps = 0
  d.stalledAt = undefined
}

export function resume(id: string): void {
  const d = downloadFor(id)
  if (!d || d.status === 'done' || d.status === 'downloading') return
  run(d)
}

export function retry(id: string): void {
  const d = downloadFor(id)
  if (!d) return
  if (d.error && !d.disk) d.diskCleared = true
  if (d.status === 'cancelled') d.doneGb = 0
  resume(id)
}

export function cancel(id: string): void {
  const d = downloadFor(id)
  if (!d || d.status === 'done') return
  d.status = 'cancelled'
  d.mbps = 0
  d.doneGb = 0
  d.error = undefined
  d.stalledAt = undefined
}

export function pauseAll(): void {
  for (const d of activeDownloads.value) pause(d.id)
}

export function remove(id: string): void {
  templateDownloads.list = templateDownloads.list.filter((d) => d.id !== id)
}

export function openDownloaded(id: string): void {
  const d = downloadFor(id)
  const inst = d && instanceById(d.instId)
  const t = tplById(id)
  if (!d || !inst || !t) return
  remove(id)
  openWithExample(t, inst)
}
