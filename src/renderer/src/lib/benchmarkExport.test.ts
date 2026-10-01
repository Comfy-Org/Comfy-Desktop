import { describe, it, expect } from 'vitest'

import { BENCHMARK_CSV_COLUMNS, buildBenchmarkCsv, buildBenchmarkJson } from './benchmarkExport'
import type { CoreBenchmarkSummary, PerformanceTestBenchmark } from '../types/ipc'

function coreBenchmark(overrides: Partial<CoreBenchmarkSummary> = {}): CoreBenchmarkSummary {
  return {
    promptId: 'prompt-1',
    captureSchemaVersion: 2,
    collectorId: 'comfyui-core',
    run: {
      status: 'completed',
      imageCount: 2,
      batchSize: 1,
      benchmarkId: 'z-image-turbo',
      benchmarkVersion: '1',
      warmupRuns: 1,
      measuredRuns: 3,
      seed: 42
    },
    workflow: {
      resolution: { width: 1024, height: 1024 },
      steps: 8,
      sampler: 'euler',
      scheduler: 'simple',
      cfg: 1,
      denoise: 1,
      seed: 42,
      samplers: []
    },
    device: {
      backend: 'cuda',
      gpuModel: 'NVIDIA GeForce RTX 5090',
      driverVersion: '560.1',
      vramIsUnified: false,
      pytorchVersion: '2.10.0',
      comfyuiVersion: '0.34.0',
      os: 'Windows',
      platform: 'win32',
      arch: 'x64',
      cpuModel: 'AMD Ryzen 9',
      cpuCoresPhysical: 16,
      cpuCoresLogical: 32,
      totalVramMb: 32607,
      totalRamMb: 65536,
      vramState: 'NORMAL_VRAM',
      offloaded: false,
      weightDtype: 'fp8_e4m3fn',
      computeDtype: 'bfloat16',
      attentionImpl: 'sage',
      cudaVersion: '12.8',
      cudnnVersion: '9.7',
      computeCapability: '9.0',
      isLaptop: false,
      pcieGen: 5,
      pcieWidth: 16,
      baseline: {
        vramUsedMb: 500,
        vramUtilPercent: 2,
        temperatureC: 40,
        ramUsedMb: 8000,
        cpuPercent: 5
      }
    },
    durations: {
      totalRunMs: 1200,
      samplerMs: 900,
      nodeTotalMs: 1100,
      modelLoadMs: null
    },
    nodes: [],
    sampling: {
      stepCount: 4,
      perStepItPerS: [0.3, 24, 25, 26],
      avgItPerS: 18.8,
      steadyStateItPerS: null
    },
    resources: {
      sampleIntervalMs: 100,
      series: [],
      peak: {
        vramUsedMb: 11400,
        ramUsedMb: 12000,
        cpuPercent: 30,
        vramUtilPercent: 99,
        powerW: 540,
        temperatureC: 68,
        smClockMhz: 2800,
        memClockMhz: 10500,
        powerLimitW: 575,
        throttled: false
      }
    },
    summary: {
      energyWhPerImage: 0.21,
      secPerImage: 1.12,
      throttled: false
    },
    ...overrides
  }
}

function benchmark(overrides: Partial<PerformanceTestBenchmark> = {}): PerformanceTestBenchmark {
  const cb = overrides.coreBenchmark === undefined ? coreBenchmark() : overrides.coreBenchmark
  return {
    id: 'session-1',
    createdAt: '2026-09-30T20:51:00.000Z',
    instance: { id: 'instance-1', name: 'Local Instance' },
    workspace: { id: null, name: 'Personal' },
    workflowName: 'Z-Image Turbo',
    fastestJobDurationSeconds: 1.1,
    slowestJobDurationSeconds: 1.3,
    averageJobDurationSeconds: 1.2,
    medianJobDurationSeconds: 1.12,
    measuredJobCount: 3,
    hardwareName: 'NVIDIA GeForce RTX 5090',
    steadyStateItPerS: 25,
    result: { failedRunCount: 0, hardware: { deviceName: 'NVIDIA GeForce RTX 5090' } },
    ...overrides,
    coreBenchmark: cb
  }
}

function parseCsv(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.split('\r\n')
  const split = (line: string): string[] => {
    const cells: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            current += '"'
            i++
          } else inQuotes = false
        } else current += ch
      } else if (ch === '"') inQuotes = true
      else if (ch === ',') {
        cells.push(current)
        current = ''
      } else current += ch
    }
    cells.push(current)
    return cells
  }
  const [header, ...rest] = lines
  return { header: split(header!), rows: rest.map(split) }
}

function cell(csv: string, rowIndex: number, column: string): string {
  const { header, rows } = parseCsv(csv)
  return rows[rowIndex]![header.indexOf(column)]!
}

describe('buildBenchmarkCsv', () => {
  it('emits the exact column schema (order + names) from the spec', () => {
    const { header } = parseCsv(buildBenchmarkCsv([]))
    expect(header).toEqual([...BENCHMARK_CSV_COLUMNS])
  })

  it('serializes a fully-captured run with raw numbers, booleans, and no unit suffixes', () => {
    const csv = buildBenchmarkCsv([benchmark()])
    expect(cell(csv, 0, 'session_id')).toBe('session-1')
    expect(cell(csv, 0, 'created_at_iso')).toBe('2026-09-30T20:51:00.000Z')
    expect(cell(csv, 0, 'gpu_model')).toBe('NVIDIA GeForce RTX 5090')
    expect(cell(csv, 0, 'vram_total_mb')).toBe('32607')
    expect(cell(csv, 0, 'median_sec_per_image')).toBe('1.12')
    expect(cell(csv, 0, 'vram_peak_mb')).toBe('11400')
    expect(cell(csv, 0, 'power_peak_w')).toBe('540')
    expect(cell(csv, 0, 'temp_peak_c')).toBe('68')
    expect(cell(csv, 0, 'gpu_util_peak_pct')).toBe('99')
    expect(cell(csv, 0, 'throttled')).toBe('false')
    expect(cell(csv, 0, 'offloaded')).toBe('false')
    expect(cell(csv, 0, 'weight_dtype')).toBe('fp8_e4m3fn')
    expect(cell(csv, 0, 'steps')).toBe('8')
    expect(cell(csv, 0, 'measured_runs')).toBe('3')
    expect(cell(csv, 0, 'failed_runs')).toBe('0')
    expect(cell(csv, 0, 'instance_name')).toBe('Local Instance')
  })

  it('computes vram_peak_pct from peak / total VRAM', () => {
    const csv = buildBenchmarkCsv([benchmark()])
    // 11400 / 32607 * 100
    expect(Number(cell(csv, 0, 'vram_peak_pct'))).toBeCloseTo((11400 / 32607) * 100, 5)
  })

  it('falls back to median / imageCount when summary.secPerImage is absent', () => {
    const cb = coreBenchmark()
    cb.summary.secPerImage = null
    cb.run.imageCount = 4
    const csv = buildBenchmarkCsv([benchmark({ coreBenchmark: cb, medianJobDurationSeconds: 2 })])
    expect(Number(cell(csv, 0, 'median_sec_per_image'))).toBeCloseTo(0.5, 5)
  })

  it('uses the desktop-recomputed steadyStateItPerS field verbatim', () => {
    const csv = buildBenchmarkCsv([benchmark({ steadyStateItPerS: 25 })])
    expect(cell(csv, 0, 'steady_state_it_per_s')).toBe('25')
  })

  it('renders not-measured values as empty cells, never 0', () => {
    const csv = buildBenchmarkCsv([benchmark({ coreBenchmark: null, steadyStateItPerS: null })])
    expect(cell(csv, 0, 'gpu_model')).toBe('')
    expect(cell(csv, 0, 'vram_peak_mb')).toBe('')
    expect(cell(csv, 0, 'vram_peak_pct')).toBe('')
    expect(cell(csv, 0, 'median_sec_per_image')).toBe('')
    expect(cell(csv, 0, 'steady_state_it_per_s')).toBe('')
    expect(cell(csv, 0, 'throttled')).toBe('')
    expect(cell(csv, 0, 'offloaded')).toBe('')
    // Wrapper fields still present on a captureless run.
    expect(cell(csv, 0, 'workflow_name')).toBe('Z-Image Turbo')
    expect(cell(csv, 0, 'run_duration_median_s')).toBe('1.12')
  })

  it('quotes fields that contain commas, quotes, or newlines (RFC 4180)', () => {
    const csv = buildBenchmarkCsv([benchmark({ workflowName: 'Portrait, v2 "final"\nrevised' })])
    // The raw field survives round-trip through a compliant parser.
    expect(cell(csv, 0, 'workflow_name')).toBe('Portrait, v2 "final"\nrevised')
    // And the raw CSV actually quoted + escaped it.
    expect(csv).toContain('"Portrait, v2 ""final""\nrevised"')
  })

  it('writes one row per run for a cross-workflow set', () => {
    const csv = buildBenchmarkCsv([
      benchmark({ id: 's1', workflowName: 'Z-Image Turbo' }),
      benchmark({ id: 's2', workflowName: 'Qwen-Image' }),
      benchmark({ id: 's3', workflowName: 'Ideogram v4' })
    ])
    const { rows } = parseCsv(csv)
    expect(rows).toHaveLength(3)
    expect(cell(csv, 0, 'workflow_name')).toBe('Z-Image Turbo')
    expect(cell(csv, 1, 'workflow_name')).toBe('Qwen-Image')
    expect(cell(csv, 2, 'workflow_name')).toBe('Ideogram v4')
  })

  it('returns just the header row for an empty selection', () => {
    expect(buildBenchmarkCsv([])).toBe(BENCHMARK_CSV_COLUMNS.join(','))
  })
})

describe('buildBenchmarkJson', () => {
  it('produces a lossless array of coreBenchmark + wrapper fields', () => {
    const run = benchmark()
    const parsed = JSON.parse(buildBenchmarkJson([run])) as unknown[]
    expect(parsed).toHaveLength(1)
    const entry = parsed[0] as Record<string, unknown>
    expect(entry.sessionId).toBe('session-1')
    expect(entry.createdAt).toBe('2026-09-30T20:51:00.000Z')
    expect(entry.workflowName).toBe('Z-Image Turbo')
    expect(entry.instance).toEqual({ id: 'instance-1', name: 'Local Instance' })
    expect(entry.workspace).toEqual({ id: null, name: 'Personal' })
    expect(entry.hardware).toEqual({ deviceName: 'NVIDIA GeForce RTX 5090' })
    // coreBenchmark preserved verbatim — losslessly round-trips.
    expect(entry.coreBenchmark).toEqual(run.coreBenchmark as unknown)
    const durations = entry.durations as Record<string, unknown>
    expect(durations.medianJobDurationSeconds).toBe(1.12)
    expect(durations.measuredJobCount).toBe(3)
    expect(durations.failedRunCount).toBe(0)
  })

  it('keeps coreBenchmark null for a captureless run without dropping wrapper fields', () => {
    const parsed = JSON.parse(
      buildBenchmarkJson([benchmark({ coreBenchmark: null, steadyStateItPerS: null })])
    ) as Array<Record<string, unknown>>
    expect(parsed[0]!.coreBenchmark).toBeNull()
    expect(parsed[0]!.workflowName).toBe('Z-Image Turbo')
  })

  it('serializes every run in a cross-workflow set', () => {
    const parsed = JSON.parse(
      buildBenchmarkJson([
        benchmark({ id: 's1', workflowName: 'Z-Image Turbo' }),
        benchmark({ id: 's2', workflowName: 'Qwen-Image' })
      ])
    ) as Array<Record<string, unknown>>
    expect(parsed.map((e) => e.workflowName)).toEqual(['Z-Image Turbo', 'Qwen-Image'])
  })
})
