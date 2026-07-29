import { afterEach, describe, expect, it, vi } from 'vitest'
import { builderHandoffUrl } from './builderWeb'

describe('builderHandoffUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('points at the Builder web root with attribution params', () => {
    const url = new URL(builderHandoffUrl())
    expect(url.host).toBe('platform.comfy.org')
    expect(url.protocol).toBe('https:')
    expect(url.pathname).toBe('/')
    expect(url.searchParams.get('utm_source')).toBe('comfy.desktop')
    expect(url.searchParams.get('utm_medium')).toBe('app_feature')
  })

  it('follows VITE_COMFY_BUILDER_WEB_URL when the build sets one', () => {
    vi.stubEnv('VITE_COMFY_BUILDER_WEB_URL', 'https://builder.example.test/')
    const url = new URL(builderHandoffUrl())
    expect(url.host).toBe('builder.example.test')
    expect(url.searchParams.get('utm_source')).toBe('comfy.desktop')
  })
})
