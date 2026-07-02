import { describe, expect, it } from 'vitest'

import { CLOUD_LOGIN_ORIGIN, cloudLoginOriginForUrl, isLoopbackHostname } from './origins'

describe('isLoopbackHostname', () => {
  it.each(['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]'])(
    'treats %s as loopback',
    (hostname) => {
      expect(isLoopbackHostname(hostname)).toBe(true)
    }
  )

  it.each(['cloud.comfy.org', '128.0.0.1', '10.0.0.1', 'example.com', '127.evil.com'])(
    'rejects %s',
    (hostname) => {
      expect(isLoopbackHostname(hostname)).toBe(false)
    }
  )
})

describe('cloudLoginOriginForUrl', () => {
  it('passes a loopback dev origin through', () => {
    expect(cloudLoginOriginForUrl('http://localhost:5173/some/page')).toBe('http://localhost:5173')
    expect(cloudLoginOriginForUrl('http://127.0.0.1:8000/')).toBe('http://127.0.0.1:8000')
  })

  it('resolves production cloud to the production origin', () => {
    expect(cloudLoginOriginForUrl('https://cloud.comfy.org/workspace')).toBe(CLOUD_LOGIN_ORIGIN)
  })

  it('falls back to production for non-loopback hosts and garbage input', () => {
    expect(cloudLoginOriginForUrl('https://evil.example.com/')).toBe(CLOUD_LOGIN_ORIGIN)
    expect(cloudLoginOriginForUrl('file:///etc/hosts')).toBe(CLOUD_LOGIN_ORIGIN)
    expect(cloudLoginOriginForUrl('not a url')).toBe(CLOUD_LOGIN_ORIGIN)
    expect(cloudLoginOriginForUrl('')).toBe(CLOUD_LOGIN_ORIGIN)
  })
})
