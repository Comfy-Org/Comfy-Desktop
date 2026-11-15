import { describe, expect, it } from 'vitest'

import { isInstallSiteUrl, showsInstallSite } from './installSite'

describe("the install's own site", () => {
  it.each([
    ['http://127.0.0.1:8188', 'http://127.0.0.1:8188/?x=1'],
    ['https://cloud.comfy.org/?utm_source=a', 'https://cloud.comfy.org/cloud/login'],
    ['http://comfy.example.test', 'https://comfy.example.test/'],
    ['http://COMFY.example.test/', 'https://comfy.example.test/workflows']
  ])('an install at %s owns %s', (installUrl, pageUrl) => {
    expect(isInstallSiteUrl(installUrl, pageUrl)).toBe(true)
  })

  it.each([
    ['another port on the same host', 'http://127.0.0.1:8188', 'http://127.0.0.1:8189/'],
    ['another host', 'https://cloud.comfy.org/', 'https://example.test/'],
    ['a look-alike host', 'https://cloud.comfy.org/', 'https://cloud.comfy.org.example.test/'],
    ['a sibling host', 'https://cloud.comfy.org/', 'https://platform.comfy.org/'],
    ['https on a port the install did not name', 'http://box.test:8188', 'https://box.test/'],
    ['https on the same named port', 'http://box.test:8188', 'https://box.test:8188/'],
    ['plain http when the install is https', 'https://box.test', 'http://box.test/'],
    ['the splash page', 'http://127.0.0.1:8188', 'data:text/html,splash'],
    ['a blank page', 'http://127.0.0.1:8188', 'about:blank'],
    ['a blob the page made', 'http://127.0.0.1:8188', 'blob:http://127.0.0.1:8188/7d1f'],
    ['a file on disk', 'http://127.0.0.1:8188', 'file:///etc/hosts'],
    ['text that is not a URL', 'http://127.0.0.1:8188', 'not a url'],
    ['anything once the view shows no install', '', 'http://127.0.0.1:8188/']
  ])('does not own %s', (_what, installUrl, pageUrl) => {
    expect(isInstallSiteUrl(installUrl, pageUrl)).toBe(false)
  })

  it('belongs to a window only while that window shows an install', () => {
    const comfyUrl = 'http://127.0.0.1:8188'

    expect(showsInstallSite({ installationId: 'inst-1', comfyUrl }, `${comfyUrl}/`)).toBe(true)
    expect(showsInstallSite({ installationId: null, comfyUrl }, `${comfyUrl}/`)).toBe(false)
  })
})
