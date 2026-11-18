import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { mount, type VueWrapper } from '@vue/test-utils'

import '../assets/main.css'
import PremiumAppBadge from './PremiumAppBadge.vue'

const mounted: VueWrapper[] = []

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
})

describe('PremiumAppBadge', () => {
  it('is a square of glass with only the crown, its name for screen readers', () => {
    const wrapper = mount(PremiumAppBadge, { attachTo: document.body })
    mounted.push(wrapper)

    const square = wrapper.get('[data-testid="premium-app-square"]')
    const box = square.element.getBoundingClientRect()
    expect(box.width).toBe(28)
    expect(box.height).toBe(28)
    expect(getComputedStyle(square.element).backdropFilter).toContain('blur(14px)')
    expect(wrapper.find('[data-testid="premium-app-crown"]').exists()).toBe(true)
    const name = square.get('svg + span')
    expect(name.text()).toBe('Premium app')
    expect(getComputedStyle(name.element).position).toBe('absolute')
    expect(name.element.getBoundingClientRect().width).toBeLessThanOrEqual(1)
  })

  it('says it is a premium app that runs with credits on hover', async () => {
    const wrapper = mount(PremiumAppBadge, { attachTo: document.body })
    mounted.push(wrapper)

    await userEvent.hover(wrapper.get('[data-testid="premium-app-badge"]').element)

    await expect
      .element(page.getByRole('tooltip'))
      .toHaveTextContent('Premium appRuns with credits')
  })
})
