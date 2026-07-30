import { spawn, execFile, type ChildProcess } from 'child_process'
import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import net from 'net'
import { stateDir } from './paths'

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

export function killProcessTree(proc: ChildProcess | null): Promise<void> {
  const pid = proc?.pid
  if (!proc || !pid) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = (): void => {
      proc.stdout?.destroy()
      proc.stderr?.destroy()
      resolve()
    }
    if (process.platform === 'win32') {
      execFile('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, done)
      return
    }

    const processGroup = -pid
    try {
      process.kill(processGroup, 'SIGKILL')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return done()
    }

    // Bounded: a group member stuck in uninterruptible sleep (or persistently
    // EPERM) would otherwise trap this poll forever and hang every caller that
    // awaits the kill (launch cancel, relaunch). Resolving on the cap is the
    // lesser evil - the caller proceeds against a possibly-lingering process
    // instead of deadlocking the lifecycle.
    const killDeadline = Date.now() + 5000
    const waitForGroupExit = (): void => {
      if (Date.now() > killDeadline) return done()
      try {
        process.kill(processGroup, 0)
        setTimeout(waitForGroupExit, 25).unref()
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') {
          setTimeout(waitForGroupExit, 25).unref()
        } else {
          done()
        }
      }
    }
    waitForGroupExit()
  })
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
          reject(new Error(`Timed out waiting for port ${port} after ${Math.round(elapsed / 1000)}s`))
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
