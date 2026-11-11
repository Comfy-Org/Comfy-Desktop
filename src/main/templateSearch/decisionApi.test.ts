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
