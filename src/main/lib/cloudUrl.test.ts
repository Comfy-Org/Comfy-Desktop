import { afterEach, describe, expect, it, vi } from 'vitest'
import { displayLaunchUrl, withCloudDistributionUtm } from './cloudUrl'

describe('withCloudDistributionUtm', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('adds default UTM params for cloud distribution links', () => {
    const result = withCloudDistributionUtm('https://cloud.comfy.org/')
    const url = new URL(result)

    expect(url.hostname).toBe('cloud.comfy.org')
    expect(url.searchParams.get('utm_source')).toBe('comfy.desktop')
    expect(url.searchParams.get('utm_medium')).toBe('app_feature')
    expect(url.searchParams.has('utm_campaign')).toBe(false)
  })

  it('preserves existing query params and UTM overrides', () => {
    const result = withCloudDistributionUtm(
      'https://cloud.comfy.org/path?plan=pro&utm_source=custom-source'
    )
    const url = new URL(result)

    expect(url.searchParams.get('plan')).toBe('pro')
    expect(url.searchParams.get('utm_source')).toBe('custom-source')
    expect(url.searchParams.get('utm_medium')).toBe('app_feature')
    expect(url.searchParams.has('utm_campaign')).toBe(false)
  })

  it('does not modify non-cloud URLs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const input = 'https://example.com/path?plan=pro'
    expect(withCloudDistributionUtm(input)).toBe(input)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('returns invalid URLs unchanged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(withCloudDistributionUtm('not a url')).toBe('not a url')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('never exposes Desktop identity or installation metadata in the URL', () => {
    const url = new URL(
      withCloudDistributionUtm(
        'https://cloud.comfy.org/path?desktop_device_id=legacy&installation_id=hash'
      )
    )
    expect(url.searchParams.has('desktop_device_id')).toBe(false)
    expect(url.searchParams.has('installation_id')).toBe(false)
    expect(url.searchParams.get('utm_source')).toBe('comfy.desktop')
  })
})

describe('displayLaunchUrl', () => {
  it('strips query params and the path down to the host', () => {
    expect(
      displayLaunchUrl(
        'https://cloud.comfy.org/workflows/123?utm_source=comfy.desktop&desktop_device_id=abc'
      )
    ).toBe('cloud.comfy.org')
  })

  it('keeps a non-default port', () => {
    expect(displayLaunchUrl('http://127.0.0.1:8188/?foo=bar')).toBe('127.0.0.1:8188')
  })

  it('returns the input unchanged when it is not a URL', () => {
    expect(displayLaunchUrl('not a url')).toBe('not a url')
  })
})
