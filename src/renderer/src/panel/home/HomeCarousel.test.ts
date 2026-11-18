import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { mount, type VueWrapper } from '@vue/test-utils'

import '../../assets/main.css'
import HomeCarousel from './HomeCarousel.vue'
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

function mountCarousel() {
  const host = document.createElement('div')
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1000px; height: 400px'
  document.body.append(host)
  hosts.push(host)
  const wrapper = mount(HomeCarousel<CarouselCard>, {
    attachTo: host,
    props: { cards: [PRODUCT_SWAP, HDR, EXTEND], kind: 'apps', picturesOf: () => [] }
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
