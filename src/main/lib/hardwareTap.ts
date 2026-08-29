/**
 * Hardware telemetry tap.
 *
 * The launcher's `system_info` event reports the GPU the OS sees, which on
 * Windows is frequently a virtual display adapter and never reflects which
 * device PyTorch actually selected for compute. ComfyUI's own startup logs
 * are the authoritative source: they print the selected accelerator, its
 * VRAM, and model load activity. We tail that output, already piped through
 * `proc.stdout` / `proc.stderr` in `sessionActions/launch.ts`, the same stream
 * `executionTap` consumes.
 *
 * Two signals:
 *   - `comfy.desktop.comfyui.accelerator_detected` is emitted once per boot
 *     with the selected compute device and all detected GPUs.
 *   - `comfy.desktop.comfyui.model_usage_summary` contains hourly deltas for
 *     requested loads, dynamic-VRAM prepares, and multi-GPU deepclones. Its
 *     aligned arrays preserve model class, trigger, target device, count, and
 *     UTC observation date without emitting one event per tuple.
 *
 * Log strings parsed (current ComfyUI main branch):
 *   - "Device: cuda:0 NVIDIA GeForce RTX 4090 : native"   (model_management.py)
 *   - "Total VRAM 24576 MB, total RAM 65461 MB"
 *   - "pytorch version: 2.10.0+cu130" / "xformers version: 0.0.x"
 *   - "Set cuda device to: 0"                              (main.py)
 *   - "Using directml with device: AMD Radeon RX 6800"     (model_management.py)
 *   - "Device: cuda:0 ..." / "xpu:0 ..." / "npu:0 ..." / "mlu:0 ..." / "cpu" / "mps"
 *   - "Requested to load Lumina2"                          (model_management.py)
 *   - "Model Lumina2 prepared for dynamic VRAM loading. ..." (dynamic VRAM / aimdo)
 *   - "Creating deepclone of Lumina2 for cuda:1."          (model_patcher.py)
 *   - "Reusing loaded multigpu deepclone of Lumina2 for cuda:1" (multigpu.py)
 *
 * NOTE: ComfyUI Desktop's bundled build prefixes every log line with a level
 * tag (`[INFO] Device: ...`), unlike the bare `%(message)s` format. `handleLine`
 * strips a leading `[LEVEL] ` tag before matching so both formats parse.
 */
import * as telemetry from './telemetry'
import { createModelUsageSummary } from './modelUsageSummary'
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
// DirectML (AMD/Intel on Windows without ROCm) logs the GPU name here, on a
// separate line that precedes a nameless `Device: privateuseone` line, so it's
// the only way to recover the model for those vendors.
const DIRECTML_LINE = /^Using directml with device:\s*(.+)$/i

/** Emit one array-backed delta instead of an event for every model tuple. */
const MODEL_USAGE_FLUSH_INTERVAL_MS = 60 * 60_000

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
  // Legacy fallback "CUDA cuda:0: <name>": drop the leading "CUDA ".
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

/** Cap on devices reported in one accelerator event, so a malformed log can't grow the array. */
const MAX_DEVICES = 16

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

  // Accelerator accumulation: fields trickle in over several lines. ComfyUI
  // logs the selected device first, then one `Device:` line per other GPU. We
  // collect the consecutive run and emit ONE event (per boot) when the run ends
  // (on the first non-`Device:` line or at session end) so the event
  // carries every GPU, not just the selected one.
  let acceleratorEmitted = false
  let vramMb: number | null = null
  let ramMb: number | null = null
  let pytorchVersion: string | null = null
  let xformersVersion: string | null = null
  let cudaDeviceSet: number | null = null
  let directmlDeviceName: string | null = null
  const devices: AcceleratorInfo[] = []
  const modelUsage = createModelUsageSummary()
  let modelUsageFlushTimer: ReturnType<typeof setInterval> | null = null

  function emitModelUsage(): void {
    const properties = modelUsage.drainProperties()
    if (!properties) return
    telemetry.emit('comfy.desktop.comfyui.model_usage_summary', {
      ...baseContext,
      model_summary_interval_seconds: MODEL_USAGE_FLUSH_INTERVAL_MS / 1000,
      ...properties
    })
  }

  function ensureModelUsageFlushTimer(): void {
    if (modelUsageFlushTimer) return
    modelUsageFlushTimer = setInterval(emitModelUsage, MODEL_USAGE_FLUSH_INTERVAL_MS)
    modelUsageFlushTimer.unref?.()
  }

  /**
   * Emit the single per-boot `accelerator_detected` event for the collected run
   * of `Device:` lines. The first device is the one ComfyUI selected (the
   * authoritative compute GPU); the index-aligned parallel arrays carry every
   * detected GPU. No-op until at least one device is seen, and only once per
   * boot.
   */
  function emitAccelerator(): void {
    if (acceleratorEmitted || devices.length === 0) return
    acceleratorEmitted = true
    const primary = devices[0]!
    const vramGb = vramMb != null ? Math.round(vramMb / 1024) : null
    // DirectML logs a nameless `Device: privateuseone`; recover the model from
    // the earlier `Using directml with device:` line (never for cpu/mps).
    const primaryName =
      primary.deviceName ??
      (primary.deviceType !== 'cpu' && primary.deviceType !== 'mps' ? directmlDeviceName : null)
    // The telemetry layer only accepts scalars + scalar arrays (and only scrubs
    // PII from those), so report all devices as parallel arrays aligned by index
    // rather than an array of objects.
    const gpuModels = devices.map((d, i) => (i === 0 ? primaryName : d.deviceName))
    telemetry.emit('comfy.desktop.comfyui.accelerator_detected', {
      ...baseContext,
      device_type: primary.deviceType,
      device_index: primary.deviceIndex,
      gpu_model: primaryName,
      backend: primary.backend,
      device_count: devices.length,
      device_types: devices.map((d) => d.deviceType),
      device_indices: devices.map((d) => d.deviceIndex),
      gpu_models: gpuModels,
      device_backends: devices.map((d) => d.backend),
      vram_mb: vramMb,
      vram_gb: vramGb,
      ram_mb: ramMb,
      pytorch_version: pytorchVersion,
      xformers_version: xformersVersion,
      cuda_device_set: cudaDeviceSet
    })
    // The compute device ComfyUI selected is more authoritative than the
    // OS-enumerated GPU in `system_info` (which can be a virtual display).
    // Promote it under dedicated `comfyui_*` person props so cohort queries can
    // coalesce(comfyui_gpu_model, gpu_model) without losing either signal. Only
    // for real accelerators; `cpu` is not a GPU.
    if (primaryName && primary.deviceType !== 'cpu') {
      telemetry.registerPersonProperties({
        comfyui_gpu_model: primaryName,
        comfyui_gpu_vram_gb: vramGb,
        comfyui_device_type: primary.deviceType,
        comfyui_gpu_count: devices.length
      })
    }
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
      const directml = parseTail(trimmed, DIRECTML_LINE)
      if (directml) {
        directmlDeviceName = directml
        return
      }
      const device = parseDeviceLine(trimmed)
      if (device) {
        // Collect the consecutive run; the event is emitted when the run ends.
        if (devices.length < MAX_DEVICES) devices.push(device)
        return
      }
      // A model line can be the first line after the device run, so continue
      // processing it after closing the accelerator event.
      if (devices.length > 0) emitAccelerator()
    }

    if (modelUsage.recordLine(trimmed)) ensureModelUsageFlushTimer()
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
    // Split first so a large chunk's complete lines (e.g. `Device:`) are never
    // lost; cap only the unterminated tail we carry over, which is the sole
    // unbounded-growth risk.
    const lines = (pendingBySource[source] + chunk).split(/\r?\n/)
    const tail = lines.pop() ?? ''
    pendingBySource[source] =
      tail.length > MAX_PENDING_CHARS ? tail.slice(-MAX_PENDING_CHARS) : tail
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
        // ignore - telemetry side effect, not user-visible
      }
    },
    /**
     * Reset per-boot accelerator accumulation. A single launch can restart
     * ComfyUI several times (port/reboot retries, model-folder relaunch,
     * Manager restarts), each reusing this tap. Without this, only the first
     * boot would emit `accelerator_detected` and stale fields would suppress
     * later boots.
     */
    beginBoot(): void {
      acceleratorEmitted = false
      vramMb = null
      ramMb = null
      pytorchVersion = null
      xformersVersion = null
      cudaDeviceSet = null
      directmlDeviceName = null
      devices.length = 0
      // Drop any incomplete lines from the previous (now-dead) process streams.
      pendingBySource.stdout = ''
      pendingBySource.stderr = ''
    },
    flushSummary(): void {
      try {
        // Process complete-but-unterminated final lines so a trailing `Device:`
        // line isn't dropped when the process exits without a newline.
        for (const source of ['stdout', 'stderr'] as const) {
          const pending = pendingBySource[source]
          if (pending.trim()) handleLine(pending)
          pendingBySource[source] = ''
        }
        // Processing a trailing model line can arm the timer, so clear it only
        // after every pending line has passed through the parser.
        if (modelUsageFlushTimer) {
          clearInterval(modelUsageFlushTimer)
          modelUsageFlushTimer = null
        }
        // Emit the accelerator event if the process exited right after its
        // `Device:` lines with no following line to close the run.
        emitAccelerator()
        emitModelUsage()
      } catch {
        // ignore - telemetry side effect, not user-visible
      }
    }
  }
}
