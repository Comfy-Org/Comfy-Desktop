import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RemoveAppDataSection from './RemoveAppDataSection.vue'
import { useModal } from '../../composables/useModal'

describe('RemoveAppDataSection', () => {
  afterEach(() => {
    const modal = useModal()
    if (modal.state.visible) modal.dismiss()
  })

  it('starts with red text and its bin icon, not a filled red button', () => {
    const wrapper = mount(RemoveAppDataSection, { props: { platform: 'darwin' } })
    const button = wrapper.get('.gs-remove-app-data-btn')

    expect(button.classes()).toContain('text-destructive')
    expect(button.classes()).toContain('bg-transparent')
    expect(button.classes()).not.toContain('bg-destructive')
    expect(button.find('svg[class*="lucide-trash"]').exists()).toBe(true)
  })

  it('asks first, and the confirm carries the filled red Remove and quit button', async () => {
    const wrapper = mount(RemoveAppDataSection, { props: { platform: 'darwin' } })
    const modal = useModal()

    await wrapper.get('.gs-remove-app-data-btn').trigger('click')
    await flushPromises()

    expect(modal.state.visible).toBe(true)
    expect(modal.state.type).toBe('confirm')
    expect(modal.state.confirmLabel).toBe('Remove and quit')
    expect(modal.state.confirmStyle).toBe('danger')
  })
})
