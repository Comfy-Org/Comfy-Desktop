import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import SelectContent from '@comfyorg/design-system/select/SelectContent'
import BaseSelect from './BaseSelect.vue'

const wrappers: VueWrapper[] = []
function mountSelect(
  options = [
    { value: '', label: 'All' },
    { value: 'one', label: 'One' },
    { value: 'disabled', label: 'Unavailable', disabled: true }
  ]
) {
  const wrapper = mount(BaseSelect, {
    props: { modelValue: '', options, ariaLabel: 'Test select' },
    attachTo: document.body
  })
  wrappers.push(wrapper)
  return wrapper
}
async function open(wrapper: VueWrapper) {
  await wrapper.get('.ui-select-trigger').trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
}
afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
})

describe('BaseSelect shared adapter', () => {
  it('preserves an empty-string All option and emits its original value', async () => {
    const wrapper = mountSelect()
    await wrapper.setProps({ modelValue: 'one' })
    await open(wrapper)
    const all = document.querySelector<HTMLElement>('.ui-select-option')!
    all.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
  })

  it('renders disabled options and descriptions through shared items', async () => {
    const wrapper = mountSelect([
      { value: 'one', label: 'One', description: 'Installed locally' },
      { value: 'disabled', label: 'Unavailable', disabled: true }
    ])
    await open(wrapper)
    expect(document.querySelector('.ui-select-option-desc')?.textContent).toBe('Installed locally')
    const disabled = document.querySelector<HTMLElement>('[role="option"][aria-disabled="true"]')!
    disabled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('shows loading text without removing selectable choices', async () => {
    const wrapper = mountSelect()
    await wrapper.setProps({ loading: true, loadingLabel: 'Refreshing builds…', compact: true })
    expect(wrapper.get('.ui-select-label').text()).toBe('Refreshing builds…')
    expect(wrapper.get('.ui-select-trigger').attributes('aria-busy')).toBe('true')
    await open(wrapper)
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(3)
    expect(document.querySelector('.ui-select-listbox')?.classList).toContain(
      'ui-select-listbox--compact'
    )
  })

  it('closes on window blur and suppresses focus restoration into that window', async () => {
    const wrapper = mountSelect()
    await open(wrapper)
    const content = wrapper.findComponent(SelectContent)
    window.dispatchEvent(new Event('blur'))
    const event = new Event('closeAutoFocus', { cancelable: true })
    content.vm.$emit('closeAutoFocus', event)
    expect(event.defaultPrevented).toBe(true)
    await flushPromises()
    expect(document.querySelector('.ui-select-listbox')).toBeNull()
  })

  it('leaves the rest of the page clickable while open', async () => {
    const wrapper = mountSelect()
    await open(wrapper)
    expect(document.querySelector('.ui-select-listbox')).not.toBeNull()
    expect(document.body.style.pointerEvents).not.toBe('none')
  })

  it('contains Escape so it does not also close the host popup', async () => {
    const wrapper = mountSelect()
    await open(wrapper)
    let reachedWindow = false
    const listener = () => {
      reachedWindow = true
    }
    window.addEventListener('keydown', listener)
    try {
      document
        .querySelector('.ui-select-listbox')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flushPromises()
      expect(reachedWindow).toBe(false)
      expect(document.querySelector('.ui-select-listbox')).toBeNull()
    } finally {
      window.removeEventListener('keydown', listener)
    }
  })
})
