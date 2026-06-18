import { describe, it, expect } from 'vitest'
import {
  buildTemplateDeeplink,
  thumbnailUrlFor,
  CURATED_TEMPLATES,
  TEMPLATE_MODALITY_ORDER,
  RAW_TEMPLATES_BASE,
} from './curatedTemplates'

describe('buildTemplateDeeplink', () => {
  it('appends ?template=<id>&source=default and round-trips the id', () => {
    const out = buildTemplateDeeplink('http://127.0.0.1:8188/', 'flux_schnell')
    const parsed = new URL(out)
    expect(parsed.searchParams.get('template')).toBe('flux_schnell')
    expect(parsed.searchParams.get('source')).toBe('default')
  })

  it('preserves an existing query and host/port', () => {
    const out = buildTemplateDeeplink('http://localhost:8000/?foo=bar', 'text_to_video_wan')
    const parsed = new URL(out)
    expect(parsed.host).toBe('localhost:8000')
    expect(parsed.searchParams.get('foo')).toBe('bar')
    expect(parsed.searchParams.get('template')).toBe('text_to_video_wan')
  })

  it('returns the input unchanged when the URL cannot be parsed', () => {
    expect(buildTemplateDeeplink('not a url', 'flux_schnell')).toBe('not a url')
  })
})

describe('thumbnailUrlFor', () => {
  it('builds the <id>-1.<sub> preview URL for image subtypes', () => {
    expect(thumbnailUrlFor('flux_schnell', 'webp')).toBe(`${RAW_TEMPLATES_BASE}/flux_schnell-1.webp`)
    expect(thumbnailUrlFor('foo', 'PNG')).toBe(`${RAW_TEMPLATES_BASE}/foo-1.png`)
  })

  it('defaults a missing subtype to webp', () => {
    expect(thumbnailUrlFor('foo', '')).toBe(`${RAW_TEMPLATES_BASE}/foo-1.webp`)
  })

  it('returns null for non-image previews so the caller shows a glyph', () => {
    expect(thumbnailUrlFor('audio_song', 'mp3')).toBeNull()
  })
})

describe('CURATED_TEMPLATES manifest', () => {
  // Must match the frontend deeplink validator so the auto-open can't be
  // rejected for a malformed id.
  const ID_PATTERN = /^[a-zA-Z0-9_.-]+$/

  it('offers exactly 4 templates per modality', () => {
    for (const modality of TEMPLATE_MODALITY_ORDER) {
      const count = CURATED_TEMPLATES.filter((t) => t.modality === modality).length
      expect(count, modality).toBe(4)
    }
  })

  it('marks at most one recommended template per modality', () => {
    for (const modality of TEMPLATE_MODALITY_ORDER) {
      const recommended = CURATED_TEMPLATES.filter((t) => t.modality === modality && t.recommended)
      expect(recommended.length, modality).toBeLessThanOrEqual(1)
    }
  })

  it('uses only deeplink-safe ids', () => {
    for (const t of CURATED_TEMPLATES) {
      expect(t.id, t.id).toMatch(ID_PATTERN)
    }
  })

  it('carries a non-empty offline snapshot for every entry', () => {
    for (const t of CURATED_TEMPLATES) {
      expect(t.snapshot.title, t.id).toBeTruthy()
      expect(t.snapshot.description, t.id).toBeTruthy()
      expect(t.snapshot.sizeBytes, t.id).toBeGreaterThan(0)
      expect(t.snapshot.mediaSubtype, t.id).toBeTruthy()
    }
  })

  it('only uses modalities declared in the tab order', () => {
    for (const t of CURATED_TEMPLATES) {
      expect(TEMPLATE_MODALITY_ORDER).toContain(t.modality)
    }
  })
})
