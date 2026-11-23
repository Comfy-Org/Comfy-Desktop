import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import PathField from './PathField.vue'
import type { DetailField } from '../../types/ipc'

function mountField(field: DetailField) {
  return mount(PathField, {
    props: { field }
  })
}

beforeEach(() => {
  window.api = {
    openPath: vi.fn().mockResolvedValue(undefined),
    browseFolder: vi.fn().mockResolvedValue('/picked/dir')
  } as unknown as typeof window.api
})

describe('PathField', () => {
  it('renders a browse-only path as plain text that opens from its reveal button', async () => {
    const wrapper = mountField({
      id: 'cacheDir',
      label: 'Cache directory',
      value: '/home/user/.cache/comfy',
      editType: 'path',
      editable: true,
      browseOnly: true
    })
    const pathText = wrapper.find('.storage-dir-name')
    expect(pathText.exists()).toBe(true)
    expect(pathText.element.tagName).not.toBe('BUTTON')
    expect(pathText.text()).toBe('/home/user/.cache/comfy')

    await wrapper.find('.reveal-folder-button').trigger('click')
    expect(window.api.openPath).toHaveBeenCalledWith('/home/user/.cache/comfy')
  })

  it('changes a browse-only path from a text Browse button', async () => {
    const wrapper = mountField({
      id: 'cacheDir',
      label: 'Cache directory',
      value: '/home/user/.cache/comfy',
      editType: 'path',
      editable: true,
      browseOnly: true
    })
    const browse = wrapper.find('.storage-dir-browse')
    expect(browse.text()).toBe('Browse')
    expect(browse.find('svg').exists(), 'Browse shows no folder icon').toBe(false)
    await browse.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('update')?.[0]?.[1]).toBe('/picked/dir')
  })

  it('offers no reveal button when the browse-only path is empty', async () => {
    const wrapper = mountField({
      id: 'cacheDir',
      label: 'Cache directory',
      value: '',
      editType: 'path',
      editable: true,
      browseOnly: true
    })
    expect(wrapper.find('.reveal-folder-button').exists()).toBe(false)
    await wrapper.find('.storage-dir-name').trigger('click')
    expect(window.api.openPath).not.toHaveBeenCalled()
  })

  it('renders an editable input (not a StorageDirRow) for non-browse-only paths', () => {
    const wrapper = mountField({
      id: 'pypiMirror',
      label: 'PyPI Mirror',
      value: '/some/dir',
      editType: 'path',
      editable: true
    })
    expect(wrapper.find('.storage-dir-name').exists()).toBe(false)
    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('chooses an editable path from a text Browse button inside the input', async () => {
    const wrapper = mountField({
      id: 'pypiMirror',
      label: 'PyPI Mirror',
      value: '/some/dir',
      editType: 'path',
      editable: true
    })
    const browse = wrapper.find('.ui-input .path-field-browse')
    expect(browse.text()).toBe('Browse')
    expect(browse.find('svg').exists(), 'Browse shows no folder icon').toBe(false)
    await browse.trigger('click')
    await flushPromises()
    expect(window.api.browseFolder).toHaveBeenCalledWith('/some/dir')
    expect(wrapper.emitted('update')?.[0]?.[1]).toBe('/picked/dir')
  })
})
