import * as telemetry from './telemetry'

interface BootPhaseEntry {
  phase: string
  msSinceBootStarted: number
}

interface BootPhaseBuffer {
  installationId: string
  variant: string | null
  bootStartedAt: number
  entries: BootPhaseEntry[]
  seen: Set<string>
}

const _buffers = new Map<string, BootPhaseBuffer>()

export function startBootPhases(installationId: string, variant: string | null): void {
  _buffers.set(installationId, {
    installationId,
    variant,
    bootStartedAt: Date.now(),
    entries: [],
    seen: new Set()
  })
}

export function recordBootPhase(installationId: string, phase: string): void {
  const buf = _buffers.get(installationId)
  if (!buf) return
  if (buf.seen.has(phase)) return
  buf.seen.add(phase)
  buf.entries.push({ phase, msSinceBootStarted: Date.now() - buf.bootStartedAt })
}

export function clearBootPhases(installationId: string): void {
  _buffers.delete(installationId)
}

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

export function _peekBootPhases(installationId: string): readonly BootPhaseEntry[] | null {
  return _buffers.get(installationId)?.entries ?? null
}

export function _resetForTest(): void {
  _buffers.clear()
}
