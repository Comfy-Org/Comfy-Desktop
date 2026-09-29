import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StandardBenchmark } from '../../shared/benchmarks/standardBenchmarks'

const areModelsPresent = vi.fn()
const startManagedModelJob = vi.fn()

vi.mock('./modelDownloadPaths', () => ({
  areModelsPresent: (...args: unknown[]) => areModelsPresent(...args)
}))
vi.mock('./comfyDownloadManager', () => ({
  startManagedModelJob: (...args: unknown[]) => startManagedModelJob(...args)
}))

const { ensureBenchmarkModels, benchmarkModelPaths } = await import('./benchmarkModels')

const benchmark: StandardBenchmark = {
  id: 'test',
  name: 'Test',
  measures: 'x',
  specLine: 'x',
  vramTierGb: 8,
  downloadBytes: 300,
  imagesPerRun: 1,
  samplerSteps: 4,
  workflowAsset: 'test.json',
  models: [
    {
      filename: 'a.safetensors',
      url: 'https://h/a',
      directory: 'diffusion_models',
      sizeBytes: 100
    },
    { filename: 'b.safetensors', url: 'https://h/b', directory: 'text_encoders', sizeBytes: 200 }
  ]
}

// A managed-job handle whose download succeeds. ensureBenchmarkModels reports
// full per-file bytes on completion, so the mock need not emit progress itself.
const succeedingJob = () => ({
  completion: Promise.resolve({ status: 'success' as const }),
  release: vi.fn()
})

beforeEach(() => {
  areModelsPresent.mockReset()
  startManagedModelJob.mockReset()
})

describe('ensureBenchmarkModels', () => {
  it('skips download when every model is already present', async () => {
    areModelsPresent.mockResolvedValue(true)
    const result = await ensureBenchmarkModels('inst', benchmark)
    expect(result).toEqual({ present: true, downloaded: false })
    expect(startManagedModelJob).not.toHaveBeenCalled()
  })

  it('downloads every model when they are missing, into their declared dirs', async () => {
    areModelsPresent.mockResolvedValue(false)
    startManagedModelJob.mockImplementation(() => succeedingJob())
    const onProgress = vi.fn()

    const result = await ensureBenchmarkModels('inst', benchmark, { onProgress })

    expect(result).toEqual({ present: true, downloaded: true })
    expect(startManagedModelJob).toHaveBeenCalledTimes(2)
    const dirs = startManagedModelJob.mock.calls.map((c) => c[0].directory)
    expect(dirs).toEqual(['diffusion_models', 'text_encoders'])
    // final aggregate progress reaches the full download size
    expect(onProgress).toHaveBeenLastCalledWith(300, 300)
  })

  it('stops and reports when a download fails, without marking present', async () => {
    areModelsPresent.mockResolvedValue(false)
    startManagedModelJob.mockImplementationOnce(() => ({
      completion: Promise.resolve({ status: 'error' as const, error: 'boom' }),
      release: vi.fn()
    }))
    const result = await ensureBenchmarkModels('inst', benchmark)
    expect(result).toEqual({ present: false, downloaded: true, message: 'boom' })
    expect(startManagedModelJob).toHaveBeenCalledTimes(1)
  })
})

describe('benchmarkModelPaths', () => {
  it('projects the {directory, filename} the presence check consumes', () => {
    expect(benchmarkModelPaths(benchmark)).toEqual([
      { directory: 'diffusion_models', filename: 'a.safetensors' },
      { directory: 'text_encoders', filename: 'b.safetensors' }
    ])
  })
})
