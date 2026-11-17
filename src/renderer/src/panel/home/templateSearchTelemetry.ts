import { emitTelemetryAction, type TelemetryContext } from '../../lib/telemetry'
import type { OpenTemplateOutcome, TemplateSearchResponse } from '../../types/ipc'
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

export function changedChars(beforeText: string, afterText: string): number {
  const before = [...beforeText]
  const after = [...afterText]
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
    bundle_version: metrics?.bundleVersion ?? null
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

function isOff(response: TemplateSearchResponse): boolean {
  return response.kind === 'unavailable' && response.availability.kind === 'off'
}

export function createSearchTelemetry({
  emit = emitTelemetryAction,
  now = Date.now,
  newId = () => crypto.randomUUID()
}: SearchTelemetryOptions = {}) {
  let session: Session | null = null
  let lastShown: ShownAnswer | null = null

  function send(name: string, context: TelemetryContext): void {
    emit(EVENT_PREFIX + name, context)
  }

  function startSession(): Session {
    session ??= { startedAt: now(), searches: 0, moves: 0, previousRequest: null, shown: null }
    return session
  }

  function requested(): void {
    startSession()
  }

  function answered(
    request: string,
    response: TemplateSearchResponse,
    timing: SearchTiming,
    visible: boolean
  ): void {
    if (isOff(response)) {
      session = null
      return
    }
    const current = visible ? startSession() : session
    const searchId = newId()
    const answeredAt = now()
    const properties = answerProperties(response)
    if (current) current.searches++
    const previous = current?.previousRequest ?? null
    send('searched', {
      search_id: searchId,
      session_search_count: current?.searches ?? 0,
      ...requestProperties(request),
      edit_chars_count: previous === null ? null : changedChars(previous, request),
      ...properties,
      input_to_answer_ms: answeredAt - timing.triggeredAt,
      request_ms: answeredAt - timing.requestedAt
    })
    lastShown = { searchId, outcome: String(properties.outcome), shownAt: answeredAt }
    if (!current) return
    current.previousRequest = request
    if (visible) current.shown = lastShown
  }

  function reopened(): void {
    if (!lastShown) return
    startSession().shown = { ...lastShown, shownAt: now() }
  }

  function moved(): void {
    if (session) session.moves++
  }

  function picked(rows: SearchRow[], row: SearchRow, inputMethod: InputMethod): string | null {
    const current = session
    const shown = current?.shown
    if (!current || !shown) return null
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
    return shown.searchId
  }

  function opened(
    searchId: string | null,
    templateId: string,
    result: OpenTemplateOutcome | 'failed'
  ): void {
    send('open_result', { search_id: searchId, template_id: templateId, result })
    if (result === 'opened' || result === 'launch') session = null
  }

  function abandoned(reason: AbandonReason): void {
    const current = session
    session = null
    if (!current) return
    const endedAt = now()
    send('abandoned', {
      reason,
      session_ms: endedAt - current.startedAt,
      session_search_count: current.searches,
      last_results_shown_ms: current.shown ? endedAt - current.shown.shownAt : null,
      last_outcome: current.shown?.outcome ?? 'searching'
    })
  }

  return { requested, answered, reopened, moved, picked, opened, abandoned }
}

export type SearchTelemetry = ReturnType<typeof createSearchTelemetry>
