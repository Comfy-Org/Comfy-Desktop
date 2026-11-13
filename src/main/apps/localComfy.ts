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
  reusableLocal,
  sharedInputDir
} from './appsBuild'
import {
  APPS_BUILD_NAME,
  APPS_BUILD_VERSION,
  type ComfyChoice,
  FREE_IDLE_MS,
  FREE_JSON,
  freeWait,
  isRunEnd,
  meetsMinimum,
  pickComfy,
  queueEmpty,
  reuseMinimum,
  type SetupEvent,
  shouldStopIdle,
  statsVersion,
  wantedVersion
} from './appsBuildRules'
import {
  AppsOwnership,
  type DownloadRequest,
  downloadRequest,
  endedRun,
  eventFiles,
  historyFiles,
  historyHas,
  type LocalAnswer,
  localEvent,
  type LocalRequest,
  localRequest,
  MAX_OWNED,
  MAX_UPLOAD_BYTES,
  noteRun,
  promptRunId,
  queueAnswer,
  queueIds,
  readCapped,
  reconnectDelay,
  requestFile,
  requestRuns,
  type RunSeen,
  textAnswer,
  uploadedFile,
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
const BUSY_ERROR =
  'ComfyUI on this computer is busy with another app. Run this one when it finishes.'
const NOT_APPS_RUN = 'Apps can only see and stop the runs they started.'
const NOT_APPS_FILE = 'Apps can only open files their runs made or they uploaded.'
const TOO_MANY_RUNS = `Apps already have ${MAX_OWNED.toLocaleString('en-US')} runs waiting on ComfyUI. Run this one when some finish.`

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
let selections = 0
const LAUNCHING = 'launching'
const startedHere = new Map<string, SessionInfo | typeof LAUNCHING>()
const owned = new AppsOwnership()
const sending = new Map<string, number>()
let sendsStarted = 0
const MAX_HELD_EVENTS = 500
const held: Array<{ id: string; msg: { type: string; data: unknown } }> = []

function submitting(id: string): boolean {
  return (sending.get(id) ?? 0) > 0
}

function markSending(id: string, step: 1 | -1): void {
  if (step > 0) sendsStarted++
  const left = (sending.get(id) ?? 0) + step
  if (left > 0) sending.set(id, left)
  else sending.delete(id)
}

function touch(): void {
  lastUse = Date.now()
}

function localSession(id: string): SessionInfo | null {
  const s = _runningSessions.get(id)
  return s && !s.url && s.port > 0 && (s.sourceInstallationId ?? id) === id ? s : null
}

interface Serving {
  id: string
  name: string
  port: number
}

function serving(id: string | null | undefined): Serving | null {
  const s = id ? localSession(id) : null
  return id && s ? { id, name: s.installationName, port: s.port } : null
}

function readsSharedInput(id: string): boolean {
  const session = localSession(id)
  return !session || session.inputDir === sharedInputDir()
}

function reusable(id: string): boolean {
  return id === appsBuildId() || readsSharedInput(id)
}

export function appsRunning(): Serving | null {
  if (target && !reusable(target.id)) target = null
  return serving(target?.id ?? appsBuildId())
}

function targetVersion(): string | null {
  return target ? target.version : APPS_BUILD_VERSION
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
  if (running) return _operationAborts.has(id)
  if (startedHere.has(id)) return false
  return _operationAborts.has(id) || launching(id)
}

interface Candidate extends ComfyChoice {
  inst: InstallationRecord
  own: boolean
}

async function servedVersion(port: number): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/system_stats`, {
      signal: AbortSignal.timeout(5000)
    })
    return res.ok ? statsVersion(await res.json()) : null
  } catch {
    return null
  }
}

async function candidate(inst: InstallationRecord, own: boolean): Promise<Candidate> {
  const session = localSession(inst.id)
  return {
    id: inst.id,
    inst,
    own,
    running: session !== null,
    busy: busy(inst.id, session !== null),
    version: session ? await servedVersion(session.port) : await installVersion(inst)
  }
}

async function choose(min: string, apps: InstallationRecord | null): Promise<Candidate | null> {
  const reusable = (await reusableLocal()).filter((inst) => readsSharedInput(inst.id))
  const own = await Promise.all(reusable.map((inst) => candidate(inst, true)))
  const appsRunningNow = apps && localSession(apps.id) ? [await candidate(apps, false)] : []
  return pickComfy([...own, ...appsRunningNow], reuseMinimum(min), appsRunning()?.id)
}

function aimAt(pick: Candidate | null): void {
  target = pick ? { id: pick.id, name: pick.inst.name, version: pick.version, own: pick.own } : null
}

function shown(): Pick<LocalState, 'name' | 'version' | 'own'> {
  if (!target?.own) return {}
  return { name: target.name, own: true, ...(target.version ? { version: target.version } : {}) }
}

function runningState(run: Serving): LocalState {
  return { state: 'running', name: run.name, ...shown(), clientId: CLIENT_ID }
}

function pickState(pick: Candidate): LocalState {
  return {
    state: launching(pick.id) ? 'starting' : 'stopped',
    name: pick.inst.name,
    ...(pick.own ? { own: true } : {}),
    ...(pick.own && pick.version ? { version: pick.version } : {})
  }
}

async function appsBuildState(inst: InstallationRecord | null): Promise<LocalState> {
  const run = target ? null : appsRunning()
  if (run) return runningState(run)
  if (appsSetupRunning()) return { state: 'starting', name: APPS_BUILD_NAME, setup: true }
  if (!inst || inst.status !== 'installed') {
    const download = await planAppsBuild().then(
      (p) => p.bytes,
      () => 0
    )
    return { state: 'none', name: APPS_BUILD_NAME, ...(download ? { download } : {}) }
  }
  if (launching(inst.id)) return { state: 'starting', name: inst.name }
  return { state: 'stopped', name: inst.name }
}

async function reportCurrent(inst: InstallationRecord | null): Promise<LocalState> {
  const run = appsRunning()
  if (run) return runningState(run)
  if (target?.own) return { state: 'starting', ...shown() }
  return appsBuildState(inst)
}

function busyState(): LocalState {
  return {
    state: 'stopped',
    name: appsRunning()?.name ?? APPS_BUILD_NAME,
    ...shown(),
    error: BUSY_ERROR
  }
}

function selectionCurrent(gen: number, forStart: boolean): boolean {
  return gen === selections && (forStart || !starting)
}

type Adoption = 'aimed' | 'stale' | 'busy'

async function adopt(pick: Candidate | null, gen: number, forStart: boolean): Promise<Adoption> {
  if (!selectionCurrent(gen, forStart)) return 'stale'
  const run = appsRunning()
  const moving = !!run && (pick?.id ?? appsBuildId()) !== run.id
  const sendsBefore = sendsStarted
  if (moving && (await appsWorkOn(run))) return 'busy'
  if (!selectionCurrent(gen, forStart)) return 'stale'
  if (moving && (submitting(run.id) || sendsStarted !== sendsBefore)) return 'busy'
  aimAt(pick)
  return 'aimed'
}

interface Current {
  state: LocalState
  pick: Candidate | null
}

async function currentState(want: unknown, forStart: boolean): Promise<Current> {
  const off = await appsLocalOff()
  if (off) return { state: { state: 'unsupported', error: off }, pick: null }
  const inst = await findApps()
  if (!forStart && starting) return { state: await reportCurrent(inst), pick: null }
  const gen = ++selections
  const pick = await choose(wantedVersion(want), inst?.status === 'installed' ? inst : null)
  if (forStart || pick?.running) {
    const adopted = await adopt(pick, gen, forStart)
    if (adopted === 'busy') return { state: busyState(), pick: null }
    if (adopted === 'stale') return { state: await reportCurrent(inst), pick: null }
  }
  const run = pick?.running ? serving(pick.id) : null
  if (run) return { state: runningState(run), pick }
  if (pick) return { state: pickState(pick), pick }
  return { state: await appsBuildState(inst), pick: null }
}

export async function getLocal(want?: unknown): Promise<LocalState> {
  syncLocalSocket()
  const { state } = await currentState(want, false)
  syncLocalSocket()
  return state.state === 'stopped' && starting && !state.error
    ? { ...state, state: 'starting' }
    : state
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
      return runningState(run)
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

function settleStarted(id: string): void {
  if (startedHere.get(id) !== LAUNCHING) return
  const s = localSession(id)
  if (s) startedHere.set(id, s)
  else if (!launching(id)) startedHere.delete(id)
}

function trackStarted(): void {
  for (const [id, owned] of startedHere) {
    const s = localSession(id)
    if (owned === LAUNCHING) {
      if (s) startedHere.set(id, s)
    } else if (s !== owned) {
      startedHere.delete(id)
    }
  }
}

async function startOwn(inst: InstallationRecord): Promise<LocalState> {
  touch()
  if (!appsRunning() && !launching(inst.id)) {
    startedHere.set(inst.id, LAUNCHING)
    const result = await launchConsole(inst)
    if (!result.ok && !appsRunning()) {
      settleStarted(inst.id)
      return { state: 'stopped', name: inst.name, ...shown(), error: shortError(result.message) }
    }
  }
  const state = await untilAnswering(inst.id, inst.name)
  settleStarted(inst.id)
  return state
}

async function start(want: unknown): Promise<LocalState> {
  const { state, pick } = await currentState(want, true)
  syncLocalSocket()
  if (state.state === 'unsupported' || state.state === 'running' || state.error) return state
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

export async function startLocal(want?: unknown): Promise<LocalState> {
  const min = wantedVersion(want)
  while (starting) {
    const shared = await starting
    if (shared.state !== 'running' || meetsMinimum(targetVersion(), min)) return shared
  }
  const mine: Promise<LocalState> = start(want).finally(() => {
    if (starting === mine) starting = null
  })
  starting = mine
  return mine
}

export function cancelSetup(): { cancelled: boolean } {
  return cancelAppsSetup()
}

function routeFor(runs: string[], file: string | null, page: number): Serving | null {
  const owner = runs.length
    ? owned.runOwner(runs[0]!)
    : file
      ? owned.fileOwner(page, file)
      : undefined
  return (owner && reusable(owner) ? serving(owner) : null) ?? appsRunning()
}

function noteOwned(
  req: LocalRequest,
  runs: string[],
  body: Uint8Array,
  owner: string,
  page: number
): void {
  if (req.kind === 'prompt') {
    const id = promptRunId(body)
    if (id) owned.addRun(id, owner, page)
    releaseHeld(owner)
  } else if (req.kind === 'upload') {
    const file = uploadedFile(body)
    if (file) owned.addUpload(page, file, owner)
  } else if (req.kind === 'get' && runs.length) {
    owned.addRunFiles(runs[0]!, page, historyFiles(body, runs[0]!))
    if (historyHas(body, runs[0]!)) owned.finish(runs[0]!)
  } else if (req.kind === 'json' && req.path === '/queue') {
    for (const id of runs) owned.finish(id)
  }
}

export async function localFetch(input: unknown, page = 0): Promise<LocalAnswer> {
  const req = localRequest(input)
  if (!('kind' in req)) return textAnswer(req.status, req.error)
  const runs = requestRuns(req)
  const file = requestFile(req)
  const run = routeFor(runs, file, page)
  if (!run) return textAnswer(503, 'ComfyUI for apps is not running on this computer.')
  const personal = run.id !== appsBuildId()
  if (personal && runs.some((id) => owned.runOwner(id) !== run.id)) {
    return textAnswer(403, NOT_APPS_RUN)
  }
  if (personal && file && owned.fileOwner(page, file) !== run.id) {
    return textAnswer(403, NOT_APPS_FILE)
  }
  if (req.kind !== 'prompt') return send(req, runs, run, personal, page)
  markSending(run.id, 1)
  try {
    if (owned.full()) await settleDropped()
    if (owned.full()) return textAnswer(429, TOO_MANY_RUNS)
    return await send(req, runs, run, personal, page)
  } finally {
    markSending(run.id, -1)
    releaseHeld(run.id)
  }
}

async function send(
  req: LocalRequest,
  runs: string[],
  run: Serving,
  personal: boolean,
  page: number
): Promise<LocalAnswer> {
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
        ? { method: 'POST', body: uploadForm(req.bytes, req.fileName, !personal), signal }
        : { method: 'GET', signal }
  try {
    const res = await fetch(`http://127.0.0.1:${run.port}${req.path}`, init)
    const body = await readCapped(res, MAX_UPLOAD_BYTES)
    if (!body) return textAnswer(502, 'ComfyUI answered more than 50 MB.')
    if (req.kind === 'queue') {
      const ours = personal ? (id: string) => owned.runOwner(id) === run.id : undefined
      return queueAnswer(res.status, body, runsSeen, ours)
    }
    if (res.ok) noteOwned(req, runs, body, run.id, page)
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

async function liveRuns(port: number): Promise<Set<string> | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/queue`, {
      signal: AbortSignal.timeout(5000)
    })
    return res.ok ? queueIds(await res.json()) : null
  } catch {
    return null
  }
}

async function appsWorkOn(run: Serving): Promise<boolean> {
  if (downloads.size > 0 || submitting(run.id)) return true
  const ids = owned.runsOn(run.id)
  if (!ids.length) return false
  const live = await liveRuns(run.port)
  if (!live) return localSession(run.id) !== null
  return ids.some((id) => live.has(id))
}

async function settleDropped(): Promise<void> {
  await Promise.all(
    [...owned.unfinished()].map(async ([owner, ids]) => {
      const on = serving(owner)
      const live = on ? await liveRuns(on.port) : null
      if (live) for (const id of ids) if (!live.has(id)) owned.finish(id)
    })
  )
}

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
  id: string
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
    noteMade(msg)
    if (isRunEnd(msg.type)) scheduleFree(s.port)
    if (pageMaySee(s.id, msg)) forward(msg)
    else if (submitting(s.id)) hold(s.id, msg)
  }
  ws.onerror = () => {}
  ws.onclose = () => {
    if (s.closed) return
    s.ws = null
    s.timer = setTimeout(() => connect(s), reconnectDelay(s.attempt++))
  }
}

function pageMaySee(id: string, msg: { type: string; data: unknown }): boolean {
  if (id === appsBuildId() || msg.type === 'status') return true
  const runId = (msg.data as { prompt_id?: unknown } | null)?.prompt_id
  return typeof runId === 'string' && owned.runOwner(runId) === id
}

function hold(id: string, msg: { type: string; data: unknown }): void {
  held.push({ id, msg })
  if (held.length > MAX_HELD_EVENTS) held.shift()
}

function releaseHeld(id: string): void {
  const waiting = submitting(id)
  const kept = held.filter((h) => {
    if (h.id !== id) return true
    if (pageMaySee(id, h.msg)) forward(h.msg)
    else return waiting
    return false
  })
  held.splice(0, held.length, ...kept)
}

function noteMade(msg: { type: string; data: unknown }): void {
  const made = eventFiles(msg)
  if (made) owned.addRunFiles(made.runId, null, made.files)
  const ended = endedRun(msg)
  if (ended) owned.finish(ended)
}

function closeSocket(): void {
  if (!socket) return
  socket.closed = true
  if (socket.timer) clearTimeout(socket.timer)
  socket.ws?.close()
  socket = null
  runsSeen.clear()
  held.length = 0
}

export function syncLocalSocket(): void {
  const run = appsPages().length ? appsRunning() : null
  if (socket && run && socket.port === run.port && socket.id === run.id) return
  closeSocket()
  if (!run) return
  socket = { id: run.id, port: run.port, ws: null, timer: null, attempt: 0, closed: false }
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
  const apps = appsBuildId()
  return [...(apps ? [apps] : []), ...[...startedHere.keys()].filter((id) => id !== apps)]
}

function appsSession(id: string): SessionInfo | null {
  const s = localSession(id)
  if (!s || id === appsBuildId()) return s
  return startedHere.get(id) === s ? s : null
}

async function stopWhenIdle(): Promise<void> {
  for (const id of startedByApps()) {
    const s = appsSession(id)
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
    if (lastUse !== seen || downloads.size > 0 || starting || appsSession(id) !== s) return
    await stopRunning(id)
    startedHere.delete(id)
  }
}

export function initLocalComfy(pages: () => WebContents[]): void {
  appsPages = pages
  sessionLifecycleEvents.on('changed', () => {
    trackStarted()
    owned.finishAll((id) => localSession(id) !== null)
    syncLocalSocket()
  })
  setInterval(() => void stopWhenIdle(), IDLE_CHECK_MS).unref?.()
}
