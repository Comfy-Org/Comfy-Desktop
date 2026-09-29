import { describe, expect, it, vi } from 'vitest'

import {
  mapCoreBenchmarkCapture,
  pickRepresentativeCapture,
  readCoreBenchmarkCapture,
  readRepresentativeCoreBenchmark,
  resolveComfyOutputDir
} from './benchmarkCapture'
import type { CoreBenchmarkSummary } from '../../types/ipc'

/** Representative CUDA capture: dedicated GPU, util + power populated. */
const cudaCapture = {
  capture_schema_version: 1,
  collector_id: 'comfyui-core',
  device: {
    backend: 'cuda',
    gpu_model: 'NVIDIA GeForce RTX 5090',
    driver_version: '560.94',
    vram_is_unified: false,
    pytorch_version: '2.5.1+cu124',
    comfyui_version: '0.3.40',
    os: 'Windows 11',
    platform: 'win32',
    arch: 'x64',
    cpu_model: 'AMD Ryzen 9 7950X',
    cpu_cores_physical: 16,
    cpu_cores_logical: 32,
    total_vram_mb: 32768,
    total_ram_mb: 65536
  },
  durations: { total_run_ms: 4200, sampler_ms: 3600, node_total_ms: 4100 },
  nodes: [
    { node_id: '3', class_type: 'KSampler', elapsed_ms: 3600 },
    { node_id: '8', class_type: 'VAEDecode', elapsed_ms: 320 },
    { node_id: 4, class_type: 'CLIPTextEncode', elapsed_ms: 120 }
  ],
  sampling: {
    step_count: 4,
    step_durations_ms: [900, 900, 900, 900],
    per_step_it_per_s: [1.11, 1.11, null, 1.12],
    avg_it_per_s: 1.11
  },
  resources: {
    sample_interval_ms: 500,
    series: [
      {
        t_ms: 0,
        cpu_percent: 12,
        ram_used_mb: 20480,
        vram_used_mb: 8000,
        vram_util_percent: 24,
        power_w: 180
      },
      {
        t_ms: 500,
        cpu_percent: 30,
        ram_used_mb: 21000,
        vram_used_mb: 24000,
        vram_util_percent: 73,
        power_w: 420
      }
    ],
    peak: {
      vram_used_mb: 24000,
      ram_used_mb: 21000,
      cpu_percent: 30,
      vram_util_percent: 73,
      power_w: 420
    }
  }
}

/** Representative MPS capture: unified memory, util + power null throughout. */
const mpsCapture = {
  capture_schema_version: 1,
  collector_id: 'comfyui-core',
  device: {
    backend: 'mps',
    gpu_model: 'Apple M3 Max',
    driver_version: null,
    vram_is_unified: true,
    pytorch_version: '2.5.1',
    comfyui_version: '0.3.40',
    os: 'macOS 15.1',
    platform: 'darwin',
    arch: 'arm64',
    cpu_model: 'Apple M3 Max',
    cpu_cores_physical: 14,
    cpu_cores_logical: 14,
    total_vram_mb: 98304,
    total_ram_mb: 98304
  },
  durations: { total_run_ms: 15200, sampler_ms: 14000, node_total_ms: 15000 },
  nodes: [{ node_id: '3', class_type: 'KSampler', elapsed_ms: 14000 }],
  sampling: {
    step_count: 4,
    step_durations_ms: [3500, 3500, 3500, 3500],
    per_step_it_per_s: [0.28, 0.28, 0.28, 0.29],
    avg_it_per_s: 0.28
  },
  resources: {
    sample_interval_ms: 500,
    series: [
      {
        t_ms: 0,
        cpu_percent: 40,
        ram_used_mb: 30000,
        vram_used_mb: 30000,
        vram_util_percent: null,
        power_w: null
      }
    ],
    peak: {
      vram_used_mb: 42000,
      ram_used_mb: 42000,
      cpu_percent: 55,
      vram_util_percent: null,
      power_w: null
    }
  }
}

describe('mapCoreBenchmarkCapture', () => {
  it('maps a CUDA capture with util + power populated', () => {
    const summary = mapCoreBenchmarkCapture(cudaCapture, 'prompt-a')
    expect(summary).not.toBeNull()
    expect(summary!.promptId).toBe('prompt-a')
    expect(summary!.captureSchemaVersion).toBe(1)
    expect(summary!.collectorId).toBe('comfyui-core')
    expect(summary!.device.backend).toBe('cuda')
    expect(summary!.device.vramIsUnified).toBe(false)
    expect(summary!.device.driverVersion).toBe('560.94')
    expect(summary!.device.totalVramMb).toBe(32768)
    // it/s un-defers the previously "not measured" P1 metric.
    expect(summary!.sampling.avgItPerS).toBe(1.11)
    expect(summary!.sampling.stepCount).toBe(4)
    // per-step it/s is index-aligned; the 0ms step stays null (not dropped).
    expect(summary!.sampling.perStepItPerS).toEqual([1.11, 1.11, null, 1.12])
    // peak VRAM comes from resources.peak.vram_used_mb.
    expect(summary!.resources.peak.vramUsedMb).toBe(24000)
    expect(summary!.resources.peak.powerW).toBe(420)
    expect(summary!.resources.peak.vramUtilPercent).toBe(73)
    // per-op timeline preserved in order, numeric node_id coerced to string.
    expect(summary!.nodes.map((node) => node.classType)).toEqual([
      'KSampler',
      'VAEDecode',
      'CLIPTextEncode'
    ])
    expect(summary!.nodes[2]!.nodeId).toBe('4')
    expect(summary!.resources.series).toHaveLength(2)
    expect(summary!.resources.series[1]!.vramUsedMb).toBe(24000)
  })

  it('maps an MPS capture with null util + power (unified memory)', () => {
    const summary = mapCoreBenchmarkCapture(mpsCapture, 'prompt-mps')
    expect(summary).not.toBeNull()
    expect(summary!.device.backend).toBe('mps')
    expect(summary!.device.vramIsUnified).toBe(true)
    expect(summary!.device.driverVersion).toBeNull()
    expect(summary!.sampling.avgItPerS).toBe(0.28)
    expect(summary!.resources.peak.vramUsedMb).toBe(42000)
    // MPS reports no GPU utilization or power draw — stays null, never 0/NaN.
    expect(summary!.resources.peak.vramUtilPercent).toBeNull()
    expect(summary!.resources.peak.powerW).toBeNull()
    expect(summary!.resources.series[0]!.vramUtilPercent).toBeNull()
    expect(summary!.resources.series[0]!.powerW).toBeNull()
  })

  it('returns null for non-capture payloads and mismatched schema', () => {
    expect(mapCoreBenchmarkCapture(null, 'p')).toBeNull()
    expect(mapCoreBenchmarkCapture([], 'p')).toBeNull()
    expect(mapCoreBenchmarkCapture('nope', 'p')).toBeNull()
    expect(mapCoreBenchmarkCapture({ capture_schema_version: 2 }, 'p')).toBeNull()
    expect(mapCoreBenchmarkCapture({ foo: 'bar' }, 'p')).toBeNull()
  })

  it('accepts a v1 capture identified by collector_id even if schema is absent', () => {
    const summary = mapCoreBenchmarkCapture({ collector_id: 'comfyui-core' }, 'p')
    expect(summary).not.toBeNull()
    expect(summary!.captureSchemaVersion).toBeNull()
    expect(summary!.nodes).toEqual([])
    expect(summary!.sampling.avgItPerS).toBeNull()
    expect(summary!.resources.peak.vramUsedMb).toBeNull()
  })

  it('rejects non-finite numbers rather than surfacing NaN/Infinity', () => {
    const summary = mapCoreBenchmarkCapture(
      {
        capture_schema_version: 1,
        sampling: { avg_it_per_s: Number.NaN },
        resources: { peak: { vram_used_mb: Number.POSITIVE_INFINITY } }
      },
      'p'
    )
    expect(summary!.sampling.avgItPerS).toBeNull()
    expect(summary!.resources.peak.vramUsedMb).toBeNull()
  })
})

describe('resolveComfyOutputDir', () => {
  const shared = '/shared/output'

  it('uses the shared output dir by default', () => {
    expect(resolveComfyOutputDir({ installPath: '/i' }, shared)).toBe(shared)
    expect(resolveComfyOutputDir({ installPath: '/i', useSharedOutput: true }, shared)).toBe(shared)
  })

  it('uses the per-install output dir when shared output is off', () => {
    expect(
      resolveComfyOutputDir(
        { installPath: '/i', useSharedOutput: false, outputDir: '/custom/out' },
        shared
      )
    ).toBe('/custom/out')
  })

  it('falls back to ComfyUI default output under the install path', () => {
    const resolved = resolveComfyOutputDir({ installPath: '/i', useSharedOutput: false }, shared)
    expect(resolved.replace(/\\/g, '/')).toBe('/i/ComfyUI/output')
  })

  it('falls back to the adopted base dir output when adopted', () => {
    const resolved = resolveComfyOutputDir(
      {
        installPath: '/i',
        useSharedOutput: false,
        adopted: true,
        adoptedBaseDir: '/legacy/ComfyUI'
      },
      shared
    )
    expect(resolved.replace(/\\/g, '/')).toBe('/legacy/ComfyUI/output')
  })
})

describe('pickRepresentativeCapture', () => {
  const withTotal = (id: string, ms: number | null): CoreBenchmarkSummary =>
    ({
      promptId: id,
      durations: { totalRunMs: ms, samplerMs: null, nodeTotalMs: null }
    }) as CoreBenchmarkSummary

  it('returns null when there are no captures', () => {
    expect(pickRepresentativeCapture([])).toBeNull()
  })

  it('picks the median by total run duration', () => {
    const picked = pickRepresentativeCapture([
      withTotal('slow', 5000),
      withTotal('fast', 1000),
      withTotal('mid', 3000)
    ])
    expect(picked!.promptId).toBe('mid')
  })

  it('sorts captures missing a total duration last', () => {
    const picked = pickRepresentativeCapture([withTotal('a', null), withTotal('b', 2000)])
    expect(picked!.promptId).toBe('b')
  })
})

describe('readCoreBenchmarkCapture', () => {
  it('returns null when the capture file is absent', async () => {
    const readFile = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }))
    expect(await readCoreBenchmarkCapture('/out', 'prompt-a', { readFile })).toBeNull()
    expect(readFile).toHaveBeenCalledWith(expect.stringContaining('prompt-a.json'), 'utf8')
  })

  it('returns null on invalid JSON', async () => {
    const readFile = vi.fn().mockResolvedValue('{ not json')
    expect(await readCoreBenchmarkCapture('/out', 'p', { readFile })).toBeNull()
  })

  it('reads and maps a present capture file', async () => {
    const readFile = vi.fn().mockResolvedValue(JSON.stringify(cudaCapture))
    const summary = await readCoreBenchmarkCapture('/out', 'prompt-a', { readFile })
    expect(summary!.sampling.avgItPerS).toBe(1.11)
    expect(summary!.resources.peak.vramUsedMb).toBe(24000)
  })
})

describe('readRepresentativeCoreBenchmark', () => {
  it('returns null when no measured prompt produced a capture', async () => {
    const readFile = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }))
    expect(await readRepresentativeCoreBenchmark('/out', ['a', 'b'], { readFile })).toBeNull()
  })

  it('reads all present captures and returns the median run', async () => {
    const readFile = vi.fn(async (filePath: unknown) => {
      if (String(filePath).includes('mid')) {
        return JSON.stringify({ ...cudaCapture, durations: { total_run_ms: 3000 } })
      }
      if (String(filePath).includes('slow')) {
        return JSON.stringify({ ...cudaCapture, durations: { total_run_ms: 5000 } })
      }
      return JSON.stringify({ ...cudaCapture, durations: { total_run_ms: 1000 } })
    })
    const summary = await readRepresentativeCoreBenchmark('/out', ['fast', 'slow', 'mid'], {
      readFile
    })
    expect(summary!.durations.totalRunMs).toBe(3000)
  })
})
