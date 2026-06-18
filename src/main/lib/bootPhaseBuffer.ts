/**
 * Boot-phase timing buffer. Phase timings are buffered in memory per
 * installation_id and emitted as `comfy.desktop.comfyui.boot_phase` ONLY on
 * boot failure (paired with `boot_failed`), never on healthy boots — which
 * would multiply the ~258k/14d boot volume for no gain. Bounded (one buffer
 * per id, one entry per phase) and always terminally cleared.
 */
import * as telemetry from './telemetry'

interface BootPhaseEntry {
  phase: string
  msSinceBootStarted: number
}

interface BootPhaseBuffer {
  installationId: string
  variant: string | null
  bootStartedAt: number
  /** Insertion-ordered phase entries; one per distinct phase name. */
  entries: BootPhaseEntry[]
  seen: Set<string>
}

const _buffers = new Map<string, BootPhaseBuffer>()

/** Begin/restart buffering for an installation (resets a prior attempt's buffer). */
export function startBootPhases(installationId: string, variant: string | null): void {
  _buffers.set(installationId, {
    installationId,
    variant,
    bootStartedAt: Date.now(),
    entries: [],
    seen: new Set()
  })
}

/** Record first entry into a phase; no-op without an active buffer or on re-entry. */
export function recordBootPhase(installationId: string, phase: string): void {
  const buf = _buffers.get(installationId)
  if (!buf) return
  if (buf.seen.has(phase)) return
  buf.seen.add(phase)
  buf.entries.push({ phase, msSinceBootStarted: Date.now() - buf.bootStartedAt })
}

/** Discard the buffer on a successful boot (emits nothing). */
export function clearBootPhases(installationId: string): void {
  _buffers.delete(installationId)
}

/**
 * Emit one boot_phase event per buffered phase on failure, then clear.
 * Returns the last phase reached (for `boot_failed.failed_phase`), or null.
 */
export function flushBootPhasesOnFailure(installationId: string): string | null {
  const buf = _buffers.get(installationId)
  if (!buf) return null
  _buffers.delete(installationId)
  let lastPhase: string | null = null
  for (const entry of buf.entries) {
    lastPhase = entry.phase
    telemetry.emit('comfy.desktop.comfyui.boot_phase', {
      installation_id: buf.installationId,
      variant: buf.variant,
      phase: entry.phase,
      ms_since_boot_started: entry.msSinceBootStarted
    })
  }
  return lastPhase
}

/** @internal — exposed for tests. */
export function _peekBootPhases(installationId: string): readonly BootPhaseEntry[] | null {
  return _buffers.get(installationId)?.entries ?? null
}

/** @internal — exposed for tests. */
export function _resetForTest(): void {
  _buffers.clear()
}
