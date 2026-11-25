import { reactive, watch } from 'vue'
import type { ProtoInstance, Template } from '../../mock'
import { modelsFor, templateAbout, templateById, templateStats, type ModelReq } from '../../fit'
import { hubById, hubTemplate, workflowThumb, type HubWorkflow } from '../explore/hubWorkflows'
import { can } from '../../milestones'
import heroAngles from './angles-hero.jpg'
import inputAngles from './angles-input.jpg'
import outputAngles from './angles-output.jpg'
import { isDownloaded } from '../autorun/installed'

/**
 * Mock data behind Mar's template modal. The fields mirror ComfyUI's
 * template index (title, description, tags, models, date, license, vram,
 * openSource); the "where it runs" logic is a richer mock than fit.ts so
 * every picker state can show: running, ready, needs download, not enough
 * memory, Cloud-only, logged out and offline.
 */

/** This computer, shared by every local build. */
export const MACHINE = { name: 'This Mac', chip: 'Apple M3 Max', memGb: 36, diskFreeGb: 18.4 }

/** Prototype-only switches for the states that need a world change. */
export const tplMock = reactive({ offline: false })

export type WfCase = 'catalog' | 'update' | 'nodes' | 'several' | 'offline'

/** UI Playground › Workflow case: what every workflow asks of the builds. */
export const WF_CASES: { value: WfCase; label: string }[] = [
  { value: 'catalog', label: 'As the catalog says' },
  { value: 'update', label: 'Needs a newer ComfyUI' },
  { value: 'nodes', label: 'Needs a node pack' },
  { value: 'several', label: 'Needs both' },
  { value: 'offline', label: 'Offline' }
]

export const tplCase = reactive<{ id: WfCase }>({ id: 'catalog' })
watch(
  () => tplCase.id,
  (id) => (tplMock.offline = id === 'offline'),
  { immediate: true }
)

/** The Hub's angles workflow: Mar's contact sheet and its graph. */
export const ANGLES_ID = 'template_qwen_multiangle.app'

export type CantRun =
  | 'models'
  | 'nodes'
  | 'update'
  | 'modelsNodes'
  | 'updateNodes'
  | 'memory'
  | 'disk'
  | 'stopped'
  | 'repair'
  | 'platform'
  | 'offline'
  | 'signIn'
  | 'credits'
  | 'plan'
  | 'partner'
  | 'gated'
  | 'media'
  | 'cloudNodes'

export interface CantRunCase {
  id: CantRun
  label: string
  template: string
  build: string
  packs?: string[]
  installedOn?: string[]
}

export const CANT_RUN_CASES: CantRunCase[] = [
  { id: 'models', label: 'Models missing', template: 'image_moss_image_t2i', build: 'local-1' },
  {
    id: 'nodes',
    label: 'Node packs missing',
    template: 'template_purz_wan22_animate_auto_character_replace',
    build: 'local-video',
    packs: ['ComfyUI-WanAnimatePreprocess', 'ComfyUI-KJNodes'],
    installedOn: ['local-video']
  },
  {
    id: 'update',
    label: 'Needs a newer ComfyUI',
    template: 'image_qwen_image_2_1_image_edit',
    build: 'local-1'
  },
  {
    id: 'modelsNodes',
    label: 'Models and node packs missing',
    template: 'templates-wan2_1_infinitetalk_music',
    build: 'local-video',
    packs: ['ComfyUI-WanVideoWrapper', 'ComfyUI-MelBandRoFormer']
  },
  {
    id: 'updateNodes',
    label: 'Newer ComfyUI and node packs',
    template: ANGLES_ID,
    build: 'local-1'
  },
  {
    id: 'memory',
    label: 'Not enough GPU memory',
    template: 'video_minimax_h3_t2v',
    build: 'local-video',
    installedOn: ['local-video']
  },
  {
    id: 'disk',
    label: 'Not enough disk space',
    template: 'video_ltx2_5_t2v',
    build: 'local-1'
  },
  {
    id: 'stopped',
    label: 'Build stopped',
    template: 'utility_seedvr2_image_upscale',
    build: 'local-flux'
  },
  {
    id: 'repair',
    label: 'Build needs a repair',
    template: 'image_krea2_turbo_t2i',
    build: 'local-1'
  },
  {
    id: 'platform',
    label: 'GPU not supported',
    template: 'utility_nvidia_rtx_video_enhance',
    build: 'cloud'
  },
  { id: 'offline', label: 'Offline', template: 'audio_ace_step1_5_xl_turbo', build: 'local-1' },
  { id: 'signIn', label: 'Needs a Comfy account', template: 'api_nano_banana_pro', build: 'cloud' },
  {
    id: 'credits',
    label: 'Out of credits',
    template: 'api_seedance2_5_i2v_1080p',
    build: 'cloud'
  },
  {
    id: 'plan',
    label: 'Needs a Cloud plan',
    template: 'video_ltx2_3_ia2v',
    build: 'cloud'
  },
  {
    id: 'partner',
    label: 'Partner model, Cloud only',
    template: 'api_elevenlabs_v4_text_to_speech',
    build: 'cloud'
  },
  {
    id: 'gated',
    label: 'Model licence to accept',
    template: 'image_flux2',
    build: 'local-1'
  },
  {
    id: 'media',
    label: 'Input image missing',
    template: 'image_qwen_image_2_1_background_removal',
    build: 'local-video',
    installedOn: ['local-video']
  },
  {
    id: 'cloudNodes',
    label: 'Node pack not on Cloud',
    template: 'templates_hellorob_facegen_skindetail_upscale',
    build: 'cloud',
    packs: ['ComfyUI-SkinDetailer'],
    installedOn: ['local-1']
  }
]

const CASE_BY_TEMPLATE = new Map(CANT_RUN_CASES.map((c) => [c.template, c]))

export function caseFor(t: Template): CantRunCase | undefined {
  if (!can.value.onboarding) return undefined
  const c = CASE_BY_TEMPLATE.get(t.id)
  return c && tplById(t.id)?.title === t.title ? c : undefined
}

const caseIs = (t: Template, ...ids: CantRun[]): boolean => {
  const c = caseFor(t)
  return Boolean(c && ids.includes(c.id))
}

const legacyCase = (): WfCase => (can.value.onboarding ? 'catalog' : tplCase.id)

export const isOffline = (t: Template): boolean =>
  can.value.onboarding ? caseIs(t, 'offline') : tplMock.offline

const NOT_ON_CLOUD = new Set(
  CANT_RUN_CASES.filter((c) => c.id === 'cloudNodes').flatMap((c) => c.packs ?? [])
)

export const GATED_LICENCE = 'FLUX.2 [dev]'
export const MISSING_INPUT = 'portrait.png'
const RUN_CREDITS = 12

export interface TplMedia {
  hero: string
  /** Graph previews: the image going in and the one coming out. */
  input?: string
  output: string
  /** Labels over a contact-sheet hero, clockwise from top left. */
  quadrants?: string[]
}

/** A workflow by id: the Hub's (real), else the prototype's mock. */
const APP_TEMPLATES = new Map<string, Template>()

export function tplById(id: string): Template | undefined {
  const h = hubById(id)
  return h ? hubTemplate(h) : (templateById(id) ?? APP_TEMPLATES.get(id))
}

const MEDIA: Record<string, TplMedia> = {
  [ANGLES_ID]: {
    hero: heroAngles,
    input: inputAngles,
    output: outputAngles,
    quadrants: ['Front', '¾ left', 'Top down', 'Low angle']
  }
}

export function mediaFor(t: Template): TplMedia {
  const pic = workflowThumb(t.id)
  return MEDIA[t.id] ?? { hero: pic, output: pic }
}

/** Loaders the graph uses beyond fit.ts's main weights. */
const EXTRA_MODELS: Record<string, ModelReq[]> = {
  [ANGLES_ID]: [{ name: 'qwen_image_vae.safetensors', size: '254 MB', gb: 0.25 }]
}

/** The angles workflow loads 2511's weights. */
const SAME_MODELS: Record<string, string> = { [ANGLES_ID]: 'image_qwen_image_edit_2511' }

export function addAppTemplate(t: Template, sameModelsAs: string, pic?: string): void {
  APP_TEMPLATES.set(t.id, t)
  if (pic) MEDIA[t.id] = { hero: pic, output: pic }
  SAME_MODELS[t.id] = sameModelsAs
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_$/, '')

/** A Hub workflow's download, split the way a graph usually loads it:
 *  the main weights, a text encoder and a VAE. */
function filesFor(w: HubWorkflow): ModelReq[] {
  const gb = w.sizeGb
  if (!gb) return []
  const base = slug(w.family)
  if (gb < 2) return [{ name: `${base}.safetensors`, size: fmtGb(gb), gb }]
  const enc = Math.round(gb * 0.28 * 10) / 10
  const vae = Math.min(0.3, Math.round(gb * 0.02 * 100) / 100)
  const main = Math.round((gb - enc - vae) * 10) / 10
  return [
    { name: `${base}_fp8.safetensors`, size: fmtGb(main), gb: main },
    { name: `${base}_text_encoder.safetensors`, size: fmtGb(enc), gb: enc },
    { name: `${base}_vae.safetensors`, size: fmtGb(vae), gb: vae }
  ]
}

export function needsFor(t: Template): ModelReq[] {
  const known = modelsFor({ ...t, id: SAME_MODELS[t.id] ?? t.id })
  const h = hubById(t.id)
  const main = known.length || !h ? known : filesFor(h)
  return [...main, ...(EXTRA_MODELS[t.id] ?? [])]
}

export const totalGb = (t: Template): number => needsFor(t).reduce((n, m) => n + m.gb, 0)

export const fmtGb = (gb: number): string =>
  gb < 1 ? `${Math.round(gb * 1000)} MB` : `${gb.toFixed(1)} GB`

/** What it does: the catalog's own description. */
export function aboutFor(t: Template): string[] {
  const h = hubById(t.id)
  return h ? [h.description] : templateAbout(t)
}

const LICENSE: Record<string, string> = {
  image_qwen_image_edit_2511: 'Apache 2.0',
  image_z_image_turbo: 'Apache 2.0',
  image_flux2: 'FLUX.2 Dev non-commercial',
  video_wan2_2_14B_i2v: 'Apache 2.0',
  video_ltx2_5_i2v: 'LTX-2 Community'
}

export interface TplInfo {
  uses: string
  /** The model family, as Filter names it. */
  model?: string
  tutorial?: string
  likes: number
  added: string
  tags: string[]
  license: string
  vramGb?: number
  useCase: string
}

export function infoFor(t: Template): TplInfo {
  const s = templateStats(t)
  const [y, m, d] = s.added.split('-').map(Number)
  const added = new Date(y!, m! - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
  const h = hubById(t.id)
  return {
    ...s,
    added,
    uses: h ? h.usage.toLocaleString('en-US') : s.uses,
    model: h?.family,
    tutorial: h?.tutorial,
    license: t.runs === 'cloud' ? 'Partner API' : (LICENSE[t.id] ?? 'Open source'),
    vramGb: t.vram ? parseInt(t.vram) : undefined,
    useCase:
      h?.useCase ??
      (t.category === '3d' ? '3D' : t.category[0]!.toUpperCase() + t.category.slice(1))
  }
}

/** Which templates each local build already has every model for. */
const INSTALLED: Record<string, string[]> = {
  'local-1': [
    'image_z_image_turbo',
    'image_qwen_image_edit_2511',
    ANGLES_ID,
    'image_krea2_turbo_t2i',
    'image_qwen_image_2_1_image_edit',
    'image_qwen_image_2_1_t2i'
  ],
  'local-video': [
    'video_ltx2_5_i2v',
    'video_wan2_2_14B_i2v',
    'video_minimax_h3_i2v',
    'video_ltx2_3_i2v'
  ],
  'local-flux': [
    'image_flux2',
    'utility_seedvr2_image_upscale',
    'utility_seedvr2_7b_int8_upscale_image'
  ],
  'team-build': ['templates_graphic_design_recomposer']
}

/** Saved workflows whose build lost their models since they were saved
 *  (moved or deleted files): the modal says so before it opens. */
export const SAVED_MISSING_MODELS = new Set(['krea-street'])

/** The ComfyUI each workflow needs, when newer than every build's. */
const MIN_COMFY: Record<string, string> = {
  [ANGLES_ID]: 'v0.38.0'
}

/** The node packs each workflow loads beyond ComfyUI's own nodes. */
const PACKS: Record<string, string[]> = {
  [ANGLES_ID]: ['ComfyUI-KJNodes', 'rgthree-comfy'],
  video_wan2_2_14B_i2v: ['ComfyUI-VideoHelperSuite'],
  video_ltx2_5_i2v: ['ComfyUI-VideoHelperSuite']
}

/** The node packs each local build has installed. */
const INSTALLED_PACKS: Record<string, string[]> = {
  'local-1': ['rgthree-comfy', 'ComfyUI-VideoHelperSuite'],
  'local-video': ['rgthree-comfy'],
  'local-flux': [],
  'team-build': ['rgthree-comfy', 'ComfyUI-KJNodes']
}

const CASE_VERSION = 'v0.38.0'
const CASE_PACK = 'ComfyUI-KJNodes'

export const minComfyFor = (t: Template): string =>
  legacyCase() === 'update' || legacyCase() === 'several' || caseIs(t, 'update')
    ? CASE_VERSION
    : (MIN_COMFY[t.id] ?? '')

export function packsFor(t: Template): string[] {
  const own = caseFor(t)?.packs ?? PACKS[t.id] ?? []
  const add = legacyCase() === 'nodes' || legacyCase() === 'several'
  return add && !own.includes(CASE_PACK) ? [...own, CASE_PACK] : own
}

export const hasPack = (inst: ProtoInstance, pack: string): boolean =>
  inst.kind === 'cloud'
    ? !(can.value.onboarding && NOT_ON_CLOUD.has(pack))
    : Boolean(INSTALLED_PACKS[inst.id]?.includes(pack))

function hasModels(t: Template, inst: ProtoInstance): boolean {
  if (isDownloaded(t.id, inst.id)) return true
  if (caseIs(t, 'gated')) return false
  const c = caseFor(t)
  return Boolean(INSTALLED[inst.id]?.includes(t.id) || c?.installedOn?.includes(inst.id))
}

const parts = (v: string): number[] => v.replace(/^v/, '').split('-')[0]!.split('.').map(Number)

/** The ComfyUI version this build is short of, or '' when it is new enough. */
export function versionShort(t: Template, inst: ProtoInstance): string {
  const need = minComfyFor(t)
  if (!need || !inst.version) return ''
  const a = parts(inst.version)
  const b = parts(need)
  for (let i = 0; i < b.length; i++) {
    if ((a[i] ?? 0) > b[i]!) return ''
    if ((a[i] ?? 0) < b[i]!) return need
  }
  return ''
}

export type TargetState =
  | 'running'
  | 'ready'
  | 'update'
  | 'nodes'
  | 'new'
  | 'cloud'
  | 'download'
  | 'memory'
  | 'login'
  | 'blocked'
  | 'offline'
  | 'repair'
  | 'disk'
  | 'gated'
  | 'platform'
  | 'credits'
  | 'plan'
  | 'media'

export interface Target {
  inst: ProtoInstance
  state: TargetState
  /** One line under the name: what is true of this build right now. */
  status: string
  /** Right-aligned: what choosing it costs. */
  cost: string
  /** The primary button's label when this is picked. */
  action: string
  /** One line above the button: what happens next. */
  note: string
  disabled: boolean
  /** The models still have to download on this build. */
  fetch?: boolean
}

const credits = (t: Template): number => Math.max(4, Math.round(totalGb(t) * 0.7))

export function targetFor(
  t: Template,
  inst: ProtoInstance,
  signedIn: boolean,
  modelsGone = false
): Target {
  const base = { inst, disabled: false }
  const gb = totalGb(t)
  const kase = caseFor(t)?.id
  if (inst.kind === 'cloud') {
    if (isOffline(t))
      return {
        ...base,
        state: 'offline',
        status: "You're offline",
        cost: '',
        action: 'Run on Comfy Cloud',
        note: 'Comfy Cloud needs a connection.',
        disabled: true
      }
    if (!signedIn || kase === 'signIn')
      return {
        ...base,
        state: 'login',
        status: 'Log in to use',
        cost: '',
        action: 'Log in to Comfy Cloud',
        note:
          kase === 'signIn'
            ? 'Partner models need a Comfy account. New accounts get free credits.'
            : 'New accounts get free credits.'
      }
    if (t.runs === 'local')
      return {
        ...base,
        state: 'blocked',
        status: 'Not on Cloud yet',
        cost: '',
        action: '',
        note: '',
        disabled: true
      }
    if (kase === 'cloudNodes')
      return {
        ...base,
        state: 'blocked',
        status: inst.deployment
          ? 'Its node pack isn’t on this build'
          : 'Its node pack isn’t on Cloud yet',
        cost: '',
        action: '',
        note: '',
        disabled: true
      }
    const c = t.runs === 'cloud' ? RUN_CREDITS : credits(t)
    if (kase === 'credits' && !inst.deployment)
      return {
        ...base,
        state: 'credits',
        status: 'Out of credits · 0 left',
        cost: `${c} credits`,
        action: 'Add credits',
        note: 'Add credits to your account to run it. Then it opens on Comfy Cloud.'
      }
    if (kase === 'plan' && !inst.deployment)
      return {
        ...base,
        state: 'plan',
        status: 'Free plan · can’t run workflows',
        cost: `${c} credits`,
        action: 'See plans',
        note: 'Subscribe to a plan to run workflows on Comfy Cloud.'
      }
    if (inst.deployment) {
      const awake = inst.state === 'running'
      return {
        ...base,
        state: 'cloud',
        status: awake ? `Running · ${inst.gpu}` : `Asleep · wakes in about 40 s`,
        cost: `${c} credits`,
        action: `Open in ${inst.name}`,
        note: awake ? '' : `Wakes ${inst.name} first, about 40 s.`
      }
    }
    return {
      ...base,
      state: 'cloud',
      status: 'Every model ready',
      cost: `${c} credits`,
      action: 'Run on Comfy Cloud',
      // The price is on the row; nothing else to say.
      note: ''
    }
  }
  if (t.runs === 'cloud')
    return {
      ...base,
      state: 'blocked',
      status: 'Partner model · Cloud only',
      cost: '',
      action: '',
      note: '',
      disabled: true
    }
  if (kase === 'platform')
    return {
      ...base,
      state: 'platform',
      status: 'Needs an NVIDIA GPU',
      cost: '',
      action: '',
      note: '',
      disabled: true
    }
  const vram = t.vram ? parseInt(t.vram) : 0
  // Nothing to download (built-in nodes only): every build has it.
  const has = (!modelsGone && hasModels(t, inst)) || !needsFor(t).length
  if (vram > MACHINE.memGb)
    return {
      ...base,
      state: 'memory',
      status: `Only ${MACHINE.memGb} of ${vram} GB memory`,
      cost: has ? 'May fail' : fmtGb(gb),
      action: 'Start anyway',
      note: `It may run out of memory. Smaller sizes help, or run it on Cloud.`
    }
  if (!has && isOffline(t))
    return {
      ...base,
      state: 'offline',
      status: `Offline · can’t download ${fmtGb(gb)}`,
      cost: fmtGb(gb),
      action: 'Download and start',
      note: 'Its models download from the internet. Connect, then try again.',
      disabled: true
    }
  if (kase === 'repair' && inst.id === caseFor(t)?.build)
    return {
      ...base,
      state: 'repair',
      status: 'Didn’t start last time · needs a repair',
      cost: '',
      action: 'Repair and start',
      note: `Repairs ${inst.name}'s Python environment, starts it, then opens this graph.`
    }
  if (!has && kase === 'disk')
    return {
      ...base,
      state: 'disk',
      status: `Needs ${fmtGb(gb)} · ${fmtGb(MACHINE.diskFreeGb)} free`,
      cost: fmtGb(gb),
      action: 'Download and start',
      note: `Needs ~${fmtGb(gb + 0.5)}, only ${fmtGb(MACHINE.diskFreeGb)} free. Free up space or pick a lighter workflow.`,
      disabled: true
    }
  if (!has && kase === 'gated') {
    const missing = needsFor(t).length
    return {
      ...base,
      state: 'gated',
      status: `${missing} model${missing === 1 ? '' : 's'} missing · 1 needs a licence`,
      cost: fmtGb(gb),
      action: 'Accept licence and download',
      note: `Opens Hugging Face to accept the ${GATED_LICENCE} licence, then downloads ${fmtGb(gb)} and starts ${inst.name}.`,
      fetch: true
    }
  }
  const short = versionShort(t, inst)
  const packs = packsFor(t).filter((p) => !hasPack(inst, p))
  if (short || packs.length) {
    const n = packs.length
    const steps = [
      short && `updates ${inst.name} to ComfyUI ${short}`,
      n && `installs ${n} node pack${n === 1 ? '' : 's'}`,
      !has && `downloads ${fmtGb(gb)} once`
    ].filter(Boolean) as string[]
    const line = `${steps.join(', ')}, then opens this graph.`
    const again = inst.state === 'running' ? 'restart' : 'start'
    return {
      ...base,
      state: short ? 'update' : 'nodes',
      // The row names only what blocks most: the version, then the nodes.
      status: short
        ? `Needs ComfyUI ${short} · has ${inst.version}`
        : `${n} node pack${n === 1 ? '' : 's'} missing`,
      cost: has ? '' : fmtGb(gb),
      action: short ? `Update and ${again}` : `Install nodes and ${again}`,
      note: line[0]!.toUpperCase() + line.slice(1),
      fetch: !has
    }
  }
  if (has && kase === 'media' && inst.id === caseFor(t)?.build)
    return {
      ...base,
      state: 'media',
      status: `${inst.state === 'running' ? 'Running' : 'Stopped'} · its input image is missing`,
      cost: '',
      action: `Open in ${inst.name}`,
      note: `${MISSING_INPUT} isn't in this build's input folder. Pick an image in Load Image before you run it.`
    }
  if (has && inst.state === 'running')
    return {
      ...base,
      state: 'running',
      status: 'Running · every model here',
      // A local build costs nothing: no price beside it, only Cloud's.
      cost: '',
      action: `Open in ${inst.name}`,
      note: `Opens as a new tab in ${inst.name}. Runs free on this Mac.`
    }
  if (has)
    return {
      ...base,
      state: 'ready',
      status: 'Stopped · every model here',
      cost: '',
      action: `Start ${inst.name}`,
      note: `Starts ComfyUI (about 20 s), then opens this graph. Runs free on this Mac.`
    }
  const missing = needsFor(t).length
  const mins = Math.max(1, Math.round(gb / 5))
  return {
    ...base,
    state: 'download',
    status:
      inst.state === 'running'
        ? `Running · ${missing} model${missing === 1 ? '' : 's'} missing`
        : `${missing} model${missing === 1 ? '' : 's'} missing`,
    cost: fmtGb(gb),
    action: 'Download and start',
    note: `Downloads ${fmtGb(gb)} once (about ${mins} min), then starts ${inst.name}.`
  }
}

const RANK: Record<TargetState, number> = {
  running: 0,
  ready: 1,
  nodes: 2,
  update: 3,
  cloud: 4,
  new: 5,
  download: 5,
  memory: 6,
  login: 7,
  offline: 8,
  blocked: 9,
  media: 1,
  repair: 3,
  credits: 4,
  plan: 4,
  gated: 5,
  disk: 6,
  platform: 9
}

/** No local build yet: one row sets up a build with everything the
 *  workflow needs, so the picker never ends on Cloud alone. */
export function newBuildTarget(t: Template): Target | undefined {
  if (t.runs === 'cloud' || caseIs(t, 'platform')) return
  const vram = t.vram ? parseInt(t.vram) : 0
  if (vram > MACHINE.memGb) return
  const gb = totalGb(t) + 2.4
  const mins = Math.max(4, Math.round(gb / 5) + 3)
  return {
    inst: {
      id: 'new-build',
      name: 'New build',
      kind: 'local',
      channel: '',
      state: 'stopped',
      lastUsed: '',
      lastUsedRank: 99,
      workspace: 'personal',
      hue: 0
    },
    state: 'new',
    status: 'ComfyUI and every model',
    cost: fmtGb(gb),
    action: 'Set up and start',
    note: `Installs ComfyUI with everything this needs (about ${mins} min), then opens this graph. Runs free on this Mac.`,
    disabled: false,
    fetch: true
  }
}

/** An update or node install that also downloads ranks with downloads. */
const rank = (x: Target): number =>
  x.fetch && (x.state === 'update' || x.state === 'nodes') ? RANK.download + 0.5 : RANK[x.state]

export function rankTargets(list: Target[], prefer?: string): Target[] {
  return [...list].sort(
    (a, b) =>
      Number(b.inst.id === prefer) - Number(a.inst.id === prefer) ||
      rank(a) - rank(b) ||
      // A deployment is a workspace build: Comfy Cloud itself comes first.
      Number(Boolean(a.inst.deployment)) - Number(Boolean(b.inst.deployment)) ||
      a.inst.lastUsedRank - b.inst.lastUsedRank
  )
}

/** Why the first choice is first, in one sentence. */
export function reasonFor(best: Target, all: Target[], t: Template): string {
  switch (best.state) {
    case 'running':
      return 'Already running with every model. Opens instantly, free.'
    case 'ready':
      return 'Has every model this needs. Runs free on this Mac.'
    case 'update':
      return best.fetch
        ? `Downloads ${fmtGb(totalGb(t))} once, then runs free.`
        : 'Has every model; only ComfyUI needs an update. Then runs free on this Mac.'
    case 'nodes':
      return best.fetch
        ? `Downloads ${fmtGb(totalGb(t))} once, then runs free.`
        : 'Has every model; only node packs are missing. Then runs free on this Mac.'
    case 'new':
      return 'No build on this Mac yet. Sets one up with everything this needs.'
    case 'repair':
      return 'Has every model; the build needs a repair first. Then runs free on this Mac.'
    case 'gated':
      return `Downloads ${fmtGb(totalGb(t))} once, after you accept the model's licence. Then runs free.`
    case 'credits':
    case 'plan':
      return t.runs === 'cloud' ? 'Uses a partner model that only runs on Comfy Cloud.' : ''
    case 'cloud':
      if (all.some((x) => x.state === 'memory'))
        return `Needs ${t.vram} of GPU memory; this Mac has ${MACHINE.memGb} GB. Cloud has every model ready.`
      if (t.runs === 'cloud') return 'Uses a partner model that only runs on Comfy Cloud.'
      if (all.some((x) => x.state === 'platform'))
        return `Needs an NVIDIA GPU; this Mac has ${MACHINE.chip}. Cloud runs it.`
      return 'Nothing to download, ready in seconds.'
    case 'download':
      return `Downloads ${fmtGb(totalGb(t))} once, then runs free.`
    default:
      return ''
  }
}

export type NeedKind =
  'disk' | 'gpu' | 'licence' | 'input' | 'account' | 'credits' | 'plan' | 'repair' | 'network'

export interface CaseNeed {
  kind: NeedKind
  label: string
  size: string
  mark: 'here' | 'get' | 'warn'
  title: string
}

export function caseNeeds(t: Template, on: Target | undefined): CaseNeed[] {
  const kase = caseFor(t)?.id
  const s = on?.state
  const cloud = on?.inst.kind === 'cloud'
  switch (kase) {
    case 'disk':
      return [
        {
          kind: 'disk',
          label: 'Free disk space',
          size: cloud
            ? 'Comfy Cloud'
            : `${fmtGb(MACHINE.diskFreeGb)} of ${fmtGb(totalGb(t) + 0.5)}`,
          mark: s === 'disk' ? 'warn' : 'here',
          title: s === 'disk' ? 'Not enough space' : 'Enough space'
        }
      ]
    case 'platform':
      return [
        {
          kind: 'gpu',
          label: 'NVIDIA GPU (CUDA)',
          size: cloud ? (on?.inst.gpu ?? 'Comfy Cloud') : MACHINE.chip,
          mark: cloud ? 'here' : 'warn',
          title: cloud ? 'Supported' : 'Not supported on this Mac'
        }
      ]
    case 'gated':
      return [
        {
          kind: 'licence',
          label: 'Hugging Face licence',
          size: GATED_LICENCE,
          mark: s === 'gated' ? 'get' : 'here',
          title: s === 'gated' ? 'Accept it first' : 'Accepted'
        }
      ]
    case 'media':
      return [
        {
          kind: 'input',
          label: MISSING_INPUT,
          size: 'Input image',
          mark: s === 'media' ? 'warn' : 'here',
          title: s === 'media' ? 'Missing' : 'Ready'
        }
      ]
    case 'signIn':
      return [
        {
          kind: 'account',
          label: 'Comfy account',
          size: 'Partner nodes',
          mark: s === 'login' ? 'get' : 'here',
          title: s === 'login' ? 'Sign in first' : 'Signed in'
        }
      ]
    case 'credits':
      return [
        {
          kind: 'credits',
          label: 'Credits',
          size: `${RUN_CREDITS} a run · 0 left`,
          mark: 'warn',
          title: 'Add credits first'
        }
      ]
    case 'plan':
      return [
        {
          kind: 'plan',
          label: 'Comfy Cloud plan',
          size: 'Free plan',
          mark: s === 'plan' ? 'warn' : 'here',
          title: s === 'plan' ? 'Subscribe first' : 'Not needed here'
        }
      ]
    case 'repair':
      return s === 'repair'
        ? [
            {
              kind: 'repair',
              label: 'Python environment',
              size: 'Needs a repair',
              mark: 'get',
              title: 'Repairs first'
            }
          ]
        : []
    case 'offline':
      return [
        {
          kind: 'network',
          label: 'Internet connection',
          size: "You're offline",
          mark: 'warn',
          title: 'Needed to download and for Cloud'
        }
      ]
    default:
      return []
  }
}

export const CASE_STATE: Partial<Record<TargetState, { label: string; tone: string }>> = {
  repair: { label: 'Repairs first', tone: 'get' },
  disk: { label: 'Not enough space', tone: 'warn' },
  gated: { label: 'Licence first', tone: 'get' },
  platform: { label: 'Needs NVIDIA', tone: 'warn' },
  credits: { label: 'Needs credits', tone: 'warn' },
  plan: { label: 'Needs a plan', tone: 'warn' },
  media: { label: 'Input missing', tone: 'warn' },
  offline: { label: 'Needs a connection', tone: 'warn' },
  login: { label: 'Log in to use', tone: 'get' },
  memory: { label: 'May run out of memory', tone: 'warn' }
}

export const caseBuild = (t: Template): string | undefined => caseFor(t)?.build
