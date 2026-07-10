/**
 * Execution telemetry tap.
 *
 * The launcher does not embed the ComfyUI frontend, so we can't IPC-forward
 * `execution_*` events the way legacy desktop did. Instead we tail ComfyUI's
 * own stdout/stderr — a stable signal that is already piped through
 * `proc.stdout` / `proc.stderr` in `sessionActions/launch.ts`.
 *
 * Patterns we detect (current ComfyUI main branch):
 *   - "got prompt"                        → execution started
 *   - "Prompt executed in X.X seconds"    → execution completed (with duration)
 *   - "Failed to validate prompt"         → validation error
 *   - Python tracebacks                   → execution error
 *
 * The per-install `firstRunAt` flag mirrors legacy desktop's once-ever
 * `execution:completed` semantic. It is set on the first successful prompt
 * and emitted as `comfy.desktop.execution.first_completed`.
 *
 * Defensive bounds:
 *   - `promptStartTimes` is capped to avoid leaking when starts and
 *     completions don't pair (e.g. crashes mid-prompt).
 *   - Traceback collection is bounded both in lines and in buffered chars.
 *   - Python "chained" tracebacks (`During handling of the above exception, …`)
 *     emit a single error event using the final exception line.
 */
import * as installationsApi from '../installations'
import * as telemetry from './telemetry'
import { stripAnsi, stripLogLevelPrefix } from './stderrTail'
import { buildErrorFields } from '../../shared/errorEvent'

/**
 * Traceback collection state. We collect until a blank line follows an
 * exception line, then emit. Chained Python tracebacks (which begin with
 * `During handling of the above exception, ...` after the inner exception's
 * blank line) emit as a separate event with their own `error_class` — the
 * counts are intentionally accurate, not deduped.
 */
type TracebackPhase = 'none' | 'collecting'

interface TapState {
  installationId: string
  variant: string | null
  release: string | null
  promptStartTimes: number[]
  startedCount: number
  completedCount: number
  errorCount: number
  // Buffer for the current stderr traceback (collected line-by-line)
  tracebackBuffer: string[]
  tracebackChars: number
  tracebackPhase: TracebackPhase
  // Buffer for a multi-line prompt-validation failure (header + reason lines).
  // Empty when not collecting. Deferred so `error_message` carries the actual
  // reasons ("Value not in list", "Required input is missing"), not just the
  // header — otherwise every validation_failed groups into one opaque bucket.
  validationBuffer: string[]
  validationNodeId: string | null
}

const TRACEBACK_START = /^Traceback \(most recent call last\):/
const PROMPT_GOT = /^got prompt/i
const PROMPT_DONE = /^Prompt executed in (?<seconds>\d+(?:\.\d+)?)\s*seconds?\s*$/i
const VALIDATION_FAIL = /^Failed to validate prompt for output (?<nodeId>\S+):/i
const EXCEPTION_LINE = /^[A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception|Warning|Interrupt)\b/

const MAX_PENDING_PROMPTS = 256
const MAX_TRACEBACK_LINES = 200
const MAX_TRACEBACK_CHARS = 16 * 1024
// A validation block is header + a handful of reason lines; bound it tightly.
const MAX_VALIDATION_LINES = 30
// Detail lines ComfyUI prints under the header: `* Node 4:` / `  - reason: …`.
const VALIDATION_DETAIL = /^[*-]/

export function createExecutionTap(opts: {
  installationId: string
  variant?: string | null
  release?: string | null
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
    validationNodeId: null
  }

  const baseContext = {
    installation_id: state.installationId,
    variant: state.variant,
    release: state.release,
    // The tap tails a locally-spawned ComfyUI process, so every event it
    // emits is local execution by construction. Cloud executions never pass
    // through here — the cloud frontend/backend report those directly.
    deployment: 'local' satisfies telemetry.Deployment
  }

  function pushPromptStart(): void {
    state.promptStartTimes.push(Date.now())
    // Hard cap so a long-running buggy install can't grow this unbounded
    // when starts and completions don't pair.
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
        // Per-PERSON activation marker. The event above is per-installation
        // and over-counts users with multiple installs; `$set_once` keeps
        // the earliest first-completion timestamp on the person profile.
        telemetry.registerPersonPropertiesOnce({ first_generation_at: firstRunAt })
      } catch {
        // ignore – telemetry side effect, not user-visible
      }
    })()
  }

  function emitTracebackError(): void {
    if (state.tracebackBuffer.length === 0) {
      state.tracebackPhase = 'none'
      return
    }
    // The final exception line is the user-facing error in chained
    // tracebacks. Walk backwards to find the last line matching
    // EXCEPTION_LINE.
    let exceptionLine = state.tracebackBuffer[state.tracebackBuffer.length - 1] || 'unknown'
    for (let i = state.tracebackBuffer.length - 1; i >= 0; i--) {
      const candidate = state.tracebackBuffer[i]!
      if (EXCEPTION_LINE.test(candidate)) {
        exceptionLine = candidate
        break
      }
    }
    state.errorCount++
    // Wall-clock between the matching `Got prompt` and the error end —
    // mirror what `execution.completed` already emits so error-vs-success
    // duration can be compared directly on the dashboard. Null when the
    // error fired without a paired start (already-pending traceback at
    // boot, etc.).
    const wallMs = consumePromptStart()
    // Standard error schema derived from the final exception line (class /
    // message / bucket / signature).
    telemetry.emit('comfy.desktop.execution.error', {
      ...baseContext,
      ...buildErrorFields(exceptionLine),
      error_count: state.errorCount,
      wall_clock_ms: wallMs
    })
    state.tracebackPhase = 'none'
    state.tracebackBuffer = []
    state.tracebackChars = 0
  }

  /**
   * Emit a deferred prompt-validation failure. The buffer holds the header
   * (`Failed to validate prompt for output N:`) plus the `* node:` / `- reason`
   * detail lines; the joined block drives `error_message` / `error_signature`
   * so distinct validation reasons group separately, while `error_class` stays
   * the stable `validation_failed` and `error_bucket` stays `validation`.
   */
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
    state.tracebackBuffer.push(line)
    state.tracebackChars += line.length + 1
    // Bounded buffer: if the traceback is pathologically long, force-emit
    // and reset so we never accumulate forever.
    if (
      state.tracebackBuffer.length >= MAX_TRACEBACK_LINES ||
      state.tracebackChars >= MAX_TRACEBACK_CHARS
    ) {
      emitTracebackError()
    }
  }

  function handleNewLine(line: string, source: 'stdout' | 'stderr'): void {
    // `got prompt` / `Prompt executed in …` / `Failed to validate …` are
    // logging-formatted, so on current ComfyUI they arrive with a colored
    // `\x1b[..m[LEVEL]\x1b[0m ` tag the anchored patterns below don't expect.
    // Strip ANSI first, then the level tag. Raw Python tracebacks carry
    // neither, so TRACEBACK_START detection is unaffected.
    const trimmed = stripLogLevelPrefix(stripAnsi(line).trim())

    // Collecting a multi-line validation block: keep appending the `* node:` /
    // `- reason` detail lines; any other line ends the block (then falls
    // through so it is processed normally — a new header, `got prompt`, etc.).
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
      telemetry.emit('comfy.desktop.execution.started', {
        ...baseContext,
        started_count: state.startedCount
      })
      return
    }

    const doneMatch = trimmed.match(PROMPT_DONE)
    if (doneMatch?.groups) {
      const seconds = Number(doneMatch.groups['seconds'])
      const wallMs = consumePromptStart()
      state.completedCount++
      telemetry.emit('comfy.desktop.execution.completed', {
        ...baseContext,
        duration_seconds: Number.isFinite(seconds) ? seconds : null,
        wall_clock_ms: wallMs,
        completed_count: state.completedCount
      })
      emitFirstCompletedIfNeeded()
      return
    }

    const validationMatch = trimmed.match(VALIDATION_FAIL)
    if (validationMatch?.groups) {
      // Start deferred collection; the paired error emits once the block ends
      // (a non-detail line, a new header, or flushSummary) so `error_message`
      // carries the reasons that follow, not just this header.
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

    // Outside a traceback: dispatch as a normal line.
    if (state.tracebackPhase === 'none') {
      handleNewLine(line, source)
      return
    }

    // Blank lines inside a traceback terminate the current frame ONLY if we
    // already have an exception line. A chained traceback's `During handling
    // of the above exception, …` marker arrives AFTER the blank line; it
    // re-enters collection on the very next non-blank line below.
    if (trimmed.length === 0) {
      const hasExceptionLine = state.tracebackBuffer.some((l) => EXCEPTION_LINE.test(l))
      if (hasExceptionLine) {
        emitTracebackError()
        return
      }
      // Blank line before any exception line — keep collecting.
      appendTracebackLine(trimmed)
      return
    }

    // A chain marker (or a fresh `Traceback (most recent call last):`)
    // following a just-emitted error re-opens collection — but only if we
    // are still considered inside a traceback. With blank-line emit above,
    // by the time we see the chain marker we've already emitted, so it
    // arrives in `phase === 'none'` and starts a brand-new collection if
    // it's a TRACEBACK_START. Plain chain markers without a fresh
    // `Traceback:` header are ignored.

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
    },
    flushSummary(): void {
      // Flush any buffered partial line (a final line written without a
      // trailing newline when the process exited) through the parser first —
      // that trailing line is often the fatal exception / validation reason we
      // want, and it would otherwise sit unparsed in `pending`.
      for (const source of ['stdout', 'stderr'] as const) {
        const partial = pending[source]
        if (partial.length === 0) continue
        pending[source] = ''
        handleLine(partial, source)
      }
      // Drain an in-flight validation block (process exited before the block's
      // terminating line arrived) so the failure isn't dropped.
      emitValidationError()
      // Drain any in-flight traceback so we don't drop the error if the
      // process exited before a boundary line arrived.
      if (
        state.tracebackPhase !== 'none' &&
        state.tracebackBuffer.some((l) => EXCEPTION_LINE.test(l))
      ) {
        emitTracebackError()
      }
      // Per-session summary so analytics always has a row, even if a session
      // produced no individual prompt events.
      telemetry.emit('comfy.desktop.execution.session_summary', {
        ...baseContext,
        started_count: state.startedCount,
        completed_count: state.completedCount,
        error_count: state.errorCount
      })
    }
  }
}
