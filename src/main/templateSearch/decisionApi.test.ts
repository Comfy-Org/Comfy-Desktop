import { describe, expect, it, vi } from 'vitest'
import { createDecisionApiBackend, decisionEndpoint, parseDecision } from './decisionApi'
import type { FetchLike } from './types'

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
        run: [{ ...candidate('as_given', 'poster_template'), score: 0.91, threshold: 0.44 }],
        download: []
      },
      options: [
        { ...candidate('as_given', 'weak_template'), score: 0.2, threshold: 0.44, clears: false },
        { ...candidate('as_given', 'close_template'), score: 0.4, threshold: 0.44 }
      ]
    })
    const result = parseDecision(body)!
    expect(result.run[0]).toMatchObject({ score: 0.91, belowThreshold: false })
    expect(result.alsoTry.map((c) => [c.templateId, c.score, c.belowThreshold])).toEqual([
      ['weak_template', 0.2, true],
      ['close_template', 0.4, true]
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

  it('marks partner templates', () => {
    const body = decision({
      split: { run: [candidate('as_given', 'api_partner_template')], download: [] }
    })
    expect(parseDecision(body)?.run[0]).toMatchObject({ partner: true })
    expect(parseDecision(decision())?.run[0]).toMatchObject({ partner: false })
  })

  it('takes thumbnails from the template repository, not the decision service', () => {
    const [poster] = parseDecision(decision())!.run
    expect(poster!.thumbnailUrl).toBe(
      'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/poster_template-1.webp'
    )
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

  it('drops a candidate whose template id could be a path', () => {
    const body = decision({ split: { run: [candidate('as_given', '../escape')], download: [] } })
    expect(parseDecision(body)?.run).toEqual([])
  })

  it.each([
    ['not an object', 'nope'],
    ['no outcome', { split: { run: [], download: [] } }],
    ['an unknown outcome', { outcome: { kind: 'maybe' }, split: { run: [], download: [] } }],
    ['no split', { outcome: { kind: 'template' } }]
  ])('refuses %s', (_name, body) => {
    expect(parseDecision(body)).toBeNull()
  })
})

describe('decisionEndpoint', () => {
  it('points at the decide route of an http or https service', () => {
    expect(decisionEndpoint('https://decisions.example.test:9443/')).toBe(
      'https://decisions.example.test:9443/api/decide'
    )
    expect(decisionEndpoint('http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000/api/decide')
  })

  it.each(['file:///etc/passwd', 'not a url', 'ftp://decisions.example.test'])(
    'refuses %s',
    (value) => {
      expect(decisionEndpoint(value)).toBeNull()
    }
  )
})

describe('createDecisionApiBackend', () => {
  const endpoint = 'https://decisions.example.test/api/decide'

  it('posts the request text with the prompt writer off', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(JSON.stringify(decision())))
    const backend = createDecisionApiBackend(endpoint, fetch)

    const result = await backend.search('a poster for a bake sale')

    expect(result.outcome).toBe('template')
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(endpoint)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toMatchObject({
      text: 'a poster for a bake sale',
      writer: 'off'
    })
  })

  it('fails when the service answers with an error status', async () => {
    const backend = createDecisionApiBackend(
      endpoint,
      async () => new Response('{"error":"no usable bundle"}', { status: 404 })
    )
    await expect(backend.search('a poster')).rejects.toThrow('404')
  })

  it('fails when the decision cannot be read', async () => {
    const backend = createDecisionApiBackend(endpoint, async () => new Response('{}'))
    await expect(backend.search('a poster')).rejects.toThrow('cannot read')
  })
})
