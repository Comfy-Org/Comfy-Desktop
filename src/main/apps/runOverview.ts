import type { ComfyDesktopRun } from '../../types/comfyDesktopBridge'

export const MAX_REPORTED_RUNS = 20
const MAX_ID_LENGTH = 128
const MAX_STEP_LENGTH = 120

const WHERE = new Set<ComfyDesktopRun['where']>(['cloud', 'local'])
const STATES = new Set<ComfyDesktopRun['state']>(['queued', 'running', 'done', 'failed'])

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, max)
  return trimmed === '' ? undefined : trimmed
}

function count(value: unknown, min: number): number | undefined {
  return Number.isInteger(value) && (value as number) >= min ? (value as number) : undefined
}

function fraction(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : undefined
}

function time(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function withoutUnset(run: ComfyDesktopRun): ComfyDesktopRun {
  return Object.fromEntries(
    Object.entries(run).filter(([, value]) => value !== undefined)
  ) as ComfyDesktopRun
}

function readRun(value: unknown): ComfyDesktopRun | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const id = text(raw.id, MAX_ID_LENGTH)
  const where = raw.where as ComfyDesktopRun['where']
  const state = raw.state as ComfyDesktopRun['state']
  if (id === undefined || !WHERE.has(where) || !STATES.has(state)) return null
  const stepIndex = count(raw.stepIndex, 1)
  const stepCount = count(raw.stepCount, 1)
  const stepsMakeSense =
    stepIndex !== undefined && stepCount !== undefined && stepIndex <= stepCount
  return withoutUnset({
    id,
    where,
    state,
    step: text(raw.step, MAX_STEP_LENGTH),
    stepIndex: stepsMakeSense ? stepIndex : undefined,
    stepCount: stepsMakeSense ? stepCount : undefined,
    progress: fraction(raw.progress),
    ahead: count(raw.ahead, 0),
    startedAt: time(raw.startedAt),
    endedAt: time(raw.endedAt)
  })
}

export function readReportedRuns(value: unknown): ComfyDesktopRun[] | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  const runs: ComfyDesktopRun[] = []
  for (const item of value) {
    const run = readRun(item)
    if (!run || seen.has(run.id)) continue
    seen.add(run.id)
    runs.push(run)
    if (runs.length === MAX_REPORTED_RUNS) break
  }
  return runs
}
