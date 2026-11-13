import { describe, expect, it } from 'vitest'
import { catalogCategory } from './category'

describe('catalogCategory', () => {
  it('reads the first recognised output kind', () => {
    expect(catalogCategory({ outputs: [{ kind: 'video' }, { kind: 'image' }] })).toBe('video')
    expect(catalogCategory({ outputs: [{ kind: 'text' }, { kind: 'image' }] })).toBe('image')
    expect(catalogCategory({ outputs: [{ kind: '3d' }] })).toBe('3d')
    expect(catalogCategory({ outputs: [{ kind: 'audio' }] })).toBe('audio')
  })

  it('prefers outputs over the generation type', () => {
    expect(
      catalogCategory({ outputs: [{ kind: 'image' }], generation_type: 'generate-videos' })
    ).toBe('image')
  })

  it.each([
    ['generate-images', 'image'],
    ['edit-images', 'image'],
    ['animate-images', 'image'],
    ['generate-videos', 'video'],
    ['edit-videos', 'video'],
    ['generate-3d', '3d'],
    ['generate-audio', 'audio']
  ])('maps generation type %s to %s', (generationType, category) => {
    expect(catalogCategory({ generation_type: generationType })).toBe(category)
  })

  it('falls back to the generation type when outputs name no known kind', () => {
    expect(
      catalogCategory({ outputs: [{ kind: 'text' }, null], generation_type: 'edit-videos' })
    ).toBe('video')
  })

  it('returns null when nothing names a category', () => {
    expect(catalogCategory({})).toBeNull()
    expect(catalogCategory(null)).toBeNull()
    expect(catalogCategory({ outputs: 'image', generation_type: 'upscale' })).toBeNull()
    expect(catalogCategory({ generation_type: 42 })).toBeNull()
  })
})
