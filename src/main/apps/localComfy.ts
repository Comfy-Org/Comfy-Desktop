import type { IpcMainInvokeEvent, WebContents } from 'electron'

import type {
  ComfyDesktopLocalAnswer,
  ComfyDesktopLocalComfy,
  ComfyDesktopLocalDownload,
  ComfyDesktopLocalEvent
} from '../../types/comfyDesktopBridge'
import { getEntryByInstallationId } from '../host/registry'
import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import { startManagedModelJob } from '../lib/comfyDownloadManager'
import { probeQueue } from '../lib/comfyProcessRecord'
import type { QueueAnswer } from '../lib/comfyProcessRecord'
import { recordCrash } from '../lib/crashBuffer'
import * as i18n from '../lib/i18n'
import { handleLaunch } from '../lib/ipc/sessionActions/launch'
import type { ActionResult } from '../lib/ipc/sessionActions/types'
import {
  _broadcastToRenderer,
  _hasActiveLaunch,
  _runningSessions,
  sessionLifecycleEvents,
  stopRunning
} from '../lib/ipc/shared'
import { COMFY_BOOT_TIMEOUT_MS } from '../lib/process'
import { liveAppsPages } from './appsPages'
import {
  chooseInstallingBuild,
  chooseLocalBuild,
  installingLocalBuilds,
  isStillInstalling,
  modelTargetOf,
  pickedBuild,
  runningPortOf,
  usableLocalBuilds,
  wantedVersion
} from './localBuild'
import type { LocalBuild, LocalChoice } from './localBuild'
import {
  outputFileKey,
  outputFilesOf,
  queueViewOf,
  readLocalCall,
  UPLOAD_SUBFOLDER
} from './localCalls'
import type { LocalCall } from './localCalls'
import { readModelRequest } from './localModelRequest'
import type { ModelRequest } from './localModelRequest'
import { createLocalRelay } from './localRelay'
import type { LocalRelay } from './localRelay'

export const LOCAL_EVENT_CHANNEL = 'apps-local:event'
export const LOCAL_IDLE_STOP_MS = 10 * 60_000

const CALL_TIMEOUT_MS = 60_000
const FILE_TIMEOUT_MS = 5 * 60_000
const MAX_ANSWER_BYTES = 512 * 1024 * 1024
const MAX_RUNS_REMEMBERED = 200
const MAX_FILES_REMEMBERED = 2_000
const RELAY_READY_MS = 5_000
const OTHER_LAUNCH_POLL_MS = 500
const INSTALL_POLL_MS = 1_000
const INSTALL_WAIT_MS = 60 * 60_000
const DOWNLOAD_EVENT_GAP_MS = 250
const REFUSED = 403
const JSON_TYPE = 'application/json'
const RUN_UPDATES: ReadonlySet<string> = new Set([
  'execution_start',
  'executing',
  'progress',
  'progress_state',
  'execution_success',
  'execution_error',
  'execution_interrupted'
])

interface Target {
  id: string
  name: string
}

interface ChosenBuild extends LocalBuild {
  installing: boolean
}

let idleTimer: ReturnType<typeof setTimeout> | null = null
let watchingSessions = false
let downloadsUnderWay = 0
const targetByPage = new WeakMap<WebContents, Target>()
const relayByBuild = new Map<string, LocalRelay>()
const startedHere = new Set<string>()
const keptRunning = new Set<string>()
const launches = new Map<string, Promise<ActionResult>>()
const ownRuns = new Map<string, string>()
const ownFiles = new Map<string, Set<string>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rememberBounded<T>(map: Map<string, T>, key: string, value: T, limit: number): void {
  map.delete(key)
  map.set(key, value)
  for (const oldest of map.keys()) {
    if (map.size <= limit) break
    map.delete(oldest)
  }
}

function sendToPages(event: ComfyDesktopLocalEvent): void {
  for (const page of liveAppsPages()) page.send(LOCAL_EVENT_CHANNEL, event)
}

function relayRunUpdate(message: unknown): void {
  if (!isRecord(message) || typeof message['type'] !== 'string') return
  if (!RUN_UPDATES.has(message['type']) || !isRecord(message['data'])) return
  const promptId = message['data']['prompt_id']
  if (typeof promptId !== 'string' || !ownRuns.has(promptId)) return
  sendToPages({ type: message['type'], data: message['data'] })
}

function relayFor(installationId: string, port: number): LocalRelay {
  const relay = relayByBuild.get(installationId) ?? createLocalRelay(relayRunUpdate)
  relayByBuild.set(installationId, relay)
  relay.follow(port)
  return relay
}

function stopFollowingStoppedBuilds(): void {
  for (const id of startedHere) {
    if (runningPortOf(id) !== null) continue
    startedHere.delete(id)
    keptRunning.delete(id)
  }
  for (const [id, relay] of relayByBuild) {
    if (runningPortOf(id) !== null) continue
    relay.stop()
    relayByBuild.delete(id)
  }
}

function watchSessions(): void {
  if (watchingSessions) return
  watchingSessions = true
  sessionLifecycleEvents.on('changed', stopFollowingStoppedBuilds)
}

function isEmpty(queue: QueueAnswer): boolean {
  return queue !== null && queue !== 'not_queue' && queue.running + queue.pending === 0
}

async function idleState(installationId: string): Promise<'gone' | 'busy' | 'replaced' | 'idle'> {
  const port = runningPortOf(installationId)
  if (port === null || !isRunningForAppsOnly(installationId)) return 'gone'
  const session = _runningSessions.get(installationId)
  const queue = await probeQueue(port)
  if (!isRunningForAppsOnly(installationId)) return 'gone'
  if (_runningSessions.get(installationId) !== session) return 'replaced'
  return isEmpty(queue) ? 'idle' : 'busy'
}

function idleStoppable(): string[] {
  return [...startedHere].filter((id) => !keptRunning.has(id))
}

async function stopIdleBuilds(): Promise<void> {
  idleTimer = null
  if (downloadsUnderWay > 0) return noteUse()
  for (const id of idleStoppable()) {
    const state = await idleState(id)
    if (state === 'busy' || state === 'replaced') continue
    startedHere.delete(id)
    if (state === 'idle') await stopRunning(id)
  }
  if (startedHere.size > 0) noteUse()
}

function noteUse(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer =
    idleStoppable().length > 0 ? setTimeout(() => void stopIdleBuilds(), LOCAL_IDLE_STOP_MS) : null
}

function whyNoBuild(choice: Exclude<LocalChoice, { kind: 'build' }>): string {
  return choice.kind === 'too-old'
    ? i18n.t('apps.local.tooOld', { version: choice.wanted })
    : i18n.t('apps.local.noBuilds')
}

function stateOf(build: ChosenBuild): ComfyDesktopLocalComfy['state'] {
  if (build.installing) return 'installing'
  return build.port === null ? 'stopped' : 'running'
}

function describe(build: ChosenBuild): ComfyDesktopLocalComfy {
  return {
    state: stateOf(build),
    own: true,
    name: build.name,
    ...(build.version ? { version: build.version } : {}),
    ...(build.port === null ? {} : { clientId: relayFor(build.id, build.port).clientId })
  }
}

function rememberTarget(page: WebContents, build: LocalBuild, installing: boolean): ChosenBuild {
  targetByPage.set(page, { id: build.id, name: build.name })
  return { ...build, installing }
}

async function chooseTarget(page: WebContents, want: unknown): Promise<ChosenBuild | string> {
  const wanted = wantedVersion(want)
  const picked = pickedBuild(want)
  const choice = chooseLocalBuild(await usableLocalBuilds(), wanted, picked)
  if (choice.kind === 'build') return rememberTarget(page, choice.build, false)
  const installing = chooseInstallingBuild(await installingLocalBuilds(), wanted)
  if (installing) return rememberTarget(page, installing, true)
  const recheck = chooseLocalBuild(await usableLocalBuilds(), wanted, picked)
  return recheck.kind === 'build' ? rememberTarget(page, recheck.build, false) : whyNoBuild(recheck)
}

export function pageBuildId(page: WebContents): string | null {
  return targetByPage.get(page)?.id ?? null
}

export async function localState(
  page: WebContents,
  want: unknown
): Promise<ComfyDesktopLocalComfy> {
  const build = await chooseTarget(page, want)
  if (typeof build === 'string') return { state: 'unsupported', error: build }
  watchSessions()
  return describe(build)
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function otherLaunchSettled(installationId: string): Promise<void> {
  const giveUpAt = Date.now() + COMFY_BOOT_TIMEOUT_MS
  while (_hasActiveLaunch(installationId) && Date.now() < giveUpAt) {
    await pause(OTHER_LAUNCH_POLL_MS)
  }
}

async function installSettled(installationId: string): Promise<void> {
  const giveUpAt = Date.now() + INSTALL_WAIT_MS
  while ((await isStillInstalling(installationId)) && Date.now() < giveUpAt) {
    await pause(INSTALL_POLL_MS)
  }
}

async function waitForOtherLaunch(installationId: string): Promise<ActionResult> {
  await otherLaunchSettled(installationId)
  return { ok: runningPortOf(installationId) !== null }
}

const QUIET_SENDER = { isDestroyed: () => false, send: () => {} } as unknown as WebContents
const QUIET_EVENT = { sender: QUIET_SENDER } as unknown as IpcMainInvokeEvent

export function launchQuietly(
  inst: InstallationRecord,
  actionData?: Record<string, unknown>
): Promise<ActionResult> {
  return handleLaunch({ event: QUIET_EVENT, installationId: inst.id, inst, actionData })
}

async function launchWithoutWindow(
  installationId: string,
  keepRunning: boolean
): Promise<ActionResult> {
  if (_hasActiveLaunch(installationId)) return waitForOtherLaunch(installationId)
  const inst = await installations.get(installationId)
  if (!inst) return { ok: false }
  const result = await launchQuietly(inst, {
    launchModeOverride: 'console',
    autoPortOnConflict: true
  })
  if (result.ok) {
    startedHere.add(installationId)
    if (keepRunning) keptRunning.add(installationId)
    else keptRunning.delete(installationId)
  }
  return result
}

export function isRunningForAppsOnly(installationId: string): boolean {
  return (
    startedHere.has(installationId) &&
    runningPortOf(installationId) !== null &&
    !getEntryByInstallationId(installationId)
  )
}

export function hasBuildsRunningForAppsOnly(): boolean {
  return [...startedHere].some(isRunningForAppsOnly)
}

async function stopIfIdle(installationId: string): Promise<void> {
  if ((await idleState(installationId)) !== 'idle') return
  startedHere.delete(installationId)
  await stopRunning(installationId)
}

export async function stopBuildsRunningForAppsOnly(): Promise<void> {
  await Promise.all([...startedHere].filter(isRunningForAppsOnly).map(stopIfIdle))
  noteUse()
}

export async function stopEveryBuildRunningForAppsOnly(): Promise<void> {
  const ids = [...startedHere].filter(isRunningForAppsOnly)
  for (const id of ids) startedHere.delete(id)
  noteUse()
  await Promise.all(ids.map((id) => stopRunning(id)))
}

export function launchOnce(installationId: string, keepRunning = false): Promise<ActionResult> {
  const pending = launches.get(installationId)
  if (pending) return pending
  const launch = launchWithoutWindow(installationId, keepRunning)
    .catch((err: unknown): ActionResult => ({ ok: false, message: (err as Error)?.message }))
    .finally(() => launches.delete(installationId))
  launches.set(installationId, launch)
  return launch
}

export async function startWithDesktop(inst: InstallationRecord): Promise<void> {
  watchSessions()
  const result = await launchOnce(inst.id, true)
  if (result.ok || result.cancelled) return
  const failure = {
    installationId: inst.id,
    installationName: inst.name,
    message: result.message || i18n.t('apps.local.couldNotStart', { name: inst.name })
  }
  recordCrash(failure)
  _broadcastToRenderer('instance-crashed', failure)
}

async function chooseInstalledTarget(
  page: WebContents,
  want: unknown
): Promise<ChosenBuild | string> {
  const build = await chooseTarget(page, want)
  if (typeof build === 'string' || !build.installing) return build
  await installSettled(build.id)
  const installed = await chooseTarget(page, want)
  if (typeof installed !== 'string' && !installed.installing) {
    page.send(LOCAL_EVENT_CHANNEL, { type: 'setup', data: { state: 'done' } })
  }
  return installed
}

export async function startLocal(
  page: WebContents,
  want: unknown
): Promise<ComfyDesktopLocalComfy> {
  const build = await chooseInstalledTarget(page, want)
  if (typeof build === 'string') return { state: 'unsupported', error: build }
  if (build.installing) {
    return { ...describe(build), error: i18n.t('apps.local.stillInstalling', { name: build.name }) }
  }
  watchSessions()
  const launched = build.port === null ? await launchOnce(build.id) : null
  const port = runningPortOf(build.id)
  if (port === null) {
    return {
      ...describe({ ...build, port: null }),
      error: launched?.message || i18n.t('apps.local.couldNotStart', { name: build.name })
    }
  }
  await relayFor(build.id, port).whenOpen(RELAY_READY_MS)
  noteUse()
  return describe({ ...build, port })
}

function jsonAnswer(status: number, value: unknown): ComfyDesktopLocalAnswer {
  return { status, contentType: JSON_TYPE, body: new TextEncoder().encode(JSON.stringify(value)) }
}

function refusal(): ComfyDesktopLocalAnswer {
  return jsonAnswer(REFUSED, { error: i18n.t('apps.local.notForwarded') })
}

async function readCapped(response: Response): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length') ?? 0) > MAX_ANSWER_BYTES) {
    throw new Error('The answer is too large to hand to the page.')
  }
  if (!response.body) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength
    if (size > MAX_ANSWER_BYTES) throw new Error('The answer is too large to hand to the page.')
    chunks.push(chunk)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

interface Forwarded {
  method?: 'POST'
  json?: unknown
  form?: FormData
  timeoutMs?: number
}

async function forward(
  port: number,
  path: string,
  { method, json, form, timeoutMs = CALL_TIMEOUT_MS }: Forwarded = {}
): Promise<ComfyDesktopLocalAnswer> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: method ?? 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    ...(json === undefined
      ? {}
      : { headers: { 'Content-Type': JSON_TYPE }, body: JSON.stringify(json) }),
    ...(form ? { body: form } : {})
  })
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    body: await readCapped(response)
  }
}

function parsed(answer: ComfyDesktopLocalAnswer): unknown {
  if (answer.status !== 200) return null
  try {
    return JSON.parse(new TextDecoder().decode(answer.body))
  } catch {
    return null
  }
}

function uploadForm(call: Extract<LocalCall, { kind: 'upload' }>): FormData {
  const form = new FormData()
  form.append('image', new Blob([call.bytes as BlobPart]), call.fileName)
  form.append('type', 'input')
  form.append('subfolder', UPLOAD_SUBFOLDER)
  return form
}

async function sendRun(
  buildId: string,
  port: number,
  relay: LocalRelay,
  call: Extract<LocalCall, { kind: 'prompt' }>
): Promise<ComfyDesktopLocalAnswer> {
  await relay.whenOpen(RELAY_READY_MS)
  const answer = await forward(port, '/prompt', {
    method: 'POST',
    json: { prompt: call.prompt, client_id: relay.clientId, extra_data: call.extraData }
  })
  const started = parsed(answer)
  if (isRecord(started) && typeof started['prompt_id'] === 'string') {
    rememberBounded(ownRuns, started['prompt_id'], buildId, MAX_RUNS_REMEMBERED)
  }
  return answer
}

async function readRun(
  buildId: string,
  port: number,
  promptId: string
): Promise<ComfyDesktopLocalAnswer> {
  const answer = await forward(port, `/history/${promptId}`)
  const history = parsed(answer)
  for (const file of outputFilesOf(isRecord(history) ? history[promptId] : null)) {
    const key = outputFileKey(file)
    const builds = ownFiles.get(key) ?? new Set<string>()
    rememberBounded(ownFiles, key, builds.add(buildId), MAX_FILES_REMEMBERED)
  }
  return answer
}

function isOwnFile(call: Extract<LocalCall, { kind: 'view' }>, buildId: string): boolean {
  const fromNamedRun = call.promptId === undefined || ownRuns.get(call.promptId) === buildId
  return fromNamedRun && ownFiles.get(outputFileKey(call.file))?.has(buildId) === true
}

async function answerCall(
  buildId: string,
  port: number,
  relay: LocalRelay,
  call: LocalCall
): Promise<ComfyDesktopLocalAnswer> {
  switch (call.kind) {
    case 'queue':
      return jsonAnswer(
        200,
        queueViewOf(parsed(await forward(port, '/queue')), (id) => ownRuns.has(id))
      )
    case 'object-info':
      return forward(port, `/object_info/${call.node}`)
    case 'upload':
      return forward(port, '/upload/image', { method: 'POST', form: uploadForm(call) })
    case 'prompt':
      return sendRun(buildId, port, relay, call)
    case 'history':
      return ownRuns.has(call.promptId) ? readRun(buildId, port, call.promptId) : refusal()
    case 'view':
      return isOwnFile(call, buildId)
        ? forward(port, `/view?${new URLSearchParams({ ...call.file })}`, {
            timeoutMs: FILE_TIMEOUT_MS
          })
        : refusal()
    case 'leave-queue':
      return call.promptIds.every((id) => ownRuns.get(id) === buildId)
        ? forward(port, '/queue', { method: 'POST', json: { delete: call.promptIds } })
        : refusal()
    case 'interrupt':
      return ownRuns.has(call.promptId)
        ? forward(port, '/interrupt', { method: 'POST', json: { prompt_id: call.promptId } })
        : refusal()
  }
}

function viewBuildOf(
  call: Extract<LocalCall, { kind: 'view' }>,
  targetId: string | undefined
): string | undefined {
  if (call.promptId !== undefined) return ownRuns.get(call.promptId)
  const builds = [...(ownFiles.get(outputFileKey(call.file)) ?? [])]
  if (targetId !== undefined && builds.includes(targetId)) return targetId
  return builds.length === 1 ? builds[0] : targetId
}

function runBuildOf(call: LocalCall, targetId: string | undefined): string | undefined {
  switch (call.kind) {
    case 'history':
    case 'interrupt':
      return ownRuns.get(call.promptId)
    case 'view':
      return viewBuildOf(call, targetId)
    case 'leave-queue':
      return ownRuns.get(call.promptIds[0] ?? '')
    default:
      return undefined
  }
}

export async function localFetch(
  page: WebContents,
  raw: unknown
): Promise<ComfyDesktopLocalAnswer> {
  const call = readLocalCall(raw)
  if (!call) return refusal()
  const targetId = targetByPage.get(page)?.id
  const buildId = runBuildOf(call, targetId) ?? targetId
  const port = buildId ? runningPortOf(buildId) : null
  if (!buildId || port === null) throw new Error(i18n.t('apps.local.notRunning'))
  noteUse()
  return answerCall(buildId, port, relayFor(buildId, port), call)
}

function downloadProgress(name: string): (done: number, total: number) => void {
  let lastSentAt = 0
  return (done, total) => {
    const now = Date.now()
    if (now - lastSentAt < DOWNLOAD_EVENT_GAP_MS && done < total) return
    lastSentAt = now
    sendToPages({ type: 'download', data: { name, done, total } })
  }
}

async function downloadInto(
  installationId: string,
  model: ModelRequest
): Promise<ComfyDesktopLocalDownload> {
  const job = await startManagedModelJob({
    url: model.url,
    filename: model.name,
    directory: model.folder,
    installationId,
    source: 'app',
    onProgress: downloadProgress(model.name)
  })
  try {
    const outcome = await job.completion
    if (outcome.status === 'completed') return { state: 'done' }
    if (outcome.status === 'cancelled') return { state: 'cancelled' }
    return { state: 'failed', error: outcome.error }
  } finally {
    job.release()
  }
}

async function readyForModels(installationId: string): Promise<boolean> {
  const target = await modelTargetOf(installationId)
  if (!target?.installing || !target.modelsInsideBuild) return target !== null
  await installSettled(installationId)
  const after = await modelTargetOf(installationId)
  return after !== null && !after.installing
}

export async function localDownload(
  page: WebContents,
  raw: unknown
): Promise<ComfyDesktopLocalDownload> {
  const model = readModelRequest(raw)
  if (!model) return { state: 'failed', error: i18n.t('apps.local.modelRefused') }
  const target = targetByPage.get(page)
  if (!target || !(await readyForModels(target.id))) {
    return { state: 'failed', error: i18n.t('apps.local.noBuilds') }
  }
  downloadsUnderWay += 1
  try {
    return await downloadInto(target.id, model)
  } finally {
    downloadsUnderWay -= 1
    noteUse()
  }
}

export function _resetForTest(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  downloadsUnderWay = 0
  for (const relay of relayByBuild.values()) relay.stop()
  relayByBuild.clear()
  if (watchingSessions) sessionLifecycleEvents.off('changed', stopFollowingStoppedBuilds)
  watchingSessions = false
  startedHere.clear()
  keptRunning.clear()
  launches.clear()
  ownRuns.clear()
  ownFiles.clear()
}
