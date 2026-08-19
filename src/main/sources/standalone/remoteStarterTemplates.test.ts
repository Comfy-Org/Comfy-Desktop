import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/fetch', () => ({ fetchJSON: vi.fn() }))

import {
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
  it('demotes every recommended after the first in a modality', () => {
    const parsed = parseRemoteStarterTemplates(
      doc([
        entry({ id: 'a', recommended: true }),
        entry({ id: 'b', recommended: true }),
        entry({ id: 'c', recommended: true })
      ])
    )
    expect(
      parsed!.filter((t) => t.recommended),
      'at most one auto-pick per tab'
    ).toHaveLength(1)
    expect(parsed![0]!.id).toBe('a')
  })

  it('never lets a paid card carry the recommendation', () => {
    const parsed = parseRemoteStarterTemplates(
      doc([entry({ id: 'paid', apiNode: true, recommended: true })])
    )
    expect(parsed![0]!.apiNode, 'the card is kept').toBe(true)
    expect(parsed![0]!.recommended, 'but never auto-selected, it spends credits').toBeFalsy()
  })

  it('allows one recommended per modality independently', () => {
    const parsed = parseRemoteStarterTemplates(
      doc([
        entry({ id: 'i', modality: 'image', recommended: true }),
        entry({ id: 'v', modality: 'video', recommended: true })
      ])
    )
    expect(parsed!.filter((t) => t.recommended).map((t) => t.id)).toEqual(['i', 'v'])
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
    expect(url).toContain('desktop-assets.comfy.org')
    expect(opts, 'a stale ETag would strand users on withdrawn content').toMatchObject({
      refresh: true
    })
  })

  it('never rejects, whatever the network does', async () => {
    mockedFetchJSON.mockImplementation(() => Promise.reject(new Error('boom')))
    await expect(loadStarterTemplates()).resolves.toBeDefined()
  })
})
