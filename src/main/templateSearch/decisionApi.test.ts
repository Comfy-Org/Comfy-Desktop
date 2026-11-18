import { describe, expect, it } from 'vitest'
import { decideRequest, decisionMetrics, parseDecision } from './decisionApi'

function variant(templateId: string, title: string | null = null) {
  return {
    id: `family/${templateId}@abc`,
    template_id: templateId,
    title,
    thumb: `/thumbs/${templateId}.webp`
  }
}

function candidate(kind: string, templateId: string | null, download: string[] = []) {
  return {
    rank: 1,
    option_id: templateId ? `family:${kind}` : 'agent',
    kind,
    family_id: templateId ? 'family' : null,
    score: 0.9,
    threshold: 0.4,
    variant: templateId ? variant(templateId, `${templateId} title`) : null,
    download
  }
}

function pick(templateId: string, family: string, download: string[] = []) {
  return { ...candidate('as_given', templateId, download), family_id: family }
}

function decision(over: Record<string, unknown> = {}) {
  return {
    outcome: { kind: 'template', reply: null },
    split: {
      run: [
        candidate('rewrite', 'poster_template'),
        candidate('as_given', 'poster_template'),
        candidate('agent', null),
        candidate('as_given', 'logo_template'),
        candidate('as_given', 'banner_template'),
        candidate('as_given', 'sticker_template')
      ],
      download: [
        candidate('as_given', 'logo_template', ['logo_template']),
        candidate('as_given', 'mural_template', ['mural_template', 'mural.safetensors']),
        candidate('as_given', 'zine_template', ['zine.safetensors']),
        candidate('as_given', 'quilt_template', [])
      ]
    },
    options: [
      candidate('as_given', 'poster_template'),
      { ...candidate('as_given', 'flyer_template'), masked: { code: 'needs_file' } },
      candidate('as_given', 'mural_template'),
      candidate('agent', null),
      {
        ...candidate('as_given', 'quilt_template'),
        masked: { code: 'not_installed', detail: 'quilt_template,quilt.safetensors' }
      },
      candidate('as_given', 'card_template'),
      candidate('rewrite', 'card_template'),
      candidate('as_given', 'badge_template'),
      candidate('as_given', 'pennant_template'),
      candidate('as_given', 'ticket_template')
    ],
    nearest: { rows: [{ text: 'never read' }] },
    ...over
  }
}

describe('parseDecision', () => {
  it('keeps the top three distinct runnable templates, best first', () => {
    const result = parseDecision(decision())
    expect(result?.run.map((c) => c.templateId)).toEqual([
      'poster_template',
      'logo_template',
      'banner_template'
    ])
  })

  it('keeps two download candidates not already runnable, listing only what is missing besides the template', () => {
    const result = parseDecision(decision())
    expect(result?.download).toEqual([
      expect.objectContaining({ templateId: 'mural_template', missing: ['mural.safetensors'] }),
      expect.objectContaining({ templateId: 'zine_template', missing: ['zine.safetensors'] })
    ])
  })

  it('suggests up to three more unmasked templates from the ranked list that are not shown already', () => {
    expect(parseDecision(decision())?.alsoTry.map((c) => c.templateId)).toEqual([
      'quilt_template',
      'card_template',
      'badge_template'
    ])
  })

  it('carries each score, and whether it falls below its threshold', () => {
    const body = decision({
      split: {
        run: [
          {
            ...candidate('as_given', 'poster_template'),
            score: 0.91,
            threshold: 0.44,
            calibrated: 0.83,
            calibrated_threshold: 0.59
          }
        ],
        download: []
      },
      options: [
        { ...candidate('as_given', 'weak_template'), score: 0.2, threshold: 0.44, clears: false },
        { ...candidate('as_given', 'close_template'), score: 0.4, threshold: 0.44 }
      ]
    })
    const result = parseDecision(body)!
    expect(result.run[0]).toMatchObject({
      score: 0.91,
      calibrated: 0.83,
      belowThreshold: false
    })
    expect(result.alsoTry[0]!.calibrated).toBeNull()
    expect(result.alsoTry.map((c) => [c.templateId, c.score, c.belowThreshold])).toEqual([
      ['weak_template', 0.2, true],
      ['close_template', 0.4, true]
    ])
  })

  it("trusts the search's own word on clearing the bar over its raw score and threshold", () => {
    const body = decision({
      split: {
        run: [
          { ...candidate('as_given', 'said_below'), score: 0.9, threshold: 0.4, clears: false },
          { ...candidate('as_given', 'said_clear'), score: 0.1, threshold: 0.4, clears: true },
          { ...candidate('as_given', 'no_word'), score: 0.1, threshold: 0.4 }
        ],
        download: []
      }
    })
    expect(parseDecision(body)!.run.map((c) => [c.templateId, c.belowThreshold])).toEqual([
      ['said_below', true],
      ['said_clear', false],
      ['no_word', true]
    ])
  })

  it('marks what needs a download, and what it would download', () => {
    const result = parseDecision(decision())!
    expect(result.run.every((c) => !c.needsDownload)).toBe(true)
    expect(result.download.every((c) => c.needsDownload)).toBe(true)
    expect(result.alsoTry[0]).toMatchObject({
      templateId: 'quilt_template',
      needsDownload: true,
      missing: ['quilt.safetensors']
    })
    expect(result.alsoTry[1]).toMatchObject({ templateId: 'card_template', needsDownload: false })
  })

  it('suggests nothing more when the service sends no ranked list', () => {
    expect(parseDecision(decision({ options: undefined }))?.alsoTry).toEqual([])
  })

  it('still marks an api_ template as partner when the build index does not say', () => {
    const describe = (id: string) => ({ title: id, thumbnailUrl: null, partner: false })
    const body = decision({
      split: { run: [candidate('as_given', 'api_partner_template')], download: [] }
    })
    expect(parseDecision(body, describe)?.run[0]).toMatchObject({ partner: true })
  })

  it('marks partner templates by their name when the build index is not known', () => {
    const body = decision({
      split: { run: [candidate('as_given', 'api_partner_template')], download: [] }
    })
    expect(parseDecision(body)?.run[0]).toMatchObject({ partner: true })
    expect(parseDecision(decision())?.run[0]).toMatchObject({ partner: false })
  })

  it("takes partner templates from the build's own index, which also marks ones without the api_ prefix", () => {
    const describe = (id: string) => ({
      title: id,
      thumbnailUrl: null,
      partner: id === 'poster_template'
    })
    const [poster, logo] = parseDecision(decision(), describe)!.run
    expect(poster).toMatchObject({ templateId: 'poster_template', partner: true })
    expect(logo).toMatchObject({ partner: false })
  })

  it("takes titles and thumbnails from the build's own template index", () => {
    const describe = (id: string) =>
      id === 'poster_template'
        ? {
            title: 'Bake sale poster',
            thumbnailUrl: 'https://thumbs.example.test/poster.webp',
            partner: false
          }
        : null
    const [poster, logo] = parseDecision(decision(), describe)!.run
    expect(poster).toMatchObject({
      title: 'Bake sale poster',
      thumbnailUrl: 'https://thumbs.example.test/poster.webp'
    })
    expect(logo).toMatchObject({ title: 'logo_template title', thumbnailUrl: null })
  })

  it('falls back to the template id when the service has no title', () => {
    const body = decision({
      split: {
        run: [
          { ...candidate('as_given', 'untitled_template'), variant: variant('untitled_template') }
        ],
        download: []
      }
    })
    expect(parseDecision(body)?.run[0]?.title).toBe('untitled_template')
  })

  it('reports the agent and bad-input outcomes with the service reply', () => {
    expect(
      parseDecision(decision({ outcome: { kind: 'bad_input', reply: 'Say what to make.' } }))
    ).toMatchObject({ outcome: 'bad_input', reply: 'Say what to make.' })
    expect(parseDecision(decision({ outcome: { kind: 'agent', reply: null } }))).toMatchObject({
      outcome: 'agent',
      reply: null
    })
  })

  it('reads the download outcome', () => {
    expect(
      parseDecision(decision({ outcome: { kind: 'download', reply: 'Download this first.' } }))
    ).toMatchObject({ outcome: 'download', reply: 'Download this first.' })
  })

  it('shows an outcome this Desktop does not know as nothing fitting, with its reply', () => {
    expect(
      parseDecision(decision({ outcome: { kind: 'search', reply: 'Try the template browser.' } }))
    ).toMatchObject({ outcome: 'unsat', reply: 'Try the template browser.' })
  })

  it('adds an open pick for a partner family to Run when the build has it, and to Download and run when it needs files', () => {
    const body = decision({
      split: {
        run: [candidate('as_given', 'api_poster_template')],
        download: [candidate('as_given', 'mural_template', ['mural.safetensors'])],
        open: [
          candidate('as_given', 'poster_template'),
          candidate('as_given', 'zine_template', ['zine_template', 'zine.safetensors'])
        ]
      }
    })
    const result = parseDecision(body)
    expect(result?.run.map((c) => c.templateId)).toEqual(['api_poster_template', 'poster_template'])
    expect(result?.download).toEqual([
      expect.objectContaining({ templateId: 'zine_template', missing: ['zine.safetensors'] }),
      expect.objectContaining({ templateId: 'mural_template', missing: ['mural.safetensors'] })
    ])
  })

  it('keeps the open picks in view when the search sends more than fits', () => {
    const body = decision({
      split: {
        run: [
          pick('api_poster', 'poster'),
          pick('logo', 'logo'),
          pick('banner', 'banner'),
          pick('sticker', 'sticker'),
          pick('api_flyer', 'flyer')
        ],
        download: [
          pick('mural', 'mural', ['mural.safetensors']),
          pick('zine', 'zine', ['zine.safetensors'])
        ],
        open: [pick('open_poster', 'poster'), pick('open_flyer', 'flyer', ['open_flyer', 'f.bin'])]
      }
    })
    const result = parseDecision(body)
    expect(result?.run.map((c) => c.templateId)).toEqual(['api_poster', 'open_poster', 'logo'])
    expect(result?.download.map((c) => c.templateId)).toEqual(['open_flyer', 'mural'])
  })

  it("puts the search's open pick right after its family's pick, even when Desktop cannot tell that pick is a partner", () => {
    const order = (run: object[], open: object[]) =>
      parseDecision(decision({ split: { run, download: [], open } }))?.run.map((c) => c.templateId)
    const noFamily = (templateId: string) => ({ ...pick(templateId, ''), family_id: null })

    expect(
      order(
        [pick('flyer_partner', 'flyer'), pick('logo', 'logo'), pick('banner', 'banner')],
        [pick('open_flyer', 'flyer')]
      )
    ).toEqual(['flyer_partner', 'open_flyer', 'logo'])
    expect(
      order(
        [pick('logo', 'logo'), pick('api_poster', 'poster'), pick('banner', 'banner')],
        [pick('open_poster', 'poster')]
      )
    ).toEqual(['logo', 'api_poster', 'open_poster'])
    expect(order([noFamily('api_n'), pick('k', 'y')], [noFamily('m')])).toEqual(['api_n', 'k', 'm'])
    expect(order([pick('a', 'p'), pick('b', 'q'), pick('api_c', 'r')], [pick('d', 'r')])).toEqual([
      'a',
      'b',
      'api_c'
    ])
  })

  it('shows an open pick once when the search already listed it', () => {
    const body = decision({
      split: {
        run: [candidate('as_given', 'poster_template')],
        download: [],
        open: [candidate('as_given', 'poster_template')]
      }
    })
    expect(parseDecision(body)?.run.map((c) => c.templateId)).toEqual(['poster_template'])
  })

  it('drops a candidate whose template id could be a path', () => {
    const body = decision({ split: { run: [candidate('as_given', '../escape')], download: [] } })
    expect(parseDecision(body)?.run).toEqual([])
  })

  it.each([
    ['not an object', 'nope'],
    ['no outcome', { split: { run: [], download: [] } }],
    ['no split', { outcome: { kind: 'template' } }]
  ])('refuses %s', (_name, body) => {
    expect(parseDecision(body)).toBeNull()
  })
})

describe('decideRequest', () => {
  it('asks for every outcome kind Desktop reads, with what the build has installed', () => {
    expect(decideRequest('a poster', ['poster_template'])).toEqual({
      text: 'a poster',
      run_n: 8,
      download_m: 8,
      outcomes: ['template', 'agent', 'bad_input', 'unsat', 'download'],
      installed: ['poster_template']
    })
  })

  it('leaves installed out when the build is not known, so every template counts as there', () => {
    expect(decideRequest('a poster', null)).not.toHaveProperty('installed')
  })

  it('asks the search to leave partner templates out only when told to', () => {
    expect(decideRequest('a poster', null, { partnersOff: true })).toMatchObject({
      partner_on: false
    })
    expect(decideRequest('a poster', null)).not.toHaveProperty('partner_on')
  })
})

describe('decisionMetrics', () => {
  it("reads the process's total time and its bundle version", () => {
    expect(
      decisionMetrics({
        protocol: 1,
        bundle: { version: '2.3.0', name: 'templates' },
        latency_ms: { encode: 12.2, total: 30.5 }
      })
    ).toEqual({ processMs: 31, bundleVersion: '2.3.0' })
  })

  it('leaves each figure empty when the answer does not carry it', () => {
    expect(decisionMetrics({ latency_ms: { total: 'fast' }, bundle: [] })).toEqual({
      processMs: null,
      bundleVersion: null
    })
    expect(decisionMetrics(null)).toEqual({ processMs: null, bundleVersion: null })
  })
})
