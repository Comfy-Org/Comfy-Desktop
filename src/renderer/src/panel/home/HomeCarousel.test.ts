import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { mount, type VueWrapper } from '@vue/test-utils'

import '../../assets/main.css'
import HomeCarousel from './HomeCarousel.vue'
import CoverRotation from '../../components/CoverRotation.vue'
import type { AppBadge } from '../../types/ipc'

interface CarouselCard {
  id: string
  title: string
  description: string
  badges?: AppBadge[]
}

const PRODUCT_SWAP: CarouselCard = {
  id: 'product-swap',
  title: 'Product Swap',
  description: 'Put your product in a clip.',
  badges: [
    {
      id: 'uses-credits',
      style: 'crown',
      text: { en: 'Uses credits' },
      description: { en: 'Runs a paid partner model' }
    },
    { id: 'new', style: 'chip', text: { en: 'New' } }
  ]
}
const HDR: CarouselCard = { id: 'sdr-to-hdr', title: 'SDR to HDR', description: '' }
const EXTEND: CarouselCard = { id: 'extend-picture', title: 'Extend Picture', description: '' }

const mounted: VueWrapper[] = []
const hosts: HTMLElement[] = []

beforeAll(() => page.viewport(1200, 800))

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
  while (hosts.length) hosts.pop()?.remove()
})

function mountCarousel(
  picturesOf: (card: CarouselCard) => { url: string; stillUrl: string | null }[] = () => []
) {
  const host = document.createElement('div')
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1000px; height: 400px'
  document.body.append(host)
  hosts.push(host)
  const wrapper = mount(HomeCarousel<CarouselCard>, {
    attachTo: host,
    props: { cards: [PRODUCT_SWAP, HDR, EXTEND], kind: 'apps', picturesOf }
  })
  mounted.push(wrapper)
  return wrapper
}

function frontCard(wrapper: VueWrapper) {
  return wrapper.get('[data-testid="home-carousel-card"][aria-current="true"]')
}

describe('HomeCarousel app badges', () => {
  it('puts the badges in the top left corner and the open arrow in the top right, apart', () => {
    const wrapper = mountCarousel()

    const card = frontCard(wrapper).element as HTMLElement
    const badges = frontCard(wrapper).get('[data-testid="app-badges"]').element as HTMLElement
    const arrow = frontCard(wrapper).get('[data-testid="home-carousel-cta"]').element as HTMLElement

    expect(badges.offsetParent).toBe(card)
    expect(arrow.offsetParent).toBe(card)
    expect([badges.offsetLeft, badges.offsetTop]).toEqual([12, 12])
    expect([card.offsetWidth - arrow.offsetLeft - arrow.offsetWidth, arrow.offsetTop]).toEqual([
      12, 12
    ])
    expect(badges.offsetWidth).toBe(28)
    expect(badges.offsetLeft + badges.offsetWidth).toBeLessThan(arrow.offsetLeft)
  })

  it('describes a card with each of its badges and leaves a card without badges undescribed', () => {
    const wrapper = mountCarousel()

    const ids = frontCard(wrapper).attributes('aria-describedby')?.split(' ') ?? []
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Uses credits: Runs a paid partner model',
      'New'
    ])
    expect(frontCard(wrapper).attributes('aria-label')).toBe('Open Product Swap')
    expect(
      wrapper
        .get('[data-testid="home-carousel-card"][data-arc-offset="1"]')
        .attributes('aria-describedby')
    ).toBe(undefined)
  })

  it("shows the first badge's description when the card gets keyboard focus, and Escape closes it with focus kept on the card", async () => {
    const wrapper = mountCarousel()
    expect(document.querySelector('.tooltip-bubble')).toBe(null)

    await userEvent.tab()

    expect(document.activeElement).toBe(frontCard(wrapper).element)
    await expect
      .poll(() => document.querySelector('.tooltip-bubble')?.textContent ?? '')
      .toContain('Runs a paid partner model')
    const bubble = document.querySelector('.tooltip-bubble')!.getBoundingClientRect()
    expect(bubble.width).toBeGreaterThan(0)
    expect(bubble.height).toBeGreaterThan(0)

    await userEvent.keyboard('{Escape}')

    await expect.poll(() => document.querySelector('.tooltip-bubble')).toBe(null)
    expect(document.activeElement).toBe(frontCard(wrapper).element)
  })
})

describe('HomeCarousel covers', () => {
  const coverOf = (card: CarouselCard) => [
    { url: `/covers/${card.id}.webp`, stillUrl: `/covers/${card.id}-still.webp` }
  ]

  function playingCards(wrapper: VueWrapper) {
    return wrapper
      .findAllComponents(CoverRotation)
      .filter((cover) => !cover.props('paused'))
      .map((cover) =>
        cover.element.closest('[data-testid="home-carousel-card"]')?.getAttribute('data-arc-offset')
      )
  }

  it('plays only the card in the centre and keeps the cards beside it still', () => {
    const wrapper = mountCarousel(coverOf)

    expect(wrapper.findAllComponents(CoverRotation).length).toBeGreaterThan(1)
    expect(playingCards(wrapper)).toEqual(['0'])
  })

  it('shows the still picture on the cards beside the centre and the moving cover in the centre', () => {
    const wrapper = mountCarousel(coverOf)

    const shown = wrapper
      .findAll('[data-testid="home-carousel-card"]')
      .filter((card) => card.find('img[data-cover="shown"]').exists())
      .map((card) => [
        card.attributes('data-arc-offset'),
        card.get('img[data-cover="shown"]').attributes('src')?.endsWith('-still.webp')
      ])

    expect(shown.length).toBeGreaterThan(1)
    expect(shown.filter(([, isStill]) => !isStill).map(([offset]) => offset)).toEqual(['0'])
  })

  it('plays the next card once it reaches the centre', async () => {
    const wrapper = mountCarousel(coverOf)
    const before = frontCard(wrapper).attributes('aria-label')

    await wrapper.get('[data-testid="home-carousel-card"][data-arc-offset="1"]').trigger('click')

    expect(frontCard(wrapper).attributes('aria-label')).not.toBe(before)
    expect(playingCards(wrapper)).toEqual(['0'])
  })
})

describe('HomeCarousel trackpad and wheel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function swipe(
    wrapper: VueWrapper,
    deltas: Array<{ deltaX?: number; deltaY?: number; deltaMode?: number; shiftKey?: boolean }>
  ) {
    const target = frontCard(wrapper).element
    return deltas.map((delta) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...delta })
      target.dispatchEvent(event)
      return event.defaultPrevented
    })
  }

  const frontTitle = (wrapper: VueWrapper) => frontCard(wrapper).attributes('aria-label')

  it('turns to the next card on a sideways swipe and back on a swipe the other way', async () => {
    const wrapper = mountCarousel()

    swipe(wrapper, [{ deltaX: 30 }, { deltaX: 30 }])
    await wrapper.vm.$nextTick()
    expect(frontTitle(wrapper)).toBe('Open SDR to HDR')

    vi.advanceTimersByTime(1000)
    swipe(wrapper, [{ deltaX: -30 }, { deltaX: -30 }])
    await wrapper.vm.$nextTick()
    expect(frontTitle(wrapper)).toBe('Open Product Swap')
  })

  it('turns only one card for one long swipe', async () => {
    const wrapper = mountCarousel()

    swipe(
      wrapper,
      Array.from({ length: 30 }, () => ({ deltaX: 25 }))
    )
    await wrapper.vm.$nextTick()

    expect(frontTitle(wrapper)).toBe('Open SDR to HDR')
  })

  it('turns with shift and the mouse wheel', async () => {
    const wrapper = mountCarousel()

    swipe(wrapper, [{ deltaY: 100, shiftKey: true }])
    await wrapper.vm.$nextTick()

    expect(frontTitle(wrapper)).toBe('Open SDR to HDR')
  })

  it('turns with the mouse wheel alone, one card per notch gesture, in pixel units', async () => {
    const wrapper = mountCarousel()

    expect(swipe(wrapper, [{ deltaY: 100 }])).toEqual([true])
    await wrapper.vm.$nextTick()
    expect(frontTitle(wrapper)).toBe('Open SDR to HDR')

    vi.advanceTimersByTime(1000)
    expect(swipe(wrapper, [{ deltaY: -100 }])).toEqual([true])
    await wrapper.vm.$nextTick()
    expect(frontTitle(wrapper)).toBe('Open Product Swap')
  })

  it('turns with the mouse wheel alone in line units', async () => {
    const wrapper = mountCarousel()

    expect(swipe(wrapper, [{ deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_LINE }])).toEqual([true])
    await wrapper.vm.$nextTick()
    expect(frontTitle(wrapper)).toBe('Open SDR to HDR')

    vi.advanceTimersByTime(1000)
    expect(swipe(wrapper, [{ deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE }])).toEqual([true])
    await wrapper.vm.$nextTick()
    expect(frontTitle(wrapper)).toBe('Open Extend Picture')
  })

  it('turns only one card for a fast run of wheel notches', async () => {
    const wrapper = mountCarousel()

    swipe(
      wrapper,
      Array.from({ length: 8 }, () => ({ deltaY: 100 }))
    )
    await wrapper.vm.$nextTick()

    expect(frontTitle(wrapper)).toBe('Open SDR to HDR')
  })

  it('keeps a mostly up or down trackpad swipe with some sideways drift for the page', async () => {
    const wrapper = mountCarousel()

    const prevented = swipe(wrapper, [{ deltaY: 120, deltaX: 4 }])
    await wrapper.vm.$nextTick()

    expect(prevented).toEqual([false])
    expect(frontTitle(wrapper)).toBe('Open Product Swap')
  })

  it('leaves the wheel to the page once the carousel is at its first or last card', async () => {
    const wrapper = mountCarousel()

    expect(swipe(wrapper, [{ deltaY: -100 }])).toEqual([false])
    await wrapper.vm.$nextTick()
    expect(frontTitle(wrapper)).toBe('Open Product Swap')

    swipe(wrapper, [{ deltaY: 100 }])
    vi.advanceTimersByTime(1000)
    swipe(wrapper, [{ deltaY: 100 }])
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()
    expect(frontTitle(wrapper)).toBe('Open Extend Picture')

    expect(swipe(wrapper, [{ deltaY: 100 }])).toEqual([false])
    await wrapper.vm.$nextTick()
    expect(frontTitle(wrapper)).toBe('Open Extend Picture')
  })

  it('still turns with a sideways trackpad swipe at the first card, as before', async () => {
    const wrapper = mountCarousel()

    expect(swipe(wrapper, [{ deltaX: -30 }, { deltaX: -30 }])).toEqual([true, true])
    await wrapper.vm.$nextTick()
    expect(frontTitle(wrapper)).toBe('Open Product Swap')
  })
})

describe('HomeCarousel card names', () => {
  it('shows only the title until the front card is hovered, then lifts it and brings in what the app does', async () => {
    const wrapper = mountCarousel()
    const card = frontCard(wrapper).element as HTMLElement
    const title = frontCard(wrapper).get('[data-testid="home-carousel-title"]')
      .element as HTMLElement
    const description = frontCard(wrapper).get('[data-testid="home-carousel-description"]')
      .element as HTMLElement
    const bottomOf = (element: HTMLElement) =>
      Math.round(card.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom)

    expect(getComputedStyle(description).opacity).toBe('0')
    expect(bottomOf(title)).toBe(16)

    await userEvent.hover(card)
    await expect.poll(() => getComputedStyle(description).opacity).toBe('1')
    await expect.poll(() => bottomOf(description)).toBe(16)
    await expect.poll(() => bottomOf(title)).toBe(34)

    await userEvent.unhover(card)
    await expect.poll(() => getComputedStyle(description).opacity).toBe('0')
    await expect.poll(() => bottomOf(title)).toBe(16)
  })

  it('keeps what the app does hidden on a side card when it is hovered', async () => {
    const wrapper = mount(HomeCarousel<CarouselCard>, {
      attachTo: document.body,
      props: { cards: [HDR, PRODUCT_SWAP, EXTEND], kind: 'apps', picturesOf: () => [] }
    })
    mounted.push(wrapper)
    const side = wrapper.get('[data-testid="home-carousel-card"][data-arc-offset="1"]')
    const description = side.get('[data-testid="home-carousel-description"]').element

    await userEvent.hover(side.element)
    await Promise.all(description.getAnimations().map((animation) => animation.finished))
    expect(getComputedStyle(description).opacity).toBe('0')
  })
})
