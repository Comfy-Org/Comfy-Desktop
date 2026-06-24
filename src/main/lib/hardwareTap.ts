/**
 * Hardware telemetry tap.
 *
 * The launcher's `system_info` event reports the GPU the OS sees, which on
 * Windows is frequently a virtual display adapter and never reflects which
 * device PyTorch actually selected for compute. ComfyUI's own startup logs
 * are the authoritative source: they print the selected accelerator, its
 * VRAM, and the architecture of every model loaded. We tail that output —
 * already piped through `proc.stdout` / `proc.stderr` in
 * `sessionActions/launch.ts`, the same stream `executionTap` consumes.
 *
 * Two signals, two shapes:
 *   - `comfy.desktop.comfyui.accelerator_detected` — emitted ONCE per boot,
 *     on the first `Device:` line (the current/selected device; ComfyUI
 *     prints additional devices afterwards). Carries the compute GPU model,
 *     VRAM/RAM, and torch/xformers versions accumulated from earlier lines.
 *   - `comfy.desktop.comfyui.model_usage` — model loads happen many times per
 *     session, so per-load events would blow past the telemetry rate limiter
 *     and corrupt the very counts we want. Instead we count loads per
 *     architecture in memory and flush DELTAS (periodically + on session end),
 *     at most one event per distinct architecture per flush. Summing `count`
 *     gives total loads; counting distinct `installation_id` gives reach. A
 *     per-person `$set_once` marker (`used_model_<arch>_at`) answers "has this
 *     user ever used arch X" with a single person-property filter.
 *
 * Log strings parsed (current ComfyUI main branch):
 *   - "Device: cuda:0 NVIDIA GeForce RTX 4090 : native"   (model_management.py)
 *   - "Total VRAM 24576 MB, total RAM 65461 MB"
 *   - "pytorch version: 2.10.0+cu130" / "xformers version: 0.0.x"
 *   - "Set cuda device to: 0"                              (main.py)
 *   - "model_type FLUX"                                    (model_base.py)
 *   - "model weight dtype torch.float16, manual cast: None"
 *
 * NOTE: there is no literal "loading SDXL model" string in ComfyUI; the
 * architecture surfaces as `model_type <NAME>` (EPS / FLUX / FLOW / ...).
 *
 * NOTE: ComfyUI Desktop's bundled build prefixes every log line with a level
 * tag (`[INFO] Device: ...`), unlike the bare `%(message)s` format. `handleLine`
 * strips a leading `[LEVEL] ` tag before matching so both formats parse.
 */
import * as telemetry from './telemetry'
import { stripAnsi, stripLogLevelPrefix } from './stderrTail'

export interface AcceleratorInfo {
  deviceType: string
  deviceIndex: number | null
  deviceName: string | null
  backend: string | null
}

const DEVICE_LINE = /^Device:\s*(.+)$/
const VRAM_LINE = /^Total VRAM\s+(\d+)\s*MB,\s*total RAM\s+(\d+)\s*MB/i
const PYTORCH_LINE = /^pytorch version:\s*(.+)$/i
const XFORMERS_LINE = /^xformers version:\s*(.+)$/i
const CUDA_DEVICE_LINE = /^Set cuda device to:\s*(\d+)/i
// ComfyUI's `model_type.name` is always an uppercase enum (EPS, FLUX, FLOW,
// V_PREDICTION, STABLE_CASCADE, ...). Restrict to that shape and require it to
// be the whole token: custom nodes write to the same stdout, so a loose `\S+`
// could turn an arbitrary string (a path, a filename) into a high-cardinality
// event value AND a dynamic `used_model_<x>_at` person-property key (keys are
// not scrubbed). The length cap bounds a pathological match.
const MODEL_TYPE_LINE = /^model_type\s+([A-Z][A-Z0-9_]{0,63})\s*$/
const WEIGHT_DTYPE_LINE = /^model weight dtype\s+([^,]+),/

/**
 * Parse a ComfyUI `Device:` line into its components. Handles the cuda
 * format (`cuda:0 <name> : <backend>`), the xpu/npu/mlu format
 * (`<type>:<index> <name>`), the bare-type format (`cpu` / `mps`), and the
 * legacy fallback format (`CUDA cuda:0: <name>`). Returns null for a
 * non-device line.
 */
export function parseDeviceLine(line: string): AcceleratorInfo | null {
  const m = line.match(DEVICE_LINE)
  if (!m || !m[1]) return null
  let rest = m[1].trim()
  // Legacy fallback "CUDA cuda:0: <name>" — drop the leading "CUDA ".
  if (/^CUDA\s+/i.test(rest)) rest = rest.replace(/^CUDA\s+/i, '')
  const tok = rest.match(/^([A-Za-z][A-Za-z0-9]*)(?::(\d+))?/)
  if (!tok || !tok[1]) return null
  const deviceType = tok[1].toLowerCase()
  const deviceIndex = tok[2] != null ? Number(tok[2]) : null
  // Strip the device token, then a stray leading ":" (legacy fallback's
  // "cuda:0: <name>" leaves ": <name>").
  const remainder = rest.slice(tok[0].length).trim().replace(/^:\s*/, '')
  let deviceName: string | null = remainder || null
  let backend: string | null = null
  // The cuda format appends " : <backend>" (e.g. native / cudaMallocAsync).
  const sep = remainder.lastIndexOf(' : ')
  if (sep >= 0) {
    deviceName = remainder.slice(0, sep).trim() || null
    backend = remainder.slice(sep + 3).trim() || null
  }
  return { deviceType, deviceIndex, deviceName, backend }
}

/** Parse "Total VRAM X MB, total RAM Y MB" into MB numbers, or null. */
export function parseVramLine(line: string): { vramMb: number; ramMb: number } | null {
  const m = line.match(VRAM_LINE)
  if (!m || !m[1] || !m[2]) return null
  return { vramMb: Number(m[1]), ramMb: Number(m[2]) }
}

/** Extract the value after a `key: value` style line via the given regex. */
function parseTail(line: string, re: RegExp): string | null {
  const m = line.match(re)
  return m && m[1] ? m[1].trim() : null
}

/** Parse "model_type FLUX" → "FLUX". */
export function parseModelType(line: string): string | null {
  return parseTail(line, MODEL_TYPE_LINE)
}

/** Parse "model weight dtype torch.float16, manual cast: None" → "torch.float16". */
export function parseWeightDtype(line: string): string | null {
  return parseTail(line, WEIGHT_DTYPE_LINE)
}

/** Flush model-usage deltas at most this often while a session keeps loading models. */
const MODEL_USAGE_FLUSH_INTERVAL_MS = 5 * 60_000
/** Hard cap on distinct architectures tracked, so a malformed log can't grow the map. */
const MAX_TRACKED_ARCHITECTURES = 64

export function createHardwareTap(opts: {
  installationId: string
  variant?: string | null
  release?: string | null
}): {
  ingest: (chunk: string, source: 'stdout' | 'stderr') => void
  beginBoot: () => void
  flushSummary: () => void
} {
  const baseContext = {
    installation_id: opts.installationId,
    variant: opts.variant ?? null,
    release: opts.release ?? null
  }

  // Accelerator accumulation — fields trickle in over several lines; we emit
  // once, on the first Device line (which arrives after VRAM / versions).
  let acceleratorEmitted = false
  let vramMb: number | null = null
  let ramMb: number | null = null
  let pytorchVersion: string | null = null
  let xformersVersion: string | null = null
  let cudaDeviceSet: number | null = null

  // Per-architecture load counts since the last flush (deltas). `dtype` keeps
  // the most recent weight dtype seen for that arch as a representative.
  const pendingCounts = new Map<string, number>()
  const lastDtype = new Map<string, string>()
  const markedArchitectures = new Set<string>()
  let pendingDtype: string | null = null

  let flushTimer: ReturnType<typeof setInterval> | null = null

  function emitModelUsage(): void {
    if (pendingCounts.size === 0) return
    for (const [modelType, count] of pendingCounts) {
      if (count <= 0) continue
      telemetry.emit('comfy.desktop.comfyui.model_usage', {
        ...baseContext,
        model_type: modelType,
        count,
        dtype: lastDtype.get(modelType) ?? null
      })
    }
    pendingCounts.clear()
  }

  function ensureFlushTimer(): void {
    if (flushTimer) return
    flushTimer = setInterval(emitModelUsage, MODEL_USAGE_FLUSH_INTERVAL_MS)
    // Don't keep the event loop / process quit waiting on this timer.
    flushTimer.unref?.()
  }

  function handleLine(line: string): void {
    // Strip a leading `[LEVEL] ` tag (ComfyUI Desktop's bundled build) so the
    // anchored parsers below match both the prefixed and bare log formats.
    const trimmed = stripLogLevelPrefix(stripAnsi(line).trim())
    if (trimmed.length === 0) return

    if (!acceleratorEmitted) {
      const vram = parseVramLine(trimmed)
      if (vram) {
        vramMb = vram.vramMb
        ramMb = vram.ramMb
        return
      }
      const pytorch = parseTail(trimmed, PYTORCH_LINE)
      if (pytorch) {
        pytorchVersion = pytorch
        return
      }
      const xformers = parseTail(trimmed, XFORMERS_LINE)
      if (xformers) {
        xformersVersion = xformers
        return
      }
      const cudaDevice = parseTail(trimmed, CUDA_DEVICE_LINE)
      if (cudaDevice) {
        cudaDeviceSet = Number(cudaDevice)
        return
      }
      const device = parseDeviceLine(trimmed)
      if (device) {
        acceleratorEmitted = true
        const vramGb = vramMb != null ? Math.round(vramMb / 1024) : null
        telemetry.emit('comfy.desktop.comfyui.accelerator_detected', {
          ...baseContext,
          device_type: device.deviceType,
          device_index: device.deviceIndex,
          gpu_model: device.deviceName,
          backend: device.backend,
          vram_mb: vramMb,
          vram_gb: vramGb,
          ram_mb: ramMb,
          pytorch_version: pytorchVersion,
          xformers_version: xformersVersion,
          cuda_device_set: cudaDeviceSet
        })
        // The compute device ComfyUI selected is more authoritative than the
        // OS-enumerated GPU in `system_info` (which can be a virtual display).
        // Promote it under dedicated `comfyui_*` person props so cohort
        // queries can coalesce(comfyui_gpu_model, gpu_model) without losing
        // either signal. Only for real accelerators — `cpu` is not a GPU.
        if (device.deviceName && device.deviceType !== 'cpu') {
          telemetry.registerPersonProperties({
            comfyui_gpu_model: device.deviceName,
            comfyui_gpu_vram_gb: vramGb,
            comfyui_device_type: device.deviceType
          })
        }
        return
      }
    }

    // Weight dtype is logged just before the model_type line; hold it so the
    // model_usage event can record a representative dtype per architecture.
    const dtype = parseWeightDtype(trimmed)
    if (dtype) {
      pendingDtype = dtype
      return
    }

    const modelType = parseModelType(trimmed)
    if (modelType) {
      if (pendingCounts.has(modelType) || pendingCounts.size < MAX_TRACKED_ARCHITECTURES) {
        pendingCounts.set(modelType, (pendingCounts.get(modelType) ?? 0) + 1)
        if (pendingDtype) lastDtype.set(modelType, pendingDtype)
        ensureFlushTimer()
        // Per-person "ever used arch X" marker. `$set_once` is idempotent
        // server-side; the per-tap Set avoids re-emitting person.set events.
        if (!markedArchitectures.has(modelType)) {
          markedArchitectures.add(modelType)
          telemetry.registerPersonPropertiesOnce({
            [`used_model_${modelType.toLowerCase()}_at`]: new Date().toISOString()
          })
        }
      }
      pendingDtype = null
      return
    }
  }

  // Separate per-stream buffers: stdout and stderr arrive as independent
  // chunk streams, so a single shared buffer could splice unrelated partial
  // lines together. Each buffer is capped so a long burst without a newline
  // can't grow unbounded.
  const MAX_PENDING_CHARS = 16_384
  const pendingBySource: Record<'stdout' | 'stderr', string> = {
    stdout: '',
    stderr: ''
  }

  function appendChunk(source: 'stdout' | 'stderr', chunk: string): string[] {
    // Split first so a large chunk's complete lines (e.g. `Device:` /
    // `model_type`) are never lost; cap only the unterminated tail we carry
    // over, which is the sole unbounded-growth risk.
    const lines = (pendingBySource[source] + chunk).split(/\r?\n/)
    const tail = lines.pop() ?? ''
    pendingBySource[source] = tail.length > MAX_PENDING_CHARS ? tail.slice(-MAX_PENDING_CHARS) : tail
    return lines
  }

  return {
    ingest(chunk: string, source: 'stdout' | 'stderr'): void {
      // Hard guarantee: this runs inside the launch stdout/stderr handler,
      // right before the boot-progress tracker. A throw here must never break
      // log streaming or boot detection. Telemetry must never break the app.
      try {
        for (const line of appendChunk(source, chunk)) handleLine(line)
      } catch {
        // ignore – telemetry side effect, not user-visible
      }
    },
    /**
     * Reset per-boot accelerator accumulation. A single launch can restart
     * ComfyUI several times (port/reboot retries, model-folder relaunch,
     * Manager restarts), each reusing this tap. Without this, only the first
     * boot would emit `accelerator_detected` and stale fields would suppress
     * later boots. Model-usage counts intentionally persist across reboots —
     * they aggregate per launch, not per boot.
     */
    beginBoot(): void {
      acceleratorEmitted = false
      vramMb = null
      ramMb = null
      pytorchVersion = null
      xformersVersion = null
      cudaDeviceSet = null
      pendingDtype = null
      // Drop any incomplete lines from the previous (now-dead) process streams.
      pendingBySource.stdout = ''
      pendingBySource.stderr = ''
    },
    flushSummary(): void {
      try {
        if (flushTimer) {
          clearInterval(flushTimer)
          flushTimer = null
        }
        // Process complete-but-unterminated final lines so trailing model
        // loads aren't dropped when the process exits without a newline.
        for (const source of ['stdout', 'stderr'] as const) {
          const pending = pendingBySource[source]
          if (pending.trim()) handleLine(pending)
          pendingBySource[source] = ''
        }
        emitModelUsage()
      } catch {
        // ignore – telemetry side effect, not user-visible
      }
    }
  }
}
