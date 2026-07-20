import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import { en } from '../lib/i18nMessages.ts'
import InstallNamePath from './InstallNamePath.vue'

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

function mountComponent(props: Record<string, unknown> = {}) {
  return mount(InstallNamePath, {
    props: {
      name: 'ComfyUI',
      path: '/home/user/ComfyUI',
      defaultPath: '/home/user/ComfyUI',
      pathIssues: [],
      diskSpaceLoading: false,
      diskSpace: null,
      estimatedSize: 0,
      ...props,
    },
    global: { plugins: [makeI18n()] },
  })
}

describe('InstallNamePath', () => {
  it('renders the install path as a clickable open button and emits open', async () => {
    const wrapper = mountComponent({ path: '/home/user/ComfyUI' })
    const pathBtn = wrapper.find('.path-open')
    expect(pathBtn.exists()).toBe(true)
    expect(pathBtn.text()).toBe('/home/user/ComfyUI')

    await pathBtn.trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('emits browse when the Browse button is clicked', async () => {
    const wrapper = mountComponent()
    const browseBtn = wrapper.findAll('.path-input button').find((b) => b.text().includes('Browse'))
    expect(browseBtn).toBeTruthy()
    await browseBtn!.trigger('click')
    expect(wrapper.emitted('browse')).toHaveLength(1)
  })

  it('no longer renders a readonly text input for the path', () => {
    const wrapper = mountComponent()
    expect(wrapper.find('.path-input input[readonly]').exists()).toBe(false)
  })
})
