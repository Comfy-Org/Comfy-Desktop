import { computed, reactive } from 'vue'
import { notify } from '../pages/undo'

/**
 * Build > Models in Mar's proposal: the model library on this computer.
 * Everything here is mocked in memory. Components only talk to `modelsApi`
 * and read `modelsState` / the computeds, so the real thing (the desktop's
 * model download IPC, ComfyUI's /models and /assets endpoints) can replace
 * the bodies without touching the UI.
 *
 * One shared models folder serves every local build (the desktop's
 * extra_model_paths), so a model is downloaded once and "used by" builds.
 */

export type ModelType =
  | 'checkpoint'
  | 'diffusion'
  | 'lora'
  | 'vae'
  | 'text-encoder'
  | 'upscaler'
  | 'controlnet'

export type ModelSource = 'comfy' | 'huggingface' | 'civitai' | 'local'

export type DownloadState = 'queued' | 'downloading' | 'paused' | 'failed'

export interface Model {
  id: string
  /** File on disk, as nodes reference it. */
  file: string
  name: string
  type: ModelType
  /** Base architecture, what it's compatible with. */
  base: string
  sizeGb: number
  source: ModelSource
  author: string
  description: string
  license: string
  /** Folder inside the models directory (ComfyUI's model folder name). */
  folder: string
  sha256: string
  /** LoRA trigger words, when the author published some. */
  triggers?: string[]
  /** Hue for the generated tile. */
  hue: number
  installed: boolean
  addedAt?: string
  /** Local builds whose workflows load this model. */
  usedBy: string[]
  /** Workflows that load it. */
  workflows: string[]
  /** Needs a sign-in token at the source (gated on Hugging Face / Civitai). */
  gated?: boolean
}

export interface Download {
  modelId: string
  state: DownloadState
  receivedGb: number
  /** MB/s, while downloading. */
  speed: number
  error?: string
  /** Attempts so far, so a flaky source can fail once then work. */
  attempts: number
}

export const TYPE_LABEL: Record<ModelType, string> = {
  checkpoint: 'Checkpoint',
  diffusion: 'Diffusion model',
  lora: 'LoRA',
  vae: 'VAE',
  'text-encoder': 'Text encoder',
  upscaler: 'Upscaler',
  controlnet: 'ControlNet'
}

export const SOURCE_LABEL: Record<ModelSource, string> = {
  comfy: 'Comfy',
  huggingface: 'Hugging Face',
  civitai: 'Civitai',
  local: 'Imported'
}

/** Local builds that read the shared models folder. */
export const MODEL_BUILDS: Record<string, string> = {
  'local-1': 'My Local 1',
  'local-video': 'Video Lab',
  'local-flux': 'Flux Sandbox',
  'team-build': 'Brand Pipeline'
}

export const MODELS_FOLDER = '~/Documents/ComfyUI/models'
const DISK_TOTAL_GB = 1000
/** Space taken by everything that is not models. */
const DISK_OTHER_GB = 641

function m(p: Omit<Model, 'sha256'> & { sha256?: string }): Model {
  const sha =
    p.sha256 ?? [...p.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16)
  return { ...p, sha256: `${sha.padStart(8, '0')}…${sha.slice(0, 4)}` }
}

const SEED: Model[] = [
  m({
    id: 'z-image-turbo',
    file: 'z_image_turbo_bf16.safetensors',
    name: 'Z-Image Turbo',
    type: 'diffusion',
    base: 'Z-Image',
    sizeGb: 12.3,
    source: 'comfy',
    author: 'Tongyi-MAI',
    description: 'Fast text-to-image in 8 steps. The default for quick drafts.',
    license: 'Apache 2.0',
    folder: 'diffusion_models',
    hue: 210,
    installed: true,
    addedAt: 'Oct 12',
    usedBy: ['local-1', 'local-flux'],
    workflows: ['Z-Image Turbo text to image', 'Product shots v3']
  }),
  m({
    id: 'qwen-edit-2511',
    file: 'qwen_image_edit_2511_fp8.safetensors',
    name: 'Qwen Image Edit 2511',
    type: 'diffusion',
    base: 'Qwen Image',
    sizeGb: 20.4,
    source: 'comfy',
    author: 'Qwen',
    description: 'Instruction image editing: change, add or remove things with a prompt.',
    license: 'Apache 2.0',
    folder: 'diffusion_models',
    hue: 280,
    installed: true,
    addedAt: 'Oct 3',
    usedBy: ['local-1', 'team-build'],
    workflows: ['Qwen image edit', 'Brand recolor']
  }),
  m({
    id: 'qwen-3-4b',
    file: 'qwen_3_4b.safetensors',
    name: 'Qwen 3 4B',
    type: 'text-encoder',
    base: 'Z-Image',
    sizeGb: 8.0,
    source: 'comfy',
    author: 'Qwen',
    description: 'Text encoder Z-Image reads the prompt with.',
    license: 'Apache 2.0',
    folder: 'text_encoders',
    hue: 160,
    installed: true,
    addedAt: 'Oct 12',
    usedBy: ['local-1', 'local-flux'],
    workflows: ['Z-Image Turbo text to image', 'Product shots v3']
  }),
  m({
    id: 'ae',
    file: 'ae.safetensors',
    name: 'FLUX autoencoder',
    type: 'vae',
    base: 'FLUX',
    sizeGb: 0.33,
    source: 'huggingface',
    author: 'Black Forest Labs',
    description: 'Decodes latents to pixels for FLUX and Z-Image.',
    license: 'Apache 2.0',
    folder: 'vae',
    hue: 30,
    installed: true,
    addedAt: 'Sep 20',
    usedBy: ['local-1', 'local-flux', 'team-build'],
    workflows: ['Z-Image Turbo text to image', 'FLUX.2 text to image', 'Product shots v3']
  }),
  m({
    id: 'krea2-turbo',
    file: 'krea2_turbo.safetensors',
    name: 'Krea 2 Turbo',
    type: 'checkpoint',
    base: 'Krea 2',
    sizeGb: 11.9,
    source: 'huggingface',
    author: 'Krea',
    description: 'Photographic text-to-image, natural skin and light.',
    license: 'Krea community',
    folder: 'checkpoints',
    hue: 340,
    installed: true,
    addedAt: 'Oct 20',
    usedBy: ['local-flux'],
    workflows: ['Krea 2 text to image']
  }),
  m({
    id: 'product-photo-v3',
    file: 'product_photo_v3.safetensors',
    name: 'Product photo v3',
    type: 'lora',
    base: 'Z-Image',
    sizeGb: 0.14,
    source: 'civitai',
    author: 'studio_mk',
    description: 'Clean e-commerce product light on seamless backdrops.',
    license: 'CreativeML Open RAIL-M',
    folder: 'loras',
    triggers: ['prodshot', 'seamless backdrop'],
    hue: 50,
    installed: true,
    addedAt: 'Oct 14',
    usedBy: ['local-1'],
    workflows: ['Product shots v3']
  }),
  m({
    id: 'siax',
    file: '4x_NMKD-Siax_200k.pth',
    name: '4x NMKD Siax',
    type: 'upscaler',
    base: 'ESRGAN',
    sizeGb: 0.07,
    source: 'huggingface',
    author: 'NMKD',
    description: 'Sharp 4x upscaler for photos and renders.',
    license: 'WTFPL',
    folder: 'upscale_models',
    hue: 190,
    installed: true,
    addedAt: 'Aug 30',
    usedBy: [],
    workflows: []
  }),
  m({
    id: 'wan22-i2v',
    file: 'wan2.2_i2v_high_noise_14B_fp8.safetensors',
    name: 'Wan 2.2 I2V 14B',
    type: 'diffusion',
    base: 'Wan 2.2',
    sizeGb: 14.3,
    source: 'comfy',
    author: 'Wan-AI',
    description: 'Image to video, 5 s at 720p.',
    license: 'Apache 2.0',
    folder: 'diffusion_models',
    hue: 250,
    installed: true,
    addedAt: 'Oct 1',
    usedBy: ['local-video'],
    workflows: ['Wan 2.2 image to video']
  }),
  m({
    id: 'umt5',
    file: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    name: 'UMT5 XXL',
    type: 'text-encoder',
    base: 'Wan 2.2',
    sizeGb: 6.7,
    source: 'comfy',
    author: 'Google',
    description: 'Text encoder for Wan video models.',
    license: 'Apache 2.0',
    folder: 'text_encoders',
    hue: 120,
    installed: true,
    addedAt: 'Oct 1',
    usedBy: ['local-video'],
    workflows: ['Wan 2.2 image to video']
  }),
  m({
    id: 'old-sdxl',
    file: 'juggernautXL_v9.safetensors',
    name: 'Juggernaut XL v9',
    type: 'checkpoint',
    base: 'SDXL',
    sizeGb: 6.9,
    source: 'civitai',
    author: 'KandooAI',
    description: 'All-round SDXL checkpoint. Not used by any workflow lately.',
    license: 'CreativeML Open RAIL++-M',
    folder: 'checkpoints',
    hue: 15,
    installed: true,
    addedAt: 'Mar 2',
    usedBy: [],
    workflows: []
  }),
  // Available, not on this computer.
  m({
    id: 'flux2-dev',
    file: 'flux2_dev_fp8mixed.safetensors',
    name: 'FLUX.2 dev',
    type: 'diffusion',
    base: 'FLUX',
    sizeGb: 35.5,
    source: 'huggingface',
    author: 'Black Forest Labs',
    description: 'High-detail text-to-image with multi-reference editing.',
    license: 'FLUX non-commercial',
    folder: 'diffusion_models',
    hue: 20,
    installed: false,
    usedBy: [],
    workflows: ['FLUX.2 text to image'],
    gated: true
  }),
  m({
    id: 'ltx2',
    file: 'ltx-2.5-19b-distilled-fp8.safetensors',
    name: 'LTX 2.5 distilled',
    type: 'checkpoint',
    base: 'LTX',
    sizeGb: 27.1,
    source: 'huggingface',
    author: 'Lightricks',
    description: 'Video with synced audio, 10 s, fast.',
    license: 'LTX open weights',
    folder: 'checkpoints',
    hue: 300,
    installed: false,
    usedBy: [],
    workflows: ['LTX 2.5 image to video']
  }),
  m({
    id: 'seedvr2',
    file: 'seedvr2_ema_7b_fp16.safetensors',
    name: 'SeedVR2 7B',
    type: 'upscaler',
    base: 'SeedVR2',
    sizeGb: 16.5,
    source: 'huggingface',
    author: 'ByteDance Seed',
    description: 'Restores and upscales images and video in one pass.',
    license: 'Apache 2.0',
    folder: 'upscale_models',
    hue: 170,
    installed: false,
    usedBy: [],
    workflows: ['SeedVR2 upscale']
  }),
  m({
    id: 'product-relight',
    file: 'product_relight_zimage.safetensors',
    name: 'Product relight',
    type: 'lora',
    base: 'Z-Image',
    sizeGb: 0.29,
    source: 'civitai',
    author: 'lumen_labs',
    description: 'Moves the key light around a product without repainting it.',
    license: 'CreativeML Open RAIL-M',
    folder: 'loras',
    triggers: ['relit', 'rim light'],
    hue: 60,
    installed: false,
    usedBy: [],
    workflows: ['Product shots v3'],
    gated: true
  }),
  m({
    id: 'union-cn',
    file: 'z_image_union_controlnet.safetensors',
    name: 'Z-Image Union ControlNet',
    type: 'controlnet',
    base: 'Z-Image',
    sizeGb: 3.1,
    source: 'comfy',
    author: 'Comfy',
    description: 'Canny, depth and pose control in one model.',
    license: 'Apache 2.0',
    folder: 'controlnet',
    hue: 100,
    installed: false,
    usedBy: [],
    workflows: ['Product shots v3']
  }),
  m({
    id: 'sdxl-vae',
    file: 'sdxl_vae.safetensors',
    name: 'SDXL VAE',
    type: 'vae',
    base: 'SDXL',
    sizeGb: 0.33,
    source: 'huggingface',
    author: 'Stability AI',
    description: 'Fixed VAE for SDXL checkpoints.',
    license: 'MIT',
    folder: 'vae',
    hue: 220,
    installed: false,
    usedBy: [],
    workflows: []
  })
]

/** A workflow that won't run until its models are here. */
export interface WorkflowNeeds {
  workflow: string
  build: string
  models: string[]
}
export const WORKFLOW_NEEDS: WorkflowNeeds[] = [
  {
    workflow: 'Product shots v3',
    build: 'local-1',
    models: ['z-image-turbo', 'qwen-3-4b', 'ae', 'product-photo-v3', 'product-relight', 'union-cn']
  }
]

export const modelsState = reactive({
  models: SEED.map((x) => ({ ...x, usedBy: [...x.usedBy], workflows: [...x.workflows] })),
  downloads: [] as Download[],
  /** Finished this session, newest first, for the Downloads tab. */
  finished: [] as string[],
  favorites: ['z-image-turbo', 'product-photo-v3'] as string[]
})

export const modelById = (id: string): Model | undefined =>
  modelsState.models.find((x) => x.id === id)
export const downloadOf = (id: string): Download | undefined =>
  modelsState.downloads.find((d) => d.modelId === id)

export const installed = computed(() => modelsState.models.filter((x) => x.installed))
export const usedGb = computed(() => installed.value.reduce((n, x) => n + x.sizeGb, 0))
const partialGb = computed(() => modelsState.downloads.reduce((n, d) => n + d.receivedGb, 0))
export const freeGb = computed(() =>
  Math.max(0, DISK_TOTAL_GB - DISK_OTHER_GB - usedGb.value - partialGb.value)
)
export const diskTotalGb = DISK_TOTAL_GB
export const usedByType = computed(() => {
  const out = {} as Record<ModelType, number>
  for (const x of installed.value) out[x.type] = (out[x.type] ?? 0) + x.sizeGb
  return out
})
/** Installed and loaded by nothing: candidates to free space. */
export const unused = computed(() => installed.value.filter((x) => !x.usedBy.length))
export const activeDownloads = computed(() =>
  modelsState.downloads.filter((d) => d.state !== 'failed')
)
export const missingFor = (w: WorkflowNeeds): Model[] =>
  w.models.map(modelById).filter((x): x is Model => Boolean(x && !x.installed))

export function fmtSize(gb: number): string {
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(gb * 1000))} MB`
}

const MAX_PARALLEL = 2
let timer: ReturnType<typeof setInterval> | undefined

function promote(): void {
  let running = modelsState.downloads.filter((d) => d.state === 'downloading').length
  for (const d of modelsState.downloads) {
    if (running >= MAX_PARALLEL) break
    if (d.state === 'queued') {
      d.state = 'downloading'
      running++
    }
  }
  if (running && !timer) timer = setInterval(tick, 200)
  if (!running && timer) {
    clearInterval(timer)
    timer = undefined
  }
}

function tick(): void {
  for (const d of modelsState.downloads) {
    if (d.state !== 'downloading') continue
    const model = modelById(d.modelId)
    if (!model) continue
    // Mocked speed: big files finish in a few seconds so the flow is watchable.
    d.speed = 60 + Math.round(Math.random() * 40)
    d.receivedGb = Math.min(model.sizeGb, d.receivedGb + Math.max(0.02, model.sizeGb / 22))
    // Gated files fail half-way the first time, as an expired token would.
    if (model.gated && d.attempts === 1 && d.receivedGb > model.sizeGb * 0.45) {
      d.state = 'failed'
      d.speed = 0
      d.error = `${SOURCE_LABEL[model.source]} sign-in expired`
      continue
    }
    if (d.receivedGb >= model.sizeGb) finish(d)
  }
  promote()
}

function finish(d: Download): void {
  const model = modelById(d.modelId)
  modelsState.downloads.splice(modelsState.downloads.indexOf(d), 1)
  if (!model) return
  model.installed = true
  model.addedAt = 'Just now'
  modelsState.finished.unshift(model.id)
  notify(`${model.file} is ready`)
}

/** The seam: swap these bodies for the real desktop / ComfyUI calls. */
export const modelsApi = {
  toggleFavorite(id: string): void {
    const i = modelsState.favorites.indexOf(id)
    if (i >= 0) modelsState.favorites.splice(i, 1)
    else modelsState.favorites.push(id)
  },
  /** Queue a download. Returns false when there isn't room on disk. */
  download(id: string, forBuild?: string): boolean {
    const model = modelById(id)
    if (!model || model.installed || downloadOf(id)) return true
    if (model.sizeGb > freeGb.value) return false
    if (forBuild && !model.usedBy.includes(forBuild)) model.usedBy.push(forBuild)
    modelsState.downloads.push({
      modelId: id,
      state: 'queued',
      receivedGb: 0,
      speed: 0,
      attempts: 1
    })
    promote()
    return true
  },
  pause(id: string): void {
    const d = downloadOf(id)
    if (d && (d.state === 'downloading' || d.state === 'queued')) {
      d.state = 'paused'
      d.speed = 0
      promote()
    }
  },
  resume(id: string): void {
    const d = downloadOf(id)
    if (d?.state === 'paused') {
      d.state = 'queued'
      promote()
    }
  },
  retry(id: string): void {
    const d = downloadOf(id)
    if (d?.state === 'failed') {
      d.state = 'queued'
      d.error = undefined
      d.attempts++
      promote()
    }
  },
  /** Stop and throw away the partial file. */
  cancel(id: string): void {
    const d = downloadOf(id)
    if (!d) return
    modelsState.downloads.splice(modelsState.downloads.indexOf(d), 1)
    promote()
  },
  /** Delete the file. Builds that used it will report it missing. */
  remove(id: string): void {
    const model = modelById(id)
    if (!model) return
    model.installed = false
    model.addedAt = undefined
    model.usedBy = []
    modelsState.finished = modelsState.finished.filter((x) => x !== id)
    modelsState.favorites = modelsState.favorites.filter((x) => x !== id)
  },
  /** Add a model from a Hugging Face / Civitai link and start it downloading. */
  importUrl(url: string): Model | undefined {
    const file = url.split('?')[0]!.split('/').filter(Boolean).pop() ?? ''
    if (!/\.(safetensors|ckpt|pth|pt|gguf)$/i.test(file)) return undefined
    const id = `import-${file.toLowerCase()}`
    if (!modelById(id)) {
      const source: ModelSource = url.includes('civitai')
        ? 'civitai'
        : url.includes('huggingface') || url.includes('hf.co')
          ? 'huggingface'
          : 'local'
      modelsState.models.unshift(
        m({
          id,
          file,
          name: file.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
          type: /lora/i.test(file) ? 'lora' : 'checkpoint',
          base: 'Unknown',
          sizeGb: 2.4,
          source,
          author: 'From link',
          description: url,
          license: 'Check the source page',
          folder: /lora/i.test(file) ? 'loras' : 'checkpoints',
          hue: 200,
          installed: false,
          usedBy: [],
          workflows: []
        })
      )
    }
    modelsApi.download(id)
    return modelById(id)
  }
}
