import { reactive } from 'vue'
import { thumb, type ProtoInstance, type Template } from '../../mock'
import { modelsFor, templateAbout, templateStats, type ModelReq } from '../../fit'
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

const MEDIA: Record<string, TplMedia> = {
  image_qwen_image_edit_2511: {
    hero: heroAngles,
    input: inputAngles,
    output: outputAngles,
    quadrants: ['Front', '¾ left', 'Top down', 'Low angle']
  }
}

export function mediaFor(t: Template): TplMedia {
  return MEDIA[t.id] ?? { hero: thumb(t.id), output: thumb(t.id) }
}

/** Loaders the graph uses beyond fit.ts's main weights. */
const EXTRA_MODELS: Record<string, ModelReq[]> = {
  image_qwen_image_edit_2511: [{ name: 'qwen_image_vae.safetensors', size: '254 MB', gb: 0.25 }]
}

export function needsFor(t: Template): ModelReq[] {
  return [...modelsFor(t), ...(EXTRA_MODELS[t.id] ?? [])]
}

export const totalGb = (t: Template): number => needsFor(t).reduce((n, m) => n + m.gb, 0)

export const fmtGb = (gb: number): string =>
  gb < 1 ? `${Math.round(gb * 1000)} MB` : `${gb.toFixed(1)} GB`

const ABOUT: Record<string, string[]> = {
  image_qwen_image_edit_2511: [
    'Turn one photo into new camera angles. Rotate around the subject, look from above or below, or move in closer, while the product, light and background stay the same.',
    'Write the angle you want in plain words. Lightning LoRA settings keep it to 4 steps, so each angle takes a few seconds.'
  ]
}

export function aboutFor(t: Template): string[] {
  return ABOUT[t.id] ?? templateAbout(t)
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
  return {
    ...s,
    added,
    license: t.runs === 'cloud' ? 'Partner API' : (LICENSE[t.id] ?? 'Open source'),
    vramGb: t.vram ? parseInt(t.vram) : undefined,
    useCase: t.category === '3d' ? '3D' : t.category[0]!.toUpperCase() + t.category.slice(1)
  }
}

/** Which templates each local build already has every model for. */
const INSTALLED: Record<string, string[]> = {
  'local-1': ['image_z_image_turbo', 'image_qwen_image_edit_2511', 'image_krea2_turbo_t2i'],
  'local-video': ['video_ltx2_5_i2v', 'video_wan2_2_14B_i2v', 'video_minimax_h3_i2v'],
  'local-flux': ['image_flux2', 'utility_seedvr2_image_upscale'],
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
        action: 'Offline',
        note: 'Cloud needs a connection.',
        disabled: true
      }
    if (!signedIn)
      return {
        ...base,
        state: 'login',
        status: 'New accounts get free credits',
        cost: 'Log in',
        action: 'Log in to Comfy Cloud',
        note: 'Log in to run this on cloud GPUs. New accounts get free credits.'
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
        note: awake
          ? `Opens in ${inst.name}, already running. About ${c} credits a run.`
          : `Wakes ${inst.name} (about 40 s). About ${c} credits a run.`
      }
    }
    return {
      ...base,
      state: 'cloud',
      status: 'Every model ready',
      cost: `${c} credits`,
      action: 'Run on Comfy Cloud',
      note: `Opens in a new window, nothing to download. About ${c} credits a run.`
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
  const has = INSTALLED[inst.id]?.includes(t.id)
  if (vram > MACHINE.memGb)
    return {
      ...base,
      state: 'memory',
      status: `Only ${MACHINE.memGb} of ${vram} GB memory`,
      cost: has ? 'May fail' : fmtGb(gb),
      action: 'Launch anyway',
      note: `Runs out of memory on most settings. Try smaller sizes, or run it on Cloud.`
    }
  if (has && inst.state === 'running')
    return {
      ...base,
      state: 'running',
      status: 'Running now · every model here',
      cost: 'Free',
      action: `Open in ${inst.name}`,
      note: `Opens as a new tab in ${inst.name}. Runs free on this Mac.`
    }
  if (has)
    return {
      ...base,
      state: 'ready',
      status: 'Every model here',
      cost: 'Free',
      action: `Launch ${inst.name}`,
      note: `Starts ComfyUI (about 20 s), then opens this graph. Runs free on this Mac.`
    }
  const missing = modelsFor(t).length + (EXTRA_MODELS[t.id]?.length ?? 0)
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
      return 'Fastest start. Every model ready, nothing to download.'
    case 'download':
      return `Closest fit. Downloads ${fmtGb(totalGb(t))} once, then runs free.`
    default:
      return ''
  }
}
