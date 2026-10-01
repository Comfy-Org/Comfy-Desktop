import { spawn, execFile, type ChildProcess } from 'child_process'
import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import net from 'net'
import { stateDir } from './paths'
import {
  descendantsOf,
  groupHasLiveMembers,
  groupMembers,
  isPidAlive,
  processGroupOf,
  readStartTimes,
  windowsProcessRows
} from './processIdentity'

/** Default timeout for waiting for ComfyUI to boot (5 minutes). */
export const COMFY_BOOT_TIMEOUT_MS = 300_000

export interface WaitOptions {
  timeoutMs?: number
  intervalMs?: number
  onPoll?: (info: { attempt: number; elapsedMs: number }) => void
  signal?: AbortSignal
}

export interface ProcessInfo {
  name: string
  commandLine: string
}

export interface LaunchCmd {
  args: string[]
  port: number
}

export interface PortLock {
  pid: number
  installationName: string
  timestamp: number
}

export function spawnProcess(
  cmd: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
  options?: { showWindow?: boolean }
): ChildProcess {
  return spawn(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: !options?.showWindow,
    detached: process.platform !== 'win32',
    env: env || process.env
  })
}

/**
 * Fire-and-forget process tree kill. On Windows, uses taskkill /T /F to
 * terminate the entire process tree. On Unix, sends SIGTERM to the process.
 * Does not wait for the process to exit — use killProcessTree when you need
 * to wait.
 */
export function killProcTree(proc: ChildProcess): void {
  if (proc.killed || proc.pid == null) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { windowsHide: true }, () => {})
  } else {
    try {
      process.kill(-proc.pid!, 'SIGTERM')
    } catch {
      proc.kill()
    }
  }
}

/** Deadlines for kills and waits: immune to wall-clock steps, which could otherwise stretch a
 *  bounded wait by hours or skip it entirely. */
const monotonicNow = (): number => performance.now()

/** Our own process group (POSIX), read once. Signalling it would take down this Desktop. */
let ownPgid: Promise<number | null> | null = null
function ownProcessGroup(): Promise<number | null> {
  if (!ownPgid) ownPgid = processGroupOf(process.pid)
  return ownPgid
}

/**
 * Whether `pid` may be signalled by a kill that works from a record rather than a child we hold.
 * Refuses pid 0 and 1 (`kill(-1)` is every process the user owns), this Desktop, and — on POSIX,
 * where the kill is to `-pid` — this Desktop's own process group. Only a forged or corrupt record
 * can ask for these; the proof would normally never get this far.
 */
export async function isSafeToSignal(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false
  if (process.platform === 'win32') return pid !== 4 // the System process
  const own = await ownProcessGroup()
  return own === null || pid !== own
}

/** Outcome of a kill that waits. `exited` is false when the bound ran out with part of the
 *  tree still alive: the caller must not assume the port, or ComfyUI's database lock, is free. */
export interface KillResult {
  exited: boolean
  waitMs: number
}

/** A kill that first re-verifies whose pid it is. `killed: false` says why nothing was
 *  signalled: the pid now names another process (`mismatch`), or the OS could not be asked
 *  (`probe_failed`), which proves nothing either way. */
export type VerifiedKillResult = KillResult &
  (
    | {
        killed: true
        /** What the kill covered, as far as it could be listed: the process group (POSIX) or
         *  the tree (Windows). For the log only. */
        members?: number[]
      }
    | { killed: false; reason: 'mismatch' | 'probe_failed' | 'unsafe' }
  )

/** How long a kill waits for the tree to be gone. Windows termination is asynchronous (a
 *  process blocked in a driver call keeps its handles until the call returns), so it gets
 *  longer than the POSIX SIGKILL. */
export const KILL_WAIT_MS = process.platform === 'win32' ? 10_000 : 5_000
const KILL_POLL_MS = process.platform === 'win32' ? 100 : 25

function waitUntil(
  gone: () => boolean,
  startedAt: number,
  boundMs: number,
  /** Asked once when the bound runs out: whether what is left is really gone after all (a
   *  process group holding only unreaped zombies, which answer `kill 0` but hold nothing). */
  goneOnTimeout?: () => Promise<boolean>
): Promise<KillResult> {
  return new Promise((resolve) => {
    // The bound is for waiting, measured from here: whatever ran before (a PowerShell snapshot
    // can take longer than the bound itself) must not leave the poll a single sample.
    const deadline = monotonicNow() + boundMs
    const poll = (): void => {
      if (gone()) return resolve({ exited: true, waitMs: monotonicNow() - startedAt })
      // Bounded: a member stuck in uninterruptible sleep (or persistently EPERM) would
      // otherwise trap this poll forever and hang every caller that awaits the kill. The
      // caller learns it timed out and decides; it is never told the tree is gone.
      if (monotonicNow() >= deadline) {
        void (goneOnTimeout ? goneOnTimeout().catch(() => false) : Promise.resolve(false)).then(
          (exited) => resolve({ exited, waitMs: monotonicNow() - startedAt })
        )
        return
      }
      setTimeout(poll, KILL_POLL_MS).unref()
    }
    poll()
  })
}

function posixGroupGone(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return false
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'EPERM'
  }
}

function taskkillTree(pid: number): Promise<void> {
  return new Promise<void>((resolve) => {
    execFile('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, () => resolve())
  })
}

/** A process Desktop recorded, by pid and creation time (Windows FILETIME). */
export interface KnownProcess {
  pid: number
  startTime: string
}

/** How long a stop waits for the process table before killing anyway: the kill must not be held
 *  up by a slow PowerShell for longer than the quit is willing to wait. */
const PRE_KILL_SNAPSHOT_MS = 3_000

/**
 * The tree under `root` (only when the root itself is in the table: without its creation time,
 * "a child of this pid" cannot tell its children from older processes naming a reused pid), and
 * under each `known` process still alive with its recorded creation time (the recorded
 * interpreter, whose child outside the launcher's job is not under the launcher once that is
 * gone), by pid and creation time. Null when the table could not be read (within `capMs`).
 */
async function windowsTreeWithTimes(
  root: number,
  known: readonly KnownProcess[],
  capMs: number | null
): Promise<Map<number, string> | null> {
  const read = windowsProcessRows()
  const rows =
    capMs === null
      ? await read
      : await Promise.race([
          read,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), capMs).unref())
        ])
  if (!rows) return null
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  const roots = [
    ...(byPid.get(root)?.created ? [root] : []),
    ...known.filter((k) => byPid.get(k.pid)?.created === k.startTime).map((k) => k.pid)
  ]
  const tree = new Map<number, string>()
  for (const r of roots) {
    for (const pid of descendantsOf(rows, r)) {
      const created = byPid.get(pid)?.created
      if (created) tree.set(pid, created)
    }
  }
  return tree
}

/** After the root's `taskkill /T`: kill each member still alive, but only while its pid still
 *  names the same process (creation time re-read now). Never a bare pid. */
async function killWindowsSurvivors(tree: ReadonlyMap<number, string>): Promise<void> {
  const alive = [...tree.keys()].filter(isPidAlive)
  if (alive.length === 0) return
  const rows = await windowsProcessRows()
  if (!rows) return
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  const same = alive.filter((pid) => byPid.get(pid)?.created === tree.get(pid))
  const safe = await Promise.all(same.map((pid) => isSafeToSignal(pid)))
  await Promise.all(same.filter((_, i) => safe[i]).map((pid) => taskkillTree(pid)))
}

/**
 * Windows: snapshot the tree first (pid and creation time, seeded with the recorded processes),
 * then `taskkill /T /F` the root, then kill whatever of the snapshot is still alive and still the
 * same process, then poll every pid of it until it has exited. The snapshot comes first because a
 * child of the interpreter outside the launcher's job loses its place in the tree the moment the
 * launcher and interpreter die.
 *
 * The root is signalled only while `rootAlive()` (Node has not yet reported its exit): until then
 * Node holds a handle to the process, and Windows does not reuse a pid while a handle is open.
 * A snapshot that cannot be read in time still kills the root, and can only watch it.
 */
async function killWindowsTree(
  pid: number,
  startedAt: number,
  known: readonly KnownProcess[],
  rootAlive: () => boolean
): Promise<KillResult> {
  const tree = await windowsTreeWithTimes(pid, known, PRE_KILL_SNAPSHOT_MS)
  if (rootAlive()) await taskkillTree(pid)
  const rootGone = (): boolean => !rootAlive() || !isPidAlive(pid)
  if (!tree) {
    console.warn(`[process] process table not read in time for pid ${pid}: watching it alone`)
    return waitUntil(rootGone, startedAt, KILL_WAIT_MS)
  }
  if (tree.size === 0) return waitUntil(rootGone, startedAt, KILL_WAIT_MS)
  await killWindowsSurvivors(tree)
  // The root's own pid is watched through Node's handle, never by a pid that may be reused.
  const others = [...tree.keys()].filter((p) => p !== pid)
  return waitUntil(() => rootGone() && !others.some(isPidAlive), startedAt, KILL_WAIT_MS)
}

/** Windows, verified: the root's creation time must match the snapshot, or nothing is signalled. */
async function killWindowsTreeVerified(
  pid: number,
  startedAt: number,
  expectedRoot: string
): Promise<VerifiedKillResult> {
  // No cap of its own: the launch-time stop waits for the table as long as the probe allows.
  const tree = await windowsTreeWithTimes(pid, [], null)
  if (!tree) {
    return {
      killed: false,
      reason: 'probe_failed',
      exited: false,
      waitMs: monotonicNow() - startedAt
    }
  }
  if (tree.get(pid) !== expectedRoot) {
    return {
      killed: false,
      reason: 'mismatch',
      exited: !isPidAlive(pid),
      waitMs: monotonicNow() - startedAt
    }
  }
  await taskkillTree(pid)
  await killWindowsSurvivors(tree)
  const pids = [...tree.keys()]
  const result = await waitUntil(() => !pids.some(isPidAlive), startedAt, KILL_WAIT_MS)
  return { killed: true, members: pids, ...result }
}

// --- Stops in flight, so quitting can wait for them (they are all bounded by KILL_WAIT_MS) ---

const stopsInFlight = new Set<Promise<unknown>>()
/** The first stop requested for each child, for its `exited` report. */
const stopOutcomes = new WeakMap<ChildProcess, Promise<KillResult>>()
/** A stop of each child still in flight: a second request (an abort handler and a quit, say)
 *  joins it instead of killing again under it. */
const stopsByChild = new WeakMap<ChildProcess, Promise<KillResult>>()

function trackStop<T>(stop: Promise<T>): Promise<T> {
  stopsInFlight.add(stop)
  void stop.then(
    () => stopsInFlight.delete(stop),
    () => stopsInFlight.delete(stop)
  )
  return stop
}

const stopSweeps = new Set<Promise<unknown>>()

/** A search for processes to stop (several, found asynchronously): in flight from now, so a quit
 *  that starts right after waits for it. Not itself a stop: each kill it makes is one, and is
 *  counted as one. */
export function trackStopSweep<T>(sweep: Promise<T>): Promise<T> {
  stopSweeps.add(sweep)
  void sweep.then(
    () => stopSweeps.delete(sweep),
    () => stopSweeps.delete(sweep)
  )
  return sweep
}

export function stopSweepsInFlight(): Promise<unknown>[] {
  return [...stopSweeps]
}

/** Every ComfyUI stop still in flight: a kill whose tree has not been seen to exit yet. */
export function comfyStopsInFlight(): Promise<unknown>[] {
  return [...stopsInFlight]
}

const exitReports = new Set<Promise<unknown>>()

/** An exit handler still running (it reports `comfyui.exited`, which a quit waits for). */
export function trackExitReport(report: Promise<unknown>): void {
  exitReports.add(report)
  void report.then(
    () => exitReports.delete(report),
    () => exitReports.delete(report)
  )
}

export function exitReportsInFlight(): Promise<unknown>[] {
  return [...exitReports]
}

/** How the stop Desktop requested for `proc` went; undefined when Desktop never stopped it. */
export function stopOutcomeOf(proc: ChildProcess): Promise<KillResult> | undefined {
  return stopOutcomes.get(proc)
}

/** How long a stop that saw the tree exit waits for Node to report the child's exit and its
 *  pipes closing, so the exit handlers (records, telemetry) have run when the stop settles. */
const EXIT_REPORT_WAIT_MS = 1_000

/** Resolves once Node has reported the child closed (exit seen, pipes shut), which is when its
 *  exit handlers run; at most `EXIT_REPORT_WAIT_MS` after `bounded()` is called. Listens from
 *  the moment it is created, so a close during the kill is not missed. */
function closeReport(proc: ChildProcess): { bounded: () => Promise<void> } {
  const closedAlready =
    (proc.exitCode !== null || proc.signalCode !== null) &&
    (!proc.stdout || proc.stdout.destroyed) &&
    (!proc.stderr || proc.stderr.destroyed)
  if (closedAlready) return { bounded: () => Promise.resolve() }
  let closed = false
  let onClose: () => void = () => {}
  proc.once('close', () => {
    closed = true
    onClose()
  })
  return {
    bounded: () =>
      closed
        ? Promise.resolve()
        : new Promise((resolve) => {
            const timer = setTimeout(resolve, EXIT_REPORT_WAIT_MS)
            timer.unref()
            onClose = () => {
              clearTimeout(timer)
              resolve()
            }
          })
  }
}

export function killProcessTree(
  proc: ChildProcess | null,
  /** Windows: processes recorded under this child (its interpreter), by creation time, so their
   *  children are found even once the child itself is gone. */
  known: readonly KnownProcess[] = []
): Promise<KillResult> {
  if (!proc?.pid) return Promise.resolve({ exited: true, waitMs: 0 })
  const running = stopsByChild.get(proc)
  if (running) return running
  const close = closeReport(proc)
  const stop = trackStop(
    killProcessTreeNow(proc, known).then(async (result) => {
      if (result.exited) await close.bounded()
      return result
    })
  )
  if (!stopOutcomes.has(proc)) stopOutcomes.set(proc, stop)
  stopsByChild.set(proc, stop)
  const forget = (): void => {
    if (stopsByChild.get(proc) === stop) stopsByChild.delete(proc)
  }
  // Settled either way: a failed stop must not be handed to every later request.
  void stop.then(forget, forget)
  return stop
}

function killProcessTreeNow(
  proc: ChildProcess,
  known: readonly KnownProcess[]
): Promise<KillResult> {
  const pid = proc.pid!
  const startedAt = monotonicNow()
  const done = (result: KillResult): KillResult => {
    proc.stdout?.destroy()
    proc.stderr?.destroy()
    return result
  }
  if (process.platform === 'win32') {
    const rootAlive = (): boolean => proc.exitCode === null && proc.signalCode === null
    return killWindowsTree(pid, startedAt, known, rootAlive).then(({ exited, waitMs }) =>
      done({ exited, waitMs })
    )
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      return Promise.resolve(done({ exited: true, waitMs: 0 }))
    }
  }
  return waitUntil(
    () => posixGroupGone(pid),
    startedAt,
    KILL_WAIT_MS,
    async () => !(await groupHasLiveMembers(pid))
  ).then(done)
}

/**
 * Kill a process tree Desktop no longer holds a `ChildProcess` for (an orphan left by a
 * previous Desktop), and wait for it to be gone. `expectedStart` is the start token the caller
 * proved ownership with; it is re-checked immediately before the kill so a pid recycled since
 * the proof is never signalled (`killed: false`).
 *
 * POSIX: Desktop spawns ComfyUI `detached`, so the orphan leads its own process group and the
 * whole group is signalled, exactly as `killProcessTree` does.
 */
export function killPidTree(pid: number, expectedStart: string): Promise<VerifiedKillResult> {
  return trackStop(killPidTreeNow(pid, expectedStart))
}

async function killPidTreeNow(pid: number, expectedStart: string): Promise<VerifiedKillResult> {
  const startedAt = monotonicNow()
  if (!(await isSafeToSignal(pid))) {
    return { killed: false, reason: 'unsafe', exited: false, waitMs: 0 }
  }
  if (process.platform === 'win32') return killWindowsTreeVerified(pid, startedAt, expectedStart)
  // The rest of its group (the leader excluded), listed before the proof, so nothing comes
  // between the proof and the signal.
  const members =
    (await processGroupOf(pid).catch(() => null)) === pid
      ? await groupMembers(pid).catch(() => [] as number[])
      : []
  const now = await readStartTimes([pid])
  if (!now) {
    return {
      killed: false,
      reason: 'probe_failed',
      exited: false,
      waitMs: monotonicNow() - startedAt
    }
  }
  if (now.get(pid) !== expectedStart) {
    return {
      killed: false,
      reason: 'mismatch',
      exited: !isPidAlive(pid),
      waitMs: monotonicNow() - startedAt
    }
  }
  let group = true
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    group = false
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
  // Not a group leader (should not happen for a detached spawn): watch the pid itself. The
  // orphan's parent is init or a subreaper, which reaps it, so it does not linger as a zombie.
  const gone = group ? () => posixGroupGone(pid) : () => !isPidAlive(pid)
  const result = await waitUntil(
    gone,
    startedAt,
    KILL_WAIT_MS,
    group ? async () => !(await groupHasLiveMembers(pid)) : undefined
  )
  return { killed: true, members: group ? [pid, ...members] : [pid], ...result }
}

export function findPidsByPort(port: number): Promise<number[]> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true }, (err, stdout) => {
        if (err) return resolve([])
        const pids = new Set<number>()
        const target = `:${port}`
        for (const line of stdout.split('\n')) {
          const parts = line.trim().split(/\s+/)
          // Format: Proto  LocalAddress  ForeignAddress  State  PID
          if (parts.length >= 5 && parts[3] === 'LISTENING') {
            const addr = parts[1]
            // Match exactly :port at the end of the address (e.g. 0.0.0.0:8188 or 127.0.0.1:8188)
            if (addr && addr.endsWith(target)) {
              const pid = parseInt(parts[4]!, 10)
              if (pid > 0) pids.add(pid)
            }
          }
        }
        resolve([...pids])
      })
    } else {
      execFile(
        'lsof',
        ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-t'],
        { windowsHide: true },
        (err, stdout) => {
          if (err) return resolve([])
          const pids = stdout
            .trim()
            .split(/\s+/)
            .map((s) => parseInt(s, 10))
            .filter((n) => n > 0)
          resolve(pids)
        }
      )
    }
  })
}

export function killByPort(port: number): Promise<void> {
  return findPidsByPort(port).then((pids) => {
    if (pids.length === 0) return
    if (process.platform === 'win32') {
      const args: string[] = []
      for (const pid of pids) args.push('/F', '/T', '/PID', String(pid))
      return new Promise<void>((resolve) => {
        execFile('taskkill', args, { windowsHide: true }, () => resolve())
      })
    }
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
  })
}

export function waitForPort(
  port: number,
  host: string = '127.0.0.1',
  { timeoutMs = 60000, intervalMs = 500, onPoll, signal }: WaitOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    let attempt = 0
    let done = false
    let activeReq: http.ClientRequest | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    // Settle the outer promise exactly once: tear down the abort listener,
    // any pending retry, and the in-flight request so a late response can't
    // resolve after cancellation.
    const settle = (fn: () => void): void => {
      if (done) return
      done = true
      signal?.removeEventListener('abort', onAbort)
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      activeReq?.destroy()
      fn()
    }
    const onAbort = (): void => settle(() => reject(new Error('Launch cancelled.')))

    if (signal) {
      if (signal.aborted) {
        reject(new Error('Launch cancelled.'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    const poll = (): void => {
      if (done) return
      const elapsed = Date.now() - start
      if (elapsed > timeoutMs) {
        settle(() =>
          reject(
            new Error(`Timed out waiting for port ${port} after ${Math.round(elapsed / 1000)}s`)
          )
        )
        return
      }

      attempt++
      if (onPoll) onPoll({ attempt, elapsedMs: elapsed })

      // Idempotency guard: `req.destroy()` on timeout synchronously emits
      // 'error', so without it each timed-out attempt schedules TWO retry
      // polls and the pollers multiply.
      let attemptSettled = false
      const retry = (): void => {
        if (attemptSettled || done) return
        attemptSettled = true
        retryTimer = setTimeout(poll, intervalMs)
      }
      const req = http.get({ host, port, path: '/', timeout: 2000 }, (res) => {
        res.resume()
        if (attemptSettled || done) return
        attemptSettled = true
        settle(resolve)
      })
      activeReq = req

      req.on('error', retry)
      req.on('timeout', () => {
        req.destroy()
        retry()
      })
    }

    poll()
  })
}

export function waitForUrl(
  url: string,
  { timeoutMs = 60000, intervalMs = 500, onPoll, signal }: WaitOptions = {}
): Promise<void> {
  const client = url.startsWith('https') ? https : http
  return new Promise((resolve, reject) => {
    const start = Date.now()
    let attempt = 0
    let done = false
    let activeReq: http.ClientRequest | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    // Same single-settlement teardown as waitForPort: an abort must cancel
    // the in-flight request and pending retries so a late response can't
    // resolve after cancellation.
    const settle = (fn: () => void): void => {
      if (done) return
      done = true
      signal?.removeEventListener('abort', onAbort)
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      activeReq?.destroy()
      fn()
    }
    const onAbort = (): void => settle(() => reject(new Error('Launch cancelled.')))

    if (signal) {
      if (signal.aborted) {
        reject(new Error('Launch cancelled.'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    const poll = (): void => {
      if (done) return
      const elapsed = Date.now() - start
      if (elapsed > timeoutMs) {
        settle(() =>
          reject(new Error(`Timed out waiting for ${url} after ${Math.round(elapsed / 1000)}s`))
        )
        return
      }

      attempt++
      if (onPoll) onPoll({ attempt, elapsedMs: elapsed })

      // Same idempotency guard as waitForPort: destroy-on-timeout emits
      // 'error', which must not schedule a second retry poll.
      let attemptSettled = false
      const retry = (): void => {
        if (attemptSettled || done) return
        attemptSettled = true
        retryTimer = setTimeout(poll, intervalMs)
      }
      const req = client.get(url, { timeout: 2000 }, (res) => {
        res.resume()
        if (attemptSettled || done) return
        attemptSettled = true
        settle(resolve)
      })
      activeReq = req

      req.on('error', retry)
      req.on('timeout', () => {
        req.destroy()
        retry()
      })
    }

    poll()
  })
}

export function getProcessInfo(pid: number): Promise<ProcessInfo | null> {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(null)
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Use PowerShell Get-CimInstance with JSON output (wmic is deprecated/removed on modern Windows)
      const cmd = `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object Name,CommandLine | ConvertTo-Json`
      execFile(
        'powershell',
        ['-NoProfile', '-Command', cmd],
        { windowsHide: true },
        (err, stdout) => {
          if (err) return resolve(null)
          try {
            const obj = JSON.parse(stdout) as { Name?: string; CommandLine?: string }
            resolve({ name: obj.Name || '', commandLine: obj.CommandLine || '' })
          } catch {
            resolve(null)
          }
        }
      )
    } else {
      execFile(
        'ps',
        ['-p', String(pid), '-o', 'comm=,args='],
        { windowsHide: true },
        (err, stdout) => {
          if (err) return resolve(null)
          const parts = stdout.trim().split(/\s+/)
          resolve({
            name: parts[0] ?? '',
            commandLine: stdout.trim()
          })
        }
      )
    }
  })
}

export function looksLikeComfyUI(info: ProcessInfo | null): boolean {
  if (!info) return false
  const cmd = (info.commandLine || '').toLowerCase()
  // Match ComfyUI's main.py entry point and any path containing "comfyui"
  return cmd.includes('main.py') && cmd.includes('comfyui')
}

export function setPortArg(launchCmd: LaunchCmd, port: number): void {
  const portIdx = launchCmd.args.indexOf('--port')
  if (portIdx >= 0 && launchCmd.args[portIdx + 1] != null) {
    launchCmd.args[portIdx + 1] = String(port)
  } else {
    launchCmd.args.push('--port', String(port))
  }
  launchCmd.port = port
}

/**
 * Whether a TCP connect to `host:port` succeeds within `timeoutMs`. Used as
 * positive proof that something is listening — bind probes alone aren't
 * reliable on Windows because Winsock can let a `127.0.0.1` bind succeed
 * while another process owns the same port via `0.0.0.0` / `::`.
 *
 * Loopback only: never connect to a non-loopback address, both because we
 * don't want to touch arbitrary remote hosts and because loopback connects
 * never trigger Windows Defender / macOS firewall prompts.
 */
function canConnect(port: number, host: string, timeoutMs: number = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    try {
      socket.connect(port, host)
    } catch {
      finish(false)
    }
  })
}

/**
 * Whether a server can bind `host:port`. Resolves `true` on successful
 * bind, `false` on `EADDRINUSE` / `EACCES`. Other errors (address family
 * unavailable, etc.) resolve `false` too — the caller treats "couldn't
 * bind for any reason" as "don't try to launch here."
 *
 * Never binds a non-loopback / non-requested address: a bind on `0.0.0.0`
 * or `::` would trigger the OS firewall ("allow incoming connections?")
 * prompt the first time the app runs, which is a poor first-launch
 * experience just to probe a port. The loopback connect probe in
 * `isPortListening` already catches the wildcard-peer case we'd otherwise
 * want this for.
 */
function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    try {
      server.listen(port, host, () => {
        server.once('close', () => resolve(true))
        server.close()
      })
    } catch {
      resolve(false)
    }
  })
}

/**
 * Check whether a port is already in use. Combines two probes so we don't
 * miss listeners on Windows, where a `127.0.0.1` bind test can succeed
 * even when another process owns the same port via `0.0.0.0` / `::`:
 *
 *  1. TCP connect to loopback (`127.0.0.1`, `::1`) — positive proof that
 *     a listener is reachable, regardless of which interface it bound.
 *     A peer on `0.0.0.0:N` or `[::]:N` answers loopback connects too, so
 *     we don't need to bind-probe the wildcard ourselves (which would
 *     trigger the OS firewall prompt).
 *  2. Bind probe on the requested host — catches non-listening
 *     reservations and ports owned by other users that
 *     `lsof` / `findPidsByPort` can't see on Linux.
 *
 * Either probe reporting "busy" wins.
 */
export async function isPortListening(port: number, host: string = '127.0.0.1'): Promise<boolean> {
  const connectHosts = ['127.0.0.1', '::1']
  const connectResults = await Promise.all(connectHosts.map((h) => canConnect(port, h)))
  if (connectResults.some(Boolean)) return true

  return !(await canBind(port, host))
}

/**
 * Wait until `port` on `host` can be bound again, up to `timeoutMs`. A process that has exited
 * can still own its listening socket for a few milliseconds while the OS tears it down (measured
 * on Windows: 2-12 ms after the exit code is set), so a port probe straight after a kill can see
 * the dead process's port as busy. Resolves whether the port became free.
 */
export async function waitForPortFree(
  port: number,
  host: string = '127.0.0.1',
  timeoutMs: number = 2_000,
  intervalMs: number = 50
): Promise<boolean> {
  const deadline = monotonicNow() + timeoutMs
  for (;;) {
    if (!(await isPortListening(port, host))) return true
    if (monotonicNow() >= deadline) return false
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

export async function findAvailablePort(
  host: string,
  startPort: number,
  endPort: number,
  excludePorts?: ReadonlySet<number>
): Promise<number> {
  for (let port = startPort; port <= endPort; port++) {
    if (excludePorts && excludePorts.has(port)) continue
    if (!(await isPortListening(port, host))) return port
  }
  throw new Error(`No available ports found between ${startPort} and ${endPort}`)
}

// --- Port lock files ---
// When the launcher spawns ComfyUI on a port, it writes a lock file so other
// launcher instances can identify the owner without inspecting process trees.

function portLockDir(): string {
  return path.join(stateDir(), 'port-locks')
}

function portLockPath(port: number): string {
  return path.join(portLockDir(), `port-${port}.json`)
}

export function writePortLock(
  port: number,
  { pid, installationName }: { pid: number; installationName: string }
): void {
  const dir = portLockDir()
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
  const data: PortLock = { pid, installationName, timestamp: Date.now() }
  try {
    fs.writeFileSync(portLockPath(port), JSON.stringify(data))
  } catch {}
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return Boolean(e && (e as NodeJS.ErrnoException).code === 'EPERM')
  }
}

export function readPortLock(port: number): PortLock | null {
  try {
    const raw = fs.readFileSync(portLockPath(port), 'utf-8')
    const lock = JSON.parse(raw) as PortLock | null
    if (!lock || !lock.pid || !isProcessAlive(lock.pid)) {
      // Stale lock — clean it up
      removePortLock(port)
      return null
    }
    return lock
  } catch {
    return null
  }
}

export function removePortLock(port: number): void {
  try {
    fs.unlinkSync(portLockPath(port))
  } catch {}
}
