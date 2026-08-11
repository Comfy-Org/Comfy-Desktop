import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as TemplatePinModule from './templatePin'

vi.mock('../../lib/fetch', () => ({ fetchJSON: vi.fn() }))

const getStarterTemplatesAsync = vi.fn()
vi.mock('./starterTemplateManifest', () => ({
  getStarterTemplatesAsync: () => getStarterTemplatesAsync()
}))

const resolveTemplatePackageVersion = vi.fn()
vi.mock('./templatePin', async (importOriginal) => {
  const actual = await importOriginal<typeof TemplatePinModule>()
  return {
    ...actual,
    resolveTemplatePackageVersion: (...a: unknown[]) => resolveTemplatePackageVersion(...a)
  }
})

import { loadTemplateCatalog, resetTemplateCatalogCache } from './templateCatalog'
import { CURATED_TEMPLATES, INDEX_URL, TEMPLATE_MODALITY_ORDER } from './curatedTemplates'
import type { HydratedTemplate } from './templateCatalog'
import { fetchJSON } from '../../lib/fetch'

const mockedFetchJSON = vi.mocked(fetchJSON)

/** Cards only; `assetBase` is asserted separately where it matters. */
const loadCards = async (opts?: { comfyVersion?: string | null }): Promise<HydratedTemplate[]> =>
  (await loadTemplateCatalog(opts)).templates

function category(
  type: string,
  title: string,
  templates: Record<string, Record<string, unknown>>
): unknown {
  return {
    type,
    title,
    templates: Object.entries(templates).map(([name, fields]) => ({
      size: 1_000,
      mediaSubtype: 'webp',
      ...fields,
      name
    }))
  }
}

/** Substitute candidates a real index always carries (100+ image, 50+ video). */
function spares(): unknown[] {
  const titles: Record<string, string> = {
    image: 'Image',
    video: 'Video',
    audio: 'Audio',
    '3d': '3D Model'
  }
  return TEMPLATE_MODALITY_ORDER.map((modality) =>
    category(
      modality,
      titles[modality]!,
      Object.fromEntries(
        Array.from({ length: 4 }, (_, i) => [`spare_${modality}_${i}`, { title: `Spare ${i}` }])
      )
    )
  )
}

function indexWithCurated(extra: unknown[] = []): unknown[] {
  const byModality: Record<string, Record<string, Record<string, unknown>>> = {}
  for (const t of CURATED_TEMPLATES) {
    byModality[t.modality] ??= {}
    byModality[t.modality]![t.id] = {}
  }
  const titles: Record<string, string> = {
    image: 'Image',
    video: 'Video',
    audio: 'Audio',
    '3d': '3D Model'
  }
  return [
    ...Object.entries(byModality).map(([type, templates]) =>
      category(type, titles[type]!, templates)
    ),
    ...extra
  ]
}

function expectFourByFour(catalog: HydratedTemplate[]): void {
  for (const modality of TEMPLATE_MODALITY_ORDER) {
    const cards = catalog.filter((c) => c.modality === modality)
    expect(cards.length, `${modality} card count`).toBe(4)
    const recommended = cards.filter((c) => c.recommended)
    expect(recommended.length, `${modality} recommended count`).toBeLessThanOrEqual(1)
    expect(
      recommended.filter((c) => c.apiNode),
      `${modality} paid auto-pick`
    ).toEqual([])
  }
  expect(new Set(catalog.map((c) => c.id)).size, 'duplicate ids across catalog').toBe(
    catalog.length
  )
  const recommendedIds = catalog.filter((c) => c.recommended).map((c) => c.id)
  expect(new Set(recommendedIds).size, 'an id is recommended in at most one tab').toBe(
    recommendedIds.length
  )
}

beforeEach(() => {
  mockedFetchJSON.mockReset()
  getStarterTemplatesAsync.mockReset()
  resolveTemplatePackageVersion.mockReset()
  resetTemplateCatalogCache()
  getStarterTemplatesAsync.mockResolvedValue(CURATED_TEMPLATES)
  resolveTemplatePackageVersion.mockResolvedValue(null)
})

describe('remote payload drives the card list', () => {
  it('renders the payload list instead of the baked-in one', async () => {
    getStarterTemplatesAsync.mockResolvedValue([
      { id: 'payload_img', modality: 'image', recommended: true },
      ...CURATED_TEMPLATES.filter((t) => t.modality !== 'image')
    ])
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated([category('image', 'Image', { payload_img: { title: 'Payload Image' } })])
    )
    const catalog = await loadCards()
    expect(catalog.find((c) => c.id === 'payload_img')?.title).toBe('Payload Image')
    expectFourByFour(catalog)
  })

  it('backfills modalities the payload does not mention', async () => {
    getStarterTemplatesAsync.mockResolvedValue(
      CURATED_TEMPLATES.filter((t) => t.modality === 'image')
    )
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    expectFourByFour(await loadCards())
  })

  it('truncates a modality carrying more than four entries', async () => {
    const extras = Array.from({ length: 5 }, (_, i) => ({
      id: `image_extra_${i}`,
      modality: 'image' as const
    }))
    getStarterTemplatesAsync.mockResolvedValue([...CURATED_TEMPLATES, ...extras])
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated([
        category('image', 'Image', Object.fromEntries(extras.map((e) => [e.id, {}])))
      ])
    )
    expectFourByFour(await loadCards())
  })

  it('never exceeds four even when substitutes are abundant', async () => {
    getStarterTemplatesAsync.mockResolvedValue([
      { id: 'image_gone_a', modality: 'image', recommended: true },
      { id: 'image_gone_b', modality: 'image' },
      { id: 'image_gone_c', modality: 'image' },
      { id: 'image_gone_d', modality: 'image' },
      ...CURATED_TEMPLATES.filter((t) => t.modality !== 'image')
    ])
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated([
        category(
          'image',
          'Image',
          Object.fromEntries(
            Array.from({ length: 20 }, (_, i) => [`plenty_${i}`, { title: `Plenty ${i}` }])
          )
        )
      ])
    )
    const catalog = await loadCards()
    expect(catalog.filter((c) => c.modality === 'image')).toHaveLength(4)
    expectFourByFour(catalog)
  })

  it('tops a one-entry modality up to four', async () => {
    getStarterTemplatesAsync.mockResolvedValue([
      { id: 'image_solo', modality: 'image', recommended: true },
      ...CURATED_TEMPLATES.filter((t) => t.modality !== 'image')
    ])
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated([category('image', 'Image', { image_solo: {} })])
    )
    const catalog = await loadCards()
    expect(catalog.find((c) => c.id === 'image_solo')).toBeDefined()
    expectFourByFour(catalog)
  })

  it('collapses duplicate ids and refills the freed slot', async () => {
    const image = CURATED_TEMPLATES.filter((t) => t.modality === 'image')
    getStarterTemplatesAsync.mockResolvedValue([
      image[0]!,
      image[0]!,
      image[1]!,
      ...CURATED_TEMPLATES.filter((t) => t.modality !== 'image')
    ])
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    expectFourByFour(await loadCards())
  })

  it('backfills wholly when the payload is empty', async () => {
    getStarterTemplatesAsync.mockResolvedValue([])
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    expectFourByFour(await loadCards())
  })
})

describe('version gate via the package pin', () => {
  it('hides a template the pinned index does not carry, and substitutes', async () => {
    const missing = 'video_minimax_h3_t2v'
    resolveTemplatePackageVersion.mockResolvedValue('0.11.12')
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated([
        category('video', 'Video', { live_video_sub: { title: 'Live Video Sub' } })
      ])
        .map((c) => {
          const cat = c as { type?: string; templates?: { name: string }[] }
          if (cat.type === 'video' && cat.templates) {
            cat.templates = cat.templates.filter((t) => t.name !== missing)
          }
          return cat
        })
        .concat(spares() as never[])
    )
    const catalog = await loadCards({ comfyVersion: 'v0.28.2' })
    expect(catalog.find((c) => c.id === missing)).toBeUndefined()
    expectFourByFour(catalog)
  })

  it('fetches the index the target ComfyUI pins, not main', async () => {
    resolveTemplatePackageVersion.mockResolvedValue('0.11.12')
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    await loadCards({ comfyVersion: 'v0.28.2' })
    expect(resolveTemplatePackageVersion).toHaveBeenCalledWith('v0.28.2')
    expect(
      mockedFetchJSON,
      'reads the index ComfyUI v0.28.2 pins, not main, under a bounded budget'
    ).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/v0.11.12/templates/index.json',
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })

  it('fetches the live main index when no pin resolves', async () => {
    resolveTemplatePackageVersion.mockResolvedValue(null)
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    await loadCards({ comfyVersion: null })
    expect(mockedFetchJSON).toHaveBeenCalledWith(INDEX_URL, expect.anything())
  })

  it('keeps that template when the pinned index carries it', async () => {
    resolveTemplatePackageVersion.mockResolvedValue('0.11.31')
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    const catalog = await loadCards({ comfyVersion: 'v0.30.2' })
    expect(catalog.find((c) => c.id === 'video_minimax_h3_t2v')).toBeDefined()
    expectFourByFour(catalog)
  })

  it('fails open when the version is unknown', async () => {
    resolveTemplatePackageVersion.mockResolvedValue(null)
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    const catalog = await loadCards({ comfyVersion: null })
    expectFourByFour(catalog)
  })

  it('fails open when the pin lookup rejects', async () => {
    resolveTemplatePackageVersion.mockRejectedValue(new Error('offline'))
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    expectFourByFour(await loadCards({ comfyVersion: 'v0.30.2' }))
  })

  it('varies the cache key with comfyVersion', async () => {
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    resolveTemplatePackageVersion.mockResolvedValue('0.11.31')
    await loadCards({ comfyVersion: 'v0.30.2' })
    await loadCards({ comfyVersion: 'v0.28.2' })
    expect(
      mockedFetchJSON.mock.calls.length,
      'a different target version re-resolves rather than serving the previous filter'
    ).toBeGreaterThan(1)
  })

  it('still caches repeat reads for the same comfyVersion', async () => {
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    resolveTemplatePackageVersion.mockResolvedValue('0.11.31')
    await loadCards({ comfyVersion: 'v0.30.2' })
    const before = mockedFetchJSON.mock.calls.length
    await loadCards({ comfyVersion: 'v0.30.2' })
    expect(mockedFetchJSON.mock.calls.length).toBe(before)
  })
})

describe('upstream compatibility signals', () => {
  it('drops a card requiring custom nodes', async () => {
    const target = CURATED_TEMPLATES.find((t) => t.modality === 'image' && !t.apiNode)!
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated()
        .map((c) => {
          const cat = c as { type?: string; templates?: Record<string, unknown>[] }
          if (cat.type === 'image') {
            for (const t of cat.templates ?? []) {
              if (t.name === target.id) t.requiresCustomNodes = ['comfyui-kjnodes']
            }
          }
          return cat
        })
        .concat(spares() as never[])
    )
    const catalog = await loadCards()
    expect(catalog.find((c) => c.id === target.id)).toBeUndefined()
    expectFourByFour(catalog)
  })

  it('keeps a card whose requiresCustomNodes is empty', async () => {
    const target = CURATED_TEMPLATES.find((t) => t.modality === 'image' && !t.apiNode)!
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated().map((c) => {
        const cat = c as { type?: string; templates?: Record<string, unknown>[] }
        if (cat.type === 'image') {
          for (const t of cat.templates ?? []) {
            if (t.name === target.id) t.requiresCustomNodes = []
          }
        }
        return cat
      })
    )
    expect((await loadCards()).find((c) => c.id === target.id)).toBeDefined()
  })

  it('drops a cloud-only card', async () => {
    const target = CURATED_TEMPLATES.find((t) => t.modality === 'image' && !t.apiNode)!
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated()
        .map((c) => {
          const cat = c as { type?: string; templates?: Record<string, unknown>[] }
          if (cat.type === 'image') {
            for (const t of cat.templates ?? []) {
              if (t.name === target.id) t.includeOnDistributions = ['cloud']
            }
          }
          return cat
        })
        .concat(spares() as never[])
    )
    const catalog = await loadCards()
    expect(catalog.find((c) => c.id === target.id)).toBeUndefined()
    expectFourByFour(catalog)
  })

  it.each([[['local']], [['local', 'cloud']], [undefined]])(
    'keeps a card with includeOnDistributions %s',
    async (includeOnDistributions) => {
      const target = CURATED_TEMPLATES.find((t) => t.modality === 'image' && !t.apiNode)!
      mockedFetchJSON.mockResolvedValue(
        indexWithCurated().map((c) => {
          const cat = c as { type?: string; templates?: Record<string, unknown>[] }
          if (cat.type === 'image') {
            for (const t of cat.templates ?? []) {
              if (t.name === target.id) t.includeOnDistributions = includeOnDistributions
            }
          }
          return cat
        })
      )
      expect((await loadCards()).find((c) => c.id === target.id)).toBeDefined()
    }
  )
})

describe('substitution quality', () => {
  it('substitutes within the same modality only', async () => {
    getStarterTemplatesAsync.mockResolvedValue([
      { id: 'video_gone', modality: 'video', recommended: true },
      ...CURATED_TEMPLATES.filter((t) => t.modality !== 'video').slice(0, 12)
    ])
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated([category('video', 'Video', { real_video: { title: 'Real Video' } })])
    )
    const catalog = await loadCards()
    for (const card of catalog.filter((c) => c.modality === 'video')) {
      expect(card.id.startsWith('image_'), card.id).toBe(false)
    }
    expectFourByFour(catalog)
  })

  it('never substitutes from a non-allowlisted category', async () => {
    getStarterTemplatesAsync.mockResolvedValue([
      { id: 'image_gone_a', modality: 'image', recommended: true },
      { id: 'image_gone_b', modality: 'image' },
      { id: 'image_gone_c', modality: 'image' },
      { id: 'image_gone_d', modality: 'image' },
      ...CURATED_TEMPLATES.filter((t) => t.modality !== 'image')
    ])
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated([
        category('image', 'Node Basics', { basics_trap: { title: 'Node Basics Trap' } }),
        category('image', 'Utility', { utility_trap: { title: 'Utility Trap' } }),
        category('image', 'LLM', { llm_trap: { title: 'LLM Trap' } }),
        category('image', 'Getting Started', { gs_trap: { title: 'Getting Started Trap' } })
      ])
    )
    const catalog = await loadCards()
    for (const trap of ['basics_trap', 'utility_trap', 'llm_trap', 'gs_trap']) {
      expect(
        catalog.find((c) => c.id === trap),
        trap
      ).toBeUndefined()
    }
    expectFourByFour(catalog)
  })

  it('does substitute from an allowlisted Use Cases category', async () => {
    getStarterTemplatesAsync.mockResolvedValue([
      { id: 'image_gone', modality: 'image', recommended: true },
      ...CURATED_TEMPLATES.filter((t) => t.modality !== 'image')
    ])
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated([category('image', 'Use Cases', { use_case_ok: { title: 'Use Case Sub' } })])
    )
    const catalog = await loadCards()
    expect(
      catalog.find((c) => c.id === 'use_case_ok'),
      'an allowlisted Use Cases entry is eligible as a substitute'
    ).toBeDefined()
    expectFourByFour(catalog)
  })

  it('keeps an explicitly-named id even from a non-allowlisted category', async () => {
    getStarterTemplatesAsync.mockResolvedValue([
      { id: 'utility_pick', modality: 'image', recommended: true },
      ...CURATED_TEMPLATES.filter((t) => t.modality !== 'image')
    ])
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated([category('image', 'Utility', { utility_pick: { title: 'Chosen' } })])
    )
    const catalog = await loadCards()
    expect(catalog.find((c) => c.id === 'utility_pick')?.title).toBe('Chosen')
    expectFourByFour(catalog)
  })

  it('never substitutes an API-node slot', async () => {
    const apiCard = CURATED_TEMPLATES.find((t) => t.apiNode && t.modality === 'image')!
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated().map((c) => {
        const cat = c as { type?: string; templates?: { name: string }[] }
        if (cat.type === 'image' && cat.templates) {
          cat.templates = cat.templates.filter((t) => t.name !== apiCard.id)
        }
        return cat
      })
    )
    const catalog = await loadCards()
    const card = catalog.find((c) => c.id === apiCard.id)
    expect(card?.apiNode).toBe(true)
    expectFourByFour(catalog)
  })

  it('skips api_ and size-less substitution candidates', async () => {
    getStarterTemplatesAsync.mockResolvedValue([
      { id: 'image_gone', modality: 'image', recommended: true },
      ...CURATED_TEMPLATES.filter((t) => t.modality !== 'image')
    ])
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated([
        category('image', 'Image', {
          api_should_skip: { title: 'API' },
          sizeless_should_skip: { title: 'Sizeless', size: 0 },
          good_sub: { title: 'Good Sub' }
        })
      ])
    )
    const catalog = await loadCards()
    expect(catalog.find((c) => c.id === 'api_should_skip')).toBeUndefined()
    expect(catalog.find((c) => c.id === 'sizeless_should_skip')).toBeUndefined()
    expectFourByFour(catalog)
  })

  it('warns naming the id that went missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      getStarterTemplatesAsync.mockResolvedValue([
        { id: 'image_typo_id', modality: 'image', recommended: true },
        ...CURATED_TEMPLATES.filter((t) => t.modality !== 'image')
      ])
      mockedFetchJSON.mockResolvedValue(
        indexWithCurated([category('image', 'Image', { sub_for_typo: {} })])
      )
      await loadCards()
      expect(warn.mock.calls.flat().join(' ')).toContain('image_typo_id')
    } finally {
      warn.mockRestore()
    }
  })

  it('does not substitute when offline', async () => {
    mockedFetchJSON.mockRejectedValue(new Error('offline'))
    const catalog = await loadCards()
    for (const curated of CURATED_TEMPLATES) {
      expect(
        catalog.find((c) => c.id === curated.id),
        curated.id
      ).toBeDefined()
    }
    expectFourByFour(catalog)
  })

  it('degrades to baked-in rather than borrowing another modality', async () => {
    getStarterTemplatesAsync.mockResolvedValue([
      { id: '3d_gone_a', modality: '3d', recommended: true },
      { id: '3d_gone_b', modality: '3d' },
      { id: '3d_gone_c', modality: '3d' },
      { id: '3d_gone_d', modality: '3d' },
      ...CURATED_TEMPLATES.filter((t) => t.modality !== '3d')
    ])
    mockedFetchJSON.mockResolvedValue(
      indexWithCurated([
        category('image', 'Image', {
          spare_1: {},
          spare_2: {},
          spare_3: {},
          spare_4: {},
          spare_5: {}
        })
      ])
    )
    const catalog = await loadCards()
    for (const card of catalog.filter((c) => c.modality === '3d')) {
      expect(card.id.startsWith('spare_'), card.id).toBe(false)
    }
    expectFourByFour(catalog)
  })
})

describe('recommended invariants after resolution', () => {
  it('promotes a recommendation when the payload names none', async () => {
    getStarterTemplatesAsync.mockResolvedValue(
      CURATED_TEMPLATES.map(({ recommended: _drop, ...rest }) => rest as never)
    )
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    expectFourByFour(await loadCards())
  })

  it('keeps the recommendation off an api card in an all-api modality', async () => {
    getStarterTemplatesAsync.mockResolvedValue([
      { id: 'api_a', modality: 'image', apiNode: true },
      { id: 'api_b', modality: 'image', apiNode: true },
      { id: 'api_c', modality: 'image', apiNode: true },
      { id: 'api_d', modality: 'image', apiNode: true },
      ...CURATED_TEMPLATES.filter((t) => t.modality !== 'image')
    ])
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    const catalog = await loadCards()
    const rec = catalog.filter((c) => c.modality === 'image' && c.recommended)
    expect(rec).toHaveLength(1)
    expect(rec[0]!.apiNode).toBe(false)
  })
})

describe('availability window', () => {
  it('hides an entry whose window has not opened, and one that has closed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
    try {
      getStarterTemplatesAsync.mockResolvedValue([
        { id: 'image_future', modality: 'image', availableFrom: '2026-12-01T00:00:00Z' },
        { id: 'image_expired', modality: 'image', availableUntil: '2026-01-01T00:00:00Z' },
        { id: 'image_open', modality: 'image', recommended: true },
        ...CURATED_TEMPLATES.filter((t) => t.modality !== 'image')
      ])
      mockedFetchJSON.mockResolvedValue(
        indexWithCurated([
          category('image', 'Image', { image_future: {}, image_expired: {}, image_open: {} })
        ])
      )
      const catalog = await loadCards()
      expect(catalog.find((c) => c.id === 'image_future')).toBeUndefined()
      expect(catalog.find((c) => c.id === 'image_expired')).toBeUndefined()
      expect(catalog.find((c) => c.id === 'image_open')).toBeDefined()
      expectFourByFour(catalog)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let backfill re-add a baked-in card whose window has closed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
    try {
      const retired = CURATED_TEMPLATES.find((t) => t.modality === 'image')!
      getStarterTemplatesAsync.mockResolvedValue([
        { ...retired, availableUntil: '2026-01-01T00:00:00Z' },
        ...CURATED_TEMPLATES.filter((t) => t.modality !== 'image')
      ])
      mockedFetchJSON.mockResolvedValue(indexWithCurated(spares()))
      const catalog = await loadCards()
      expect(
        catalog.find((c) => c.id === retired.id),
        'a retired card must not walk back in through the backfill door'
      ).toBeUndefined()
      expectFourByFour(catalog)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let backfill stage a baked-in card ahead of its window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
    try {
      const upcoming = CURATED_TEMPLATES.find((t) => t.modality === 'image')!
      getStarterTemplatesAsync.mockResolvedValue([
        { ...upcoming, availableFrom: '2026-12-01T00:00:00Z' },
        ...CURATED_TEMPLATES.filter((t) => t.modality !== 'image')
      ])
      mockedFetchJSON.mockResolvedValue(indexWithCurated(spares()))
      const catalog = await loadCards()
      expect(
        catalog.find((c) => c.id === upcoming.id),
        'a staged card must wait for the window it was given'
      ).toBeUndefined()
      expectFourByFour(catalog)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('every source failing at once', () => {
  it('holds 4x4 with a garbage payload, no index, and an unknown version', async () => {
    getStarterTemplatesAsync.mockResolvedValue(CURATED_TEMPLATES)
    mockedFetchJSON.mockRejectedValue(new Error('offline'))
    resolveTemplatePackageVersion.mockRejectedValue(new Error('offline'))
    expectFourByFour(await loadCards({ comfyVersion: null }))
  })

  it('holds 4x4 when the manifest read itself throws', async () => {
    getStarterTemplatesAsync.mockRejectedValue(new Error('flag exploded'))
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    expectFourByFour(await loadCards())
  })

  it('holds 4x4 when the payload is every kind of broken at once', async () => {
    getStarterTemplatesAsync.mockResolvedValue([
      { id: 'gone_1', modality: 'image', recommended: true },
      { id: 'gone_2', modality: 'video' },
      { id: 'api_only', modality: 'audio', apiNode: true },
      { id: 'gone_3', modality: '3d' }
    ])
    mockedFetchJSON.mockResolvedValue([])
    expectFourByFour(await loadCards({ comfyVersion: 'v0.28.2' }))
  })
})

describe('4x4 when the index offers no substitute candidates', () => {
  function bareIndex(absent: string[] = []): unknown[] {
    const byMod: Record<string, Record<string, Record<string, unknown>>> = {}
    for (const t of CURATED_TEMPLATES) {
      if (absent.includes(t.id)) continue
      byMod[t.modality] ??= {}
      byMod[t.modality]![t.id] = {}
    }
    const titles: Record<string, string> = {
      image: 'Image',
      video: 'Video',
      audio: 'Audio',
      '3d': '3D Model'
    }
    return Object.entries(byMod).map(([type, tpls]) => category(type, titles[type]!, tpls))
  }

  it('holds when the recommended card is missing and nothing can substitute', async () => {
    resolveTemplatePackageVersion.mockResolvedValue('0.11.12')
    mockedFetchJSON.mockResolvedValue(bareIndex(['video_minimax_h3_t2v']))
    const catalog = await loadCards({ comfyVersion: 'v0.28.2' })
    expectFourByFour(catalog)
  })

  it.each(CURATED_TEMPLATES.map((t) => [t.modality, t.id] as const))(
    'holds for %s when %s is absent from the index',
    async (_modality, missingId) => {
      mockedFetchJSON.mockResolvedValue(bareIndex([missingId]))
      expectFourByFour(await loadCards({ comfyVersion: 'v0.28.2' }))
    }
  )

  it('holds when every card in a modality is absent', async () => {
    const video = CURATED_TEMPLATES.filter((t) => t.modality === 'video').map((t) => t.id)
    mockedFetchJSON.mockResolvedValue(bareIndex(video))
    expectFourByFour(await loadCards({ comfyVersion: 'v0.28.2' }))
  })

  it('holds when the index carries no allowlisted category at all', async () => {
    mockedFetchJSON.mockResolvedValue([
      category('image', 'Node Basics', { nb_1: {}, nb_2: {} }),
      category('video', 'Utility', { ut_1: {} })
    ])
    expectFourByFour(await loadCards({ comfyVersion: 'v0.28.2' }))
  })

  it('never lets a substitute steal a baked-in card still owed a slot', async () => {
    mockedFetchJSON.mockResolvedValue(bareIndex(['video_minimax_h3_t2v']))
    const catalog = await loadCards({ comfyVersion: 'v0.28.2' })
    const video = catalog.filter((c) => c.modality === 'video').map((c) => c.id)
    for (const id of [
      'api_seedance2_0_r2v',
      'wan2.1_fun_inp',
      'video_wan2.1_fun_camera_v1.1_1.3B'
    ]) {
      expect(video, `${id} kept its own slot`).toContain(id)
    }
  })
})

describe('thumbnails follow the pinned index', () => {
  it('resolves previews against the pinned asset base, not main', async () => {
    // The index is fetched at the pin, so previews must be too — otherwise a
    // card hydrated from v0.11.12 requests an image that only exists on main.
    resolveTemplatePackageVersion.mockResolvedValue('0.11.12')
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    const catalog = await loadCards({ comfyVersion: 'v0.28.2' })
    const withThumb = catalog.filter((c) => c.thumbnailUrl)
    expect(withThumb.length).toBeGreaterThan(0)
    for (const card of withThumb) {
      expect(card.thumbnailUrl, card.id).toContain('/v0.11.12/templates/')
    }
  })

  it('falls back to the main asset base when no pin resolves', async () => {
    resolveTemplatePackageVersion.mockResolvedValue(null)
    mockedFetchJSON.mockResolvedValue(indexWithCurated())
    const catalog = await loadCards({ comfyVersion: null })
    const card = catalog.find((c) => c.thumbnailUrl)!
    expect(card.thumbnailUrl).toContain('/main/templates/')
  })
})

describe('adversarial-but-valid payloads', () => {
  function bareIndexAll(mutate: (id: string) => Record<string, unknown> | null = () => ({})) {
    const byMod: Record<string, Record<string, Record<string, unknown>>> = {}
    for (const t of CURATED_TEMPLATES) {
      const fields = mutate(t.id)
      if (!fields) continue
      byMod[t.modality] ??= {}
      byMod[t.modality]![t.id] = fields
    }
    const titles: Record<string, string> = {
      image: 'Image',
      video: 'Video',
      audio: 'Audio',
      '3d': '3D Model'
    }
    return Object.entries(byMod).map(([type, tpls]) => category(type, titles[type]!, tpls))
  }

  it.each([1, 2, 4])(
    'holds when %i image cards would be filed under the wrong modality',
    async (count) => {
      const image = CURATED_TEMPLATES.filter((t) => t.modality === 'image').slice(0, count)
      getStarterTemplatesAsync.mockResolvedValue([
        ...image.map((t) => ({ id: t.id, modality: 'video' as const })),
        ...CURATED_TEMPLATES
      ])
      mockedFetchJSON.mockResolvedValue(bareIndexAll())
      const catalog = await loadCards()
      expect(new Set(catalog.map((c) => c.id)).size, 'no duplicate ids').toBe(catalog.length)
    }
  )

  it('never recommends an API card when the payload is all API nodes', async () => {
    getStarterTemplatesAsync.mockResolvedValue(
      CURATED_TEMPLATES.map((t) => ({ id: t.id, modality: t.modality, apiNode: true as const }))
    )
    mockedFetchJSON.mockResolvedValue(bareIndexAll())
    const catalog = await loadCards()
    for (const modality of TEMPLATE_MODALITY_ORDER) {
      const cards = catalog.filter((c) => c.modality === modality)
      expect(cards, modality).toHaveLength(4)
      expect(
        cards.filter((c) => c.recommended && c.apiNode),
        `${modality} paid auto-pick`
      ).toEqual([])
    }
  })

  it('prefers runnable cards but still fills a wholly-unrunnable modality', async () => {
    mockedFetchJSON.mockResolvedValue(
      bareIndexAll((id) =>
        CURATED_TEMPLATES.find((t) => t.id === id)!.modality === 'image'
          ? { requiresCustomNodes: ['comfyui-kjnodes'] }
          : {}
      )
    )
    expectFourByFour(await loadCards({ comfyVersion: 'v0.28.2' }))
  })

  it('still drops an unrunnable card when a runnable one can take the slot', async () => {
    const target = CURATED_TEMPLATES.find((t) => t.modality === 'image' && !t.apiNode)!
    mockedFetchJSON.mockResolvedValue([
      ...bareIndexAll((id) => (id === target.id ? { requiresCustomNodes: ['x'] } : {})),
      category('image', 'Image', { runnable_sub: { title: 'Runnable' } })
    ])
    const catalog = await loadCards()
    expect(catalog.find((c) => c.id === target.id)).toBeUndefined()
    expectFourByFour(catalog)
  })
})
