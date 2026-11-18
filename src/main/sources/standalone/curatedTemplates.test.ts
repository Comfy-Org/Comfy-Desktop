import { describe, it, expect } from 'vitest'
import {
  thumbnailUrlFor,
  isPersistableTemplateId,
  NO_TEMPLATE_VALUE,
  RAW_TEMPLATES_BASE
} from './curatedTemplates'

describe('isPersistableTemplateId', () => {
  it('accepts plain, dotted and hyphenated template ids', () => {
    expect(isPersistableTemplateId('image_z_image_turbo')).toBe(true)
    expect(isPersistableTemplateId('some_live_image_model')).toBe(true)
    expect(isPersistableTemplateId('image_flux2_klein-v1.2')).toBe(true)
  })

  it('rejects the skip sentinel, empty, and non-strings', () => {
    expect(isPersistableTemplateId(NO_TEMPLATE_VALUE)).toBe(false)
    expect(isPersistableTemplateId('')).toBe(false)
    expect(isPersistableTemplateId(undefined)).toBe(false)
    expect(isPersistableTemplateId(null)).toBe(false)
    expect(isPersistableTemplateId(123)).toBe(false)
  })

  it('rejects ids with path separators or other unsafe characters', () => {
    expect(isPersistableTemplateId('../../etc/passwd')).toBe(false)
    expect(isPersistableTemplateId('a/b')).toBe(false)
    expect(isPersistableTemplateId('a\\b')).toBe(false)
    expect(isPersistableTemplateId('foo bar')).toBe(false)
    expect(isPersistableTemplateId('foo?x=1')).toBe(false)
  })
})

describe('thumbnailUrlFor', () => {
  it('builds the <id>-1.<sub> preview URL for image subtypes', () => {
    expect(thumbnailUrlFor('flux_schnell', 'webp')).toBe(
      `${RAW_TEMPLATES_BASE}/flux_schnell-1.webp`
    )
    expect(thumbnailUrlFor('foo', 'PNG')).toBe(`${RAW_TEMPLATES_BASE}/foo-1.png`)
  })

  it('defaults a missing subtype to webp', () => {
    expect(thumbnailUrlFor('foo', '')).toBe(`${RAW_TEMPLATES_BASE}/foo-1.webp`)
  })

  it('returns null for non-image previews so the caller shows a glyph', () => {
    expect(thumbnailUrlFor('audio_song', 'mp3')).toBeNull()
  })
})
