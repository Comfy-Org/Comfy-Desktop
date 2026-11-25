import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { activeInstance, instanceById, proto } from '../../../useProto'
import { thumb, type Template } from '../../../mock'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { recentsCover } from '../../cover'
import { HUB_WORKFLOWS, type HubUseCase, type HubWorkflow } from '../../explore/hubWorkflows'
import { MACHINE, fmtGb, targetFor, totalGb, type Target } from '../../templateModal/templateData'
import { closeCreate } from '../createScreen'
import { readiness, starterOf, type Starter } from '../createStarters'

export function useCreateKeys(field: Ref<HTMLElement | undefined>, autofocus = true): void {
  function onWindowKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    if (document.activeElement === field.value) return
    closeCreate()
  }
  onMounted(() => {
    if (autofocus) field.value?.focus()
    window.addEventListener('keydown', onWindowKey)
  })
  onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKey))
}

export const machineLabel = (): string =>
  `${MACHINE.chip.replace(/^Apple /, '')} · ${MACHINE.memGb} GB`

const HUB_STARTERS = new Map<string, Starter>()
export function starterFor(w: HubWorkflow, makes?: string): Starter {
  if (makes) return starterOf(w, makes)
  if (!HUB_STARTERS.has(w.id)) HUB_STARTERS.set(w.id, starterOf(w))
  return HUB_STARTERS.get(w.id)!
}

export const byUsage = (list: HubWorkflow[]): HubWorkflow[] =>
  [...list].sort((a, b) => b.usage - a.usage)

export const startersWhere = (pred: (w: HubWorkflow) => boolean, max: number): Starter[] =>
  byUsage(HUB_WORKFLOWS.filter(pred))
    .slice(0, max)
    .map((w) => starterFor(w))

export const ofCases =
  (...cases: HubUseCase[]) =>
  (w: HubWorkflow): boolean =>
    cases.includes(w.useCase)

export type Band = 'now' | 'fetch' | 'power'

export interface Fit {
  band: Band
  local: Target
  gb: number
  minutes: number
  cloudCost: string
  vramGb: number
}

const NOW_STATES = ['running', 'ready', 'media']
const POWER_STATES = ['memory', 'blocked', 'platform']

export function cloudTarget(t: Template): Target | undefined {
  const cloud = instanceById('cloud')
  return cloud ? targetFor(t, cloud, proto.signedIn) : undefined
}

export function fitOf(t: Template): Fit {
  const local = targetFor(t, activeInstance.value, proto.signedIn)
  const gb = totalGb(t)
  const band: Band = NOW_STATES.includes(local.state)
    ? 'now'
    : POWER_STATES.includes(local.state)
      ? 'power'
      : 'fetch'
  return {
    band,
    local,
    gb,
    minutes: Math.max(1, Math.round(gb / 5)),
    cloudCost: cloudTarget(t)?.cost || '',
    vramGb: t.vram ? parseInt(t.vram) : 0
  }
}

export const minutesLabel = (m: number): string =>
  m < 60 ? `~${m} min` : `~${Math.floor(m / 60)} h ${m % 60} min`

export { fmtGb, readiness }

export const recentWorkflows = (max: number): ProjectWorkflow[] =>
  [...allWorkflows.value].sort((a, b) => a.age - b.age).slice(0, max)

export const buildOf = (w: ProjectWorkflow) => (w.envId ? instanceById(w.envId) : undefined)

export const workflowPicture = (w: ProjectWorkflow): string | undefined =>
  recentsCover.id === 'image' && w.thumbId ? thumb(w.thumbId) : undefined

export function playIn(el: EventTarget | Element | null | undefined): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const video = (el as Element | null)?.querySelector?.('video')
  if (video) void video.play().catch(() => undefined)
}

export function stopIn(el: EventTarget | Element | null | undefined): void {
  const video = (el as Element | null)?.querySelector?.('video')
  if (!video) return
  video.pause()
  video.currentTime = 0
}

export interface Family {
  name: string
  maker: string
  blurb: string
  workflows: HubWorkflow[]
  starters: Starter[]
  samples: string[]
  media: HubWorkflow['media'][]
  gb: number
  vramGb: number
  cloudOnly: boolean
  usage: number
}

const FAMILY_ABOUT: Record<string, { maker: string; blurb: string }> = {
  FLUX: { maker: 'Black Forest Labs', blurb: 'Photoreal images and precise edits' },
  'Qwen Image': { maker: 'Alibaba Qwen', blurb: 'Images, edits, text in pictures, new angles' },
  LTX: { maker: 'Lightricks', blurb: 'Fast video from text, images and sound' },
  Wan: { maker: 'Alibaba Wan', blurb: 'Video, motion transfer and lip sync' },
  Hunyuan3D: { maker: 'Tencent', blurb: 'A 3D model from a single picture' },
  SeedVR2: { maker: 'ByteDance Seed', blurb: 'Sharper, bigger images and video' },
  'Z-Image': { maker: 'Tongyi Lab', blurb: 'Quick, sharp text to image' },
  'ACE-Step': { maker: 'ACE Studio', blurb: 'Songs and music from a prompt' },
  MiniMax: { maker: 'MiniMax', blurb: 'Cinematic video and music' },
  Krea: { maker: 'Krea', blurb: 'Stylised text to image' },
  'MOSS-Image': { maker: 'OpenMOSS', blurb: 'Text to image and LoRA edits' },
  Pixal3D: { maker: 'Pixal', blurb: 'Meshes from one or many views' },
  Tripo: { maker: 'Tripo AI', blurb: 'Gaussian splats and 3D models' },
  'Nano Banana': { maker: 'Google', blurb: 'Edits, mockups and consistent shots' },
  Seedream: { maker: 'ByteDance', blurb: 'High-res images and edits' },
  Seedance: { maker: 'ByteDance', blurb: '1080p video from images' },
  Kling: { maker: 'Kuaishou', blurb: 'Multi-shot product video' },
  ElevenLabs: { maker: 'ElevenLabs', blurb: 'Voices and sound effects' }
}

export const LOCAL_FAMILIES = [
  'FLUX',
  'Qwen Image',
  'LTX',
  'Wan',
  'Hunyuan3D',
  'SeedVR2',
  'Z-Image',
  'ACE-Step',
  'MiniMax',
  'Krea',
  'Pixal3D',
  'Tripo'
]
export const CLOUD_FAMILIES = ['Nano Banana', 'Seedream', 'Seedance', 'Kling', 'ElevenLabs']

const smallest = (list: number[]): number => {
  const real = list.filter((n) => n > 0)
  return real.length ? Math.min(...real) : 0
}

export function familyOf(name: string): Family {
  const workflows = byUsage(HUB_WORKFLOWS.filter((w) => w.family === name))
  const local = workflows.filter((w) => w.runs !== 'cloud')
  const starters = workflows.map((w) => starterFor(w))
  return {
    name,
    maker: FAMILY_ABOUT[name]?.maker ?? '',
    blurb: FAMILY_ABOUT[name]?.blurb ?? '',
    workflows,
    starters,
    samples: starters.slice(0, 3).map((s) => s.poster),
    media: [...new Set(workflows.map((w) => w.media))],
    gb: smallest(local.map((w) => w.sizeGb)),
    vramGb: smallest(local.map((w) => w.vramGb ?? 0)),
    cloudOnly: !local.length,
    usage: workflows.reduce((n, w) => n + w.usage, 0)
  }
}
