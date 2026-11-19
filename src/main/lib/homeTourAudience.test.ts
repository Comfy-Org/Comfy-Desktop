import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => new Map<string, unknown>())

vi.mock('../settings', () => ({
  get: (key: string) => store.get(key),
  set: (key: string, value: unknown) => store.set(key, value)
}))

import { recordHomeTourAudience } from './homeTourAudience'

describe('recordHomeTourAudience', () => {
  beforeEach(() => store.clear())

  it('marks a first launch with no finished setup as a new user', () => {
    recordHomeTourAudience(false)
    expect(store.get('homeTourAudience')).toBe('new')
  })

  it('marks a user who launched Desktop before as an updated user', () => {
    recordHomeTourAudience(true)
    expect(store.get('homeTourAudience')).toBe('updated')
  })

  it('marks a user who finished setup before as an updated user', () => {
    store.set('firstUseCompleted', true)
    recordHomeTourAudience(false)
    expect(store.get('homeTourAudience')).toBe('updated')
  })

  it('keeps the audience it recorded on an earlier launch', () => {
    store.set('homeTourAudience', 'new')
    store.set('firstUseCompleted', true)
    recordHomeTourAudience(true)
    expect(store.get('homeTourAudience')).toBe('new')
  })
})
