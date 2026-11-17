import { emitTelemetryAction, type TelemetryContext } from '../../lib/telemetry'
import type {
  OpenTemplateOutcome,
  TemplateSearchAvailability,
  TemplateSearchResponse
} from '../../types/ipc'
import { matchLevel, searchRows, type SearchRow, type SearchRowKind } from './templateSearch'

const EVENT_PREFIX = 'comfy.desktop.template_search.'

export type InputMethod = 'keyboard' | 'pointer'
export type AbandonReason = 'closed' | 'blurred' | 'cleared' | 'left'

const LIST_NAMES: Record<SearchRowKind, string> = {
  run: 'run',
  download: 'download',
  also: 'also_try'
}

const SCRIPTS: [string, RegExp][] = [
  ['latin', /\p{Script=Latin}/u],
  ['cjk', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['arabic', /\p{Script=Arabic}/u]
]

export function requestScript(text: string): string {
  const counts = new Map<string, number>()
  for (const char of text) {
    const script =
      SCRIPTS.find(([, pattern]) => pattern.test(char))?.[0] ??
      (/\p{L}/u.test(char) ? 'other' : null)
    if (script) counts.set(script, (counts.get(script) ?? 0) + 1)
  }
  let most = 0
  let found = 'none'
  for (const [script, count] of counts) {
    if (count > most) {
      most = count
      found = script
    }
  }
  return found
}

export function changedChars(before: string, after: string): number {
  const shorter = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < shorter && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (
    suffix < shorter - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++
  return before.length + after.length - 2 * (prefix + suffix)
}

export function requestProperties(request: string): TelemetryContext {
  return {
    request_text: request,
    request_chars_count: [...request].length,
    request_words_count: request.split(/\s+/).filter(Boolean).length,
    request_script: requestScript(request)
  }
}

function matchPct(row: SearchRow | undefined): number | null {
  const calibrated = row?.candidate.calibrated
  return calibrated === null || calibrated === undefined ? null : Math.round(calibrated * 100)
}

function answerProperties(response: TemplateSearchResponse): TelemetryContext {
  if (response.kind === 'failed') return { outcome: 'failed' }
  if (response.kind === 'unavailable') {
    const availability = response.availability
    return {
      outcome: 'unavailable',
      availability: availability.kind,
      reason: availability.kind === 'unavailable' ? availability.reason : null
    }
  }
  const rows = searchRows(response.result)
  const count = (kind: SearchRowKind): number => rows.filter((row) => row.kind === kind).length
  const metrics = response.metrics
  return {
    outcome: response.result.outcome,
    run_count: count('run'),
    download_count: count('download'),
    also_try_count: count('also'),
    top_match_pct: matchPct(rows[0]),
    top_match_level: (rows[0] && matchLevel(rows[0].candidate)) ?? 'none',
    has_best_match: rows.some((row) => row.best),
    process_ms: metrics?.processMs ?? null,
    is_cold_start: metrics?.coldStart ?? null,
    bundle_version: metrics?.bundleVersion ?? null,
    protocol_version: metrics?.protocol ?? null
  }
}

interface ShownAnswer {
  searchId: string
  outcome: string
  shownAt: number
}

interface Session {
  startedAt: number
  searches: number
  moves: number
  previousRequest: string | null
  shown: ShownAnswer | null
}

export interface SearchTiming {
  triggeredAt: number
  requestedAt: number
}

export interface SearchTelemetryOptions {
  emit?: (event: string, context: TelemetryContext) => void
  now?: () => number
  newId?: () => string
}

export function createSearchTelemetry({
  emit = emitTelemetryAction,
  now = Date.now,
  newId = () => crypto.randomUUID()
}: SearchTelemetryOptions = {}) {
  let session: Session | null = null
  let lastShown: ShownAnswer | null = null
  let lastState: string | null = null

  function send(name: string, context: TelemetryContext): void {
    emit(EVENT_PREFIX + name, context)
  }

  function startSession(): Session {
    session ??= { startedAt: now(), searches: 0, moves: 0, previousRequest: null, shown: null }
    return session
  }

  function answered(
    request: string,
    response: TemplateSearchResponse,
    timing: SearchTiming
  ): string {
    const current = startSession()
    const searchId = newId()
    const answeredAt = now()
    current.searches++
    const properties = answerProperties(response)
    send('searched', {
      search_id: searchId,
      session_search_count: current.searches,
      ...requestProperties(request),
      edit_chars_count:
        current.previousRequest === null ? null : changedChars(current.previousRequest, request),
      ...properties,
      input_to_answer_ms: answeredAt - timing.triggeredAt,
      request_ms: answeredAt - timing.requestedAt
    })
    current.previousRequest = request
    current.shown = { searchId, outcome: String(properties.outcome), shownAt: answeredAt }
    lastShown = current.shown
    return searchId
  }

  function reopened(): void {
    if (session || !lastShown) return
    lastShown = { ...lastShown, shownAt: now() }
    session = { startedAt: now(), searches: 0, moves: 0, previousRequest: null, shown: lastShown }
  }

  function moved(): void {
    if (session) session.moves++
  }

  function picked(rows: SearchRow[], row: SearchRow, inputMethod: InputMethod): string | null {
    const current = session
    const shown = current?.shown
    if (!current || !shown) return lastShown?.searchId ?? null
    const pickedAt = now()
    const sameList = rows.filter((other) => other.kind === row.kind)
    send('picked', {
      search_id: shown.searchId,
      list: LIST_NAMES[row.kind],
      list_position: sameList.indexOf(row),
      position: rows.indexOf(row),
      template_id: row.candidate.templateId,
      match_pct: matchPct(row),
      match_level: matchLevel(row.candidate) ?? 'none',
      is_best_match: row.best,
      input_method: inputMethod,
      action: row.candidate.needsDownload ? 'download' : 'run',
      results_to_pick_ms: pickedAt - shown.shownAt,
      session_ms: pickedAt - current.startedAt,
      session_search_count: current.searches,
      highlight_moves_count: current.moves
    })
    session = null
    return shown.searchId
  }

  function abandoned(reason: AbandonReason): void {
    const current = session
    session = null
    if (!current?.shown) return
    const endedAt = now()
    send('abandoned', {
      reason,
      session_ms: endedAt - current.startedAt,
      session_search_count: current.searches,
      last_results_shown_ms: endedAt - current.shown.shownAt,
      last_outcome: current.shown.outcome
    })
  }

  function opened(
    searchId: string | null,
    templateId: string,
    result: OpenTemplateOutcome | 'failed'
  ): void {
    send('open_result', { search_id: searchId, template_id: templateId, result })
  }

  function stateShown(availability: TemplateSearchAvailability | null): void {
    const state = availability?.kind ?? null
    if (state === lastState) return
    lastState = state
    if (!availability) return
    send('availability_shown', {
      state: availability.kind,
      reason: availability.kind === 'unavailable' ? availability.reason : null
    })
  }

  return { answered, reopened, moved, picked, abandoned, opened, stateShown }
}

export type SearchTelemetry = ReturnType<typeof createSearchTelemetry>
