import { activeInstance, proto } from '../../useProto'
import type { Template } from '../../mock'
import { mock } from '../assets/mock'
import {
  HUB_WORKFLOWS,
  hubById,
  hubLine,
  hubTemplate,
  workflowThumb,
  type HubUseCase,
  type HubWorkflow
} from '../explore/hubWorkflows'
import {
  CASE_STATE,
  fmtGb,
  targetFor,
  totalGb,
  type TargetState
} from '../templateModal/templateData'

const CLIPS = import.meta.glob<string>('../assets/examples/gv-*.mp4', {
  eager: true,
  import: 'default'
})
const CLIP_SLOTS = ['dunes', 'waves', 'lake', 'reeds', 'horse', 'dove', 'smoke', 'stone']

export interface Starter {
  id: string
  template: Template
  makes: string
  model: string
  line: string
  media: HubWorkflow['media']
  poster: string
  clip?: string
}

export interface Readiness {
  tone: 'ready' | 'fetch' | 'off'
  label: string
}

const seed = (id: string): number => [...id].reduce((n, c) => n + c.charCodeAt(0), 0)

export function clipFor(
  w: HubWorkflow,
  pinned?: string
): { poster: string; clip: string } | undefined {
  if (w.media !== 'video') return undefined
  const slot = pinned ?? CLIP_SLOTS[seed(w.id) % CLIP_SLOTS.length]!
  const clip = CLIPS[`../assets/examples/gv-${slot}.mp4`]
  return clip ? { poster: mock(`gv-${slot}`), clip } : undefined
}

export function starterOf(w: HubWorkflow, makes?: string, slot?: string): Starter {
  const tail = w.title.split(':')[1]?.trim()
  const video = clipFor(w, slot)
  return {
    id: w.id,
    template: hubTemplate(w),
    makes: makes ?? tail ?? w.title,
    model: w.family,
    line: hubLine(w),
    media: w.media,
    poster: video?.poster ?? workflowThumb(w.id),
    clip: video?.clip
  }
}

const POPULAR: [string, string, string?][] = [
  ['video_ltx2_3_i2v', 'Image to video', 'dove'],
  ['image_z_image_turbo', 'Text to image'],
  ['image_qwen_image_2_1_image_edit', 'Edit an image'],
  ['image_qwen_image_2_1_background_removal', 'Remove background'],
  ['utility_seedvr2_7b_int8_upscale_image', 'Upscale an image'],
  ['3d_hunyuan3d-v2.1', 'Image to 3D model'],
  ['templates-1_click_multiple_character_angles-v1.0', 'Character from every angle']
]

export interface StarterShelf {
  id: string
  label: string
  starters: () => Starter[]
}

const byUseCase =
  (...cases: HubUseCase[]) =>
  (): Starter[] =>
    HUB_WORKFLOWS.filter((w) => cases.includes(w.useCase))
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 6)
      .map((w) => starterOf(w))

export const SHELVES: StarterShelf[] = [
  {
    id: 'popular',
    label: 'Popular',
    starters: () =>
      POPULAR.flatMap(([id, makes, slot]) => {
        const w = hubById(id)
        return w ? [starterOf(w, makes, slot)] : []
      })
  },
  { id: 'image', label: 'Text to image', starters: byUseCase('Image generation') },
  { id: 'edit', label: 'Edit an image', starters: byUseCase('Image editing') },
  { id: 'video', label: 'Video', starters: byUseCase('Video generation', 'Video editing') },
  { id: 'upscale', label: 'Upscale', starters: byUseCase('Upscale') },
  { id: '3d', label: '3D', starters: byUseCase('3D') },
  { id: 'audio', label: 'Audio', starters: byUseCase('Audio') }
]

const READY_STATES = ['running', 'ready', 'cloud']
const OFF_LABEL: Partial<Record<TargetState, string>> = {
  update: 'Needs an update',
  nodes: 'Needs custom nodes',
  new: 'Needs a new build',
  blocked: 'Not on this build'
}

export function readiness(t: Template): Readiness {
  const target = targetFor(t, activeInstance.value, proto.signedIn)
  if (READY_STATES.includes(target.state)) return { tone: 'ready', label: 'Ready to run' }
  if (target.state === 'download') {
    const gb = totalGb(t)
    return { tone: 'fetch', label: `Needs ${fmtGb(gb)} · ~${Math.max(1, Math.round(gb / 5))} min` }
  }
  return {
    tone: 'off',
    label: CASE_STATE[target.state]?.label ?? OFF_LABEL[target.state] ?? target.status
  }
}

export function searchStarters(q: string, max: number): Starter[] {
  return HUB_WORKFLOWS.filter((w) =>
    `${w.title} ${w.useCase} ${w.family}`.toLowerCase().includes(q)
  )
    .sort((a, b) => b.usage - a.usage)
    .slice(0, max)
    .map((w) => starterOf(w))
}
