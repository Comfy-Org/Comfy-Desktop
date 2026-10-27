import { computed, reactive, watch } from 'vue'
import { go, goIn, proto, toast } from './useProto'
import { BRAND_KITS, newTheme, THEMES, themeFromWords, type AppTheme } from './appTheme'

/**
 * Comfy Apps (Milestone 10, the Agent lens): how a creator turns a workflow
 * into an app that other people run from a link. Concept A: apps are a
 * library (My apps · Shared with me), and each app has one page and one
 * URL; its share settings decide what each person can do there.
 *
 * The creator journey is one conversation with the agent: each step is a
 * card in the thread (workflow, inputs, layout, try it, publish, share).
 *
 * Agents prepare. People publish: access and money always need a click.
 */

/** How the creator customizes the app's look (the Prototype menu's
 *  "Customize" switch): an inspector panel, curated themes, brand kits
 *  first, or describing it to the agent. */
export type LookVariant = 'panel' | 'themes' | 'brand' | 'describe'

const KEY = 'comfy.design.apps'
const saved = ((): {
  look?: LookVariant
  tabs?: string[]
  front?: string
  preview?: Record<string, PreviewAs>
} => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
})()

export const appsProto = reactive({
  look: (saved.look ?? 'panel') as LookVariant,
  /** Apps open in tabs in the title bar (app ids), and the one in front
   *  ('' = the launcher or a build is in front). */
  tabs: (saved.tabs ?? []) as string[],
  front: saved.front ?? '',
  /** Tabs the creator is previewing as someone else (app id -> who). */
  preview: (saved.preview ?? {}) as Record<string, PreviewAs>
})
watch(
  () => appsProto,
  (s) => sessionStorage.setItem(KEY, JSON.stringify(s)),
  { deep: true }
)

// --- Workflows a creator can start from ------------------------------------

export interface SourceWorkflow {
  name: string
  thumbId: string
  nodes: number
  settings: number
  model: string
  lastRun: string
}

export const SOURCES: SourceWorkflow[] = [
  {
    name: 'product-relight-studio',
    thumbId: 'template_product_placement',
    nodes: 9,
    settings: 31,
    model: 'Flux 2 dev',
    lastRun: '2 days ago'
  },
  {
    name: 'packshot-clean',
    thumbId: 'api_google_nano_banana2_image_edit',
    nodes: 6,
    settings: 18,
    model: 'Nano Banana 2',
    lastRun: 'Last week'
  },
  {
    name: 'seasonal-scenes',
    thumbId: 'image_flux2',
    nodes: 11,
    settings: 40,
    model: 'Flux 2 dev',
    lastRun: 'Sep 30'
  },
  {
    name: 'spin-video',
    thumbId: 'video_ltx2_5_i2v',
    nodes: 8,
    settings: 27,
    model: 'LTX 2.5',
    lastRun: 'Sep 12'
  }
]

// --- Apps --------------------------------------------------------------------

export type FieldKind = 'image' | 'text' | 'choice' | 'count'
export interface Field {
  id: string
  label: string
  kind: FieldKind
  /** Where it comes from in the graph. */
  node: string
  /** Shown to people, or locked to its value. */
  on: boolean
  options?: string[]
  placeholder?: string
}

export interface Person {
  name: string
  email: string
  role: 'Owner' | 'Can edit' | 'Can run'
}

export interface Run {
  who: string
  when: string
  cost: number
  paidBy: string
}

/** How the app looks: inputs left, inputs right, or a prompt bar at the
 *  bottom with the result in the center (like an agent's composer). */
export type AppLayout = 'left' | 'right' | 'bottom'
export type LayoutChoice = AppLayout | 'custom'
export const LAYOUTS: { id: AppLayout; label: string; hint: string }[] = [
  { id: 'left', label: 'Inputs left', hint: 'A panel of inputs, results on the right' },
  { id: 'right', label: 'Inputs right', hint: 'Results first, the panel on the right' },
  { id: 'bottom', label: 'Prompt bar', hint: 'Results in the center, inputs in a bar below' }
]
export const layoutLabel = (id: AppLayout): string => LAYOUTS.find((l) => l.id === id)!.label

export interface LibApp {
  id: string
  name: string
  blurb: string
  thumbId: string
  owner: string
  group: 'yours' | 'team' | 'shared'
  state: 'draft' | 'live'
  /** The whole workspace can run it (team credits pay). */
  team: boolean
  /** Anyone with the link can run it. */
  link: boolean
  people: Person[]
  /** Who pays when people outside the team run it. */
  payer: 'each' | 'you'
  freeRuns: number
  cap: number
  spent: number
  noAccount: boolean
  /** Dollars per run, at cost. */
  cost: number
  runs: number
  updated: string
  version: number
  unpublished: boolean
  fields: Field[]
  layout: AppLayout
  /** How it looks to the people who use it (appTheme.ts). */
  theme: AppTheme
  slug: string
  history: Run[]
}

/** The rest of the workflow's settings: locked unless the creator adds
 *  them. A real workflow has dozens; the agent shows the top few. */
const LOCKED: [string, string][] = [
  ['Seed', 'KSampler #8'],
  ['Steps', 'KSampler #8'],
  ['CFG', 'KSampler #8'],
  ['Sampler', 'KSampler #8'],
  ['Scheduler', 'KSampler #8'],
  ['Denoise', 'KSampler #8'],
  ['Negative prompt', 'Prompt #7'],
  ['Width', 'Empty Latent #5'],
  ['Height', 'Empty Latent #5'],
  ['LoRA strength', 'Relight LoRA #4'],
  ['LoRA clip strength', 'Relight LoRA #4'],
  ['Model', 'Load Checkpoint #1'],
  ['VAE', 'Load VAE #2'],
  ['CLIP', 'Dual CLIP Loader #11'],
  ['Guidance', 'Flux Guidance #13'],
  ['Max shift', 'Model Sampling #14'],
  ['Base shift', 'Model Sampling #14'],
  ['Upscale method', 'Upscale #15'],
  ['Upscale by', 'Upscale #15'],
  ['Crop', 'Image Crop #16'],
  ['Mask blur', 'Mask #17'],
  ['Mask expand', 'Mask #17'],
  ['Background color', 'Composite #18'],
  ['Shadow strength', 'Composite #18'],
  ['File prefix', 'Save Image #9'],
  ['Format', 'Save Image #9'],
  ['Preview', 'Preview #10']
]

const relightFields = (): Field[] => [
  { id: 'photo', label: 'Product photo', kind: 'image', node: 'Load Image #12', on: true },
  {
    id: 'light',
    label: 'Light',
    kind: 'choice',
    node: 'Relight LoRA #4',
    on: true,
    options: ['Softbox', 'Golden hour', 'Hard noon']
  },
  {
    id: 'scene',
    label: 'Scene',
    kind: 'text',
    node: 'Prompt #6',
    on: true,
    placeholder: 'On a marble counter, morning light'
  },
  {
    id: 'count',
    label: 'Images',
    kind: 'count',
    node: 'Batch size #3',
    on: true,
    options: ['1', '2', '4']
  },
  ...LOCKED.map(
    ([label, node], i): Field => ({
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `s${i}`,
      label,
      kind: 'text',
      node,
      on: false
    })
  )
]
const simpleFields = (what: string): Field[] => [
  { id: 'photo', label: what, kind: 'image', node: 'Load Image #1', on: true },
  {
    id: 'scene',
    label: 'Describe it',
    kind: 'text',
    node: 'Prompt #2',
    on: true,
    placeholder: 'Optional'
  }
]
const RUNS: Run[] = [
  { who: 'Jane Park', when: '12 min ago', cost: 0.04, paidBy: 'Team credits' },
  { who: 'sam@northwind.co', when: '1 h ago', cost: 0.04, paidBy: 'sam@northwind.co' },
  { who: 'Marcus Lin', when: '3 h ago', cost: 0.08, paidBy: 'Team credits' },
  { who: 'lea@atelier.fr', when: 'Yesterday', cost: 0.04, paidBy: 'You (free run)' }
]

const base = (a: Partial<LibApp> & Pick<LibApp, 'id' | 'name' | 'thumbId'>): LibApp => ({
  blurb: '',
  owner: 'You',
  group: 'yours',
  state: 'live',
  team: false,
  link: false,
  people: [],
  payer: 'each',
  freeRuns: 0,
  cap: 20,
  spent: 0,
  noAccount: false,
  cost: 0.04,
  runs: 0,
  updated: 'Just now',
  version: 1,
  unpublished: false,
  fields: simpleFields('Image'),
  layout: 'left',
  theme: newTheme(),
  slug: a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  history: [],
  ...a
})

export const LIB = reactive<LibApp[]>([
  base({
    id: 'relight',
    name: 'Product relight',
    blurb: 'Drop a product photo, pick a light. Get studio shots.',
    thumbId: 'template_product_placement',
    team: true,
    link: true,
    people: [{ name: 'Sam Ortiz', email: 'sam@northwind.co', role: 'Can run' }],
    payer: 'you',
    freeRuns: 3,
    cap: 20,
    spent: 4.2,
    runs: 1284,
    updated: 'Sep 30',
    version: 4,
    fields: relightFields(),
    // Silverside's brand kit, with presets and its own button words.
    theme: newTheme({
      ...BRAND_KITS[0]!.theme,
      kit: 'silverside',
      runLabel: 'Relight it',
      presets: true
    }),
    history: RUNS
  }),
  base({
    id: 'angles',
    name: 'Character angles',
    blurb: 'One character, eight angles.',
    thumbId: 'image_qwen_image_edit_2511',
    state: 'draft',
    updated: 'Sep 4',
    fields: simpleFields('Character')
  }),
  base({
    id: 'upscale',
    name: '4K upscaler',
    blurb: 'Any render to clean 4K.',
    thumbId: 'utility_seedvr2_image_upscale',
    team: true,
    runs: 2210,
    cost: 0.02,
    updated: 'Aug 13',
    version: 2,
    unpublished: true,
    fields: simpleFields('Render'),
    history: RUNS.slice(0, 2)
  }),
  base({
    id: 'poster',
    name: 'Poster resizer',
    blurb: 'One poster, every format.',
    thumbId: 'templates_graphic_design_recomposer',
    owner: 'Jane Park',
    group: 'team',
    team: true,
    runs: 640,
    updated: 'Sep 2',
    fields: simpleFields('Poster')
  }),
  base({
    id: 'i2v',
    name: 'Photo to video',
    blurb: 'A still becomes a 5 s clip.',
    thumbId: 'video_ltx2_5_i2v',
    owner: 'Marcus Lin',
    group: 'team',
    team: true,
    cost: 0.31,
    layout: 'right',
    theme: newTheme(THEMES.find((t) => t.id === 'playful')!.theme),
    runs: 412,
    updated: 'Aug 28',
    fields: simpleFields('Photo')
  }),
  base({
    id: 'prop3d',
    name: 'Image to 3D prop',
    blurb: 'A photo of a prop, as a 3D model.',
    thumbId: '3d_pixal3d_trellis2_image_to_model',
    owner: 'Alex Carmoid · Studio Atlas',
    group: 'shared',
    link: true,
    cost: 0.12,
    layout: 'bottom',
    theme: newTheme(THEMES.find((t) => t.id === 'gallery')!.theme),
    runs: 158,
    updated: 'Aug 2',
    fields: simpleFields('Prop photo')
  })
])

export const libApp = (id: string): LibApp | undefined => LIB.find((a) => a.id === id)

/** Who can use it, in one phrase. */
export function accessLabel(a: LibApp): string {
  if (a.link) return 'Anyone with the link'
  if (a.people.length) return a.team ? 'Your team + invited' : 'Invited people'
  if (a.team) return 'Your team'
  return 'Only you'
}
export type AccessKey = 'only-you' | 'team' | 'people' | 'link'
export function accessKey(a: LibApp): AccessKey {
  if (a.link) return 'link'
  if (a.people.length) return 'people'
  return a.team ? 'team' : 'only-you'
}

/** Who pays, in one phrase (creator's view). */
export function payerLabel(a: LibApp): string {
  if (a.state === 'draft') return '—'
  if (!a.link && !a.people.length) return a.team ? 'Team credits' : 'You'
  if (a.payer === 'you') return `You · ${a.freeRuns} free runs`
  return a.team ? 'Team · each outsider' : 'Each person'
}

export const usd = (n: number): string => `$${n.toFixed(2)}`

// --- The creator journey (scripted agent) -----------------------------------

export type Stage =
  | 'idle'
  | 'workflow'
  | 'layout'
  | 'inputs'
  | 'look'
  | 'preview'
  | 'publish'
  | 'live'

export interface Msg {
  id: number
  role: 'user' | 'agent'
  text: string
  steps?: string[]
  shown?: number
  pending?: boolean
  artifact?: Exclude<Stage, 'idle'>
}

export interface Draft {
  name: string
  blurb: string
  thumbId: string
  source: SourceWorkflow
  /** Built by the agent from a prompt (vs. an existing workflow). */
  fresh: boolean
  fields: Field[]
  cost: number
  layout: AppLayout
  theme: AppTheme
  /** A custom layout, as the creator described it ('' = a preset). */
  customLayout: string
  /** The curated theme picked last (Themes), if any. */
  themeId: string
  /** The agent's last description of the look, if any. */
  described: string
}

export const flow = reactive({
  stage: 'idle' as Stage,
  messages: [] as Msg[],
  draft: null as Draft | null,
  /** Who can use it, picked at publish. */
  access: 'only-you' as Exclude<AccessKey, 'people'>,
  /** Publish checks revealed so far; -1 = not publishing. */
  checks: -1,
  appId: '',
  busy: false,
  /** Waiting for the creator to describe a custom layout. */
  describingLayout: false,
  /** In app-builder mode, the creator closed the sidebar (more room). */
  sidebarClosed: false,
  /** From "Create an app" on, the app shows on the right as it is built. */
  split: false,
  /** How many inputs the agent has added so far (the app on the right
   *  grows while the agent picks them). */
  fieldsShown: 99
})

export const CHECKS = (d: Draft): string[] => [
  `${d.source.nodes} nodes are on Comfy Cloud`,
  `${d.source.model} and the relight LoRA are on Comfy Cloud`,
  'Example run passed · 18 s · $0.04'
]

let nextId = 1
const say = (m: Omit<Msg, 'id'>): Msg => {
  flow.messages.push({ id: nextId++, ...m })
  return flow.messages[flow.messages.length - 1]!
}

/** Reveal the agent's steps one by one, then finish. */
function think(m: Msg, done: () => void, pace = 450): void {
  flow.busy = true
  m.shown = 0
  const tick = (): void => {
    if ((m.shown ?? 0) < (m.steps?.length ?? 0)) {
      m.shown = (m.shown ?? 0) + 1
      setTimeout(tick, pace)
    } else {
      m.pending = false
      flow.busy = false
      done()
    }
  }
  setTimeout(tick, 300)
}

export function resetFlow(): void {
  flow.stage = 'idle'
  flow.messages = []
  flow.draft = null
  flow.access = 'only-you'
  flow.checks = -1
  flow.appId = ''
  flow.busy = false
  flow.split = false
  flow.describingLayout = false
  flow.fieldsShown = 99
}

function open(): void {
  proto.mode = 'agent'
  go('agent')
}

/** Start from a sentence: the agent builds the workflow first. */
export function startNew(prompt: string): void {
  resetFlow()
  open()
  say({ role: 'user', text: prompt })
  const source: SourceWorkflow = { ...SOURCES[0]!, name: 'product-lifestyle', lastRun: 'Just now' }
  const m = say({
    role: 'agent',
    text: 'I built **product-lifestyle** and ran it once. It works. Open it in ComfyUI, or make it an app.',
    steps: [
      'Searched 214 templates and your workflows',
      'Picked Flux 2 dev with the relight LoRA',
      'Wired 9 nodes',
      'Test run on Comfy Cloud · 14 s'
    ],
    artifact: 'workflow',
    pending: true
  })
  think(m, () => {
    flow.draft = draftFrom(source, true)
    flow.stage = 'workflow'
  })
}

/** Start from a workflow you already trust. */
export function startFrom(source: SourceWorkflow): void {
  resetFlow()
  open()
  say({ role: 'user', text: `Make an app from ${source.name}` })
  const m = say({
    role: 'agent',
    text: `I read **${source.name}**. Your graph stays as it is. I only choose what people can change.`,
    steps: [
      `Read ${source.nodes} nodes and ${source.settings} settings`,
      'Found 1 output: Save Image'
    ],
    artifact: 'workflow',
    pending: true
  })
  think(m, () => {
    flow.draft = draftFrom(source, false)
    flow.stage = 'workflow'
  })
}

/** From a workflow card elsewhere in the launcher. */
export function startFromName(name: string, thumbId: string): void {
  const known = SOURCES.find((s) => s.name === name)
  startFrom(known ?? { ...SOURCES[0]!, name, thumbId, lastRun: 'Recently' })
}

function draftFrom(source: SourceWorkflow, fresh: boolean): Draft {
  return {
    name: 'Studio relight',
    blurb: 'Drop a product photo, pick a light. Get a studio shot.',
    thumbId: source.thumbId,
    source,
    fresh,
    fields: relightFields(),
    cost: 0.04,
    layout: 'left',
    theme: newTheme({ runLabel: 'Relight it', presets: true }),
    customLayout: '',
    themeId: 'studio',
    described: ''
  }
}

/** Layout first: the app appears on the right, in the picked layout. */
function askLayout(): void {
  flow.split = true
  const m = say({
    role: 'agent',
    text: '**Pick a layout.** The app on the right shows it. You can change it later.',
    steps: ['Read 1 output: Save Image', 'Made a first version'],
    artifact: 'layout',
    pending: true
  })
  think(m, () => (flow.stage = 'layout'))
}

/** App-builder mode: the sidebar closes and the app opens beside the
 *  chat. Exit keeps the chat and the draft; you can come back to it. */
export function exitBuilder(): void {
  flow.split = false
}
export function enterBuilder(): void {
  if (flow.draft && flow.stage !== 'workflow') flow.split = true
}
/** In app-builder mode the sidebar stays open; the creator can close it
 *  for more room (and open it again). */
export const building = computed(
  () => flow.split && flow.sidebarClosed && proto.mode === 'agent' && proto.page === 'agent'
)
export function toggleSidebar(): void {
  flow.sidebarClosed = !flow.sidebarClosed
}

/** A preset layout from the app's header: it replaces a custom one. */
export function setLayout(id: AppLayout): void {
  const d = flow.draft
  if (!d) return
  d.layout = id
  d.customLayout = ''
  flow.describingLayout = false
}
/** Custom layout: the agent asks for it in words. Like the look, the
 *  result is built from Comfy's own parts (no creator code on the page). */
export function askCustomLayout(): void {
  if (!flow.draft || flow.busy) return
  flow.describingLayout = true
  say({
    role: 'agent',
    text: '**Describe the layout.** For example: “a big result on top, the photo and the light picker side by side under it”.'
  })
}
function describeLayout(text: string): void {
  const d = flow.draft!
  const low = text.toLowerCase()
  d.layout = /bottom|bar|chat|composer|under|below/.test(low)
    ? 'bottom'
    : /right/.test(low)
      ? 'right'
      : 'left'
  d.customLayout = text
  flow.describingLayout = false
  const m = say({
    role: 'agent',
    text: 'Done. I laid it out as you described, with Comfy’s own parts. See the app on the right.',
    steps: ['Read your description', 'Placed the inputs and the result'],
    pending: true
  })
  // The first time, it moves on to the inputs, like a preset pick.
  think(m, () => flow.stage === 'layout' && proposeInputs())
}

/** Pick a layout, then the inputs. */
export function chooseLayout(id: AppLayout): void {
  const d = flow.draft
  if (!d || flow.busy) return
  d.layout = id
  d.customLayout = ''
  // Later, a pick just changes the layout; the first time, it moves on.
  if (flow.stage !== 'layout') return
  say({ role: 'user', text: layoutLabel(id) })
  proposeInputs()
}

/** Inputs: what people change, in plain words. The rest stays locked.
 *  They appear on the app one by one as the agent picks them. */
function proposeInputs(): void {
  const d = flow.draft!
  const m = say({
    role: 'agent',
    text: `People change **4 things**. The other ${d.source.settings - 4} settings stay locked. Check or uncheck any of them and watch the app.`,
    steps: [
      'Picked the settings people need',
      'Named them in plain words',
      'Set limits from each node’s range',
      'Turned the LoRA strength into 3 light presets'
    ],
    artifact: 'inputs',
    pending: true
  })
  flow.fieldsShown = 0
  const grow = (): void => {
    if (flow.fieldsShown >= 4) return
    flow.fieldsShown++
    setTimeout(grow, 450)
  }
  setTimeout(grow, 400)
  think(m, () => {
    flow.fieldsShown = 99
    flow.stage = 'inputs'
  })
}

/** The look: brand, colors, type. Offered in the thread as a card (its
 *  content depends on the Prototype menu's "Customize"); skippable. */
function askLook(): void {
  const m = say({
    role: 'agent',
    text: '**Now the look.** Pick a brand, colors and type, or skip it. You can change anything later, here or by asking me.',
    artifact: 'look',
    pending: true,
    steps: []
  })
  think(m, () => (flow.stage = 'look'), 200)
}

/** "Describe it": anything goes in the words; the look always lands
 *  inside the guardrails (Comfy's own parts, readable contrast). */
export function describeLook(text: string): void {
  const d = flow.draft
  if (!d) return
  const { theme, layout } = themeFromWords(text, d.theme)
  d.theme = theme
  if (layout) d.layout = layout
  d.described = text
  const m = say({
    role: 'agent',
    text: 'Done. Look at the app on the right. Say more, or adjust it above.',
    steps: ['Read your description', 'Matched it to Comfy’s styles', 'Checked contrast and sizes'],
    pending: true
  })
  think(m, () => {})
}

/** The look is set (or skipped): try the app. */
export function finishLook(skipped = false): void {
  if (!flow.draft || flow.busy) return
  if (flow.stage !== 'look') return
  say({ role: 'user', text: skipped ? 'Skip the look' : 'The look is done' })
  tryIt()
}

/** Try it: Cloud checks and one example run. */
function tryIt(): void {
  const m = say({
    role: 'agent',
    text: 'I ran the example on Comfy Cloud. Try it on the right. Each run costs about **$0.04**.',
    steps: [
      'All 9 nodes are on Comfy Cloud',
      'Uploaded the relight LoRA from My Local 1',
      'Example run · 18 s · $0.04'
    ],
    artifact: 'preview',
    pending: true
  })
  think(m, () => (flow.stage = 'preview'))
}

function askPublish(): void {
  const m = say({
    role: 'agent',
    text: 'Ready. **Who can use it?** You choose. I never share an app or spend your credits without your click.',
    artifact: 'publish',
    pending: true,
    steps: []
  })
  think(m, () => (flow.stage = 'publish'), 200)
}

/** Next step of the journey (a button, a suggestion, or "Next"). */
export function next(): void {
  if (flow.busy) return
  switch (flow.stage) {
    case 'workflow':
      return askLayout()
    case 'inputs':
      return askLook()
    case 'preview':
      return askPublish()
    default:
  }
}

/** Publish: the checks run, then the app is live with one link. */
export function publish(onLive?: (id: string) => void): void {
  const d = flow.draft
  if (!d || flow.checks >= 0) return
  flow.checks = 0
  flow.busy = true
  say({
    role: 'user',
    text: `Publish for ${ACCESS_OPTIONS.find((o) => o.value === flow.access)!.label.toLowerCase()}`
  })
  const tick = (): void => {
    if (flow.checks < CHECKS(d).length) {
      flow.checks++
      setTimeout(tick, 650)
      return
    }
    const id = `app-${Date.now()}`
    LIB.unshift(
      base({
        id,
        name: d.name,
        blurb: d.blurb,
        thumbId: d.thumbId,
        team: flow.access !== 'only-you',
        link: flow.access === 'link',
        fields: d.fields,
        layout: d.layout,
        theme: { ...d.theme },
        cost: d.cost,
        slug: d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      })
    )
    flow.appId = id
    flow.stage = 'live'
    flow.busy = false
    say({
      role: 'agent',
      text: `**${d.name}** is live. ${
        flow.access === 'link'
          ? 'Anyone with the link can run it. Each person pays for their own runs.'
          : flow.access === 'team'
            ? 'Everyone in your team can run it. Team credits pay.'
            : 'Only you can run it for now. Share it when you are ready.'
      }`,
      artifact: 'live'
    })
    onLive?.(id)
  }
  setTimeout(tick, 300)
}

export const ACCESS_OPTIONS: {
  value: Exclude<AccessKey, 'people'>
  label: string
  hint: string
}[] = [
  { value: 'only-you', label: 'Only you', hint: 'Try it on Comfy Cloud before anyone else' },
  { value: 'team', label: 'Your team', hint: 'Everyone in Silverside · team credits pay' },
  { value: 'link', label: 'Anyone with the link', hint: 'People sign in to run · each person pays' }
]

/** Free text in the composer: small edits, or the next step. */
/** Free text: the agent changes whatever you ask, at any step - layout,
 *  inputs, the look, the name - and the app on the right follows. When
 *  it is not a change, it moves the first pass on. */
export function send(text: string): void {
  const t = text.trim()
  if (!t || flow.busy) return
  if (flow.stage === 'idle') return startNew(t)
  say({ role: 'user', text: t })
  const d = flow.draft
  if (!d) return next()
  if (flow.describingLayout) return describeLayout(t)
  const low = t.toLowerCase()
  const done: string[] = []

  if (/rename|call it|name it/.test(low)) {
    const name = t
      .split(/rename (?:it )?to|call it|name it/i)[1]
      ?.replace(/["“”]/g, '')
      .trim()
    if (name) {
      d.name = name.charAt(0).toUpperCase() + name.slice(1)
      done.push(`renamed it to **${d.name}**`)
    }
  }
  const layout: AppLayout | undefined = /prompt bar|bottom|chat style/.test(low)
    ? 'bottom'
    : /inputs? (on the )?right|panel right/.test(low)
      ? 'right'
      : /inputs? (on the )?left|panel left/.test(low)
        ? 'left'
        : undefined
  if (layout && layout !== d.layout) {
    d.layout = layout
    done.push(`switched to **${layoutLabel(layout).toLowerCase()}**`)
  }
  for (const f of d.fields) {
    const name = f.label.toLowerCase()
    if (!low.includes(name) && !low.includes(f.id)) continue
    const off = /remove|hide|lock|without|drop/.test(low)
    if (f.on === !off) continue
    f.on = !off
    done.push(`${off ? 'locked' : 'added'} **${f.label}**`)
  }
  if (
    flow.stage === 'look' ||
    /brand|kit|light|dark|color|colour|font|serif|bold|button says|rounded|sharp|playful|editorial|cover/.test(
      low
    )
  ) {
    const before = JSON.stringify(d.theme)
    const { theme } = themeFromWords(t, d.theme)
    if (JSON.stringify(theme) !== before) {
      d.theme = theme
      d.described = t
      done.push('changed the **look**')
    }
  }

  if (done.length) {
    const list = done.join(', ')
    say({
      role: 'agent',
      text: `${list.charAt(0).toUpperCase()}${list.slice(1)}. See the app on the right.`
    })
    return
  }
  if (/publish|share|ship|live/.test(low) && ['inputs', 'look', 'preview'].includes(flow.stage))
    return askPublish()
  if (flow.stage === 'look') return finishLook()
  next()
}

export function suggestions(): string[] {
  switch (flow.stage) {
    case 'inputs':
      return ['Also let people change the seed']
    case 'look':
      return ['Make it light and editorial', 'Use the Nike brand kit']
    case 'preview':
      return ['Publish it', 'Rename it to Packshot light']
    default:
      return []
  }
}

/** The live app's page, in Create. */
export function openApp(id: string): void {
  goIn('create', `app:${id}`)
}

// --- Dialogs, shared by every view -------------------------------------------

export const dialogs = reactive({
  /** Publish sheet for the agent's draft. */
  publish: false,
  /** App id whose Share sheet is open. */
  share: '',
  /** Start from a workflow (picker). */
  pick: false
})

export function copyLink(a: LibApp): void {
  toast(`Copied comfy.org/a/${a.slug}`)
}

/** Open app: the app's URL in its own tab, full screen, signed in as
 *  you. Several apps can be open, one per tab. */
export function openAppUrl(id: string): void {
  if (!appsProto.tabs.includes(id)) appsProto.tabs.push(id)
  appsProto.front = id
  delete appsProto.preview[id]
}
/** Close an app's tab; if it was in front, its neighbour comes forward
 *  (or the launcher). */
export function closeAppTab(id: string): void {
  const i = appsProto.tabs.indexOf(id)
  if (i < 0) return
  appsProto.tabs.splice(i, 1)
  delete appsProto.preview[id]
  if (appsProto.front === id) appsProto.front = appsProto.tabs[i] ?? appsProto.tabs[i - 1] ?? ''
}

/**
 * There is no "visitor": one URL, and the share settings decide what each
 * person can do there. To check that, the creator previews the page as
 * someone else, like "Preview as viewer" in Google Docs.
 */
export type PreviewAs = 'link' | 'teammate' | 'outsider' | 'expired'
export const PREVIEWS: { id: PreviewAs; label: string; hint: string }[] = [
  { id: 'link', label: 'Someone with the link', hint: 'Signed out · signs in to run' },
  { id: 'teammate', label: 'A teammate', hint: 'Jane Park, in Silverside' },
  { id: 'outsider', label: 'Someone without access', hint: 'Signed in, not on the list' },
  { id: 'expired', label: 'Someone with an old link', hint: 'Revoked, expired or over the cap' }
]
export const previewLabel = (as: PreviewAs): string =>
  PREVIEWS.find((p) => p.id === as)!
    .label.replace(/^Someone/, 'someone')
    .replace(/^A /, 'a ')
export function previewAs(id: string, as: PreviewAs): void {
  openAppUrl(id)
  appsProto.preview[id] = as
}
export function exitPreview(id: string): void {
  delete appsProto.preview[id]
}
