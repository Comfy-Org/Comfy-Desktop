import { describe, expect, it } from 'vitest'

import {
  DEFAULT_APPS_URL,
  isAppsListUrl,
  isInAppsScope,
  isWebUrl,
  resolveAppsLocation
} from './appsLocation'

describe('resolveAppsLocation', () => {
  it('points at the apps site on comfy.org when nothing overrides it', () => {
    expect(resolveAppsLocation()).toEqual({
      url: DEFAULT_APPS_URL,
      origin: 'https://comfy.org',
      scopePath: '/apps/'
    })
  })

  it('follows an override to a preview deploy or a local dev server', () => {
    expect(resolveAppsLocation('http://localhost:4321/apps/')).toEqual({
      url: 'http://localhost:4321/apps/',
      origin: 'http://localhost:4321',
      scopePath: '/apps/'
    })
  })

  it('treats an override without a trailing slash as a folder', () => {
    expect(resolveAppsLocation('https://preview.example/apps').scopePath).toBe('/apps/')
  })

  it.each(['', null, 'not a url', 'file:///etc/passwd', 'javascript:alert(1)'])(
    'falls back to comfy.org for the unusable override %j',
    (override) => {
      expect(resolveAppsLocation(override).url).toBe(DEFAULT_APPS_URL)
    }
  )
})

describe('isInAppsScope', () => {
  const location = resolveAppsLocation()

  it.each([
    'https://comfy.org/apps/',
    'https://comfy.org/apps',
    'https://comfy.org/apps/#/remove-background',
    'https://comfy.org/apps/remove-background/desktop.html?from=list',
    'https://comfy.org/apps/session/'
  ])('keeps %s inside the apps site', (url) => {
    expect(isInAppsScope(location, url)).toBe(true)
  })

  it.each([
    'https://comfy.org/',
    'https://comfy.org/login/?returnTo=%2Fapps%2F',
    'https://comfy.org/appsfoo/',
    'https://comfy.org/apps/../login/',
    'https://comfy.org/apps/%2e%2e/hub/',
    'http://comfy.org/apps/',
    'https://comfy.org:8443/apps/',
    'https://comfy.org.evil.example/apps/',
    'https://comfy.org@evil.example/apps/',
    'https://user:secret@comfy.org/apps/',
    'https://evil.example/apps/',
    'javascript:alert(1)',
    'file:///apps/',
    'about:blank',
    'not a url'
  ])('keeps %s outside the apps site', (url) => {
    expect(isInAppsScope(location, url)).toBe(false)
  })

  it('scopes a root override to its whole origin and nothing else', () => {
    const preview = resolveAppsLocation('http://127.0.0.1:4331/')
    expect(isInAppsScope(preview, 'http://127.0.0.1:4331/anything/here')).toBe(true)
    expect(isInAppsScope(preview, 'http://127.0.0.1:4332/anything/here')).toBe(false)
  })
})

describe('isAppsListUrl', () => {
  const location = resolveAppsLocation()

  it.each([
    'https://comfy.org/apps/',
    'https://comfy.org/apps',
    'https://comfy.org/apps/#',
    'https://comfy.org/apps/#/',
    'https://comfy.org/apps/?from=app'
  ])('reads %s as the list of apps', (url) => {
    expect(isAppsListUrl(location, url)).toBe(true)
  })

  it.each([
    'https://comfy.org/apps/#/upscale',
    'https://comfy.org/apps/remove-background/desktop.html',
    'https://comfy.org/apps/session/',
    'https://comfy.org/',
    'https://evil.example/apps/',
    'not a url'
  ])('reads %s as something other than the list', (url) => {
    expect(isAppsListUrl(location, url)).toBe(false)
  })
})

describe('isWebUrl', () => {
  it.each(['https://example.com/', 'http://example.com/docs'])('accepts %s', (url) => {
    expect(isWebUrl(url)).toBe(true)
  })

  it.each(['mailto:someone@example.com', 'file:///tmp/x', 'javascript:alert(1)', 'comfy://open'])(
    'rejects %s',
    (url) => {
      expect(isWebUrl(url)).toBe(false)
    }
  )
})
