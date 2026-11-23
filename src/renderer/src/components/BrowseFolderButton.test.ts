import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BrowseFolderButton from './BrowseFolderButton.vue'

describe('BrowseFolderButton', () => {
  it('is a text Browse button with no icon', () => {
    const wrapper = mount(BrowseFolderButton)
    const button = wrapper.get('button.browse-folder-button')
    expect(button.text()).toBe('Browse')
    expect(button.find('svg').exists()).toBe(false)
  })

  it('emits click when pressed', async () => {
    const wrapper = mount(BrowseFolderButton)
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })
})
