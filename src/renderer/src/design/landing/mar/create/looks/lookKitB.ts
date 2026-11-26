import { onBeforeUnmount, onMounted, type Component } from 'vue'
import { Check, Download } from 'lucide-vue-next'
import { instanceById } from '../../../useProto'
import type { ProjectWorkflow } from '../../../gallery'
import { mock } from '../../assets/mock'
import { HUB_WORKFLOWS, hubById, type HubUseCase } from '../../explore/hubWorkflows'
import { NODE_TYPES, type NodeKind } from '../../graph/canvasData'
import { closeCreate } from '../createScreen'
import { TEMPLATE_OUTPUTS } from '../../templateModal/templateOutputs'
import { SHELVES, starterOf, type Readiness, type Starter } from '../createStarters'

export const readyIcon = (r: Readiness): Component => (r.tone === 'fetch' ? Download : Check)

export const buildOf = (w: ProjectWorkflow) => (w.envId ? instanceById(w.envId) : undefined)
export const hueOf = (w: ProjectWorkflow): string => `--h: ${buildOf(w)?.hue ?? 250}`

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

export function useEscapeCloses(
  field: () => HTMLElement | undefined,
  first: () => boolean = () => false
): void {
  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || document.activeElement === field()) return
    if (!first()) closeCreate()
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
}

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function uniqueStarters(): Starter[] {
  const seen = new Set<string>()
  return SHELVES.flatMap((s) => s.starters()).filter((s) =>
    seen.has(s.id) ? false : (seen.add(s.id), true)
  )
}

export function starterById(id: string, makes?: string, slot?: string): Starter | undefined {
  const w = hubById(id)
  return w ? starterOf(w, makes, slot) : undefined
}

export interface GraphNode {
  kind: NodeKind
  title: string
  x: number
  y: number
}

const INPUT_FIRST: Record<string, NodeKind[]> = {
  image: ['prompt'],
  edit: ['image', 'prompt'],
  video: ['image', 'prompt'],
  upscale: ['image'],
  removeBg: ['image'],
  '3d': ['image'],
  audio: ['prompt']
}

function shapeOf(s: Starter): { ins: NodeKind[]; work: NodeKind } {
  const m = s.makes.toLowerCase()
  if (m.includes('upscale')) return { ins: INPUT_FIRST.upscale!, work: 'upscale' }
  if (m.includes('background')) return { ins: INPUT_FIRST.removeBg!, work: 'removeBg' }
  if (s.media === 'video') return { ins: INPUT_FIRST.video!, work: 'generateVideo' }
  if (s.media === 'audio') return { ins: INPUT_FIRST.audio!, work: 'generateAudio' }
  if (s.media === '3d') return { ins: INPUT_FIRST['3d']!, work: 'generate' }
  if (m.includes('edit') || m.includes('angle')) return { ins: INPUT_FIRST.edit!, work: 'generate' }
  return { ins: INPUT_FIRST.image!, work: 'generate' }
}

export function graphFor(s: Starter): { nodes: GraphNode[]; wires: [number, number][] } {
  const { ins, work } = shapeOf(s)
  const gap = 150
  const top = 200 - ((ins.length - 1) * gap) / 2
  const nodes: GraphNode[] = ins.map((kind, i) => ({
    kind,
    title: NODE_TYPES[kind].title,
    x: 120,
    y: top + i * gap
  }))
  nodes.push({ kind: work, title: s.model, x: 470, y: 200 })
  nodes.push({ kind: 'output', title: NODE_TYPES.output.title, x: 820, y: 200 })
  const w = nodes.length - 2
  const wires: [number, number][] = [...ins.map((_, i): [number, number] => [i, w]), [w, w + 1]]
  return { nodes, wires }
}

export interface Creator {
  name: string
  handle: string
}

const CREATORS: Creator[] = [
  { name: 'Comfy team', handle: 'comfy' },
  { name: 'Mira Okafor', handle: 'mira.o' },
  { name: 'Jun Takeda', handle: 'jun' },
  { name: 'Lena Brandt', handle: 'lenab' },
  { name: 'Theo Marchetti', handle: 'theo' }
]

const seedOf = (id: string): number => [...id].reduce((n, c) => n + c.charCodeAt(0), 0)
export const creatorOf = (id: string): Creator => CREATORS[seedOf(id) % CREATORS.length]!
export const runsOf = (id: string): string => {
  const n = 1200 + ((seedOf(id) * 97) % 14000)
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

export interface Output {
  id: string
  src: string
  clip?: string
  starter: Starter
  tall: boolean
}

const POPULAR_NAMES: Record<string, string> = {
  video_ltx2_3_i2v: 'Image to video',
  image_z_image_turbo: 'Text to image',
  image_qwen_image_2_1_image_edit: 'Edit an image',
  image_qwen_image_2_1_background_removal: 'Remove background',
  utility_seedvr2_7b_int8_upscale_image: 'Upscale an image',
  '3d_hunyuan3d-v2.1': 'Image to 3D model',
  'templates-1_click_multiple_character_angles-v1.0': 'Character from every angle'
}

export const OUTPUTS: Output[] = TEMPLATE_OUTPUTS.flatMap(([slot, id, clipSlot], i) => {
  const starter = starterById(id, POPULAR_NAMES[id], clipSlot)
  if (!starter) return []
  const video = clipSlot ? starter.clip : undefined
  return [
    {
      id: `${slot}-${i}`,
      src: clipSlot ? starter.poster : mock(slot),
      clip: video,
      starter,
      tall: [0, 2, 5, 7, 10, 13, 16, 19, 22].includes(i)
    }
  ]
})

const VIDEO_SLOTS = [
  'reeds',
  'waves',
  'dove',
  'smoke',
  'lake',
  'horse',
  'stone',
  'dunes',
  'barrel',
  'boxing'
]

export function startersFor(cases: HubUseCase[], max = 8, offset = 0): Starter[] {
  let v = offset
  return HUB_WORKFLOWS.filter((w) => cases.includes(w.useCase))
    .sort((a, b) => b.usage - a.usage)
    .slice(0, max)
    .map((w) =>
      starterOf(
        w,
        undefined,
        w.media === 'video' ? VIDEO_SLOTS[v++ % VIDEO_SLOTS.length] : undefined
      )
    )
}
