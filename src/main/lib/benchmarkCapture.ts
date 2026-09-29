/**
 * Consume ComfyUI core's in-process benchmark capture.
 *
 * When a `/prompt` submission carries `extra_data: { benchmark: true }` (see
 * `performanceTestWorkflows.ts`), core writes one JSON file per run to
 * `<comfyui_output_dir>/benchmarks/<prompt_id>.json` (`capture_schema_version: 1`,
 * `collector_id: "comfyui-core"`). The runner has no websocket — it polls
 * `/api/jobs` — so we treat that FILE as the channel: after a run reaches a
 * terminal state we read the file keyed by the prompt_id the runner already
 * collected.
 *
 * This module is main-process only but split into:
 *   - `mapCoreBenchmarkCapture` — a PURE parser (raw JSON -> normalized summary),
 *     unit-tested with CUDA + MPS samples (util/power are null on MPS).
 *   - `resolveComfyOutputDir` — mirrors the launch-time output-dir resolution so
 *     we look where core actually wrote.
 *   - `readCoreBenchmarkCapture` / `pickRepresentativeCapture` — thin FS + picker
 *     wrappers wired into the IPC handler.
 *
 * Everything is best-effort: a missing or malformed file yields null and the
 * caller keeps its existing `/system_stats` sampler result (feature-detect).
 */
import fs from 'fs'
import path from 'path'

import type { InstallationRecord } from '../installations'
import type {
  CoreBenchmarkNode,
  CoreBenchmarkResourceSample,
  CoreBenchmarkSummary
} from '../../types/ipc'

/** Finite number or null. Rejects NaN/Infinity/strings so the UI never renders junk. */
/** Minimal utf8 file-reader surface, so tests can inject a simple fake. */
export interface CaptureFileReader {
  readFile: (filePath: string, encoding: 'utf8') => Promise<string>
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function mapNodes(value: unknown): CoreBenchmarkNode[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): CoreBenchmarkNode[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const node = entry as Record<string, unknown>
    return [
      {
        // node_id may arrive as a number in some graphs; coerce to string.
        nodeId:
          typeof node.node_id === 'string'
            ? node.node_id
            : typeof node.node_id === 'number'
              ? String(node.node_id)
              : null,
        classType: str(node.class_type),
        elapsedMs: num(node.elapsed_ms)
      }
    ]
  })
}

function mapSeries(value: unknown): CoreBenchmarkResourceSample[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): CoreBenchmarkResourceSample[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const sample = entry as Record<string, unknown>
    return [
      {
        tMs: num(sample.t_ms),
        cpuPercent: num(sample.cpu_percent),
        ramUsedMb: num(sample.ram_used_mb),
        vramUsedMb: num(sample.vram_used_mb),
        vramUtilPercent: num(sample.vram_util_percent),
        powerW: num(sample.power_w)
      }
    ]
  })
}

function mapPerStep(value: unknown): (number | null)[] {
  if (!Array.isArray(value)) return []
  // Index-aligned with steps; null preserved for 0ms steps (do not drop).
  return value.map((entry) => num(entry))
}

/**
 * Parse a raw core benchmark capture into the normalized summary the UI consumes.
 * Returns null only when the payload is not a recognizable capture object; every
 * field is otherwise defensively extracted (missing keys -> null / empty array).
 *
 * PURE — no FS, no globals. Test this directly with sample events.
 */
export function mapCoreBenchmarkCapture(
  raw: unknown,
  promptId: string
): CoreBenchmarkSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const root = raw as Record<string, unknown>

  const schemaVersion = num(root.capture_schema_version)
  const collectorId = str(root.collector_id)
  // Feature-detect: only accept payloads that identify as a v1 core capture.
  // Anything else (a stray JSON file, a future incompatible schema) is ignored
  // so we degrade to the `/system_stats` fallback rather than render garbage.
  if (schemaVersion !== 1 && collectorId !== 'comfyui-core') return null

  const device = asRecord(root.device)
  const durations = asRecord(root.durations)
  const sampling = asRecord(root.sampling)
  const resources = asRecord(root.resources)
  const peak = asRecord(resources.peak)

  return {
    promptId,
    captureSchemaVersion: schemaVersion,
    collectorId,
    device: {
      backend: str(device.backend),
      gpuModel: str(device.gpu_model),
      driverVersion: str(device.driver_version),
      vramIsUnified: boolOrNull(device.vram_is_unified),
      pytorchVersion: str(device.pytorch_version),
      comfyuiVersion: str(device.comfyui_version),
      os: str(device.os),
      platform: str(device.platform),
      arch: str(device.arch),
      cpuModel: str(device.cpu_model),
      cpuCoresPhysical: num(device.cpu_cores_physical),
      cpuCoresLogical: num(device.cpu_cores_logical),
      totalVramMb: num(device.total_vram_mb),
      totalRamMb: num(device.total_ram_mb)
    },
    durations: {
      totalRunMs: num(durations.total_run_ms),
      samplerMs: num(durations.sampler_ms),
      nodeTotalMs: num(durations.node_total_ms)
    },
    nodes: mapNodes(root.nodes),
    sampling: {
      stepCount: num(sampling.step_count),
      perStepItPerS: mapPerStep(sampling.per_step_it_per_s),
      avgItPerS: num(sampling.avg_it_per_s)
    },
    resources: {
      sampleIntervalMs: num(resources.sample_interval_ms),
      series: mapSeries(resources.series),
      peak: {
        vramUsedMb: num(peak.vram_used_mb),
        ramUsedMb: num(peak.ram_used_mb),
        cpuPercent: num(peak.cpu_percent),
        vramUtilPercent: num(peak.vram_util_percent),
        powerW: num(peak.power_w)
      }
    }
  }
}

/**
 * Resolve the ComfyUI output directory core writes into, mirroring the exact
 * launch-time logic (`sessionActions/launch.ts` `applyStorageLaunch`):
 *   1. shared output (default)  -> the caller-resolved global `outputDir`
 *   2. per-install output       -> `installation.outputDir`
 *   3. ComfyUI's own default    -> `<adoptedBaseDir>/output` (adopted installs)
 *                                  else `<installPath>/ComfyUI/output`
 *
 * `sharedOutputDir` is passed in (already resolved from `settings`) so this stays
 * pure and unit-testable without pulling in the settings singleton.
 */
export function resolveComfyOutputDir(
  installation: Pick<InstallationRecord, 'installPath'> & Record<string, unknown>,
  sharedOutputDir: string
): string {
  const useSharedOutput = (installation.useSharedOutput as boolean | undefined) !== false
  if (useSharedOutput) return sharedOutputDir

  const perInstallOutput = installation.outputDir as string | undefined
  if (perInstallOutput) return perInstallOutput

  const adopted = installation.adopted === true
  const adoptedBaseDir = adopted ? (installation.adoptedBaseDir as string | undefined) : undefined
  if (adoptedBaseDir) return path.join(adoptedBaseDir, 'output')

  return path.join(installation.installPath, 'ComfyUI', 'output')
}

/** Absolute path of the core capture file for one prompt id. */
export function coreBenchmarkCapturePath(outputDir: string, promptId: string): string {
  return path.join(outputDir, 'benchmarks', `${promptId}.json`)
}

/**
 * Read + parse the core capture for one prompt id. Best-effort: an absent file
 * (core capture unavailable), unreadable file, or invalid JSON all resolve to
 * null so the caller feature-detects and falls back to `/system_stats`.
 */
export async function readCoreBenchmarkCapture(
  outputDir: string,
  promptId: string,
  fsImpl: CaptureFileReader = fs.promises
): Promise<CoreBenchmarkSummary | null> {
  let contents: string
  try {
    contents = await fsImpl.readFile(coreBenchmarkCapturePath(outputDir, promptId), 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return null
  }
  return mapCoreBenchmarkCapture(parsed, promptId)
}

/**
 * Read every measured prompt's capture (in the order they ran) and return the
 * representative one: the median by `durations.total_run_ms`, matching the
 * "median run" the results headline already reports. Captures missing a total
 * duration sort last. Returns null when no capture file was produced.
 */
export async function readRepresentativeCoreBenchmark(
  outputDir: string,
  measuredPromptIds: readonly string[],
  fsImpl: CaptureFileReader = fs.promises
): Promise<CoreBenchmarkSummary | null> {
  const captures = (
    await Promise.all(
      measuredPromptIds.map((id) => readCoreBenchmarkCapture(outputDir, id, fsImpl))
    )
  ).filter((capture): capture is CoreBenchmarkSummary => capture !== null)
  return pickRepresentativeCapture(captures)
}

/** Pure median-by-total-duration picker (see `readRepresentativeCoreBenchmark`). */
export function pickRepresentativeCapture(
  captures: readonly CoreBenchmarkSummary[]
): CoreBenchmarkSummary | null {
  if (captures.length === 0) return null
  const sorted = [...captures].sort((a, b) => {
    const aMs = a.durations.totalRunMs
    const bMs = b.durations.totalRunMs
    if (aMs == null && bMs == null) return 0
    if (aMs == null) return 1
    if (bMs == null) return -1
    return aMs - bMs
  })
  // Lower median index for even counts — deterministic and adequate for a spike.
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null
}
