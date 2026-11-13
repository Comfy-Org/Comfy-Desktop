import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import { promises as fsp } from 'fs'

import { getEntryByInstallationId } from '../host/registry'
import type { InstallationRecord } from '../installations'
import {
  _getActiveLaunchIds,
  _getLaunchingInstances,
  _runningSessions,
  sessionLifecycleEvents,
  stopRunning
} from '../lib/ipc/shared'
import { startManagedModelJob } from '../lib/comfyDownloadManager'
import { COMFY_BOOT_TIMEOUT_MS } from '../lib/process'
import {
  appsBuildId,
  appsLocalOff,
  appsSetupRunning,
  cancelAppsSetup,
  ensureAppsBuild,
  findApps,
  launchAppsBuild,
  planAppsBuild
} from './appsBuild'
import {
  APPS_BUILD_NAME,
  FREE_IDLE_MS,
  FREE_JSON,
  freeWait,
  isRunEnd,
  queueEmpty,
  type SetupEvent,
  shouldStopIdle
} from './appsBuildRules'
import {
  type DownloadRequest,
  downloadRequest,
  type LocalAnswer,
  localEvent,
  localRequest,
  MAX_UPLOAD_BYTES,
  noteRun,
  queueAnswer,
  readCapped,
  reconnectDelay,
  type RunSeen,
  textAnswer,
  uploadForm
} from './guards'

export interface LocalState {
  state: 'running' | 'starting' | 'stopped' | 'none' | 'unsupported'
  name?: string
  clientId?: string
  error?: string
  setup?: boolean
  download?: number
}

export const LOCAL_EVENT_CHANNEL = 'comfy-apps:local-event'

const CLIENT_ID = randomUUID()
const FETCH_TIMEOUT_MS = 60_000
const IDLE_CHECK_MS = 60_000

let appsPages: () => WebContents[] = () => []
let starting: Promise<LocalState> | null = null
let lastUse = Date.now()
const runsSeen = new Map<string, RunSeen>()

function touch(): void {
  lastUse = Date.now()
}

export function appsRunning(): { id: string; name: string; port: number } | null {
  const id = appsBuildId()
  const s = id ? _runningSessions.get(id) : undefined
  return id && s && !s.url && s.port > 0 ? { id, name: s.installationName, port: s.port } : null
}

function launching(id: string): boolean {
  return (
    _getLaunchingInstances().some((l) => l.installationId === id) ||
    _getActiveLaunchIds().includes(id)
  )
}

async function currentState(): Promise<{ state: LocalState; install?: InstallationRecord }> {
  const off = await appsLocalOff()
  if (off) return { state: { state: 'unsupported', error: off } }
  const inst = await findApps()
  const run = appsRunning()
  if (run) {
    return {
      state: { state: 'running', name: run.name, clientId: CLIENT_ID },
      ...(inst ? { install: inst } : {})
    }
  }
  if (appsSetupRunning())
    return { state: { state: 'starting', name: APPS_BUILD_NAME, setup: true } }
  if (!inst || inst.status !== 'installed') {
    const download = await planAppsBuild().then(
      (p) => p.bytes,
      () => 0
    )
    return { state: { state: 'none', name: APPS_BUILD_NAME, ...(download ? { download } : {}) } }
  }
  if (launching(inst.id)) return { state: { state: 'starting', name: inst.name }, install: inst }
  return { state: { state: 'stopped', name: inst.name }, install: inst }
}

export async function getLocal(): Promise<LocalState> {
  syncLocalSocket()
  const { state } = await currentState()
  return state.state === 'stopped' && starting ? { ...state, state: 'starting' } : state
}

async function answers(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/system_stats`, {
      signal: AbortSignal.timeout(5000)
    })
    await res.body?.cancel().catch(() => {})
    return res.ok
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function untilAnswering(name: string | undefined): Promise<LocalState> {
  const deadline = Date.now() + COMFY_BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const run = appsRunning()
    if (run && (await answers(run.port))) {
      touch()
      syncLocalSocket()
      return { state: 'running', name: run.name, clientId: CLIENT_ID }
    }
    if (!run) {
      const { state } = await currentState()
      if (state.state !== 'starting') {
        return { state: 'stopped', name, error: 'ComfyUI stopped before it was ready.' }
      }
    }
    await sleep(1000)
  }
  return { state: 'stopped', name, error: 'ComfyUI did not answer within 5 minutes.' }
}

function shortError(message: string | undefined): string {
  const line = (message ?? '').split('\n')[0]!.trim()
  return line ? line.slice(0, 200) : 'ComfyUI did not start.'
}

function sendSetup(event: SetupEvent): void {
  forward({ type: 'setup', data: event })
}

async function start(): Promise<LocalState> {
  const { state } = await currentState()
  if (state.state === 'unsupported' || state.state === 'running') return state
  let inst: InstallationRecord
  try {
    inst = await ensureAppsBuild(sendSetup)
  } catch (err) {
    return { state: 'none', name: APPS_BUILD_NAME, error: shortError((err as Error)?.message) }
  }
  touch()
  if (!appsRunning() && !launching(inst.id)) {
    const result = await launchAppsBuild(inst)
    if (!result.ok && !appsRunning()) {
      return { state: 'stopped', name: inst.name, error: shortError(result.message) }
    }
  }
  return untilAnswering(inst.name)
}

export function startLocal(): Promise<LocalState> {
  starting ??= start().finally(() => (starting = null))
  return starting
}

export function cancelSetup(): { cancelled: boolean } {
  return cancelAppsSetup()
}

export async function localFetch(input: unknown): Promise<LocalAnswer> {
  const req = localRequest(input)
  if (!('kind' in req)) return textAnswer(req.status, req.error)
  const run = appsRunning()
  if (!run) return textAnswer(503, 'ComfyUI for apps is not running on this computer.')
  touch()
  syncLocalSocket()
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  const init: RequestInit =
    req.kind === 'prompt' || req.kind === 'json'
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: req.json,
          signal
        }
      : req.kind === 'upload'
        ? { method: 'POST', body: uploadForm(req.bytes, req.fileName), signal }
        : { method: 'GET', signal }
  try {
    const res = await fetch(`http://127.0.0.1:${run.port}${req.path}`, init)
    const body = await readCapped(res, MAX_UPLOAD_BYTES)
    if (!body) return textAnswer(502, 'ComfyUI answered more than 50 MB.')
    if (req.kind === 'queue') return queueAnswer(res.status, body, runsSeen)
    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      body
    }
  } catch (err) {
    return (err as Error)?.name === 'TimeoutError'
      ? textAnswer(504, 'ComfyUI took too long to answer.')
      : textAnswer(502, 'ComfyUI did not answer.')
  }
}

export type LocalDownload = { state: 'done' } | { state: 'failed'; error: string }

const downloads = new Map<string, Promise<LocalDownload>>()

async function runDownload(installationId: string, req: DownloadRequest): Promise<LocalDownload> {
  let done = 0
  let total = 0
  let moved = false
  const send = (state: 'running' | 'done' | 'failed', error?: string) =>
    forward({
      type: 'download',
      data: { ...req, done, total, state, ...(error ? { error } : {}) }
    })
  const failed = (error: string): LocalDownload => {
    send('failed', error)
    return { state: 'failed', error }
  }
  const handle = await startManagedModelJob({
    url: req.url,
    filename: req.name,
    directory: req.folder,
    installationId,
    onProgress: (received, size) => {
      done = received
      total = size
      moved = true
    }
  }).catch(() => null)
  if (!handle) return failed('Desktop could not start the download.')
  const timer = setInterval(() => {
    if (!moved) return
    moved = false
    send('running')
  }, 250)
  let outcome: Awaited<typeof handle.completion>
  try {
    outcome = await handle.completion
  } finally {
    clearInterval(timer)
    handle.release()
  }
  if (outcome.status === 'cancelled') return failed('The download was cancelled.')
  if (outcome.status === 'error') return failed(shortError(outcome.error))
  const size = await fsp.stat(outcome.savePath).then(
    (st) => st.size,
    () => total
  )
  done = total = size
  send('done')
  return { state: 'done' }
}

export async function localDownload(input: unknown): Promise<LocalDownload> {
  const req = downloadRequest(input)
  if ('error' in req) return { state: 'failed', error: req.error }
  const installationId = appsRunning()?.id ?? (await findApps())?.id
  if (!installationId) return { state: 'failed', error: 'Start ComfyUI for apps first.' }
  touch()
  const key = [installationId, req.url, req.folder, req.name].join('\n')
  let job = downloads.get(key)
  if (!job) {
    job = runDownload(installationId, req).finally(() => downloads.delete(key))
    downloads.set(key, job)
  }
  return job
}

interface Socket {
  port: number
  ws: WebSocket | null
  timer: ReturnType<typeof setTimeout> | null
  attempt: number
  closed: boolean
}

let socket: Socket | null = null

function forward(msg: { type: string; data: unknown }): void {
  for (const wc of appsPages()) {
    if (!wc.isDestroyed()) wc.send(LOCAL_EVENT_CHANNEL, msg)
  }
}

function connect(s: Socket): void {
  if (s.closed) return
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?clientId=${CLIENT_ID}`)
  ws.binaryType = 'arraybuffer'
  s.ws = ws
  ws.onopen = () => {
    s.attempt = 0
  }
  ws.onmessage = (ev) => {
    const msg = localEvent(ev.data)
    if (!msg) return
    touch()
    noteRun(runsSeen, msg, Date.now())
    if (isRunEnd(msg.type)) scheduleFree(s.port)
    forward(msg)
  }
  ws.onerror = () => {}
  ws.onclose = () => {
    if (s.closed) return
    s.ws = null
    s.timer = setTimeout(() => connect(s), reconnectDelay(s.attempt++))
  }
}

function closeSocket(): void {
  if (!socket) return
  socket.closed = true
  if (socket.timer) clearTimeout(socket.timer)
  socket.ws?.close()
  socket = null
  runsSeen.clear()
}

export function syncLocalSocket(): void {
  const run = appsPages().length ? appsRunning() : null
  if (socket && run && socket.port === run.port) return
  closeSocket()
  if (!run) return
  socket = { port: run.port, ws: null, timer: null, attempt: 0, closed: false }
  connect(socket)
}

async function queueIsEmpty(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/prompt`, {
      signal: AbortSignal.timeout(5000)
    })
    return res.ok && queueEmpty(await res.json())
  } catch {
    return false
  }
}

export async function freeIfDone(port: number): Promise<boolean> {
  const seen = lastUse
  if (appsRunning()?.port !== port || !(await queueIsEmpty(port))) return false
  if (lastUse !== seen || appsRunning()?.port !== port) return false
  try {
    const res = await fetch(`http://127.0.0.1:${port}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: FREE_JSON,
      signal: AbortSignal.timeout(10_000)
    })
    await res.body?.cancel().catch(() => {})
    return res.ok
  } catch {
    return false
  }
}

let freeTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFree(port: number, wait = FREE_IDLE_MS): void {
  if (freeTimer) clearTimeout(freeTimer)
  freeTimer = setTimeout(() => {
    freeTimer = null
    const left = freeWait(lastUse, Date.now())
    if (left > 0) return scheduleFree(port, left)
    void freeIfDone(port)
  }, wait)
}

async function stopWhenIdle(): Promise<void> {
  const run = appsRunning()
  if (!run) return
  const entry = getEntryByInstallationId(run.id)
  const idle = shouldStopIdle({
    mode: _runningSessions.get(run.id)?.mode ?? '',
    hasWindow: !!entry && !entry.window.isDestroyed(),
    lastUse,
    now: Date.now()
  })
  if (!idle) return
  const seen = lastUse
  if (downloads.size > 0 || starting || !(await queueIsEmpty(run.port))) return touch()
  if (lastUse !== seen || downloads.size > 0 || starting) return
  await stopRunning(run.id)
}

export function initLocalComfy(pages: () => WebContents[]): void {
  appsPages = pages
  sessionLifecycleEvents.on('changed', syncLocalSocket)
  setInterval(() => void stopWhenIdle(), IDLE_CHECK_MS).unref?.()
}
