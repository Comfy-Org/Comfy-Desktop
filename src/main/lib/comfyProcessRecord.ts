import fs from 'fs'
import http from 'http'
import path from 'path'
import type { ChildProcess } from 'child_process'
import { stateDir } from './paths'
import { killPidTree } from './process'
import {
  commandLinesOf,
  groupMembers,
  isPidAlive,
  ownStartTime,
  processGroupOf,
  readStartTimes
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
    Number.isInteger(r.desktopPid) &&
    Number.isInteger(r.port) &&
    r.port! > 0 &&
    r.port! <= 65535 &&
    typeof r.spawnedAt === 'number' &&
    (r.desktopStartTime === null || typeof r.desktopStartTime === 'string') &&
    (r.childStartTime === null || typeof r.childStartTime === 'string') &&
    (r.lingering === undefined ||
      (Array.isArray(r.lingering) &&
        r.lingering.every((m) => Number.isInteger(m?.pid) && typeof m?.startTime === 'string')))
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
 * On the child's exit: drop the record, unless descendants outlived it in its process group, in
 * which case they are recorded (by pid and start time) for the next launch to stop.
 */
async function recordChildExit(sessionKey: string, childPid: number): Promise<void> {
  const members = await groupMembers(childPid)
  const times = members.length > 0 ? await readStartTimes(members) : null
  const lingering = members.flatMap((pid) => {
    const startTime = times?.get(pid)
    return startTime ? [{ pid, startTime }] : []
  })
  const current = readRecord(sessionKey)
  if (!current) return
  if (current.childPid !== childPid) {
    // A respawn already replaced the record; keep the old child's survivors on it.
    if (lingering.length > 0) {
      writeRecord({ ...current, lingering: [...(current.lingering ?? []), ...lingering] })
    }
    return
  }
  if (lingering.length === 0 && !(current.lingering ?? []).some((m) => isPidAlive(m.pid))) {
    removeRecordIf(sessionKey, childPid)
    return
  }
  writeRecord({
    ...current,
    childExitedAt: Date.now(),
    lingering: [...(current.lingering ?? []), ...lingering]
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
  proc.once('exit', () => {
    recordChildExit(info.sessionKey, childPid).catch((err: unknown) =>
      console.warn('[comfy-procs] exit bookkeeping failed:', err)
    )
  })
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
  now: () => number
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
  now: () => Date.now(),
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
  const ageMs = Math.max(0, startedAt - record.spawnedAt)
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
    // The pid exited or was recycled since the proof: whatever runs there is not ours.
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

/** Whether a command line runs ComfyUI's `main.py` from inside `installPath`. */
export function commandLineIsInstall(commandLine: string, installPath: string): boolean {
  const cmd = normalizePathForMatch(commandLine)
  return cmd.includes('main.py') && cmd.includes(`${normalizePathForMatch(installPath)}/`)
}

/**
 * Whether the process listening at `pid` is a ComfyUI of this install. Matches the command line
 * (or, on Windows, the venv launcher's command line) against the install path. This is
 * identification for choosing NOT to start a second instance; it is never grounds for a kill.
 */
export async function holderIsInstall(pid: number, installPath: string): Promise<boolean> {
  const lines = await commandLinesOf(pid)
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
