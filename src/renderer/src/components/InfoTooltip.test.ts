import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import InfoTooltip from './InfoTooltip.vue'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('InfoTooltip', () => {
  it('renders the icon', () => {
    const wrapper = mount(InfoTooltip, { props: { text: 'tip' } })
    expect(wrapper.find('.info-tooltip-icon').exists()).toBe(true)
  })

  it('does not show bubble initially', () => {
    const wrapper = mount(InfoTooltip, {
      props: { text: 'Hello tooltip' },
      attachTo: document.body
    })
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
    wrapper.unmount()
  })

  it('shows bubble with correct text on mouseenter', async () => {
    const wrapper = mount(InfoTooltip, {
      props: { text: 'Hello tooltip', delayMs: 0 } as Record<string, unknown>,
      attachTo: document.body
    })
    wrapper
      .get('.tooltip-wrap')
      .element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', buttons: 0 }))
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    const bubble = document.querySelector('.tooltip-bubble')
    expect(bubble).not.toBeNull()
    expect(bubble!.textContent?.trim()).toContain('Hello tooltip')
    wrapper.unmount()
  })

  it('hides bubble on mouseleave', async () => {
    const wrapper = mount(InfoTooltip, {
      props: { text: 'tip', delayMs: 0 } as Record<string, unknown>,
      attachTo: document.body
    })
    wrapper
      .get('.tooltip-wrap')
      .element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', buttons: 0 }))
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).not.toBeNull()
    await wrapper.find('.tooltip-wrap').trigger('pointerleave', { pointerType: 'mouse' })
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
    wrapper.unmount()
  })

  it('keeps its explanation open when the help icon is clicked', async () => {
    const wrapper = mount(InfoTooltip, {
      props: { text: 'tip', delayMs: 0 } as Record<string, unknown>,
      attachTo: document.body
    })
    wrapper
      .get('.tooltip-wrap')
      .element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', buttons: 0 }))
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    await wrapper.get('.tooltip-wrap').trigger('pointerdown')
    await wrapper.get('.tooltip-wrap').trigger('click')
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).not.toBeNull()
    wrapper.unmount()
  })

  it('renders the bubble with a resolved `data-side` attribute', async () => {
    const wrapper = mount(InfoTooltip, {
      props: { text: 'tip', side: 'bottom', delayMs: 0 } as Record<string, unknown>,
      attachTo: document.body
    })
    wrapper
      .get('.tooltip-wrap')
      .element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', buttons: 0 }))
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    const bubble = document.querySelector('.tooltip-bubble')
    expect(bubble?.getAttribute('data-side')).toMatch(/^(top|bottom|left|right)$/)
    wrapper.unmount()
  })
})
