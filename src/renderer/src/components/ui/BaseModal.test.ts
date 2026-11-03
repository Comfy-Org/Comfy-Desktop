import { afterEach, describe, expect, it } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import BaseModal from './BaseModal.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { common: { close: 'Close' } } },
  missingWarn: false,
  fallbackWarn: false
})

// Tracked so `afterEach` can tear them down — otherwise a leaked
// `document.keydown` listener's `stopImmediatePropagation()` would block
// later ESC tests.
const wrappers: VueWrapper[] = []

async function mountModal(props: Record<string, unknown> = {}) {
  const wrapper = mount(BaseModal, {
    attachTo: document.body,
    props: {
      open: true,
      ariaLabel: 'Test dialog',
      ...props
    },
    slots: { default: '<p class="body-content">Hello</p>' },
    global: {
      plugins: [i18n],
      // Stub `<Teleport>` so the panel renders inside the wrapper for assertions.
      stubs: { Teleport: { template: '<div><slot /></div>' } }
    }
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  document.body.innerHTML = ''
})

describe('BaseModal', async () => {
  it('renders the dialog with role + aria-modal + aria-label and the slot body', async () => {
    const wrapper = await mountModal()
    const overlay = wrapper.find('.base-modal-panel')
    expect(overlay.exists()).toBe(true)
    expect(overlay.attributes('role')).toBe('dialog')
    expect(overlay.attributes('aria-modal')).toBe('true')
    expect(overlay.attributes('aria-label')).toBe('Test dialog')
    expect(wrapper.find('.body-content').text()).toBe('Hello')
  })

  it('renders the close button by default and emits `close` when clicked', async () => {
    const wrapper = await mountModal()
    const closeBtn = wrapper.find('[data-testid="base-modal-close"]')
    expect(closeBtn.exists()).toBe(true)
    await closeBtn.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('hides the close button when show-close-button=false', async () => {
    const wrapper = await mountModal({ showCloseButton: false })
    expect(wrapper.find('[data-testid="base-modal-close"]').exists()).toBe(false)
  })

  it('emits `close` on ESC when dismissOnEscape is true (the default)', async () => {
    const wrapper = await mountModal()
    await wrapper.find('.base-modal-panel').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('does NOT emit `close` on ESC when dismissOnEscape is false', async () => {
    const wrapper = await mountModal({ dismissOnEscape: false })
    await wrapper.find('.base-modal-panel').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('locks body scroll while open and restores the prior value on close', async () => {
    document.body.style.overflow = 'auto'
    const wrapper = await mountModal()
    // The shared overlay locks scrolling once its portal mounts.
    expect(document.body.style.overflow).toBe('hidden')
    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(document.body.style.overflow).toBe('auto')
  })

  it('skips body scroll lock when preventScroll=false', async () => {
    document.body.style.overflow = 'visible'
    await mountModal({ preventScroll: false })
    expect(document.body.style.overflow).toBe('visible')
  })

  it('renders nothing in the overlay when `open` is false', async () => {
    const wrapper = await mountModal({ open: false })
    expect(wrapper.find('.base-modal-overlay').exists()).toBe(false)
  })

  it('applies the size class to the panel', async () => {
    const wrapper = await mountModal({ size: 'xl' })
    expect(wrapper.find('.base-modal-panel').classes()).toContain('is-size-xl')
  })
})
