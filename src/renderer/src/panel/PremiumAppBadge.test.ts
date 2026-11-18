import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { mount, type VueWrapper } from '@vue/test-utils'

import '../assets/main.css'
import PremiumAppBadge from './PremiumAppBadge.vue'

const mounted: VueWrapper[] = []

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
})

describe('PremiumAppBadge', () => {
  it('is a square of glass with only the crown, and carries the credit note for its card to point at', () => {
    const wrapper = mount(PremiumAppBadge, {
      attachTo: document.body,
      props: { descriptionId: 'premium-note' }
    })
    mounted.push(wrapper)

    const square = wrapper.get('[data-testid="premium-app-square"]')
    const box = square.element.getBoundingClientRect()
    expect(box.width).toBe(28)
    expect(box.height).toBe(28)
    expect(getComputedStyle(square.element).backdropFilter).toContain('blur(14px)')
    expect(wrapper.find('[data-testid="premium-app-crown"]').exists()).toBe(true)
    const note = document.getElementById('premium-note')
    expect(note?.textContent).toBe('Premium app, runs with credits')
    expect(note?.hidden).toBe(true)
  })

  it('says it is a premium app that runs with credits on hover', async () => {
    const wrapper = mount(PremiumAppBadge, {
      attachTo: document.body,
      props: { descriptionId: 'premium-note' }
    })
    mounted.push(wrapper)

    await userEvent.hover(wrapper.get('[data-testid="premium-app-badge"]').element)

    await expect
      .poll(() => document.querySelector('.tooltip-bubble')?.textContent ?? '')
      .toContain('Premium app, runs with credits')
  })

  it('shows the credit note while its card has keyboard focus, and hides it after', async () => {
    const wrapper = mount(PremiumAppBadge, {
      attachTo: document.body,
      props: { descriptionId: 'premium-note', revealed: false }
    })
    mounted.push(wrapper)

    await wrapper.setProps({ revealed: true })

    await expect
      .poll(() => document.querySelector('.tooltip-bubble')?.textContent ?? '')
      .toContain('Premium app, runs with credits')

    await wrapper.setProps({ revealed: false })

    await expect.poll(() => document.querySelector('.tooltip-bubble')).toBe(null)
  })
})
