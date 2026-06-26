import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import { en } from '../../lib/i18nMessages.ts'
import PathField from './PathField.vue'
import type { DetailField } from '../../types/ipc'

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

function mountField(field: DetailField) {
  return mount(PathField, {
    props: { field },
    global: { plugins: [makeI18n()] },
  })
}

beforeEach(() => {
  window.api = {
    openPath: vi.fn().mockResolvedValue(undefined),
    browseFolder: vi.fn().mockResolvedValue('/picked/dir'),
  } as unknown as typeof window.api
})

describe('PathField', () => {
  it('renders a clickable StorageDirRow for browse-only paths', async () => {
    const wrapper = mountField({
      id: 'cacheDir',
      label: 'Cache Directory',
      value: '/home/user/.cache/comfy',
      editType: 'path',
      editable: true,
      browseOnly: true,
    })
    const pathBtn = wrapper.find('.storage-dir-name')
    expect(pathBtn.exists()).toBe(true)
    expect(pathBtn.text()).toBe('/home/user/.cache/comfy')

    await pathBtn.trigger('click')
    expect(window.api.openPath).toHaveBeenCalledWith('/home/user/.cache/comfy')
  })

  it('does not call openPath when the browse-only path is empty', async () => {
    const wrapper = mountField({
      id: 'cacheDir',
      label: 'Cache Directory',
      value: '',
      editType: 'path',
      editable: true,
      browseOnly: true,
    })
    await wrapper.find('.storage-dir-name').trigger('click')
    expect(window.api.openPath).not.toHaveBeenCalled()
  })

  it('renders an editable input (not a StorageDirRow) for non-browse-only paths', () => {
    const wrapper = mountField({
      id: 'pypiMirror',
      label: 'PyPI Mirror',
      value: '/some/dir',
      editType: 'path',
      editable: true,
    })
    expect(wrapper.find('.storage-dir-name').exists()).toBe(false)
    expect(wrapper.find('input').exists()).toBe(true)
  })
})
