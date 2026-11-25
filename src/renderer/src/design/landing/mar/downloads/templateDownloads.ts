import { computed, reactive } from 'vue'
import type { ProtoInstance, Template } from '../../mock'
import { goIn, instanceById, proto } from '../../useProto'
import { notify } from '../pages/undo'
import { fmtGb, totalGb, tplById } from '../templateModal/templateData'
import { downloadFinished, runTemplate } from '../autorun/autorun'
import { prepOfTemplate } from '../autorun/prepTabs'

export type DownloadScenario = 'normal' | 'fail' | 'disk' | 'slow'

export const DOWNLOAD_SCENARIOS: { value: DownloadScenario; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'fail', label: 'Fails at 60%' },
  { value: 'disk', label: 'Low disk' },
  { value: 'slow', label: 'Slow' }
]

export const downloadScenario = reactive<{ id: DownloadScenario }>({ id: 'normal' })

export type DownloadStatus = 'downloading' | 'paused' | 'failed' | 'disk' | 'cancelled' | 'done'

export interface TemplateDownload {
  id: string
  title: string
  instId: string
  totalGb: number
  doneGb: number
  status: DownloadStatus
  mbps: number
  failedOnce: boolean
  diskCleared: boolean
  freeGb: number
  seen: boolean
}

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
const DISK_FULL_AT = 0.4
const TICK_MS = 200

export const templateDownloads = reactive<{ list: TemplateDownload[] }>({ list: [] })

export function downloadFor(templateId: string): TemplateDownload | undefined {
  return templateDownloads.list.find((d) => d.id === templateId)
}

export const activeDownloads = computed(() =>
  templateDownloads.list.filter((d) => d.status === 'downloading')
)

export const needsAttention = computed(() =>
  templateDownloads.list.some((d) => d.status === 'failed' || d.status === 'disk')
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

export const percentOf = (d: TemplateDownload): number => Math.floor(progressOf(d) * 100)

export const secsLeft = (d: TemplateDownload): number =>
  ((d.totalGb - d.doneGb) * 1024) / Math.max(1, d.mbps)

function timeLeft(d: TemplateDownload): string {
  const secs = secsLeft(d)
  if (secs < 60) return 'less than a minute left'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `about ${mins} min left`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `about ${h} h ${m} min left` : `about ${h} h left`
}

const sizeDone = (d: TemplateDownload): string => `${fmtGb(d.doneGb)} of ${fmtGb(d.totalGb)}`

export interface DownloadCopy {
  title: string
  detail: string
}

export function copyFor(d: TemplateDownload): DownloadCopy {
  switch (d.status) {
    case 'downloading':
      return {
        title: `Downloading ${percentOf(d)}%`,
        detail: `${sizeDone(d)} · ${d.mbps} MB/s · ${timeLeft(d)}`
      }
    case 'paused':
      return {
        title: `Paused at ${percentOf(d)}%`,
        detail: d.diskCleared
          ? `${sizeDone(d)} · resume once ${fmtGb(d.totalGb - d.doneGb)} is free`
          : `${sizeDone(d)} · picks up where it stopped`
      }
    case 'failed':
      return {
        title: 'Download stopped',
        detail: `Connection lost at ${sizeDone(d)}. Retry picks up where it stopped.`
      }
    case 'disk':
      return {
        title: 'Not enough disk space',
        detail: `Needs ${fmtGb(d.totalGb - d.doneGb)} more; ${fmtGb(d.freeGb)} is free. The ${fmtGb(d.doneGb)} already downloaded is kept.`
      }
    case 'cancelled':
      return {
        title: 'Download cancelled',
        detail: `${fmtGb(d.doneGb)} kept · downloading again picks up there`
      }
    case 'done':
      return { title: 'Ready to run', detail: `${fmtGb(d.totalGb)} downloaded` }
  }
}

export function menuLine(d: TemplateDownload): string {
  switch (d.status) {
    case 'downloading':
      return `${sizeDone(d)} · ${d.mbps} MB/s · ${timeLeft(d)}`
    case 'paused':
      return `Paused · ${sizeDone(d)}`
    case 'failed':
      return `Connection lost at ${percentOf(d)}% · picks up there`
    case 'disk':
      return `Needs ${fmtGb(d.totalGb - d.doneGb)} more · ${fmtGb(d.freeGb)} free`
    case 'cancelled':
      return `Cancelled · ${fmtGb(d.doneGb)} kept`
    case 'done':
      return `Ready to run · ${fmtGb(d.totalGb)}`
  }
}

const watching = (d: TemplateDownload): boolean =>
  (proto.detail?.kind === 'template' && proto.detail.id === d.id) ||
  prepOfTemplate(d.id)?.tabId === proto.activeTab

let timer: ReturnType<typeof setInterval> | undefined
let tickCount = 0

function ensureTimer(): void {
  if (timer || !activeDownloads.value.length) return
  timer = setInterval(tick, TICK_MS)
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
  for (const d of live) {
    const step = (d.totalGb * TICK_MS) / RUN_MS[scenario]
    d.doneGb = Math.min(d.totalGb, d.doneGb + step)
    const wobble = 1 + 0.08 * Math.sin(tickCount / 3 + d.totalGb)
    d.mbps = Math.max(1, Math.round(NOMINAL_MBPS[scenario] * wobble))
    const p = progressOf(d)
    if (scenario === 'fail' && !d.failedOnce && p >= FAIL_AT) fail(d)
    else if (scenario === 'disk' && !d.diskCleared && p >= DISK_FULL_AT) diskFull(d)
    else if (p >= 1) finish(d)
  }
}

function fail(d: TemplateDownload): void {
  d.status = 'failed'
  d.failedOnce = true
  d.seen = false
  if (!watching(d)) notify(`${d.title} download stopped`, () => retry(d.id), 'error', 'Retry')
}

function diskFull(d: TemplateDownload): void {
  d.status = 'disk'
  d.freeGb = 0.4
  d.seen = false
  if (!watching(d))
    notify(
      `Not enough disk space for ${d.title}`,
      () => freeUpSpace(d.id),
      'warning',
      'Free up space'
    )
}

function finish(d: TemplateDownload): void {
  d.status = 'done'
  d.doneGb = d.totalGb
  d.seen = false
  downloadFinished(d.id, d.instId)
}

export function startDownload(t: Template, inst: ProtoInstance): void {
  const was = downloadFor(t.id)
  if (was && was.status !== 'cancelled' && was.status !== 'done') return
  const keep = was?.status === 'cancelled' ? was.doneGb : 0
  const next: TemplateDownload = {
    id: t.id,
    title: t.title,
    instId: inst.id,
    totalGb: totalGb(t),
    doneGb: keep,
    status: 'downloading',
    mbps: NOMINAL_MBPS[downloadScenario.id],
    failedOnce: false,
    diskCleared: false,
    freeGb: 0,
    seen: true
  }
  templateDownloads.list = [next, ...templateDownloads.list.filter((d) => d.id !== t.id)]
  ensureTimer()
}

export function pause(id: string): void {
  const d = downloadFor(id)
  if (d?.status === 'downloading') d.status = 'paused'
}

export function resume(id: string): void {
  const d = downloadFor(id)
  if (!d || d.status === 'done' || d.status === 'downloading') return
  d.status = 'downloading'
  ensureTimer()
}

export function retry(id: string): void {
  resume(id)
}

export function cancel(id: string): void {
  const d = downloadFor(id)
  if (!d || d.status === 'done') return
  const before = d.status
  d.status = 'cancelled'
  notify(`${d.title} download cancelled`, () => {
    const again = downloadFor(id)
    if (again?.status !== 'cancelled') return
    again.status = before
    if (before === 'downloading') ensureTimer()
  })
}

export function remove(id: string): void {
  templateDownloads.list = templateDownloads.list.filter((d) => d.id !== id)
}

export function freeUpSpace(id: string): void {
  const d = downloadFor(id)
  if (d?.status === 'disk') {
    d.status = 'paused'
    d.diskCleared = true
  }
  proto.detail = null
  proto.activeTab = 'home'
  goIn('build', 'router')
}

export function openAndRun(id: string): void {
  const d = downloadFor(id)
  const inst = d && instanceById(d.instId)
  const t = tplById(id)
  if (!d || !inst || !t) return
  remove(id)
  runTemplate(t, inst)
}
