import { afterEach, describe, expect, it } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import BaseAlert from './BaseAlert.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: { modal: { ok: 'OK' }, common: { cancel: 'Cancel', close: 'Close' } }
  },
  missingWarn: false,
  fallbackWarn: false
})

const wrappers: VueWrapper[] = []

async function mountAlert(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  const wrapper = mount(BaseAlert, {
    attachTo: document.body,
    props: {
      open: true,
      title: 'Test alert',
      message: 'Something happened.',
      ...props
    },
    slots,
    global: {
      plugins: [i18n],
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

describe('BaseAlert', async () => {
  it('renders alertdialog with aria-modal, aria-labelledby, title, and message', async () => {
    const wrapper = await mountAlert()
    const overlay = wrapper.find('.base-alert-panel')
    expect(overlay.exists()).toBe(true)
    expect(overlay.attributes('role')).toBe('alertdialog')
    expect(overlay.attributes('aria-modal')).toBe('true')
    expect(overlay.attributes('aria-labelledby')).toBe(
      wrapper.find('.base-alert-title').attributes('id')
    )
    expect(wrapper.find('.base-alert-title').text()).toBe('Test alert')
    expect(wrapper.find('.base-alert-message').text()).toBe('Something happened.')
  })

  it('renders the default OK action and emits `close` when clicked', async () => {
    const wrapper = await mountAlert()
    const action = wrapper.find('[data-testid="base-alert-action"]')
    expect(action.text()).toBe('OK')
    await action.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('uses a custom button label when provided', async () => {
    const wrapper = await mountAlert({ buttonLabel: 'Got it' })
    expect(wrapper.find('[data-testid="base-alert-action"]').text()).toBe('Got it')
  })

  it('emits `close` on ESC when dismissOnEscape is true (the default)', async () => {
    const wrapper = await mountAlert()
    await wrapper.find('.base-alert-panel').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('does NOT emit `close` on ESC when dismissOnEscape is false', async () => {
    const wrapper = await mountAlert({ dismissOnEscape: false })
    await wrapper.find('.base-alert-panel').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('locks body scroll while open and restores the prior value on close', async () => {
    document.body.style.overflow = 'auto'
    const wrapper = await mountAlert()
    expect(document.body.style.overflow).toBe('hidden')
    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(document.body.style.overflow).toBe('auto')
  })

  it('skips body scroll lock when preventScroll=false', async () => {
    document.body.style.overflow = 'visible'
    await mountAlert({ preventScroll: false })
    expect(document.body.style.overflow).toBe('visible')
  })

  it('renders nothing when `open` is false', async () => {
    const wrapper = await mountAlert({ open: false })
    expect(wrapper.find('.base-alert-overlay').exists()).toBe(false)
  })

  it('prefers aria-label over aria-labelledby when aria-label is set', async () => {
    const wrapper = await mountAlert({ ariaLabel: 'Custom name' })
    const overlay = wrapper.find('.base-alert-panel')
    expect(overlay.attributes('aria-label')).toBe('Custom name')
    expect(overlay.attributes('aria-labelledby')).toBeUndefined()
  })

  it('renders cancel + primary when showCancel is true', async () => {
    const wrapper = await mountAlert({ showCancel: true })
    expect(wrapper.find('[data-testid="base-alert-cancel"]').text()).toBe('Cancel')
    expect(wrapper.find('[data-testid="base-alert-action"]').text()).toBe('OK')
  })

  it('emits `cancel` when the cancel button is clicked', async () => {
    const wrapper = await mountAlert({ showCancel: true })
    await wrapper.find('[data-testid="base-alert-cancel"]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('emits `cancel` on ESC when showCancel is true', async () => {
    const wrapper = await mountAlert({ showCancel: true })
    await wrapper.find('.base-alert-panel').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('uses the inverted action variant by default', async () => {
    const wrapper = await mountAlert({ showCancel: true })
    const action = wrapper.find('[data-testid="base-alert-action"]')
    expect(action.attributes('data-variant')).toBe('inverted')
  })

  it('uses the destructive action variant when tone="danger"', async () => {
    const wrapper = await mountAlert({ showCancel: true, tone: 'danger' })
    const action = wrapper.find('[data-testid="base-alert-action"]')
    expect(action.attributes('data-variant')).toBe('destructive')
  })

  it('renders a secondary button between Cancel and Primary when secondaryLabel is set', async () => {
    const wrapper = await mountAlert({
      showCancel: true,
      secondaryLabel: 'Close & Launch',
      buttonLabel: 'Launch'
    })
    const cancel = wrapper.find('[data-testid="base-alert-cancel"]')
    const secondary = wrapper.find('[data-testid="base-alert-secondary"]')
    const primary = wrapper.find('[data-testid="base-alert-action"]')
    expect(cancel.exists()).toBe(true)
    expect(secondary.text()).toBe('Close & Launch')
    expect(primary.text()).toBe('Launch')
  })

  it('emits `secondary` when the secondary button is clicked', async () => {
    const wrapper = await mountAlert({
      secondaryLabel: 'Close & Launch',
      showCancel: false
    })
    await wrapper.find('[data-testid="base-alert-secondary"]').trigger('click')
    expect(wrapper.emitted('secondary')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it('uses the destructive secondary variant when secondaryTone="danger"', async () => {
    const wrapper = await mountAlert({
      secondaryLabel: 'Close & Launch',
      secondaryTone: 'danger',
      showCancel: false
    })
    const secondary = wrapper.find('[data-testid="base-alert-secondary"]')
    expect(secondary.attributes('data-variant')).toBe('destructive')
  })

  it('renders the header close icon when showCloseIcon is true', async () => {
    const wrapper = await mountAlert({ showCloseIcon: true, showCancel: false })
    expect(wrapper.find('[data-testid="base-alert-close-icon"]').exists()).toBe(true)
  })

  it('emits `cancel` when the header close icon is clicked', async () => {
    const wrapper = await mountAlert({ showCloseIcon: true, showCancel: false })
    await wrapper.find('[data-testid="base-alert-close-icon"]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('does NOT render the header close icon by default', async () => {
    const wrapper = await mountAlert()
    expect(wrapper.find('[data-testid="base-alert-close-icon"]').exists()).toBe(false)
  })

  it('emits `cancel` on ESC when showCloseIcon is true (close icon is a cancel affordance)', async () => {
    const wrapper = await mountAlert({ showCloseIcon: true, showCancel: false })
    await wrapper.find('.base-alert-panel').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('renders messageDetails groups in recessed sub-blocks', async () => {
    const wrapper = await mountAlert({
      messageDetails: [
        { label: 'Changes when restoring', items: ['+1 custom node', '-2 pip pkgs'] }
      ]
    })
    expect(wrapper.find('.base-alert-detail-label').text()).toBe('Changes when restoring')
    const items = wrapper.findAll('.base-alert-detail-item')
    expect(items).toHaveLength(2)
    expect(items.at(0)?.text()).toBe('+1 custom node')
    expect(items.at(1)?.text()).toBe('-2 pip pkgs')
  })

  it('renders low-emphasis hint text below the main content', async () => {
    const wrapper = await mountAlert({ hint: 'This can be changed in Preferences.' })

    expect(wrapper.find('.base-alert-hint').text()).toBe('This can be changed in Preferences.')
  })

  it('renders hint text when the default slot replaces the main content', async () => {
    const wrapper = await mountAlert(
      { hint: 'This can be changed in Preferences.' },
      { default: '<div data-testid="custom-content">Custom content</div>' }
    )

    expect(wrapper.find('[data-testid="custom-content"]').text()).toBe('Custom content')
    expect(wrapper.find('.base-alert-hint').text()).toBe('This can be changed in Preferences.')
  })

  it('applies the rich-variant panel modifier when messageDetails is non-empty', async () => {
    const wrapper = await mountAlert({
      messageDetails: [{ label: 'Notes', items: ['x'] }]
    })
    expect(wrapper.find('.base-alert-panel--rich').exists()).toBe(true)
  })

  it('keeps the panel narrow when messageDetails is empty', async () => {
    const wrapper = await mountAlert()
    expect(wrapper.find('.base-alert-panel--rich').exists()).toBe(false)
  })
})
