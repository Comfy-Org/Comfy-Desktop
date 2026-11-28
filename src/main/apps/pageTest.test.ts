import { beforeEach, describe, expect, it } from 'vitest'

import {
  _resetPageTestsForTest,
  pageTestBucket,
  pageTestGroup,
  pageTestPropertiesFor,
  pageTestPropertiesOf,
  parsePageTest,
  rememberPageTestGroup,
  variantForBucket
} from './pageTest'
import type { PageTest } from './pageTest'

const KEY = 't2i-2026-12'
const SITE = 'https://comfy.org'
const COMFY_PAGE = `${SITE}/apps/prompt-to-image/desktop.html`

function inAppsScope(page: string): string | null {
  const url = new URL(page, `${SITE}/apps/`)
  return url.origin === SITE && url.pathname.startsWith('/apps/') ? url.href : null
}

function pageTestWith(pages: Record<string, unknown>, key: unknown = KEY): unknown {
  return { key, pages }
}

function parsed(value: unknown): PageTest | null {
  return parsePageTest(value, inAppsScope)
}

const THREE_WAYS: PageTest = {
  key: KEY,
  variants: [
    { name: 'alpha', share: 10, pageUrl: `${SITE}/apps/a.html` },
    { name: 'beta', share: 20, pageUrl: `${SITE}/apps/b.html` },
    { name: 'gamma', share: 30, pageUrl: `${SITE}/apps/c.html` }
  ]
}

function madeUpIds(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `install-${index}`)
}

beforeEach(() => {
  _resetPageTestsForTest()
})

describe("an app's page_test", () => {
  it('is kept with each page resolved, its key and each share', () => {
    expect(
      parsed(pageTestWith({ comfy: { page: '/apps/prompt-to-image/desktop.html', share: 50 } }))
    ).toEqual({ key: KEY, variants: [{ name: 'comfy', share: 50, pageUrl: COMFY_PAGE }] })
  })

  it('keeps its variants sorted by name, whatever order the list gives them in', () => {
    const test = parsed(
      pageTestWith({
        gamma: { page: '/apps/c.html', share: 30 },
        alpha: { page: '/apps/a.html', share: 10 },
        beta: { page: '/apps/b.html', share: 20 }
      })
    )
    expect(test?.variants.map((variant) => variant.name)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('keeps four variants whose shares add up to exactly 100', () => {
    const test = parsed(
      pageTestWith({
        a: { page: '/apps/a.html', share: 25 },
        b: { page: '/apps/b.html', share: 25 },
        c: { page: '/apps/c.html', share: 25 },
        d: { page: '/apps/d.html', share: 25 }
      })
    )
    expect(test?.variants).toHaveLength(4)
  })

  it.each<[string, unknown]>([
    ['no page_test at all', undefined],
    ['a page_test that is not an object', 'comfy'],
    ['a page_test that is a list', [{ key: KEY }]],
    ['no key', { pages: { comfy: { page: '/apps/a.html', share: 50 } } }],
    [
      'a key that is not a slug',
      pageTestWith({ comfy: { page: '/apps/a.html', share: 50 } }, 'T2I')
    ],
    [
      'a key longer than 64 characters',
      pageTestWith({ comfy: { page: '/apps/a.html', share: 50 } }, 'k'.repeat(65))
    ],
    ['no pages', { key: KEY }],
    ['pages that are a list', { key: KEY, pages: [{ page: '/apps/a.html', share: 50 }] }],
    ['no variants', pageTestWith({})],
    ['a variant named control', pageTestWith({ control: { page: '/apps/a.html', share: 50 } })],
    [
      'a variant name that is not a slug',
      pageTestWith({ Comfy: { page: '/apps/a.html', share: 50 } })
    ],
    ['a share of 0', pageTestWith({ comfy: { page: '/apps/a.html', share: 0 } })],
    ['a share over 100', pageTestWith({ comfy: { page: '/apps/a.html', share: 101 } })],
    [
      'a share that is not a whole number',
      pageTestWith({ comfy: { page: '/apps/a.html', share: 12.5 } })
    ],
    ['a share written as text', pageTestWith({ comfy: { page: '/apps/a.html', share: '50' } })],
    ['a variant with no page', pageTestWith({ comfy: { share: 50 } })],
    ['a variant that is not an object', pageTestWith({ comfy: '/apps/a.html' })],
    [
      'a page the apps scope refuses',
      pageTestWith({ comfy: { page: 'https://evil.example/', share: 50 } })
    ],
    [
      'shares that add up to more than 100',
      pageTestWith({
        comfy: { page: '/apps/a.html', share: 60 },
        studio: { page: '/apps/b.html', share: 41 }
      })
    ],
    [
      'more than four variants',
      pageTestWith({
        a: { page: '/apps/a.html', share: 10 },
        b: { page: '/apps/b.html', share: 10 },
        c: { page: '/apps/c.html', share: 10 },
        d: { page: '/apps/d.html', share: 10 },
        e: { page: '/apps/e.html', share: 10 }
      })
    ]
  ])('is dropped whole for %s', (_case, value) => {
    expect(parsed(value)).toBeNull()
  })

  it('is dropped whole when one good variant sits beside one bad one', () => {
    expect(
      parsed(
        pageTestWith({
          comfy: { page: '/apps/a.html', share: 30 },
          studio: { page: 'https://evil.example/', share: 30 }
        })
      )
    ).toBeNull()
  })
})

describe('the bucket an install falls in', () => {
  it('is the same number for the same key and installation id', () => {
    expect(pageTestBucket(KEY, 'install-a')).toBe(16)
    expect(pageTestBucket(KEY, 'install-a')).toBe(16)
    expect(pageTestBucket(KEY, 'install-b')).toBe(41)
  })

  it('moves to another number under a different key', () => {
    expect(pageTestBucket('other-test', 'install-a')).toBe(6)
  })

  it('is always a whole number from 0 to 99', () => {
    for (const id of madeUpIds(1000)) {
      const bucket = pageTestBucket(KEY, id)
      expect(Number.isInteger(bucket) && bucket >= 0 && bucket < 100).toBe(true)
    }
  })

  it('puts close to half of 10,000 installs in a variant with share 50', () => {
    const test = parsed(pageTestWith({ comfy: { page: '/apps/a.html', share: 50 } }))
    if (!test) throw new Error('The page_test was dropped')
    const inVariant = madeUpIds(10_000).filter(
      (id) => pageTestGroup(test, id).variant === 'comfy'
    ).length
    expect(inVariant).toBeGreaterThanOrEqual(4800)
    expect(inVariant).toBeLessThanOrEqual(5200)
  })

  it('reshuffles installs when the key changes', () => {
    const inVariant = (key: string, id: string): boolean => pageTestBucket(key, id) < 50
    const moved = madeUpIds(10_000).filter(
      (id) => inVariant(KEY, id) !== inVariant('t2i-2027-01', id)
    ).length
    expect(moved).toBeGreaterThanOrEqual(4500)
    expect(moved).toBeLessThanOrEqual(5500)
  })
})

describe('the variant an install gets', () => {
  it.each<[number, string | null]>([
    [0, 'alpha'],
    [9, 'alpha'],
    [10, 'beta'],
    [29, 'beta'],
    [30, 'gamma'],
    [59, 'gamma'],
    [60, null],
    [99, null]
  ])('is chosen by walking the variants in name order: bucket %i gets %s', (bucket, name) => {
    expect(variantForBucket(THREE_WAYS, bucket)?.name ?? null).toBe(name)
  })

  it("is the variant's page for an install inside the shares", () => {
    const test: PageTest = {
      key: KEY,
      variants: [{ name: 'comfy', share: 50, pageUrl: COMFY_PAGE }]
    }
    expect(pageTestGroup(test, 'install-a')).toEqual({
      key: KEY,
      variant: 'comfy',
      pageUrl: COMFY_PAGE
    })
  })

  it('is control, with no page of its own, for an install past the shares', () => {
    const test: PageTest = {
      key: KEY,
      variants: [{ name: 'comfy', share: 50, pageUrl: COMFY_PAGE }]
    }
    expect(pageTestGroup(test, 'install-1')).toEqual({
      key: KEY,
      variant: 'control',
      pageUrl: null
    })
  })
})

describe('the page_test properties on apps events', () => {
  it('carry the key and the variant of a group', () => {
    expect(pageTestPropertiesOf({ key: KEY, variant: 'control', pageUrl: null })).toEqual({
      page_test_key: KEY,
      page_test_variant: 'control'
    })
  })

  it('are empty with no group', () => {
    expect(pageTestPropertiesOf(null)).toEqual({})
  })

  it('follow the group last shown for an app, and nothing else', () => {
    rememberPageTestGroup('prompt-to-image', { key: KEY, variant: 'comfy', pageUrl: COMFY_PAGE })

    expect(pageTestPropertiesFor('prompt-to-image')).toEqual({
      page_test_key: KEY,
      page_test_variant: 'comfy'
    })
    expect(pageTestPropertiesFor('remove-background')).toEqual({})
    expect(pageTestPropertiesFor(null)).toEqual({})

    rememberPageTestGroup('prompt-to-image', null)
    expect(pageTestPropertiesFor('prompt-to-image')).toEqual({})
  })
})
