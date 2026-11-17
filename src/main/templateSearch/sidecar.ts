import { spawn, type ChildProcess, type SpawnOptions } from 'child_process'
import { killProcessTree } from '../lib/process'
import { asRecord } from './json'

export const SIDECAR_PROTOCOL = 1
const READY_TIMEOUT_MS = 60_000
const STOP_GRACE_MS = 3_000
const MAX_LINE_BYTES = 64 * 1024

export type SidecarProblem =
  'runtime_unsupported' | 'bundle_incompatible' | 'bundle_invalid' | 'failed'

export const RUNTIME_UNSUPPORTED_EXIT = 3

const PROBLEM_BY_EXIT_CODE: Record<number, SidecarProblem> = {
  [RUNTIME_UNSUPPORTED_EXIT]: 'runtime_unsupported',
  4: 'bundle_incompatible',
  5: 'bundle_invalid'
}

export interface SidecarReady {
  port: number
  token: string
}

export interface RunningSidecar {
  ready: SidecarReady
  exited: Promise<void>
  stop(): Promise<void>
}

export type SidecarStart =
  { ok: true; sidecar: RunningSidecar } | { ok: false; problem: SidecarProblem }

export type SpawnSidecar = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess

export interface SidecarLaunch {
  python: string
  pyz: string
  bundleDir: string
  cacheDir: string
  verify: boolean
}

export function sidecarArgs({ pyz, bundleDir, cacheDir, verify }: SidecarLaunch): string[] {
  return [
    '-I',
    '-B',
    pyz,
    '--bundle',
    bundleDir,
    '--cache-dir',
    cacheDir,
    ...(verify ? ['--verify'] : [])
  ]
}

export function problemForExit(code: number | null): SidecarProblem {
  return (code !== null && PROBLEM_BY_EXIT_CODE[code]) || 'failed'
}

export function parseReadyLine(line: string): SidecarReady | null {
  let event: Record<string, unknown> | null
  try {
    event = asRecord(JSON.parse(line))
  } catch {
    return null
  }
  if (event?.event !== 'ready' || event.protocol !== SIDECAR_PROTOCOL) return null
  const { port, token } = event
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) return null
  if (typeof token !== 'string' || token.length < 32) return null
  return { port, token }
}

function firstLine(proc: ChildProcess, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let buffered = ''
    const finish = (line: string | null): void => {
      clearTimeout(timer)
      proc.stdout?.off('data', onData)
      proc.off('exit', onExit)
      proc.off('error', onExit)
      resolve(line)
    }
    const onData = (chunk: Buffer): void => {
      buffered += chunk.toString('utf8')
      const end = buffered.indexOf('\n')
      if (end >= 0) finish(buffered.slice(0, end))
      else if (buffered.length > MAX_LINE_BYTES) finish(null)
    }
    const onExit = (): void => finish(null)
    const timer = setTimeout(() => finish(null), timeoutMs)
    proc.stdout?.on('data', onData)
    proc.once('exit', onExit)
    proc.once('error', onExit)
  })
}

function exitOf(proc: ChildProcess): Promise<number | null> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(proc.exitCode)
  return new Promise((resolve) => {
    proc.once('exit', (code) => resolve(code))
    proc.once('error', () => resolve(null))
  })
}

function exitsWithin(exited: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  return Promise.race([exited.then(() => true), late]).finally(() => clearTimeout(timer))
}

function stopper(
  proc: ChildProcess,
  exited: Promise<number | null>,
  graceMs: number
): () => Promise<void> {
  return async () => {
    proc.stdin?.end()
    if (!(await exitsWithin(exited, graceMs))) await killProcessTree(proc)
  }
}

export async function startSidecar(
  launch: SidecarLaunch,
  {
    spawnSidecar = spawn,
    readyTimeoutMs = READY_TIMEOUT_MS,
    stopGraceMs = STOP_GRACE_MS,
    signal
  }: {
    spawnSidecar?: SpawnSidecar
    readyTimeoutMs?: number
    stopGraceMs?: number
    signal?: AbortSignal
  } = {}
): Promise<SidecarStart> {
  if (signal?.aborted) return { ok: false, problem: 'failed' }
  const proc = spawnSidecar(launch.python, sidecarArgs(launch), {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
    detached: process.platform !== 'win32'
  })
  const exitCode = exitOf(proc)
  proc.stdin?.on('error', () => {})
  const stop = stopper(proc, exitCode, stopGraceMs)
  const onAbort = (): void => void stop()
  signal?.addEventListener('abort', onAbort, { once: true })
  const ready = parseReadyLine((await firstLine(proc, readyTimeoutMs)) ?? '')
  signal?.removeEventListener('abort', onAbort)
  if (!ready || signal?.aborted) {
    await stop()
    return { ok: false, problem: signal?.aborted ? 'failed' : problemForExit(proc.exitCode) }
  }
  proc.stdout?.resume()
  return {
    ok: true,
    sidecar: { ready, exited: exitCode.then(() => undefined), stop }
  }
}
