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
  metrics: { processMs: 38, bundleVersion: '2.3.0', protocol: 1, coldStart: true }
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
  })
})

describe('createSearchTelemetry', () => {
  it('sends what a search found, how fast, and the shape of the request', () => {
    const { telemetry, sent, tick, at } = harness()
    const triggeredAt = at()
    tick(300)
    const requestedAt = at()
    tick(120)
    expect(
      telemetry.answered('a poster for a bake sale', ANSWER, { triggeredAt, requestedAt })
    ).toBe('search-1')
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
          protocol_version: 1,
          input_to_answer_ms: 420,
          request_ms: 120
        }
      }
    ])
  })

  it('counts searches in a session and the characters changed since the last one', () => {
    const { telemetry, last, at } = harness()
    const timing = { triggeredAt: at(), requestedAt: at() }
    telemetry.answered('a poster', ANSWER, timing)
    telemetry.answered('a poster for a party', ANSWER, timing)
    expect(last().context).toMatchObject({ session_search_count: 2, edit_chars_count: 12 })
  })

  it('names the state search was in when it could not answer', () => {
    const { telemetry, last, at } = harness()
    telemetry.answered(
      'a poster',
      { kind: 'unavailable', availability: { kind: 'unavailable', reason: 'offline' } },
      { triggeredAt: at(), requestedAt: at() }
    )
    expect(last().context).toMatchObject({
      outcome: 'unavailable',
      availability: 'unavailable',
      reason: 'offline'
    })
    telemetry.answered('a poster', { kind: 'failed' }, { triggeredAt: at(), requestedAt: at() })
    expect(last().context).toMatchObject({ outcome: 'failed' })
  })

  it('sends the pick with its list, place, match and the time it took, then starts afresh', () => {
    const { telemetry, sent, tick, at } = harness()
    tick(50)
    telemetry.answered('a mural', ANSWER, { triggeredAt: at(), requestedAt: at() })
    telemetry.moved()
    telemetry.moved()
    tick(2500)
    expect(telemetry.picked(ROWS, ROWS[2]!, 'pointer')).toBe('search-1')
    expect(sent.at(-1)).toEqual({
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
        session_search_count: 1,
        highlight_moves_count: 2
      }
    })
    telemetry.abandoned('closed')
    expect(sent).toHaveLength(2)
  })

  it('sends an abandon once, only for a session that showed an answer', () => {
    const { telemetry, sent, tick, at } = harness()
    telemetry.abandoned('blurred')
    expect(sent).toEqual([])

    telemetry.answered('a poster', ANSWER, { triggeredAt: at(), requestedAt: at() })
    tick(4000)
    telemetry.abandoned('cleared')
    telemetry.abandoned('left')
    expect(sent.slice(1)).toEqual([
      {
        event: 'comfy.desktop.template_search.abandoned',
        context: {
          reason: 'cleared',
          session_ms: 4000,
          session_search_count: 1,
          last_results_shown_ms: 4000,
          last_outcome: 'template'
        }
      }
    ])
  })

  it('starts a new session on the kept answer when the results open again', () => {
    const { telemetry, last, tick, at } = harness()
    telemetry.answered('a poster', ANSWER, { triggeredAt: at(), requestedAt: at() })
    telemetry.abandoned('closed')
    tick(60_000)
    telemetry.reopened()
    tick(800)
    telemetry.picked(ROWS, ROWS[0]!, 'keyboard')
    expect(last().context).toMatchObject({
      search_id: 'search-1',
      results_to_pick_ms: 800,
      session_ms: 800,
      session_search_count: 0,
      is_best_match: true,
      input_method: 'keyboard'
    })
  })

  it('sends each state shown instead of results once, until something else is shown', () => {
    const { telemetry, sent } = harness()
    telemetry.stateShown({ kind: 'downloading', received: 1, total: 10 })
    telemetry.stateShown({ kind: 'downloading', received: 5, total: 10 })
    telemetry.stateShown({ kind: 'unavailable', reason: 'download_failed' })
    telemetry.stateShown(null)
    telemetry.stateShown({ kind: 'unavailable', reason: 'download_failed' })
    expect(sent.map((s) => s.context)).toEqual([
      { state: 'downloading', reason: null },
      { state: 'unavailable', reason: 'download_failed' },
      { state: 'unavailable', reason: 'download_failed' }
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
