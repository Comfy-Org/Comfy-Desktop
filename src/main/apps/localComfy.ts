/**
 * The person's own ComfyUI, the one Desktop runs on this computer, for the Apps page.
 *
 * Desktop starts a local ComfyUI only when the person opens an install (or has "open on
 * startup" set); it listens on 127.0.0.1 at the install's --port, 8188 unless taken. The
 * page asks main for it, main checks each request (guards.ts `localRequest`) and calls it;
 * the page never gets the port. Main also keeps one websocket to it under its own client
 * id and passes the run messages on to the Apps view; the page sends that id as `client_id`
 * on /prompt, which is how ComfyUI knows where a run's progress goes.
 */
import { randomUUID } from 'crypto'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { promises as fsp } from 'fs'

import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import {
  _getActiveLaunchIds,
  _getLaunchingInstances,
  _runningSessions,
  sessionLifecycleEvents,
  sourceMap
} from '../lib/ipc/shared'
import { dispatchSessionAction } from '../lib/ipc/sessionActions'
import { startManagedModelJob } from '../lib/comfyDownloadManager'
import { COMFY_BOOT_TIMEOUT_MS } from '../lib/process'
import {
  type DownloadRequest,
  downloadRequest,
  type LocalAnswer,
  localEvent,
  localInstalls,
  localRequest,
  MAX_UPLOAD_BYTES,
  readCapped,
  reconnectDelay,
  textAnswer,
  uploadForm
} from './guards'

export interface LocalState {
  state: 'running' | 'starting' | 'stopped' | 'none'
  name?: string
  clientId?: string
  error?: string
}

export const LOCAL_EVENT_CHANNEL = 'comfy-apps:local-event'

/** One id for this Desktop run; it stays the same across reconnects so a run's messages keep arriving. */
const CLIENT_ID = randomUUID()
const FETCH_TIMEOUT_MS = 60_000

let appsPages: () => WebContents[] = () => []
let starting: Promise<LocalState> | null = null

/** A local ComfyUI Desktop launched and that answers on its port; the newest when several run. */
function runningLocal(): { id: string; name: string; port: number } | null {
  let best: { id: string; name: string; port: number; startedAt: number } | null = null
  for (const [key, s] of _runningSessions) {
    // Remote and Cloud sessions have a URL; legacy Desktop ones have no port; a Performance
    // Test runs under its own session key and is left alone.
    if (s.url || !(s.port > 0) || (s.sourceInstallationId ?? key) !== key) continue
    if (!best || s.startedAt > best.startedAt) {
      best = { id: key, name: s.installationName, port: s.port, startedAt: s.startedAt }
    }
  }
  return best && { id: best.id, name: best.name, port: best.port }
}

function categoryOf(inst: InstallationRecord): string | undefined {
  return sourceMap[inst.sourceId]?.category
}

/** What runs here now, without counting a start this file is making itself. */
async function currentState(): Promise<{ state: LocalState; install?: InstallationRecord }> {
  const run = runningLocal()
  if (run) return { state: { state: 'running', name: run.name, clientId: CLIENT_ID } }
  const installs = localInstalls(await installations.list(), categoryOf)
  if (!installs.length) return { state: { state: 'none' } }
  const busy = new Set([
    ..._getLaunchingInstances().map((l) => l.installationId),
    ..._getActiveLaunchIds()
  ])
  const launching = installs.find((inst) => busy.has(inst.id))
  if (launching) return { state: { state: 'starting', name: launching.name }, install: launching }
  return { state: { state: 'stopped', name: installs[0]!.name }, install: installs[0] }
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

/** Wait for the local ComfyUI to answer /system_stats, or for its launch to end without one. */
async function untilAnswering(name: string | undefined): Promise<LocalState> {
  const deadline = Date.now() + COMFY_BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const run = runningLocal()
    if (run && (await answers(run.port))) {
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

/** A launch's message cut to its first line, short enough for the page to show. */
function shortError(message: string | undefined): string {
  const line = (message ?? '').split('\n')[0]!.trim()
  return line ? line.slice(0, 200) : 'ComfyUI did not start.'
}

/**
 * Start the default local install the way the dashboard's Launch does: the same `launch`
 * session action, without the renderer's checks before it (the "another instance is running"
 * question cannot come up, since a running one is returned instead; a port held by another
 * program fails here with Desktop's own message unless the install bumps ports, the default).
 * The dashboard marks the install as starting; when ComfyUI answers, Desktop opens it in its
 * own window, as it does after every launch. No progress window shows while it boots.
 */
async function start(): Promise<LocalState> {
  const { state, install } = await currentState()
  if (state.state === 'none') return state
  if (state.state === 'stopped' && install) {
    // Launch progress goes to the renderers by broadcast; the per-call sender has no one to tell.
    const sender = { isDestroyed: () => false, send: () => {} } as unknown as WebContents
    const event = { sender } as unknown as IpcMainInvokeEvent
    const result = await dispatchSessionAction(
      { event, installationId: install.id, inst: install },
      'launch'
    ).catch((err: unknown) => ({ ok: false, message: (err as Error)?.message }))
    if (!result.ok && !runningLocal()) {
      return { state: 'stopped', name: install.name, error: shortError(result.message) }
    }
  }
  return untilAnswering(state.name)
}

export function startLocal(): Promise<LocalState> {
  starting ??= start().finally(() => (starting = null))
  return starting
}

/** One checked call to the local ComfyUI; refusals and failures come back as a status, not a throw. */
export async function localFetch(input: unknown): Promise<LocalAnswer> {
  const req = localRequest(input)
  if (!('kind' in req)) return textAnswer(req.status, req.error)
  const run = runningLocal()
  if (!run) return textAnswer(503, 'ComfyUI is not running on this computer.')
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

// ---- models: fetched by Desktop's own model downloader into the install's models folder ----

export type LocalDownload = { state: 'done' } | { state: 'failed'; error: string }

/** Downloads this file started, by install, source and target; a second ask joins the first. */
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
  // The same job the Downloads tray shows: the install's models folder (its extra model paths
  // count as already there), a .part file renamed into place when complete, one transfer per
  // target file however many ask.
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
  // At most four progress messages a second.
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

/**
 * Put a model the page names into the local install's models folder; resolves when the file is
 * there. The install is the running one, else the one startLocal would start: the models
 * folder comes from the install's settings, so ComfyUI need not be running.
 */
export async function localDownload(input: unknown): Promise<LocalDownload> {
  const req = downloadRequest(input)
  if ('error' in req) return { state: 'failed', error: req.error }
  const installationId = runningLocal()?.id ?? (await currentState()).install?.id
  if (!installationId) return { state: 'failed', error: 'Start your ComfyUI first.' }
  const key = [installationId, req.url, req.folder, req.name].join('\n')
  let job = downloads.get(key)
  if (!job) {
    job = runDownload(installationId, req).finally(() => downloads.delete(key))
    downloads.set(key, job)
  }
  return job
}

// ---- the websocket: open while a local ComfyUI runs and an Apps view is open ----

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
    if (msg) forward(msg)
  }
  // A failed connect also closes; reconnect from there.
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
}

/** Open, move or close the websocket to match what runs now and whether an Apps view is open. */
export function syncLocalSocket(): void {
  const run = appsPages().length ? runningLocal() : null
  if (socket && run && socket.port === run.port) return
  closeSocket()
  if (!run) return
  socket = { port: run.port, ws: null, timer: null, attempt: 0, closed: false }
  connect(socket)
}

/** `pages` lists the Apps views on the apps origin, the only ones that get local events. */
export function initLocalComfy(pages: () => WebContents[]): void {
  appsPages = pages
  sessionLifecycleEvents.on('changed', syncLocalSocket)
}
