/**
 * Durable sidecar for the startup-install loop-breaker (issue #1367).
 *
 * The settings copy of the marker (`lastStartupUpdateAttemptVersion`) is the
 * last write before the app quits into the installer, so settings.json.bak
 * never contains it - a `.bak` restore under AV/indexer interference erases
 * it and the same version reinstalls on every boot. This sidecar keeps the
 * marker in a tiny file of its own: no `.bak` machinery to roll it back, no
 * other writers, and read-back verification so the caller can fail closed
 * when the marker is not durable (see `applyPendingUpdateOnStartup`).
 *
 * Reads are tri-state: a marker file that EXISTS but cannot be read (lock
 * outlasting the retry budget) may record an attempt of exactly the pending
 * version, so it must surface as `unavailable`, never as `absent` - absent is
 * what authorizes an install.
 */

import fs from 'fs'
import path from 'path'
import { configDir } from './paths'
import { readFileWithRetrySync, writeFileSafe } from './safe-file'

export interface StartupAttemptMarker {
  version: string
  attemptedAt: string
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
          attemptedAt: typeof marker.attemptedAt === 'string' ? marker.attemptedAt : ''
        }
      }
    }
  } catch {}
  // Unparseable content can't loop-break anything; treat it like the file
  // isn't there (writes are atomic, so this is not a torn write).
  return { state: 'absent' }
}

/**
 * Record that a startup install of `version` is about to run, and verify the
 * marker actually landed on disk. Returns false when it could not be persisted
 * or the read-back does not match - the caller must then NOT install, because
 * a marker that only lives in memory cannot break the reinstall loop.
 */
export function recordStartupAttempt(version: string): boolean {
  const marker: StartupAttemptMarker = { version, attemptedAt: new Date().toISOString() }
  try {
    writeFileSafe(markerPath(), JSON.stringify(marker, null, 2))
  } catch {
    return false
  }
  const readBack = readStartupAttemptMarker()
  return readBack.state === 'present' && readBack.marker.version === version
}

export function clearStartupAttemptMarker(): void {
  try {
    fs.unlinkSync(markerPath())
  } catch {}
}
