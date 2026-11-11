import { reactive } from 'vue'
import { thumb, type ProtoInstance, type Template } from '../../mock'
import { modelsFor, templateAbout, templateById, templateStats, type ModelReq } from '../../fit'
import { hubById, hubTemplate, hubThumb, type HubWorkflow } from '../explore/hubWorkflows'
import heroAngles from './angles-hero.jpg'
import inputAngles from './angles-input.jpg'
import outputAngles from './angles-output.jpg'

/**
 * Mock data behind Mar's template modal. The fields mirror ComfyUI's
 * template index (title, description, tags, models, date, license, vram,
 * openSource); the "where it runs" logic is a richer mock than fit.ts so
 * every picker state can show: running, ready, needs download, not enough
 * memory, Cloud-only, logged out and offline.
 */

/** This computer, shared by every local build. */
export const MACHINE = { name: 'This Mac', chip: 'Apple M3 Max', memGb: 36 }

/** Prototype-only switches for the states that need a world change. */
export const tplMock = reactive({ offline: false })

export interface TplMedia {
  hero: string
  /** Graph previews: the image going in and the one coming out. */
  input?: string
  output: string
  /** Labels over a contact-sheet hero, clockwise from top left. */
  quadrants?: string[]
}

/** The Hub's angles workflow: Mar's contact sheet and its graph. */
export const ANGLES_ID = 'template_qwen_multiangle.app'

/** A workflow by id: the Hub's (real), else the prototype's mock. */
export function tplById(id: string): Template | undefined {
  const h = hubById(id)
  return h ? hubTemplate(h) : templateById(id)
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
  const pic = hubThumb(t.id) ?? thumb(t.id)
  return MEDIA[t.id] ?? { hero: pic, output: pic }
}

/** Loaders the graph uses beyond fit.ts's main weights. */
const EXTRA_MODELS: Record<string, ModelReq[]> = {
  [ANGLES_ID]: [{ name: 'qwen_image_vae.safetensors', size: '254 MB', gb: 0.25 }]
}

/** The angles workflow loads 2511's weights. */
const SAME_MODELS: Record<string, string> = { [ANGLES_ID]: 'image_qwen_image_edit_2511' }

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

export type TargetState =
  | 'running'
  | 'ready'
  | 'cloud'
  | 'download'
  | 'memory'
  | 'login'
  | 'blocked'
  | 'offline'

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
}

const credits = (t: Template): number => Math.max(4, Math.round(totalGb(t) * 0.7))

export function targetFor(t: Template, inst: ProtoInstance, signedIn: boolean): Target {
  const base = { inst, disabled: false }
  const gb = totalGb(t)
  if (inst.kind === 'cloud') {
    if (tplMock.offline)
      return {
        ...base,
        state: 'offline',
        status: "You're offline",
        cost: '',
        action: 'Run on Comfy Cloud',
        note: 'Comfy Cloud needs a connection.',
        disabled: true
      }
    if (!signedIn)
      return {
        ...base,
        state: 'login',
        status: 'Needs a Comfy account',
        cost: '',
        action: 'Log in to Comfy Cloud',
        note: 'New accounts get free credits.'
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
    const c = t.runs === 'cloud' ? 12 : credits(t)
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
  const vram = t.vram ? parseInt(t.vram) : 0
  // Nothing to download (built-in nodes only): every build has it.
  const has = INSTALLED[inst.id]?.includes(t.id) || !needsFor(t).length
  if (vram > MACHINE.memGb)
    return {
      ...base,
      state: 'memory',
      status: `Only ${MACHINE.memGb} of ${vram} GB memory`,
      cost: has ? 'May fail' : fmtGb(gb),
      action: 'Launch anyway',
      note: `It may run out of memory. Smaller sizes help, or run it on Cloud.`
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
      action: `Launch ${inst.name}`,
      note: `Starts ComfyUI (about 20 s), then opens this graph. Runs free on this Mac.`
    }
  const missing = needsFor(t).length
  const mins = Math.max(1, Math.round(gb / 5))
  return {
    ...base,
    state: 'download',
    status:
      inst.state === 'running'
        ? `Running · ${missing} models missing`
        : `${missing} model${missing === 1 ? '' : 's'} missing`,
    cost: fmtGb(gb),
    action: 'Download and launch',
    note: `Downloads ${fmtGb(gb)} once (about ${mins} min), then launches ${inst.name}.`
  }
}

const RANK: Record<TargetState, number> = {
  running: 0,
  ready: 1,
  cloud: 2,
  download: 3,
  memory: 4,
  login: 5,
  offline: 8,
  blocked: 9
}

export function rankTargets(list: Target[]): Target[] {
  return [...list].sort(
    (a, b) =>
      RANK[a.state] - RANK[b.state] ||
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
    case 'cloud':
      if (all.some((x) => x.state === 'memory'))
        return `Needs ${t.vram} of GPU memory; this Mac has ${MACHINE.memGb} GB. Cloud has every model ready.`
      if (t.runs === 'cloud') return 'Uses a partner model that only runs on Comfy Cloud.'
      return 'Nothing to download, ready in seconds.'
    case 'download':
      return `Downloads ${fmtGb(totalGb(t))} once, then runs free.`
    default:
      return ''
  }
}
