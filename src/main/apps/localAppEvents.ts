import * as mainTelemetry from '../lib/telemetry'
import type { TelemetryContext } from '../lib/telemetry'

export const RUN_FINISHED_EVENT = 'comfy.desktop.apps.run_finished'
export const SETUP_EVENT = 'comfy.desktop.apps.setup'
export const COMFYUI_EXITED = 'comfyui_exited'
const BLOCKED_BRANCH = 'ExecutionBlocked'

const MAX_RUNS = 200
const MAX_EARLY_RUNS = 50
const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const DOTTED_NAME = /^[A-Za-z_][A-Za-z0-9_.]{0,255}$/
const RUN_ENDS: Readonly<Record<string, RunOutcome>> = {
  execution_success: 'success',
  execution_error: 'failed',
  execution_interrupted: 'cancelled'
}

export type RunOutcome = 'success' | 'failed' | 'cancelled'
export type SetupStage = 'install' | 'start'

export interface RunEnd {
  outcome: RunOutcome
  errorClass?: string
  at: number
  startedAt?: number
}

interface Run {
  buildId: string
  appId: string | null
  submittedAt: number
  startedAt?: number
  heardEnd?: RunEnd
}

interface EarlyRun {
  startedAt?: number
  end?: RunEnd
}

const runs = new Map<string, Run>()
const earlyRuns = new Map<string, EarlyRun>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function keepNewest<T>(map: Map<string, T>, key: string, value: T, limit: number): void {
  map.delete(key)
  map.set(key, value)
  for (const oldest of map.keys()) {
    if (map.size <= limit) break
    map.delete(oldest)
  }
}

function wholeSeconds(ms: number): number {
  return Math.max(0, Math.round(ms / 1000))
}

function appIdOf(appId: string | null): TelemetryContext {
  return appId ? { app_id: appId } : {}
}

export function errorClassOf(exceptionType: unknown): string | undefined {
  if (typeof exceptionType !== 'string' || !DOTTED_NAME.test(exceptionType)) return undefined
  const name = exceptionType.split('.').pop() ?? ''
  if (!CLASS_NAME.test(name)) return undefined
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()
}

function timeOf(data: Record<string, unknown>, now: number): number {
  const at = data['timestamp']
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : now
}

function timesOf(run: Run, end: RunEnd): TelemetryContext {
  const startedAt = run.startedAt ?? end.startedAt
  if (startedAt === undefined) return {}
  return {
    run_seconds: wholeSeconds(end.at - startedAt),
    queue_seconds: wholeSeconds(startedAt - run.submittedAt)
  }
}

function sendRunFinished(run: Run, end: RunEnd): void {
  try {
    mainTelemetry.capture(RUN_FINISHED_EVENT, {
      ...appIdOf(run.appId),
      where: 'local',
      outcome: end.outcome,
      ...timesOf(run, end),
      ...(end.errorClass ? { error_class: end.errorClass } : {})
    })
  } catch {}
}

export function finishRun(promptId: string, end: RunEnd): void {
  const run = runs.get(promptId)
  if (!run) return
  runs.delete(promptId)
  sendRunFinished(run, end)
}

export function finishHeardRun(promptId: string): void {
  const heardEnd = runs.get(promptId)?.heardEnd
  if (heardEnd) finishRun(promptId, heardEnd)
}

export function settleRun(promptId: string, fromHistory: RunEnd | null, missing: RunEnd): void {
  finishRun(promptId, fromHistory ?? runs.get(promptId)?.heardEnd ?? missing)
}

export function runAccepted(
  promptId: string,
  buildId: string,
  appId: string | null,
  submittedAt: number
): void {
  if (runs.has(promptId)) return
  const early = earlyRuns.get(promptId)
  earlyRuns.delete(promptId)
  const run: Run = { buildId, appId, submittedAt, startedAt: early?.startedAt }
  keepNewest(runs, promptId, run, MAX_RUNS)
  if (early?.end) finishRun(promptId, early.end)
}

function noteEarly(promptId: string, change: EarlyRun): void {
  keepNewest(earlyRuns, promptId, { ...earlyRuns.get(promptId), ...change }, MAX_EARLY_RUNS)
}

function isBlockedBranch(type: unknown, data: Record<string, unknown>): boolean {
  return type === 'execution_error' && data['exception_type'] === BLOCKED_BRANCH
}

function isBlockedNotice(message: unknown): boolean {
  return Array.isArray(message) && isRecord(message[1]) && isBlockedBranch(message[0], message[1])
}

export function noteRunMessage(message: unknown, now = Date.now()): void {
  if (!isRecord(message) || typeof message['type'] !== 'string') return
  const data = message['data']
  if (!isRecord(data) || typeof data['prompt_id'] !== 'string') return
  const promptId = data['prompt_id']
  const type = message['type']
  const at = timeOf(data, now)
  const run = runs.get(promptId)
  if (type === 'execution_start') {
    if (run) run.startedAt ??= at
    else noteEarly(promptId, { startedAt: at })
    return
  }
  const outcome = RUN_ENDS[type]
  if (!outcome || isBlockedBranch(type, data)) return
  const errorClass = outcome === 'failed' ? errorClassOf(data['exception_type']) : undefined
  const end: RunEnd = { outcome, at, ...(errorClass ? { errorClass } : {}) }
  if (!run) noteEarly(promptId, { end })
  else if (run.startedAt === undefined) run.heardEnd ??= end
  else finishRun(promptId, end)
}

function messageTime(messages: unknown[], type: string): number | undefined {
  for (const message of messages) {
    if (!Array.isArray(message) || message[0] !== type || !isRecord(message[1])) continue
    const at = message[1]['timestamp']
    if (typeof at === 'number' && Number.isFinite(at) && at > 0) return at
  }
  return undefined
}

function messageOf(messages: unknown[], type: string): Record<string, unknown> | undefined {
  const found = messages.find((message) => Array.isArray(message) && message[0] === type)
  return Array.isArray(found) && isRecord(found[1]) ? found[1] : undefined
}

export function runEndFromHistory(entry: unknown, now = Date.now()): RunEnd | null {
  if (!isRecord(entry) || !isRecord(entry['status'])) return null
  const status = entry['status']
  const notices: unknown[] = Array.isArray(status['messages']) ? status['messages'] : []
  const messages = notices.filter((message) => !isBlockedNotice(message))
  const startedAt = messageTime(messages, 'execution_start')
  const timed = (outcome: RunOutcome, type: string, errorClass?: string): RunEnd => ({
    outcome,
    at: messageTime(messages, type) ?? now,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(errorClass ? { errorClass } : {})
  })
  if (messageOf(messages, 'execution_interrupted')) {
    return timed('cancelled', 'execution_interrupted')
  }
  const error = messageOf(messages, 'execution_error')
  if (error) return timed('failed', 'execution_error', errorClassOf(error['exception_type']))
  if (status['status_str'] === 'success') return timed('success', 'execution_success')
  return status['status_str'] === 'error' ? timed('failed', 'execution_error') : null
}

export function runsOn(buildId: string): string[] {
  return [...runs].filter(([, run]) => run.buildId === buildId).map(([promptId]) => promptId)
}

export function unstartedRunsOn(buildId: string): string[] {
  return runsOn(buildId).filter((promptId) => runs.get(promptId)?.startedAt === undefined)
}

export function isFollowing(promptId: string): boolean {
  return runs.has(promptId)
}

export function buildsWithRuns(): string[] {
  return [...new Set([...runs.values()].map((run) => run.buildId))]
}

export function failRunsOn(buildId: string, errorClass: string, now = Date.now()): void {
  for (const promptId of runsOn(buildId)) {
    settleRun(promptId, null, { outcome: 'failed', errorClass, at: now })
  }
}

export interface SetupStep {
  finished(): void
  failed(errorClass: string): void
  cancelled(): void
}

function sendSetup(stage: SetupStage, appId: string | null, extra: TelemetryContext): void {
  try {
    mainTelemetry.capture(SETUP_EVENT, { ...appIdOf(appId), stage, ...extra })
  } catch {}
}

export function setupStarted(stage: SetupStage, appId: string | null): SetupStep {
  const startedAt = Date.now()
  let ended = false
  sendSetup(stage, appId, { outcome: 'started' })
  const end = (extra: TelemetryContext | null): void => {
    if (ended) return
    ended = true
    if (!extra) return
    sendSetup(stage, appId, { ...extra, seconds: wholeSeconds(Date.now() - startedAt) })
  }
  return {
    finished: () => end({ outcome: 'finished' }),
    failed: (errorClass) => end({ outcome: 'failed', error_class: errorClass }),
    cancelled: () => end(null)
  }
}

export function _resetForTest(): void {
  runs.clear()
  earlyRuns.clear()
}
