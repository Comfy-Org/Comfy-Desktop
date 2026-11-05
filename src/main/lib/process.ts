import { spawn, execFile, type ChildProcess } from 'child_process'
import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import net from 'net'
import { stateDir } from './paths'
import {
  groupHasLiveMembers,
  groupMembers,
  isPidAlive,
  processGroupOf,
  readStartTimes,
  snapshotWindowsTree
} from './processIdentity'

export const COMFY_BOOT_TIMEOUT_MS = 300_000

export interface WaitOptions {
  timeoutMs?: number
  intervalMs?: number
  onPoll?: (info: { attempt: number; elapsedMs: number }) => void
  signal?: AbortSignal
  requestTimeoutMs?: number
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

const monotonicNow = (): number => performance.now()

let ownPgid: Promise<number | null> | null = null
function ownProcessGroup(): Promise<number | null> {
  if (!ownPgid) ownPgid = processGroupOf(process.pid)
  return ownPgid
}

export async function isSafeToSignal(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false
  if (process.platform === 'win32') return pid !== 4
  const own = await ownProcessGroup()
  return own === null || pid !== own
}

export interface KillResult {
  exited: boolean
  waitMs: number
}

export type VerifiedKillResult = KillResult &
  (
    | {
        killed: true
        members?: number[]
      }
    | { killed: false; reason: 'mismatch' | 'probe_failed' | 'unsafe' }
  )

export const KILL_WAIT_MS = process.platform === 'win32' ? 10_000 : 5_000
const KILL_POLL_MS = process.platform === 'win32' ? 100 : 25

function waitUntil(
  gone: () => boolean,
  startedAt: number,
  boundMs: number,
  goneOnTimeout?: () => Promise<boolean>
): Promise<KillResult> {
  return new Promise((resolve) => {
    const deadline = monotonicNow() + boundMs
    const poll = (): void => {
      if (gone()) return resolve({ exited: true, waitMs: monotonicNow() - startedAt })
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

async function killWindowsTree(pid: number, startedAt: number): Promise<KillResult> {
  const killing = taskkillTree(pid)
  const snapshot = await snapshotWindowsTree(pid)
  await killing
  const pids = snapshot && snapshot.pids.length > 0 ? snapshot.pids : [pid]
  return waitUntil(() => !pids.some(isPidAlive), startedAt, KILL_WAIT_MS)
}

async function killWindowsTreeVerified(
  pid: number,
  startedAt: number,
  expectedRoot: string
): Promise<VerifiedKillResult> {
  const snapshot = await snapshotWindowsTree(pid)
  if (!snapshot) {
    return {
      killed: false,
      reason: 'probe_failed',
      exited: false,
      waitMs: monotonicNow() - startedAt
    }
  }
  if (snapshot.rootCreated !== expectedRoot) {
    return {
      killed: false,
      reason: 'mismatch',
      exited: !isPidAlive(pid),
      waitMs: monotonicNow() - startedAt
    }
  }
  await taskkillTree(pid)
  const pids = snapshot.pids.length > 0 ? snapshot.pids : [pid]
  const result = await waitUntil(() => !pids.some(isPidAlive), startedAt, KILL_WAIT_MS)
  return { killed: true, members: pids, ...result }
}

export function killProcessTree(proc: ChildProcess | null): Promise<KillResult> {
  const pid = proc?.pid
  if (!proc || !pid) return Promise.resolve({ exited: true, waitMs: 0 })
  const startedAt = monotonicNow()
  const done = (result: KillResult): KillResult => {
    proc.stdout?.destroy()
    proc.stderr?.destroy()
    return result
  }
  if (process.platform === 'win32') {
    return killWindowsTree(pid, startedAt).then(({ exited, waitMs }) => done({ exited, waitMs }))
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

export async function killPidTree(pid: number, expectedStart: string): Promise<VerifiedKillResult> {
  const startedAt = monotonicNow()
  if (!(await isSafeToSignal(pid))) {
    return { killed: false, reason: 'unsafe', exited: false, waitMs: 0 }
  }
  if (process.platform === 'win32') return killWindowsTreeVerified(pid, startedAt, expectedStart)
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
          if (parts.length >= 5 && parts[3] === 'LISTENING') {
            const addr = parts[1]
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

function probeTimeout(requested: number, remainingMs: number): number {
  const wanted = Number.isFinite(requested) && requested > 0 ? requested : 2000
  return Math.max(1, Math.min(wanted, Math.ceil(remainingMs)))
}

export function waitForPort(
  port: number,
  host: string = '127.0.0.1',
  { timeoutMs = 60000, intervalMs = 500, onPoll, signal, requestTimeoutMs = 2000 }: WaitOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    let attempt = 0
    let done = false
    let activeReq: http.ClientRequest | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined

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

      let attemptSettled = false
      const retry = (): void => {
        if (attemptSettled || done) return
        attemptSettled = true
        retryTimer = setTimeout(poll, intervalMs)
      }
      const req = http.get(
        { host, port, path: '/', timeout: probeTimeout(requestTimeoutMs, timeoutMs - elapsed) },
        (res) => {
          res.resume()
          if (attemptSettled || done) return
          attemptSettled = true
          settle(resolve)
        }
      )
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
  { timeoutMs = 60000, intervalMs = 500, onPoll, signal, requestTimeoutMs = 2000 }: WaitOptions = {}
): Promise<void> {
  const client = url.startsWith('https') ? https : http
  return new Promise((resolve, reject) => {
    const start = Date.now()
    let attempt = 0
    let done = false
    let activeReq: http.ClientRequest | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined

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

      let attemptSettled = false
      const retry = (): void => {
        if (attemptSettled || done) return
        attemptSettled = true
        retryTimer = setTimeout(poll, intervalMs)
      }
      const req = client.get(
        url,
        { timeout: probeTimeout(requestTimeoutMs, timeoutMs - elapsed) },
        (res) => {
          res.resume()
          if (attemptSettled || done) return
          attemptSettled = true
          settle(resolve)
        }
      )
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

export async function isPortListening(port: number, host: string = '127.0.0.1'): Promise<boolean> {
  const connectHosts = ['127.0.0.1', '::1']
  const connectResults = await Promise.all(connectHosts.map((h) => canConnect(port, h)))
  if (connectResults.some(Boolean)) return true

  return !(await canBind(port, host))
}

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
