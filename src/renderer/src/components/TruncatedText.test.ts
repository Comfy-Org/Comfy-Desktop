import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TruncatedText from './TruncatedText.vue'
import Tooltip from './ui/Tooltip.vue'

describe('TruncatedText', () => {
  it('renders the text', () => {
    const wrapper = mount(TruncatedText, { props: { text: 'Z-Image-Turbo' } })
    expect(wrapper.text()).toContain('Z-Image-Turbo')
  })

  it('disables the tooltip until the text is detected as clipped on hover', async () => {
    const wrapper = mount(TruncatedText, { props: { text: 'A very long model name' } })
    const span = wrapper.find('.truncated-text')

    // jsdom reports scrollWidth === clientWidth (0) → not truncated → disabled.
    await span.trigger('mouseenter')
    expect(wrapper.findComponent(Tooltip).props('disabled')).toBe(true)

    // Simulate an overflowing element; re-check on hover flips it enabled.
    Object.defineProperty(span.element, 'scrollWidth', { value: 200, configurable: true })
    Object.defineProperty(span.element, 'clientWidth', { value: 100, configurable: true })
    await span.trigger('mouseenter')
    expect(wrapper.findComponent(Tooltip).props('disabled')).toBe(false)
  })
})
