import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import { en } from '../../lib/i18nMessages.ts'
import SettingsSectionList from './SettingsSectionList.vue'
import type { DetailField } from '../../types/ipc'

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

function mountList(fields: DetailField[]) {
  return mount(SettingsSectionList, {
    props: { sections: [{ fields }] },
    global: { plugins: [makeI18n()] },
  })
}

function mountReadonly(fields: DetailField[]) {
  return mount(SettingsSectionList, {
    props: { sections: [{ fields }], readonly: true },
    global: { plugins: [makeI18n()] },
  })
}

describe('SettingsSectionList', () => {
  // When main attaches a field `description`, the renderer must surface it under the control.
  describe('field descriptions', () => {
    it('renders the description below the control when one is attached', () => {
      const wrapper = mountList([
        {
          id: 'useChineseMirrors',
          label: 'Use Chinese Mirrors (Git & PyPI)',
          value: true,
          editable: true,
          editType: 'boolean',
          description:
            'Git repositories clone from gitcode.com instead of github.com.',
        },
      ])
      const desc = wrapper.find('.settings-v2-field-description')
      expect(desc.exists()).toBe(true)
      expect(desc.text()).toContain('gitcode.com')
    })

    it('does not render the description block when none is attached', () => {
      const wrapper = mountList([
        {
          id: 'useChineseMirrors',
          label: 'Use Chinese Mirrors (Git & PyPI)',
          value: false,
          editable: true,
          editType: 'boolean',
        },
      ])
      expect(wrapper.find('.settings-v2-field-description').exists()).toBe(false)
    })

    it('renders descriptions for non-boolean field types too', () => {
      const wrapper = mountList([
        {
          id: 'pypiMirror',
          label: 'PyPI Mirror URL',
          value: '',
          editable: true,
          editType: 'text',
          placeholder: 'e.g. https://mirrors.aliyun.com/pypi/simple/',
          description: 'Overrides the default index when set.',
        },
      ])
      const desc = wrapper.find('.settings-v2-field-description')
      expect(desc.exists()).toBe(true)
      expect(desc.text()).toContain('default index')
    })

    it('renders an InfoTooltip trigger when a field has a tooltip', () => {
      const wrapper = mountList([
        {
          id: 'useChineseMirrors',
          label: 'Use Chinese Mirrors (Git & PyPI)',
          value: false,
          editable: true,
          editType: 'boolean',
          tooltip:
            'Git repositories clone from gitcode.com instead of github.com.',
        },
      ])
      const trigger = wrapper.find('.info-tooltip-trigger')
      expect(trigger.exists()).toBe(true)
      expect(trigger.attributes('aria-label')).toContain('gitcode.com')
    })
  })

  // Readonly path values render as a clickable open-folder button, keeping the
  // copy button, and only fire `open-path` for real filesystem paths.
  describe('readonly path rows', () => {
    it('renders a clickable button that emits open-path for a path value', async () => {
      const wrapper = mountReadonly([
        { id: 'location', label: 'Location', value: '/home/user/ComfyUI', editType: 'path' },
      ])
      const btn = wrapper.find('button.settings-v2-field-readonly-open')
      expect(btn.exists()).toBe(true)
      expect(btn.text()).toBe('/home/user/ComfyUI')
      await btn.trigger('click')
      expect(wrapper.emitted('open-path')?.[0]).toEqual(['/home/user/ComfyUI'])
    })

    it('keeps the copy button alongside the path', () => {
      const wrapper = mountReadonly([
        { id: 'location', label: 'Location', value: '/home/user/ComfyUI', editType: 'path' },
      ])
      expect(wrapper.find('.settings-v2-readonly-path').exists()).toBe(true)
      // BaseCopyButton renders a button; together with the open button there are two.
      expect(wrapper.findAll('.settings-v2-readonly-path button').length).toBe(2)
    })

    it('does not make a URL value clickable', () => {
      const wrapper = mountReadonly([
        { id: 'repo', label: 'Repository', value: 'https://github.com/comfyanonymous/ComfyUI' },
      ])
      expect(wrapper.find('button.settings-v2-field-readonly-open').exists()).toBe(false)
    })

    it('does not make a date value clickable', () => {
      const wrapper = mountReadonly([
        { id: 'updated', label: 'Last updated', value: '2024/01/02' },
      ])
      expect(wrapper.find('button.settings-v2-field-readonly-open').exists()).toBe(false)
    })
  })
})
