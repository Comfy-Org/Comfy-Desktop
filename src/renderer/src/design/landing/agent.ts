import { reactive } from 'vue'
import { deployTool, GPU_OPTIONS, REGION_OPTIONS, SPACES } from './spaces'
import { proto } from './useProto'
import { APPS } from './mock'
import { resetFlow, startNew } from './appFlow'

/**
 * The agent: one conversation that takes you from an idea to a tool your
 * spaces can use. It can
 *   1. build a workflow,
 *   2. turn one or more workflows into an app,
 *   3. deploy it and put it in spaces - only after you approve the plan.
 * Scripted for the prototype: intent comes from keywords in the message.
 */

export type Stage = 'output' | 'workflow' | 'layout' | 'layout-custom' | 'app' | 'deploy' | 'live'

/** How an app looks to the people using it. */
export type LayoutId = 'form' | 'canvas' | 'steps' | 'custom'
export const LAYOUTS: { id: Exclude<LayoutId, 'custom'>; label: string; hint: string }[] = [
  { id: 'form', label: 'Form + result', hint: 'Inputs on the left, results on the right' },
  { id: 'canvas', label: 'Canvas', hint: 'Big result, one prompt bar and quick options' },
  { id: 'steps', label: 'Step by step', hint: 'One question at a time, then generate' }
]
export const layoutLabel = (id: LayoutId | null, custom = ''): string =>
  id === 'custom' ? custom || 'Custom' : (LAYOUTS.find((l) => l.id === id)?.label ?? '')

export interface AgentWorkflow {
  name: string
  thumbId: string
  nodes: number
  model: string
}

export interface AppInput {
  label: string
  kind: 'image' | 'text' | 'select' | 'toggle' | 'number'
  from: string
}

export interface AgentMessage {
  id: number
  role: 'user' | 'agent'
  text: string
  /** Tool calls the agent made, shown as a checklist. */
  steps?: string[]
  /** How many steps are revealed so far (animates the thinking). */
  shown?: number
  artifact?: Stage
  /** Generated results shown inline (output tasks). */
  outputs?: string[]
  pending?: boolean
}

export const WORKFLOW_LIBRARY: AgentWorkflow[] = [
  {
    name: 'product-relight-studio',
    thumbId: 'template_product_placement~product-relight-studio',
    nodes: 9,
    model: 'Flux 2 dev'
  },
  {
    name: 'packshot-clean',
    thumbId: 'api_google_nano_banana2_image_edit~packshot-clean',
    nodes: 6,
    model: 'Nano Banana 2'
  },
  {
    name: 'seasonal-scenes',
    thumbId: 'image_flux2~seasonal-scenes',
    nodes: 11,
    model: 'Flux 2 dev'
  },
  { name: 'spin-video', thumbId: 'video_ltx2_5_i2v~spin-video', nodes: 8, model: 'LTX 2.5' }
]

export const agent = reactive({
  messages: [] as AgentMessage[],
  stage: null as Stage | null,
  /** The workflow the agent built. */
  workflow: null as AgentWorkflow | null,
  /** The app: a name plus the workflows it's built from. */
  app: null as {
    name: string
    sources: AgentWorkflow[]
    inputs: AppInput[]
    layout: LayoutId
    /** Custom layout, as the person described it. */
    custom: string
  } | null,
  /** Workflows waiting for a layout before the app is made. */
  pendingSources: [] as AgentWorkflow[],
  /** Deploy plan: spaces to put it in. */
  spaceIds: [] as string[],
  deployed: [] as string[],
  busy: false
})

let nextId = 1
const say = (m: Omit<AgentMessage, 'id'>): AgentMessage => {
  agent.messages.push({ id: nextId++, ...m })
  return agent.messages[agent.messages.length - 1]!
}

export function resetAgent(): void {
  agent.messages = []
  agent.stage = null
  agent.workflow = null
  agent.app = null
  agent.pendingSources = []
  agent.spaceIds = []
  agent.deployed = []
  agent.busy = false
}

function inputsFor(sources: AgentWorkflow[]): AppInput[] {
  const first = sources[0]?.name ?? 'workflow'
  const out: AppInput[] = [
    { label: 'Product photo', kind: 'image', from: first },
    { label: 'Scene', kind: 'select', from: first },
    { label: 'Describe the shot', kind: 'text', from: first }
  ]
  if (sources.some((s) => s.name === 'packshot-clean'))
    out.push({ label: 'Clean background first', kind: 'toggle', from: 'packshot-clean' })
  if (sources.some((s) => s.name === 'spin-video'))
    out.push({ label: 'Also make a 5 s spin video', kind: 'toggle', from: 'spin-video' })
  out.push({ label: 'Images', kind: 'number', from: 'app' })
  return out
}

/** Reveal the agent's steps one by one, then finish the message. */
function think(m: AgentMessage, done: () => void): void {
  agent.busy = true
  m.shown = 0
  const tick = (): void => {
    if ((m.shown ?? 0) < (m.steps?.length ?? 0)) {
      m.shown = (m.shown ?? 0) + 1
      setTimeout(tick, 420)
    } else {
      m.pending = false
      agent.busy = false
      done()
    }
  }
  setTimeout(tick, 350)
}

function buildWorkflow(): void {
  const wf = WORKFLOW_LIBRARY[0]!
  const m = say({
    role: 'agent',
    text: `Built **${wf.name}**. Test run passed.`,
    steps: [
      'Searched 214 templates and your workflows',
      'Picked Flux 2 dev with the relight LoRA',
      'Wired 9 nodes and exposed the inputs',
      'Test run on My Local 1 · 14 s'
    ],
    artifact: 'workflow',
    pending: true
  })
  think(m, () => {
    agent.workflow = wf
    agent.stage = 'workflow'
  })
}

function buildApp(text: string): void {
  if (!agent.workflow) agent.workflow = WORKFLOW_LIBRARY[0]!
  // Keep what the app already has; add any workflow named in the message.
  const sources = [...(agent.app?.sources ?? [agent.workflow])]
  for (const w of WORKFLOW_LIBRARY.slice(1)) {
    const key = w.name.split('-')[0]!
    if (text.toLowerCase().includes(key) && !sources.includes(w)) sources.push(w)
  }
  // An existing app keeps its layout; a new one asks for it first.
  if (agent.app) makeApp(sources, agent.app.layout, agent.app.custom)
  else askLayout(sources)
}

/** Ask how the app should look: three layouts, or describe your own. */
export function askLayout(sources = agent.app?.sources ?? agent.pendingSources): void {
  agent.pendingSources = sources
  const m = say({
    role: 'agent',
    text: 'Pick a layout.',
    steps: [`Read inputs from ${sources.map((s) => s.name).join(' + ')}`],
    artifact: 'layout',
    pending: true
  })
  think(m, () => (agent.stage = 'layout'))
}

/** Pick a layout from the picker. Custom asks for a description. */
export function chooseLayout(id: LayoutId): void {
  if (agent.busy) return
  if (id === 'custom') {
    say({ role: 'user', text: 'Custom layout' })
    say({
      role: 'agent',
      text: 'Describe the layout - for example "big preview on top, three style presets as cards below, generate button at the bottom".'
    })
    agent.stage = 'layout-custom'
    return
  }
  say({ role: 'user', text: `Use the ${layoutLabel(id)} layout` })
  makeApp(agent.pendingSources, id, '')
}

function makeApp(sources: AgentWorkflow[], layout: LayoutId, custom: string): void {
  const many = sources.length > 1
  const m = say({
    role: 'agent',
    text: 'Made **Product studio**.',
    steps: [
      'Picked the inputs people should control, locked the rest',
      ...(many ? ['Chained the workflows: output of one feeds the next'] : []),
      layout === 'custom' ? 'Laid out the screen from your description' : 'Applied the layout',
      'Generated a preview'
    ],
    artifact: 'app',
    pending: true
  })
  think(m, () => {
    agent.app = { name: 'Product studio', sources, inputs: inputsFor(sources), layout, custom }
    agent.stage = 'app'
    if (!APPS.some((a) => a.name === 'Product studio')) {
      APPS.unshift({
        id: 'a-agent-studio',
        name: 'Product studio',
        thumbId: sources[0]!.thumbId,
        owner: 'You',
        you: true,
        shared: 'private',
        updated: 'Just now',
        runs: 0,
        envId: 'cloud'
      })
    }
  })
}

function planDeploy(text: string): void {
  if (!agent.app) {
    buildApp(text)
    return
  }
  const named = SPACES.filter((s) =>
    [s.name, s.brand.logo.name].some((n) =>
      text.toLowerCase().includes(n.toLowerCase().split(' ')[0]!)
    )
  ).map((s) => s.id)
  agent.spaceIds = named.length ? named : ['northwind']
  const m = say({
    role: 'agent',
    text: 'Ready to deploy - approve to go live.',
    steps: ['Checked GPU needs: 24 GB', 'Checked the spaces you can publish to'],
    artifact: 'deploy',
    pending: true
  })
  think(m, () => (agent.stage = 'deploy'))
}

/** Approve the plan: deploy the app and put it in the picked spaces. */
export function approveDeploy(): void {
  if (!agent.app || !agent.spaceIds.length) return
  deployTool(
    { kind: 'app', name: agent.app.name, thumbId: agent.app.sources[0]!.thumbId },
    agent.spaceIds,
    {
      flavor: 'app',
      gpu: GPU_OPTIONS[0]!.value,
      region: REGION_OPTIONS[0]!.value,
      warm: false,
      version: null
    }
  )
  agent.deployed = [...agent.spaceIds]
  agent.stage = 'live'
  say({ role: 'user', text: 'Approve' })
  say({
    role: 'agent',
    text: `**Product studio** is live in ${agent.deployed.length} ${agent.deployed.length === 1 ? 'space' : 'spaces'}, on its own endpoint.`,
    artifact: 'live'
  })
}

/** Handle a message: keywords pick the next step. */
export function send(text: string): void {
  const t = text.trim()
  if (!t || agent.busy) return
  say({ role: 'user', text: t })
  const low = t.toLowerCase()
  // Waiting for a custom layout description.
  if (agent.stage === 'layout-custom') {
    makeApp(agent.pendingSources, 'custom', t)
    return
  }
  if (/deploy|space|publish|ship|live/.test(low)) planDeploy(low)
  else if (/\bapp\b|form|combine|chain/.test(low)) buildApp(low)
  else if (/more|variation|option|again/.test(low)) generateOutput()
  else buildWorkflow()
}

/** Suggested next steps under the latest agent message. */
export function suggestions(): string[] {
  switch (agent.stage) {
    case 'output':
      return ['Make 4 more like the second one', 'Turn this into a workflow I can call as an API']
    case 'workflow':
      return [
        'Create an app from this',
        'Combine it with packshot-clean into one app',
        'Change the model to Flux 2 pro'
      ]
    case 'app':
      return [
        'Deploy it to Nike',
        'Deploy to Nike and Coca-Cola',
        'Add the spin video workflow to the app'
      ]
    case 'live':
      return ['Make another workflow']
    default:
      return []
  }
}

/** Start from the Home prompt box. */
/** A task the agent can run from a starter card or the prompt box. */
export type Intent = 'output' | 'workflow'

/** Generate results right away: a few options, shown inline. */
function generateOutput(attachment?: string): void {
  const m = say({
    role: 'agent',
    text: 'Here are 4 options.',
    steps: [
      attachment ? 'Read your image' : 'Read your prompt',
      'Built a workflow: Flux 2 dev + relight LoRA',
      'Running on Comfy Cloud · 4 images',
      'Done in 11 s · 24 credits'
    ],
    artifact: 'output',
    pending: true
  })
  think(m, () => {
    m.outputs = [
      attachment ?? 'template_product_placement',
      'image_flux2',
      'image_z_image_turbo',
      'image_krea2_turbo_t2i'
    ]
    agent.workflow = WORKFLOW_LIBRARY[0]!
    agent.stage = 'output'
  })
}

/** Run a task in the full-screen agent. */
export function runTask(prompt: string, intent: Intent, attachment?: string): void {
  resetAgent()
  resetFlow()
  proto.mode = 'agent'
  proto.page = 'agent'
  say({ role: 'user', text: prompt })
  if (intent === 'output') generateOutput(attachment)
  else buildWorkflow()
}

export function startAgent(prompt: string): void {
  resetAgent()
  // Milestone 10: the agent makes an app from the sentence.
  startNew(prompt)
}
