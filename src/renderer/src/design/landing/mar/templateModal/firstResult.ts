import type { Template } from '../../mock'
import { hubById } from '../explore/hubWorkflows'
import { secsLeft, type TemplateDownload } from '../downloads/templateDownloads'
import { hasPack, packsFor, totalGb, versionShort, type Target } from './templateData'
import { downloadMinutes, needsDownload } from './runReadiness'

export interface FirstResultPart {
  label: string
  secs: number
}

export interface FirstResult {
  secs: number
  label: string
  parts: FirstResultPart[]
}

type Where = 'local' | 'cloud' | 'partner'

const RUN_SECS: Record<Template['category'], Record<Where, number>> = {
  image: { local: 40, cloud: 12, partner: 20 },
  video: { local: 420, cloud: 100, partner: 120 },
  audio: { local: 30, cloud: 10, partner: 10 },
  '3d': { local: 150, cloud: 45, partner: 60 }
}

const START_SECS = 20
const UPDATE_SECS = 60
const PACK_SECS = 30
const REPAIR_SECS = 60
const NEW_BUILD_GB = 2.4
const HEAVY_GB = 25

const isFast = (t: Template): boolean =>
  /turbo|fast|lightning|distill|8.?step/i.test(t.id + t.title)

export function runSecs(t: Template, where: Where): number {
  const w = hubById(t.id)
  const base =
    w?.useCase === 'Upscale' && w.media === 'video'
      ? { local: 300, cloud: 75, partner: 90 }[where]
      : RUN_SECS[t.category][where]
  const edit = w?.useCase === 'Image editing' ? 1.25 : 1
  const fast = where !== 'partner' && isFast(t) ? 0.35 : 1
  const heavy = where === 'local' && totalGb(t) > HEAVY_GB ? 1.4 : 1
  return Math.max(5, Math.round(base * edit * fast * heavy))
}

function downloadSecs(t: Template, x: Target, live: TemplateDownload | undefined): number {
  if (live && live.status === 'done') return 0
  if (live && live.status === 'downloading' && live.mbps > 0) return secsLeft(live)
  if (live && live.status !== 'cancelled') return downloadMinutes(live.totalGb - live.doneGb) * 60
  if (x.state === 'new') return Math.max(4, downloadMinutes(totalGb(t) + NEW_BUILD_GB) + 3) * 60
  return needsDownload(x) ? downloadMinutes(totalGb(t)) * 60 : 0
}

export function fmtDuration(secs: number): string {
  if (secs < 60) return `${Math.max(5, Math.round(secs / 5) * 5)} s`
  if (secs < 600) {
    const halves = Math.round(secs / 30)
    const m = Math.floor(halves / 2)
    return halves % 2 ? `${m} min 30 s` : `${m} min`
  }
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

const UNREACHABLE: Target['state'][] = ['blocked', 'platform', 'offline']

export function firstResultFor(
  t: Template,
  x: Target | undefined,
  live?: TemplateDownload
): FirstResult | undefined {
  if (!x || x.disabled || UNREACHABLE.includes(x.state)) return undefined
  const cloud = x.inst.kind === 'cloud'
  const parts: FirstResultPart[] = []
  const add = (label: string, secs: number): void => {
    if (secs > 0) parts.push({ label, secs })
  }
  add(x.state === 'new' ? 'Set up' : 'Download', downloadSecs(t, x, live))
  if (!cloud) {
    if (x.state === 'repair') add('Repair', REPAIR_SECS)
    if (versionShort(t, x.inst)) add('Update', UPDATE_SECS)
    if (packsFor(t).some((p) => !hasPack(x.inst, p))) add('Node packs', PACK_SECS)
    if (x.inst.state !== 'running') add('Start', START_SECS)
  }
  add('Run', runSecs(t, cloud ? (t.runs === 'cloud' ? 'partner' : 'cloud') : 'local'))
  const secs = parts.reduce((n, p) => n + p.secs, 0)
  return { secs, label: `about ${fmtDuration(secs)}`, parts }
}
