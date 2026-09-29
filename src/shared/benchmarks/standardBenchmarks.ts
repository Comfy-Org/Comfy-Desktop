/**
 * Static manifest of curated "standard" benchmarks (Comfy Benchmarks — Goal 1).
 *
 * Each entry mirrors a workflow/model the Desktop already ships in the starter
 * template picker, so an artist can measure their machine on a real pipeline
 * with zero file wrangling. The list is intentionally small (prove the loop,
 * structure for growth) and is gated behind the `benchmark_standard_suite`
 * PostHog flag (default off) — the bring-your-own-workflow path is unchanged.
 *
 * Format note: starter templates ship as UI *graph* JSON (`nodes[]`), but the
 * performance-test runner needs ComfyUI *API/prompt* JSON (`class_type` +
 * `inputs`). Desktop main has no graph→API converter, so each benchmark ships a
 * pinned API-format copy as a bundled asset (`assets/benchmarks/<workflowAsset>`).
 * FUTURE ENHANCEMENT: derive the API graph from any shown template's graph JSON
 * (via `loadTemplateJson`) instead of shipping a hand-authored copy.
 *
 * Shared between main (asset + model resolution, download, run) and the renderer
 * (card list, fit note, headline metrics). Keep it dependency-free and pure.
 */

/** One model file a benchmark needs, in the exact shape the managed
 *  model-download flow (`startManagedModelJob` / `areModelsPresent`) consumes. */
export interface StandardBenchmarkModel {
  /** Final on-disk filename. Must match the workflow's loader input (e.g.
   *  `CheckpointLoaderSimple.ckpt_name`) so a freshly-downloaded machine runs. */
  filename: string
  /** Whitelisted HTTPS source (huggingface.co / civitai). */
  url: string
  /** Models subdirectory, e.g. `checkpoints`. */
  directory: string
  /** Coarse download size in bytes (for the disk pre-check + card badge). */
  sizeBytes: number
}

export interface StandardBenchmark {
  /** Stable id; also the compare key and the stored workflow name. */
  id: string
  /** Card title, e.g. `SD1.5 · 512 Text-to-Image`. */
  name: string
  /** One-line "what it measures" for the card. */
  measures: string
  /** Spec line under `measures`, e.g. `512px · 20 steps`. */
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
  /** Starter-template id this benchmark mirrors (models/thumbnail provenance).
   *  Documents the source; not used for resolution in Goal 1. */
  templateId?: string
}

/**
 * The curated set. SD1.5 512 is the anchor: a small single checkpoint that runs
 * on CUDA, MPS, and CPU, so every machine has a meaningful run. SDXL 1024 adds
 * a mid-tier point. Keep filenames + settings pinned so results are comparable
 * across runs and machines.
 */
export const STANDARD_BENCHMARKS: readonly StandardBenchmark[] = [
  {
    id: 'sd15-txt2img-512',
    name: 'SD1.5 · 512 Text-to-Image',
    measures: 'Baseline text-to-image throughput on a single checkpoint',
    specLine: '512px · 20 steps',
    vramTierGb: 6,
    downloadBytes: 2_132_600_000,
    imagesPerRun: 1,
    samplerSteps: 20,
    workflowAsset: 'sd15-txt2img-512.json',
    templateId: 'default',
    models: [
      {
        filename: 'v1-5-pruned-emaonly-fp16.safetensors',
        url: 'https://huggingface.co/Comfy-Org/stable-diffusion-v1-5-archive/resolve/main/v1-5-pruned-emaonly-fp16.safetensors',
        directory: 'checkpoints',
        sizeBytes: 2_132_600_000
      }
    ]
  },
  {
    id: 'sdxl-txt2img-1024',
    name: 'SDXL · 1024 Text-to-Image',
    measures: 'Mid-tier text-to-image throughput at 1024px',
    specLine: '1024px · 20 steps',
    vramTierGb: 12,
    downloadBytes: 6_938_040_000,
    imagesPerRun: 1,
    samplerSteps: 20,
    workflowAsset: 'sdxl-txt2img-1024.json',
    templateId: 'sdxl_simple_example',
    models: [
      {
        filename: 'sd_xl_base_1.0.safetensors',
        url: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors',
        directory: 'checkpoints',
        sizeBytes: 6_938_040_000
      }
    ]
  }
] as const

/** Look up a benchmark by id. Returns `undefined` for an unknown id. */
export function findStandardBenchmark(id: string): StandardBenchmark | undefined {
  return STANDARD_BENCHMARKS.find((benchmark) => benchmark.id === id)
}
