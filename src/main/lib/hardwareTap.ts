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
 *     (model class, trigger) in memory and flush DELTAS (periodically + on
 *     session end), at most one event per distinct (class, trigger) per flush.
 *     Summing `count` gives total loads; counting distinct `installation_id`
 *     gives reach (no person-property marker needed — reach is derivable from
 *     the events). `model_class` is the loaded module's Python class name
 *     (`x.model.__class__.__name__`) — the real architecture (e.g. `Lumina2`,
 *     `Flux`), text encoder (`ZImageTEModel_`), or VAE (`AutoencodingEngine`) —
 *     NOT the sampling `model_type` enum, which can't identify an architecture.
 *     `load_trigger` distinguishes the two log signals:
 *       - `requested` — "Requested to load X": a cold load (model not resident).
 *         Misses runs that reuse an already-loaded model.
 *       - `dynamic_prepare` — "Model X prepared for dynamic VRAM loading":
 *         emitted per prepare when dynamic VRAM (aimdo) is enabled, so it tracks
 *         models that stay staged across runs. Absent when dynamic VRAM is off.
 *     Neither line is a perfect per-run-per-model signal on its own — see the
 *     PR discussion — but together they cover cold loads and dynamic reuse.
 *
 * Log strings parsed (current ComfyUI main branch):
 *   - "Device: cuda:0 NVIDIA GeForce RTX 4090 : native"   (model_management.py)
 *   - "Total VRAM 24576 MB, total RAM 65461 MB"
 *   - "pytorch version: 2.10.0+cu130" / "xformers version: 0.0.x"
 *   - "Set cuda device to: 0"                              (main.py)
 *   - "Requested to load Lumina2"                          (model_management.py)
 *   - "Model Lumina2 prepared for dynamic VRAM loading. …" (dynamic VRAM / aimdo)
 *
 * NOTE: the architecture is the loaded class name on the `Requested to load`
 * line, NOT the `model_type <ENUM>` sampling tag — `model_type` is the same
 * `EPS` / `FLOW` for many distinct architectures and so can't identify one.
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
// ComfyUI logs `Requested to load <ClassName>` once per cold GPU load, where the
// name is the loaded module's Python class (`x.model.__class__.__name__`) — the
// real architecture (`Lumina2`, `Flux`), text encoder (`ZImageTEModel_`), or
// VAE (`AutoencodingEngine`). Match a whole Python identifier only: custom
// nodes write to the same stdout, so a loose `.+` could turn an arbitrary
// string into a high-cardinality event value. The length cap bounds a
// pathological match.
const REQUESTED_LOAD_LINE = /^Requested to load\s+([A-Za-z_][A-Za-z0-9_]{0,63})\s*$/
// With dynamic VRAM (aimdo) enabled, ComfyUI logs `Model <ClassName> prepared
// for dynamic VRAM loading. <N>MB Staged. …` per prepare — the same class name
// as `Requested to load`, but emitted for models that stay staged across runs
// (so it captures reuse that the cold-load line misses). Same identifier-only
// constraint and length cap as above.
const DYNAMIC_PREPARE_LINE =
  /^Model\s+([A-Za-z_][A-Za-z0-9_]{0,63})\s+prepared for dynamic VRAM loading\b/

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

/** How a model load was observed in the logs. */
export type ModelLoadTrigger = 'requested' | 'dynamic_prepare'

/** Parse "Requested to load Lumina2" → "Lumina2". */
export function parseRequestedModelLoad(line: string): string | null {
  return parseTail(line, REQUESTED_LOAD_LINE)
}

/** Parse "Model Lumina2 prepared for dynamic VRAM loading. …" → "Lumina2". */
export function parseDynamicVramPrepare(line: string): string | null {
  return parseTail(line, DYNAMIC_PREPARE_LINE)
}

/**
 * Match either model-load log line, returning the loaded class and which
 * signal produced it, or null. `Requested to load` is a cold load;
 * `Model X prepared for dynamic VRAM loading` is a dynamic-VRAM (aimdo) prepare.
 */
export function parseModelLoad(
  line: string
): { modelClass: string; trigger: ModelLoadTrigger } | null {
  const requested = parseRequestedModelLoad(line)
  if (requested) return { modelClass: requested, trigger: 'requested' }
  const prepared = parseDynamicVramPrepare(line)
  if (prepared) return { modelClass: prepared, trigger: 'dynamic_prepare' }
  return null
}

/** Flush model-usage deltas at most this often while a session keeps loading models. */
const MODEL_USAGE_FLUSH_INTERVAL_MS = 5 * 60_000
/**
 * Hard cap on distinct (class, trigger) keys tracked, so a malformed log can't
 * grow the map. Kept at/under the telemetry per-event-name rate limit (60/min)
 * because a flush emits every pending key synchronously into one window — a
 * larger cap would let a single full flush self-throttle and drop its tail.
 */
const MAX_TRACKED_ARCHITECTURES = 60

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

  // Per-(class, trigger) load counts since the last flush (deltas). The map key
  // is `<trigger>\t<class>`; `\t` can't appear in either (trigger is a literal,
  // class is a Python identifier), so it's a safe composite key.
  const pendingCounts = new Map<string, number>()
  // Every (class, trigger) key ever recorded by this tap. Persists across
  // flushes (which clear `pendingCounts`) so the cardinality cap below bounds
  // distinct `model_class` values over the tap's whole lifetime, not just the
  // current flush window — a malformed log can't grow the event-value space.
  const seenKeys = new Set<string>()

  let flushTimer: ReturnType<typeof setInterval> | null = null

  function recordLoad(modelClass: string, trigger: ModelLoadTrigger): void {
    const key = `${trigger}\t${modelClass}`
    // Reject brand-new (class, trigger) pairs once the cap is hit; keep counting
    // ones already seen so existing series stay accurate.
    if (!seenKeys.has(key)) {
      if (seenKeys.size >= MAX_TRACKED_ARCHITECTURES) return
      seenKeys.add(key)
    }
    pendingCounts.set(key, (pendingCounts.get(key) ?? 0) + 1)
    ensureFlushTimer()
  }

  function emitModelUsage(): void {
    if (pendingCounts.size === 0) return
    for (const [key, count] of pendingCounts) {
      if (count <= 0) continue
      const sep = key.indexOf('\t')
      const trigger = key.slice(0, sep)
      const modelClass = key.slice(sep + 1)
      telemetry.emit('comfy.desktop.comfyui.model_usage', {
        ...baseContext,
        model_class: modelClass,
        load_trigger: trigger,
        count
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

    const load = parseModelLoad(trimmed)
    if (load) {
      recordLoad(load.modelClass, load.trigger)
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
    // `Requested to load`) are never lost; cap only the unterminated tail we
    // carry over, which is the sole unbounded-growth risk.
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
