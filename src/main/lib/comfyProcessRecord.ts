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
  stopRequestedAt?: number
  uncleanReported?: boolean
  lingering?: LingeringProcess[]
  tree?: LingeringProcess[]
  pendingScan?: { known: LingeringProcess[]; exitedAt: string }
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
      continue
    }
    const record = readRecord(key)
    if (record) out.push(record)
  }
  return out
}

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
  } catch {}
  if (isRecord(parsed) && parsed.childPid !== childPid) return
  try {
    fs.unlinkSync(file)
  } catch {}
}

export function markStopRequested(sessionKey: string): void {
  const current = readRecord(sessionKey)
  if (!current || current.stopRequestedAt || current.desktopPid !== process.pid) return
  writeRecord({ ...current, stopRequestedAt: Date.now() })
}

function anythingAlive(record: ComfyProcessRecord, alive: (pid: number) => boolean): boolean {
  return (
    alive(record.childPid) ||
    (record.lingering ?? []).some((m) => alive(m.pid)) ||
    pendingScanIsCurrent(record)
  )
}

const OWED_SCAN_BOOT_WINDOW_MS = 5 * 60 * 1000

function pendingScanIsOlderThan(record: ComfyProcessRecord, nowMs: number, ms: number): boolean {
  const exitedAt = record.pendingScan?.exitedAt
  if (!exitedAt || !/^\d+$/.test(exitedAt)) return true
  return BigInt(exitedAt) < filetimeOf(nowMs - ms)
}

const PENDING_SCAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function pendingScanIsCurrent(
  record: ComfyProcessRecord,
  nowMs: number = Date.now()
): boolean {
  const exitedAt = record.pendingScan?.exitedAt
  if (!exitedAt || !/^\d+$/.test(exitedAt)) return false
  return BigInt(exitedAt) >= filetimeOf(nowMs - PENDING_SCAN_MAX_AGE_MS)
}

const FILETIME_PER_MS = 10_000n
const FILETIME_UNIX_EPOCH = 116_444_736_000_000_000n

export function filetimeOf(epochMs: number): bigint {
  return BigInt(Math.round(epochMs)) * FILETIME_PER_MS + FILETIME_UNIX_EPOCH
}

const SEED_BEFORE_EXIT = 60_000n * FILETIME_PER_MS

export interface WindowsExitContext {
  known: LingeringProcess[]
  installPath: string
  exitedAt: bigint
}

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

function runsRelativeMainPy(commandLine: string): boolean {
  const script = splitCommandLine(commandLine)
    .map((a) => a.replace(/\\/g, '/'))
    .find((a) => a === 'main.py' || a.endsWith('/main.py'))
  return !!script && !script.startsWith('/') && !/^[a-zA-Z]:\//.test(script)
}

export async function recordWindowsTree(sessionKey: string, childPid: number): Promise<boolean> {
  const rows = await windowsProcessRows()
  const root = rows?.find((r) => r.pid === childPid)
  if (!rows || !root) return false
  const current = readRecord(sessionKey)
  if (!current || current.childPid !== childPid) return false
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

async function recordChildExit(
  sessionKey: string,
  childPid: number,
  windows: WindowsExitContext | null = null
): Promise<void> {
  const found = await survivorsOf(childPid, windows)
  const lingering = found ?? []
  const pendingScan =
    found === null && windows
      ? { known: windows.known, exitedAt: String(windows.exitedAt) }
      : undefined
  const current = readRecord(sessionKey)
  if (!current) return
  if (current.childPid !== childPid) {
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

const pendingExitBookkeeping = new Map<string, Promise<void>>()

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

export async function settleExitBookkeeping(sessionKey: string): Promise<void> {
  await pendingExitBookkeeping.get(sessionKey)
}

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

const PIPES_HELD_AFTER_EXIT_MS = 750

const TREE_SNAPSHOT_DELAYS_MS = [3_000, 10_000, 30_000]

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
    const captured = windowsExitContext(sessionKey, childPid, exitedAt)
    let trigger: () => void = () => {}
    const triggered = new Promise<void>((resolve) => {
      trigger = resolve
    })
    queueExitBookkeeping(sessionKey, async () => {
      await triggered
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
    proc.once('close', scanOnce)
    setTimeout(scanOnce, PIPES_HELD_AFTER_EXIT_MS).unref()
  })
}

export function trackSpawn(
  proc: ChildProcess,
  info: Pick<
    ComfyProcessRecord,
    'sessionKey' | 'installationId' | 'installPath' | 'port' | 'bootId'
  >
): void {
  const childPid = proc.pid
  if (!childPid) return
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

export type RecordVerdict = 'stale' | 'unproven' | 'owner_alive' | 'orphan'

export interface RecordProbe {
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
    if (record.desktopStartTime === null || record.desktopStartTime === probe.selfStartTime) {
      return 'owner_alive'
    }
    return 'orphan'
  }
  const ownerNow = startTimes.get(record.desktopPid)
  if (ownerNow === undefined) return 'orphan'
  if (record.desktopStartTime === null || ownerNow === record.desktopStartTime) {
    return 'owner_alive'
  }
  return 'orphan'
}

export interface QueueState {
  running: number
  pending: number
}

export type QueueAnswer = QueueState | null | 'not_queue'

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
  ageMs: number | null
  waitMs: number
  exitedInTime: boolean
  blocked: null | 'busy' | 'stuck' | 'unverified'
  queue?: QueueState
  queueUnknown?: boolean
  survivorPids?: number[]
  busyOverride?: boolean
  lingering?: number
  scanOwed?: boolean
  scanRecent?: boolean
  stoppedPids?: number[]
}

async function provenLingering(
  record: ComfyProcessRecord,
  deps: PriorProcessDeps
): Promise<LingeringProcess[] | 'unverified' | null> {
  const listed = (record.lingering ?? []).filter((m) => deps.isPidAlive(m.pid))
  if (listed.length === 0) return null
  const times = await deps.readStartTimes(listed.map((m) => m.pid))
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
  const relevant = kills.filter((k) => k.killed || k.reason === 'probe_failed')
  if (relevant.length === 0) return null
  const blocked = relevant.some((k) => !k.killed)
    ? 'unverified'
    : relevant.some((k) => !k.exited)
      ? 'stuck'
      : null
  return { stopped, blocked, members }
}

export const QUEUE_PROBE_BUDGET_MS = 10_000

async function probeQueuePatiently(
  port: number,
  deps: Pick<PriorProcessDeps, 'probeQueue' | 'now' | 'sleep'>,
  signal?: AbortSignal
): Promise<QueueState | null> {
  const deadline = deps.now() + QUEUE_PROBE_BUDGET_MS
  let timeoutMs = 1_000
  let pauseMs = 250
  for (let attempt = 0; attempt < MAX_QUEUE_PROBES; attempt++) {
    const remaining = deadline - deps.now()
    if (remaining <= 0 || signal?.aborted) return null
    const attemptMs = Math.min(timeoutMs, remaining)
    const queue = await withinBudget(deps.probeQueue(port, attemptMs), attemptMs, signal)
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

function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T | undefined> {
  if (!signal) return p
  if (signal.aborted) return Promise.resolve(undefined)
  return new Promise((resolve, reject) => {
    const onAbort = (): void => resolve(undefined)
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function note(opts: { onNote?: (line: string) => void }, line: string): void {
  try {
    opts.onNote?.(line)
  } catch {}
}

async function survivorServesPort(
  record: ComfyProcessRecord,
  survivors: readonly LingeringProcess[],
  deps: PriorProcessDeps
): Promise<boolean> {
  const listeners = await (deps.portListeners ?? findPidsByPort)(record.port).catch(
    () => [] as number[]
  )
  if (listeners.length === 0) return false
  const ours = new Set(survivors.map((m) => m.pid))
  const groupOf = deps.processGroupOf ?? processGroupOf
  let rows: WinProcessRow[] | null | undefined
  for (const pid of listeners) {
    if (ours.has(pid)) continue
    if ((await groupOf(pid).catch(() => null)) === record.childPid) continue
    if (rows === undefined) {
      rows = await (deps.windowsProcessRows ?? windowsProcessRows)().catch(() => null)
      if (rows) for (const m of survivors) for (const d of descendantsOf(rows, m.pid)) ours.add(d)
      if (ours.has(pid)) continue
    }
    return false
  }
  return true
}

const PORTLESS_SURVIVOR_GRACE_MS = 5_000
const PORTLESS_SURVIVOR_POLLS = 50

export const PRIOR_STOP_WAIT_MS = 10_000

export interface PriorProcessDeps {
  readRecord: typeof readRecord
  removeRecordIf: typeof removeRecordIf
  readStartTimes: typeof readStartTimes
  ownStartTime: typeof ownStartTime
  isPidAlive: typeof isPidAlive
  probeQueue: typeof probeQueue
  killPidTree: typeof killPidTree
  settleExitBookkeeping?: (sessionKey: string) => Promise<void>
  writeRecord?: (record: ComfyProcessRecord) => boolean
  rescanWindows?: (record: ComfyProcessRecord) => Promise<LingeringProcess[] | null>
  portInUse?: (port: number) => Promise<boolean>
  portListeners?: (port: number) => Promise<number[]>
  processGroupOf?: (pid: number) => Promise<number | null>
  windowsProcessRows?: () => Promise<WinProcessRow[] | null>
  now: () => number
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

export async function resolvePriorProcess(
  sessionKey: string,
  opts: {
    stopBusy?: boolean
    signal?: AbortSignal
    onProbe?: () => void
    onNote?: (line: string) => void
  } = {},
  deps: PriorProcessDeps = defaultDeps
): Promise<PriorProcessOutcome | null> {
  await (deps.settleExitBookkeeping ?? settleExitBookkeeping)(sessionKey)
  let record = deps.readRecord(sessionKey)
  if (!record) return null
  const startedAt = deps.now()
  const ageMs = Math.max(0, deps.wallNow() - record.spawnedAt)
  if (opts.signal?.aborted) return null
  if (record.pendingScan) {
    let found = pendingScanIsCurrent(record, deps.wallNow())
      ? await (deps.rescanWindows ?? rescanWindows)(record)
      : []
    if (!found) {
      const serving = await (deps.portInUse ?? isPortListening)(record.port).catch(() => true)
      const recent = !pendingScanIsOlderThan(record, deps.wallNow(), OWED_SCAN_BOOT_WINDOW_MS)
      if (serving || recent) {
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
  if (proven && !opts.stopBusy) {
    let serving = await survivorServesPort(record, proven, deps)
    if (!serving) {
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
      proven = still.length > 0 ? still : null
    }
    if (proven && serving) {
      try {
        opts.onProbe?.()
      } catch {}
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
  const overridden = survivors && opts.stopBusy ? { busyOverride: true } : {}
  const survivorPids = Array.isArray(proven) ? proven.map((m) => m.pid) : []
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
      survivorPids,
      ...overridden
    }
  }
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

  if (record.stopRequestedAt) {
    const deadline = deps.now() + PRIOR_STOP_WAIT_MS
    while (deps.isPidAlive(record.childPid) && deps.now() < deadline) await deps.sleep(100)
    if (!deps.isPidAlive(record.childPid)) {
      deps.removeRecordIf(sessionKey, record.childPid)
      return outcome('waited', { exitedInTime: true })
    }
    verdict = await classify()
    if (verdict === 'stale') {
      deps.removeRecordIf(sessionKey, record.childPid)
      return outcome('waited', { exitedInTime: true })
    }
    if (verdict === 'unproven') return outcome('left', { blocked: 'unverified' })
  }
  if (verdict !== 'orphan') return outcome('left')

  if (!opts.stopBusy) {
    try {
      opts.onProbe?.()
    } catch {}
    const queue = await probeQueuePatiently(record.port, deps, opts.signal)
    if (opts.signal?.aborted) return outcome('left')
    if (!queue) return outcome('busy_left', { blocked: 'busy', queueUnknown: true })
    if (queue.running > 0 || queue.pending > 0) {
      return outcome('busy_left', { blocked: 'busy', queue })
    }
  }
  if (opts.signal?.aborted) return outcome('left')
  const kill = await deps.killPidTree(record.childPid, record.childStartTime!)
  if (!kill.killed) {
    if (kill.reason === 'probe_failed') {
      return outcome('left', { blocked: 'unverified' })
    }
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

function normalizePathForMatch(p: string): string {
  const slashed = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' || process.platform === 'darwin'
    ? slashed.toLowerCase()
    : slashed
}

function splitCommandLine(commandLine: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(commandLine)) !== null) out.push(m[1] ?? m[2] ?? m[3]!)
  return out
}

function argvIsInstall(argv: readonly string[], root: string): boolean {
  const args = argv.map(normalizePathForMatch)
  const script = args.findIndex((a) => a === 'main.py' || a.endsWith('/main.py'))
  if (script <= 0) return false
  const mainPy = args[script]!
  if (mainPy.startsWith(root)) return true
  const relative = !mainPy.startsWith('/') && !/^[a-z]:\//i.test(mainPy)
  return relative && args[0]!.startsWith(root)
}

function rawLineIsInstall(line: string, root: string): boolean {
  const text = normalizePathForMatch(line)
  for (let at = text.indexOf(root); at >= 0; at = text.indexOf(root, at + 1)) {
    const next = text.indexOf('main.py', at)
    if (next < 0) break
    const between = text.slice(at, next)
    if (!/\s(?:[/-]|[a-z]:)/i.test(between) && /(^|\/)$/.test(between)) return true
  }
  const unquoted = text.replace(/^["']/, '')
  return unquoted.startsWith(root) && /\s(?![/"']|[a-z]:)[^\s]*main\.py(\s|$)/i.test(text)
}

export function commandLineIsInstall(
  commandLine: string | readonly string[],
  installPath: string,
  cwd?: string | null
): boolean {
  const root = `${normalizePathForMatch(installPath)}/`
  const argv = typeof commandLine === 'string' ? splitCommandLine(commandLine) : commandLine
  if (argvIsInstall(argv, root)) return true
  if (cwd && argvIsInstall(resolveRelative(argv, cwd), root)) return true
  return typeof commandLine === 'string' && rawLineIsInstall(commandLine, root)
}

function resolveRelative(argv: readonly string[], cwd: string): string[] {
  const absolute = (a: string): boolean => a.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(a)
  return argv.map((a, i) => {
    const pathLike = i === 0 ? /[\\/]/.test(a) : a === 'main.py' || /[\\/]main\.py$/.test(a)
    return pathLike && !absolute(a) ? path.resolve(cwd, a) : a
  })
}

export async function holderIsInstall(pid: number, installPath: string): Promise<boolean> {
  const argv = await commandArgvOf(pid)
  if (argv && commandLineIsInstall(argv, installPath)) return true
  const lines = argv ? [] : await commandLinesOf(pid)
  if (lines.some((line) => commandLineIsInstall(line, installPath))) return true
  const cwd = await processCwdOf(pid).catch(() => null)
  if (cwd) {
    if (argv && commandLineIsInstall(argv, installPath, cwd)) return true
    if (lines.some((line) => commandLineIsInstall(line, installPath, cwd))) return true
  }
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

export function takePriorSessionUnclean(): boolean {
  let unclean = false
  for (const r of listRecords()) {
    if (r.desktopPid === process.pid || isPidAlive(r.desktopPid)) continue
    if (!r.stopRequestedAt && !r.uncleanReported && !r.childExitedAt) {
      unclean = true
      if (anythingAlive(r, isPidAlive)) writeRecord({ ...r, uncleanReported: true })
    }
    if (!anythingAlive(r, isPidAlive)) removeRecordIf(r.sessionKey, r.childPid)
  }
  return unclean
}
