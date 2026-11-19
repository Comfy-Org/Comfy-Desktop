import { spawnSync, type ChildProcess } from 'node:child_process'
import process from 'node:process'

export const GRACEFUL_CLOSE_DEADLINE_MS = 10_000
export const FORCED_EXIT_DEADLINE_MS = 10_000
const EXIT_POLL_MS = 100
const EXIT_SETTLE_MS = 2_000

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
  forceKill?: (pids: number[]) => void
  log?: (line: string) => void
  readStartTime?: (pid: number) => string | undefined
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

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function killProcessTrees(pids: number[]): void {
  for (const pid of pids) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: FORCED_EXIT_DEADLINE_MS,
        windowsHide: true
      })
      continue
    }
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
}

export function listProcesses(): Map<number, ListedProcess> {
  const listing = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,lstart=,command='], {
    encoding: 'utf8',
    timeout: FORCED_EXIT_DEADLINE_MS
  })
  if (listing.status !== 0) {
    throw new ProcessLookupError('[e2e-harness] could not list processes with ps')
  }
  const processes = new Map<number, ListedProcess>()
  for (const line of listing.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/.exec(line)
    if (!match) continue
    processes.set(Number(match[1]), {
      parentPid: Number(match[2]),
      startTime: match[3]!,
      command: match[4]!
    })
  }
  return processes
}

export function processStartTime(pid: number): string | undefined {
  if (process.platform !== 'win32') return listProcesses().get(pid)?.startTime
  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.StartTime.ToFileTimeUtc() }`
    ],
    { encoding: 'utf8', timeout: FORCED_EXIT_DEADLINE_MS, windowsHide: true }
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
  const forceKill = options.forceKill ?? killProcessTrees
  const log = options.log ?? ((line: string) => console.log(line))
  const readStartTime = options.readStartTime ?? processStartTime
  const helpersAreTracked = process.platform !== 'win32'

  const launcher = target.launcher
  const launcherAlive = (): boolean =>
    !!launcher && launcher.exitCode === null && launcher.signalCode === null
  let appPid = target.appPid !== launcher?.pid ? target.appPid : undefined
  const helpers = new Map<number, string>()

  const rootPids = (): number[] => {
    const pids: number[] = []
    if (launcherAlive() && launcher?.pid !== undefined) pids.push(launcher.pid)
    if (appPid !== undefined && isPidAlive(appPid)) pids.push(appPid)
    return pids
  }

  const trackHelpers = (): void => {
    if (!helpersAreTracked) return
    const processes = listProcesses()
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
    const processes = listProcesses()
    return [...helpers]
      .filter(([pid, startTime]) => processes.get(pid)?.startTime === startTime)
      .map(([pid]) => pid)
  }

  const livePids = (): number[] => [...rootPids(), ...liveHelpers()]

  const forgetAppIfItsPidWasReused = (): void => {
    if (appPid === undefined || target.appStartTime === undefined) return
    if (!isPidAlive(appPid)) return
    const startTime = readStartTime(appPid)
    if (startTime === undefined) {
      if (!isPidAlive(appPid)) return
      throw new ProcessLookupError(
        `[e2e-harness] process ${appPid} is running but its start time could not be read`
      )
    }
    if (startTime !== target.appStartTime) appPid = undefined
  }

  const waitForExit = async (ms: number): Promise<boolean> => {
    const stopBy = Date.now() + ms
    while (livePids().length > 0) {
      if (Date.now() >= stopBy) return false
      await wait(EXIT_POLL_MS)
    }
    return true
  }

  const allGoneWithin = async (ms: number): Promise<boolean> => {
    if (!(await waitForExit(ms))) return false
    trackHelpers()
    return livePids().length === 0
  }

  const run = async (): Promise<void> => {
    forgetAppIfItsPidWasReused()
    trackHelpers()
    let quitOnItsOwn = true
    if (livePids().length > 0 && !target.connectionClosed()) {
      quitOnItsOwn = await closeWithin(target.closeGracefully, gracefulCloseMs)
      if (!quitOnItsOwn) {
        log(`[e2e-harness] app did not quit within ${gracefulCloseMs}ms, killing it`)
      }
    }
    if (quitOnItsOwn && (await allGoneWithin(EXIT_SETTLE_MS))) return
    trackHelpers()
    forceKill(livePids())
    if (await allGoneWithin(forcedExitMs)) return
    throw new Error(
      `[e2e-harness] app processes ${livePids().join(', ')} still running ${forcedExitMs}ms after a forced kill`
    )
  }

  let running: Promise<void> | undefined
  return { shutdown: () => (running ??= run()), trackHelpers }
}
