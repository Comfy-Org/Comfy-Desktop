import { spawnSync, type ChildProcess } from 'node:child_process'
import process from 'node:process'

export const GRACEFUL_CLOSE_DEADLINE_MS = 10_000
export const FORCED_EXIT_DEADLINE_MS = 10_000
const EXIT_POLL_MS = 100
export const EXIT_SETTLE_MS = 2_000

export interface ShutdownTarget {
  launcher: ChildProcess | undefined
  appPid: number | undefined
  appStartTime?: string | undefined
  profileDir?: string | undefined
  closeGracefully: () => Promise<void>
  connectionClosed: () => boolean
}

export interface ShutdownOptions {
  gracefulCloseMs?: number
  forcedExitMs?: number
  forceKill?: (pids: number[], timeoutMs: number) => void
  log?: (line: string) => void
  readStartTime?: (pid: number, timeoutMs: number) => string | undefined
}

export interface ShutdownHandle {
  shutdown: () => Promise<void>
  trackHelpers: () => void
}

interface ListedProcess {
  parentPid: number
  startTime: string
  command: string
}

export class ProcessLookupError extends Error {}

const isZombieState = (state: string): boolean => state.startsWith('Z')

const msUntil = (stopBy: number): number => Math.max(1, stopBy - Date.now())

function isUnreapedZombie(pid: number, timeoutMs: number): boolean {
  const result = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: timeoutMs
  })
  if (result.error || result.status === null) {
    throw new ProcessLookupError(`[e2e-harness] could not read the state of process ${pid}`)
  }
  const state = result.stdout.trim()
  if (state === '') return true
  return isZombieState(state)
}

function isPidAliveWithin(pid: number, timeoutMs: number): boolean {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') return false
  }
  if (process.platform === 'win32') return true
  return !isUnreapedZombie(pid, timeoutMs)
}

export const isPidAlive = (pid: number): boolean => isPidAliveWithin(pid, FORCED_EXIT_DEADLINE_MS)

export function killProcessTrees(pids: number[], timeoutMs = FORCED_EXIT_DEADLINE_MS): void {
  const stopBy = Date.now() + timeoutMs
  for (const pid of pids) {
    if (process.platform === 'win32' && Date.now() < stopBy) {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: msUntil(stopBy),
        windowsHide: true
      })
      continue
    }
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
}

export function listProcesses(timeoutMs = FORCED_EXIT_DEADLINE_MS): Map<number, ListedProcess> {
  const listing = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,stat=,lstart=,command='], {
    encoding: 'utf8',
    timeout: timeoutMs
  })
  if (listing.status !== 0) {
    throw new ProcessLookupError('[e2e-harness] could not list processes with ps')
  }
  const processes = new Map<number, ListedProcess>()
  for (const line of listing.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/.exec(line)
    if (!match || isZombieState(match[3]!)) continue
    processes.set(Number(match[1]), {
      parentPid: Number(match[2]),
      startTime: match[4]!,
      command: match[5]!
    })
  }
  return processes
}

export function processStartTime(
  pid: number,
  timeoutMs = FORCED_EXIT_DEADLINE_MS
): string | undefined {
  if (process.platform !== 'win32') return listProcesses(timeoutMs).get(pid)?.startTime
  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.StartTime.ToFileTimeUtc() }`
    ],
    { encoding: 'utf8', timeout: timeoutMs, windowsHide: true }
  )
  if (result.status !== 0) {
    throw new ProcessLookupError(`[e2e-harness] could not read the start time of process ${pid}`)
  }
  return result.stdout.trim() || undefined
}

export function descendantsOf(
  roots: number[],
  processes: Map<number, ListedProcess> = listProcesses()
): Map<number, string> {
  const childrenByParent = new Map<number, number[]>()
  for (const [pid, { parentPid }] of processes) {
    childrenByParent.set(parentPid, [...(childrenByParent.get(parentPid) ?? []), pid])
  }
  const found = new Map<number, string>()
  const pending = [...roots]
  while (pending.length > 0) {
    for (const child of childrenByParent.get(pending.pop()!) ?? []) {
      if (found.has(child) || roots.includes(child)) continue
      found.set(child, processes.get(child)!.startTime)
      pending.push(child)
    }
  }
  return found
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function closeWithin(closeGracefully: () => Promise<void>, ms: number): Promise<boolean> {
  let deadline: ReturnType<typeof setTimeout> | undefined
  const outcome = await Promise.race([
    closeGracefully()
      .catch(() => {})
      .then(() => 'closed' as const),
    new Promise<'gave-up'>((resolve) => {
      deadline = setTimeout(() => resolve('gave-up'), ms)
    })
  ])
  clearTimeout(deadline)
  return outcome === 'closed'
}

export function createShutdown(
  target: ShutdownTarget,
  options: ShutdownOptions = {}
): ShutdownHandle {
  const gracefulCloseMs = options.gracefulCloseMs ?? GRACEFUL_CLOSE_DEADLINE_MS
  const forcedExitMs = options.forcedExitMs ?? FORCED_EXIT_DEADLINE_MS
  const shutdownMs = gracefulCloseMs + EXIT_SETTLE_MS + forcedExitMs
  const forceKill = options.forceKill ?? killProcessTrees
  const log = options.log ?? ((line: string) => console.log(line))
  const readStartTime = options.readStartTime ?? processStartTime
  const helpersAreTracked = process.platform !== 'win32'

  const launcher = target.launcher
  const launcherAlive = (): boolean =>
    !!launcher && launcher.exitCode === null && launcher.signalCode === null
  let appPid = target.appPid !== launcher?.pid ? target.appPid : undefined
  const helpers = new Map<number, string>()
  let shutdownStopBy: number | undefined
  let lastKnownAlive: number[] = []

  const queryTimeoutMs = (): number =>
    shutdownStopBy === undefined ? FORCED_EXIT_DEADLINE_MS : msUntil(shutdownStopBy)

  const rootPids = (): number[] => {
    const pids: number[] = []
    if (launcherAlive() && launcher?.pid !== undefined) pids.push(launcher.pid)
    if (appPid !== undefined && isPidAliveWithin(appPid, queryTimeoutMs())) pids.push(appPid)
    return pids
  }

  const trackHelpers = (): void => {
    if (!helpersAreTracked) return
    const processes = listProcesses(queryTimeoutMs())
    const roots = rootPids()
    for (const [pid, startTime] of descendantsOf(roots, processes)) helpers.set(pid, startTime)
    if (!target.profileDir) return
    for (const [pid, listed] of processes) {
      if (roots.includes(pid) || pid === process.pid) continue
      if (listed.command.includes(target.profileDir)) helpers.set(pid, listed.startTime)
    }
  }

  const liveHelpers = (): number[] => {
    if (!helpersAreTracked || helpers.size === 0) return []
    const processes = listProcesses(queryTimeoutMs())
    return [...helpers]
      .filter(([pid, startTime]) => processes.get(pid)?.startTime === startTime)
      .map(([pid]) => pid)
  }

  const livePids = (): number[] => {
    lastKnownAlive = [...rootPids(), ...liveHelpers()]
    return lastKnownAlive
  }

  const forgetAppIfItsPidWasReused = (): void => {
    if (appPid === undefined || target.appStartTime === undefined) return
    if (!isPidAliveWithin(appPid, queryTimeoutMs())) return
    const startTime = readStartTime(appPid, queryTimeoutMs())
    if (startTime === undefined) {
      if (!isPidAliveWithin(appPid, queryTimeoutMs())) return
      throw new ProcessLookupError(
        `[e2e-harness] process ${appPid} is running but its start time could not be read`
      )
    }
    if (startTime !== target.appStartTime) appPid = undefined
  }

  const phaseEnd = (stopBy: number, phaseMs: number): number =>
    Math.min(Date.now() + phaseMs, stopBy)

  const pollLivePids = (until: number): number[] => {
    try {
      return livePids()
    } catch (error) {
      if (error instanceof ProcessLookupError && Date.now() >= until) return lastKnownAlive
      throw error
    }
  }

  const survivorsAt = async (until: number): Promise<number[]> => {
    while (Date.now() < until) {
      if (pollLivePids(until).length === 0) return lastKnownAlive
      await wait(Math.min(EXIT_POLL_MS, until - Date.now()))
    }
    return lastKnownAlive
  }

  const survivorsIncludingNewHelpersAt = async (until: number): Promise<number[]> => {
    const alive = await survivorsAt(until)
    if (alive.length > 0 || Date.now() >= until) return alive
    trackHelpers()
    return livePids()
  }

  const run = async (stopBy: number): Promise<void> => {
    shutdownStopBy = stopBy
    lastKnownAlive = []
    forgetAppIfItsPidWasReused()
    trackHelpers()
    let quitOnItsOwn = true
    if (livePids().length > 0 && !target.connectionClosed()) {
      const closeMs = Math.min(gracefulCloseMs, msUntil(stopBy))
      quitOnItsOwn = await closeWithin(target.closeGracefully, closeMs)
      if (!quitOnItsOwn) {
        log(`[e2e-harness] app did not quit within ${closeMs}ms, killing it`)
      }
    }
    if (quitOnItsOwn) {
      const settled = await survivorsIncludingNewHelpersAt(phaseEnd(stopBy, EXIT_SETTLE_MS))
      if (settled.length === 0) return
    }
    forgetAppIfItsPidWasReused()
    trackHelpers()
    const doomed = livePids()
    const killedAt = Date.now()
    const forcedBy = phaseEnd(stopBy, forcedExitMs)
    forceKill(doomed, msUntil(forcedBy))
    const survivors = await survivorsIncludingNewHelpersAt(forcedBy)
    if (survivors.length === 0) return
    throw new Error(
      `[e2e-harness] app processes ${survivors.join(', ')} still running ${Date.now() - killedAt}ms after a forced kill`
    )
  }

  let running: Promise<void> | undefined
  return { shutdown: () => (running ??= run(Date.now() + shutdownMs)), trackHelpers }
}
