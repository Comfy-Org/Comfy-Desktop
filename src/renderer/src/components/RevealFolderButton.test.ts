import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RevealFolderButton from './RevealFolderButton.vue'

const REVEAL_ICON = 'svg[class*="lucide-folder-search"]'

function setPlatform(platform: string): void {
  ;(window as unknown as { api: Record<string, unknown> }).api = { platform }
}

afterEach(() => {
  ;(window as unknown as { api?: unknown }).api = undefined
})

describe('RevealFolderButton', () => {
  it('renders the FolderSearch icon titled with the reveal text', () => {
    setPlatform('win32')
    const wrapper = mount(RevealFolderButton)
    const button = wrapper.get('button.reveal-folder-button')
    expect(button.find(REVEAL_ICON).exists()).toBe(true)
    expect(button.attributes('title')).toBe('Show in Explorer')
    expect(button.attributes('aria-label')).toBe('Show in Explorer')
    expect(button.text()).toBe('')
  })

  it('names the file manager of the platform', () => {
    setPlatform('darwin')
    const wrapper = mount(RevealFolderButton)
    expect(wrapper.get('button').attributes('title')).toBe('Show in Finder')
  })

  it('adds the path to the accessible name but keeps the title short', () => {
    setPlatform('win32')
    const wrapper = mount(RevealFolderButton, { props: { path: 'C:\\ComfyUI' } })
    const button = wrapper.get('button')
    expect(button.attributes('aria-label')).toBe('Show in Explorer: C:\\ComfyUI')
    expect(button.attributes('title')).toBe('Show in Explorer')
  })

  it('emits click when pressed', async () => {
    setPlatform('win32')
    const wrapper = mount(RevealFolderButton)
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('passes a test id through to the button', () => {
    setPlatform('win32')
    const wrapper = mount(RevealFolderButton, {
      attrs: { 'data-testid': 'build-overview-open-folder' }
    })
    expect(wrapper.get('button').attributes('data-testid')).toBe('build-overview-open-folder')
  })
})
