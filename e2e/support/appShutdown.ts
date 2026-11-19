import { spawnSync, type ChildProcess } from 'node:child_process'
import process from 'node:process'

export const GRACEFUL_CLOSE_DEADLINE_MS = 10_000
export const FORCED_EXIT_DEADLINE_MS = 10_000
const EXIT_POLL_MS = 50
const EXIT_SETTLE_MS = 2_000

export interface ShutdownTarget {
  launcher: ChildProcess | undefined
  appPid: number | undefined
  appStartTime?: string | undefined
  closeGracefully: () => Promise<void>
  connectionClosed: () => boolean
}

export interface ShutdownOptions {
  gracefulCloseMs?: number
  forcedExitMs?: number
  forceKill?: (pids: number[]) => void
  log?: (line: string) => void
}

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

export function processStartTime(pid: number): string | undefined {
  const result =
    process.platform === 'win32'
      ? spawnSync(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToFileTimeUtc()`
          ],
          { encoding: 'utf8', timeout: FORCED_EXIT_DEADLINE_MS, windowsHide: true }
        )
      : spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
          encoding: 'utf8',
          timeout: FORCED_EXIT_DEADLINE_MS
        })
  const startTime = result.status === 0 ? result.stdout.trim() : ''
  return startTime || undefined
}

export function descendantsOf(roots: number[]): number[] {
  if (process.platform === 'win32' || roots.length === 0) return []
  const listing = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], {
    encoding: 'utf8',
    timeout: FORCED_EXIT_DEADLINE_MS
  })
  if (listing.status !== 0) return []
  const childrenByParent = new Map<number, number[]>()
  for (const line of listing.stdout.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!pid || !ppid) continue
    childrenByParent.set(ppid, [...(childrenByParent.get(ppid) ?? []), pid])
  }
  const found = new Set<number>()
  const pending = [...roots]
  while (pending.length > 0) {
    for (const child of childrenByParent.get(pending.pop()!) ?? []) {
      if (found.has(child) || roots.includes(child)) continue
      found.add(child)
      pending.push(child)
    }
  }
  return [...found]
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
): () => Promise<void> {
  const gracefulCloseMs = options.gracefulCloseMs ?? GRACEFUL_CLOSE_DEADLINE_MS
  const forcedExitMs = options.forcedExitMs ?? FORCED_EXIT_DEADLINE_MS
  const forceKill = options.forceKill ?? killProcessTrees
  const log = options.log ?? ((line: string) => console.log(line))

  const launcher = target.launcher
  const launcherAlive = (): boolean =>
    !!launcher && launcher.exitCode === null && launcher.signalCode === null
  let appPid = target.appPid !== launcher?.pid ? target.appPid : undefined
  const helpers = new Set<number>()
  const rootPids = (): number[] => {
    const pids: number[] = []
    if (launcherAlive() && launcher?.pid !== undefined) pids.push(launcher.pid)
    if (appPid !== undefined && isPidAlive(appPid)) pids.push(appPid)
    return pids
  }
  const trackHelpers = (): void => {
    for (const pid of descendantsOf(rootPids())) helpers.add(pid)
  }
  const livePids = (): number[] => [...rootPids(), ...[...helpers].filter(isPidAlive)]
  const forgetAppIfItsPidWasReused = (): void => {
    if (appPid === undefined || target.appStartTime === undefined) return
    if (!isPidAlive(appPid)) return
    if (processStartTime(appPid) !== target.appStartTime) appPid = undefined
  }

  const waitForExit = async (ms: number): Promise<boolean> => {
    const stopBy = Date.now() + ms
    while (livePids().length > 0) {
      if (Date.now() >= stopBy) return false
      await wait(EXIT_POLL_MS)
    }
    return true
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
    if (quitOnItsOwn && (await waitForExit(EXIT_SETTLE_MS))) return
    trackHelpers()
    forceKill(livePids())
    if (await waitForExit(forcedExitMs)) return
    throw new Error(
      `[e2e-harness] app processes ${livePids().join(', ')} still running ${forcedExitMs}ms after a forced kill`
    )
  }

  let shutdown: Promise<void> | undefined
  return () => (shutdown ??= run())
}
