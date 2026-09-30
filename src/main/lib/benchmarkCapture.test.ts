import { describe, expect, it, vi } from 'vitest'

import {
  computeSteadyStateItPerS,
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

/**
 * Representative schema-v2 CUDA capture. The first measured sampler step (0.31
 * it/s ≈ 3.2 s) is the one-time allocator warm-up; steps 1..n are steady state
 * (~11 it/s ≈ 90 ms). `avg_it_per_s` (8.4) folds the warm-up in; the derived
 * `steadyStateItPerS` must exclude it.
 */
const cudaCaptureV2 = {
  capture_schema_version: 2,
  collector_id: 'comfyui-core',
  run: {
    status: 'completed',
    image_count: 1,
    batch_size: 1,
    benchmark_id: 'z-image-turbo',
    benchmark_version: '2.0',
    warmup_runs: 1,
    measured_runs: 3,
    seed: 42
  },
  workflow: {
    resolution: { width: 1024, height: 1024 },
    steps: 8,
    sampler: 'euler',
    scheduler: 'simple',
    cfg: 1.0,
    denoise: 1.0,
    seed: 42,
    samplers: [
      {
        node_id: 3,
        class_type: 'KSampler',
        steps: 8,
        sampler: 'euler',
        scheduler: 'simple',
        cfg: 1.0,
        denoise: 1.0,
        seed: 42
      }
    ]
  },
  device: {
    backend: 'cuda',
    gpu_model: 'NVIDIA GeForce RTX 5090',
    driver_version: '560.94',
    vram_is_unified: false,
    pytorch_version: '2.5.1+cu124',
    comfyui_version: '0.3.50',
    os: 'Windows 11',
    platform: 'win32',
    arch: 'x64',
    cpu_model: 'AMD Ryzen 9 7950X',
    cpu_cores_physical: 16,
    cpu_cores_logical: 32,
    total_vram_mb: 32768,
    total_ram_mb: 65536,
    vram_state: 'NORMAL_VRAM',
    offloaded: false,
    weight_dtype: 'fp8_e4m3fn',
    compute_dtype: 'bf16',
    attention_impl: 'sage',
    cuda_version: '12.4',
    cudnn_version: '90100',
    compute_capability: 9.0,
    is_laptop: false,
    pcie_gen: 5,
    pcie_width: 16,
    baseline: {
      vram_used_mb: 800,
      vram_util_percent: 2,
      temperature_c: 38,
      ram_used_mb: 12000,
      cpu_percent: 3
    }
  },
  durations: { total_run_ms: 4200, sampler_ms: 3600, node_total_ms: 4100, model_load_ms: 5200 },
  nodes: [
    { node_id: '3', class_type: 'KSampler', elapsed_ms: 3600 },
    { node_id: '8', class_type: 'VAEDecode', elapsed_ms: 320 }
  ],
  sampling: {
    step_count: 8,
    per_step_it_per_s: [0.31, 11.0, 11.2, 10.8, 11.1, 10.9, 11.0, 11.0],
    avg_it_per_s: 8.4
  },
  resources: {
    sample_interval_ms: 250,
    series: [
      {
        t_ms: 0,
        cpu_percent: 5,
        ram_used_mb: 12000,
        vram_used_mb: 1000,
        vram_util_percent: 5,
        power_w: 120,
        temperature_c: 40,
        sm_clock_mhz: 2500,
        mem_clock_mhz: 10000,
        power_limit_w: 575
      },
      {
        t_ms: 250,
        cpu_percent: 20,
        ram_used_mb: 13000,
        vram_used_mb: 22000,
        vram_util_percent: 95,
        power_w: 520,
        temperature_c: 64,
        sm_clock_mhz: 2700,
        mem_clock_mhz: 11000,
        power_limit_w: 575
      }
    ],
    peak: {
      vram_used_mb: 22000,
      ram_used_mb: 13000,
      cpu_percent: 20,
      vram_util_percent: 95,
      power_w: 540,
      temperature_c: 67,
      sm_clock_mhz: 2700,
      mem_clock_mhz: 11000,
      power_limit_w: 575,
      throttled: false
    }
  },
  summary: { energy_wh_per_image: 3.4, sec_per_image: 4.2, throttled: false }
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

  it('returns null for non-capture payloads and unknown schema', () => {
    expect(mapCoreBenchmarkCapture(null, 'p')).toBeNull()
    expect(mapCoreBenchmarkCapture([], 'p')).toBeNull()
    expect(mapCoreBenchmarkCapture('nope', 'p')).toBeNull()
    // A future/incompatible schema with no collector id is ignored (fallback path).
    expect(mapCoreBenchmarkCapture({ capture_schema_version: 4 }, 'p')).toBeNull()
    expect(mapCoreBenchmarkCapture({ foo: 'bar' }, 'p')).toBeNull()
  })

  it('rejects a future schema even when it self-identifies as comfyui-core', () => {
    // m3: a breaking future schema (v4) must NOT be parsed with v3 assumptions, even
    // when collector_id matches — we degrade to the /system_stats fallback instead.
    expect(
      mapCoreBenchmarkCapture(
        { ...cudaCaptureV2, capture_schema_version: 4, collector_id: 'comfyui-core' },
        'prompt-v4'
      )
    ).toBeNull()
    // A known schema (v2) still parses even without a collector id.
    expect(
      mapCoreBenchmarkCapture({ capture_schema_version: 2 }, 'prompt-v2-nocollector')
    ).not.toBeNull()
  })

  it('v3: maps power cap from device and throttle from summary (hoisted out of series/peak)', () => {
    // v3 moves the constant power cap to `device.power_limit_w` and keeps the throttle
    // rollup only in `summary` — neither appears per-sample or in peak anymore.
    const v3 = {
      ...cudaCaptureV2,
      capture_schema_version: 3,
      collector_id: 'comfyui-core',
      device: { ...(cudaCaptureV2 as { device: object }).device, power_limit_w: 575 },
      resources: {
        sample_interval_ms: 500,
        series: [
          { t_ms: 0, vram_used_mb: 500, power_w: 60, temperature_c: 50 },
          { t_ms: 500, vram_used_mb: 900, power_w: 560, temperature_c: 74 }
        ],
        // no power_limit_w, no throttled in peak (v3)
        peak: { vram_used_mb: 900, power_w: 560, temperature_c: 74 }
      },
      summary: { energy_wh_per_image: 2.1, sec_per_image: 4.0, throttled: true }
    }
    const s = mapCoreBenchmarkCapture(v3, 'prompt-v3')
    expect(s).not.toBeNull()
    expect(s!.captureSchemaVersion).toBe(3)
    // power cap recovered from device even though peak/series omit it
    expect(s!.resources.peak.powerLimitW).toBe(575)
    expect(s!.resources.series[0]!.powerLimitW).toBeNull() // gone from samples
    // throttle recovered from summary even though peak omits it
    expect(s!.resources.peak.throttled).toBe(true)
    expect(s!.summary.throttled).toBe(true)
  })

  it('back-compat: a v1 capture still maps, with v2-only fields null', () => {
    const summary = mapCoreBenchmarkCapture(cudaCapture, 'prompt-v1')
    expect(summary).not.toBeNull()
    expect(summary!.captureSchemaVersion).toBe(1)
    // v2 groups are present on the shape but carry nulls / empties on a v1 file.
    expect(summary!.run.status).toBeNull()
    expect(summary!.run.measuredRuns).toBeNull()
    expect(summary!.workflow.steps).toBeNull()
    expect(summary!.workflow.resolution.width).toBeNull()
    expect(summary!.workflow.samplers).toEqual([])
    expect(summary!.device.vramState).toBeNull()
    expect(summary!.device.weightDtype).toBeNull()
    expect(summary!.device.baseline.temperatureC).toBeNull()
    expect(summary!.durations.modelLoadMs).toBeNull()
    expect(summary!.resources.peak.temperatureC).toBeNull()
    expect(summary!.resources.peak.powerLimitW).toBeNull()
    expect(summary!.resources.peak.throttled).toBeNull()
    expect(summary!.resources.series[0]!.temperatureC).toBeNull()
    expect(summary!.summary.energyWhPerImage).toBeNull()
    expect(summary!.summary.throttled).toBeNull()
  })

  it('maps a v2 capture and carries the new run/workflow/device/summary fields', () => {
    const summary = mapCoreBenchmarkCapture(cudaCaptureV2, 'prompt-v2')
    expect(summary).not.toBeNull()
    expect(summary!.captureSchemaVersion).toBe(2)
    // run
    expect(summary!.run.status).toBe('completed')
    expect(summary!.run.imageCount).toBe(1)
    expect(summary!.run.warmupRuns).toBe(1)
    expect(summary!.run.measuredRuns).toBe(3)
    // workflow
    expect(summary!.workflow.resolution).toEqual({ width: 1024, height: 1024 })
    expect(summary!.workflow.steps).toBe(8)
    expect(summary!.workflow.sampler).toBe('euler')
    // samplers: per-sampler objects map through (numeric node_id coerced to string).
    expect(summary!.workflow.samplers).toEqual([
      {
        nodeId: '3',
        classType: 'KSampler',
        steps: 8,
        sampler: 'euler',
        scheduler: 'simple',
        cfg: 1.0,
        denoise: 1.0,
        seed: 42
      }
    ])
    // device v2
    expect(summary!.device.vramState).toBe('NORMAL_VRAM')
    expect(summary!.device.offloaded).toBe(false)
    expect(summary!.device.weightDtype).toBe('fp8_e4m3fn')
    expect(summary!.device.computeDtype).toBe('bf16')
    expect(summary!.device.attentionImpl).toBe('sage')
    expect(summary!.device.cudaVersion).toBe('12.4')
    // cudnn_version arrives as an int (90100) — must coerce to string, not drop to null.
    expect(summary!.device.cudnnVersion).toBe('90100')
    // numeric compute_capability coerced to string.
    expect(summary!.device.computeCapability).toBe('9')
    expect(summary!.device.pcieGen).toBe(5)
    expect(summary!.device.baseline.temperatureC).toBe(38)
    // durations
    expect(summary!.durations.modelLoadMs).toBe(5200)
    // resources v2
    expect(summary!.resources.peak.temperatureC).toBe(67)
    expect(summary!.resources.peak.powerLimitW).toBe(575)
    expect(summary!.resources.peak.throttled).toBe(false)
    expect(summary!.resources.series[1]!.temperatureC).toBe(64)
    expect(summary!.resources.series[1]!.smClockMhz).toBe(2700)
    // summary
    expect(summary!.summary.energyWhPerImage).toBe(3.4)
    expect(summary!.summary.secPerImage).toBe(4.2)
    expect(summary!.summary.throttled).toBe(false)
  })

  it('derives steady-state it/s by excluding the first (warm-up) step', () => {
    const summary = mapCoreBenchmarkCapture(cudaCaptureV2, 'prompt-v2')
    // Raw avg (8.4) is dragged down by the 0.31 it/s warm-up first step.
    expect(summary!.sampling.avgItPerS).toBe(8.4)
    // Steady state = mean of steps 1..7 (~11 it/s), first step excluded.
    expect(summary!.sampling.steadyStateItPerS).toBeCloseTo(11.0, 5)
    expect(summary!.sampling.steadyStateItPerS).not.toBe(summary!.sampling.avgItPerS)
  })

  it('steady-state falls back to raw avg for the null/short MPS case', () => {
    // MPS sample: per_step is [0.28, 0.28, 0.28, 0.29] (no warm-up outlier).
    const summary = mapCoreBenchmarkCapture(mpsCapture, 'prompt-mps')
    // Excludes the first step; mean of [0.28, 0.28, 0.29].
    expect(summary!.sampling.steadyStateItPerS).toBeCloseTo((0.28 + 0.28 + 0.29) / 3, 5)

    // A capture with a single measured step has nothing to exclude -> raw avg.
    const oneStep = mapCoreBenchmarkCapture(
      {
        capture_schema_version: 2,
        collector_id: 'comfyui-core',
        sampling: { step_count: 1, per_step_it_per_s: [5.0], avg_it_per_s: 5.0 }
      },
      'p'
    )
    expect(oneStep!.sampling.steadyStateItPerS).toBe(5.0)
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

describe('computeSteadyStateItPerS', () => {
  it('excludes the first step and averages the rest', () => {
    // First step is the warm-up outlier; steady state is the mean of the rest.
    expect(computeSteadyStateItPerS([0.3, 11, 11, 11], 8.3)).toBeCloseTo(11, 5)
  })

  it('ignores null / non-finite per-step entries in the mean', () => {
    expect(computeSteadyStateItPerS([0.3, 10, null, 12], 7)).toBeCloseTo(11, 5)
  })

  it('falls back to the raw average when there are fewer than 2 steps', () => {
    expect(computeSteadyStateItPerS([], 4.2)).toBe(4.2)
    expect(computeSteadyStateItPerS([9.9], 4.2)).toBe(4.2)
  })

  it('falls back to the raw average when only the first step is finite', () => {
    expect(computeSteadyStateItPerS([9.9, null, null], 4.2)).toBe(4.2)
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

  it('unlinks each capture file it successfully read (B1: no unbounded disk growth)', async () => {
    const readFile = vi.fn().mockResolvedValue(JSON.stringify(cudaCapture))
    const unlink = vi.fn().mockResolvedValue(undefined)
    await readRepresentativeCoreBenchmark('/out', ['a', 'b'], { readFile, unlink })
    expect(unlink).toHaveBeenCalledTimes(2)
    expect(unlink).toHaveBeenCalledWith(expect.stringContaining('a.json'))
    expect(unlink).toHaveBeenCalledWith(expect.stringContaining('b.json'))
  })

  it('does NOT unlink a capture it failed to read (left on disk for debugging)', async () => {
    // 'good' reads + maps; 'bad' is missing (ENOENT) and must be left in place.
    const readFile = vi.fn(async (filePath: unknown) => {
      if (String(filePath).includes('bad')) {
        throw Object.assign(new Error('nope'), { code: 'ENOENT' })
      }
      return JSON.stringify(cudaCapture)
    })
    const unlink = vi.fn().mockResolvedValue(undefined)
    await readRepresentativeCoreBenchmark('/out', ['good', 'bad'], { readFile, unlink })
    expect(unlink).toHaveBeenCalledTimes(1)
    expect(unlink).toHaveBeenCalledWith(expect.stringContaining('good.json'))
    expect(unlink).not.toHaveBeenCalledWith(expect.stringContaining('bad.json'))
  })

  it('does NOT unlink a file that read but failed to map (future schema left on disk)', async () => {
    // File is present + valid JSON but a future schema -> mapCoreBenchmarkCapture returns
    // null. Treated as a read-failure for cleanup purposes: leave it for debugging.
    const readFile = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ capture_schema_version: 4, collector_id: 'comfyui-core' })
      )
    const unlink = vi.fn().mockResolvedValue(undefined)
    const summary = await readRepresentativeCoreBenchmark('/out', ['future'], { readFile, unlink })
    expect(summary).toBeNull()
    expect(unlink).not.toHaveBeenCalled()
  })

  it('swallows unlink errors — a failed delete never breaks the results summary', async () => {
    const readFile = vi.fn().mockResolvedValue(JSON.stringify(cudaCapture))
    const unlink = vi.fn().mockRejectedValue(new Error('EPERM'))
    const summary = await readRepresentativeCoreBenchmark('/out', ['a'], { readFile, unlink })
    expect(summary).not.toBeNull()
    expect(unlink).toHaveBeenCalledTimes(1)
  })
})
