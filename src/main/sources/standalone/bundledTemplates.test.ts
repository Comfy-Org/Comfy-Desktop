import { describe, it, expect } from 'vitest'
import { buildTemplateDeeplink } from './bundledTemplates'

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
