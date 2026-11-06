import bloomVideo from '../assets/banner-bloom.mp4'
import garden from '../assets/portrait-garden.jpg'
import sun from '../assets/portrait-sun.jpg'
import windowLight from '../assets/portrait-window.jpg'
import type { NodeRunState } from './runEngine'

/**
 * The Canvas mode's graph: a simpler layer over ComfyUI (Node Banana's
 * approach). Few node types, each showing its result on the node, its
 * controls hanging below, its sockets outside on the preview. One Generate
 * node per medium covers every model; a ComfyUI workflow collapses into one
 * node; a Pause node holds the pipeline so you can refine before it goes
 * on. The graph is live: nodes are added from the catalog, wired by their
 * typed sockets, grouped, and run.
 */

export type SocketType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO'

export const SOCKETS: Record<SocketType, string> = {
  TEXT: '#e8c07a',
  IMAGE: '#64b5f6',
  VIDEO: '#c79bf2',
  AUDIO: '#7fd1ae'
}

export interface Socket {
  name: string
  type: SocketType
}

/** A widget. `key` names its value in what a run is given. */
export type Control =
  | { kind: 'model'; key: string; value: string; options: { value: string; provider: string }[] }
  | { kind: 'combo'; key: string; name: string; value: string; options: string[] }
  | { kind: 'seg'; key: string; name: string; options: string[]; value: string }
  | { kind: 'slider'; key: string; name: string; value: number }
  | { kind: 'button'; key: string; label: string }

export type NodeKind =
  | 'prompt'
  | 'image'
  | 'video'
  | 'audio'
  | 'generate'
  | 'generateVideo'
  | 'generateAudio'
  | 'llm'
  | 'promptConstructor'
  | 'removeBg'
  | 'upscale'
  | 'workflow'
  | 'pause'
  | 'compare'
  | 'gallery'
  | 'output'

/** What a node shows as its result. */
export type Media = 'text' | 'image' | 'video' | 'audio' | 'compare' | 'gallery' | 'pause'

/** One result a node made, kept so earlier runs can be browsed (1 of N). */
export interface Result {
  src?: string
  text?: string
  /** The run that made it. */
  run: number
}

export interface SNode {
  id: string
  kind: NodeKind
  title: string
  /** A small tag beside the title, e.g. where a workflow comes from. */
  badge?: string
  x: number
  y: number
  w: number
  /** Height of the node's main element: its preview or its text. */
  body: number
  /** The prompt's or the constructor's template; a text node's result. */
  text?: string
  image?: string
  video?: string
  /** A picture with its background removed. */
  cutout?: boolean
  /** Compare: the two pictures side by side. */
  pair?: [string, string]
  chip?: string
  ins: Socket[]
  outs: Socket[]
  controls: Control[]
  /** What its progress says while it runs, e.g. "Relighting". */
  verb?: string
  /** Every result it made, oldest first, and the one on show. */
  history: Result[]
  pick: number
  /** Where the last run left it. */
  state?: NodeRunState
  step?: number
  steps?: number
  error?: string
  /** Its result no longer matches its inputs: they changed since. */
  stale?: boolean
  /** Bypassed: runs pass its input straight through. Muted: never runs. */
  mode?: 'bypass' | 'mute'
  /** Folded to its title bar. */
  collapsed?: boolean
  /** Its settings open under the result. Unset: open until it has made
   *  something, then folded so the result leads. */
  settings?: boolean
}

export interface Link {
  id: string
  from: string
  out: number
  to: string
  in: number
}

/** A frame around nodes; a locked group is skipped when the graph runs. */
export interface Group {
  id: string
  title: string
  x: number
  y: number
  w: number
  h: number
  locked: boolean
}

/** A node's rows, as ComfyUI's Vue nodes lay them out: the title bar,
 *  then the body's sections (slots, widgets, content) a gap apart. */
export interface CanvasGeometry {
  /** The title bar. */
  head: number
  /** One slot row: a typed input on the left, an output on the right. */
  slot: number
  /** One widget row. */
  control: number
  /** Between the body's sections and between widget rows. */
  gap: number
  /** Under the body's last section. */
  foot: number
}

const COMFY_ROWS: CanvasGeometry = { head: 32, slot: 20, control: 24, gap: 4, foot: 12 }
export const CANVAS_GEOMETRY: Record<'glass' | 'current', CanvasGeometry> = {
  glass: COMFY_ROWS,
  current: COMFY_ROWS
}

/** A collapsed node shrinks to its title. */
export const COLLAPSED_W = 180

// ── The catalog: every node you can add, grouped as Node Banana does. ──

export type Category = 'Input' | 'Generate' | 'Text' | 'Edit' | 'Flow' | 'Output'

interface NodeType {
  title: string
  category: Category
  description: string
  media: Media
  w: number
  body: number
  ins: Socket[]
  outs: Socket[]
  verb?: string
  badge?: string
  text?: string
  image?: string
  video?: string
  chip?: string
  controls: () => Control[]
}

const IMAGE_MODELS = [
  { value: 'Nano Banana Pro', provider: 'Gemini' },
  { value: 'Seedream 4', provider: 'ByteDance' },
  { value: 'Flux 1.1 Pro', provider: 'Black Forest Labs' },
  { value: 'GPT Image 1', provider: 'OpenAI' }
]

export const NODE_TYPES: Record<NodeKind, NodeType> = {
  prompt: {
    title: 'Prompt',
    category: 'Input',
    description: 'Text that steers a model',
    media: 'text',
    w: 250,
    body: 150,
    text: '',
    ins: [],
    outs: [{ name: 'text', type: 'TEXT' }],
    controls: () => []
  },
  image: {
    title: 'Image',
    category: 'Input',
    description: 'A picture from your files or assets',
    media: 'image',
    w: 250,
    body: 250,
    image: garden,
    chip: 'garden.jpg',
    ins: [],
    outs: [{ name: 'image', type: 'IMAGE' }],
    controls: () => []
  },
  video: {
    title: 'Video',
    category: 'Input',
    description: 'A clip to edit or extend',
    media: 'video',
    w: 300,
    body: 170,
    video: bloomVideo,
    chip: 'bloom.mp4',
    ins: [],
    outs: [{ name: 'video', type: 'VIDEO' }],
    controls: () => []
  },
  audio: {
    title: 'Audio',
    category: 'Input',
    description: 'A voice or a track',
    media: 'audio',
    w: 250,
    body: 84,
    chip: 'voice.wav',
    ins: [],
    outs: [{ name: 'audio', type: 'AUDIO' }],
    controls: () => []
  },
  generate: {
    title: 'Generate Image',
    category: 'Generate',
    description: 'Any image model, from a prompt and references',
    media: 'image',
    verb: 'Generating',
    w: 290,
    body: 332,
    ins: [
      { name: 'prompt', type: 'TEXT' },
      { name: 'image', type: 'IMAGE' }
    ],
    outs: [{ name: 'image', type: 'IMAGE' }],
    controls: () => [
      { kind: 'model', key: 'model', value: 'Nano Banana Pro', options: IMAGE_MODELS },
      { kind: 'seg', key: 'aspect', name: 'Aspect', options: ['1:1', '4:5', '16:9'], value: '4:5' },
      {
        kind: 'combo',
        key: 'resolution',
        name: 'Resolution',
        value: '1K',
        options: ['1K', '2K', '4K']
      },
      { kind: 'combo', key: 'seed', name: 'Seed', value: 'Random', options: ['Random', 'Fixed'] }
    ]
  },
  generateVideo: {
    title: 'Generate Video',
    category: 'Generate',
    description: 'Image or text to video',
    media: 'video',
    verb: 'Rendering',
    w: 320,
    body: 180,
    ins: [
      { name: 'prompt', type: 'TEXT' },
      { name: 'first frame', type: 'IMAGE' }
    ],
    outs: [{ name: 'video', type: 'VIDEO' }],
    controls: () => [
      {
        kind: 'model',
        key: 'model',
        value: 'Seedance 1 Pro',
        options: [
          { value: 'Seedance 1 Pro', provider: 'ByteDance' },
          { value: 'Kling 2.1', provider: 'Kuaishou' },
          { value: 'Veo 3', provider: 'Google' }
        ]
      },
      { kind: 'seg', key: 'duration', name: 'Duration', options: ['5 s', '10 s'], value: '5 s' },
      {
        kind: 'seg',
        key: 'aspect',
        name: 'Aspect',
        options: ['16:9', '9:16', '1:1'],
        value: '16:9'
      }
    ]
  },
  generateAudio: {
    title: 'Generate Audio',
    category: 'Generate',
    description: 'Speech, music or sound from text',
    media: 'audio',
    verb: 'Generating',
    w: 270,
    body: 84,
    ins: [{ name: 'text', type: 'TEXT' }],
    outs: [{ name: 'audio', type: 'AUDIO' }],
    controls: () => [
      {
        kind: 'model',
        key: 'model',
        value: 'Eleven v3',
        options: [
          { value: 'Eleven v3', provider: 'ElevenLabs' },
          { value: 'Stable Audio 2', provider: 'Stability' }
        ]
      },
      {
        kind: 'combo',
        key: 'voice',
        name: 'Voice',
        value: 'Aria',
        options: ['Aria', 'Roger', 'Sky']
      }
    ]
  },
  llm: {
    title: 'Generate Text',
    category: 'Text',
    description: 'An LLM writes or describes',
    media: 'text',
    verb: 'Writing',
    w: 270,
    body: 150,
    ins: [
      { name: 'text', type: 'TEXT' },
      { name: 'image', type: 'IMAGE' }
    ],
    outs: [{ name: 'text', type: 'TEXT' }],
    controls: () => [
      {
        kind: 'model',
        key: 'model',
        value: 'Gemini 2.5 Flash',
        options: [
          { value: 'Gemini 2.5 Flash', provider: 'Google' },
          { value: 'Claude Sonnet', provider: 'Anthropic' },
          { value: 'GPT-5 mini', provider: 'OpenAI' }
        ]
      },
      {
        kind: 'seg',
        key: 'task',
        name: 'Task',
        options: ['Expand', 'Describe', 'Shorten'],
        value: 'Expand'
      },
      { kind: 'slider', key: 'temperature', name: 'Temperature', value: 0.7 }
    ]
  },
  promptConstructor: {
    title: 'Prompt Constructor',
    category: 'Text',
    description: 'A template filled with @variables',
    media: 'text',
    w: 270,
    body: 130,
    text: 'Slow dolly around @subject, @style',
    ins: [
      { name: 'subject', type: 'TEXT' },
      { name: 'style', type: 'TEXT' }
    ],
    outs: [{ name: 'text', type: 'TEXT' }],
    controls: () => []
  },
  removeBg: {
    title: 'Remove Background',
    category: 'Edit',
    description: 'Cut the subject out',
    media: 'image',
    verb: 'Cutting out',
    w: 250,
    body: 282,
    ins: [{ name: 'image', type: 'IMAGE' }],
    outs: [{ name: 'image', type: 'IMAGE' }],
    controls: () => [
      {
        kind: 'combo',
        key: 'model',
        name: 'Model',
        value: 'BiRefNet',
        options: ['BiRefNet', 'RMBG 2.0']
      }
    ]
  },
  upscale: {
    title: 'Upscale',
    category: 'Edit',
    description: 'More pixels, sharper detail',
    media: 'image',
    verb: 'Upscaling',
    w: 250,
    body: 282,
    ins: [{ name: 'image', type: 'IMAGE' }],
    outs: [{ name: 'image', type: 'IMAGE' }],
    controls: () => [
      { kind: 'seg', key: 'scale', name: 'Scale', options: ['2×', '4×'], value: '2×' }
    ]
  },
  workflow: {
    title: 'Relight',
    category: 'Edit',
    description: 'A ComfyUI workflow as one node',
    badge: 'Workflow',
    media: 'image',
    verb: 'Relighting',
    w: 290,
    body: 332,
    ins: [{ name: 'image', type: 'IMAGE' }],
    outs: [{ name: 'image', type: 'IMAGE' }],
    controls: () => [
      {
        kind: 'combo',
        key: 'runsOn',
        name: 'Runs on',
        value: 'Comfy Cloud',
        options: ['Comfy Cloud', 'This computer']
      },
      {
        kind: 'combo',
        key: 'light',
        name: 'Light',
        value: 'Window, left',
        options: ['Window, left', 'Window, right', 'Golden hour', 'Studio softbox']
      },
      { kind: 'slider', key: 'intensity', name: 'Intensity', value: 0.6 }
    ]
  },
  pause: {
    title: 'Pause',
    category: 'Flow',
    description: 'Hold the run so you can refine',
    media: 'pause',
    w: 220,
    body: 58,
    ins: [{ name: 'image', type: 'IMAGE' }],
    outs: [{ name: 'image', type: 'IMAGE' }],
    controls: () => []
  },
  compare: {
    title: 'Compare',
    category: 'Output',
    description: 'Two pictures, one slider',
    media: 'compare',
    w: 300,
    body: 375,
    ins: [
      { name: 'before', type: 'IMAGE' },
      { name: 'after', type: 'IMAGE' }
    ],
    outs: [],
    controls: () => []
  },
  gallery: {
    title: 'Gallery',
    category: 'Output',
    description: 'Every result that reaches it',
    media: 'gallery',
    w: 300,
    body: 240,
    ins: [{ name: 'image', type: 'IMAGE' }],
    outs: [],
    controls: () => []
  },
  output: {
    title: 'Output',
    category: 'Output',
    description: 'The result, ready to keep',
    media: 'image',
    w: 270,
    body: 308,
    ins: [{ name: 'image', type: 'IMAGE' }],
    outs: [],
    controls: () => [
      {
        kind: 'combo',
        key: 'format',
        name: 'Format',
        value: 'PNG',
        options: ['PNG', 'JPEG', 'WebP']
      },
      { kind: 'button', key: 'save', label: 'Save to Assets' }
    ]
  }
}

/** A workflow the agent builds: nodes placed relative to each other. */
export interface Recipe {
  nodes: { key: string; kind: NodeKind; dx: number; dy: number; text?: string }[]
  /** [from key, output, to key, input] */
  links: [string, number, string, number][]
}

export const CATEGORIES: Category[] = ['Input', 'Generate', 'Text', 'Edit', 'Flow', 'Output']

export const mediaOf = (n: SNode): Media => NODE_TYPES[n.kind].media

let seq = 0
export const uid = (p: string): string => `${p}-${Date.now().toString(36)}-${++seq}`

export function createNode(kind: NodeKind, x: number, y: number, id = uid(kind)): SNode {
  const t = NODE_TYPES[kind]
  return {
    id,
    kind,
    title: t.title,
    badge: t.badge,
    x,
    y,
    w: t.w,
    body: t.body,
    text: t.text,
    image: t.image,
    video: t.video,
    chip: t.chip,
    verb: t.verb,
    ins: t.ins.map((s) => ({ ...s })),
    outs: t.outs.map((s) => ({ ...s })),
    controls: t.controls(),
    history: [],
    pick: 0
  }
}

/** The graph a workflow opens with: a portrait, relit. */
export function createCanvas(): { nodes: SNode[]; links: Link[]; groups: Group[] } {
  const prompt = createNode('prompt', 40, 60, 'prompt')
  prompt.text =
    'Portrait of a woman in late sun, hand on her cheek, soft window light, 85 mm, warm film tones'
  const ref = createNode('image', 40, 300, 'ref')
  ref.title = 'Reference'
  const gen = createNode('generate', 420, 60, 'gen')
  gen.title = 'Generate'
  gen.image = sun
  gen.chip = '4:5 · 1K'
  const pause = createNode('pause', 830, 60, 'pause')
  const relight = createNode('workflow', 1120, 60, 'relight')
  relight.image = sun
  const out = createNode('output', 1540, 60, 'out')
  out.image = windowLight
  out.chip = 'Last run'
  const link = (from: string, to: string, inp = 0): Link => ({
    id: `${from}>${to}:${inp}`,
    from,
    out: 0,
    to,
    in: inp
  })
  return {
    nodes: [prompt, ref, gen, pause, relight, out],
    links: [
      link('prompt', 'gen'),
      link('ref', 'gen', 1),
      link('gen', 'pause'),
      link('pause', 'relight'),
      link('relight', 'out')
    ],
    groups: []
  }
}

/** A file input (image, video, audio) shows its file as a widget row. */
export const hasFileRow = (n: SNode): boolean =>
  n.kind === 'image' || n.kind === 'video' || n.kind === 'audio'

export const slotsHeight = (n: SNode, g: CanvasGeometry): number =>
  Math.max(n.ins.length, n.outs.length) * g.slot

export function controlsHeight(n: SNode, g: CanvasGeometry): number {
  const c = n.controls.length + (hasFileRow(n) ? 1 : 0)
  return c ? c * g.control + (c - 1) * g.gap : 0
}

// ── Output first (Willie Falloon's node in Node Banana): once a node has
// made something, its result is the node; its settings fold into one row
// under it, the model and its values, and open on a click. Before the
// first run they stay open over an empty preview. ──

/** It made a result: a run left one, or it opens with one. */
export const hasResult = (n: SNode): boolean =>
  n.history.length > 0 || (n.ins.length > 0 && !!(n.image || n.video))

/** A node with settings shows them under its result. A button is an
 *  action, not a setting: it stays out of the fold. */
export const hasSettings = (n: SNode): boolean => n.controls.some((c) => c.kind !== 'button')

const rows = (count: number, g: CanvasGeometry): number =>
  count ? count * g.control + (count - 1) * g.gap : 0

export const settingsOpen = (n: SNode): boolean => n.settings ?? !hasResult(n)

/** Earlier results, stepped through in a row under the preview. */
export const hasCycler = (n: SNode): boolean =>
  n.history.length > 1 && (mediaOf(n) === 'image' || mediaOf(n) === 'video')

export function canvasNodeHeight(n: SNode, g: CanvasGeometry): number {
  if (n.collapsed) return g.head
  const fields = n.controls.filter((c) => c.kind !== 'button').length
  const actions = n.controls.length - fields
  const settings = hasSettings(n)
    ? g.control +
      (settingsOpen(n) ? g.gap + rows(fields, g) : 0) +
      (actions ? g.gap + rows(actions, g) : 0)
    : controlsHeight(n, g)
  const cycler = hasCycler(n) ? g.control : 0
  const parts = [slotsHeight(n, g), n.body, cycler, settings].filter((h) => h > 0)
  const inner = parts.reduce((a, h) => a + h, 0) + (parts.length - 1) * g.gap
  return g.head + g.gap + inner + g.foot
}

export const nodeWidth = (n: SNode): number => (n.collapsed ? Math.min(COLLAPSED_W, n.w) : n.w)

/** Slots sit at the top of the body, their dots on the node's edges; a
 *  collapsed node gathers them on its title bar. */
export const socketY = (n: SNode, i: number, g: CanvasGeometry): number =>
  n.collapsed ? n.y + g.head / 2 : n.y + g.head + g.gap + i * g.slot + g.slot / 2
