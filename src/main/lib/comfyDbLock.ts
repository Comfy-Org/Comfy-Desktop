import fs from 'fs'
import path from 'path'
import { findLockingProcesses } from './file-lock-info'
import { holderIsInstall, listRecords } from './comfyProcessRecord'
import { isPidAlive } from './processIdentity'

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
}): Promise<DbLockHolder | null> {
  const recorded = listRecords().find(
    (r) =>
      r.sessionKey !== input.sessionKey &&
      r.installationId === input.installationId &&
      isPidAlive(r.childPid)
  )
  if (recorded) {
    return { pid: recorded.childPid, source: 'desktop_record', sameInstall: true, name: null }
  }

  for (const db of databaseCandidates(input.cwd, input.args)) {
    const lockFile = `${db}.lock`
    if (!fs.existsSync(lockFile)) continue
    const probe = await findLockingProcesses(lockFile)
    if (!probe.ok) continue
    const holder = probe.processes.find((p) => p.pid !== process.pid)
    if (!holder) continue
    return {
      pid: holder.pid,
      source: process.platform === 'win32' ? 'restart_manager' : 'lsof',
      sameInstall: await holderIsInstall(holder.pid, input.installPath).catch(() => false),
      name: path.basename(holder.name.replace(/\\/g, '/')) || null
    }
  }
  return null
}
