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

  it('derives a short name + task from the title and tags', async () => {
    const first = CURATED_TEMPLATES[0]!
    mockedFetchJSON.mockResolvedValue(
      indexFor({
        [first.id]: { title: 'Z-Image-Turbo Text to Image', tags: ['Image', 'Text to Image'] },
      })
    )
    const card = (await loadTemplateCatalog()).find((c) => c.id === first.id)!
    expect(card.name).toBe('Z-Image-Turbo')
    expect(card.task).toBe('Text to Image')
  })

  it('splits a colon title and skips the bare modality tag for the task', async () => {
    const first = CURATED_TEMPLATES[0]!
    mockedFetchJSON.mockResolvedValue(
      indexFor({
        [first.id]: { title: 'Flux.2 [Klein] 4B Distilled: Image Edit', tags: ['Image', 'Image Edit'] },
      })
    )
    const card = (await loadTemplateCatalog()).find((c) => c.id === first.id)!
    expect(card.name).toBe('Flux.2 [Klein] 4B Distilled')
    expect(card.task).toBe('Image Edit')
  })

  it('falls back to a modality-default task when no task tag is present', async () => {
    const first = CURATED_TEMPLATES[0]! // image modality
    mockedFetchJSON.mockResolvedValue(indexFor({ [first.id]: { title: 'SDXL Turbo', tags: ['Image'] } }))
    const card = (await loadTemplateCatalog()).find((c) => c.id === first.id)!
    expect(card.name).toBe('SDXL Turbo')
    expect(card.task).toBe('Text to Image')
  })

  it('ignores blank/whitespace tags and uses the modality default', async () => {
    const first = CURATED_TEMPLATES[0]! // image modality
    mockedFetchJSON.mockResolvedValue(indexFor({ [first.id]: { title: 'X', tags: ['', '  ', 'Image'] } }))
    const card = (await loadTemplateCatalog()).find((c) => c.id === first.id)!
    expect(card.task).toBe('Text to Image')
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

  it('fetches the index exactly once regardless of curated count', async () => {
    mockedFetchJSON.mockResolvedValue([])
    await loadTemplateCatalog()
    expect(mockedFetchJSON).toHaveBeenCalledTimes(1)
  })

  // --- Resilience: a renamed/removed template upstream can only shrink the
  // offering, never break the picker. ---

  /** A live image category with arbitrary template entries. */
  const imageCategory = (templates: Array<Record<string, unknown>>): unknown => [
    { title: 'Image', type: 'image', templates },
  ]

  it('substitutes a live same-modality template when a curated id has vanished', async () => {
    const first = CURATED_TEMPLATES[0]! // image, recommended
    mockedFetchJSON.mockResolvedValue(
      imageCategory([{ name: 'fresh_image_model', title: 'Fresh Model', size: 5, tags: ['Image', 'Text to Image'] }])
    )
    const catalog = await loadTemplateCatalog()
    const recImage = catalog.find((c) => c.modality === 'image' && c.recommended)!
    expect(recImage.id).toBe('fresh_image_model')
    expect(recImage.name).toBe('Fresh Model')
    expect(catalog.some((c) => c.id === first.id)).toBe(false)
  })

  it('skips api/size-less candidates when substituting (must be locally installable)', async () => {
    mockedFetchJSON.mockResolvedValue(
      imageCategory([
        { name: 'api_cloud_thing', title: 'Cloud', size: 5 },
        { name: 'no_size_model', title: 'No Size' },
        { name: 'good_local', title: 'Good Local', size: 9 },
      ])
    )
    const recImage = (await loadTemplateCatalog()).find((c) => c.modality === 'image' && c.recommended)!
    expect(recImage.id).toBe('good_local')
  })

  it('gives distinct substitutes when several ids in a modality vanish', async () => {
    mockedFetchJSON.mockResolvedValue(
      imageCategory([
        { name: 'sub_a', title: 'A', size: 1 },
        { name: 'sub_b', title: 'B', size: 2 },
        { name: 'sub_c', title: 'C', size: 3 },
        { name: 'sub_d', title: 'D', size: 4 },
      ])
    )
    const images = (await loadTemplateCatalog()).filter((c) => c.modality === 'image')
    const ids = images.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length) // no dupes across slots
  })

  it('falls back to the snapshot when online but no substitute exists', async () => {
    const first = CURATED_TEMPLATES[0]!
    // Online (non-empty index) but only an unusable api/size-less image entry.
    mockedFetchJSON.mockResolvedValue(imageCategory([{ name: 'api_only', title: 'Cloud', size: 0 }]))
    const catalog = await loadTemplateCatalog()
    expect(catalog.find((c) => c.id === first.id)!.title).toBe(first.snapshot.title)
  })

  it('keeps the curated snapshot card when offline (empty index → no substitution)', async () => {
    const first = CURATED_TEMPLATES[0]!
    mockedFetchJSON.mockResolvedValue([]) // offline / empty
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
