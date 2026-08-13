/**
 * Hand-maintained selection of starter-template ids per modality for the
 * post-install picker. `templateCatalog.ts` hydrates display metadata from the
 * live index at runtime; the inline `snapshot` is the offline fallback.
 */

/** Output modality a template showcases — also the picker's tab grouping. */
export type TemplateModality = 'image' | 'video' | 'audio' | '3d'

/** Offline display metadata, mirrored from the live index. Live values win at
 *  runtime; these fill gaps and stand in fully when the index is unreachable. */
export interface TemplateSnapshot {
  /** Card title — verbatim from the index `title`. */
  title: string
  /** Card subtitle — verbatim from the index `description`. */
  description: string
  /** Coarse total download estimate (bytes), from the index `size`. */
  sizeBytes: number
  /** Thumbnail file extension, from the index `mediaSubtype` (`webp` | `mp3`). */
  mediaSubtype: string
}

interface CuratedTemplateBase {
  /** Real `comfyui_workflow_templates` id; matches the frontend deeplink
   *  validator `^[a-zA-Z0-9_.-]+$`. */
  id: string
  /** Output modality this template showcases. */
  modality: TemplateModality
  /** Offline display metadata; superseded by the live index when available. */
  snapshot: TemplateSnapshot
}

/**
 * `recommended` is the auto-selected pick for its modality (at most one each);
 * `apiNode` runs on API nodes, downloading nothing but spending credits per run.
 * Mutually exclusive by type — the auto-selected pick must never cost money.
 */
export type CuratedTemplate = CuratedTemplateBase &
  ({ recommended?: true; apiNode?: never } | { apiNode: true; recommended?: never })

/** Tab order in the picker — one tab per modality that has ≥1 curated template. */
export const TEMPLATE_MODALITY_ORDER: readonly TemplateModality[] = [
  'video',
  'image',
  '3d',
  'audio'
]

const RAW_TEMPLATES_REPO = 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main'
export const RAW_TEMPLATES_BASE = `${RAW_TEMPLATES_REPO}/templates`
export const TEMPLATE_INPUT_BASE = `${RAW_TEMPLATES_REPO}/input`

/** The catalog index: every template grouped by category, with display metadata
 *  and the coarse `size` estimate. One fetch hydrates the whole picker. */
export const INDEX_URL = `${RAW_TEMPLATES_BASE}/index.json`

/** Subtypes whose `<id>-1.<sub>` preview is an actual image the picker can show
 *  in an `<img>`. Audio templates report `mp3` (the preview is the audio clip,
 *  not an image), so they render the modality glyph instead. */
const IMAGE_SUBTYPES = new Set(['webp', 'png', 'jpg', 'jpeg', 'gif', 'avif'])

/**
 * Card thumbnail URL for a template — the index's `<id>-1.<mediaSubtype>`
 * preview, served straight from the templates repo. Returns `null` when the
 * subtype isn't an image (e.g. `mp3`), so the caller falls back to the glyph
 * without a doomed network request. Pure + exported for reuse and tests.
 */
export function thumbnailUrlFor(id: string, mediaSubtype: string): string | null {
  const ext = (mediaSubtype || 'webp').toLowerCase()
  if (!IMAGE_SUBTYPES.has(ext)) return null
  return `${RAW_TEMPLATES_BASE}/${id}-1.${ext}`
}

/**
 * Decorate the ComfyUI URL so the frontend auto-opens `templateId` on first
 * launch (`?template=<id>&source=default`, read by `useTemplateUrlLoader`).
 * Returns the URL unchanged if it can't be parsed, so a malformed address still
 * launches (just without the auto-open). Pure + exported for unit testing.
 */
export function buildTemplateDeeplink(comfyUrl: string, templateId: string): string {
  try {
    const url = new URL(comfyUrl)
    url.searchParams.set('template', templateId)
    url.searchParams.set('source', 'default')
    return url.toString()
  } catch {
    return comfyUrl
  }
}

/** Sentinel "skip" option value — keeps the wizard step optional. */
export const NO_TEMPLATE_VALUE = 'none'

/** A template id is a single path-safe segment: the frontend deeplink validator
 *  pattern (`^[a-zA-Z0-9_.-]+$`). No `/` or `\`, so it can't escape the templates
 *  dir when joined into a filesystem path or interpolated into a fetch URL. */
const TEMPLATE_ID_PATTERN = /^[a-zA-Z0-9_.-]+$/

/**
 * Whether `value` is a persistable starter-template id. Accepts any
 * format-valid id (curated *or* a live-index substitute), not just the static
 * curated set, so a substituted card still installs; rejects the "skip"
 * sentinel and anything that could escape a path/URL. A bogus-but-valid id
 * degrades gracefully downstream (the template JSON just 404s).
 */
export function isPersistableTemplateId(value: unknown): value is string {
  return typeof value === 'string' && value !== NO_TEMPLATE_VALUE && TEMPLATE_ID_PATTERN.test(value)
}

/**
 * 4 templates per modality:
 * - Slot 1 (`recommended`): default open-source pick
 * - Slot 2: API-node demo
 * - Slots 3-4: remaining open-source picks, lightest first
 * To update, change the id and sync the template's
 * title/description/size/mediaSubtype into `snapshot`.
 */
export const CURATED_TEMPLATES: readonly CuratedTemplate[] = [
  // --- Image ---
  {
    id: 'image_z_image_turbo',
    modality: 'image',
    recommended: true,
    snapshot: {
      title: 'Z-Image-Turbo Text to Image',
      description:
        'An Efficient Image Generation Foundation Model with Single-Stream Diffusion Transformer, supports English & Chinese.',
      sizeBytes: 20830591386,
      mediaSubtype: 'webp'
    }
  },
  {
    id: 'api_bytedance_seedream_5_0_pro_image_edit',
    modality: 'image',
    apiNode: true,
    snapshot: {
      title: 'Seedream 5.0 Pro: Image Edit',
      description:
        'Edit images with precision using Seedream 5.0 Pro, targeting specific regions while preserving lighting, depth, and texture. The workflow takes 1 input image and produces 2 output images through an optional Painter node and preview. Ideal for product photography edits, portrait consistency adjustments, and creating structured layouts with multilingual text.',
      sizeBytes: 0,
      mediaSubtype: 'webp'
    }
  },
  {
    id: 'sdxlturbo_example',
    modality: 'image',
    snapshot: {
      title: 'SDXL Turbo',
      description: 'Generate images in a single step using SDXL Turbo.',
      sizeBytes: 6936372183,
      mediaSubtype: 'webp'
    }
  },
  {
    id: 'image_pixeldit_t2i',
    modality: 'image',
    snapshot: {
      title: 'PixelDiT: Text to Image',
      description:
        "Input a text prompt and optional negative prompt. Generate a 1024px image using PixelDiT's VAE-free pixel diffusion transformer.",
      sizeBytes: 7838315315,
      mediaSubtype: 'webp'
    }
  },

  // --- Video ---
  {
    id: 'video_minimax_h3_t2v',
    modality: 'video',
    recommended: true,
    snapshot: {
      title: 'MiniMax H3: Text to Video',
      description:
        'Generate video with native stereo audio directly from a text prompt using MiniMax H3, an omni-modal model that synthesizes voice, sound effects, and music in a single pass. Output is up to 2K resolution, 24fps, and roughly 15 seconds long, with no file inputs required — just a prompt to one video output. Ideal for rapid concept visualization, social media content creation, and audio-synced storytelling.',
      sizeBytes: 56908316672,
      mediaSubtype: 'webp'
    }
  },
  {
    id: 'api_seedance2_5_r2v',
    modality: 'video',
    apiNode: true,
    snapshot: {
      title: 'Seedance 2.5: Reference to Video',
      description:
        'Generate reference-driven videos with Seedance 2.5 by supplying up to 20 images, 6 video clips, and 6 audio clips to control character consistency, visual style, and motion rhythm in a single 4–30 second output with synchronized sound and lip-synced dialogue. Ideal for e-commerce product showcases, brand advertising, and character-driven short series.',
      sizeBytes: 0,
      mediaSubtype: 'webp'
    }
  },
  {
    id: 'wan2.1_fun_inp',
    modality: 'video',
    snapshot: {
      title: 'Wan 2.1 Inpainting',
      description: 'Generate videos from start and end frames using Wan 2.1 inpainting.',
      sizeBytes: 11381663334,
      mediaSubtype: 'webp'
    }
  },
  {
    id: 'video_wan2.1_fun_camera_v1.1_1.3B',
    modality: 'video',
    snapshot: {
      title: 'Wan 2.1 Fun Camera 1.3B',
      description:
        'Generate dynamic videos with cinematic camera movements using Wan 2.1 Fun Camera 1.3B model.',
      sizeBytes: 11489037517,
      mediaSubtype: 'webp'
    }
  },

  // --- 3D ---
  {
    id: '3d_triposplat_image_to_gaussian_splat',
    modality: '3d',
    recommended: true,
    snapshot: {
      title: 'TripoSplat: Image to Gaussian Splat',
      description:
        'Upload a single 2D image. Generate a high-quality 3D Gaussian splat representation with controllable density and budget for rendering.',
      sizeBytes: 3972844749,
      mediaSubtype: 'webp'
    }
  },
  {
    id: 'api_tripo3_1_image_to_model',
    modality: '3d',
    apiNode: true,
    snapshot: {
      title: 'Tripo H3.1: Image to Model',
      description:
        'Upload a reference image of your object. Generate a high-detail 3D model with dense geometry and PBR-ready materials.',
      sizeBytes: 0,
      mediaSubtype: 'webp'
    }
  },
  {
    id: '3d_moge_perspective_to_mesh',
    modality: '3d',
    snapshot: {
      title: 'MoGe: Perspective Geometry Estimation',
      description:
        'Upload an image to estimate its perspective geometry. Generate a 3D depth map and surface normals from the input.',
      sizeBytes: 644245094,
      mediaSubtype: 'webp'
    }
  },
  {
    id: '3d_hunyuan3d_multiview_to_model_turbo',
    modality: '3d',
    snapshot: {
      title: 'HY 3D 2.0 MV Turbo',
      description: 'Generate 3D models from multiple views using Hunyuan3D 2.0 MV Turbo.',
      sizeBytes: 4928474972,
      mediaSubtype: 'webp'
    }
  },

  // --- Audio ---
  {
    id: 'audio_stable_audio_3_medium',
    modality: 'audio',
    recommended: true,
    snapshot: {
      title: 'Stable Audio 3.0 Medium',
      description:
        'Input a short text idea, optional duration, seed, and category. Generate stereo audio (music, SFX, or instruments) using Stable Audio 3 with optional AI-driven text expansion.',
      sizeBytes: 15676630630,
      mediaSubtype: 'webp'
    }
  },
  {
    id: 'api_bytedance_seed_audio1_0_t2a',
    modality: 'audio',
    apiNode: true,
    snapshot: {
      title: 'Seed Audio 1.0: Text to Audio',
      description:
        'Input a text prompt to generate speech, dialogue, background music, and sound effects in one audio file. Describe voices, emotion, and scene details to create multi-speaker audio up to 2 minutes.',
      sizeBytes: 0,
      mediaSubtype: 'webp'
    }
  },
  {
    id: 'audio_stable_audio_example',
    modality: 'audio',
    snapshot: {
      title: 'Stable Audio 1.0: Text to Audio',
      description: 'Generate audio from text prompts using Stable Audio.',
      sizeBytes: 5690831667,
      mediaSubtype: 'webp'
    }
  },
  {
    id: 'audio_ace_step_1_5_checkpoint',
    modality: 'audio',
    snapshot: {
      title: 'ACE-Step 1.5 Music Generation AIO',
      description:
        'Input style tags and lyrics to generate a full song. The workflow uses the ACE-Step 1.5 model to produce commercial-grade music in under 10 seconds on consumer hardware.',
      sizeBytes: 10737418240,
      mediaSubtype: 'mp3'
    }
  }
] as const
