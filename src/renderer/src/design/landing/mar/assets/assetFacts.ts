import type { MarAsset } from '../pages/assetsStore'

/**
 * What the asset details view knows about one asset (Better Asset
 * Management PRD, Phase 2): its file, its read-only tags, and what could
 * be recovered from the run that made it. Mock, but deterministic per
 * asset, and honest about gaps: an imported file has no run, an older
 * run's history did not survive a restart, an API node names no model.
 */
export type Availability = 'available' | 'missing' | 'lost'

export interface AssetFacts {
  width?: number
  height?: number
  /** Masonry shape, width / height. */
  ratio: number
  duration?: string
  format: string
  imported: boolean
  tags: string[]
  workflow: Availability
  history: Availability
  metadata: Availability
  /** Read from the run's data: candidates, never proof. */
  prompt?: string
  models: string[]
  /** Node the prompt was found in. */
  promptNode?: string
  negative?: string
  /** The sampler's settings, when the run recorded them. */
  params?: { seed: number; steps: number; cfg: number; sampler: string }
  seconds?: number
  json?: string
}

const hash = (s: string): number => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)

const IMAGE_SIZES: [number, number][] = [
  [1024, 1024],
  [832, 1216],
  [1216, 832],
  [896, 1152],
  [1536, 1024]
]
const VIDEO_SIZES: [number, number][] = [
  [1280, 720],
  [720, 1280],
  [1024, 1024]
]

const MODELS: Record<string, string[]> = {
  image_z_image_turbo: ['z_image_turbo_bf16.safetensors', 'qwen_3_4b.safetensors'],
  image_krea2_turbo_t2i: ['flux1-krea-dev_fp8_scaled.safetensors'],
  image_flux2: ['flux2_dev_fp8mixed.safetensors', 'mistral_3_small_flux2_fp8.safetensors'],
  image_qwen_image_edit_2511: ['qwen_image_edit_2511_fp8_e4m3fn.safetensors'],
  video_ltx2_5_i2v: ['ltx-2.5-i2v-distilled.safetensors'],
  video_wan2_2_14B_i2v: [
    'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
    'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors'
  ],
  utility_seedvr2_image_upscale: ['seedvr2_ema_7b_fp16.safetensors']
}

/** Prompts that describe each mock picture, by file name. */
const PROMPTS: [RegExp, string][] = [
  [/hero_shot_00012/, 'portrait of a woman in profile, flowers in her hair, soft pink backdrop'],
  [/hero_shot_00011/, 'young man in a black jacket before a stone palace, overcast light'],
  [/angles/, 'armored mech turnaround sheet, front, side and back, black backdrop'],
  [/terraces_i2v/, 'slow push-in on a black pyramid over a frozen lake, a lone figure'],
  [/wan_portrait/, 'girl in a white dress reading in a meadow, gentle wind, golden light'],
  [/flux_portrait/, 'profile portrait, braided hair, gold hoop earrings, teal sweater'],
  [/upscale_4k/, 'jaguar resting in a jungle clearing, upscaled to 4K'],
  [/^hero_shot/, 'portrait of a woman by a window, golden hour, shallow depth of field'],
  [/fog/, 'low fog over a quiet valley at dawn, muted film tones, wide shot'],
  [/portrait/, 'natural light portrait outdoors, soft focus background, 85mm'],
  [/banner/, 'flowing abstract silk in pastel light, macro, soft gradients']
]

/** What a model file does in the run, from its name: a guess, like the rest. */
export function modelRole(file: string): string {
  if (/lora/i.test(file)) return 'LoRA'
  if (/qwen_3|mistral|t5|clip|umt5/i.test(file)) return 'Text encoder'
  if (/vae/i.test(file)) return 'VAE'
  if (/seedvr|upscale|esrgan/i.test(file)) return 'Upscaler'
  return 'Model'
}

/** "12 min ago" and "Yesterday" kept their run; older runs lost it on a restart. */
const recent = (when: string): boolean => /min|hour|now|yesterday/i.test(when)

export function factsFor(a: MarAsset): AssetFacts {
  const h = hash(a.name)
  const imported = /-in-\d+$/.test(a.id)
  const template = (a.thumbId ?? '').split('~')[0]!
  const ext = a.name.split('.').pop()!.toUpperCase()

  let width: number | undefined
  let height: number | undefined
  let duration: string | undefined
  if (a.type === 'image') [width, height] = IMAGE_SIZES[h % IMAGE_SIZES.length]!
  else if (a.type === 'video') {
    ;[width, height] = VIDEO_SIZES[h % VIDEO_SIZES.length]!
    duration = `0:0${4 + (h % 6)}`
  } else if (a.type === '3d') [width, height] = [1024, 1024]
  else if (a.type === 'audio') duration = `0:${String(18 + (h % 40)).padStart(2, '0')}`
  const ratio = width && height ? width / height : a.type === 'audio' ? 16 / 9 : 4 / 3

  if (imported)
    return {
      width,
      height,
      ratio,
      duration,
      format: ext,
      imported,
      tags: h % 2 ? ['reference'] : [],
      workflow: 'missing',
      history: 'missing',
      metadata: a.type === 'text' || a.type === 'other' ? 'missing' : 'available',
      models: []
    }

  const kept = recent(a.when)
  const prompt = PROMPTS.find(([re]) => re.test(a.name))?.[1]
  const models = MODELS[template] ?? (prompt ? MODELS.image_z_image_turbo! : [])
  const seconds = 6 + (h % 70) / 2
  const node = a.type === 'video' ? 'WanImageToVideo' : 'CLIPTextEncode'
  const negative =
    prompt && h % 3 === 0 ? 'blurry, low quality, watermark, extra fingers' : undefined
  const params =
    prompt && (a.type === 'image' || a.type === 'video')
      ? {
          seed: h % 1000000000,
          steps: [8, 20, 28, 30][h % 4]!,
          cfg: [1, 3.5, 4, 7][h % 4]!,
          sampler: ['euler', 'res_multistep', 'dpmpp_2m', 'euler_ancestral'][h % 4]!
        }
      : undefined
  return {
    width,
    height,
    ratio,
    duration,
    format: ext,
    imported,
    tags: [['hero', 'client-review'], ['keeper'], [], ['draft', 'lighting']][h % 4]!,
    workflow: a.type === 'audio' ? 'missing' : 'available',
    history: kept ? 'available' : 'lost',
    metadata: 'available',
    prompt: kept ? prompt : undefined,
    promptNode: kept && prompt ? node : undefined,
    negative: kept ? negative : undefined,
    params: kept ? params : undefined,
    models: kept ? models : [],
    seconds: kept ? seconds : undefined,
    json: kept
      ? JSON.stringify(
          {
            prompt_id: `${(h % 0xffffff).toString(16)}-4c1e-9a7d`,
            status: { status_str: 'success', completed: true },
            execution_time: Number(seconds.toFixed(1)),
            outputs: { '9': { images: [{ filename: a.name, type: 'output' }] } },
            nodes: {
              '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: models[0] } },
              '3': { class_type: 'KSampler', inputs: params ?? {} },
              '6': { class_type: node, inputs: { text: prompt } },
              ...(negative ? { '7': { class_type: node, inputs: { text: negative } } } : {})
            }
          },
          null,
          2
        )
      : undefined
  }
}
