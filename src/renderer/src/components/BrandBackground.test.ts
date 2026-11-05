import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BrandBackground from './BrandBackground.vue'

// Regression: the install wizard's Configure step turns on `scrollContent`
// (overflow-y: auto) and the Template step turns it off (overflow: hidden).
// A hidden frame is still a scroll container, and the absolutely positioned
// light beams give it a scroll range taller than the window, so a Configure
// step scrolled down to Continue left the Template step shifted up (logo and
// title cut off) with no way to scroll back.
describe('BrandBackground — frame scroll offset', () => {
  function frame(wrapper: ReturnType<typeof mount>): HTMLElement {
    return wrapper.get('.brand-inner-frame').element as HTMLElement
  }

  it('returns the frame to the top when a step turns scrolling off', async () => {
    const wrapper = mount(BrandBackground, { props: { scrollContent: true } })
    frame(wrapper).scrollTop = 240
    expect(frame(wrapper).scrollTop).toBe(240)

    await wrapper.setProps({ scrollContent: false })

    expect(frame(wrapper).classList.contains('brand-inner-frame--scroll-content')).toBe(false)
    expect(frame(wrapper).scrollTop).toBe(0)
  })

  it('keeps the offset while the step still scrolls', async () => {
    const wrapper = mount(BrandBackground, { props: { scrollContent: true, vignette: false } })
    frame(wrapper).scrollTop = 240

    await wrapper.setProps({ vignette: true })

    expect(frame(wrapper).scrollTop).toBe(240)
  })
})
