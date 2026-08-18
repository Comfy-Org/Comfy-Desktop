import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { SHOWCASE_INTERVAL_MS, useShowcaseCarousel } from './useShowcaseCarousel'
import { SHOWCASE_CARDS } from '../lib/installShowcase'
import en from '@locales/en.json'
import zh from '@locales/zh.json'

let stops: Array<() => void> = []

function setup(cards = SHOWCASE_CARDS) {
  const scope = effectScope()
  const carousel = scope.run(() => useShowcaseCarousel(cards))!
  stops.push(() => scope.stop())
  return carousel
}

beforeEach(() => {
  vi.useFakeTimers()
  stops = []
})

afterEach(() => {
  stops.forEach((stop) => stop())
  vi.useRealTimers()
})

describe('rotation', () => {
  it('opens on the first card', () => {
    expect(setup().card.value.id).toBe(SHOWCASE_CARDS[0]!.id)
  })

  it('advances on the interval', () => {
    const c = setup()
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS)
    expect(c.index.value).toBe(1)
  })

  it('holds a card for the full interval', () => {
    const c = setup()
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS - 1)
    expect(c.index.value).toBe(0)
  })

  it('reaches every card', () => {
    const c = setup()
    const seen = new Set<string>()
    for (let i = 0; i < c.count; i++) {
      seen.add(c.card.value.id)
      vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS)
    }
    expect(seen.size).toBe(SHOWCASE_CARDS.length)
  })

  it('clears the anti-flicker floor', () => {
    // Unity documents a 2s minimum dwell per splash item so content cannot
    // flash past. Guard it so the interval is never tuned below readability.
    expect(SHOWCASE_INTERVAL_MS).toBeGreaterThanOrEqual(2_000)
  })

  it('stops once the scope is gone', () => {
    const scope = effectScope()
    const c = scope.run(() => useShowcaseCarousel())!
    scope.stop()
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS * 3)
    expect(c.index.value).toBe(0)
  })
})

describe('it keeps rotating', () => {
  it('wraps past the last card instead of settling on it', () => {
    const c = setup()
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS * c.count)
    expect(c.index.value).toBe(0)
  })

  it('runs the deck repeatedly, so a long install never sees a dead panel', () => {
    const c = setup()
    const seen: string[] = []
    for (let i = 0; i < c.count * 2 + 2; i++) {
      seen.push(c.card.value.id)
      vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS)
    }
    expect(seen[c.count]).toBe(seen[0])
    expect(seen[c.count * 2]).toBe(seen[0])
  })

  it('never stalls on the final card', () => {
    const c = setup()
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS * (c.count - 1))
    expect(c.index.value).toBe(c.count - 1)

    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS)
    expect(c.index.value).toBe(0)
  })

  it('still rotates after a very long wait', () => {
    const c = setup()
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS * c.count * 6)
    const at = c.index.value
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS)
    expect(c.index.value).not.toBe(at)
  })
})

describe('manual control', () => {
  it('steps forward and back', () => {
    const c = setup()
    c.next()
    expect(c.index.value).toBe(1)
    c.prev()
    expect(c.index.value).toBe(0)
  })

  it('wraps backwards from the first card', () => {
    const c = setup()
    c.prev()
    expect(c.index.value).toBe(c.count - 1)
  })

  it('jumps to a card by index', () => {
    const c = setup()
    c.goTo(3)
    expect(c.index.value).toBe(3)
  })

  it('restarts the dwell so a chosen card is not cut short', () => {
    const c = setup()
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS - 500)
    c.next()
    expect(c.index.value).toBe(1)

    vi.advanceTimersByTime(600)
    expect(c.index.value).toBe(1)
  })
})

describe('pausing', () => {
  it('holds while paused', () => {
    const c = setup()
    c.pause()
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS * 3)
    expect(c.index.value).toBe(0)
  })

  it('resumes afterwards', () => {
    const c = setup()
    c.pause()
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS * 2)
    c.resume()
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS)
    expect(c.index.value).toBe(1)
  })

  it('gives the resumed card a full dwell', () => {
    const c = setup()
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS - 1)
    c.pause()
    c.resume()

    vi.advanceTimersByTime(1)
    expect(c.index.value).toBe(0)
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS - 1)
    expect(c.index.value).toBe(1)
  })
})

describe('the cards themselves', () => {
  it('leads with the offer to skip the wait', () => {
    expect(SHOWCASE_CARDS[0]!.action).toBe('cloud')
  })

  it('marks exactly one card as the cloud action', () => {
    expect(SHOWCASE_CARDS.filter((c) => c.action === 'cloud')).toHaveLength(1)
  })

  it('gives every card a unique id', () => {
    expect(new Set(SHOWCASE_CARDS.map((c) => c.id)).size).toBe(SHOWCASE_CARDS.length)
  })
})

describe('every card resolves in both locales', () => {
  const locales = [
    ['en', en],
    ['zh', zh]
  ] as const

  const lookup = (tree: Record<string, unknown>, key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => {
      if (node && typeof node === 'object') return (node as Record<string, unknown>)[part]
      return undefined
    }, tree)

  it('has real copy behind every title and body', () => {
    const missing: string[] = []
    for (const card of SHOWCASE_CARDS) {
      for (const key of [card.title, card.body]) {
        for (const [name, tree] of locales) {
          if (typeof lookup(tree as Record<string, unknown>, key) !== 'string') {
            missing.push(`${name}: ${key}`)
          }
        }
      }
    }
    expect(missing, `unresolved keys:\n${missing.join('\n')}`).toEqual([])
  })

  it('keeps every card to a readable length', () => {
    for (const [name, tree] of locales) {
      for (const card of SHOWCASE_CARDS) {
        const title = lookup(tree as Record<string, unknown>, card.title) as string
        const body = lookup(tree as Record<string, unknown>, card.body) as string
        expect(title.length, `${name}: ${card.id}`).toBeLessThanOrEqual(32)
        expect(body.length, `${name}: ${card.id}`).toBeLessThanOrEqual(60)
      }
    }
  })

  /** The showcase renders on one unwrapped line beside the cloud CTA. Copy is
   *  the only thing that can break that, so the budget is enforced here rather
   *  than left to whoever next edits a string. */
  it('fits title, separator and body on a single line', () => {
    const SINGLE_LINE_BUDGET = 95
    for (const [name, tree] of locales) {
      for (const card of SHOWCASE_CARDS) {
        const title = lookup(tree as Record<string, unknown>, card.title) as string
        const body = lookup(tree as Record<string, unknown>, card.body) as string
        expect(title, `${name}: ${card.id} title`).not.toMatch(/[\r\n]/)
        expect(body, `${name}: ${card.id} body`).not.toMatch(/[\r\n]/)
        expect(`${title} - ${body}`.length, `${name}: ${card.id}`).toBeLessThanOrEqual(
          SINGLE_LINE_BUDGET
        )
      }
    }
  })
})
