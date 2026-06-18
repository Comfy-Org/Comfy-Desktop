import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/fetch', () => ({ fetchJSON: vi.fn() }))

import { loadTemplateCatalog } from './templateCatalog'
import {
  CURATED_TEMPLATES,
  TEMPLATE_MODALITY_ORDER,
  thumbnailUrlFor,
} from './curatedTemplates'
import { fetchJSON } from '../../lib/fetch'

const mockedFetchJSON = vi.mocked(fetchJSON)

/** A live index with one category whose templates override the given curated
 *  ids' metadata. */
function indexFor(overrides: Record<string, Record<string, unknown>>, category = 'Image'): unknown {
  return [
    {
      title: category,
      templates: Object.entries(overrides).map(([name, fields]) => ({ name, ...fields })),
    },
  ]
}

describe('loadTemplateCatalog', () => {
  beforeEach(() => mockedFetchJSON.mockReset())

  it('returns every curated template, ordered by modality', async () => {
    mockedFetchJSON.mockResolvedValue([])
    const catalog = await loadTemplateCatalog()
    expect(catalog.length).toBe(CURATED_TEMPLATES.length)

    const rank = (m: string) => TEMPLATE_MODALITY_ORDER.indexOf(m as never)
    for (let i = 1; i < catalog.length; i++) {
      expect(rank(catalog[i]!.modality)).toBeGreaterThanOrEqual(rank(catalog[i - 1]!.modality))
    }
  })

  it('prefers live index metadata over the offline snapshot', async () => {
    const first = CURATED_TEMPLATES[0]!
    mockedFetchJSON.mockResolvedValue(
      indexFor({ [first.id]: { title: 'Live', description: 'LiveDesc', size: 42, mediaSubtype: 'webp' } })
    )
    const card = (await loadTemplateCatalog()).find((c) => c.id === first.id)!
    expect(card.title).toBe('Live')
    expect(card.description).toBe('LiveDesc')
    expect(card.sizeBytes).toBe(42)
    expect(card.category).toBe('Image')
  })

  it('falls back to the snapshot when the index omits a curated id', async () => {
    const first = CURATED_TEMPLATES[0]!
    mockedFetchJSON.mockResolvedValue([])
    const card = (await loadTemplateCatalog()).find((c) => c.id === first.id)!
    expect(card.title).toBe(first.snapshot.title)
    expect(card.sizeBytes).toBe(first.snapshot.sizeBytes)
    expect(card.thumbnailUrl).toBe(thumbnailUrlFor(first.id, first.snapshot.mediaSubtype))
  })

  it('ignores a live size of 0 and keeps the snapshot estimate', async () => {
    const first = CURATED_TEMPLATES[0]!
    mockedFetchJSON.mockResolvedValue(indexFor({ [first.id]: { size: 0 } }))
    const card = (await loadTemplateCatalog()).find((c) => c.id === first.id)!
    expect(card.sizeBytes).toBe(first.snapshot.sizeBytes)
  })

  it('returns a snapshot-only catalog when the fetch rejects (offline)', async () => {
    mockedFetchJSON.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    const catalog = await loadTemplateCatalog()
    expect(catalog.length).toBe(CURATED_TEMPLATES.length)
    const first = CURATED_TEMPLATES[0]!
    expect(catalog.find((c) => c.id === first.id)!.title).toBe(first.snapshot.title)
  })

  it('survives a malformed index without throwing', async () => {
    mockedFetchJSON.mockResolvedValue({ not: 'an array' })
    const catalog = await loadTemplateCatalog()
    expect(catalog.length).toBe(CURATED_TEMPLATES.length)
  })

  it('flags an animated preview when the live thumbnail is a video', async () => {
    const first = CURATED_TEMPLATES[0]!
    mockedFetchJSON.mockResolvedValue(indexFor({ [first.id]: { thumbnail: ['output/clip.mp4'] } }))
    const card = (await loadTemplateCatalog()).find((c) => c.id === first.id)!
    expect(card.previewKind).toBe('animated')
  })

  it('fetches the index exactly once regardless of curated count', async () => {
    mockedFetchJSON.mockResolvedValue([])
    await loadTemplateCatalog()
    expect(mockedFetchJSON).toHaveBeenCalledTimes(1)
  })

  // --- Resilience: a renamed/removed template upstream can only shrink the
  // offering, never break the picker. ---

  it('keeps a card whose id no longer exists upstream (snapshot stands in)', async () => {
    const first = CURATED_TEMPLATES[0]!
    // Index that resolves NONE of the curated ids (simulates a mass rename).
    mockedFetchJSON.mockResolvedValue(indexFor({ totally_unrelated: { title: 'X' } }))
    const catalog = await loadTemplateCatalog()
    expect(catalog.length).toBe(CURATED_TEMPLATES.length)
    expect(catalog.find((c) => c.id === first.id)!.title).toBe(first.snapshot.title)
  })

  it('never yields duplicate ids', async () => {
    mockedFetchJSON.mockResolvedValue([])
    const ids = (await loadTemplateCatalog()).map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only emits modalities the picker can tab', async () => {
    mockedFetchJSON.mockResolvedValue([])
    const catalog = await loadTemplateCatalog()
    for (const card of catalog) {
      expect(TEMPLATE_MODALITY_ORDER).toContain(card.modality)
    }
  })
})
