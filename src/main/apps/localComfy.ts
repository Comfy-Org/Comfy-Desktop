import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import { promises as fsp } from 'fs'
import os from 'os'

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
import { detectGPUCached } from '../lib/gpu'
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
  reusableLocal,
  SetupCancelled
} from './appsBuild'
import { comfyVersionOf, computerOf, errorClassOf, trackApps } from './appEvents'
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
  localAppId,
  localEvent,
  localRequest,
  MAX_UPLOAD_BYTES,
  noteRun,
  promptIdOf,
  queueAnswer,
  readCapped,
  reconnectDelay,
  type RunEnd,
  runEnd,
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

interface LocalRun {
  app: string
  installId: string
  comfy: 'own' | 'apps_build'
  version: string | null
  submittedAt: number
}

const MAX_LOCAL_RUNS = 50
const localRuns = new Map<string, LocalRun>()

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

function localRunFailed(
  app: string | null,
  step: 'setup' | 'start_comfy' | 'model_download',
  err?: unknown
): void {
  if (!app) return
  const errorClass = err === undefined ? undefined : errorClassOf(err)
  trackApps('run_failed', {
    app,
    where: 'local',
    step,
    ...(errorClass ? { error_class: errorClass } : {})
  })
}

function startFailed(app: string | null, state: LocalState): LocalState {
  localRunFailed(app, 'start_comfy')
  return state
}

async function answered(app: string | null, id: string, name: string): Promise<LocalState> {
  const state = await untilAnswering(id, name)
  return state.state === 'running' ? state : startFailed(app, state)
}

async function startOwn(inst: InstallationRecord, app: string | null): Promise<LocalState> {
  touch()
  if (!appsRunning() && !launching(inst.id)) {
    startedHere.add(inst.id)
    const result = await launchConsole(inst)
    if (!result.ok && !appsRunning()) {
      if (!localSession(inst.id) && !launching(inst.id)) startedHere.delete(inst.id)
      return startFailed(app, {
        state: 'stopped',
        name: inst.name,
        ...shown(),
        error: shortError(result.message)
      })
    }
  }
  return answered(app, inst.id, inst.name)
}

async function start(want: unknown, app: string | null): Promise<LocalState> {
  const { state, pick } = await currentState(want, true)
  syncLocalSocket()
  if (state.state === 'unsupported' || state.state === 'running') return state
  if (pick?.own) return startOwn(pick.inst, app)
  let inst: InstallationRecord
  try {
    inst = await ensureAppsBuild(sendSetup, app)
  } catch (err) {
    if (!(err instanceof SetupCancelled)) localRunFailed(app, 'setup', err)
    return { state: 'none', name: APPS_BUILD_NAME, error: shortError((err as Error)?.message) }
  }
  touch()
  if (!appsRunning() && !launching(inst.id)) {
    const result = await launchAppsBuild(inst)
    if (!result.ok && !appsRunning()) {
      return startFailed(app, {
        state: 'stopped',
        name: inst.name,
        error: shortError(result.message)
      })
    }
  }
  return answered(app, inst.id, inst.name)
}

export function startLocal(want?: unknown, app: string | null = null): Promise<LocalState> {
  starting ??= start(want, app).finally(() => (starting = null))
  return starting
}

export function cancelSetup(): { cancelled: boolean } {
  return cancelAppsSetup()
}

function rememberRun(id: string, app: string, installId: string): void {
  const own = target?.own === true && target.id === installId
  localRuns.delete(id)
  localRuns.set(id, {
    app,
    installId,
    comfy: own ? 'own' : 'apps_build',
    version: target?.id === installId ? target.version : null,
    submittedAt: Date.now()
  })
  for (const old of localRuns.keys()) {
    if (localRuns.size <= MAX_LOCAL_RUNS) break
    localRuns.delete(old)
  }
}

async function comfyVersion(run: LocalRun): Promise<string | undefined> {
  if (run.version) return comfyVersionOf(run.version)
  if (run.comfy === 'own') return undefined
  const inst = await findApps()
  return comfyVersionOf(inst ? await installVersion(inst) : null)
}

async function reportRunFinished(
  run: LocalRun,
  end: RunEnd,
  startedAt: number | undefined,
  now: number
): Promise<void> {
  const [gpu, version] = await Promise.all([
    detectGPUCached().catch(() => null),
    comfyVersion(run).catch(() => undefined)
  ])
  const hardware = localSession(run.installId)?.getAcceleratorInfo?.() ?? null
  const errorClass = end.exceptionType ? errorClassOf(end.exceptionType) : undefined
  trackApps('run_finished', {
    app: run.app,
    where: 'local',
    outcome: end.outcome,
    run_seconds: Math.max(0, now - (startedAt ?? run.submittedAt)) / 1000,
    ...(startedAt !== undefined
      ? { queue_seconds: Math.max(0, startedAt - run.submittedAt) / 1000 }
      : {}),
    ...(errorClass ? { error_class: errorClass } : {}),
    comfy: run.comfy,
    ...(version ? { comfy_version: version } : {}),
    ...computerOf(gpu?.id, hardware?.vramMb, hardware?.ramMb ?? os.totalmem() / 1024 / 1024),
    os: process.platform
  })
}

function finishRun(msg: { type: string; data: unknown }, now: number): void {
  const end = runEnd(msg)
  const run = end ? localRuns.get(end.id) : undefined
  if (!end || !run) return
  localRuns.delete(end.id)
  void reportRunFinished(run, end, runsSeen.get(end.id)?.startedAt, now).catch(() => {})
}

export async function localFetch(input: unknown, app: string | null = null): Promise<LocalAnswer> {
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
    if (req.kind === 'prompt' && res.ok) {
      const id = promptIdOf(body)
      const runApp = localAppId(req.json) ?? app
      if (id && runApp) rememberRun(id, runApp, run.id)
    }
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

function trackDownload(
  app: string | null,
  req: DownloadRequest,
  outcome: 'started' | 'finished' | 'failed',
  startedAt: number,
  bytes = 0
): void {
  trackApps('setup', {
    ...(app ? { app } : {}),
    stage: 'model',
    outcome,
    model_file: req.name,
    ...(bytes > 0 ? { bytes } : {}),
    ...(outcome === 'started' ? {} : { seconds: (Date.now() - startedAt) / 1000 })
  })
}

async function runDownload(
  installationId: string,
  req: DownloadRequest,
  app: string | null
): Promise<LocalDownload> {
  const startedAt = Date.now()
  let done = 0
  let total = 0
  let moved = false
  const send = (state: 'running' | 'done' | 'failed', error?: string) =>
    forward({
      type: 'download',
      data: { ...req, done, total, state, ...(error ? { error } : {}) }
    })
  const stopped = (error: string): LocalDownload => {
    send('failed', error)
    return { state: 'failed', error }
  }
  const failed = (error: string): LocalDownload => {
    trackDownload(app, req, 'failed', startedAt, done)
    localRunFailed(app, 'model_download')
    return stopped(error)
  }
  trackDownload(app, req, 'started', startedAt)
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
  if (outcome.status === 'cancelled') return stopped('The download was cancelled.')
  if (outcome.status === 'error') return failed(shortError(outcome.error))
  const size = await fsp.stat(outcome.savePath).then(
    (st) => st.size,
    () => total
  )
  done = total = size
  trackDownload(app, req, 'finished', startedAt, size)
  send('done')
  return { state: 'done' }
}

export async function localDownload(
  input: unknown,
  app: string | null = null
): Promise<LocalDownload> {
  const req = downloadRequest(input)
  if ('error' in req) return { state: 'failed', error: req.error }
  const installationId = appsRunning()?.id ?? target?.id ?? (await findApps())?.id
  if (!installationId) return { state: 'failed', error: 'Start ComfyUI for apps first.' }
  touch()
  const key = [installationId, req.url, req.folder, req.name].join('\n')
  let job = downloads.get(key)
  if (!job) {
    job = runDownload(installationId, req, app).finally(() => downloads.delete(key))
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
    const now = Date.now()
    finishRun(msg, now)
    noteRun(runsSeen, msg, now)
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
  localRuns.clear()
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
