/**
 * Peak-VRAM sampling for benchmark runs.
 *
 * ComfyUI exposes live device memory at `GET /system_stats`. We sample it on the
 * existing 1000ms performance-test poll and track the max used-VRAM across the
 * run. Backend-aware: on `mps`/`cpu` the reported `vram_total` is really system
 * RAM (unified memory), so we flag `vramIsUnified` and the UI relabels
 * accordingly instead of claiming dedicated VRAM.
 *
 * `used = devices[0].vram_total - devices[0].vram_free`. The pure accumulator is
 * unit-tested; `fetchSystemStats` is the thin network wrapper wired into the
 * poll body.
 */

/** Shape of one device in the `/system_stats` response (fields we read). */
export interface SystemStatsDevice {
  name?: string
  /** `cuda` | `mps` | `cpu` | ... — the compute backend for this device. */
  type?: string
  /** Null on `mps`/`cpu` (no dedicated device index). */
  index?: number | null
  /** Total memory in bytes. On `mps`/`cpu` this is system RAM, not VRAM. */
  vram_total?: number
  vram_free?: number
  torch_vram_total?: number
  torch_vram_free?: number
}

export interface SystemStatsResponse {
  devices?: SystemStatsDevice[]
  system?: {
    ram_total?: number
    ram_free?: number
    pytorch_version?: string
    comfyui_version?: string
  }
}

/** Rolled-up peak-memory view for one benchmark run. */
export interface VramPeakSnapshot {
  /** Max used memory across samples (MB), or null if never sampled. */
  peakVramMb: number | null
  /** Device total memory (MB); system RAM when `vramIsUnified`. */
  vramTotalMb: number | null
  /** Compute backend of the primary device (`cuda` / `mps` / `cpu` / ...). */
  backend: string | null
  /** True when total is shared system memory (Apple `mps` or `cpu`). */
  vramIsUnified: boolean | null
  /** Number of successful samples folded in (0 = never measured). */
  sampleCount: number
}

const BYTES_PER_MB = 1024 * 1024

export interface VramPeakAccumulator {
  /** Fold one `/system_stats` response into the running peak. No-op on null. */
  sample(stats: SystemStatsResponse | null | undefined): void
  /** Current rolled-up view. Safe to call at any time. */
  snapshot(): VramPeakSnapshot
}

/** Create a stateful peak-VRAM accumulator (see module doc). */
export function createVramPeakAccumulator(): VramPeakAccumulator {
  let peakBytes = -1
  let totalBytes: number | null = null
  let backend: string | null = null
  let unified: boolean | null = null
  let sampleCount = 0

  return {
    sample(stats): void {
      const device = stats?.devices?.[0]
      if (!device) return
      sampleCount++
      if (typeof device.type === 'string') {
        backend = device.type
        unified = device.type === 'mps' || device.type === 'cpu'
      }
      if (typeof device.vram_total === 'number' && Number.isFinite(device.vram_total)) {
        totalBytes = device.vram_total
      }
      if (
        typeof device.vram_total === 'number' &&
        typeof device.vram_free === 'number' &&
        Number.isFinite(device.vram_total) &&
        Number.isFinite(device.vram_free)
      ) {
        const used = device.vram_total - device.vram_free
        if (used > peakBytes) peakBytes = used
      }
    },
    snapshot(): VramPeakSnapshot {
      return {
        peakVramMb: peakBytes >= 0 ? Math.round(peakBytes / BYTES_PER_MB) : null,
        vramTotalMb: totalBytes != null ? Math.round(totalBytes / BYTES_PER_MB) : null,
        backend,
        vramIsUnified: unified,
        sampleCount
      }
    }
  }
}

/**
 * Fetch `/system_stats` from a running instance. Best-effort: any failure
 * (offline, endpoint missing, malformed body, abort) returns null so the poll
 * loop keeps running and the run degrades to the "not measured" state.
 */
export async function fetchSystemStats(
  sessionUrl: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<SystemStatsResponse | null> {
  try {
    const response = await fetchImpl(new URL('/system_stats', sessionUrl), { signal })
    if (!response.ok) return null
    return (await response.json()) as SystemStatsResponse
  } catch {
    return null
  }
}
