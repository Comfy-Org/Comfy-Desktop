/**
 * Pure CSV / JSON builders for the benchmark data export (design §5.3).
 *
 * These run in the renderer and produce STRINGS only — no Node APIs, no FS. The
 * `exportBenchmarkData` IPC takes the returned string and writes it to a
 * user-chosen path. Keeping the serialization pure makes it unit-testable in
 * `benchmarkExport.test.ts` and keeps the file-write boundary in main.
 *
 * Rules baked in from the spec + the user's resolved decisions:
 *   - CSV: one row per run, flat, spreadsheet-ready. Numbers raw/unformatted (no
 *     "GB"/"s" suffix — units live in the header), booleans `true`/`false`, and a
 *     NULL / not-measured value is an EMPTY cell, never `0`. UTF-8, comma-separated,
 *     RFC-4180 quoting.
 *   - JSON: a lossless array of each run's full `CoreBenchmarkSummary` plus the
 *     top-level wrapper fields (createdAt, workflowName, instance, workspace,
 *     durations, hardware). This is the corpus format.
 *   - sec/image stays normalized by image count (`summary.secPerImage`, else
 *     `medianJobDurationSeconds / imageCount`).
 *   - steady-state it/s is the desktop-recomputed `PerformanceTestBenchmark.steadyStateItPerS`.
 */

import { secPerImageOf } from './benchmarkMetrics'
import type {
  CoreBenchmarkSummary,
  PerformanceTestBenchmark,
  PerformanceTestResultValue
} from '../types/ipc'

/** CSV column order — authoritative, matches design §5.3 exactly. Units are
 *  embedded in the names (`_mb`, `_s`, `_w`, `_c`, `_mhz`, `_pct`, `_wh_per_image`)
 *  so cells carry raw numbers only. */
export const BENCHMARK_CSV_COLUMNS = [
  'session_id',
  'created_at_iso',
  'workflow_name',
  'benchmark_id',
  'benchmark_version',
  'gpu_model',
  'backend',
  'vram_total_mb',
  'driver_version',
  'comfyui_version',
  'median_sec_per_image',
  'steady_state_it_per_s',
  'avg_it_per_s',
  'vram_peak_mb',
  'vram_peak_pct',
  'energy_wh_per_image',
  'power_peak_w',
  'power_limit_w',
  'temp_peak_c',
  'vram_util_peak_pct',
  'sm_clock_mhz',
  'mem_clock_mhz',
  'throttled',
  'offloaded',
  'vram_state',
  'weight_dtype',
  'compute_dtype',
  'attention_impl',
  'cuda_version',
  'cudnn_version',
  'pytorch_version',
  'steps',
  'sampler',
  'scheduler',
  'cfg',
  'denoise',
  'resolution_w',
  'resolution_h',
  'batch_size',
  'image_count',
  'measured_runs',
  'failed_runs',
  'run_duration_median_s',
  'run_duration_fastest_s',
  'run_duration_slowest_s',
  'run_duration_avg_s',
  'node_total_ms',
  'workspace_name',
  'instance_name'
] as const

/** A single serialized CSV cell: a number, a string, a boolean, or null (empty cell). */
type CsvCell = number | string | boolean | null | undefined

/** Pull a numeric leaf out of the raw `result` payload (defensive — the field may
 *  be absent, null, or a non-number if the file is partial). */
function resultNumber(
  result: Record<string, PerformanceTestResultValue>,
  key: string
): number | null {
  const value = result[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Peak VRAM as a percent of the device total (spec §5.3: peak / totalVramMb × 100). */
function vramPeakPct(cb: CoreBenchmarkSummary | null): number | null {
  const peak = cb?.resources?.peak?.vramUsedMb
  const total = cb?.device?.totalVramMb
  if (typeof peak === 'number' && typeof total === 'number' && total > 0) {
    return (peak / total) * 100
  }
  return null
}

/** The one abnormal-state flag the spec treats as throttling: peak OR summary. */
function throttled(cb: CoreBenchmarkSummary | null): boolean | null {
  const peak = cb?.resources?.peak?.throttled
  if (typeof peak === 'boolean') return peak
  const summary = cb?.summary?.throttled
  return typeof summary === 'boolean' ? summary : null
}

/** Map one run to its ordered CSV cells, keyed by column name for clarity. */
function toCsvRecord(run: PerformanceTestBenchmark): Record<string, CsvCell> {
  const cb = run.coreBenchmark ?? null
  const device = cb?.device
  const workflow = cb?.workflow
  const peak = cb?.resources?.peak
  return {
    session_id: run.id,
    created_at_iso: run.createdAt,
    workflow_name: run.workflowName,
    benchmark_id: cb?.run?.benchmarkId ?? null,
    benchmark_version: cb?.run?.benchmarkVersion ?? null,
    gpu_model: device?.gpuModel ?? null,
    backend: device?.backend ?? null,
    vram_total_mb: device?.totalVramMb ?? null,
    driver_version: device?.driverVersion ?? null,
    comfyui_version: device?.comfyuiVersion ?? null,
    median_sec_per_image: secPerImageOf(run, cb),
    steady_state_it_per_s: run.steadyStateItPerS,
    avg_it_per_s: cb?.sampling?.avgItPerS ?? null,
    vram_peak_mb: peak?.vramUsedMb ?? null,
    vram_peak_pct: vramPeakPct(cb),
    energy_wh_per_image: cb?.summary?.energyWhPerImage ?? null,
    power_peak_w: peak?.powerW ?? null,
    power_limit_w: peak?.powerLimitW ?? null,
    temp_peak_c: peak?.temperatureC ?? null,
    vram_util_peak_pct: peak?.vramUtilPercent ?? null,
    sm_clock_mhz: peak?.smClockMhz ?? null,
    mem_clock_mhz: peak?.memClockMhz ?? null,
    throttled: throttled(cb),
    offloaded: device?.offloaded ?? null,
    vram_state: device?.vramState ?? null,
    weight_dtype: device?.weightDtype ?? null,
    compute_dtype: device?.computeDtype ?? null,
    attention_impl: device?.attentionImpl ?? null,
    cuda_version: device?.cudaVersion ?? null,
    cudnn_version: device?.cudnnVersion ?? null,
    pytorch_version: device?.pytorchVersion ?? null,
    steps: workflow?.steps ?? null,
    sampler: workflow?.sampler ?? null,
    scheduler: workflow?.scheduler ?? null,
    cfg: workflow?.cfg ?? null,
    denoise: workflow?.denoise ?? null,
    resolution_w: workflow?.resolution?.width ?? null,
    resolution_h: workflow?.resolution?.height ?? null,
    batch_size: cb?.run?.batchSize ?? null,
    image_count: cb?.run?.imageCount ?? null,
    measured_runs: run.measuredJobCount,
    failed_runs: resultNumber(run.result, 'failedRunCount'),
    run_duration_median_s: run.medianJobDurationSeconds,
    run_duration_fastest_s: run.fastestJobDurationSeconds,
    run_duration_slowest_s: run.slowestJobDurationSeconds,
    run_duration_avg_s: run.averageJobDurationSeconds,
    node_total_ms: cb?.durations?.nodeTotalMs ?? null,
    workspace_name: run.workspace.name,
    instance_name: run.instance.name
  }
}

/** Serialize one cell per the spec: empty for null/undefined/non-finite, raw number,
 *  `true`/`false`, RFC-4180-quoted string. */
function formatCsvCell(value: CsvCell): string {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const text = String(value)
  if (text === '') return ''
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/**
 * Build the CSV export: a header row of `BENCHMARK_CSV_COLUMNS` followed by one
 * row per run. CRLF line endings (RFC 4180). Returns just the header row when
 * `runs` is empty.
 */
export function buildBenchmarkCsv(runs: PerformanceTestBenchmark[]): string {
  const header = BENCHMARK_CSV_COLUMNS.join(',')
  const rows = runs.map((run) => {
    const record = toCsvRecord(run)
    return BENCHMARK_CSV_COLUMNS.map((column) => formatCsvCell(record[column])).join(',')
  })
  return [header, ...rows].join('\r\n')
}

/** One run's entry in the JSON export — the lossless corpus shape (spec §5.3). */
export interface BenchmarkJsonEntry {
  sessionId: string
  createdAt: string | null
  workflowName: string
  instance: PerformanceTestBenchmark['instance']
  workspace: PerformanceTestBenchmark['workspace']
  durations: {
    medianJobDurationSeconds: number | null
    fastestJobDurationSeconds: number | null
    slowestJobDurationSeconds: number | null
    averageJobDurationSeconds: number | null
    measuredJobCount: number
    failedRunCount: number | null
  }
  hardware: PerformanceTestResultValue
  coreBenchmark: CoreBenchmarkSummary | null
}

/** Map one run to its lossless JSON entry. */
function toJsonEntry(run: PerformanceTestBenchmark): BenchmarkJsonEntry {
  return {
    sessionId: run.id,
    createdAt: run.createdAt,
    workflowName: run.workflowName,
    instance: run.instance,
    workspace: run.workspace,
    durations: {
      medianJobDurationSeconds: run.medianJobDurationSeconds,
      fastestJobDurationSeconds: run.fastestJobDurationSeconds,
      slowestJobDurationSeconds: run.slowestJobDurationSeconds,
      averageJobDurationSeconds: run.averageJobDurationSeconds,
      measuredJobCount: run.measuredJobCount,
      failedRunCount: resultNumber(run.result, 'failedRunCount')
    },
    hardware: run.result.hardware ?? null,
    coreBenchmark: run.coreBenchmark ?? null
  }
}

/**
 * Build the JSON export: a pretty-printed array of lossless per-run entries. This
 * is the programmatic corpus format; it preserves every captured `coreBenchmark`
 * field verbatim.
 */
export function buildBenchmarkJson(runs: PerformanceTestBenchmark[]): string {
  return JSON.stringify(runs.map(toJsonEntry), null, 2)
}
