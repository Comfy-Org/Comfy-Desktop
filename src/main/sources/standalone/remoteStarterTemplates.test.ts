import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/fetch', () => ({ fetchJSON: vi.fn() }))

import {
  STARTER_TEMPLATES_URL,
  parseRemoteStarterTemplates,
  resolveStarterTemplates,
  loadStarterTemplates,
  _resetStarterTemplatesForTest
} from './remoteStarterTemplates'
import { CURATED_TEMPLATES, TEMPLATE_MODALITY_ORDER } from './curatedTemplates'
import { fetchJSON } from '../../lib/fetch'

const mockedFetchJSON = vi.mocked(fetchJSON)

const SNAPSHOT = {
  title: 'T',
  description: 'D',
  sizeBytes: 10,
  mediaSubtype: 'webp'
}

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'remote_one', modality: 'image', snapshot: { ...SNAPSHOT }, ...over }
}

function doc(templates: unknown[]): Record<string, unknown> {
  return { schemaVersion: 1, templates }
}

/** Ids the hardcoded list owns, per modality. */
function bakedIds(modality: string): string[] {
  return CURATED_TEMPLATES.filter((t) => t.modality === modality).map((t) => t.id)
}

describe('A. an unusable document is ignored entirely', () => {
  it.each([
    ['not an object', 'nope'],
    ['a bare array', [{ id: 'a', modality: 'image' }]],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['schemaVersion missing', { templates: [{ id: 'a', modality: 'image', snapshot: SNAPSHOT }] }],
    [
      'schemaVersion from the future',
      { schemaVersion: 2, templates: [{ id: 'a', modality: 'image', snapshot: SNAPSHOT }] }
    ],
    [
      'schemaVersion as a string',
      { schemaVersion: '1', templates: [{ id: 'a', modality: 'image', snapshot: SNAPSHOT }] }
    ],
    ['templates missing', { schemaVersion: 1 }],
    ['templates not an array', { schemaVersion: 1, templates: {} }],
    ['templates empty', { schemaVersion: 1, templates: [] }],
    ['every entry invalid', { schemaVersion: 1, templates: [{ id: 42 }, null] }]
  ])('%s yields null, so the caller keeps the hardcoded list', (_label, raw) => {
    expect(parseRemoteStarterTemplates(raw)).toBeNull()
  })

  it('accepts the escaped-JSON-string form as well as a parsed object', () => {
    const parsed = parseRemoteStarterTemplates(JSON.stringify(doc([entry()])))
    expect(parsed?.map((t) => t.id)).toEqual(['remote_one'])
  })
})

describe('B. one bad entry drops alone', () => {
  it.each([
    ['id not a string', { id: 42 }],
    ['id empty', { id: '' }],
    ['id with a path segment', { id: '../../etc/passwd' }],
    ['id with a slash', { id: 'a/b' }],
    ['id with a space', { id: 'a b' }],
    ['id far too long', { id: 'a'.repeat(129) }],
    ['modality unknown', { modality: 'gif' }],
    ['snapshot not an object', { snapshot: 'x' }],
    ['title empty', { snapshot: { ...SNAPSHOT, title: '' } }],
    ['title not a string', { snapshot: { ...SNAPSHOT, title: 5 } }],
    ['description empty', { snapshot: { ...SNAPSHOT, description: '' } }],
    ['mediaSubtype empty', { snapshot: { ...SNAPSHOT, mediaSubtype: '' } }],
    ['sizeBytes not a number', { snapshot: { ...SNAPSHOT, sizeBytes: 'big' } }],
    ['sizeBytes negative', { snapshot: { ...SNAPSHOT, sizeBytes: -1 } }],
    ['sizeBytes NaN', { snapshot: { ...SNAPSHOT, sizeBytes: Number.NaN } }],
    ['sizeBytes Infinity', { snapshot: { ...SNAPSHOT, sizeBytes: Number.POSITIVE_INFINITY } }]
  ])('%s drops that entry but keeps its neighbour', (_label, over) => {
    const parsed = parseRemoteStarterTemplates(
      doc([entry({ id: 'bad_one', ...over }), entry({ id: 'good_one' })])
    )
    expect(
      parsed?.map((t) => t.id),
      'only the valid neighbour survives'
    ).toEqual(['good_one'])
  })

  it.each([
    ['a missing id', { id: undefined }],
    ['a missing modality', { modality: undefined }],
    ['a missing snapshot', { snapshot: undefined }]
  ])('%s drops that entry but keeps its neighbour', (_label, over) => {
    const bad = entry()
    delete bad[Object.keys(over)[0]!]
    const parsed = parseRemoteStarterTemplates(doc([bad, entry({ id: 'good_one' })]))
    expect(parsed?.map((t) => t.id)).toEqual(['good_one'])
  })

  it.each([
    ['a null entry', null],
    ['a string entry', 'nope'],
    ['a number entry', 7]
  ])('%s drops alone', (_label, bad) => {
    const parsed = parseRemoteStarterTemplates(doc([bad, entry({ id: 'good_one' })]))
    expect(parsed?.map((t) => t.id)).toEqual(['good_one'])
  })

  it('drops a duplicate id, keeping the first occurrence', () => {
    const parsed = parseRemoteStarterTemplates(
      doc([entry({ id: 'dup', snapshot: { ...SNAPSHOT, title: 'first' } }), entry({ id: 'dup' })])
    )
    expect(parsed).toHaveLength(1)
    expect(parsed![0]!.snapshot.title, 'the first occurrence wins').toBe('first')
  })

  it('keeps a zero sizeBytes, which is how an API-node card is spelled', () => {
    const parsed = parseRemoteStarterTemplates(
      doc([entry({ apiNode: true, snapshot: { ...SNAPSHOT, sizeBytes: 0 } })])
    )
    expect(parsed).toHaveLength(1)
  })
})

describe('C. composition rules survive a hostile document', () => {
  it('leaves exactly one auto-pick per tab when the document flags several', () => {
    const remote = parseRemoteStarterTemplates(
      doc([
        entry({ id: 'a', recommended: true }),
        entry({ id: 'b', recommended: true }),
        entry({ id: 'c', recommended: true })
      ])
    )
    const image = resolveStarterTemplates(remote).filter((t) => t.modality === 'image')
    expect(
      image.filter((t) => t.recommended),
      'the resolved slots are where this rule is enforced'
    ).toHaveLength(1)
    expect(image.find((t) => t.recommended)!.id, 'document order breaks the tie').toBe('a')
  })

  it('drops a card claiming to be both paid and recommended', () => {
    const parsed = parseRemoteStarterTemplates(
      doc([entry({ id: 'paid', apiNode: true, recommended: true }), entry({ id: 'ok' })])
    )
    expect(
      parsed?.map((t) => t.id),
      'contradictory under our own invariant, so dropped not rewritten'
    ).toEqual(['ok'])
  })

  it.each([
    ['a string', 'true'],
    ['a number', 1],
    ['null', null],
    ['an object', {}]
  ])('drops an entry whose apiNode is %s rather than a boolean', (_label, apiNode) => {
    const parsed = parseRemoteStarterTemplates(
      doc([entry({ id: 'bad', apiNode }), entry({ id: 'ok' })])
    )
    expect(
      parsed?.map((t) => t.id),
      'a truthy-but-not-true flag would offer a paid card as free'
    ).toEqual(['ok'])
  })

  it.each([
    ['a string', 'true'],
    ['a number', 1],
    ['null', null]
  ])('drops an entry whose recommended is %s rather than a boolean', (_label, recommended) => {
    const parsed = parseRemoteStarterTemplates(
      doc([entry({ id: 'bad', recommended }), entry({ id: 'ok' })])
    )
    expect(parsed?.map((t) => t.id)).toEqual(['ok'])
  })

  it('never lets non-boolean flags smuggle a paid card into the auto-pick', () => {
    const remote = parseRemoteStarterTemplates(
      doc([entry({ id: 'sneaky', apiNode: 'true', recommended: 'true' })])
    )
    const image = resolveStarterTemplates(remote).filter((t) => t.modality === 'image')
    expect(
      image.find((c) => c.id === 'sneaky'),
      'the malformed row never renders'
    ).toBeUndefined()
    expect(image.find((c) => c.recommended)!.apiNode, 'the auto-pick stays free').toBeFalsy()
  })

  it('keeps a paid card that makes no claim to the badge', () => {
    const parsed = parseRemoteStarterTemplates(doc([entry({ id: 'paid', apiNode: true })]))
    expect(parsed![0]!.apiNode).toBe(true)
    expect(parsed![0]!.recommended).toBeUndefined()
  })

  it('allows one recommended per modality independently', () => {
    const remote = parseRemoteStarterTemplates(
      doc([
        entry({ id: 'i', modality: 'image', recommended: true }),
        entry({ id: 'v', modality: 'video', recommended: true })
      ])
    )
    const resolved = resolveStarterTemplates(remote)
    expect(resolved.find((t) => t.modality === 'image' && t.recommended)!.id).toBe('i')
    expect(resolved.find((t) => t.modality === 'video' && t.recommended)!.id).toBe('v')
  })
})

describe('D. the hardcoded list is the floor', () => {
  it('fills every modality to four when there is no remote list', () => {
    const resolved = resolveStarterTemplates(null)
    for (const modality of TEMPLATE_MODALITY_ORDER) {
      expect(
        resolved.filter((t) => t.modality === modality),
        modality
      ).toHaveLength(4)
    }
  })

  it('keeps three good remote entries and backfills the fourth slot', () => {
    const remote = parseRemoteStarterTemplates(
      doc([
        entry({ id: 'r1', modality: 'image' }),
        entry({ id: 'r2', modality: 'image' }),
        entry({ id: 'r3', modality: 'image' }),
        entry({ id: 'bad', modality: 'nope' })
      ])
    )
    const image = resolveStarterTemplates(remote).filter((t) => t.modality === 'image')
    expect(image.map((t) => t.id).slice(0, 3), 'remote entries lead').toEqual(['r1', 'r2', 'r3'])
    expect(image, 'the broken slot is backfilled').toHaveLength(4)
    expect(bakedIds('image'), 'the fourth comes from the hardcoded list').toContain(image[3]!.id)
  })

  it('shows only remote cards when a modality is fully specified', () => {
    const ids = ['r1', 'r2', 'r3', 'r4']
    const remote = parseRemoteStarterTemplates(
      doc(ids.map((id) => entry({ id, modality: 'image' })))
    )
    const image = resolveStarterTemplates(remote).filter((t) => t.modality === 'image')
    expect(
      image.map((t) => t.id),
      'no hardcoded card leaks in'
    ).toEqual(ids)
  })

  it('caps a modality at four even when the document sends more', () => {
    const remote = parseRemoteStarterTemplates(
      doc(Array.from({ length: 9 }, (_, i) => entry({ id: `r${i}`, modality: 'image' })))
    )
    const image = resolveStarterTemplates(remote).filter((t) => t.modality === 'image')
    expect(image).toHaveLength(4)
    expect(image.map((t) => t.id)).toEqual(['r0', 'r1', 'r2', 'r3'])
  })

  it('backfills untouched modalities entirely from the hardcoded list', () => {
    const remote = parseRemoteStarterTemplates(doc([entry({ id: 'r1', modality: 'image' })]))
    const resolved = resolveStarterTemplates(remote)
    for (const modality of TEMPLATE_MODALITY_ORDER.filter((m) => m !== 'image')) {
      expect(
        resolved.filter((t) => t.modality === modality).map((t) => t.id),
        modality
      ).toEqual(bakedIds(modality))
    }
  })

  it('never repeats an id a remote entry already claimed', () => {
    const taken = bakedIds('image')[1]!
    const remote = parseRemoteStarterTemplates(doc([entry({ id: taken, modality: 'image' })]))
    const image = resolveStarterTemplates(remote).filter((t) => t.modality === 'image')
    expect(new Set(image.map((t) => t.id)).size, 'ids collide on the picker option key').toBe(
      image.length
    )
    expect(image, 'a uniqueness check alone would pass on a short tab').toHaveLength(4)
  })

  it('holds every invariant across all four tabs at once', () => {
    const resolved = resolveStarterTemplates(
      parseRemoteStarterTemplates(doc([entry({ id: 'solo', modality: 'audio' })]))
    )
    for (const modality of TEMPLATE_MODALITY_ORDER) {
      const cards = resolved.filter((t) => t.modality === modality)
      expect(cards, `${modality} card count`).toHaveLength(4)
      expect(
        cards.filter((c) => c.recommended).length,
        `${modality} auto-picks`
      ).toBeLessThanOrEqual(1)
      expect(
        cards.filter((c) => c.recommended && c.apiNode),
        `${modality} paid auto-pick`
      ).toEqual([])
    }
    expect(new Set(resolved.map((t) => t.id)).size, 'catalog-wide id uniqueness').toBe(
      resolved.length
    )
  })

  it('gives a tab with no free card no recommendation at all', () => {
    const remote = parseRemoteStarterTemplates(
      doc(
        Array.from({ length: 4 }, (_, i) =>
          entry({ id: `paid${i}`, modality: 'image', apiNode: true })
        )
      )
    )
    const image = resolveStarterTemplates(remote).filter((t) => t.modality === 'image')
    expect(
      image.filter((c) => c.recommended),
      'the wizard offers skip instead'
    ).toEqual([])
  })

  it('promotes a free card when the document names no recommendation', () => {
    const remote = parseRemoteStarterTemplates(
      doc(['a', 'b', 'c', 'd'].map((id) => entry({ id, modality: 'image' })))
    )
    const image = resolveStarterTemplates(remote).filter((t) => t.modality === 'image')
    expect(image.filter((c) => c.recommended)).toHaveLength(1)
    expect(image.find((c) => c.recommended)!.apiNode).toBeFalsy()
  })

  it('keeps the tab order the picker renders in', () => {
    const resolved = resolveStarterTemplates(null)
    const seen = resolved.map((t) => t.modality).filter((m, i, a) => m !== a[i - 1])
    expect(seen).toEqual([...TEMPLATE_MODALITY_ORDER])
  })
})

describe('F. a remote document cannot starve or hijack a tab', () => {
  it('cannot drain a tab by filing its built-in ids under another modality', () => {
    const imageIds = bakedIds('image')
    const remote = parseRemoteStarterTemplates(
      doc(imageIds.map((id) => entry({ id, modality: 'video' })))
    )
    const resolved = resolveStarterTemplates(remote)
    for (const modality of TEMPLATE_MODALITY_ORDER) {
      expect(
        resolved.filter((t) => t.modality === modality),
        `${modality} must keep its four cards`
      ).toHaveLength(4)
    }
  })

  it('ignores a single built-in id filed under the wrong tab', () => {
    const stolen = bakedIds('image')[0]!
    const remote = parseRemoteStarterTemplates(doc([entry({ id: stolen, modality: 'video' })]))
    const resolved = resolveStarterTemplates(remote)
    expect(
      resolved.filter((t) => t.modality === 'image'),
      'the image tab keeps its own card'
    ).toHaveLength(4)
    expect(
      resolved.find((t) => t.id === stolen)!.modality,
      'the id stays on the tab it belongs to'
    ).toBe('image')
  })

  it('keeps the badge on a remote card when the tab is partly backfilled', () => {
    const remote = parseRemoteStarterTemplates(
      doc(['r1', 'r2', 'r3'].map((id) => entry({ id, modality: 'image' })))
    )
    const image = resolveStarterTemplates(remote).filter((t) => t.modality === 'image')
    const winner = image.find((c) => c.recommended)
    expect(winner, 'a tab with a free card always has an auto-pick').toBeDefined()
    expect(
      ['r1', 'r2', 'r3'],
      'the backfilled card must not steal the badge content did not give it'
    ).toContain(winner!.id)
  })

  it('honours the remote entry that does claim the badge', () => {
    const remote = parseRemoteStarterTemplates(
      doc([
        entry({ id: 'r1', modality: 'image' }),
        entry({ id: 'r2', modality: 'image', recommended: true })
      ])
    )
    const image = resolveStarterTemplates(remote).filter((t) => t.modality === 'image')
    expect(image.find((c) => c.recommended)!.id).toBe('r2')
  })
})

describe('G. an oversized or hostile document cannot cost more than it should', () => {
  it('stops reading long past the point where every slot could be filled', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => entry({ id: `r${i}`, modality: 'image' }))
    const parsed = parseRemoteStarterTemplates(doc(huge))
    expect(parsed!.length, 'parsing stops at the MAX_ENTRIES cap').toBe(256)
  })

  it.each([
    ['an absurd magnitude', 1.5e300],
    ['past the cap', 3 * 1024 ** 4],
    ['a fractional byte count', 1.5]
  ])('rejects a sizeBytes that is %s', (_label, sizeBytes) => {
    const parsed = parseRemoteStarterTemplates(
      doc([entry({ id: 'bad', snapshot: { ...SNAPSHOT, sizeBytes } }), entry({ id: 'ok' })])
    )
    expect(
      parsed?.map((t) => t.id),
      'this value drives the install-time disk-space gate'
    ).toEqual(['ok'])
  })

  it.each([
    ['a blank title', { title: '   ' }],
    ['a newline-only description', { description: '\n\n' }],
    ['a blank mediaSubtype', { mediaSubtype: ' ' }]
  ])('rejects %s that would render as an empty card', (_label, over) => {
    const parsed = parseRemoteStarterTemplates(
      doc([entry({ id: 'blank', snapshot: { ...SNAPSHOT, ...over } }), entry({ id: 'ok' })])
    )
    expect(parsed?.map((t) => t.id)).toEqual(['ok'])
  })

  it('trims surrounding whitespace rather than rendering it', () => {
    const parsed = parseRemoteStarterTemplates(
      doc([entry({ snapshot: { ...SNAPSHOT, title: '  Padded  ' } })])
    )
    expect(parsed![0]!.snapshot.title).toBe('Padded')
  })

  it.each([['.'], ['..']])('rejects %s, a directory rather than a template', (id) => {
    const parsed = parseRemoteStarterTemplates(doc([entry({ id }), entry({ id: 'ok' })]))
    expect(
      parsed?.map((t) => t.id),
      'a path segment must never reach a URL or a file path'
    ).toEqual(['ok'])
  })

  it('rejects the skip sentinel smuggled in as an id', () => {
    const parsed = parseRemoteStarterTemplates(doc([entry({ id: 'none' }), entry({ id: 'ok' })]))
    expect(
      parsed?.map((t) => t.id),
      'the sentinel drops while its valid neighbour survives'
    ).toEqual(['ok'])
  })
})

describe('E. the network is never trusted to behave', () => {
  beforeEach(() => {
    mockedFetchJSON.mockReset()
    _resetStarterTemplatesForTest()
  })

  it('serves the remote list when the fetch succeeds', async () => {
    mockedFetchJSON.mockResolvedValue(doc([entry({ id: 'r1', modality: 'image' })]))
    const loaded = await loadStarterTemplates()
    expect(loaded.find((t) => t.id === 'r1')).toBeDefined()
  })

  it.each([
    ['the request rejects', () => Promise.reject(new Error('offline'))],
    ['the body is garbage', () => Promise.resolve('<html>502</html>')],
    ['the body is null', () => Promise.resolve(null)]
  ])('falls back to the hardcoded list when %s', async (_label, impl) => {
    mockedFetchJSON.mockImplementation(impl)
    const loaded = await loadStarterTemplates()
    expect([...loaded].map((t) => t.id).sort(), 'every built-in card, and nothing else').toEqual(
      [...CURATED_TEMPLATES].map((t) => t.id).sort()
    )
  })

  it('is cleared by the catalog reset, so fetch counts stay order-independent', async () => {
    const { resetTemplateCatalogCache } = await import('./templateCatalog')
    mockedFetchJSON.mockResolvedValue(doc([entry()]))
    await loadStarterTemplates()
    resetTemplateCatalogCache()
    await loadStarterTemplates()
    expect(
      mockedFetchJSON,
      'a half-cleared cache makes suites order-dependent'
    ).toHaveBeenCalledTimes(2)
  })

  it('fetches once per process, not once per picker open', async () => {
    mockedFetchJSON.mockResolvedValue(doc([entry({ id: 'r1', modality: 'image' })]))
    await Promise.all([loadStarterTemplates(), loadStarterTemplates()])
    await loadStarterTemplates()
    expect(mockedFetchJSON, 'a content change lands on the next boot').toHaveBeenCalledTimes(1)
  })

  it('reads from R2, bypassing any stale cached copy', async () => {
    mockedFetchJSON.mockResolvedValue(doc([entry()]))
    await loadStarterTemplates()
    const [url, opts] = mockedFetchJSON.mock.calls[0] as [string, Record<string, unknown>]
    expect(url).toBe(STARTER_TEMPLATES_URL)
    expect(opts, 'a stale ETag would strand users on withdrawn content').toMatchObject({
      refresh: true
    })
  })

  it('always returns a full picker, whatever the document says', async () => {
    mockedFetchJSON.mockResolvedValue(doc([entry({ id: 'r1', modality: 'image' })]))
    const loaded = await loadStarterTemplates()
    expect(loaded, 'four cards in each of four tabs').toHaveLength(
      TEMPLATE_MODALITY_ORDER.length * 4
    )
    for (const modality of TEMPLATE_MODALITY_ORDER) {
      expect(
        loaded.filter((t) => t.modality === modality),
        modality
      ).toHaveLength(4)
    }
  })

  it('falls back rather than hanging when the fetch never settles', async () => {
    vi.useFakeTimers()
    try {
      mockedFetchJSON.mockImplementation(() => new Promise(() => {}))
      const pending = loadStarterTemplates()
      await vi.advanceTimersByTimeAsync(10_000)
      const loaded = await pending
      expect(
        loaded.map((t) => t.id).sort(),
        'a stalled read must not leave the picker rendering nothing'
      ).toEqual([...CURATED_TEMPLATES].map((t) => t.id).sort())
    } finally {
      vi.useRealTimers()
    }
  })

  it('never rejects, whatever the network does', async () => {
    mockedFetchJSON.mockImplementation(() => Promise.reject(new Error('boom')))
    await expect(loadStarterTemplates()).resolves.toBeDefined()
  })
})
