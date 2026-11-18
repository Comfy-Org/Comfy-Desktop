import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { mount, type VueWrapper } from '@vue/test-utils'

import '../../assets/main.css'
import HomeCarousel from './HomeCarousel.vue'

interface CarouselCard {
  id: string
  title: string
  description: string
  premium?: boolean
}

const PRODUCT_SWAP: CarouselCard = {
  id: 'product-swap',
  title: 'Product Swap',
  description: 'Put your product in a clip.',
  premium: true
}
const HDR: CarouselCard = { id: 'sdr-to-hdr', title: 'SDR to HDR', description: '' }
const EXTEND: CarouselCard = { id: 'extend-picture', title: 'Extend Picture', description: '' }

const mounted: VueWrapper[] = []

beforeAll(() => page.viewport(1200, 800))

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
})

function mountCarousel() {
  const host = document.createElement('div')
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1000px; height: 400px'
  document.body.append(host)
  const wrapper = mount(HomeCarousel<CarouselCard>, {
    attachTo: host,
    props: { cards: [PRODUCT_SWAP, HDR, EXTEND], kind: 'apps', pictureOf: () => null }
  })
  mounted.push(wrapper)
  return wrapper
}

function frontCard(wrapper: VueWrapper) {
  return wrapper.get('[data-testid="home-carousel-card"][aria-current="true"]')
}

describe('HomeCarousel premium apps', () => {
  it('puts the crown in the top left corner and the open arrow in the top right, apart', () => {
    const wrapper = mountCarousel()

    const card = frontCard(wrapper).element as HTMLElement
    const crown = frontCard(wrapper).get('[data-testid="premium-app-badge"]').element as HTMLElement
    const arrow = frontCard(wrapper).get('[data-testid="home-carousel-cta"]').element as HTMLElement

    expect(crown.offsetParent).toBe(card)
    expect(arrow.offsetParent).toBe(card)
    expect([crown.offsetLeft, crown.offsetTop]).toEqual([12, 12])
    expect([card.offsetWidth - arrow.offsetLeft - arrow.offsetWidth, arrow.offsetTop]).toEqual([
      12, 12
    ])
    expect(crown.offsetLeft + crown.offsetWidth).toBeLessThan(arrow.offsetLeft)
  })

  it('describes a premium card with its credit note and leaves a free card without one', () => {
    const wrapper = mountCarousel()

    const noteId = frontCard(wrapper).attributes('aria-describedby')
    expect(noteId && document.getElementById(noteId)?.textContent).toBe(
      'Premium app, runs with credits'
    )
    expect(frontCard(wrapper).attributes('aria-label')).toBe('Open Product Swap')
    expect(
      wrapper
        .get('[data-testid="home-carousel-card"][data-arc-offset="1"]')
        .attributes('aria-describedby')
    ).toBe(undefined)
  })

  it('shows the credit note when the premium card gets keyboard focus', async () => {
    const wrapper = mountCarousel()

    await userEvent.tab()

    expect(document.activeElement).toBe(frontCard(wrapper).element)
    await expect
      .poll(() => document.querySelector('.tooltip-bubble')?.textContent ?? '')
      .toContain('Premium app, runs with credits')
  })
})
