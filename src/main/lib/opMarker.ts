import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { readGitHead, rollbackComfySource } from './git'
import * as telemetry from './telemetry'

// Sentinel written to the install dir while an update/restore is moving ComfyUI's
// git source. Cleared once the operation finishes consistently. If it survives to
// the next launch, the operation was interrupted by a hard process kill (no
// finally/cleanup ran), so we roll the source back to the pre-operation commit.
const MARKER_NAME = '.comfyui-op-in-progress.json'

export interface OpMarker {
  op: 'update' | 'restore'
  /** Full git SHA of ComfyUI's HEAD before the operation moved the source. */
  preHead: string
  startedAt: number
  /**
   * Set only once the operation reached a consistent state (source + packages).
   * Its presence marks the op as completed: recovery must NOT roll back, even
   * though HEAD legitimately differs from preHead. Guards against the "success
   * but the final unlink failed" case wrongly rolling a good update back.
   */
  postHead?: string
  /** Number of launch-time recovery attempts that failed to roll the source back. */
  recoveryAttempts?: number
  /**
   * Name of the local backup branch the update script created at the pre-op HEAD
   * (it also carries any uncommitted edits). Recorded for diagnostics only: it
   * lets a failed-recovery message point the user at an offline restore point.
   * It is NOT a rollback target: recovery always resets to `preHead` so the
   * source stays clean and matches the installed deps.
   */
  backupBranch?: string
}

// After this many failed launch-time rollbacks we stop blocking the launch and
// drop the marker. This bounds transient failures (git index lock, AV holding a
// file) to a few retries while preventing an unrecoverable rollback (e.g. the
// pre-op commit is gone) from locking the user out of launching forever.
const MAX_RECOVERY_ATTEMPTS = 3

function markerPath(installPath: string): string {
  return path.join(installPath, MARKER_NAME)
}

/**
 * Trailing sentence naming the local backup branch as an offline restore point,
 * or '' when there is none. Shared so the update-failure and launch-recovery
 * messages can't drift apart.
 */
export function backupBranchHint(branchName: string | undefined): string {
  return branchName
    ? ` Your previous state is preserved on local git branch "${branchName}".`
    : ''
}

/**
 * Status line describing the outcome of a ComfyUI source rollback. Shared by the
 * git-script-failure and dependency-sync-failure paths so their wording can't drift.
 */
export function rollbackStatusMessage(
  rolledBack: boolean,
  headSha: string,
  backupBranch: string | undefined,
): string {
  return rolledBack
    ? `ComfyUI source was rolled back to ${headSha.slice(0, 7)}.`
    : `ComfyUI source rollback failed; installation may be inconsistent.${backupBranchHint(backupBranch)}`
}

export async function writeOpMarker(installPath: string, marker: OpMarker): Promise<void> {
  // Write atomically (temp file + rename) so an interrupted write can't leave a
  // truncated marker, which readOpMarker would treat as "no marker" and skip recovery.
  const target = markerPath(installPath)
  const tmp = `${target}.${crypto.randomUUID()}.tmp`
  try {
    await fs.promises.writeFile(tmp, JSON.stringify(marker), 'utf-8')
    await fs.promises.rename(tmp, target)
  } catch (err) {
    console.warn('Failed to write op-in-progress marker:', err)
    await fs.promises.rm(tmp, { force: true }).catch(() => { /* best-effort cleanup */ })
  }
}

export function readOpMarker(installPath: string): OpMarker | null {
  try {
    const m = JSON.parse(fs.readFileSync(markerPath(installPath), 'utf-8')) as OpMarker
    if ((m.op === 'update' || m.op === 'restore') && typeof m.preHead === 'string' && m.preHead) {
      return m
    }
  } catch { /* missing or malformed — nothing to recover */ }
  return null
}

export async function clearOpMarker(installPath: string): Promise<void> {
  try { await fs.promises.unlink(markerPath(installPath)) } catch { /* already gone */ }
}

/**
 * Mark the current operation as completed (source + packages consistent) and
 * remove the marker. The completion stamp is written *before* the delete so that
 * if the delete fails — or the process is killed right after — the next launch
 * sees a completed marker and does NOT roll the successful operation back.
 */
export async function completeOpMarker(installPath: string): Promise<void> {
  const marker = readOpMarker(installPath)
  if (marker && !marker.postHead) {
    const postHead = readGitHead(path.join(installPath, 'ComfyUI')) ?? marker.preHead
    await writeOpMarker(installPath, { ...marker, postHead })
  }
  await clearOpMarker(installPath)
}

/**
 * Roll ComfyUI's source back if a previous update/restore was interrupted by a
 * hard process kill (the marker survived because no in-process cleanup ran).
 * Idempotent — a no-op when HEAD already matches the recorded pre-operation
 * commit (the common case: the op concluded but the marker lingered). Returns
 * true when a marker was found and consumed. Throws if a rollback was needed but
 * failed, leaving the marker in place so the next launch can retry — until
 * MAX_RECOVERY_ATTEMPTS is reached, after which it gives up and drops the marker
 * rather than locking the user out of launching forever.
 *
 * `onRollback` fires only when an ACTUAL source rollback ran (HEAD had moved) —
 * i.e. a genuine repair, not a benign marker cleanup. Callers use it to surface
 * a "Repairing installation…" step in the launch progress UI.
 */
export async function recoverInterruptedComfyOp(
  installPath: string,
  sendOutput?: (text: string) => void,
  onRollback?: () => void,
): Promise<boolean> {
  const marker = readOpMarker(installPath)
  if (!marker) return false

  // A completed marker means the op reached consistency; its delete just failed.
  // Never roll back here — just finish clearing it.
  if (marker.postHead) {
    await clearOpMarker(installPath)
    return true
  }

  const comfyuiDir = path.join(installPath, 'ComfyUI')
  if (readGitHead(comfyuiDir) !== marker.preHead) {
    // The source genuinely moved and we're rolling it back: a real interrupted op.
    sendOutput?.(`\nDetected an interrupted ${marker.op}; rolling ComfyUI source back to keep it consistent…\n`)
    const ok = await rollbackComfySource(comfyuiDir, marker.preHead, sendOutput)
    if (!ok || readGitHead(comfyuiDir) !== marker.preHead) {
      const attempts = (marker.recoveryAttempts ?? 0) + 1
      const gaveUp = attempts >= MAX_RECOVERY_ATTEMPTS
      // Reliability signal (mirrored to Datadog): how often a hard-killed op
      // leaves source we can't roll back, and how often we give up entirely.
      telemetry.emit('comfy.desktop.recovery.failed', { op: marker.op, attempts, gave_up: gaveUp })
      const backupHint = backupBranchHint(marker.backupBranch)
      if (gaveUp) {
        // Rollback can't succeed (e.g. the pre-op commit is gone). Stop blocking:
        // drop the marker and let the launch proceed. ComfyUI may crash on import,
        // but that surfaces a real, recoverable error instead of an opaque,
        // permanent launch lockout — and the user can re-run an update to repair.
        // If the update script saved a local backup branch, name it so the user
        // has an offline restore point when automatic rollback can't finish.
        console.warn(`Giving up rolling ComfyUI source back after ${attempts} attempts; dropping recovery marker.`)
        sendOutput?.(`\n⚠ Could not roll ComfyUI source back after ${attempts} attempts; continuing launch. Re-run an update if ComfyUI fails to start.${backupHint}\n`)
        await clearOpMarker(installPath)
        return true
      }
      // Persist the attempt count and block this launch so the next one retries.
      await writeOpMarker(installPath, { ...marker, recoveryAttempts: attempts })
      throw new Error(`could not roll ComfyUI source back to ${marker.preHead.slice(0, 7)} after an interrupted ${marker.op}.${backupHint}`)
    }
    // Successfully recovered a hard-killed op — informational signal (PostHog).
    telemetry.emit('comfy.desktop.recovery.rolled_back', { op: marker.op })
    onRollback?.()
  }
  await clearOpMarker(installPath)
  return true
}
