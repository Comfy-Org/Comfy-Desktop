/**
 * Boot-phase timing buffer (failure-only flush).
 *
 * `comfy.desktop.comfyui.boot_started` is one of the loudest events we have:
 * it fires on EVERY relaunch (~258k / 14d in prod). Emitting a `boot_phase`
 * event for each launch-progress phase on every healthy boot would multiply
 * that volume by the phase count for zero analytical gain — healthy boot
 * timing is already covered by `instance_started.boot_time_ms`.
 *
 * So we DON'T emit phase timings on the happy path. Instead, each launch
 * buffers its phase-entry timestamps in memory (keyed by installation_id),
 * and the buffer is flushed as `comfy.desktop.comfyui.boot_phase` events
 * ONLY when the boot fails or times out — paired with the
 * `comfy.desktop.comfyui.boot_failed` event the caller emits. The phase
 * timings are then the breakdown that explains WHERE a failed boot stalled
 * (e.g. it reached `gpu` at 40s and never got past it before the 5-min
 * waitForPort timeout).
 *
 * Lifecycle per launch:
 *   - `startBootPhases(installationId, variant)` at spawn time (resets any
 *     stale buffer from a previous attempt on the same id).
 *   - `recordBootPhase(installationId, phase)` as the launch-progress tracker
 *     enters each phase. Records `ms_since_boot_started`. First entry per
 *     phase wins (skip-advance / re-entry doesn't double-count).
 *   - on SUCCESS: `clearBootPhases(installationId)` — discard the buffer, emit
 *     nothing.
 *   - on FAILURE: `flushBootPhasesOnFailure(installationId)` — emit one
 *     `boot_phase` event per buffered phase, then clear.
 *
 * Bounded by construction: at most one buffer per installation_id, each
 * holding at most one entry per distinct phase name (a handful). Buffers are
 * always terminally cleared (success clears, failure flushes-then-clears), and
 * `startBootPhases` resets on re-attempt, so a crash mid-launch can't leak a
 * buffer across more than the next attempt.
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

/**
 * Begin (or restart) buffering boot-phase timings for an installation. Called
 * at spawn time. Resets any buffer left over from a prior attempt on the same
 * id so retries measure from the current attempt's start.
 */
export function startBootPhases(installationId: string, variant: string | null): void {
  _buffers.set(installationId, {
    installationId,
    variant,
    bootStartedAt: Date.now(),
    entries: [],
    seen: new Set()
  })
}

/**
 * Record entry into a launch phase. No-op if no buffer is active for this id
 * (e.g. the launch-progress tracker emitted a phase after a terminal flush) or
 * if the phase was already recorded for this attempt (skip-advance / re-entry).
 */
export function recordBootPhase(installationId: string, phase: string): void {
  const buf = _buffers.get(installationId)
  if (!buf) return
  if (buf.seen.has(phase)) return
  buf.seen.add(phase)
  buf.entries.push({ phase, msSinceBootStarted: Date.now() - buf.bootStartedAt })
}

/**
 * Discard the buffer for a successful boot. Emits nothing — healthy boots do
 * not produce `boot_phase` events (see the module header for why).
 */
export function clearBootPhases(installationId: string): void {
  _buffers.delete(installationId)
}

/**
 * Flush buffered phase timings as `comfy.desktop.comfyui.boot_phase` events for
 * a FAILED boot, then clear the buffer. Returns the phase id of the last phase
 * the boot reached (or `null` if it never entered any phase) so the caller can
 * tag `boot_failed.failed_phase`. Emits one event per buffered phase via
 * `emit()` so each rides the Datadog mirror alongside `boot_failed`.
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
