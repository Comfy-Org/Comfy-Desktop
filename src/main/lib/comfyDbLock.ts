import fs from 'fs'
import path from 'path'
import { findLockingProcesses } from './file-lock-info'
import { holderIsInstall, listRecords } from './comfyProcessRecord'
import {
  commandLinesOf,
  parentPidOf,
  isPidAlive,
  readStartTimes,
  runsMainPy,
  startTokenToEpochMs
} from './processIdentity'

/**
 * ComfyUI's startup refusal when another process holds its database lock (`<db>.lock`, an OS
 * file lock released only when the holder exits). Matched on the lines ComfyUI prints: the
 * `app/database/db.py` lock error, the `main.py` summary, and the owner-naming form.
 */
const DB_LOCK_LINES = [
  /could not acquire lock on database/i,
  /already using this database/i,
  /database lock held by/i
]

export function isDbLockFailure(stderr: string | undefined): boolean {
  return !!stderr && DB_LOCK_LINES.some((re) => re.test(stderr))
}

function argValue(args: readonly string[], flag: string): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === flag) return args[i + 1] ?? null
    if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1)
  }
  return null
}

/**
 * The SQLite files a launch may have tried to lock, most likely first. ComfyUI's default moved
 * over time (`<ComfyUI>/user/comfyui.db`, now "the effective user directory"), so both are
 * candidates; a non-file `--database-url` yields none.
 */
export function databaseCandidates(cwd: string, args: readonly string[]): string[] {
  const url = argValue(args, '--database-url')
  if (url) {
    const m = /^sqlite:\/\/\/(.+)$/.exec(url)
    if (!m || m[1] === ':memory:') return []
    return [path.resolve(cwd, m[1]!)]
  }
  const sIdx = args.indexOf('-s')
  const mainPy = sIdx >= 0 ? args[sIdx + 1] : undefined
  const comfyDir = mainPy ? path.dirname(path.resolve(cwd, mainPy)) : null
  const userDir =
    argValue(args, '--user-directory') ??
    (argValue(args, '--base-directory')
      ? path.join(argValue(args, '--base-directory')!, 'user')
      : comfyDir && path.join(comfyDir, 'user'))
  const out = [userDir && path.join(path.resolve(cwd, userDir), 'comfyui.db')]
  if (comfyDir) out.push(path.join(comfyDir, 'user', 'comfyui.db'))
  return [...new Set(out.filter((p): p is string => !!p))]
}

export interface DbLockHolder {
  pid: number
  source: 'desktop_record' | 'restart_manager' | 'lsof'
  sameInstall: boolean
  /** Executable name only (e.g. `python.exe`), never a path or command line. */
  name: string | null
  /** Whether its command line runs a `main.py` — a ComfyUI, whoever started it. Only this
   *  boolean leaves the machine, never the command line. Null when it could not be read. */
  runsMainPy: boolean | null
  /** How long it has been running, in seconds. Null when unknown. */
  ageS: number | null
  /** Whether it, or its parent, is a process a Desktop record names for this installation (the
   *  child, a survivor, or a member of the recorded Windows tree): "ours but not provable" as
   *  opposed to "not ours". By pid only; telemetry, never grounds for a stop. */
  inDesktopTree: boolean | null
}

export { runsMainPy }

/** Whether `pid` or its parent is named by a record of `installationId`. */
async function inDesktopTree(pid: number, installationId: string): Promise<boolean> {
  const ours = new Set<number>()
  for (const r of listRecords()) {
    if (r.installationId !== installationId) continue
    ours.add(r.childPid)
    for (const m of [...(r.tree ?? []), ...(r.lingering ?? [])]) ours.add(m.pid)
  }
  if (ours.size === 0) return false
  if (ours.has(pid)) return true
  const parent = await parentPidOf(pid)
  return parent !== null && ours.has(parent)
}

/**
 * Best-effort name for whoever holds the database lock after a `comfyui_db_locked` boot
 * failure. Diagnostics only: nothing is ever stopped on the strength of this answer.
 *
 * Desktop's own records come first (another live session of the same install). Then the OS
 * probe on the lock file: Restart Manager on Windows, `lsof` elsewhere. Slow (up to seconds),
 * so it only runs after a lock failure.
 */
export async function identifyDbLockHolder(input: {
  sessionKey: string
  installationId: string
  installPath: string
  cwd: string
  args: readonly string[]
  /** The lock probe's cap (the probe's own default when unset). */
  probeTimeoutMs?: number
}): Promise<DbLockHolder | null> {
  const recorded = listRecords().find(
    (r) =>
      r.sessionKey !== input.sessionKey &&
      r.installationId === input.installationId &&
      isPidAlive(r.childPid)
  )
  if (recorded) {
    return {
      pid: recorded.childPid,
      source: 'desktop_record',
      sameInstall: true,
      name: null,
      runsMainPy: true,
      ageS: Math.max(0, Math.round((Date.now() - recorded.spawnedAt) / 1000)),
      inDesktopTree: true
    }
  }

  for (const db of databaseCandidates(input.cwd, input.args)) {
    const lockFile = `${db}.lock`
    if (!fs.existsSync(lockFile)) continue
    const probe = await findLockingProcesses(lockFile, input.probeTimeoutMs)
    if (!probe.ok) continue
    const holder = probe.processes.find((p) => p.pid !== process.pid)
    if (!holder) continue
    const [ownLine] = await commandLinesOf(holder.pid).catch(() => [] as string[])
    const started = (await readStartTimes([holder.pid]).catch(() => null))?.get(holder.pid)
    const startedMs = started ? startTokenToEpochMs(started) : null
    return {
      pid: holder.pid,
      source: process.platform === 'win32' ? 'restart_manager' : 'lsof',
      sameInstall: await holderIsInstall(holder.pid, input.installPath).catch(() => false),
      name: path.basename(holder.name.replace(/\\/g, '/')) || null,
      runsMainPy: ownLine === undefined ? null : runsMainPy(ownLine),
      ageS: startedMs === null ? null : Math.max(0, Math.round((Date.now() - startedMs) / 1000)),
      inDesktopTree: await inDesktopTree(holder.pid, input.installationId).catch(() => null)
    }
  }
  return null
}
