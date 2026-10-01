import fs from 'fs'
import http from 'http'
import path from 'path'
import type { ChildProcess } from 'child_process'
import { stateDir } from './paths'
import { findPidsByPort, isPortListening, killPidTree } from './process'
import {
  commandArgvOf,
  commandLinesOf,
  groupMembers,
  isPidAlive,
  ownStartTime,
  processCwdOf,
  processGroupOf,
  readStartTimes,
  descendantsOf,
  runsMainPy,
  windowsProcessRows,
  windowsProcessTable,
  type WinProcessRow,
  type WinProcessRowWithCommand
} from './processIdentity'

/**
 * Which ComfyUI processes Desktop spawned, persisted so a later Desktop can tell its own orphan
 * from anything else.
 *
 * One file per session key (`<stateDir>/comfy-procs/<key>.json`), written at spawn and rewritten
 * on every respawn. A record names the spawning Desktop and the child, each by pid AND start
 * time, which is what makes the orphan proof immune to pid reuse:
 *
 *   the child is ours      <=> the recorded child pid is alive with the recorded start time
 *   the owner is gone      <=> the recorded Desktop pid is not alive with its recorded start time
 *   proven orphan          <=> both
 *
 * Nothing here is a heuristic. A record that is missing, corrupt, or lacks a start time proves
 * nothing, and "proves nothing" always means "leave it alone" — today's behaviour.
 */
export interface ComfyProcessRecord {
  v: 1
  sessionKey: string
  installationId: string
  installPath: string
  port: number
  bootId: string
  spawnedAt: number
  desktopPid: number
  desktopStartTime: string | null
  childPid: number
  childStartTime: string | null
  /** Set when Desktop asked the child to stop. Quit does not wait for the kill, so a record can
   *  outlive a clean quit; this is what tells the next launch the process was already dying. */
  stopRequestedAt?: number
  /** Already counted by `takePriorSessionUnclean`. */
  uncleanReported?: boolean
  /** POSIX: descendants still in the child's process group when the child itself exited (a
   *  subprocess can inherit ComfyUI's database lock and keep it). Read at the exit, while the
   *  group id could not yet have been reused, so each entry is proven ours by the same
   *  pid + start-time rule as the child. */
  lingering?: LingeringProcess[]
  /** Windows: the child's descendants seen once it was running (the venv launcher's real
   *  interpreter, typically), by pid and creation time. Needed at exit: a ComfyUI that restarted
   *  itself with `os.execv` is a child of the interpreter, which is already gone by then. */
  tree?: LingeringProcess[]
  /** Windows: the exit scan could not read the process table; the next launch runs it. */
  pendingScan?: { known: LingeringProcess[]; exitedAt: string }
  /** The child itself has exited; the record is kept only for `lingering`. */
  childExitedAt?: number
}

export interface LingeringProcess {
  pid: number
  startTime: string
}

function recordsDir(): string {
  return path.join(stateDir(), 'comfy-procs')
}

function recordPath(sessionKey: string): string {
  // Session keys can carry `:` (performance-test sessions), which Windows filenames reject.
  return path.join(recordsDir(), `${encodeURIComponent(sessionKey)}.json`)
}

function isRecord(value: unknown): value is ComfyProcessRecord {
  const r = value as Partial<ComfyProcessRecord> | null
  return (
    !!r &&
    r.v === 1 &&
    typeof r.sessionKey === 'string' &&
    typeof r.installationId === 'string' &&
    typeof r.installPath === 'string' &&
    Number.isInteger(r.childPid) &&
    r.childPid! > 1 &&
    Number.isInteger(r.desktopPid) &&
    r.desktopPid! > 0 &&
    Number.isInteger(r.port) &&
    r.port! > 0 &&
    r.port! <= 65535 &&
    typeof r.spawnedAt === 'number' &&
    (r.desktopStartTime === null || typeof r.desktopStartTime === 'string') &&
    (r.childStartTime === null || typeof r.childStartTime === 'string') &&
    (r.pendingScan === undefined ||
      (typeof r.pendingScan === 'object' &&
        r.pendingScan !== null &&
        Array.isArray(r.pendingScan.known) &&
        r.pendingScan.known.every(
          (m) => Number.isInteger(m?.pid) && m.pid > 1 && typeof m?.startTime === 'string'
        ) &&
        typeof r.pendingScan.exitedAt === 'string')) &&
    (r.tree === undefined ||
      (Array.isArray(r.tree) &&
        r.tree.every(
          (m) => Number.isInteger(m?.pid) && m.pid > 1 && typeof m?.startTime === 'string'
        ))) &&
    (r.lingering === undefined ||
      (Array.isArray(r.lingering) &&
        r.lingering.every(
          (m) => Number.isInteger(m?.pid) && m.pid > 1 && typeof m?.startTime === 'string'
        )))
  )
}

export function readRecord(sessionKey: string): ComfyProcessRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(recordPath(sessionKey), 'utf-8')) as unknown
    return isRecord(parsed) && parsed.sessionKey === sessionKey ? parsed : null
  } catch {
    return null
  }
}

export function listRecords(): ComfyProcessRecord[] {
  let names: string[]
  try {
    names = fs.readdirSync(recordsDir())
  } catch {
    return []
  }
  const out: ComfyProcessRecord[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    let key: string
    try {
      key = decodeURIComponent(name.slice(0, -'.json'.length))
    } catch {
      continue // not a name this module wrote
    }
    const record = readRecord(key)
    if (record) out.push(record)
  }
  return out
}

/** Bookkeeping must never cost a launch: every write failure is swallowed, and a missing record
 *  falls back to today's behaviour. */
export function writeRecord(record: ComfyProcessRecord): boolean {
  try {
    fs.mkdirSync(recordsDir(), { recursive: true })
    const target = recordPath(record.sessionKey)
    const tmp = `${target}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(record))
    fs.renameSync(tmp, target)
    return true
  } catch (err) {
    console.warn('[comfy-procs] record write failed:', err)
    return false
  }
}

/** Delete the record only if it still describes `childPid`: a respawn may already have
 *  replaced it with the next child's. A record that cannot be read right now (a transient
 *  sharing violation, say) is unknown, not absent, and stays; one that reads but is corrupt
 *  proves nothing and goes. */
export function removeRecordIf(sessionKey: string, childPid: number): void {
  const file = recordPath(sessionKey)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch {
    return
  }
  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    // corrupt: fall through to delete
  }
  if (isRecord(parsed) && parsed.childPid !== childPid) return
  try {
    fs.unlinkSync(file)
  } catch {}
}

/** Stamp a stop request on a record THIS Desktop wrote. A record left by another Desktop is
 *  never stamped: its child was not asked to stop, and the next launch must not wait for it as
 *  if it were exiting. */
export function markStopRequested(sessionKey: string): void {
  const current = readRecord(sessionKey)
  if (!current || current.stopRequestedAt || current.desktopPid !== process.pid) return
  writeRecord({ ...current, stopRequestedAt: Date.now() })
}

/** Whether anything a record names (the child, or a descendant that outlived it) may still run. */
function anythingAlive(record: ComfyProcessRecord, alive: (pid: number) => boolean): boolean {
  return (
    alive(record.childPid) ||
    (record.lingering ?? []).some((m) => alive(m.pid)) ||
    // A scan still owed may find something alive: the record must outlive Desktop restarts.
    pendingScanIsCurrent(record)
  )
}

/** How long after an exit a ComfyUI that restarted itself may still be booting (and holding the
 *  database) without serving its port yet. */
const OWED_SCAN_BOOT_WINDOW_MS = 5 * 60 * 1000

/** Whether an owed scan's recorded exit is more than `ms` ago (unparseable counts as old). */
function pendingScanIsOlderThan(record: ComfyProcessRecord, nowMs: number, ms: number): boolean {
  const exitedAt = record.pendingScan?.exitedAt
  if (!exitedAt || !/^\d+$/.test(exitedAt)) return true
  return BigInt(exitedAt) < filetimeOf(nowMs - ms)
}

/** How long a pending Windows exit scan is kept for the next launch. */
const PENDING_SCAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Whether the record owes a Windows exit scan that is not too old to run. */
export function pendingScanIsCurrent(
  record: ComfyProcessRecord,
  nowMs: number = Date.now()
): boolean {
  const exitedAt = record.pendingScan?.exitedAt
  if (!exitedAt || !/^\d+$/.test(exitedAt)) return false
  return BigInt(exitedAt) >= filetimeOf(nowMs - PENDING_SCAN_MAX_AGE_MS)
}

/** FILETIME ticks (100 ns) per millisecond, and the Unix epoch in FILETIME. */
const FILETIME_PER_MS = 10_000n
const FILETIME_UNIX_EPOCH = 116_444_736_000_000_000n

export function filetimeOf(epochMs: number): bigint {
  return BigInt(Math.round(epochMs)) * FILETIME_PER_MS + FILETIME_UNIX_EPOCH
}

/** A ComfyUI that replaces itself is created moments before the process it replaces exits, and
 *  so before the child's exit is seen: a new process only counts when it was created in the
 *  minute before that exit. */
const SEED_BEFORE_EXIT = 60_000n * FILETIME_PER_MS

export interface WindowsExitContext {
  /** The child and its recorded tree, each with its creation time. */
  known: LingeringProcess[]
  installPath: string
  /** When the child's exit was seen, as a FILETIME. */
  exitedAt: bigint
}

/**
 * Windows: survivors of an exited child, from one process-table snapshot. A survivor is either a
 * known process still running (same pid AND same creation time), or a new process that
 *   - names a known process as its parent (Windows keeps a dead parent's pid in
 *     ParentProcessId), and that pid is not now held by a different process (reuse),
 *   - was created no earlier than that parent, and within a minute before the child's exit,
 *   - and itself runs main.py from this installation (the restarted venv launcher),
 * plus the descendants of either. Only ComfyUI (a command line that runs main.py) is returned —
 * never a browser or server a custom node started — and never Desktop itself.
 */
export function findWindowsSurvivors(
  rows: readonly WinProcessRowWithCommand[],
  ctx: WindowsExitContext
): LingeringProcess[] {
  const knownCreated = new Map<number, bigint>()
  for (const k of ctx.known) {
    if (/^\d+$/.test(k.startTime)) knownCreated.set(k.pid, BigInt(k.startTime))
  }
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  const seeds = rows.filter((r) => {
    if (!/^\d+$/.test(r.created)) return false
    const created = BigInt(r.created)
    if (knownCreated.get(r.pid) === created) return true
    if (knownCreated.has(r.pid)) return false
    const parentCreated = knownCreated.get(r.ppid)
    if (parentCreated === undefined || created < parentCreated) return false
    // The pid it names as parent may be held by someone else by now (a later scan especially:
    // Windows reuses pids quickly). That holder can only be the real parent if it existed when
    // this process was created; one created after it cannot have started it. Accepted edge: a
    // process that took the pid, started a ComfyUI of THIS installation within the minute before
    // the exit, and has itself exited since, is indistinguishable here and counts as ours.
    const parentNow = byPid.get(r.ppid)
    if (
      parentNow &&
      (!/^\d+$/.test(parentNow.created) ||
        (BigInt(parentNow.created) !== parentCreated && BigInt(parentNow.created) <= created))
    ) {
      return false
    }
    if (created < ctx.exitedAt - SEED_BEFORE_EXIT || created > ctx.exitedAt) {
      return false
    }
    return commandLineIsInstall(r.commandLine, ctx.installPath)
  })
  const picked = new Set<number>()
  for (const seed of seeds) for (const pid of descendantsOf(rows, seed.pid)) picked.add(pid)
  const out: LingeringProcess[] = []
  for (const pid of picked) {
    const row = byPid.get(pid)
    if (!row?.created || pid === process.pid || !runsMainPy(row.commandLine)) continue
    // Only this installation's ComfyUI: its own command line, or the relative main.py a venv
    // launcher hands its interpreter. Ancestry alone is not enough (a custom node's helper can
    // run some other main.py), for a known tree member as much as for anything below it.
    if (
      !commandLineIsInstall(row.commandLine, ctx.installPath) &&
      !runsRelativeMainPy(row.commandLine)
    ) {
      continue
    }
    out.push({ pid, startTime: row.created })
  }
  return out
}

/** Whether the command line's main.py argument is a relative path (the interpreter a venv
 *  launcher starts is handed the launcher's own, relative, arguments). */
function runsRelativeMainPy(commandLine: string): boolean {
  const script = splitCommandLine(commandLine)
    .map((a) => a.replace(/\\/g, '/'))
    .find((a) => a === 'main.py' || a.endsWith('/main.py'))
  return !!script && !script.startsWith('/') && !/^[a-zA-Z]:\//.test(script)
}

/**
 * Windows: note the child's descendants while it runs (the venv launcher's real interpreter,
 * typically), so its exit can find what it left. Only recorded while the child itself is still
 * in the snapshot, with its recorded creation time when that is known. Returns whether a
 * non-empty tree was recorded.
 */
export async function recordWindowsTree(sessionKey: string, childPid: number): Promise<boolean> {
  const rows = await windowsProcessRows()
  const root = rows?.find((r) => r.pid === childPid)
  if (!rows || !root) return false
  const current = readRecord(sessionKey)
  if (!current || current.childPid !== childPid) return false
  // Only against a root proven to be the child: until its start time is known, whatever holds
  // the pid could be someone else.
  if (!current.childStartTime || current.childStartTime !== root.created) return false
  const tree = descendantsOf(rows, childPid)
    .filter((pid) => pid !== childPid)
    .flatMap((pid) => {
      const created = rows.find((r) => r.pid === pid)?.created
      return created ? [{ pid, startTime: created }] : []
    })
  if (tree.length === 0) return false
  return writeRecord({ ...current, tree: mergeLingering(current.tree, tree) })
}

function mergeLingering(
  a: readonly LingeringProcess[] | undefined,
  b: readonly LingeringProcess[]
): LingeringProcess[] {
  const out = [...(a ?? [])]
  for (const m of b) {
    if (!out.some((o) => o.pid === m.pid && o.startTime === m.startTime)) out.push(m)
  }
  return out
}

async function comfyOnly(pids: number[]): Promise<number[]> {
  const out: number[] = []
  for (const pid of pids) {
    const [own] = await commandLinesOf(pid).catch(() => [] as string[])
    if (own !== undefined && runsMainPy(own)) out.push(pid)
  }
  return out
}

/**
 * On the child's exit: drop the record, unless descendants outlived it in its process group, in
 * which case they are recorded (by pid and start time) for the next launch to stop.
 */
async function recordChildExit(
  sessionKey: string,
  childPid: number,
  windows: WindowsExitContext | null = null
): Promise<void> {
  // Only survivors that are themselves ComfyUI (their command line runs main.py: a forked worker
  // keeps it, and so does a ComfyUI restarted in place). That is the shape that keeps the
  // database lock. Anything else a custom node started — a browser, a local model server — is
  // descended from ComfyUI but is not ComfyUI, and the next launch must not stop it.
  const found = await survivorsOf(childPid, windows)
  const lingering = found ?? []
  // Unknown is not "none": leave the scan to the next launch.
  const pendingScan =
    found === null && windows
      ? { known: windows.known, exitedAt: String(windows.exitedAt) }
      : undefined
  const current = readRecord(sessionKey)
  if (!current) return
  if (current.childPid !== childPid) {
    // A respawn already replaced the record; keep the old child's survivors on it.
    if (lingering.length > 0 || pendingScan) {
      writeRecord({
        ...current,
        lingering: mergeLingering(current.lingering, lingering),
        ...(pendingScan && !current.pendingScan ? { pendingScan } : {})
      })
    }
    return
  }
  if (
    lingering.length === 0 &&
    !pendingScan &&
    !(current.lingering ?? []).some((m) => isPidAlive(m.pid))
  ) {
    removeRecordIf(sessionKey, childPid)
    return
  }
  writeRecord({
    ...current,
    childExitedAt: current.childExitedAt ?? Date.now(),
    lingering: mergeLingering(current.lingering, lingering),
    ...(pendingScan ? { pendingScan } : {})
  })
}

/** Exit bookkeeping still running, per session: a launch waits for it before it looks. */
const pendingExitBookkeeping = new Map<string, Promise<void>>()

/**
 * Run `work` after every exit bookkeeping already queued for `sessionKey`, one at a time: an
 * older child's scan must merge its survivors before a newer one decides the record's fate, and
 * a launch waits for all of them (`settleExitBookkeeping`).
 */
export function queueExitBookkeeping(sessionKey: string, work: () => Promise<void>): void {
  const before = pendingExitBookkeeping.get(sessionKey) ?? Promise.resolve()
  const done: Promise<void> = before
    .then(work)
    .catch((err: unknown) => console.warn('[comfy-procs] exit bookkeeping failed:', err))
    .finally(() => {
      if (pendingExitBookkeeping.get(sessionKey) === done) pendingExitBookkeeping.delete(sessionKey)
    })
  pendingExitBookkeeping.set(sessionKey, done)
}

/** Resolves once no exit bookkeeping for `sessionKey` is in flight (bounded by its own work). */
export async function settleExitBookkeeping(sessionKey: string): Promise<void> {
  await pendingExitBookkeeping.get(sessionKey)
}

/** What an exited child left behind: its process group's survivors on POSIX, or, on Windows,
 *  what a process-table snapshot finds from the child and its recorded tree. */
/** Survivors of an exited child, or null when they could not be determined (Windows: no
 *  process table), which is not the same as none. */
async function survivorsOf(
  childPid: number,
  windows: WindowsExitContext | null
): Promise<LingeringProcess[] | null> {
  if (process.platform === 'win32') {
    if (!windows || windows.known.length === 0) return []
    for (let attempt = 0; attempt < WINDOWS_SNAPSHOT_ATTEMPTS; attempt++) {
      const rows = await windowsProcessTable()
      if (rows) return findWindowsSurvivors(rows, windows)
      await new Promise((r) => setTimeout(r, 1_000).unref())
    }
    console.warn('[comfy-procs] process table unavailable at exit; the next launch will look')
    return null
  }
  const members = await comfyOnly(await groupMembers(childPid))
  const times = members.length > 0 ? await readStartTimes(members) : null
  return members.flatMap((pid) => {
    const startTime = times?.get(pid)
    return startTime ? [{ pid, startTime }] : []
  })
}

const WINDOWS_SNAPSHOT_ATTEMPTS = 3

/** The deferred exit scan for a record whose exit scan could not read the process table. */
async function rescanWindows(record: ComfyProcessRecord): Promise<LingeringProcess[] | null> {
  if (process.platform !== 'win32' || !record.pendingScan) return null
  if (!/^\d+$/.test(record.pendingScan.exitedAt)) return null
  const rows = await windowsProcessTable()
  if (!rows) return null
  return findWindowsSurvivors(rows, {
    known: record.pendingScan.known,
    installPath: record.installPath,
    exitedAt: BigInt(record.pendingScan.exitedAt)
  })
}

/** Windows: everything the exit scan needs, read at the exit itself — a respawn may replace the
 *  record before the (deferred) scan runs. */
function windowsExitContext(
  sessionKey: string,
  childPid: number,
  exitedAt: bigint
): WindowsExitContext | null {
  const record = readRecord(sessionKey)
  if (!record || record.childPid !== childPid) return null
  return {
    known: [
      ...(record.childStartTime ? [{ pid: childPid, startTime: record.childStartTime }] : []),
      ...(record.tree ?? [])
    ],
    installPath: record.installPath,
    exitedAt
  }
}

/** How long after the child's exit its output pipes may stay open before that is read as
 *  "something the child started still holds them". Shorter than the launch's own 1 s close
 *  grace, so the scan has started before the session is reported gone (and a relaunch then
 *  waits for it through `settleExitBookkeeping`). */
const PIPES_HELD_AFTER_EXIT_MS = 750

/** When to look at the child's process tree after spawn, besides its first output. */
const TREE_SNAPSHOT_DELAYS_MS = [3_000, 10_000, 30_000]

/**
 * Windows bookkeeping for one child.
 *
 * Its tree is noted on its first output on either stream, and at a few moments after spawn,
 * until one snapshot has it: ComfyUI logs to stderr, and its stdout can stay silent (and is
 * block-buffered) for the whole run.
 *
 * At exit, the context is captured at once and the survivor scan runs when the pipes close, or
 * PIPES_HELD_AFTER_EXIT_MS later if they stay open — a ComfyUI that restarted itself holds them,
 * and must exist before the scan can find it. That only times the scan; nothing is ever stopped
 * on this signal.
 */
function watchWindowsChild(proc: ChildProcess, sessionKey: string, childPid: number): void {
  let treeNoted = false
  let exited = false
  let treeInFlight: Promise<void> | null = null
  const noteTree = (): void => {
    if (treeNoted || exited || treeInFlight) return
    treeInFlight = recordWindowsTree(sessionKey, childPid)
      .then((ok) => {
        if (ok) treeNoted = true
      })
      .catch((err: unknown) => console.warn('[comfy-procs] tree snapshot failed:', err))
      .finally(() => {
        treeInFlight = null
      })
  }
  proc.stdout?.once('data', noteTree)
  proc.stderr?.once('data', noteTree)
  const timers = TREE_SNAPSHOT_DELAYS_MS.map((ms) => {
    const t = setTimeout(noteTree, ms)
    t.unref()
    return t
  })

  proc.once('exit', () => {
    exited = true
    for (const t of timers) clearTimeout(t)
    const exitedAt = filetimeOf(Date.now())
    // Captured now: a respawn may replace the record before the scan runs.
    const captured = windowsExitContext(sessionKey, childPid, exitedAt)
    // The scan waits for its trigger (close, or the timer below), then takes its turn behind
    // any earlier child's bookkeeping for this session.
    let trigger: () => void = () => {}
    const triggered = new Promise<void>((resolve) => {
      trigger = resolve
    })
    queueExitBookkeeping(sessionKey, async () => {
      await triggered
      // A tree snapshot still in flight may add the interpreter the scan needs.
      if (treeInFlight) await treeInFlight
      const context = windowsExitContext(sessionKey, childPid, exitedAt) ?? captured
      await recordChildExit(sessionKey, childPid, context)
    })
    let scanned = false
    const scanOnce = (): void => {
      if (scanned) return
      scanned = true
      trigger()
    }
    // `close` always follows `exit` (Node emits it once the process has exited and its stdio
    // is closed).
    proc.once('close', scanOnce)
    setTimeout(scanOnce, PIPES_HELD_AFTER_EXIT_MS).unref()
  })
}

/**
 * Record a freshly spawned child. The pid is written synchronously; start times follow when the
 * OS has answered (a PowerShell round trip on Windows, off the boot path). The record is removed
 * when the child exits, unless part of its process group outlived it.
 */
export function trackSpawn(
  proc: ChildProcess,
  info: Pick<
    ComfyProcessRecord,
    'sessionKey' | 'installationId' | 'installPath' | 'port' | 'bootId'
  >
): void {
  const childPid = proc.pid
  if (!childPid) return
  // Survivors of the previous child of this session carry over; they are re-proven before use.
  const carried = readRecord(info.sessionKey)?.lingering
  writeRecord({
    v: 1,
    ...info,
    spawnedAt: Date.now(),
    desktopPid: process.pid,
    desktopStartTime: null,
    childPid,
    childStartTime: null,
    ...(carried && carried.length > 0 ? { lingering: carried } : {})
  })
  if (process.platform !== 'win32') {
    proc.once('exit', () =>
      queueExitBookkeeping(info.sessionKey, () => recordChildExit(info.sessionKey, childPid))
    )
  } else {
    watchWindowsChild(proc, info.sessionKey, childPid)
  }
  void Promise.all([ownStartTime(), readStartTimes([childPid])])
    .then(([desktopStartTime, childTimes]) => {
      const current = readRecord(info.sessionKey)
      if (!current || current.childPid !== childPid) return
      const childStartTime = childTimes?.get(childPid) ?? null
      writeRecord({ ...current, desktopStartTime, childStartTime })
    })
    .catch((err: unknown) => console.warn('[comfy-procs] start-time probe failed:', err))
}

// --- Proof ---

export type RecordVerdict =
  /** The recorded child is gone (or its pid now belongs to another process). */
  | 'stale'
  /** Something is alive at the recorded pid, but the record cannot prove it is the child. */
  | 'unproven'
  /** The child is ours and the Desktop that spawned it is still running. */
  | 'owner_alive'
  /** The child is ours and the Desktop that spawned it is gone. */
  | 'orphan'

export interface RecordProbe {
  /** Current start tokens by pid; null when the OS query itself failed. */
  startTimes: ReadonlyMap<number, string> | null
  selfPid: number
  selfStartTime: string | null
}

export function classifyRecord(record: ComfyProcessRecord, probe: RecordProbe): RecordVerdict {
  const { startTimes } = probe
  if (!startTimes) return 'unproven'
  const childNow = startTimes.get(record.childPid)
  if (childNow === undefined) return 'stale'
  if (record.childStartTime === null) return 'unproven'
  if (childNow !== record.childStartTime) return 'stale'
  if (record.desktopPid === probe.selfPid) {
    // Our pid, but a different start time means a previous Desktop whose pid we inherited.
    if (record.desktopStartTime === null || record.desktopStartTime === probe.selfStartTime) {
      return 'owner_alive'
    }
    return 'orphan'
  }
  const ownerNow = startTimes.get(record.desktopPid)
  if (ownerNow === undefined) return 'orphan'
  // Something runs at the owner's pid. Without the owner's token we cannot say it is someone
  // else, so the owner is presumed alive.
  if (record.desktopStartTime === null || ownerNow === record.desktopStartTime) {
    return 'owner_alive'
  }
  return 'orphan'
}

// --- Launch-time handling of a prior process (design option C) ---

export interface QueueState {
  running: number
  pending: number
}

export type QueueAnswer = QueueState | null | 'not_queue'

/** One short `GET /queue` on loopback. Null when nothing answered in time (not listening,
 *  wedged, or too slow); `not_queue` when something answered at once, but not with a queue (an
 *  error status, or a body that is not one), which waiting longer will not change. */
export function probeQueue(port: number, timeoutMs = 1_000): Promise<QueueAnswer> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: QueueAnswer): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const req = http.get({ host: '127.0.0.1', port, path: '/queue', timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        return finish('not_queue')
      }
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk: string) => {
        body += chunk
        if (body.length > 4 * 1024 * 1024) req.destroy()
      })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { queue_running?: unknown; queue_pending?: unknown }
          if (!Array.isArray(parsed.queue_running) || !Array.isArray(parsed.queue_pending)) {
            return finish('not_queue')
          }
          finish({ running: parsed.queue_running.length, pending: parsed.queue_pending.length })
        } catch {
          finish('not_queue')
        }
      })
      res.on('error', () => finish(null))
    })
    // Hard cap on the whole exchange, not just socket idle time.
    const timer = setTimeout(() => {
      req.destroy()
      finish(null)
    }, timeoutMs)
    timer.unref()
    req.on('error', () => finish(null))
    req.on('timeout', () => {
      req.destroy()
      finish(null)
    })
  })
}

export type PriorProcessAction = 'terminated' | 'waited' | 'left' | 'busy_left'

export interface PriorProcessOutcome {
  action: PriorProcessAction
  proof: 'desktop_record' | 'none'
  pid: number
  port: number
  /** Since the recorded spawn; null when there was no record to date it. */
  ageMs: number | null
  waitMs: number
  /** The prior process was gone by the end of what we did. */
  exitedInTime: boolean
  /** Launching now would start a second ComfyUI on the same database. */
  /** `unverified`: a proven orphan could not be re-verified at the moment of the kill (the OS
   *  query failed), so it was neither stopped nor forgotten. */
  blocked: null | 'busy' | 'stuck' | 'unverified'
  queue?: QueueState
  /** The orphan never answered `/queue`, so whether it is working is unknown. */
  queueUnknown?: boolean
  /** Left running: survivors of an exited ComfyUI that do not answer on the recorded port, so
   *  they cannot be asked.
   *  Their pids, for the user and the log (the recorded child is already gone). */
  survivorPids?: number[]
  /** The user chose to stop a busy process. */
  busyOverride?: boolean
  /** Descendants that had outlived the child in its process group, and were stopped. */
  lingering?: number
  /** Blocked because a Windows exit scan is still owed and the process list cannot be read,
   *  while something holds the recorded port. `pid` is then the long-gone child. */
  scanOwed?: boolean
  /** With `scanOwed`: the port is free, but the exit was too recent to rule out a copy that is
   *  still starting up. */
  scanRecent?: boolean
  /** Every pid the stops covered (process groups, trees), for the log. */
  stoppedPids?: number[]
}

/**
 * Stop the recorded survivors of an exited child that are still provably those processes. Owner
 * liveness does not matter here: no Desktop manages anything but the child itself.
 */
async function provenLingering(
  record: ComfyProcessRecord,
  deps: PriorProcessDeps
): Promise<LingeringProcess[] | 'unverified' | null> {
  const listed = (record.lingering ?? []).filter((m) => deps.isPidAlive(m.pid))
  if (listed.length === 0) return null
  const times = await deps.readStartTimes(listed.map((m) => m.pid))
  // Could not ask the OS: these may still be ours and still hold the lock. Keep the record.
  if (!times) return 'unverified'
  const proven = listed.filter((m) => times.get(m.pid) === m.startTime)
  return proven.length > 0 ? proven : null
}

async function stopLingering(
  proven: readonly LingeringProcess[],
  deps: PriorProcessDeps
): Promise<{
  stopped: number
  blocked: null | 'stuck' | 'unverified'
  members: number[]
} | null> {
  const kills = await Promise.all(proven.map((m) => deps.killPidTree(m.pid, m.startTime)))
  const stopped = kills.filter((k) => k.killed).length
  const members = [...new Set(kills.flatMap((k) => (k.killed ? (k.members ?? []) : [])))]
  // A pid that now names another process is simply not ours; every other outcome counts.
  const relevant = kills.filter((k) => k.killed || k.reason === 'probe_failed')
  if (relevant.length === 0) return null
  const blocked = relevant.some((k) => !k.killed)
    ? 'unverified'
    : relevant.some((k) => !k.exited)
      ? 'stuck'
      : null
  return { stopped, blocked, members }
}

/** Total time spent asking an orphan whether it is working before treating it as unknown. */
export const QUEUE_PROBE_BUDGET_MS = 10_000

/**
 * `/queue`, retried: a server busy generating, or stalled in an asset scan, can take seconds to
 * answer, and one short probe would read that as idle. Only silence is retried; an answer that
 * is not a queue ends the probe as unknown at once. Per-attempt timeouts and the pauses
 * between them both grow, all inside `QUEUE_PROBE_BUDGET_MS`. Null means it never answered.
 */
async function probeQueuePatiently(
  port: number,
  deps: Pick<PriorProcessDeps, 'probeQueue' | 'now' | 'sleep'>,
  signal?: AbortSignal
): Promise<QueueState | null> {
  const deadline = deps.now() + QUEUE_PROBE_BUDGET_MS
  let timeoutMs = 1_000
  let pauseMs = 250
  // A backstop on top of the deadline: the loop must end even under a clock that does not move.
  for (let attempt = 0; attempt < MAX_QUEUE_PROBES; attempt++) {
    const remaining = deadline - deps.now()
    if (remaining <= 0 || signal?.aborted) return null
    const attemptMs = Math.min(timeoutMs, remaining)
    const queue = await withinBudget(deps.probeQueue(port, attemptMs), attemptMs, signal)
    // Answered, but not with a queue: asking again gets the same answer. Unknown, at once.
    if (queue === 'not_queue') return null
    if (queue) return queue
    const left = deadline - deps.now()
    if (left <= 0 || signal?.aborted || attempt === MAX_QUEUE_PROBES - 1) return null
    await abortable(deps.sleep(Math.min(pauseMs, left)), signal)
    timeoutMs = Math.min(timeoutMs * 2, 4_000)
    pauseMs = Math.min(pauseMs * 2, 2_000)
  }
  return null
}

const MAX_QUEUE_PROBES = 8

/** The probe answers null once `ms` has passed, on a cancel, or if it throws — whatever the
 *  underlying probe does (the real one has its own hard timer; this keeps the budget from
 *  depending on that, and a late rejection from ever going unhandled). */
function withinBudget(
  probe: Promise<QueueAnswer>,
  ms: number,
  signal?: AbortSignal
): Promise<QueueAnswer> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
    timer.unref()
  })
  return abortable(
    Promise.race([probe.catch(() => null), expired]).finally(() => clearTimeout(timer)),
    signal
  ).then((v) => v ?? null)
}

/** Settles with `undefined` as soon as `signal` aborts, instead of waiting for `p`. */
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T | undefined> {
  if (!signal) return p
  if (signal.aborted) return Promise.resolve(undefined)
  return new Promise((resolve, reject) => {
    const onAbort = (): void => resolve(undefined)
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/** Log a line through the caller; reporting must never change what happens. */
function note(opts: { onNote?: (line: string) => void }, line: string): void {
  try {
    opts.onNote?.(line)
  } catch {}
}

/**
 * Whether one of the survivors is what listens on the recorded port: a survivor's own pid, or
 * (POSIX) a member of the recorded child's process group, which cannot be anyone else's while a
 * survivor keeps that group alive. Listeners that cannot be read count as "not them": the
 * survivors are then put to the user instead of trusting a stranger's answer.
 */
async function survivorServesPort(
  record: ComfyProcessRecord,
  survivors: readonly LingeringProcess[],
  deps: PriorProcessDeps
): Promise<boolean> {
  const listeners = await (deps.portListeners ?? findPidsByPort)(record.port).catch(
    () => [] as number[]
  )
  if (listeners.length === 0) return false
  // Every listener, not just one: the busy check asks 127.0.0.1, and a survivor bound to a LAN
  // address can share the port number with a stranger on loopback, which would answer for it.
  const ours = new Set(survivors.map((m) => m.pid))
  const groupOf = deps.processGroupOf ?? processGroupOf
  let rows: WinProcessRow[] | null | undefined
  for (const pid of listeners) {
    if (ours.has(pid)) continue
    if ((await groupOf(pid).catch(() => null)) === record.childPid) continue
    // Windows has no process groups: a listener started by a survivor after the exit scan (the
    // interpreter a restarted launcher starts) is found through its ancestry, creation-ordered.
    if (rows === undefined) {
      rows = await (deps.windowsProcessRows ?? windowsProcessRows)().catch(() => null)
      if (rows) for (const m of survivors) for (const d of descendantsOf(rows, m.pid)) ours.add(d)
      if (ours.has(pid)) continue
    }
    return false
  }
  return true
}

/** How long survivors that do not serve the recorded port get to exit on their own (a teardown in progress)
 *  before the user is asked about them; the poll count bounds it under any clock. */
const PORTLESS_SURVIVOR_GRACE_MS = 5_000
const PORTLESS_SURVIVOR_POLLS = 50

/** How long a process of ours that is already stopping gets to finish on its own. */
export const PRIOR_STOP_WAIT_MS = 10_000

export interface PriorProcessDeps {
  readRecord: typeof readRecord
  removeRecordIf: typeof removeRecordIf
  readStartTimes: typeof readStartTimes
  ownStartTime: typeof ownStartTime
  isPidAlive: typeof isPidAlive
  probeQueue: typeof probeQueue
  killPidTree: typeof killPidTree
  /** Monotonic clock for every wait and deadline. */
  /** Defaults to waiting on this process's in-flight exit bookkeeping. */
  settleExitBookkeeping?: (sessionKey: string) => Promise<void>
  /** Defaults to persisting the record (after a pending scan has run). */
  writeRecord?: (record: ComfyProcessRecord) => boolean
  /** Defaults to a fresh Windows process-table scan; null when it could not run. */
  rescanWindows?: (record: ComfyProcessRecord) => Promise<LingeringProcess[] | null>
  /** Whether anything listens on the port; defaults to the real probe. */
  portInUse?: (port: number) => Promise<boolean>
  /** The pids listening on the port (empty when none, or when they could not be read). */
  portListeners?: (port: number) => Promise<number[]>
  /** POSIX process group of a pid; null when unknown (always on Windows). */
  processGroupOf?: (pid: number) => Promise<number | null>
  /** Windows process table (pid, parent, creation time); null elsewhere or when unreadable. */
  windowsProcessRows?: () => Promise<WinProcessRow[] | null>
  now: () => number
  /** Wall clock, only to date the record (`spawnedAt` is wall-clock). */
  wallNow: () => number
  sleep: (ms: number) => Promise<void>
}

const defaultDeps: PriorProcessDeps = {
  readRecord,
  removeRecordIf,
  readStartTimes,
  ownStartTime,
  isPidAlive,
  probeQueue,
  killPidTree,
  now: () => performance.now(),
  wallNow: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms).unref())
}

/**
 * Before launching `sessionKey`, deal with a ComfyUI a previous run of it left behind.
 *
 * - No record, or the recorded child is gone: nothing to do (the stale record is dropped).
 * - Ours and already stopping: wait up to `PRIOR_STOP_WAIT_MS` for it to finish.
 * - Proven orphan: if it is still running a prompt, leave it and let the user decide (unless
 *   they already chose `stopBusy`); otherwise terminate it and wait until it has exited.
 * - Anything not proven ours, or whose Desktop is still running: never touched.
 *
 * Returns null when there was nothing to report.
 */
export async function resolvePriorProcess(
  sessionKey: string,
  opts: {
    stopBusy?: boolean
    /** A cancelled launch stops probing and never goes on to stop anything. */
    signal?: AbortSignal
    /** Called once before the (up to 10 s) busy check, so the caller can say what it is doing. */
    onProbe?: () => void
    /** A line for the launch log about a step that leaves no outcome of its own. */
    onNote?: (line: string) => void
  } = {},
  deps: PriorProcessDeps = defaultDeps
): Promise<PriorProcessOutcome | null> {
  // The previous child's exit bookkeeping may still be looking for what it left.
  await (deps.settleExitBookkeeping ?? settleExitBookkeeping)(sessionKey)
  let record = deps.readRecord(sessionKey)
  if (!record) return null
  const startedAt = deps.now()
  const ageMs = Math.max(0, deps.wallNow() - record.spawnedAt)
  // A cancelled launch never goes on to stop anything.
  if (opts.signal?.aborted) return null
  // Windows: an exit scan that could not run then runs now, under the same rules (creation
  // time within a minute of the recorded exit, parent not reused, this installation).
  if (record.pendingScan) {
    let found = pendingScanIsCurrent(record, deps.wallNow())
      ? await (deps.rescanWindows ?? rescanWindows)(record)
      : []
    if (!found) {
      // Still not runnable. What it looks for is a ComfyUI that restarted itself: once it has
      // booted it serves the recorded port, but booting (custom nodes, prestartup installs) can
      // take minutes, with the database already open. So the scan is given up, rather than
      // blocking every launch for days, only when the port is free AND the exit is old enough
      // for such a copy to have been serving by now.
      const serving = await (deps.portInUse ?? isPortListening)(record.port).catch(() => true)
      const recent = !pendingScanIsOlderThan(record, deps.wallNow(), OWED_SCAN_BOOT_WINDOW_MS)
      if (serving || recent) {
        // Keep the record and do not launch beside whatever it may find (a later launch tries
        // again, until the scan succeeds or expires).
        return {
          action: 'left',
          proof: 'desktop_record',
          pid: record.childPid,
          port: record.port,
          ageMs,
          waitMs: deps.now() - startedAt,
          exitedInTime: false,
          blocked: 'unverified',
          scanOwed: true,
          ...(serving ? {} : { scanRecent: true })
        }
      }
      found = []
    }
    // Done (or expired): the scan is owed no longer, and what it found is kept like any
    // survivor, so it is re-proven on every later launch until stopped.
    const { pendingScan: _done, ...rest } = record
    record = { ...rest, lingering: mergeLingering(record.lingering, found) }
    ;(deps.writeRecord ?? writeRecord)(record)
  }
  let proven = await provenLingering(record, deps)
  const early = (extra: Partial<PriorProcessOutcome>): PriorProcessOutcome => ({
    action: 'left',
    proof: 'desktop_record',
    pid: record.childPid,
    port: record.port,
    ageMs,
    waitMs: deps.now() - startedAt,
    exitedInTime: false,
    blocked: null,
    ...extra
  })
  if (proven === 'unverified') return early({ blocked: 'unverified' })
  // A survivor can be a whole ComfyUI (one that restarted itself) still serving the recorded
  // port: it gets the same busy check as the child before anything is stopped, and no answer
  // is not "idle" there either.
  if (proven && !opts.stopBusy) {
    // Whatever answers on the recorded port only speaks for the survivors if it IS one of them:
    // the port is every installation's default, and once the child is gone another ComfyUI may
    // hold it.
    let serving = await survivorServesPort(record, proven, deps)
    if (!serving) {
      // Nothing on the recorded port: whatever survived serves no HTTP and cannot be asked.
      // A process that is only tearing down (an interpreter still releasing the GPU, say) looks
      // the same, so survivors first get a short grace to exit on their own; only the ones still
      // there are put to the user, at once, rather than after the whole probe budget.
      let still = proven
      const graceStart = deps.now()
      note(
        opts,
        `processes left by an earlier ComfyUI (pids ${proven.map((m) => m.pid).join(', ')}) do ` +
          `not answer on port ${record.port}; giving them up to ` +
          `${PORTLESS_SURVIVOR_GRACE_MS / 1000} s to exit on their own`
      )
      const deadline = graceStart + PORTLESS_SURVIVOR_GRACE_MS
      for (
        let i = 0;
        i < PORTLESS_SURVIVOR_POLLS && still.length > 0 && deps.now() < deadline;
        i++
      ) {
        if (opts.signal?.aborted) return null
        await abortable(deps.sleep(100), opts.signal)
        still = still.filter((m) => deps.isPidAlive(m.pid))
      }
      if (opts.signal?.aborted) return null
      // One may have been booting and taken the port meanwhile: then it can be asked after all.
      if (still.length > 0) serving = await survivorServesPort(record, still, deps)
      const graceMs = Math.round(deps.now() - graceStart)
      note(
        opts,
        still.length === 0
          ? `they all exited on their own within ${graceMs} ms`
          : serving
            ? `after ${graceMs} ms one of them (pids ${still.map((m) => m.pid).join(', ')}) ` +
              `serves port ${record.port}: asking it whether it is working`
            : `after ${graceMs} ms still running: pids ${still.map((m) => m.pid).join(', ')}`
      )
      if (opts.signal?.aborted) return null
      if (still.length > 0 && !serving) {
        return early({
          action: 'busy_left',
          blocked: 'busy',
          queueUnknown: true,
          survivorPids: still.map((m) => m.pid)
        })
      }
      // All of them exited on their own: nothing left to stop.
      proven = still.length > 0 ? still : null
    }
    if (proven && serving) {
      try {
        opts.onProbe?.()
      } catch {
        // Reporting progress must never change what happens to the earlier ComfyUI.
      }
      const queue = await probeQueuePatiently(record.port, deps, opts.signal)
      if (opts.signal?.aborted) return null
      if (!queue) return early({ action: 'busy_left', blocked: 'busy', queueUnknown: true })
      if (queue.running > 0 || queue.pending > 0) {
        return early({ action: 'busy_left', blocked: 'busy', queue })
      }
    }
  }
  if (opts.signal?.aborted) return null
  const survivors = proven ? await stopLingering(proven, deps) : null
  // The user chose to stop them (the survivors' own busy prompt, or the child's).
  const overridden = survivors && opts.stopBusy ? { busyOverride: true } : {}
  const survivorPids = Array.isArray(proven) ? proven.map((m) => m.pid) : []
  // A cancel that landed while they were being stopped: say what was stopped, and go no further.
  if (opts.signal?.aborted && survivors) {
    return early({
      action: 'terminated',
      exitedInTime: !survivors.blocked,
      blocked: survivors.blocked,
      lingering: survivors.stopped,
      stoppedPids: survivors.members,
      ...overridden
    })
  }
  if (survivors?.blocked) {
    return {
      action: survivors.blocked === 'stuck' ? 'terminated' : 'left',
      proof: 'desktop_record',
      pid: record.childPid,
      port: record.port,
      ageMs,
      waitMs: deps.now() - startedAt,
      exitedInTime: false,
      blocked: survivors.blocked,
      lingering: survivors.stopped,
      stoppedPids: survivors.members,
      // What will not exit, or cannot be re-verified, are these, not the long-gone child.
      survivorPids,
      ...overridden
    }
  }
  // Cheap pre-check: after a clean quit the child is normally already gone, and on Windows the
  // start-time read below costs a PowerShell round trip.
  if (!deps.isPidAlive(record.childPid)) {
    deps.removeRecordIf(sessionKey, record.childPid)
    if (!survivors) return null
    return {
      action: 'terminated',
      proof: 'desktop_record',
      pid: record.childPid,
      port: record.port,
      ageMs,
      waitMs: deps.now() - startedAt,
      exitedInTime: true,
      blocked: null,
      lingering: survivors.stopped,
      stoppedPids: survivors.members,
      // The child is long gone: what was stopped were these.
      survivorPids,
      ...overridden
    }
  }
  const classify = async (): Promise<RecordVerdict> => {
    const verdict = classifyRecord(record, {
      startTimes: await deps.readStartTimes([record.childPid, record.desktopPid]),
      selfPid: process.pid,
      selfStartTime: await deps.ownStartTime()
    })
    // This Desktop spawned it, and a launch of the same session only runs when no session or
    // operation of it is active: nothing here manages that child any more (a stop or cancel
    // whose kill outlived its wait). It is ours, and it is in the way.
    return verdict === 'owner_alive' && record.desktopPid === process.pid ? 'orphan' : verdict
  }
  let verdict = await classify()
  if (verdict === 'stale') {
    deps.removeRecordIf(sessionKey, record.childPid)
    return null
  }
  const outcome = (
    action: PriorProcessAction,
    extra: Partial<PriorProcessOutcome> = {}
  ): PriorProcessOutcome => ({
    action,
    proof: verdict === 'unproven' ? 'none' : 'desktop_record',
    pid: record.childPid,
    port: record.port,
    ageMs,
    waitMs: deps.now() - startedAt,
    exitedInTime: false,
    blocked: null,
    ...(survivors ? { lingering: survivors.stopped, stoppedPids: survivors.members } : {}),
    ...overridden,
    ...extra
  })
  if (verdict === 'unproven') return outcome('left')

  // Already asked to stop (a quit whose kill was not awaited, or a relaunch racing the old
  // Desktop's teardown): give it the chance to finish before anything else.
  if (record.stopRequestedAt) {
    // From now, not from `startedAt`: the survivor stop and the start-time query above can
    // take seconds (PowerShell on Windows) and must not eat the child's grace period.
    const deadline = deps.now() + PRIOR_STOP_WAIT_MS
    while (deps.isPidAlive(record.childPid) && deps.now() < deadline) await deps.sleep(100)
    if (!deps.isPidAlive(record.childPid)) {
      deps.removeRecordIf(sessionKey, record.childPid)
      return outcome('waited', { exitedInTime: true })
    }
    // The owner may have finished dying meanwhile.
    verdict = await classify()
    if (verdict === 'stale') {
      deps.removeRecordIf(sessionKey, record.childPid)
      return outcome('waited', { exitedInTime: true })
    }
    // Proven ours and still alive a moment ago; an OS query that fails now changes neither.
    if (verdict === 'unproven') return outcome('left', { blocked: 'unverified' })
  }
  if (verdict !== 'orphan') return outcome('left')

  if (!opts.stopBusy) {
    try {
      opts.onProbe?.()
    } catch {
      // Reporting progress must never change what happens to the earlier ComfyUI.
    }
    const queue = await probeQueuePatiently(record.port, deps, opts.signal)
    if (opts.signal?.aborted) return outcome('left')
    // No answer is not "idle": a ComfyUI generating, or stalled in an asset scan, can miss every
    // probe. It is left running and the user decides, exactly as for a busy one.
    if (!queue) return outcome('busy_left', { blocked: 'busy', queueUnknown: true })
    if (queue.running > 0 || queue.pending > 0) {
      return outcome('busy_left', { blocked: 'busy', queue })
    }
  }
  // Checked here too: the user's "stop it" choice skips the probe, but not a cancel.
  if (opts.signal?.aborted) return outcome('left')
  const kill = await deps.killPidTree(record.childPid, record.childStartTime!)
  if (!kill.killed) {
    if (kill.reason === 'probe_failed') {
      // Proven a moment ago, unverifiable now: neither stop it nor forget it, and do not start a
      // second ComfyUI beside it.
      return outcome('left', { blocked: 'unverified' })
    }
    // The pid exited or was recycled since the proof, or the record asks for a pid that must
    // never be signalled (a forged or corrupt record): whatever runs there is not ours.
    deps.removeRecordIf(sessionKey, record.childPid)
    return outcome('waited', { exitedInTime: !deps.isPidAlive(record.childPid) })
  }
  if (kill.exited) deps.removeRecordIf(sessionKey, record.childPid)
  return outcome('terminated', {
    stoppedPids: [...new Set([...(survivors?.members ?? []), ...(kill.members ?? [])])],
    exitedInTime: kill.exited,
    blocked: kill.exited ? null : 'stuck',
    ...(opts.stopBusy ? { busyOverride: true } : {})
  })
}

// --- Identifying a port holder (design option D) ---

function normalizePathForMatch(p: string): string {
  const slashed = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' || process.platform === 'darwin'
    ? slashed.toLowerCase()
    : slashed
}

/** Split a command line into arguments, honouring double and single quotes. */
function splitCommandLine(commandLine: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(commandLine)) !== null) out.push(m[1] ?? m[2] ?? m[3]!)
  return out
}

/** The argv rule: the `main.py` argument lies inside the install, or it is relative and the
 *  interpreter (argv[0]) lies inside it (the install's own venv). */
function argvIsInstall(argv: readonly string[], root: string): boolean {
  const args = argv.map(normalizePathForMatch)
  const script = args.findIndex((a) => a === 'main.py' || a.endsWith('/main.py'))
  if (script <= 0) return false
  const mainPy = args[script]!
  if (mainPy.startsWith(root)) return true
  const relative = !mainPy.startsWith('/') && !/^[a-z]:\//i.test(mainPy)
  return relative && args[0]!.startsWith(root)
}

/**
 * The same rule on an unsplit command line, for sources that do not quote arguments (`ps` on
 * macOS), where an install path containing a space cannot be split reliably. `main.py` inside
 * the install: the text from the install root to the next `main.py` must not start a new
 * absolute-path or flag argument. Relative `main.py`: the line starts with the install root (the
 * interpreter) and names a `main.py` that is not an absolute path.
 */
function rawLineIsInstall(line: string, root: string): boolean {
  const text = normalizePathForMatch(line)
  for (let at = text.indexOf(root); at >= 0; at = text.indexOf(root, at + 1)) {
    const next = text.indexOf('main.py', at)
    if (next < 0) break
    const between = text.slice(at, next)
    // A space may be part of the path, but not one that starts a new absolute path (/ or a
    // drive letter) or a flag.
    if (!/\s(?:[/-]|[a-z]:)/i.test(between) && /(^|\/)$/.test(between)) return true
  }
  const unquoted = text.replace(/^["']/, '')
  // Relative: not rooted at / and not at a drive letter (C:\\x\\main.py is absolute).
  return unquoted.startsWith(root) && /\s(?![/"']|[a-z]:)[^\s]*main\.py(\s|$)/i.test(text)
}

/**
 * Whether a command line runs ComfyUI's `main.py` from inside `installPath`: either the `main.py`
 * argument itself lies inside the install, or it is relative and the interpreter lies inside it
 * (the install's own venv). Paths merely mentioned elsewhere in the arguments (an input
 * directory, a lock file) do not count. Pass the exact argv when it is available; a string is
 * split on quotes (Windows quotes paths with spaces) and, failing that, matched unsplit.
 */
export function commandLineIsInstall(
  commandLine: string | readonly string[],
  installPath: string,
  /** The process's working directory: a relative interpreter or `main.py` resolves against it
   *  (`./ComfyUI/.venv/bin/python3 -s ComfyUI/main.py`, run from the install). */
  cwd?: string | null
): boolean {
  const root = `${normalizePathForMatch(installPath)}/`
  const argv = typeof commandLine === 'string' ? splitCommandLine(commandLine) : commandLine
  if (argvIsInstall(argv, root)) return true
  if (cwd && argvIsInstall(resolveRelative(argv, cwd), root)) return true
  return typeof commandLine === 'string' && rawLineIsInstall(commandLine, root)
}

/** The interpreter (when given as a path) and the `main.py` argument, made absolute against
 *  `cwd`. A bare interpreter name is looked up on PATH, not in `cwd`, so it is left alone. */
function resolveRelative(argv: readonly string[], cwd: string): string[] {
  const absolute = (a: string): boolean => a.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(a)
  return argv.map((a, i) => {
    const pathLike = i === 0 ? /[\\/]/.test(a) : a === 'main.py' || /[\\/]main\.py$/.test(a)
    return pathLike && !absolute(a) ? path.resolve(cwd, a) : a
  })
}

/**
 * Whether the process listening at `pid` is a ComfyUI of this install. Matches the command line
 * (or, on Windows, the venv launcher's command line) against the install path. This is
 * identification for choosing NOT to start a second instance; it is never grounds for a kill.
 */
export async function holderIsInstall(pid: number, installPath: string): Promise<boolean> {
  // Linux gives the exact argv; elsewhere only a rendered command line exists.
  const argv = await commandArgvOf(pid)
  if (argv && commandLineIsInstall(argv, installPath)) return true
  const lines = argv ? [] : await commandLinesOf(pid)
  if (lines.some((line) => commandLineIsInstall(line, installPath))) return true
  // Started with a relative interpreter or script: resolve it where the process runs.
  const cwd = await processCwdOf(pid).catch(() => null)
  if (cwd) {
    if (argv && commandLineIsInstall(argv, installPath, cwd)) return true
    if (lines.some((line) => commandLineIsInstall(line, installPath, cwd))) return true
  }
  // Our own bookkeeping gives the same answer: the recorded child, a recorded survivor, or (POSIX)
  // any member of the recorded child's process group — a helper subprocess whose command line
  // names nothing of the install. Each by start time too: a record can outlive its processes,
  // and a pid (or a group id, once its group is gone) is reused.
  const mine = listRecords().filter(
    (r) => normalizePathForMatch(r.installPath) === normalizePathForMatch(installPath)
  )
  if (mine.length === 0) return false
  const pgid = await processGroupOf(pid)
  const claims = mine.flatMap((r) => [
    ...(r.childStartTime && (r.childPid === pid || r.childPid === pgid)
      ? [{ pid: r.childPid, startTime: r.childStartTime }]
      : []),
    ...(r.lingering ?? []).filter((m) => m.pid === pid)
  ])
  if (claims.length === 0) return false
  const now = await readStartTimes([...new Set(claims.map((c) => c.pid))])
  return !!now && claims.some((c) => now.get(c.pid) === c.startTime)
}

// --- Startup ---

/**
 * Whether a previous Desktop run ended without stopping a ComfyUI it had started: a record left
 * by another, no-longer-running Desktop that never asked its child to stop. Each such record is
 * counted once (it is stamped), and records whose child is also gone are dropped, so a later
 * clean start does not report the same crash again. Cheap (file reads and `kill 0`), so it runs
 * before telemetry init.
 */
export function takePriorSessionUnclean(): boolean {
  let unclean = false
  for (const r of listRecords()) {
    if (r.desktopPid === process.pid || isPidAlive(r.desktopPid)) continue
    // A child that exited on its own (record kept only for survivors) was not left by a crash.
    if (!r.stopRequestedAt && !r.uncleanReported && !r.childExitedAt) {
      unclean = true
      if (anythingAlive(r, isPidAlive)) writeRecord({ ...r, uncleanReported: true })
    }
    if (!anythingAlive(r, isPidAlive)) removeRecordIf(r.sessionKey, r.childPid)
  }
  return unclean
}
