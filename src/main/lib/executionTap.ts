import * as installationsApi from '../installations'
import * as telemetry from './telemetry'
import type { SessionKind } from '../../shared/performanceTestSession'
import { stripAnsi, stripLogLevelPrefix } from './stderrTail'
import { buildErrorFields } from '../../shared/errorEvent'
import { scrubAll } from '../../shared/piiScrub'

type TracebackPhase = 'none' | 'collecting'

interface TapState {
  installationId: string
  variant: string | null
  release: string | null
  promptStartTimes: number[]
  startedCount: number
  completedCount: number
  errorCount: number
  tracebackBuffer: string[]
  tracebackChars: number
  tracebackPhase: TracebackPhase
  validationBuffer: string[]
  validationNodeId: string | null
  summaryFlushed: boolean
  tracebackAwaitingChainHeader: boolean
}

const TRACEBACK_START = /^Traceback \(most recent call last\):/
const TRACEBACK_HEADER = 'Traceback (most recent call last):'
const PROMPT_GOT = /^got prompt/i
const PROMPT_DONE = /^Prompt executed in (?<seconds>\d+(?:\.\d+)?)\s*seconds?\s*$/i
const VALIDATION_FAIL = /^Failed to validate prompt for output (?<nodeId>\S+):/i
const EXCEPTION_LINE = /^(?:[A-Za-z_][A-Za-z0-9_]*\.)*[A-Z_][A-Za-z0-9_]*(?::(?:\s|$)|$)/
const CHAIN_MARKERS = [
  'During handling of the above exception',
  'The above exception was the direct cause'
] as const
const CHAIN_MARKER = new RegExp(`^(?:${CHAIN_MARKERS.join('|')})`)

function isChainMarkerOrPrefix(line: string): boolean {
  return CHAIN_MARKERS.some((marker) => marker.startsWith(line) || line.startsWith(marker))
}

function isTracebackHeaderOrPrefix(line: string): boolean {
  return TRACEBACK_HEADER.startsWith(line) || line.startsWith(TRACEBACK_HEADER)
}

const MAX_PENDING_PROMPTS = 256
const MAX_TRACEBACK_LINES = 200
const MAX_TRACEBACK_CHARS = 16 * 1024
const MAX_VALIDATION_LINES = 30
const VALIDATION_DETAIL = /^[*-]/

export function createExecutionTap(opts: {
  installationId: string
  variant?: string | null
  release?: string | null
  coreBetaFlags?: readonly string[]
  coreCommit?: string | null
  coreVersionLabel?: string | null
  sessionKind?: SessionKind
}): {
  ingest: (chunk: string, source: 'stdout' | 'stderr') => void
  flushSummary: () => void
} {
  const state: TapState = {
    installationId: opts.installationId,
    variant: opts.variant ?? null,
    release: opts.release ?? null,
    promptStartTimes: [],
    startedCount: 0,
    completedCount: 0,
    errorCount: 0,
    tracebackBuffer: [],
    tracebackChars: 0,
    tracebackPhase: 'none',
    validationBuffer: [],
    validationNodeId: null,
    summaryFlushed: false,
    tracebackAwaitingChainHeader: false
  }

  const baseContext = {
    installation_id: state.installationId,
    variant: state.variant,
    release: state.release,
    core_beta_flags: [...(opts.coreBetaFlags ?? [])],
    core_commit: opts.coreCommit ?? null,
    core_version_label: opts.coreVersionLabel ?? null,
    session_kind: opts.sessionKind ?? 'normal',
    deployment: 'local' satisfies telemetry.Deployment
  }

  function pushPromptStart(): void {
    state.promptStartTimes.push(Date.now())
    while (state.promptStartTimes.length > MAX_PENDING_PROMPTS) {
      state.promptStartTimes.shift()
    }
  }

  function consumePromptStart(): number | null {
    const ts = state.promptStartTimes.shift()
    return ts === undefined ? null : Date.now() - ts
  }

  function emitFirstCompletedIfNeeded(): void {
    if (state.completedCount !== 1) return
    void (async () => {
      try {
        const inst = await installationsApi.get(state.installationId)
        if (!inst || (inst as Record<string, unknown>)['firstRunAt']) return
        const firstRunAt = new Date().toISOString()
        await installationsApi.update(state.installationId, { firstRunAt })
        telemetry.emit('comfy.desktop.execution.first_completed', {
          ...baseContext,
          first_run_at: firstRunAt
        })
        telemetry.registerPersonPropertiesOnce({ first_generation_at: firstRunAt })
      } catch {}
    })()
  }

  function emitTracebackError(): void {
    if (state.tracebackBuffer.length === 0) {
      state.tracebackPhase = 'none'
      return
    }
    let exceptionLine = state.tracebackBuffer[state.tracebackBuffer.length - 1] || 'unknown'
    for (let i = state.tracebackBuffer.length - 1; i >= 0; i--) {
      const candidate = state.tracebackBuffer[i]!
      if (EXCEPTION_LINE.test(candidate)) {
        exceptionLine = candidate
        break
      }
    }
    state.errorCount++
    const wallMs = consumePromptStart()
    telemetry.emit('comfy.desktop.execution.error', {
      ...baseContext,
      ...buildErrorFields(exceptionLine),
      error_traceback: scrubAll(state.tracebackBuffer.join('\n')).slice(-MAX_TRACEBACK_CHARS),
      error_count: state.errorCount,
      wall_clock_ms: wallMs
    })
    state.tracebackPhase = 'none'
    state.tracebackBuffer = []
    state.tracebackChars = 0
    state.tracebackAwaitingChainHeader = false
  }

  function emitValidationError(): void {
    if (state.validationBuffer.length === 0) return
    const block = state.validationBuffer.join('\n')
    const nodeId = state.validationNodeId
    state.validationBuffer = []
    state.validationNodeId = null
    state.errorCount++
    const wallMs = consumePromptStart()
    telemetry.emit('comfy.desktop.execution.error', {
      ...baseContext,
      ...buildErrorFields(block, { errorClass: 'validation_failed' }),
      error_bucket: 'validation',
      error_count: state.errorCount,
      node_id: nodeId,
      wall_clock_ms: wallMs
    })
  }

  function appendTracebackLine(line: string): void {
    const marker = '...[truncated]...'
    const boundedLine =
      line.length + 1 > MAX_TRACEBACK_CHARS
        ? `${line.slice(0, 512)}${marker}${line.slice(-(MAX_TRACEBACK_CHARS - 513 - marker.length))}`
        : line
    state.tracebackBuffer.push(boundedLine)
    state.tracebackChars += boundedLine.length + 1
    while (
      state.tracebackBuffer.length > 1 &&
      (state.tracebackBuffer.length > MAX_TRACEBACK_LINES ||
        state.tracebackChars > MAX_TRACEBACK_CHARS)
    ) {
      const removed = state.tracebackBuffer.shift()
      if (removed !== undefined) state.tracebackChars -= removed.length + 1
    }
  }

  function handleNewLine(line: string, source: 'stdout' | 'stderr'): void {
    const trimmed = stripLogLevelPrefix(stripAnsi(line).trim())

    if (state.validationBuffer.length > 0) {
      if (VALIDATION_DETAIL.test(trimmed) && state.validationBuffer.length < MAX_VALIDATION_LINES) {
        state.validationBuffer.push(trimmed)
        return
      }
      emitValidationError()
    }

    if (trimmed.length === 0) return

    if (PROMPT_GOT.test(trimmed)) {
      state.startedCount++
      pushPromptStart()
      return
    }

    if (PROMPT_DONE.test(trimmed)) {
      consumePromptStart()
      state.completedCount++
      emitFirstCompletedIfNeeded()
      return
    }

    const validationMatch = trimmed.match(VALIDATION_FAIL)
    if (validationMatch?.groups) {
      state.validationBuffer = [trimmed]
      state.validationNodeId = validationMatch.groups['nodeId'] ?? null
      return
    }

    if (source === 'stderr' && TRACEBACK_START.test(trimmed)) {
      state.tracebackPhase = 'collecting'
      state.tracebackBuffer = [trimmed]
      state.tracebackChars = trimmed.length + 1
      return
    }
  }

  function handleLine(line: string, source: 'stdout' | 'stderr'): void {
    const trimmed = line.trim()

    if (state.tracebackPhase === 'none') {
      handleNewLine(line, source)
      return
    }

    if (trimmed.length === 0) {
      appendTracebackLine(trimmed)
      return
    }

    const hasExceptionLine = state.tracebackBuffer.some((l) => EXCEPTION_LINE.test(l))
    if (hasExceptionLine && TRACEBACK_START.test(trimmed) && !state.tracebackAwaitingChainHeader) {
      emitTracebackError()
      handleNewLine(line, source)
      return
    }
    const continuesChain =
      CHAIN_MARKER.test(trimmed) ||
      (state.tracebackAwaitingChainHeader && TRACEBACK_START.test(trimmed))
    if (hasExceptionLine && state.tracebackBuffer.at(-1) === '' && !continuesChain) {
      emitTracebackError()
      handleNewLine(line, source)
      return
    }

    if (CHAIN_MARKER.test(trimmed)) {
      state.tracebackAwaitingChainHeader = true
    } else if (state.tracebackAwaitingChainHeader && TRACEBACK_START.test(trimmed)) {
      state.tracebackAwaitingChainHeader = false
    }
    appendTracebackLine(trimmed)
    state.tracebackPhase = 'collecting'
  }

  const pending: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' }

  return {
    ingest(chunk: string, source: 'stdout' | 'stderr'): void {
      pending[source] += chunk
      const lines = pending[source].split(/\r?\n/)
      pending[source] = lines.pop() ?? ''
      for (const line of lines) handleLine(line, source)
      if (
        state.tracebackPhase === 'collecting' &&
        pending[source].length > 0 &&
        state.tracebackBuffer.at(-1) === '' &&
        state.tracebackBuffer.some((line) => EXCEPTION_LINE.test(line)) &&
        !isChainMarkerOrPrefix(pending[source]) &&
        !(state.tracebackAwaitingChainHeader && isTracebackHeaderOrPrefix(pending[source]))
      ) {
        emitTracebackError()
      }
    },
    flushSummary(): void {
      if (state.summaryFlushed) return
      state.summaryFlushed = true
      for (const source of ['stdout', 'stderr'] as const) {
        const partial = pending[source]
        if (partial.length === 0) continue
        pending[source] = ''
        handleLine(partial, source)
      }
      emitValidationError()
      if (
        state.tracebackPhase !== 'none' &&
        state.tracebackBuffer.some((l) => EXCEPTION_LINE.test(l))
      ) {
        emitTracebackError()
      }
      telemetry.emit('comfy.desktop.execution.session_summary', {
        ...baseContext,
        started_count: state.startedCount,
        completed_count: state.completedCount,
        error_count: state.errorCount
      })
    }
  }
}
