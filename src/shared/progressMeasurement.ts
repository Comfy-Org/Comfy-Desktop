import type { ProgressData } from '../types/ipc'

export const BYTES_PER_MB = 1048576

/**
 * Structured throughput fields for an `install-progress` emission.
 *
 * Producers measure speed in MB/s and carry `-1` for "no ETA yet"; the wire
 * format is bytes and omission. Unmeasured samples are dropped rather than
 * zeroed so a consumer can distinguish "not known yet" from "stalled" — the
 * projection logic downstream treats those very differently.
 */
export function measuredProgress(
  speedMBs: number,
  etaSecs: number
): Pick<ProgressData, 'speedBytesPerSec' | 'etaSeconds'> {
  return {
    ...(speedMBs > 0 ? { speedBytesPerSec: Math.round(speedMBs * BYTES_PER_MB) } : {}),
    ...(etaSecs >= 0 ? { etaSeconds: Math.round(etaSecs) } : {})
  }
}
