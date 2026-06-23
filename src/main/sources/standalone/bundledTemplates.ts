/**
 * Starter-template picker shown as the final step of the standalone install
 * wizard. Each entry's `id` is a real template id served by the
 * `comfyui_workflow_templates` package the install already ships, so opening it
 * needs no bundled assets — the desktop app appends `?template=<id>` to the
 * ComfyUI URL on first launch and the frontend's existing deeplink loader
 * (`useTemplateUrlLoader`) opens it on the canvas.
 *
 * The OFFERED list is intentionally curated (we keep it lightweight). The
 * REQUIRED MODELS for each, however, are derived dynamically at install time
 * from the template's workflow JSON (see `templateModels.ts`) — `sizeBytes`
 * here is only the index's coarse estimate, used for the wizard's "~X GB"
 * consent label before the precise per-file sizing of a later phase.
 *
 * Ids + titles + descriptions + sizes below were captured verbatim from the
 * live `Comfy-Org/workflow_templates` index. Before adding an id, confirm it
 * resolves to `/templates/<id>.json` and (for non-zero-model ones) that the
 * JSON carries a whitelisted `models[]` entry.
 */
/** Output modality a template showcases — one card per modality in the picker. */
export type TemplateModality = 'image' | 'video' | 'audio' | '3d'

export interface BundledTemplate {
  /** Real `comfyui_workflow_templates` id, matched against the frontend's
   *  `^[a-zA-Z0-9_.-]+$` deeplink validator. */
  id: string
  /** Output modality this template showcases. */
  modality: TemplateModality
  /** Card title — copied verbatim from the template index (`title`). */
  title: string
  /** Card subtitle — copied verbatim from the template index (`description`). */
  description: string
  /** Card thumbnail URL. The package ships a `<id>-1.webp` preview alongside the
   *  JSONs; we point at the public mirror so it renders before ComfyUI is up,
   *  matching the frontend's `/templates/<name>-1.<sub>` formula. */
  thumbnailUrl: string
  /** Coarse total download size estimate (bytes), from the index's `size`. Used
   *  only for the consent label + disk pre-check; the actual download set is
   *  resolved from the workflow JSON at install time. */
  sizeBytes: number
  /** Whether the bundled preview `.webp` is animated (motion templates) or a
   *  still frame. Drives the card's motion affordance + the reduced-motion swap
   *  to the paired `<id>-still.webp`. */
  previewKind: 'animated' | 'static'
}

/** Display order + i18n label key per modality, for the picker grid. */
export const TEMPLATE_MODALITY_ORDER: readonly TemplateModality[] = [
  'image',
  'video',
  'audio',
  '3d',
]

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

/** Bundled card thumbnail for a template — a downscaled `.webp` preview committed
 *  under `src/renderer/public/images/templates/`, served by Vite at `./images/…`
 *  (a `'self'` asset the renderer CSP allows). Bundling (vs fetching the remote
 *  `raw.githubusercontent.com` preview) keeps it CSP-safe and working offline /
 *  for first-ever users who have no template package on disk yet. */
const thumb = (id: string): string => `./images/templates/${id}.webp`

/**
 * One showcase template per modality. Ids + title/description/size are
 * copied VERBATIM from the live `comfyui_workflow_templates` index (the same
 * data the ComfyUI gallery renders) — all four verified to resolve and carry a
 * real (non-API, downloadable) model set. `sizeBytes` is the index's coarse
 * `size` (bytes); the precise download set is still resolved from the workflow
 * JSON at install time. To change a modality's pick, swap the id + paste that
 * entry's index metadata here.
 */
export const BUNDLED_TEMPLATES: readonly BundledTemplate[] = [
  {
    id: 'image_z_image_turbo',
    modality: 'image',
    title: 'Z-Image-Turbo Text to Image',
    description: 'Efficient single-stream diffusion transformer.',
    thumbnailUrl: thumb('image_z_image_turbo'),
    sizeBytes: 20830591386,
    previewKind: 'static',
  },
  {
    id: 'text_to_video_wan',
    modality: 'video',
    title: 'Wan 2.1 Text to Video',
    description: 'Generate videos from text prompts using Wan 2.1.',
    thumbnailUrl: thumb('text_to_video_wan'),
    sizeBytes: 9824737690,
    previewKind: 'animated',
  },
  {
    id: 'audio_stable_audio_3_medium',
    modality: 'audio',
    title: 'Stable Audio 3.0 Medium',
    description: 'Text-to-audio (music, SFX, instruments) with Stable Audio 3.',
    thumbnailUrl: thumb('audio_stable_audio_3_medium'),
    sizeBytes: 15676630630,
    previewKind: 'static',
  },
  {
    id: '3d_triposplat_image_to_gaussian_splat',
    modality: '3d',
    title: 'TripoSplat: Image to Gaussian Splat',
    description: 'Turn a single 2D image into a 3D Gaussian splat.',
    thumbnailUrl: thumb('3d_triposplat_image_to_gaussian_splat'),
    sizeBytes: 3972844749,
    previewKind: 'animated',
  },
] as const
