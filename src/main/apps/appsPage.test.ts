// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { appsPageUrl, isAppsListUrl, isAppsPath } from './appsPage'

describe('isAppsPath', () => {
  it.each([
    '/apps/doodle-to-image/desktop.html',
    '/apps/#/make-image',
    '/apps/genjutsu-studio/desktop.html?example=duel'
  ])('accepts %s', (page) => {
    expect(isAppsPath(page)).toBe(true)
  })

  it.each([
    ['another site', 'https://evil.example/apps/x.html'],
    ['a protocol-relative address', '//evil.example/apps/x.html'],
    ['a path outside the apps folder', '/hub/apps/x'],
    ['the bare folder name', '/apps'],
    ['a climb out of the folder', '/apps/../admin'],
    ['an encoded climb', '/apps/%2e%2e/admin'],
    ['an encoded slash', '/apps/%2fevil.example'],
    ['a backslash', '/apps/\\evil.example'],
    ['a doubled slash', '/apps//evil.example'],
    ['a space', '/apps/a b.html'],
    ['a newline', '/apps/a\nb.html'],
    ['a javascript address', 'javascript:alert(1)'],
    ['a very long path', `/apps/${'a'.repeat(400)}`],
    ['a number', 42],
    ['nothing', undefined]
  ])('refuses %s', (_label, page) => {
    expect(isAppsPath(page)).toBe(false)
  })
})

describe('appsPageUrl', () => {
  it('puts the page on the apps origin', () => {
    expect(appsPageUrl('https://apps.comfy.org', '/apps/doodle-to-image/desktop.html')).toBe(
      'https://apps.comfy.org/apps/doodle-to-image/desktop.html'
    )
  })

  it('keeps the hash route of a steps app', () => {
    expect(appsPageUrl('http://127.0.0.1:4331', '/apps/#/make-image')).toBe(
      'http://127.0.0.1:4331/apps/#/make-image'
    )
  })

  it('refuses a page when there is no apps origin', () => {
    expect(appsPageUrl(null, '/apps/doodle-to-image/desktop.html')).toBeNull()
  })

  it('refuses a page that fails the path check', () => {
    expect(appsPageUrl('https://apps.comfy.org', '//evil.example/apps/')).toBeNull()
  })
})

describe('isAppsListUrl', () => {
  const appsUrl = 'https://preview.example/apps/'

  it.each([
    'https://preview.example/apps/',
    'https://preview.example/apps',
    'https://preview.example/apps/#/',
    'https://preview.example/apps/#'
  ])('treats %s as the website list', (url) => {
    expect(isAppsListUrl(url, appsUrl)).toBe(true)
  })

  it('treats the root of a root-served apps site as the list', () => {
    expect(isAppsListUrl('https://apps.comfy.org/', 'https://apps.comfy.org/')).toBe(true)
  })

  it.each([
    'https://preview.example/apps/#/make-image',
    'https://preview.example/apps/doodle-to-image/desktop.html',
    'https://other.example/apps/',
    'not a url'
  ])('does not treat %s as the list', (url) => {
    expect(isAppsListUrl(url, appsUrl)).toBe(false)
  })
})
