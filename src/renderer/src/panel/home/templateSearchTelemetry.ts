import { emitTelemetryAction, type TelemetryContext } from '../../lib/telemetry'
import type { OpenTemplateOutcome, TemplateSearchResponse } from '../../types/ipc'
import { matchLevel, searchRows, type SearchRow, type SearchRowKind } from './templateSearch'
import { TEMPLATE_SEARCH_EVENT_PREFIX } from '../../../../shared/templateSearch'

export type InputMethod = 'keyboard' | 'pointer'
export type AbandonReason = 'closed' | 'cleared' | 'left'

const LIST_NAMES: Record<SearchRowKind, string> = {
  run: 'run',
  download: 'download',
  more: 'more',
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
    more_count: count('more'),
    also_try_count: count('also'),
    top_match_pct: matchPct(rows[0]),
    top_match_level: (rows[0] && matchLevel(rows[0].candidate)) ?? 'none',
    has_best_match: rows.some((row) => row.best),
    partners_shown: response.result.partnersShown,
    has_partner_switch: response.result.partnerSwitch,
    process_ms: metrics?.processMs ?? null,
    is_cold_start: metrics?.coldStart ?? null,
    bundle_version: metrics?.bundleVersion ?? null
  }
}

interface Answer {
  searchId: string
  outcome: string
}

interface Session {
  startedAt: number
  searches: number
  previousRequest: string | null
  answer: Answer | null
  shownAt: number | null
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
  let lastAnswer: Answer | null = null

  function send(name: string, context: TelemetryContext): void {
    emit(TEMPLATE_SEARCH_EVENT_PREFIX + name, context)
  }

  function startSession(): Session {
    session ??= {
      startedAt: now(),
      searches: 0,
      previousRequest: null,
      answer: null,
      shownAt: null
    }
    return session
  }

  function show(current: Session, answer: Answer): void {
    current.answer = answer
    current.shownAt = now()
  }

  function requested(): void {
    const current = startSession()
    current.answer = null
    current.shownAt = null
  }

  function answered(
    request: string,
    response: TemplateSearchResponse,
    timing: SearchTiming,
    visible: boolean
  ): void {
    if (isOff(response)) {
      session = null
      lastAnswer = null
      return
    }
    const current = visible ? startSession() : session
    const answeredAt = now()
    const properties = answerProperties(response)
    if (current) current.searches++
    const previous = current?.previousRequest ?? null
    lastAnswer = { searchId: newId(), outcome: String(properties.outcome) }
    send('searched', {
      search_id: lastAnswer.searchId,
      session_search_count: current?.searches ?? 0,
      ...requestProperties(request),
      edit_chars_count: previous === null ? null : changedChars(previous, request),
      ...properties,
      input_to_answer_ms: answeredAt - timing.triggeredAt,
      request_ms: answeredAt - timing.requestedAt
    })
    if (!current) return
    current.previousRequest = request
    if (visible) show(current, lastAnswer)
  }

  function reopened(): void {
    if (lastAnswer) show(startSession(), lastAnswer)
  }

  function hidden(): void {
    if (session) session.shownAt = null
  }

  function picked(
    rows: SearchRow[],
    row: SearchRow,
    inputMethod: InputMethod,
    action: 'run' | 'download' | 'sign_in' = row.candidate.needsDownload ? 'download' : 'run'
  ): string | null {
    const current = session
    const answer = current?.answer
    if (!current || !answer || current.shownAt === null) return null
    const pickedAt = now()
    const sameList = rows.filter((other) => other.kind === row.kind)
    send('picked', {
      search_id: answer.searchId,
      list: LIST_NAMES[row.kind],
      list_position: sameList.indexOf(row),
      position: rows.indexOf(row),
      template_id: row.candidate.templateId,
      match_pct: row.kind === 'more' ? null : matchPct(row),
      match_level: (row.kind !== 'more' && matchLevel(row.candidate)) || 'none',
      is_best_match: row.best,
      input_method: inputMethod,
      action,
      results_to_pick_ms: pickedAt - current.shownAt,
      session_ms: pickedAt - current.startedAt,
      session_search_count: current.searches
    })
    return answer.searchId
  }

  function opened(
    searchId: string | null,
    templateId: string,
    result: OpenTemplateOutcome | 'failed'
  ): void {
    send('open_result', { search_id: searchId, template_id: templateId, result })
    if (result === 'opened' || result === 'launch') session = null
  }

  function partnerSwitchChanged(partnersShown: boolean): void {
    send('partner_switch_changed', {
      partners_shown: partnersShown,
      search_id: session?.answer?.searchId ?? null,
      session_search_count: session?.searches ?? 0
    })
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
      last_results_shown_ms: current.shownAt === null ? null : endedAt - current.shownAt,
      last_outcome: current.answer?.outcome ?? 'searching'
    })
  }

  return {
    requested,
    answered,
    reopened,
    hidden,
    picked,
    opened,
    partnerSwitchChanged,
    abandoned
  }
}

export type SearchTelemetry = ReturnType<typeof createSearchTelemetry>
