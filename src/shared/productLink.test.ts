import { describe, expect, it } from 'vitest'

import { PRODUCT_LINK_SOURCE, productLink } from './productLink'

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams)
}

describe('productLink', () => {
  it.each([
    'https://comfy.org/hub/workflows/upscale',
    'https://www.comfy.org/pricing',
    'https://docs.comfy.org/get_started',
    'https://blog.comfy.org/p/news',
    'https://registry.comfy.org/nodes',
    'https://platform.comfy.org/profile/deploy',
    'https://COMFY.ORG/'
  ])('tags %s with the desktop source, product medium and campaign', (url) => {
    expect(params(productLink(url, 'workflow_dialog'))).toEqual({
      utm_source: PRODUCT_LINK_SOURCE,
      utm_medium: 'product',
      utm_campaign: 'workflow_dialog'
    })
  })

  it('uses comfy_desktop as the source', () => {
    expect(PRODUCT_LINK_SOURCE).toBe('comfy_desktop')
  })

  it('keeps the path, other parameters and the hash', () => {
    expect(productLink('https://docs.comfy.org/a/b?template=x&utm_id=7#part', 'help_tip')).toBe(
      'https://docs.comfy.org/a/b?template=x&utm_id=7&utm_source=comfy_desktop&utm_medium=product&utm_campaign=help_tip#part'
    )
  })

  it('overwrites existing utm source, medium and campaign', () => {
    const tagged = productLink(
      'https://comfy.org/?utm_source=old&utm_medium=email&utm_campaign=launch&utm_content=hero',
      'home_card'
    )
    expect(params(tagged)).toEqual({
      utm_source: 'comfy_desktop',
      utm_medium: 'product',
      utm_campaign: 'home_card',
      utm_content: 'hero'
    })
  })

  it.each([
    'https://example.com/comfy.org',
    'https://notcomfy.org/',
    'https://comfy.org.example.com/',
    'https://github.com/Comfy-Org/ComfyUI',
    'mailto:support@comfy.org',
    'not a url',
    ''
  ])('returns %j unchanged', (url) => {
    expect(productLink(url, 'help_tip')).toBe(url)
  })
})
