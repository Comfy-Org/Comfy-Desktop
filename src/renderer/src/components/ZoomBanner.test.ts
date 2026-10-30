import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import ZoomBanner from './ZoomBanner.vue'

let onZoomChanged: (level: number) => void
const resetZoom = vi.fn()

beforeEach(() => {
  resetZoom.mockReset().mockResolvedValue(undefined)
  window.api = {
    resetZoom,
    onZoomChanged: (callback: typeof onZoomChanged) => {
      onZoomChanged = callback
      return () => {}
    }
  } as unknown as typeof window.api
})

function mountBanner() {
  return mount(ZoomBanner, {
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: 'en',
          messages: {
            en: { zoom: { changed: 'Zoom changed', reset: 'Reset', dismiss: 'Dismiss' } }
          }
        })
      ]
    }
  })
}

describe('ZoomBanner', () => {
  it('shows for a changed zoom level and hides when reset externally', async () => {
    const wrapper = mountBanner()
    expect(wrapper.find('.zoom-banner').exists()).toBe(false)
    onZoomChanged(1)
    await flushPromises()
    expect(wrapper.text()).toContain('Zoom changed')
    onZoomChanged(0)
    await flushPromises()
    expect(wrapper.find('.zoom-banner').exists()).toBe(false)
  })

  it('waits for the zoom reset before hiding the banner', async () => {
    let resolveReset!: () => void
    resetZoom.mockReturnValue(new Promise<void>((resolve) => (resolveReset = resolve)))
    const wrapper = mountBanner()
    onZoomChanged(1)
    await flushPromises()
    await wrapper.get('button[data-variant="inverted"]').trigger('click')
    expect(resetZoom).toHaveBeenCalledOnce()
    expect(wrapper.find('.zoom-banner').exists()).toBe(true)
    resolveReset()
    await flushPromises()
    expect(wrapper.find('.zoom-banner').exists()).toBe(false)
  })

  it('dismisses without resetting the selected zoom', async () => {
    const wrapper = mountBanner()
    onZoomChanged(-1)
    await flushPromises()
    await wrapper.get('button[data-variant="secondary"]').trigger('click')
    expect(wrapper.find('.zoom-banner').exists()).toBe(false)
    expect(resetZoom).not.toHaveBeenCalled()
  })
})
