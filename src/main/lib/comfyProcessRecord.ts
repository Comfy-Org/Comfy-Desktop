import fs from 'fs'
import http from 'http'
import path from 'path'
import type { ChildProcess } from 'child_process'
import { stateDir } from './paths'
import { killPidTree } from './process'
import {
  commandArgvOf,
  commandLinesOf,
  groupMembers,
  isPidAlive,
  ownStartTime,
  processGroupOf,
  readStartTimes,
  descendantsOf,
  runsMainPy,
  windowsProcessTable,
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
export function writeRecord(record: ComfyProcessRecord): void {
  try {
    fs.mkdirSync(recordsDir(), { recursive: true })
    const target = recordPath(record.sessionKey)
    const tmp = `${target}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(record))
    fs.renameSync(tmp, target)
  } catch (err) {
    console.warn('[comfy-procs] record write failed:', err)
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
  return alive(record.childPid) || (record.lingering ?? []).some((m) => alive(m.pid))
}

/**
 * Windows: survivors of an exited child, from one process-table snapshot. `known` is the child
 * and its recorded tree, each with its creation time. A survivor is a live process that is
 * either a known one still running (same creation time) or created no earlier than a known
 * parent it names — Windows keeps a dead parent's pid in ParentProcessId, and the creation-time
 * order rules out an unrelated process whose parent pid was later reused. Descendants of a
 * survivor count too. Only ComfyUI (a command line that runs main.py) is returned: the shape
 * that keeps the database lock, never a browser or server a custom node started.
 */
export function findWindowsSurvivors(
  rows: readonly WinProcessRowWithCommand[],
  known: readonly LingeringProcess[]
): LingeringProcess[] {
  const knownCreated = new Map<number, bigint>()
  for (const k of known) if (/^\d+$/.test(k.startTime)) knownCreated.set(k.pid, BigInt(k.startTime))
  const seeds = rows.filter((r) => {
    if (!r.created) return false
    const created = BigInt(r.created)
    if (knownCreated.get(r.pid) === created) return true
    const parentCreated = knownCreated.get(r.ppid)
    return parentCreated !== undefined && !knownCreated.has(r.pid) && created >= parentCreated
  })
  const picked = new Set<number>()
  for (const seed of seeds) for (const pid of descendantsOf(rows, seed.pid)) picked.add(pid)
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  const out: LingeringProcess[] = []
  for (const pid of picked) {
    const row = byPid.get(pid)
    if (!row?.created || pid === process.pid || !runsMainPy(row.commandLine)) continue
    out.push({ pid, startTime: row.created })
  }
  return out
}

/** Windows: note the child's descendants while it runs, so its exit can find what it left. */
async function recordWindowsTree(sessionKey: string, childPid: number): Promise<void> {
  const rows = await windowsProcessTable()
  if (!rows) return
  const tree = descendantsOf(rows, childPid)
    .filter((pid) => pid !== childPid)
    .flatMap((pid) => {
      const created = rows.find((r) => r.pid === pid)?.created
      return created ? [{ pid, startTime: created }] : []
    })
  const current = readRecord(sessionKey)
  if (!current || current.childPid !== childPid || tree.length === 0) return
  writeRecord({ ...current, tree })
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
async function recordChildExit(sessionKey: string, childPid: number): Promise<void> {
  // Only survivors that are themselves ComfyUI (their command line runs main.py: a forked worker
  // keeps it, and so does a ComfyUI restarted in place). That is the shape that keeps the
  // database lock. Anything else a custom node started — a browser, a local model server — is
  // descended from ComfyUI but is not ComfyUI, and the next launch must not stop it.
  const lingering = await survivorsOf(sessionKey, childPid)
  const current = readRecord(sessionKey)
  if (!current) return
  if (current.childPid !== childPid) {
    // A respawn already replaced the record; keep the old child's survivors on it.
    if (lingering.length > 0) {
      writeRecord({ ...current, lingering: mergeLingering(current.lingering, lingering) })
    }
    return
  }
  if (lingering.length === 0 && !(current.lingering ?? []).some((m) => isPidAlive(m.pid))) {
    removeRecordIf(sessionKey, childPid)
    return
  }
  writeRecord({
    ...current,
    childExitedAt: current.childExitedAt ?? Date.now(),
    lingering: mergeLingering(current.lingering, lingering)
  })
}

/** What an exited child left behind: its process group's survivors on POSIX, or, on Windows,
 *  what a process-table snapshot finds from the child and its recorded tree. */
async function survivorsOf(sessionKey: string, childPid: number): Promise<LingeringProcess[]> {
  if (process.platform === 'win32') {
    const record = readRecord(sessionKey)
    if (!record || record.childPid !== childPid) return []
    const known = [
      ...(record.childStartTime ? [{ pid: childPid, startTime: record.childStartTime }] : []),
      ...(record.tree ?? [])
    ]
    if (known.length === 0) return []
    const rows = await windowsProcessTable()
    return rows ? findWindowsSurvivors(rows, known) : []
  }
  const members = await comfyOnly(await groupMembers(childPid))
  const times = members.length > 0 ? await readStartTimes(members) : null
  return members.flatMap((pid) => {
    const startTime = times?.get(pid)
    return startTime ? [{ pid, startTime }] : []
  })
}

/** How long after the child's exit its output pipes may stay open before that is read as
 *  "something the child started still holds them". */
const PIPES_HELD_AFTER_EXIT_MS = 1_500

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
  // Windows: once ComfyUI prints anything its interpreter is up; note the tree then.
  if (process.platform === 'win32') {
    proc.stdout?.once('data', () => {
      recordWindowsTree(info.sessionKey, childPid).catch((err: unknown) =>
        console.warn('[comfy-procs] tree snapshot failed:', err)
      )
    })
  }
  const onExitBookkeeping = (): void => {
    recordChildExit(info.sessionKey, childPid).catch((err: unknown) =>
      console.warn('[comfy-procs] exit bookkeeping failed:', err)
    )
  }
  if (process.platform !== 'win32') {
    proc.once('exit', onExitBookkeeping)
  } else {
    // Windows scans once, when the child's pipes close or PIPES_HELD_AFTER_EXIT_MS after its exit,
    // whichever comes first. Pipes still open that long after the exit mean a process the child
    // started holds them (a ComfyUI that restarted itself), and it has to exist before the scan
    // can find it. This only times the scan; nothing is ever stopped on this signal.
    let scanned = false
    const scanOnce = (): void => {
      if (scanned) return
      scanned = true
      onExitBookkeeping()
    }
    proc.once('close', scanOnce)
    proc.once('exit', () => setTimeout(scanOnce, PIPES_HELD_AFTER_EXIT_MS).unref())
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

/** One short `GET /queue` on loopback. Null when it could not be answered: not listening, not
 *  ComfyUI, wedged, or too slow. */
export function probeQueue(port: number, timeoutMs = 1_000): Promise<QueueState | null> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: QueueState | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const req = http.get({ host: '127.0.0.1', port, path: '/queue', timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        return finish(null)
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
            return finish(null)
          }
          finish({ running: parsed.queue_running.length, pending: parsed.queue_pending.length })
        } catch {
          finish(null)
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
  /** The user chose to stop a busy process. */
  busyOverride?: boolean
  /** Descendants that had outlived the child in its process group, and were stopped. */
  lingering?: number
}

/**
 * Stop the recorded survivors of an exited child that are still provably those processes. Owner
 * liveness does not matter here: no Desktop manages anything but the child itself.
 */
async function stopLingering(
  record: ComfyProcessRecord,
  deps: PriorProcessDeps
): Promise<{ stopped: number; blocked: null | 'stuck' | 'unverified' } | null> {
  const listed = (record.lingering ?? []).filter((m) => deps.isPidAlive(m.pid))
  if (listed.length === 0) return null
  const times = await deps.readStartTimes(listed.map((m) => m.pid))
  // Could not ask the OS: these may still be ours and still hold the lock. Keep the record.
  if (!times) return { stopped: 0, blocked: 'unverified' }
  const proven = listed.filter((m) => times.get(m.pid) === m.startTime)
  const kills = await Promise.all(proven.map((m) => deps.killPidTree(m.pid, m.startTime)))
  const stopped = kills.filter((k) => k.killed).length
  // A pid that now names another process is simply not ours; every other outcome counts.
  const relevant = kills.filter((k) => k.killed || k.reason === 'probe_failed')
  if (relevant.length === 0) return null
  const blocked = relevant.some((k) => !k.killed)
    ? 'unverified'
    : relevant.some((k) => !k.exited)
      ? 'stuck'
      : null
  return { stopped, blocked }
}

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
  opts: { stopBusy?: boolean } = {},
  deps: PriorProcessDeps = defaultDeps
): Promise<PriorProcessOutcome | null> {
  const record = deps.readRecord(sessionKey)
  if (!record) return null
  const startedAt = deps.now()
  const ageMs = Math.max(0, deps.wallNow() - record.spawnedAt)
  const survivors = await stopLingering(record, deps)
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
      lingering: survivors.stopped
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
      lingering: survivors.stopped
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
    ...(survivors ? { lingering: survivors.stopped } : {}),
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
    const queue = await deps.probeQueue(record.port)
    if (queue && (queue.running > 0 || queue.pending > 0)) {
      return outcome('busy_left', { blocked: 'busy', queue })
    }
  }
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
  const relative = !mainPy.startsWith('/') && !/^[a-z]:\//.test(mainPy)
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
    if (!/\s[/-]/.test(between) && /(^|\/)$/.test(between)) return true
  }
  const unquoted = text.replace(/^["']/, '')
  return unquoted.startsWith(root) && /\s(?![/"'])[^\s]*main\.py(\s|$)/.test(text)
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
  installPath: string
): boolean {
  const root = `${normalizePathForMatch(installPath)}/`
  if (typeof commandLine !== 'string') return argvIsInstall(commandLine, root)
  return argvIsInstall(splitCommandLine(commandLine), root) || rawLineIsInstall(commandLine, root)
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
  // Our own bookkeeping gives the same answer: the recorded child, a recorded survivor, or (POSIX)
  // any member of the recorded child's process group — a helper subprocess whose command line
  // names nothing of the install.
  const mine = listRecords().filter(
    (r) => normalizePathForMatch(r.installPath) === normalizePathForMatch(installPath)
  )
  if (mine.some((r) => r.childPid === pid || (r.lingering ?? []).some((m) => m.pid === pid))) {
    return true
  }
  const pgid = mine.length > 0 ? await processGroupOf(pid) : null
  return pgid !== null && mine.some((r) => r.childPid === pgid)
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
