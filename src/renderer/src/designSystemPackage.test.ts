import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Button from '@comfyorg/design-system/button/Button'

describe('@comfyorg/design-system in the renderer', () => {
  it('renders a package component as a native button with its slot content', () => {
    const wrapper = mount(Button, { slots: { default: 'Install' } })

    const button = wrapper.get('button')
    expect(button.text()).toBe('Install')
  })

  it('forwards clicks to the listener the host passes in', async () => {
    const onClick = vi.fn()
    const wrapper = mount(Button, { attrs: { onClick }, slots: { default: 'Install' } })

    await wrapper.get('button').trigger('click')

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not fire the listener while disabled', async () => {
    const onClick = vi.fn()
    const wrapper = mount(Button, {
      props: { disabled: true },
      attrs: { onClick },
      slots: { default: 'Install' }
    })

    await wrapper.get('button').trigger('click')

    expect(onClick).not.toHaveBeenCalled()
  })
})
