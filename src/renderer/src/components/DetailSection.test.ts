import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import type { ActionDef } from '../types/ipc'
import DetailSection from './DetailSection.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: {} },
  missingWarn: false,
  fallbackWarn: false
})

const defaultProps = {
  installationId: 'test-install-1'
}

function mountComponent(props: Record<string, unknown> = {}) {
  return mount(DetailSection, {
    props: { ...defaultProps, ...props },
    global: { plugins: [i18n] }
  })
}

beforeEach(() => {
  window.api = {
    updateInstallation: vi.fn().mockResolvedValue({}),
    runAction: vi.fn().mockResolvedValue({ navigate: undefined }),
    openPath: vi.fn().mockResolvedValue(undefined),
    browseFolder: vi.fn().mockResolvedValue('/picked/dir'),
  } as unknown as typeof window.api
})

describe('DetailSection', () => {
  it('starts collapsed when collapsed=true', () => {
    const wrapper = mountComponent({ title: 'Collapsible', collapsed: true })
    expect((wrapper.find('.detail-section-body').element as HTMLElement).style.display).toBe('none')
  })

  it('toggles collapse on title click', async () => {
    const wrapper = mountComponent({ title: 'Toggle Me', collapsed: true })
    const bodyEl = wrapper.find('.detail-section-body').element as HTMLElement

    expect(bodyEl.style.display).toBe('none')

    await wrapper.find('.detail-section-title').trigger('click')
    expect(bodyEl.style.display).not.toBe('none')

    await wrapper.find('.detail-section-title').trigger('click')
    expect(bodyEl.style.display).toBe('none')
  })

  it('is not collapsible when collapsed=null', async () => {
    const wrapper = mountComponent({ title: 'Static', collapsed: null })
    const bodyEl = wrapper.find('.detail-section-body').element as HTMLElement

    expect(bodyEl.style.display).not.toBe('none')

    await wrapper.find('.detail-section-title').trigger('click')
    expect(bodyEl.style.display).not.toBe('none')
  })

  it('emits run-action with the action def when action button clicked', async () => {
    const actions: ActionDef[] = [{ id: 'a1', label: 'Launch' }]
    const wrapper = mountComponent({ actions })

    await wrapper.find('.detail-actions button').trigger('click')

    const emitted = wrapper.emitted('run-action')!
    expect(emitted).toHaveLength(1)
    expect(emitted[0]![0]).toEqual(actions[0])
  })

  it('opens the folder when a browse-only path is clicked', async () => {
    const wrapper = mountComponent({
      fields: [
        {
          id: 'inputDir',
          label: 'Input Directory',
          value: '/home/user/input',
          editable: true,
          editType: 'path',
          browseOnly: true,
        },
      ],
    })
    const pathBtn = wrapper.find('.detail-path-open')
    expect(pathBtn.exists()).toBe(true)
    expect(pathBtn.text()).toBe('/home/user/input')
    await pathBtn.trigger('click')
    expect(window.api.openPath).toHaveBeenCalledWith('/home/user/input')
  })

  it('keeps an editable text input for non-browse-only paths', () => {
    const wrapper = mountComponent({
      fields: [
        {
          id: 'inputDir',
          label: 'Input Directory',
          value: '/home/user/input',
          editable: true,
          editType: 'path',
        },
      ],
    })
    expect(wrapper.find('.detail-path-open').exists()).toBe(false)
    expect(wrapper.find('input.detail-field-input').exists()).toBe(true)
  })

  it('makes a non-editable path value clickable to open', async () => {
    const wrapper = mountComponent({
      fields: [{ id: 'location', label: 'Location', value: '/opt/ComfyUI' }],
    })
    const btn = wrapper.find('.detail-field-value-open')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(window.api.openPath).toHaveBeenCalledWith('/opt/ComfyUI')
  })

  it('does not make a non-editable URL value clickable', () => {
    const wrapper = mountComponent({
      fields: [{ id: 'repo', label: 'Repository', value: 'https://github.com/x/y' }],
    })
    expect(wrapper.find('.detail-field-value-open').exists()).toBe(false)
  })
})
