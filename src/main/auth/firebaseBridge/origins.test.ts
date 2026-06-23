import { describe, expect, it } from 'vitest'

import {
  CLOUD_LOGIN_ORIGIN,
  cloudLoginOriginForUrl,
  isAllowedCloudCallbackOrigin,
  isLoopbackHostname
} from './origins'

describe('firebase bridge origins', () => {
  it('uses loopback origins for local Cloud login development', () => {
    expect(cloudLoginOriginForUrl('http://localhost:5173/cloud')).toBe('http://localhost:5173')
    expect(cloudLoginOriginForUrl('http://127.0.0.2:5173/cloud')).toBe('http://127.0.0.2:5173')
    expect(cloudLoginOriginForUrl('http://[::1]:5173/cloud')).toBe('http://[::1]:5173')
  })

  it('falls back to production Cloud for non-loopback current pages', () => {
    expect(cloudLoginOriginForUrl('https://staging.example.com/cloud')).toBe(CLOUD_LOGIN_ORIGIN)
    expect(cloudLoginOriginForUrl('file:///tmp/cloud.html')).toBe(CLOUD_LOGIN_ORIGIN)
    expect(cloudLoginOriginForUrl('not a url')).toBe(CLOUD_LOGIN_ORIGIN)
  })

  it('keeps callback CORS origins aligned with selectable login origins', () => {
    expect(isAllowedCloudCallbackOrigin(CLOUD_LOGIN_ORIGIN)).toBe(true)
    expect(isAllowedCloudCallbackOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedCloudCallbackOrigin('http://127.0.0.2:5173')).toBe(true)
    expect(isAllowedCloudCallbackOrigin('http://[::1]:5173')).toBe(true)
    expect(isAllowedCloudCallbackOrigin('https://staging.example.com')).toBe(false)
    expect(isAllowedCloudCallbackOrigin('file://local')).toBe(false)
  })

  it('recognizes loopback hostnames only', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('127.99.1.2')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('192.168.1.5')).toBe(false)
    expect(isLoopbackHostname('cloud.comfy.org')).toBe(false)
  })
})
