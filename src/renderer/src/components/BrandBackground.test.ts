import { mount } from '@vue/test-utils'
import { defineComponent, h, onMounted } from 'vue'
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

// The light beams are absolutely positioned and taller than the window. When
// they share the scrolling box with the Configure form they stretch its scroll
// range, leaving empty space below the form. In scroll mode the form scrolls in
// its own area and the beams stay in the non-scrolling frame behind it.
describe('BrandBackground — scroll area', () => {
  it('scrolls the content in an area that does not hold the beams', () => {
    const wrapper = mount(BrandBackground, {
      props: { scrollContent: true },
      slots: { default: '<form class="probe">form</form>' }
    })
    const area = wrapper.get('.brand-scroll-area')

    expect(area.classes()).toContain('brand-scroll-area--active')
    expect(area.find('.probe').exists()).toBe(true)
    expect(area.find('.brand-beam').exists()).toBe(false)
    expect(wrapper.get('.brand-inner-frame').findAll(':scope > .brand-beam')).toHaveLength(2)
  })

  it('leaves the area inactive when the step does not scroll', () => {
    const wrapper = mount(BrandBackground, { slots: { default: '<p class="probe">x</p>' } })

    expect(wrapper.get('.brand-scroll-area').classes()).not.toContain('brand-scroll-area--active')
  })

  it('keeps the step content mounted when scrolling turns on or off', async () => {
    let mounts = 0
    const Probe = defineComponent({
      setup() {
        onMounted(() => {
          mounts += 1
        })
        return () => h('div', { class: 'probe' })
      }
    })
    const wrapper = mount(BrandBackground, {
      props: { scrollContent: true },
      slots: { default: () => h(Probe) }
    })

    await wrapper.setProps({ scrollContent: false })
    await wrapper.setProps({ scrollContent: true })

    expect(mounts).toBe(1)
  })

  it('returns the scroll area to the top when a step turns scrolling off', async () => {
    const wrapper = mount(BrandBackground, { props: { scrollContent: true } })
    const area = wrapper.get('.brand-scroll-area').element as HTMLElement
    area.scrollTop = 240

    await wrapper.setProps({ scrollContent: false })

    expect(area.scrollTop).toBe(0)
  })
})
