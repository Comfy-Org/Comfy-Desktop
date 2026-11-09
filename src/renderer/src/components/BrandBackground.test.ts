import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import BrandBackground from './BrandBackground.vue'

function innerFrame(props: Record<string, unknown>) {
  return mount(BrandBackground, { props }).get('.brand-inner-frame')
}

describe('BrandBackground', () => {
  it('lights a takeover with the film-grain spotlight instead of the page spotlight', () => {
    const frame = innerFrame({ takeover: true })

    expect(frame.attributes('style')).toContain('--film-grain')
    expect(frame.classes()).not.toContain(PAGE_SPOTLIGHT_CLASS)
  })

  it('lights a sidebar page with the same spotlight as Builds', () => {
    const frame = innerFrame({})

    expect(frame.classes()).toContain(PAGE_SPOTLIGHT_CLASS)
    expect(frame.attributes('style')).toBeUndefined()
  })

  it('renders no beam artwork', () => {
    const wrapper = mount(BrandBackground, { props: { takeover: true } })

    expect(wrapper.find('svg').exists()).toBe(false)
  })
})
