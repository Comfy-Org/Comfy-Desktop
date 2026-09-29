/**
 * Static manifest of curated "standard" benchmarks (Comfy Benchmarks — Goal 1).
 *
 * Each entry mirrors a workflow the Desktop already ships in the first-run
 * starter-template picker (the "get started" set), so an artist measures their
 * machine on the exact pipeline they already run, using models they already
 * downloaded — zero file wrangling. The list is intentionally small (prove the
 * loop, structure for growth).
 *
 * Format note: starter templates ship as UI *graph* JSON (`nodes[]`, and now
 * `definitions.subgraphs[]` — even "get started" is subgraph-based), but the
 * runner needs ComfyUI *API/prompt* JSON (`class_type` + `inputs`) because that
 * is the only shape ComfyUI's `/prompt` endpoint accepts. graph→API conversion
 * (subgraph flattening + stripping UI-only nodes like `MarkdownNote`) lives in
 * the ComfyUI frontend, not in Desktop main, so each benchmark ships a *pinned*
 * API-format snapshot flattened from the real template graph
 * (`assets/benchmarks/<workflowAsset>`). Pinning is a feature, not a shortcut:
 * benchmark numbers are only comparable across users if everyone runs byte-for-
 * byte the same graph, so the suite must snapshot + version templates regardless.
 * GOAL 2: a general subgraph-aware graph→API converter so any shown template (or
 * any user workflow) can be benchmarked without a hand-flattened snapshot.
 *
 * Shared between main (asset + model resolution, download, run) and the renderer
 * (card list, fit note, headline metrics). Keep it dependency-free and pure.
 */

/** One model file a benchmark needs, in the exact shape the managed
 *  model-download flow (`startManagedModelJob` / `areModelsPresent`) consumes. */
export interface StandardBenchmarkModel {
  /** Final on-disk filename. Must match the workflow's loader input (e.g.
   *  `UNETLoader.unet_name`) so a freshly-downloaded machine runs. */
  filename: string
  /** Whitelisted HTTPS source (huggingface.co / civitai). */
  url: string
  /** Models subdirectory, e.g. `diffusion_models`, `text_encoders`, `vae`. */
  directory: string
  /** Coarse download size in bytes (for the disk pre-check + card badge). */
  sizeBytes: number
}

export interface StandardBenchmark {
  /** Stable id; also the compare key and the stored workflow name. */
  id: string
  /** Card title, e.g. `Z-Image Turbo · 1024 Text-to-Image`. */
  name: string
  /** One-line "what it measures" for the card. */
  measures: string
  /** Spec line under `measures`, e.g. `1024px · 4 steps`. */
  specLine: string
  /** Recommended dedicated VRAM (GB) — drives the tier chip + fit note. */
  vramTierGb: number
  /** Total model bytes fetched on first run (sum of `models[].sizeBytes`). */
  downloadBytes: number
  /** Images produced per measured run. `1` for every Goal-1 benchmark, which
   *  is what lets the headline read honest `sec/image` rather than `sec/run`. */
  imagesPerRun: number
  /** Declared sampler steps; enables `it/s` (deferred/P1). Kept for growth. */
  samplerSteps: number | null
  /** Optional card thumbnail. Unused today (cards are text-only). */
  thumbnailUrl?: string
  /** Bundled API-format workflow asset filename under `assets/benchmarks/`. */
  workflowAsset: string
  /** Model files fetched through the existing managed model-download flow. */
  models: StandardBenchmarkModel[]
  /** Starter-template id this benchmark is flattened from (provenance + the key
   *  that ties the card to the same template shown on the install screen). */
  templateId?: string
}

/**
 * The curated set. Z-Image Turbo is the anchor: it is the default "get started"
 * template (`01_get_started_text_to_image`) that the large majority of installs
 * run first, so its models are already on disk for most users and the number
 * reflects the pipeline people actually use. Filenames + settings are pinned to
 * the template exactly (1024px, 4 steps, res_multistep) so results are
 * comparable across runs and machines.
 */
export const STANDARD_BENCHMARKS: readonly StandardBenchmark[] = [
  {
    id: 'z-image-turbo-1024',
    name: 'Z-Image Turbo · 1024 Text-to-Image',
    measures: 'The default get-started pipeline most machines run first',
    specLine: '1024px · 4 steps · res_multistep',
    vramTierGb: 16,
    downloadBytes: 20_690_152_836,
    imagesPerRun: 1,
    samplerSteps: 4,
    workflowAsset: 'z-image-turbo-1024.json',
    templateId: '01_get_started_text_to_image',
    models: [
      {
        filename: 'z_image_turbo_bf16.safetensors',
        url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors',
        directory: 'diffusion_models',
        sizeBytes: 12_309_866_400
      },
      {
        filename: 'qwen_3_4b.safetensors',
        url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors',
        directory: 'text_encoders',
        sizeBytes: 8_044_982_048
      },
      {
        filename: 'ae.safetensors',
        url: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors',
        directory: 'vae',
        sizeBytes: 335_304_388
      }
    ]
  }
] as const

/** Look up a benchmark by id. Returns `undefined` for an unknown id. */
export function findStandardBenchmark(id: string): StandardBenchmark | undefined {
  return STANDARD_BENCHMARKS.find((benchmark) => benchmark.id === id)
}
