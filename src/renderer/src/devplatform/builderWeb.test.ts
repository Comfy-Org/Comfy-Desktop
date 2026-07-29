import { describe, expect, it } from 'vitest'
import { buildDeployDistributionUrl } from './builderWeb'

describe('buildDeployDistributionUrl', () => {
  it('points at the Builder web root with attribution params', () => {
    const url = new URL(buildDeployDistributionUrl())
    expect(url.host).toBe('platform.comfy.org')
    expect(url.protocol).toBe('https:')
    expect(url.pathname).toBe('/')
    expect(url.searchParams.get('utm_source')).toBe('comfy.desktop')
    expect(url.searchParams.get('utm_medium')).toBe('app_feature')
  })
})
