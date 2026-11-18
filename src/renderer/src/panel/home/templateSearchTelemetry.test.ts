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
    downloadBytes: null,
    ...over
  }
}

const RESULT: TemplateSearchResult = {
  outcome: 'template',
  reply: null,
  run: [candidate('poster_template', { calibrated: 0.874 }), candidate('banner_template')],
  download: [candidate('mural_template', { family: 'mural', needsDownload: true })],
  more: [candidate('zine_template', { family: 'mural', calibrated: 0.5 })],
  alsoTry: [candidate('sticker_template')],
  matched: null,
  partnerSwitch: true,
  partnersShown: true
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
          partners_shown: true,
          outcome: 'template',
          run_count: 2,
          download_count: 1,
          more_count: 1,
          also_try_count: 1,
          top_match_pct: 87,
          top_match_level: 'strong',
          has_best_match: true,
          matched: null,
          matched_names: null,
          matched_names_count: 0,
          has_partner_switch: true,
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
    expect(last().context, 'no answer, so nothing about partner templates').not.toHaveProperty(
      'partners_shown'
    )
    telemetry.answered('a poster', { kind: 'failed' }, ANSWER_AT(at), true)
    expect(last().context).toMatchObject({ outcome: 'failed' })
    expect(last().context).not.toHaveProperty('partners_shown')
    expect(last().context).not.toHaveProperty('has_partner_switch')
  })

  it('sends nothing at all when search is switched off', () => {
    const { telemetry, sent, at } = harness()
    telemetry.requested()
    const off = { kind: 'unavailable', availability: { kind: 'off' } } as const
    telemetry.answered('a poster', off, ANSWER_AT(at), true)
    telemetry.abandoned('closed')
    expect(sent).toEqual([])
  })

  it("names a family's further template's list as more, with no match figure of its own", () => {
    const { telemetry, last, at } = harness()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), true)
    telemetry.picked(ROWS, ROWS[3]!, 'pointer')
    expect(last().context).toMatchObject({
      list: 'more',
      list_position: 0,
      position: 3,
      template_id: 'zine_template',
      match_pct: null,
      match_level: 'none'
    })
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
    telemetry.abandoned('cleared')
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

  it('counts only the time on screen when the window goes away and comes back', () => {
    const { telemetry, last, tick, at } = harness()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), true)
    tick(5000)
    telemetry.hidden()
    tick(60_000)
    telemetry.reopened()
    tick(700)
    telemetry.picked(ROWS, ROWS[0]!, 'keyboard')
    expect(last().context).toMatchObject({
      results_to_pick_ms: 5700,
      session_ms: 65_700,
      session_search_count: 1
    })
  })

  it('counts the shown time of a new answer from nothing', () => {
    const { telemetry, last, tick, at } = harness()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), true)
    tick(5000)
    telemetry.hidden()
    telemetry.reopened()
    telemetry.requested()
    tick(1000)
    telemetry.answered('a poster for a bake sale', ANSWER, ANSWER_AT(at), true)
    tick(300)
    telemetry.picked(ROWS, ROWS[0]!, 'keyboard')
    expect(last().context).toMatchObject({ results_to_pick_ms: 300, session_ms: 6300 })
  })

  it('times an answer that arrived hidden from when it is shown, not from the answer before it', () => {
    const { telemetry, last, tick, at } = harness()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), true)
    tick(5000)
    telemetry.hidden()
    telemetry.requested()
    telemetry.answered('a poster for a bake sale', ANSWER, ANSWER_AT(at), false)
    tick(60_000)
    telemetry.reopened()
    tick(400)
    telemetry.picked(ROWS, ROWS[0]!, 'keyboard')
    expect(last().context).toMatchObject({ results_to_pick_ms: 400, session_search_count: 2 })
  })

  it('sends a give-up after an answer that arrived hidden with that answer, seen for no time', () => {
    const { telemetry, last, tick, at } = harness()
    telemetry.requested()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), false)
    tick(2000)
    telemetry.abandoned('left')
    expect(last().context).toMatchObject({
      session_search_count: 1,
      last_results_shown_ms: 0,
      last_outcome: 'template'
    })
  })

  it('keeps counting when results already on screen are reported shown again', () => {
    const { telemetry, last, tick, at } = harness()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), true)
    tick(1000)
    telemetry.reopened()
    tick(500)
    telemetry.picked(ROWS, ROWS[0]!, 'keyboard')
    expect(last().context).toMatchObject({ results_to_pick_ms: 1500 })
  })

  it('starts the shown time from nothing when the results open again after a give-up', () => {
    const { telemetry, last, tick, at } = harness()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), true)
    tick(3000)
    telemetry.abandoned('closed')
    tick(1000)
    telemetry.reopened()
    tick(500)
    telemetry.picked(ROWS, ROWS[0]!, 'keyboard')
    expect(last().context).toMatchObject({ results_to_pick_ms: 500, session_ms: 500 })
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
    telemetry.hidden()
    telemetry.abandoned('left')
    expect(last().context).toMatchObject({
      session_ms: 61_000,
      last_results_shown_ms: 1000,
      last_outcome: 'template'
    })
  })

  it('names a model-name lookup and what it matched, with no best match or match figure', () => {
    const unscored = (id: string) => candidate(id, { score: null })
    const result: TemplateSearchResult = {
      ...RESULT,
      run: [unscored('qwen_a'), unscored('qwen_b')],
      download: [],
      more: [],
      alsoTry: [],
      matched: ['qwen 2.1', 'kling']
    }
    const { telemetry, sent, at } = harness()
    telemetry.answered('qwen 2.1 kling', { ...ANSWER, result }, ANSWER_AT(at), true)
    expect(sent[0]!.context).toMatchObject({
      matched: 'model',
      matched_names: ['qwen 2.1', 'kling'],
      matched_names_count: 2,
      has_best_match: false,
      top_match_pct: null,
      top_match_level: 'none',
      run_count: 2
    })
  })

  it('describes a download answer by the card shown first, and places each pick where it is shown', () => {
    const result: TemplateSearchResult = {
      ...RESULT,
      outcome: 'download',
      run: [
        candidate('poster', { family: 'poster', calibrated: 0.6 }),
        candidate('open_poster', { family: 'poster', calibrated: 0.6 })
      ],
      download: [candidate('mural', { family: 'mural', needsDownload: true, calibrated: 0.874 })],
      more: [candidate('mural_b', { family: 'mural', calibrated: 0.874 })],
      alsoTry: []
    }
    const rows = searchRows(result)
    const { telemetry, sent, at } = harness()
    telemetry.answered('a mural', { ...ANSWER, result }, ANSWER_AT(at), true)
    expect(sent[0]!.context).toMatchObject({
      top_match_pct: 87,
      top_match_level: 'strong',
      has_best_match: true
    })
    for (const id of ['mural_b', 'open_poster', 'poster'])
      telemetry.picked(
        rows,
        rows.find((row) => row.candidate.templateId === id)!,
        'pointer'
      )
    expect(sent.slice(1).map((event) => event.context)).toMatchObject([
      { template_id: 'mural_b', list: 'more', list_position: 0, position: 1, match_pct: null },
      { template_id: 'open_poster', list: 'run', list_position: 1, position: 3, match_pct: null },
      { template_id: 'poster', list: 'run', list_position: 0, position: 2, match_pct: 60 }
    ])
    expect(sent.slice(1).map((event) => event.context!.match_level)).toEqual([
      'none',
      'none',
      'good'
    ])
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

  it('sends whether partner templates were shown, and whether the answer offered the switch', () => {
    const { telemetry, last, at } = harness()
    const offSearch: TemplateSearchResponse = {
      kind: 'result',
      result: { ...RESULT, partnerSwitch: true, partnersShown: false }
    }
    telemetry.answered('a poster', offSearch, ANSWER_AT(at), true)
    expect(last().context).toMatchObject({ partners_shown: false, has_partner_switch: true })
    const olderSearch: TemplateSearchResponse = {
      kind: 'result',
      result: { ...RESULT, partnerSwitch: false, partnersShown: true }
    }
    telemetry.answered('a poster', olderSearch, ANSWER_AT(at), true)
    expect(last().context).toMatchObject({ partners_shown: true, has_partner_switch: false })
  })

  it('sends a change of the partner switch with the answer on screen', () => {
    const { telemetry, last, at } = harness()
    telemetry.partnerSwitchChanged(false)
    expect(last()).toEqual({
      event: 'comfy.desktop.template_search.partner_switch_changed',
      context: { partners_shown: false, search_id: null, session_search_count: 0 }
    })

    telemetry.requested()
    telemetry.answered('a poster', ANSWER, ANSWER_AT(at), true)
    telemetry.partnerSwitchChanged(true)
    expect(last().context).toEqual({
      partners_shown: true,
      search_id: 'search-1',
      session_search_count: 1
    })
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
