import type { ComfyExitedData } from '../../types/ipc'

export const MAX_BUFFER_BYTES = 8 * 1024

const _crashes = new Map<string, ComfyExitedData>()

export function recordCrash(data: ComfyExitedData): void {
  const trimmed: ComfyExitedData = { ...data }
  if (trimmed.lastStderr && trimmed.lastStderr.length > MAX_BUFFER_BYTES) {
    trimmed.lastStderr = trimmed.lastStderr.slice(-MAX_BUFFER_BYTES)
  }
  if (trimmed.crashedAtMs === undefined) {
    trimmed.crashedAtMs = Date.now()
  }
  _crashes.set(data.installationId, trimmed)
}

export function clearCrash(installationId: string): void {
  _crashes.delete(installationId)
}

export function getCrash(installationId: string): ComfyExitedData | null {
  return _crashes.get(installationId) ?? null
}

export function getAllCrashes(): ComfyExitedData[] {
  return Array.from(_crashes.values())
}

export function _resetCrashBuffer(): void {
  _crashes.clear()
}
