import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import { promises as fsp } from 'fs'

import { getEntryByInstallationId } from '../host/registry'
import type { InstallationRecord } from '../installations'
import {
  _getActiveLaunchIds,
  _getLaunchingInstances,
  _isStopping,
  _operationAborts,
  _runningSessions,
  type SessionInfo,
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
  installVersion,
  launchAppsBuild,
  launchConsole,
  planAppsBuild,
  reusableLocal
} from './appsBuild'
import {
  APPS_BUILD_NAME,
  type ComfyChoice,
  FREE_IDLE_MS,
  FREE_JSON,
  freeWait,
  isRunEnd,
  pickComfy,
  queueEmpty,
  type SetupEvent,
  shouldStopIdle,
  wantedVersion
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
  version?: string
  own?: boolean
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

interface Target {
  id: string
  name: string
  version: string | null
  own: boolean
}

let target: Target | null = null
const startedHere = new Set<string>()

function touch(): void {
  lastUse = Date.now()
}

function localSession(id: string): SessionInfo | null {
  const s = _runningSessions.get(id)
  return s && !s.url && s.port > 0 && (s.sourceInstallationId ?? id) === id ? s : null
}

export function appsRunning(): { id: string; name: string; port: number } | null {
  const id = target?.id ?? appsBuildId()
  const s = id ? localSession(id) : null
  return id && s ? { id, name: s.installationName, port: s.port } : null
}

export function ownInUse(): string | null {
  return target?.own ? (appsRunning()?.id ?? null) : null
}

function launching(id: string): boolean {
  return (
    _getLaunchingInstances().some((l) => l.installationId === id) ||
    _getActiveLaunchIds().includes(id)
  )
}

function busy(id: string, running: boolean): boolean {
  if (_isStopping(id)) return true
  if (running || startedHere.has(id)) return false
  return _operationAborts.has(id) || launching(id)
}

interface Candidate extends ComfyChoice {
  inst: InstallationRecord
  own: boolean
}

async function candidate(inst: InstallationRecord, own: boolean): Promise<Candidate> {
  const running = localSession(inst.id) !== null
  return {
    id: inst.id,
    inst,
    own,
    running,
    busy: busy(inst.id, running),
    version: await installVersion(inst)
  }
}

async function choose(min: string, apps: InstallationRecord | null): Promise<Candidate | null> {
  const own = await Promise.all((await reusableLocal()).map((inst) => candidate(inst, true)))
  const appsRunningNow = apps && localSession(apps.id) ? [await candidate(apps, false)] : []
  return pickComfy([...own, ...appsRunningNow], min, appsRunning()?.id)
}

function aimAt(pick: Candidate | null): void {
  target = pick ? { id: pick.id, name: pick.inst.name, version: pick.version, own: pick.own } : null
}

function shown(): Pick<LocalState, 'name' | 'version' | 'own'> {
  if (!target?.own) return {}
  return { name: target.name, own: true, ...(target.version ? { version: target.version } : {}) }
}

interface Current {
  state: LocalState
  pick: Candidate | null
}

async function currentState(want: unknown, adopt: boolean): Promise<Current> {
  const off = await appsLocalOff()
  if (off) return { state: { state: 'unsupported', error: off }, pick: null }
  const inst = await findApps()
  if (adopt) {
    const pick = await choose(wantedVersion(want), inst?.status === 'installed' ? inst : null)
    aimAt(pick)
    if (pick?.own && !pick.running) {
      const state = launching(pick.id) ? 'starting' : 'stopped'
      return { state: { state, ...shown() }, pick }
    }
  }
  const run = appsRunning()
  if (run) {
    return {
      state: { state: 'running', name: run.name, ...shown(), clientId: CLIENT_ID },
      pick: null
    }
  }
  if (target?.own) return { state: { state: 'starting', ...shown() }, pick: null }
  if (appsSetupRunning())
    return { state: { state: 'starting', name: APPS_BUILD_NAME, setup: true }, pick: null }
  if (!inst || inst.status !== 'installed') {
    const download = await planAppsBuild().then(
      (p) => p.bytes,
      () => 0
    )
    return {
      state: { state: 'none', name: APPS_BUILD_NAME, ...(download ? { download } : {}) },
      pick: null
    }
  }
  if (launching(inst.id)) return { state: { state: 'starting', name: inst.name }, pick: null }
  return { state: { state: 'stopped', name: inst.name }, pick: null }
}

export async function getLocal(want?: unknown): Promise<LocalState> {
  syncLocalSocket()
  const { state } = await currentState(want, !starting)
  syncLocalSocket()
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

async function untilAnswering(id: string, name: string | undefined): Promise<LocalState> {
  const deadline = Date.now() + COMFY_BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const run = appsRunning()
    if (run && (await answers(run.port))) {
      touch()
      syncLocalSocket()
      return { state: 'running', name: run.name, ...shown(), clientId: CLIENT_ID }
    }
    if (!run && !launching(id)) {
      return { state: 'stopped', name, ...shown(), error: 'ComfyUI stopped before it was ready.' }
    }
    await sleep(1000)
  }
  return { state: 'stopped', name, ...shown(), error: 'ComfyUI did not answer within 5 minutes.' }
}

function shortError(message: string | undefined): string {
  const line = (message ?? '').split('\n')[0]!.trim()
  return line ? line.slice(0, 200) : 'ComfyUI did not start.'
}

function sendSetup(event: SetupEvent): void {
  forward({ type: 'setup', data: event })
}

async function startOwn(inst: InstallationRecord): Promise<LocalState> {
  touch()
  if (!appsRunning() && !launching(inst.id)) {
    startedHere.add(inst.id)
    const result = await launchConsole(inst)
    if (!result.ok && !appsRunning()) {
      if (!localSession(inst.id) && !launching(inst.id)) startedHere.delete(inst.id)
      return { state: 'stopped', name: inst.name, ...shown(), error: shortError(result.message) }
    }
  }
  return untilAnswering(inst.id, inst.name)
}

async function start(want: unknown): Promise<LocalState> {
  const { state, pick } = await currentState(want, true)
  syncLocalSocket()
  if (state.state === 'unsupported' || state.state === 'running') return state
  if (pick?.own) return startOwn(pick.inst)
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
  return untilAnswering(inst.id, inst.name)
}

export function startLocal(want?: unknown): Promise<LocalState> {
  starting ??= start(want).finally(() => (starting = null))
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
  const installationId = appsRunning()?.id ?? target?.id ?? (await findApps())?.id
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

function startedByApps(): string[] {
  if (!starting) {
    for (const id of startedHere) {
      if (!localSession(id) && !launching(id)) startedHere.delete(id)
    }
  }
  const apps = appsBuildId()
  return [...(apps ? [apps] : []), ...[...startedHere].filter((id) => id !== apps)]
}

async function stopWhenIdle(): Promise<void> {
  for (const id of startedByApps()) {
    const s = localSession(id)
    if (!s) continue
    const entry = getEntryByInstallationId(id)
    const idle = shouldStopIdle({
      mode: s.mode,
      hasWindow: !!entry && !entry.window.isDestroyed(),
      lastUse,
      now: Date.now()
    })
    if (!idle) continue
    const seen = lastUse
    if (downloads.size > 0 || starting || !(await queueIsEmpty(s.port))) return touch()
    if (lastUse !== seen || downloads.size > 0 || starting) return
    await stopRunning(id)
    startedHere.delete(id)
  }
}

export function initLocalComfy(pages: () => WebContents[]): void {
  appsPages = pages
  sessionLifecycleEvents.on('changed', syncLocalSocket)
  setInterval(() => void stopWhenIdle(), IDLE_CHECK_MS).unref?.()
}
