import { TEMPLATES, WORKFLOWS, type ProtoInstance, type Template, type Workflow } from './mock'

/**
 * Mock "where can this run" logic for the summary sheet. Real data would come
 * from the template index (models, VRAM) and each instance's installed models
 * and node packs.
 */

export type FitState = 'ready' | 'download' | 'warn' | 'blocked'

export interface Fit {
  state: FitState
  /** Short status, e.g. "Ready - models installed". */
  label: string
}

export interface ModelReq {
  name: string
  size: string
  gb: number
}

const MODELS: Record<string, ModelReq[]> = {
  image_z_image_turbo: [
    { name: 'z_image_turbo_bf16.safetensors', size: '12.3 GB', gb: 12.3 },
    { name: 'qwen_3_4b.safetensors', size: '8.0 GB', gb: 8 },
    { name: 'ae.safetensors', size: '335 MB', gb: 0.3 }
  ],
  image_qwen_image_edit_2511: [
    { name: 'qwen_image_edit_2511_fp8.safetensors', size: '20.4 GB', gb: 20.4 },
    { name: 'qwen_2.5_vl_7b_fp8.safetensors', size: '9.4 GB', gb: 9.4 }
  ],
  video_ltx2_5_i2v: [{ name: 'ltx-2.5-distilled.safetensors', size: '27.1 GB', gb: 27.1 }],
  video_wan2_2_14B_i2v: [
    { name: 'wan2.2_i2v_high_noise_14B_fp8.safetensors', size: '14.3 GB', gb: 14.3 },
    { name: 'wan2.2_i2v_low_noise_14B_fp8.safetensors', size: '14.3 GB', gb: 14.3 }
  ],
  image_flux2: [{ name: 'flux2_dev_fp8mixed.safetensors', size: '35.5 GB', gb: 35.5 }],
  image_krea2_turbo_t2i: [{ name: 'krea2_turbo.safetensors', size: '11.9 GB', gb: 11.9 }],
  utility_seedvr2_image_upscale: [
    { name: 'seedvr2_ema_3b_fp16.safetensors', size: '6.8 GB', gb: 6.8 }
  ],
  '3d_pixal3d_trellis2_image_to_model': [
    { name: 'trellis2_image_large.safetensors', size: '7.2 GB', gb: 7.2 }
  ],
  video_minimax_h3_i2v: [{ name: 'minimax_h3_i2v_fp8.safetensors', size: '18.6 GB', gb: 18.6 }]
}

/** Which template models each local instance already has. */
const INSTALLED: Record<string, string[]> = {
  'local-1': ['image_z_image_turbo', 'image_qwen_image_edit_2511', 'image_krea2_turbo_t2i'],
  'local-video': ['video_ltx2_5_i2v', 'video_wan2_2_14B_i2v', 'video_minimax_h3_i2v'],
  'local-flux': ['image_flux2', 'utility_seedvr2_image_upscale'],
  'team-build': ['templates_graphic_design_recomposer']
}

export function modelsFor(t: Template): ModelReq[] {
  return MODELS[t.id] ?? []
}

export function templateFit(t: Template, inst: ProtoInstance, signedIn: boolean): Fit {
  if (inst.kind === 'cloud') {
    if (!signedIn) return { state: 'warn', label: 'Needs an account · free credits' }
    if (t.runs === 'local') return { state: 'blocked', label: 'Not available on Cloud yet' }
    return { state: 'ready', label: 'Ready instantly · uses credits' }
  }
  if (t.runs === 'cloud') return { state: 'blocked', label: 'Partner model · needs Comfy Cloud' }
  if (t.vram && parseInt(t.vram) > 36)
    return { state: 'warn', label: `Needs ${t.vram} VRAM · may be slow` }
  if (INSTALLED[inst.id]?.includes(t.id))
    return { state: 'ready', label: 'Ready · models installed' }
  const gb = modelsFor(t).reduce((n, m) => n + m.gb, 0)
  return {
    state: 'download',
    label: gb ? `Downloads ${gb.toFixed(1)} GB of models first` : 'Downloads models first'
  }
}

export function workflowFit(w: Workflow, inst: ProtoInstance, signedIn: boolean): Fit {
  if (inst.id === w.instanceId) return { state: 'ready', label: 'Last opened here · all set' }
  if (inst.kind === 'cloud') {
    if (!signedIn) return { state: 'warn', label: 'Needs an account · free credits' }
    return { state: 'ready', label: 'Ready · custom nodes supported' }
  }
  return { state: 'download', label: 'Installs 2 missing node packs' }
}

/** Best target: ready > download > warn; prefer running, then most recent. */
export function bestTarget(fits: { inst: ProtoInstance; fit: Fit }[]): ProtoInstance | undefined {
  const score = { ready: 0, download: 1, warn: 2, blocked: 9 }
  return [...fits]
    .filter((f) => f.fit.state !== 'blocked')
    .sort(
      (a, b) =>
        score[a.fit.state] - score[b.fit.state] ||
        // On desktop, a ready local instance beats a cloud deployment.
        Number(Boolean(a.inst.deployment)) - Number(Boolean(b.inst.deployment)) ||
        Number(b.inst.state === 'running') - Number(a.inst.state === 'running') ||
        a.inst.lastUsedRank - b.inst.lastUsedRank
    )[0]?.inst
}

export const templateById = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id)
export const workflowByName = (name: string): Workflow | undefined =>
  WORKFLOWS.find((w) => w.name === name)

const ABOUT: Record<string, string[]> = {
  image_z_image_turbo: [
    'An efficient image generation model with a single-stream diffusion transformer. Supports English and Chinese prompts.',
    'The graph is intentionally simple: fixed model-friendly sizes, a single sampler and a save node, so you can iterate quickly and tune only what matters.'
  ]
}

export function templateAbout(t: Template): string[] {
  return (
    ABOUT[t.id] ?? [
      `${t.title} as a ready-to-run graph. Inputs, model loaders and a save node are wired up, with a note inside the graph that explains each step.`,
      'Open it, swap in your own prompt or image, and run. Every node stays editable.'
    ]
  )
}

export function templateStats(t: Template): {
  uses: string
  likes: number
  added: string
  tags: string[]
} {
  let h = 0
  for (const c of t.id) h = (h * 31 + c.charCodeAt(0)) % 100000
  const [model, ...rest] = t.title.split(':')
  return {
    uses: (2000 + (h % 9000)).toLocaleString('en-US'),
    likes: 40 + (h % 200),
    added: `2026-0${1 + (h % 9)}-${10 + (h % 18)}`,
    tags: [
      model!.trim(),
      rest.join(':').trim() || 'Workflow',
      t.category === '3d' ? '3D' : t.category[0]!.toUpperCase() + t.category.slice(1)
    ]
  }
}
