import fs from 'fs'
import path from 'path'
import { findLockingProcesses } from './file-lock-info'
import { holderIsInstall, listRecords } from './comfyProcessRecord'
import {
  commandLinesOf,
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

/** A flag's value as argparse reads it: the LAST occurrence wins (Desktop's adopted-install pins
 *  precede the user's own launch args, so a user override comes later). */
function argValue(args: readonly string[], flag: string): string | null {
  let value: string | null = null
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === flag) value = args[i + 1] ?? null
    else if (a.startsWith(`${flag}=`)) value = a.slice(flag.length + 1)
  }
  return value
}

/** Whether a flag is set, in either the `--flag value` or the `--flag=value` form. */
export function hasFlag(args: readonly string[], flag: string): boolean {
  return args.some((a) => a === flag || a.startsWith(`${flag}=`))
}

/**
 * Desktop's own location pins for an adopted install: its data stays in the legacy base folder.
 * The database pin is left out when the user set their own `--database-url`.
 */
export function adoptedPinArgs(baseDir: string, withDatabaseUrl: boolean): string[] {
  return [
    '--base-directory',
    baseDir,
    '--user-directory',
    path.join(baseDir, 'user'),
    ...(withDatabaseUrl
      ? ['--database-url', `sqlite:///${path.join(baseDir, 'user', 'comfyui.db')}`]
      : [])
  ]
}

const LOCATION_FLAGS = ['--database-url', '--user-directory', '--base-directory']

/** Whether a location flag is set at all (in any form `hasFlag` reads). */
export function hasLocationFlag(args: readonly string[]): boolean {
  return LOCATION_FLAGS.some((f) => hasFlag(args, f))
}

/**
 * Whether the args abbreviate a location flag (`--user-dir X`). ComfyUI's argparse accepts
 * unambiguous abbreviations, so such a launch's location cannot be read from the full names.
 */
export function abbreviatesLocationFlag(args: readonly string[]): boolean {
  return args.some((a) => {
    const name = a.split('=', 1)[0]!
    return name.length > 2 && LOCATION_FLAGS.some((f) => f !== name && f.startsWith(name))
  })
}

/**
 * Which default database location the launched core uses. ComfyUI v0.34.0 moved it from the
 * fixed `<ComfyUI>/user/comfyui.db` to `comfyui.db` in the effective user directory; `null`
 * when the core's side of that change is not known.
 */
export type DefaultDbLayout = 'user_dir' | 'comfy_dir' | null

function sqliteFile(cwd: string, url: string): string | null {
  const m = /^sqlite:\/\/\/(.+)$/.exec(url)
  return m && m[1] !== ':memory:' ? path.resolve(cwd, m[1]!) : null
}

export interface ComfyPaths {
  baseDir: string
  userDir: string
  /** The SQLite file ComfyUI opens; null for a non-file URL or an undeterminable default. */
  dbPath: string | null
}

/**
 * The base directory, user directory and database file a ComfyUI launch resolves to, following
 * ComfyUI's own rules (`folder_paths.py`, `app/database/db.py`). Null when the args carry no
 * `-s <main.py>` to anchor the ComfyUI folder on.
 */
export function resolveComfyPaths(
  cwd: string,
  args: readonly string[],
  layout: DefaultDbLayout
): ComfyPaths | null {
  const sIdx = args.indexOf('-s')
  const mainPy = sIdx >= 0 ? args[sIdx + 1] : undefined
  if (!mainPy) return null
  const comfyDir = path.dirname(path.resolve(cwd, mainPy))
  const base = argValue(args, '--base-directory')
  const baseDir = base ? path.resolve(cwd, base) : comfyDir
  const user = argValue(args, '--user-directory')
  const userDir = user ? path.resolve(cwd, user) : path.join(baseDir, 'user')
  const url = argValue(args, '--database-url')
  let dbPath: string | null
  if (url) {
    dbPath = sqliteFile(cwd, url)
  } else {
    const current = path.join(userDir, 'comfyui.db')
    const legacy = path.join(comfyDir, 'user', 'comfyui.db')
    dbPath =
      current === legacy || layout === 'user_dir' ? current : layout === 'comfy_dir' ? legacy : null
  }
  return { baseDir, userDir, dbPath }
}

/**
 * The SQLite files a launch may have tried to lock, most likely first. ComfyUI's default moved
 * over time (`<ComfyUI>/user/comfyui.db`, now "the effective user directory"), so both are
 * candidates; a non-file `--database-url` yields none.
 */
export function databaseCandidates(cwd: string, args: readonly string[]): string[] {
  const url = argValue(args, '--database-url')
  if (url) {
    const db = sqliteFile(cwd, url)
    return db ? [db] : []
  }
  const current = resolveComfyPaths(cwd, args, 'user_dir')
  if (!current) return []
  return [...new Set([current.dbPath!, resolveComfyPaths(cwd, args, 'comfy_dir')!.dbPath!])]
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
}

export { runsMainPy }

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
      ageS: Math.max(0, Math.round((Date.now() - recorded.spawnedAt) / 1000))
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
      ageS: startedMs === null ? null : Math.max(0, Math.round((Date.now() - startedMs) / 1000))
    }
  }
  return null
}
