import { describe, expect, it } from 'vitest'
import type { TelemetryContext } from '../../lib/telemetry'
import type {
  TemplateSearchCandidate,
  TemplateSearchResponse,
  TemplateSearchResult
} from '../../types/ipc'
import { searchRows } from './templateSearch'
import {
  changedChars,
  createSearchTelemetry,
  requestProperties,
  requestScript
} from './templateSearchTelemetry'

function candidate(
  templateId: string,
  over: Partial<TemplateSearchCandidate> = {}
): TemplateSearchCandidate {
  return {
    templateId,
    title: `${templateId} title`,
    thumbnailUrl: null,
    family: null,
    partner: false,
    needsDownload: false,
    score: 0.9,
    calibrated: null,
    belowThreshold: false,
    missing: [],
    ...over
  }
}

const RESULT: TemplateSearchResult = {
  outcome: 'template',
  reply: null,
  run: [candidate('poster_template', { calibrated: 0.874 }), candidate('banner_template')],
  download: [candidate('mural_template', { needsDownload: true })],
  alsoTry: [candidate('sticker_template')]
}

const ANSWER: TemplateSearchResponse = {
  kind: 'result',
  result: RESULT,
  metrics: { processMs: 38, bundleVersion: '2.3.0', coldStart: true }
}

const ROWS = searchRows(RESULT)

function harness() {
  const sent: { event: string; context: TelemetryContext }[] = []
  let clock = 10_000
  let ids = 0
  const telemetry = createSearchTelemetry({
    emit: (event, context) => sent.push({ event, context }),
    now: () => clock,
    newId: () => `search-${++ids}`
  })
  return {
    telemetry,
    sent,
    tick: (ms: number) => (clock += ms),
    at: () => clock,
    last: () => sent.at(-1)!
  }
}

describe('request properties', () => {
  it('guesses the script most of the letters are in', () => {
    expect(requestScript('a poster for a bake sale')).toBe('latin')
    expect(requestScript('烘焙义卖的海报')).toBe('cjk')
    expect(requestScript('постер для ярмарки')).toBe('cyrillic')
    expect(requestScript('ملصق لبيع المخبوزات')).toBe('arabic')
    expect(requestScript('αφίσα για bake')).toBe('other')
    expect(requestScript('2026 !!')).toBe('none')
  })

  it('counts characters as the user sees them, and words', () => {
    expect(requestProperties('a 🎂 poster')).toEqual({
      request_text: 'a 🎂 poster',
      request_chars_count: 10,
      request_words_count: 3,
      request_script: 'latin'
    })
  })

  it('counts the characters changed between two requests', () => {
    expect(changedChars('a poster', 'a poster')).toBe(0)
    expect(changedChars('a poster', 'a poster for a party')).toBe(12)
    expect(changedChars('a red poster', 'a blue poster')).toBe(7)
    expect(changedChars('aa', 'aaa')).toBe(1)
    expect(changedChars('a cake', 'a 🎂 cake')).toBe(2)
  })
})

describe('createSearchTelemetry', () => {
  const ANSWER_AT = (at: () => number) => ({ triggeredAt: at(), requestedAt: at() })

  it('sends what a search found, how fast, and the request', () => {
    const { telemetry, sent, tick, at } = harness()
    const triggeredAt = at()
    tick(300)
    const requestedAt = at()
    telemetry.requested()
    tick(120)
    telemetry.answered('a poster for a bake sale', ANSWER, { triggeredAt, requestedAt }, true)
    expect(sent).toEqual([
      {
        event: 'comfy.desktop.template_search.searched',
        context: {
          search_id: 'search-1',
          session_search_count: 1,
          request_text: 'a poster for a bake sale',
          request_chars_count: 24,
          request_words_count: 6,
          request_script: 'latin',
          edit_chars_count: null,
          outcome: 'template',
          run_count: 2,
          download_count: 1,
          also_try_count: 1,
          top_match_pct: 87,
          top_match_level: 'strong',
          has_best_match: true,
          process_ms: 38,
          is_cold_start: true,
          bundle_version: '2.3.0',
          input_to_answer_ms: 420,
          request_ms: 120
        }
      }
    ])
  })

  it('counts searches in a session and the characters changed since the last one', () => {
    const { telemetry, last, at } = harness()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), true)
    telemetry.answered('a poster for a party', ANSWER, ANSWER_AT(at), true)
    expect(last().context).toMatchObject({ session_search_count: 2, edit_chars_count: 12 })
  })

  it('names the state search was in when it could not answer', () => {
    const { telemetry, last, at } = harness()
    const offline = { kind: 'unavailable', reason: 'offline' } as const
    telemetry.answered(
      'a poster',
      { kind: 'unavailable', availability: offline },
      ANSWER_AT(at),
      true
    )
    expect(last().context).toMatchObject({
      outcome: 'unavailable',
      availability: 'unavailable',
      reason: 'offline'
    })
    telemetry.answered('a poster', { kind: 'failed' }, ANSWER_AT(at), true)
    expect(last().context).toMatchObject({ outcome: 'failed' })
  })

  it('sends nothing at all when search is switched off', () => {
    const { telemetry, sent, at } = harness()
    telemetry.requested()
    const off = { kind: 'unavailable', availability: { kind: 'off' } } as const
    telemetry.answered('a poster', off, ANSWER_AT(at), true)
    telemetry.abandoned('closed')
    expect(sent).toEqual([])
  })

  it('sends the pick with its list, place, match and the time it took', () => {
    const { telemetry, last, tick, at } = harness()
    tick(50)
    telemetry.answered('a mural', ANSWER, ANSWER_AT(at), true)
    tick(2500)
    expect(telemetry.picked(ROWS, ROWS[2]!, 'pointer')).toBe('search-1')
    expect(last()).toEqual({
      event: 'comfy.desktop.template_search.picked',
      context: {
        search_id: 'search-1',
        list: 'download',
        list_position: 0,
        position: 2,
        template_id: 'mural_template',
        match_pct: null,
        match_level: 'strong',
        is_best_match: false,
        input_method: 'pointer',
        action: 'download',
        results_to_pick_ms: 2500,
        session_ms: 2500,
        session_search_count: 1
      }
    })
  })

  it('keeps the session through a refused open, and ends it once a template opens', () => {
    const { telemetry, sent, at } = harness()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), true)
    telemetry.picked(ROWS, ROWS[0]!, 'keyboard')
    telemetry.opened('search-1', 'poster_template', 'refused')
    telemetry.picked(ROWS, ROWS[1]!, 'keyboard')
    telemetry.opened('search-1', 'banner_template', 'launch')
    telemetry.abandoned('left')
    expect(sent.map((s) => s.event.replace('comfy.desktop.template_search.', ''))).toEqual([
      'searched',
      'picked',
      'open_result',
      'picked',
      'open_result'
    ])
  })

  it('sends an abandon once, and one made before any answer as searching', () => {
    const { telemetry, sent, tick, at } = harness()
    telemetry.abandoned('blurred')
    telemetry.requested()
    tick(1500)
    telemetry.abandoned('closed')
    telemetry.abandoned('left')
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), true)
    tick(4000)
    telemetry.abandoned('cleared')
    expect(sent.filter((s) => s.event.endsWith('abandoned')).map((s) => s.context)).toEqual([
      {
        reason: 'closed',
        session_ms: 1500,
        session_search_count: 0,
        last_results_shown_ms: null,
        last_outcome: 'searching'
      },
      {
        reason: 'cleared',
        session_ms: 4000,
        session_search_count: 1,
        last_results_shown_ms: 4000,
        last_outcome: 'template'
      }
    ])
  })

  it('times a pick from when an answer that arrived hidden was first shown', () => {
    const { telemetry, last, tick, at } = harness()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), false)
    expect(last().context).toMatchObject({ session_search_count: 0 })
    tick(60_000)
    telemetry.reopened()
    tick(800)
    telemetry.picked(ROWS, ROWS[0]!, 'keyboard')
    expect(last().context).toMatchObject({
      search_id: 'search-1',
      results_to_pick_ms: 800,
      session_ms: 800,
      session_search_count: 0,
      is_best_match: true
    })
  })

  it('restarts the shown time, but not the session, when results kept open come back into view', () => {
    const { telemetry, last, tick, at } = harness()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), true)
    tick(30_000)
    telemetry.reopened()
    tick(500)
    telemetry.picked(ROWS, ROWS[0]!, 'keyboard')
    expect(last().context).toMatchObject({
      results_to_pick_ms: 500,
      session_ms: 30_500,
      session_search_count: 1
    })
  })

  it('forgets the answer on screen while a follow-up search runs', () => {
    const { telemetry, last, tick, at } = harness()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), true)
    tick(1000)
    telemetry.requested()
    tick(500)
    expect(telemetry.picked(ROWS, ROWS[0]!, 'keyboard')).toBeNull()
    telemetry.abandoned('closed')
    expect(last().context).toMatchObject({
      session_ms: 1500,
      last_results_shown_ms: null,
      last_outcome: 'searching'
    })
  })

  it('stops counting the shown time while the window is away, and keeps the answer', () => {
    const { telemetry, last, tick, at } = harness()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), true)
    tick(1000)
    telemetry.hidden()
    tick(60_000)
    telemetry.abandoned('left')
    expect(last().context).toMatchObject({
      session_ms: 61_000,
      last_results_shown_ms: null,
      last_outcome: 'template'
    })
  })

  it('does not reopen anything after search answered that it is switched off', () => {
    const { telemetry, sent, at } = harness()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), true)
    telemetry.abandoned('closed')
    const off = { kind: 'unavailable', availability: { kind: 'off' } } as const
    telemetry.answered('a poster', off, ANSWER_AT(at), true)
    telemetry.reopened()
    telemetry.abandoned('closed')
    expect(sent.map((s) => s.event.replace('comfy.desktop.template_search.', ''))).toEqual([
      'searched',
      'abandoned'
    ])
  })

  it('sends how opening the picked template went', () => {
    const { telemetry, last } = harness()
    telemetry.opened('search-1', 'poster_template', 'launch')
    expect(last()).toEqual({
      event: 'comfy.desktop.template_search.open_result',
      context: { search_id: 'search-1', template_id: 'poster_template', result: 'launch' }
    })
  })
})
