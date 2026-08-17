import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import en from '../../../../locales/en.json'
import InstallShowcase from './InstallShowcase.vue'
import { TID } from '../../../shared/testIds'
import { SHOWCASE_CARDS } from '../lib/installShowcase'
import { SHOWCASE_INTERVAL_MS } from '../composables/useShowcaseCarousel'

const mounted: Array<{ unmount: () => void }> = []

function mountShowcase(canOfferCloud = true) {
  const wrapper = mount(InstallShowcase, {
    props: { canOfferCloud },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] }
  })
  mounted.push(wrapper)
  return wrapper
}

const find = (w: ReturnType<typeof mountShowcase>, id: string) => w.find(`[data-testid="${id}"]`)

/** Resolved from the card list, so reordering the carousel does not require
 *  rewriting every positional assertion. */
const titleAt = (index: number): string => {
  const card = SHOWCASE_CARDS[index]!
  return card.title.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[part]
    return undefined
  }, en) as string
}

beforeEach(() => {
  vi.useFakeTimers()
  mounted.length = 0
})

// Unmount before the clock is restored, so a component's interval cannot
// outlive the fake timers that were driving it.
afterEach(() => {
  mounted.forEach((w) => w.unmount())
  mounted.length = 0
  vi.useRealTimers()
})

describe('cards', () => {
  it('opens on the skip-the-wait card', () => {
    expect(find(mountShowcase(), TID.installShowcaseTitle).text()).toBe(
      en.installShowcase.cloud.title
    )
  })

  it('shows one card at a time', () => {
    expect(mountShowcase().findAll('.showcase__line')).toHaveLength(1)
  })

  it('renders the card body alongside its title', () => {
    expect(mountShowcase().text()).toContain(en.installShowcase.cloud.body)
  })

  it('advances to the next card on its own', async () => {
    const w = mountShowcase()
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS)
    await w.vm.$nextTick()
    expect(find(w, TID.installShowcaseTitle).text()).toBe(titleAt(1))
  })

  it('names the section for screen readers', () => {
    expect(find(mountShowcase(), TID.installShowcase).attributes('aria-label')).toBe(
      en.installShowcase.label
    )
  })
})

describe('the cloud action', () => {
  it('offers a way to skip the wait', () => {
    const w = mountShowcase()
    expect(find(w, TID.installShowcaseCloud).text()).toContain(en.installShowcase.cloudCta)
  })

  it('emits when taken', async () => {
    const w = mountShowcase()
    await find(w, TID.installShowcaseCloud).trigger('click')
    expect(w.emitted('open-cloud')).toHaveLength(1)
  })

  it('hides the action when cloud is unavailable, keeping the card', () => {
    const w = mountShowcase(false)
    expect(find(w, TID.installShowcaseCloud).exists()).toBe(false)
    expect(find(w, TID.installShowcaseTitle).text()).toBe(en.installShowcase.cloud.title)
  })

  it('stays put as the cards rotate, so it is always actionable', async () => {
    const w = mountShowcase()
    for (let i = 0; i < SHOWCASE_CARDS.length; i++) {
      expect(find(w, TID.installShowcaseCloud).exists(), `card ${i}`).toBe(true)
      vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS)
      await w.vm.$nextTick()
    }
  })

  it('sits outside the rotating line so it never animates away', () => {
    const w = mountShowcase()
    expect(
      w.find('.showcase__line').find(`[data-testid="${TID.installShowcaseCloud}"]`).exists()
    ).toBe(false)
  })
})

/** Shipped installers rotate passively — no dots, no arrows, no transport.
 *  The cloud CTA is the only control on the surface. */
describe('passive rotation', () => {
  it('ships no carousel transport controls', () => {
    const w = mountShowcase()
    expect(w.findAll('.showcase__dot')).toHaveLength(0)
    expect(w.findAll('.showcase__arrow')).toHaveLength(0)
    expect(w.findAll('.showcase__rail')).toHaveLength(0)
  })

  it('leaves the cloud CTA as the only button', () => {
    expect(mountShowcase().findAll('button')).toHaveLength(1)
  })

  it('renders as a single line, not a stacked block', () => {
    const w = mountShowcase()
    expect(w.find('.showcase').classes()).toBeTruthy()
    expect(w.findAll('.showcase > *').length).toBeLessThanOrEqual(2)
  })
})

describe('pausing while the user reads', () => {
  it('holds on hover', async () => {
    const w = mountShowcase()
    await find(w, TID.installShowcase).trigger('mouseenter')
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS * 2)
    await w.vm.$nextTick()
    expect(find(w, TID.installShowcaseTitle).text()).toBe(en.installShowcase.cloud.title)
  })

  it('resumes when the pointer leaves', async () => {
    const w = mountShowcase()
    await find(w, TID.installShowcase).trigger('mouseenter')
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS)
    await find(w, TID.installShowcase).trigger('mouseleave')
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS)
    await w.vm.$nextTick()
    expect(find(w, TID.installShowcaseTitle).text()).toBe(titleAt(1))
  })

  it('holds while the cloud CTA has focus', async () => {
    const w = mountShowcase()
    await find(w, TID.installShowcase).trigger('focusin')
    vi.advanceTimersByTime(SHOWCASE_INTERVAL_MS * 2)
    await w.vm.$nextTick()
    expect(find(w, TID.installShowcaseTitle).text()).toBe(en.installShowcase.cloud.title)
  })
})
