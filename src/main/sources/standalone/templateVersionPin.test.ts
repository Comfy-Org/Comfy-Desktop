import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as TemplatePinModule from './templatePin'

vi.mock('../../lib/fetch', () => ({ fetchJSON: vi.fn(), fetchText: vi.fn() }))

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
import { fetchJSON } from '../../lib/fetch'

const mockedFetchJSON = vi.mocked(fetchJSON)

/** A live index carrying every curated id, minus `omit`, plus `extra` spares. */
function indexWithout(omit: string[], extra: string[] = []): unknown {
  const byModality: Record<string, { name: string }[]> = {}
  for (const t of CURATED_TEMPLATES) {
    if (omit.includes(t.id)) continue
    byModality[t.modality] ??= []
    byModality[t.modality]!.push({ name: t.id })
  }
  for (const name of extra) {
    byModality.image ??= []
    byModality.image.push({ name })
  }
  return Object.entries(byModality).map(([type, templates]) => ({
    type,
    title: type,
    templates: templates.map((t) => ({ ...t, size: 1000, mediaSubtype: 'webp' }))
  }))
}

beforeEach(() => {
  mockedFetchJSON.mockReset()
  resolveTemplatePackageVersion.mockReset()
  resolveTemplatePackageVersion.mockResolvedValue(null)
  resetTemplateCatalogCache()
})

describe('the picker resolves against the version the install will run', () => {
  it('fetches the index the pinned package ships, not main', async () => {
    resolveTemplatePackageVersion.mockResolvedValue('0.11.12')
    mockedFetchJSON.mockResolvedValue(indexWithout([]))
    await loadTemplateCatalog({ comfyVersion: 'v0.28.2' })
    expect(resolveTemplatePackageVersion).toHaveBeenCalledWith('v0.28.2')
    expect(
      mockedFetchJSON.mock.calls.some(([url]) => String(url).includes('v0.11.12')),
      'hydrating against main would offer templates the install cannot open'
    ).toBe(true)
  })

  it('falls back to the main index when the pin cannot be resolved', async () => {
    resolveTemplatePackageVersion.mockResolvedValue(null)
    mockedFetchJSON.mockResolvedValue(indexWithout([]))
    await loadTemplateCatalog({ comfyVersion: null })
    expect(mockedFetchJSON).toHaveBeenCalledWith(INDEX_URL)
  })

  it('survives a pin lookup that throws', async () => {
    resolveTemplatePackageVersion.mockRejectedValue(new Error('offline'))
    mockedFetchJSON.mockResolvedValue(indexWithout([]))
    const catalog = await loadTemplateCatalog({ comfyVersion: 'v0.28.2' })
    expect(catalog.length).toBe(CURATED_TEMPLATES.length)
  })

  it('replaces a template the pinned index does not carry', async () => {
    const image = CURATED_TEMPLATES.filter((t) => t.modality === 'image' && !t.apiNode)
    const missing = image[0]!
    resolveTemplatePackageVersion.mockResolvedValue('0.11.12')
    // Every other image id is gone too, so the spare is the only candidate left.
    mockedFetchJSON.mockResolvedValue(
      indexWithout(
        image.map((t) => t.id),
        ['image_substitute']
      )
    )
    const catalog = await loadTemplateCatalog({ comfyVersion: 'v0.28.2' })
    expect(
      catalog.find((c) => c.id === missing.id),
      'a card absent from the pinned index cannot be opened'
    ).toBeUndefined()
    expect(
      catalog.find((c) => c.id === 'image_substitute'),
      'the slot takes a template this version actually ships'
    ).toBeDefined()
  })

  it('still fills every tab when the pinned index omits a whole modality', async () => {
    const video = CURATED_TEMPLATES.filter((t) => t.modality === 'video').map((t) => t.id)
    resolveTemplatePackageVersion.mockResolvedValue('0.11.12')
    mockedFetchJSON.mockResolvedValue(indexWithout(video))
    const catalog = await loadTemplateCatalog({ comfyVersion: 'v0.28.2' })
    for (const modality of TEMPLATE_MODALITY_ORDER) {
      expect(catalog.filter((c) => c.modality === modality).length, modality).toBeGreaterThan(0)
    }
  })

  it('points thumbnails at the pinned revision, so previews match the cards', async () => {
    resolveTemplatePackageVersion.mockResolvedValue('0.11.12')
    mockedFetchJSON.mockResolvedValue(indexWithout([]))
    const catalog = await loadTemplateCatalog({ comfyVersion: 'v0.28.2' })
    const withThumb = catalog.find((c) => c.thumbnailUrl)!
    expect(
      withThumb.thumbnailUrl,
      'a main-revision preview beside a pinned card is two revisions in one'
    ).toContain('v0.11.12')
  })

  it('re-resolves when the target version changes mid-wizard', async () => {
    resolveTemplatePackageVersion.mockResolvedValue('0.11.12')
    mockedFetchJSON.mockResolvedValue(indexWithout([]))
    await loadTemplateCatalog({ comfyVersion: 'v0.28.2' })
    await loadTemplateCatalog({ comfyVersion: 'v0.30.2' })
    expect(
      resolveTemplatePackageVersion.mock.calls.map(([v]) => v),
      'a version-keyed cache must not serve the previous channel'
    ).toEqual(['v0.28.2', 'v0.30.2'])
  })

  it('serves the cached catalog for a repeated version', async () => {
    resolveTemplatePackageVersion.mockResolvedValue('0.11.12')
    mockedFetchJSON.mockResolvedValue(indexWithout([]))
    await loadTemplateCatalog({ comfyVersion: 'v0.28.2' })
    await loadTemplateCatalog({ comfyVersion: 'v0.28.2' })
    expect(resolveTemplatePackageVersion).toHaveBeenCalledTimes(1)
  })
})
