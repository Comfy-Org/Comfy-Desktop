import fs from 'fs'
import path from 'path'
import { findLockingProcesses } from './file-lock-info'
import { commandLineIsInstall, holderIsInstall, listRecords } from './comfyProcessRecord'
import { isSafeToSignal, killPid } from './process'
import type { DbLockOffer } from '../../types/ipc'
import {
  commandLinesOf,
  holderStartToken,
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
}

export { runsMainPy }

/** What a ComfyUI writes beside the database lock it holds: `<db>.lock.json`. */
interface HolderRecord {
  pid: number
  /** Its start token, in the form `holderStartToken` reads. */
  started: string
  /** The `main.py` it runs. */
  main: string
}

/**
 * The ComfyUI a database's lock record names, if it is still that process: same pid, same start
 * time. A record left by one that crashed (or whose pid is reused) is ignored.
 */
export async function readHolderRecord(dbPath: string): Promise<HolderRecord | null> {
  let record: Partial<HolderRecord> | null
  try {
    record = JSON.parse(fs.readFileSync(`${dbPath}.lock.json`, 'utf-8'))
  } catch {
    return null
  }
  if (typeof record !== 'object' || record === null) return null
  const { pid, started, main } = record
  if (!Number.isInteger(pid) || typeof started !== 'string' || typeof main !== 'string') return null
  return (await holderStartToken(pid!).catch(() => null)) === started
    ? (record as HolderRecord)
    : null
}

/**
 * The ComfyUI holding one of `dbPaths`, from its own record, to offer the user a stop for. The
 * paths are candidates, so a record counts only when it is the one live record among them: with
 * two, which database this launch locked is unknown. Never one this Desktop is running in another
 * session. Null without exactly one live record: nothing is offered.
 */
export async function findDbLockOffer(input: {
  installationId: string
  installPath: string
  dbPaths: readonly string[]
}): Promise<DbLockOffer | null> {
  const running = listRecords().some(
    (r) =>
      r.installationId === input.installationId &&
      r.desktopPid === process.pid &&
      isPidAlive(r.childPid)
  )
  if (running) return null
  const live = []
  for (const dbPath of input.dbPaths) {
    const record = await readHolderRecord(dbPath)
    if (record) live.push({ dbPath, record })
  }
  if (live.length !== 1) return null
  const [{ dbPath, record }] = live as [(typeof live)[0]]
  const sameInstall = commandLineIsInstall(['python', record.main], input.installPath)
  const shown = sameInstall ? 'ComfyUI' : record.main
  return { pid: record.pid, startTime: record.started, dbPath, process: shown, sameInstall }
}

/**
 * Stops the ComfyUI the user confirmed in `offer`, and only it: its record must still name it,
 * with the same start time, and `signal` must not have aborted. True when it exited.
 */
export async function stopDbLockOffer(offer: DbLockOffer, signal?: AbortSignal): Promise<boolean> {
  // Anything slow (the first safety probe runs `ps`) comes before the proof, not between it and
  // the signal.
  if (!(await isSafeToSignal(offer.pid))) return false
  const record = await readHolderRecord(offer.dbPath)
  if (record?.pid !== offer.pid || record.started !== offer.startTime || signal?.aborted) {
    return false
  }
  return killPid(offer.pid)
}

/** `value` as a `DbLockOffer` (it crossed IPC), or null. */
export function asDbLockOffer(value: unknown): DbLockOffer | null {
  const o = value as DbLockOffer | null
  return o &&
    Number.isInteger(o.pid) &&
    typeof o.startTime === 'string' &&
    typeof o.dbPath === 'string'
    ? o
    : null
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
