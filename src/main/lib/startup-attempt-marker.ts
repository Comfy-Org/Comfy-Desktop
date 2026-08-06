/**
 * Durable sidecar for the startup-install loop-breaker (issue #1367).
 *
 * The loop-breaker used to live only in settings.json
 * (`lastStartupUpdateAttemptVersion`). That write happens milliseconds before
 * the app quits into the installer, so settings.json.bak is always frozen at
 * the pre-marker state - and on machines where antivirus/indexer interference
 * transiently locks settings.json at boot, the read fallback restored `.bak`
 * and silently erased the marker. The "install once per version" guarantee
 * failed open and those machines reinstalled the same Desktop update on every
 * boot, indefinitely (telemetry: single devices with 200+ startup_install
 * events for one version).
 *
 * This sidecar mirrors the marker in a tiny file of its own: no `.bak`
 * machinery to roll it back, no other writers to race, and a read-back
 * verification so the caller can refuse to install when the marker could not
 * be made durable (fail closed instead of looping - see
 * `applyPendingUpdateOnStartup`).
 *
 * Reads are deliberately tri-state: a marker file that EXISTS but cannot be
 * read (AV lock outlasting the retry budget) must not be reported as absent -
 * "absent" is what authorizes an install, and the unreadable file may well
 * record an attempt of exactly the version about to be installed. Collapsing
 * the two would reopen the fail-open loop this module exists to close.
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
