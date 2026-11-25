import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { activeInstance, proto } from '../../../useProto'
import type { Template } from '../../../mock'
import { HUB_WORKFLOWS, hubById, type HubWorkflow } from '../../explore/hubWorkflows'
import { WIRE } from '../../brand/imagery'
import { fmtGb, needsFor, targetFor, totalGb, type Target } from '../../templateModal/templateData'
import { closeCreate } from '../createScreen'
import { readiness, starterOf, type Starter } from '../createStarters'

export const seedOf = (id: string): number => {
  let h = 2166136261
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

export function useCloseOnEsc(field: Ref<HTMLElement | undefined>): void {
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && document.activeElement !== field.value) closeCreate()
  }
  onMounted(() => {
    field.value?.focus()
    window.addEventListener('keydown', onKey)
  })
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
}

export function playIn(el: EventTarget | Element | null | undefined): void {
  const video = (el as Element | null)?.querySelector?.('video')
  if (video) void video.play().catch(() => undefined)
}

export function stopIn(el: EventTarget | Element | null | undefined): void {
  const video = (el as Element | null)?.querySelector?.('video')
  if (!video) return
  video.pause()
  video.currentTime = 0
}

export const targetOf = (t: Template): Target => targetFor(t, activeInstance.value, proto.signedIn)

export function costLine(t: Template): string {
  const target = targetOf(t)
  if (target.state === 'cloud') return `${target.cost} a run on Comfy Cloud`
  if (target.state === 'running' || target.state === 'ready') return `Free on ${target.inst.name}`
  if (target.cost) return `Then free to run on ${target.inst.name}`
  return target.status
}

export const fmtCount = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n)

const CREATORS = [
  'Purz',
  'Rob',
  'Mickmumpitz',
  'Sebastian K.',
  'Ana Lima',
  'Kijai',
  'Nerdy Rodent',
  'Comfy team',
  'Olivio',
  'Yuki T.'
]

export interface Creator {
  name: string
  initials: string
  hue: number
}

const creatorOf = (name: string): Creator => ({
  name,
  initials: name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase(),
  hue: seedOf(name) % 360
})

export interface Community {
  runsWeek: number
  today: number
  creator: Creator
  makers: Creator[]
  outputs: string[]
  trend: number
  added: string
  days: number
  week: number[]
}

const NOW = Date.parse('2026-11-25')

export function communityOf(s: Starter): Community {
  const w = hubById(s.id)
  const seed = seedOf(s.id)
  const usage = w?.usage ?? 200 + (seed % 2000)
  const days = w ? Math.max(1, Math.round((NOW - Date.parse(w.date)) / 864e5)) : 60
  const fresh = Math.max(0.6, 3 - Math.log10(days))
  const runsWeek = Math.round(usage * (0.42 + (seed % 37) / 100) * fresh)
  const peers = HUB_WORKFLOWS.filter((h) => h.id !== s.id && h.media === s.media)
  const outputs = [0, 1, 2, 3].map((i) => {
    const peer = peers[(seed + i * 7) % Math.max(1, peers.length)]
    return peer ? starterOf(peer).poster : s.poster
  })
  return {
    runsWeek,
    today: Math.round(runsWeek / 6.2),
    creator: creatorOf(CREATORS[seed % CREATORS.length]!),
    makers: [1, 2, 3].map((i) => creatorOf(CREATORS[(seed + i * 3) % CREATORS.length]!)),
    outputs,
    trend: runsWeek * fresh,
    added: w?.date ?? '2026-01-01',
    days,
    week: [0, 1, 2, 3, 4, 5, 6].map(
      (d) => (runsWeek / 7) * (0.6 + ((seed >> d) % 9) / 20 + (d * fresh) / 14)
    )
  }
}

export const allStarters = (): Starter[] =>
  [...HUB_WORKFLOWS].sort((a, b) => b.usage - a.usage).map((w) => starterOf(w))

export type CategoryId = 'image' | 'edit' | 'video' | 'upscale' | '3d' | 'audio'

export const CATEGORY_WIRE: Record<CategoryId, string> = {
  image: WIRE.image,
  edit: WIRE.conditioning,
  video: WIRE.latent,
  upscale: WIRE.clip,
  '3d': WIRE.mask,
  audio: WIRE.model
}

export interface KitStep {
  id: string
  does: string
}

export interface Kit {
  id: string
  name: string
  promise: string
  wire: string
  steps: KitStep[]
}

export const KITS: Kit[] = [
  {
    id: 'product',
    name: 'Product photographer',
    promise: 'Cut the product out, put it in a new scene, then sharpen it for print.',
    wire: WIRE.conditioning,
    steps: [
      { id: 'image_qwen_image_2_1_background_removal', does: 'Remove background' },
      { id: 'image_qwen_image_2_1_image_edit', does: 'Relight in a new scene' },
      { id: 'utility_seedvr2_7b_int8_upscale_image', does: 'Upscale to 4K' }
    ]
  },
  {
    id: 'film',
    name: 'Short film maker',
    promise: 'Write a shot, bring it to life, and finish it in sharp HD.',
    wire: WIRE.latent,
    steps: [
      { id: 'image_z_image_turbo', does: 'Text to image' },
      { id: 'video_ltx2_3_i2v', does: 'Image to video' },
      { id: 'utility_seedvr2_3b_int8_upscale_video', does: 'Upscale the video' }
    ]
  },
  {
    id: 'character',
    name: 'Character designer',
    promise: 'One drawing becomes every angle, then a 3D model you can turn.',
    wire: WIRE.model,
    steps: [
      { id: 'templates-1_click_multiple_character_angles-v1.0', does: 'Every angle' },
      { id: '3d_hunyuan3d-v2.1', does: 'Image to 3D model' }
    ]
  },
  {
    id: 'music',
    name: 'Music video',
    promise: 'Make the track, then a singer who lip-syncs to it.',
    wire: WIRE.clip,
    steps: [
      { id: 'audio_minimax_music_3', does: 'Text to music' },
      { id: 'image_z_image_turbo', does: 'Design the singer' },
      { id: 'templates-wan2_1_infinitetalk_music', does: 'Lip-sync video' }
    ]
  },
  {
    id: 'game',
    name: 'Game asset maker',
    promise: 'Concept art to a mesh and a splat, ready for your engine.',
    wire: WIRE.mask,
    steps: [
      { id: 'image_krea2_turbo_t2i', does: 'Concept art' },
      { id: '3d_pixal3d_trellis2_image_to_model', does: 'Image to mesh' },
      { id: '3d_triposplat_image_to_gaussian_splat', does: 'Gaussian splat' }
    ]
  }
]

export interface KitStatus {
  starters: Starter[]
  ready: number
  downloadGb: number
  sharedGb: number
}

export function kitStatus(kit: Kit, installed: Set<string>): KitStatus {
  const starters = kit.steps.flatMap((step) => {
    const w = hubById(step.id)
    return w ? [starterOf(w, step.does)] : []
  })
  const isReady = (s: Starter): boolean =>
    installed.has(s.id) || readiness(s.template).tone === 'ready'
  const seen = new Map<string, number>()
  let sum = 0
  for (const s of starters) {
    if (isReady(s)) continue
    for (const m of needsFor(s.template)) {
      sum += m.gb
      seen.set(m.name, m.gb)
    }
  }
  const unique = [...seen.values()].reduce((n, gb) => n + gb, 0)
  return {
    starters,
    ready: starters.filter(isReady).length,
    downloadGb: unique,
    sharedGb: sum - unique
  }
}

export const isKitReady = (s: Starter, installed: Set<string>): boolean =>
  installed.has(s.id) || readiness(s.template).tone === 'ready'

interface Intent {
  words: RegExp
  match: (w: HubWorkflow) => boolean
  why: string
}

const has = (w: HubWorkflow, ...bits: string[]): boolean =>
  bits.some((b) => `${w.title} ${w.useCase} ${w.description}`.toLowerCase().includes(b))

const INTENTS: Intent[] = [
  {
    words: /\b(animate|video|clip|move|moving|motion|film|footage)\b/,
    match: (w) => w.media === 'video' && w.useCase === 'Video generation',
    why: 'Turns your picture or prompt into a moving clip'
  },
  {
    words: /\b(background|cut ?out|isolate|transparent|remove)\b/,
    match: (w) => has(w, 'background'),
    why: 'Cuts the subject out cleanly'
  },
  {
    words: /\b(upscale|sharpen|sharper|enhance|4k|hd|resolution|bigger)\b/,
    match: (w) => w.useCase === 'Upscale',
    why: 'Adds real detail as it enlarges'
  },
  {
    words: /\b(3d|mesh|model|sculpt|splat|game asset)\b/,
    match: (w) => w.useCase === '3D',
    why: 'Builds a 3D model from one picture'
  },
  {
    words: /\b(music|song|track|beat|soundtrack)\b/,
    match: (w) => has(w, 'music'),
    why: 'Writes music from a description'
  },
  {
    words: /\b(voice|speech|narrat\w*|talk|say|podcast|sfx|sound)\b/,
    match: (w) => w.media === 'audio' || has(w, 'lip sync'),
    why: 'Speaks or scores it for you'
  },
  {
    words: /\b(product|ad|ads|packaging|shop|ecommerce|commerce)\b/,
    match: (w) => w.useCase === 'Product & ads' || has(w, 'background', 'material'),
    why: 'Made for product shots and ads'
  },
  {
    words: /\b(character|angles?|turnaround|pose|face|portrait|person)\b/,
    match: (w) => w.useCase === 'Characters & fashion' || has(w, 'angle'),
    why: 'Keeps the same character across shots'
  },
  {
    words: /\b(edit|change|fix|replace|swap|retouch|relight)\b/,
    match: (w) => w.useCase === 'Image editing',
    why: 'Edits a photo you already have with words'
  },
  {
    words: /\b(logo|brand|icon|poster|mockup|design)\b/,
    match: (w) => w.useCase === 'Brand & design',
    why: 'Built for brand and design assets'
  },
  {
    words: /\b(image|picture|photo|art|illustration|draw|paint|wallpaper)\b/,
    match: (w) => w.useCase === 'Image generation',
    why: 'Makes a picture from your words'
  }
]

export interface Suggestion {
  starter: Starter
  why: string
}

export function suggest(prompt: string, max = 3): Suggestion[] {
  const text = prompt.toLowerCase()
  const hits = INTENTS.filter((i) => i.words.test(text))
  const scored = new Map<string, { w: HubWorkflow; score: number; why: string }>()
  hits.forEach((intent, rank) => {
    for (const w of HUB_WORKFLOWS) {
      if (!intent.match(w)) continue
      const prior = scored.get(w.id)
      const score = (prior?.score ?? 0) + 10 - rank + Math.log10(w.usage + 1)
      scored.set(w.id, {
        w,
        score,
        why: prior ? `${prior.why}, and ${intent.why.toLowerCase()}` : intent.why
      })
    }
  })
  if (!scored.size) {
    const words = text.split(/\W+/).filter((t) => t.length > 2)
    for (const w of HUB_WORKFLOWS) {
      const hay = `${w.title} ${w.useCase} ${w.family} ${w.description}`.toLowerCase()
      const n = words.filter((t) => hay.includes(t)).length
      if (n)
        scored.set(w.id, {
          w,
          score: n * 10 + Math.log10(w.usage + 1),
          why: 'Mentions what you asked for'
        })
    }
  }
  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ w, why }) => ({ starter: starterOf(w), why }))
}

export const PROMPTS = [
  'Animate a photo of my dog',
  'Product shots without the background',
  'A 3D model of my character',
  'Make my old photos sharper',
  'Music for a short film'
]

export const gbLabel = (t: Template): string => fmtGb(totalGb(t))

export const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}
