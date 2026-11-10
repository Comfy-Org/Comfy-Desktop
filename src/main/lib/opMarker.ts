import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { hasTrackedChanges, readGitHead, rollbackComfySource } from './git'
import * as telemetry from './telemetry'

const MARKER_NAME = '.comfyui-op-in-progress.json'

export interface OpMarker {
  op: 'update' | 'restore'
  preHead: string
  startedAt: number
  postHead?: string
  recoveryAttempts?: number
  backupBranch?: string
}

const MAX_RECOVERY_ATTEMPTS = 3
const UPDATE_UNFINISHED = 'The last update did not finish. Run Update to repair.'

function markerPath(installPath: string): string {
  return path.join(installPath, MARKER_NAME)
}

export function backupBranchHint(branchName: string | undefined): string {
  return branchName ? ` Your previous state is preserved on local git branch "${branchName}".` : ''
}

export function rollbackStatusMessage(
  rolledBack: boolean,
  headSha: string,
  backupBranch: string | undefined
): string {
  return rolledBack
    ? `ComfyUI source was rolled back to ${headSha.slice(0, 7)}.`
    : `ComfyUI source rollback failed; installation may be inconsistent.${backupBranchHint(backupBranch)}`
}

export async function writeOpMarker(installPath: string, marker: OpMarker): Promise<void> {
  const target = markerPath(installPath)
  const tmp = `${target}.${crypto.randomUUID()}.tmp`
  try {
    await fs.promises.writeFile(tmp, JSON.stringify(marker), 'utf-8')
    await fs.promises.rename(tmp, target)
  } catch (err) {
    console.warn('Failed to write op-in-progress marker:', err)
    await fs.promises.rm(tmp, { force: true }).catch(() => {})
  }
}

export function readOpMarker(installPath: string): OpMarker | null {
  try {
    const m = JSON.parse(fs.readFileSync(markerPath(installPath), 'utf-8')) as OpMarker
    if ((m.op === 'update' || m.op === 'restore') && typeof m.preHead === 'string' && m.preHead) {
      return m
    }
  } catch {}
  return null
}

export async function clearOpMarker(installPath: string): Promise<void> {
  try {
    await fs.promises.unlink(markerPath(installPath))
  } catch {}
}

export async function completeOpMarker(installPath: string): Promise<void> {
  const marker = readOpMarker(installPath)
  if (marker && !marker.postHead) {
    const postHead = readGitHead(path.join(installPath, 'ComfyUI')) ?? marker.preHead
    await writeOpMarker(installPath, { ...marker, postHead })
  }
  await clearOpMarker(installPath)
}

export async function recoverInterruptedComfyOp(
  installPath: string,
  sendOutput?: (text: string) => void,
  onRollback?: () => void
): Promise<boolean> {
  const marker = readOpMarker(installPath)
  if (!marker) return false

  if (marker.postHead) {
    await clearOpMarker(installPath)
    return true
  }

  const comfyuiDir = path.join(installPath, 'ComfyUI')
  if (readGitHead(comfyuiDir) !== marker.preHead) {
    sendOutput?.(
      `\nDetected an interrupted ${marker.op}; rolling ComfyUI source back to keep it consistent…\n`
    )
    const ok = await rollbackComfySource(comfyuiDir, marker.preHead, sendOutput)
    if (!ok || readGitHead(comfyuiDir) !== marker.preHead) {
      const attempts = (marker.recoveryAttempts ?? 0) + 1
      const gaveUp = attempts >= MAX_RECOVERY_ATTEMPTS && marker.op !== 'update'
      telemetry.emit('comfy.desktop.recovery.failed', { op: marker.op, attempts, gave_up: gaveUp })
      const backupHint = backupBranchHint(marker.backupBranch)
      if (gaveUp) {
        console.warn(
          `Giving up rolling ComfyUI source back after ${attempts} attempts; dropping recovery marker.`
        )
        sendOutput?.(
          `\n⚠ Could not roll ComfyUI source back after ${attempts} attempts; continuing launch. Re-run an update if ComfyUI fails to start.${backupHint}\n`
        )
        await clearOpMarker(installPath)
        return true
      }
      await writeOpMarker(installPath, { ...marker, recoveryAttempts: attempts })
      throw new Error(
        marker.op === 'update'
          ? `${UPDATE_UNFINISHED}${backupHint}`
          : `could not roll ComfyUI source back to ${marker.preHead.slice(0, 7)} after an interrupted ${marker.op}.${backupHint}`
      )
    }
    telemetry.emit('comfy.desktop.recovery.rolled_back', { op: marker.op })
    onRollback?.()
  }
  if (marker.op === 'update' && (await hasTrackedChanges(comfyuiDir)) !== false) {
    throw new Error(`${UPDATE_UNFINISHED}${backupBranchHint(marker.backupBranch)}`)
  }
  await clearOpMarker(installPath)
  return true
}
