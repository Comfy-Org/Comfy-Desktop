/**
 * Model provisioning for standard benchmarks.
 *
 * A fresh machine needs the benchmark's checkpoint before the run. We reuse the
 * exact managed model-download flow used by starter templates
 * (`startManagedModelJob` + `areModelsPresent`) so the transfer appears in the
 * Downloads tray with working pause/resume/cancel and resumes across restarts.
 * The benchmark's pinned model list lives in the shared manifest; a future
 * enhancement could instead derive it from the source template's graph JSON via
 * `resolveTemplateModels`.
 */
import { startManagedModelJob } from './comfyDownloadManager'
import { areModelsPresent } from './modelDownloadPaths'
import type { StandardBenchmark } from '../../shared/benchmarks/standardBenchmarks'

/** The `{directory, filename}` shape `areModelsPresent` checks against disk. */
export function benchmarkModelPaths(
  benchmark: StandardBenchmark
): Array<{ directory: string; filename: string }> {
  return benchmark.models.map((model) => ({
    directory: model.directory,
    filename: model.filename
  }))
}

/** True when every model the benchmark needs is already on disk for this install. */
export function areBenchmarkModelsPresent(
  installationId: string | null,
  benchmark: StandardBenchmark
): Promise<boolean> {
  return areModelsPresent(installationId, benchmarkModelPaths(benchmark))
}

export interface EnsureBenchmarkModelsResult {
  /** True when all models are present (already, or after a successful download). */
  present: boolean
  /** True when at least one model was downloaded during this call. */
  downloaded: boolean
  message?: string
}

export interface EnsureBenchmarkModelsOptions {
  /** Aggregate progress across all model files (bytes). */
  onProgress?: (receivedBytes: number, totalBytes: number) => void
  signal?: AbortSignal
}

/**
 * Ensure the benchmark's models are on disk, downloading any that are missing.
 * Downloads run sequentially (Goal-1 benchmarks are single-checkpoint) and
 * report aggregate byte progress. Resolves `{ present: true }` once every file
 * has landed; resolves `{ present: false }` with a message on failure.
 */
export async function ensureBenchmarkModels(
  installationId: string | null,
  benchmark: StandardBenchmark,
  opts: EnsureBenchmarkModelsOptions = {}
): Promise<EnsureBenchmarkModelsResult> {
  if (await areBenchmarkModelsPresent(installationId, benchmark)) {
    return { present: true, downloaded: false }
  }

  // Per-file received/total counters, summed for the aggregate callback.
  const received = new Array(benchmark.models.length).fill(0)
  const total = benchmark.models.map((model) => model.sizeBytes)
  const report = (): void => {
    const sumReceived = received.reduce((sum: number, value: number) => sum + value, 0)
    const sumTotal = total.reduce((sum: number, value: number) => sum + value, 0)
    opts.onProgress?.(sumReceived, sumTotal)
  }

  for (let index = 0; index < benchmark.models.length; index++) {
    opts.signal?.throwIfAborted()
    const model = benchmark.models[index]!
    const handle = await startManagedModelJob({
      url: model.url,
      filename: model.filename,
      directory: model.directory,
      installationId,
      expectedSize: model.sizeBytes || undefined,
      onProgress: (receivedBytes, totalBytes) => {
        received[index] = receivedBytes
        if (totalBytes > 0) total[index] = totalBytes
        report()
      }
    })
    try {
      if (opts.signal?.aborted) {
        handle.release()
        return { present: false, downloaded: true, message: 'Model download cancelled.' }
      }
      const outcome = await handle.completion
      if (outcome.status === 'error') {
        return { present: false, downloaded: true, message: outcome.error }
      }
      if (outcome.status === 'cancelled') {
        return { present: false, downloaded: true, message: 'Model download cancelled.' }
      }
      received[index] = total[index] || received[index]
      report()
    } finally {
      handle.release()
    }
  }

  return { present: true, downloaded: true }
}
