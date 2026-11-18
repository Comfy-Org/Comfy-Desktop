import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/fetch', () => ({ fetchJSON: vi.fn() }))

import { hydrateTemplates } from './templateCatalog'
import { thumbnailUrlFor, type TemplateModality } from './curatedTemplates'
import { fetchJSON } from '../../lib/fetch'

const mockedFetchJSON = vi.mocked(fetchJSON)

type ExampleTemplate = Parameters<typeof hydrateTemplates>[0][number]

const IMAGE: ExampleTemplate = {
  id: 'image_example',
  modality: 'image',
  recommended: true,
  snapshot: {
    title: 'Snapshot Title',
    description: 'Snapshot description',
    sizeBytes: 1234,
    mediaSubtype: 'webp'
  }
}

function example(id: string, modality: TemplateModality): ExampleTemplate {
  return { id, modality, snapshot: { ...IMAGE.snapshot } }
}

function indexFor(overrides: Record<string, Record<string, unknown>>, category = 'Image'): unknown {
  return [
    {
      title: category,
      templates: Object.entries(overrides).map(([name, fields]) => ({ name, ...fields }))
    }
  ]
}

async function hydrateOne(
  template: ExampleTemplate,
  index: unknown
): Promise<Awaited<ReturnType<typeof hydrateTemplates>>[number]> {
  mockedFetchJSON.mockResolvedValue(index)
  const [card] = await hydrateTemplates([template])
  return card!
}

describe('hydrateTemplates', () => {
  beforeEach(() => {
    mockedFetchJSON.mockReset()
  })

  it('returns one card per template, in the order given', async () => {
    mockedFetchJSON.mockResolvedValue([])
    const cards = await hydrateTemplates([example('b_video', 'video'), IMAGE])
    expect(cards.map((card) => card.id)).toEqual(['b_video', 'image_example'])
    expect(cards.map((card) => card.recommended)).toEqual([false, true])
  })

  it('prefers live index metadata over the offline snapshot', async () => {
    const card = await hydrateOne(
      IMAGE,
      indexFor({
        [IMAGE.id]: { title: 'Live', description: 'LiveDesc', size: 42, mediaSubtype: 'webp' }
      })
    )
    expect(card.title).toBe('Live')
    expect(card.description).toBe('LiveDesc')
    expect(card.sizeBytes).toBe(42)
    expect(card.category).toBe('Image')
  })

  it('derives a short name + task from the title and tags', async () => {
    const card = await hydrateOne(
      IMAGE,
      indexFor({
        [IMAGE.id]: { title: 'Z-Image-Turbo Text to Image', tags: ['Image', 'Text to Image'] }
      })
    )
    expect(card.name).toBe('Z-Image-Turbo')
    expect(card.task).toBe('Text to Image')
  })

  it('splits a colon title and skips the bare modality tag for the task', async () => {
    const card = await hydrateOne(
      IMAGE,
      indexFor({
        [IMAGE.id]: {
          title: 'Flux.2 [Klein] 4B Distilled: Image Edit',
          tags: ['Image', 'Image Edit']
        }
      })
    )
    expect(card.name).toBe('Flux.2 [Klein] 4B Distilled')
    expect(card.task).toBe('Image Edit')
  })

  it('falls back to a modality-default task when no task tag is present', async () => {
    const card = await hydrateOne(
      IMAGE,
      indexFor({ [IMAGE.id]: { title: 'SDXL Turbo', tags: ['Image'] } })
    )
    expect(card.name).toBe('SDXL Turbo')
    expect(card.task).toBe('Text to Image')
  })

  it('ignores blank/whitespace tags and uses the modality default', async () => {
    const card = await hydrateOne(
      IMAGE,
      indexFor({ [IMAGE.id]: { title: 'X', tags: ['', '  ', 'Image'] } })
    )
    expect(card.task).toBe('Text to Image')
  })

  it('skips the API tag so a card is not subtitled "API"', async () => {
    const card = await hydrateOne(
      IMAGE,
      indexFor({
        [IMAGE.id]: { title: 'Seedream 5.0 Pro: Image Edit', tags: ['API', 'Image Edit'] }
      })
    )
    expect(card.task).toBe('Image Edit')
    expect(card.name).toBe('Seedream 5.0 Pro')
  })

  it('treats "3D Model" as a kind, not a task', async () => {
    const card = await hydrateOne(
      example('3d_example', '3d'),
      indexFor(
        { '3d_example': { title: 'Tripo H3.1: Image to Model', tags: ['3D Model', 'API'] } },
        '3D Model'
      )
    )
    expect(card.task).toBe('Image to 3D')
  })

  it('falls back to the snapshot when the index omits the id', async () => {
    const card = await hydrateOne(IMAGE, [])
    expect(card.title).toBe(IMAGE.snapshot.title)
    expect(card.sizeBytes).toBe(IMAGE.snapshot.sizeBytes)
    expect(card.thumbnailUrl).toBe(thumbnailUrlFor(IMAGE.id, IMAGE.snapshot.mediaSubtype))
  })

  it('ignores a live size of 0 and keeps the snapshot estimate', async () => {
    const card = await hydrateOne(IMAGE, indexFor({ [IMAGE.id]: { size: 0 } }))
    expect(card.sizeBytes).toBe(IMAGE.snapshot.sizeBytes)
  })

  it('returns snapshot-only cards when the index fetch rejects (offline)', async () => {
    mockedFetchJSON.mockRejectedValue(new Error('offline'))
    const [card] = await hydrateTemplates([IMAGE])
    expect(card!.title).toBe(IMAGE.snapshot.title)
  })

  it('survives a malformed index without throwing', async () => {
    const card = await hydrateOne(IMAGE, { not: 'an array' })
    expect(card.title).toBe(IMAGE.snapshot.title)
  })

  it('fetches the index exactly once regardless of template count', async () => {
    mockedFetchJSON.mockResolvedValue([])
    await hydrateTemplates([IMAGE, example('a', 'audio'), example('v', 'video')])
    expect(mockedFetchJSON).toHaveBeenCalledOnce()
  })
})
