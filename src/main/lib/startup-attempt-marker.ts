import fs from 'fs'
import path from 'path'
import { configDir } from './paths'
import { readFileWithRetrySync, writeFileSafe } from './safe-file'

export interface StartupAttemptMarker {
  version: string
  attemptedAt: string
  attemptId?: string
  reportedOutcome?: string
}

export type StartupAttemptMarkerRead =
  | { state: 'present'; marker: StartupAttemptMarker }
  | { state: 'absent' }
  | { state: 'unavailable' }

function markerPath(): string {
  return path.join(configDir(), 'startup-update-attempt.json')
}

export function readStartupAttemptMarker(): StartupAttemptMarkerRead {
  const outcome = readFileWithRetrySync(markerPath())
  if (outcome.kind === 'unreadable') return { state: 'unavailable' }
  if (outcome.kind === 'absent') return { state: 'absent' }
  try {
    const parsed: unknown = JSON.parse(outcome.data)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as StartupAttemptMarker).version === 'string'
    ) {
      const marker = parsed as StartupAttemptMarker
      return {
        state: 'present',
        marker: {
          version: marker.version,
          attemptedAt: typeof marker.attemptedAt === 'string' ? marker.attemptedAt : '',
          ...(typeof marker.attemptId === 'string' && marker.attemptId
            ? { attemptId: marker.attemptId }
            : {}),
          ...(typeof marker.reportedOutcome === 'string' && marker.reportedOutcome
            ? { reportedOutcome: marker.reportedOutcome }
            : {})
        }
      }
    }
  } catch {}
  return { state: 'absent' }
}

export function recordStartupAttempt(version: string, attemptId: string): boolean {
  const marker: StartupAttemptMarker = {
    version,
    attemptedAt: new Date().toISOString(),
    attemptId
  }
  try {
    writeFileSafe(markerPath(), JSON.stringify(marker, null, 2), { durable: true })
  } catch {
    return false
  }
  const readBack = readStartupAttemptMarker()
  return (
    readBack.state === 'present' &&
    readBack.marker.version === version &&
    readBack.marker.attemptId === attemptId
  )
}

export function recordStartupAttemptOutcome(marker: StartupAttemptMarker, outcome: string): void {
  try {
    writeFileSafe(markerPath(), JSON.stringify({ ...marker, reportedOutcome: outcome }, null, 2), {
      durable: true
    })
  } catch {}
}

export function clearStartupAttemptMarker(): void {
  try {
    fs.unlinkSync(markerPath())
  } catch {}
}
