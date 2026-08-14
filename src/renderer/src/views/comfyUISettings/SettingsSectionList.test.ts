import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import { en } from '../../lib/i18nMessages.ts'
import SettingsSectionList from './SettingsSectionList.vue'
import type { DetailField, DetailSection } from '../../types/ipc'

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

function mountList(fields: DetailField[]) {
  return mount(SettingsSectionList, {
    props: { sections: [{ fields }] },
    global: { plugins: [makeI18n()] }
  })
}

function mountReadonly(fields: DetailField[]) {
  return mount(SettingsSectionList, {
    props: { sections: [{ fields }], readonly: true },
    global: { plugins: [makeI18n()] }
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
          description: 'Git repositories clone from gitcode.com instead of github.com.'
        }
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
          editType: 'boolean'
        }
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
          description: 'Overrides the default index when set.'
        }
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
          tooltip: 'Git repositories clone from gitcode.com instead of github.com.'
        }
      ])
      const trigger = wrapper.find('.info-tooltip-trigger')
      expect(trigger.exists()).toBe(true)
      expect(trigger.attributes('aria-label')).toContain('gitcode.com')
    })
  })

  // Fields sharing a rowGroup render side-by-side inside one paired row;
  // everything else keeps its own full-width (layout-transparent) row.
  describe('rowGroup pairing', () => {
    const select = (id: string, rowGroup?: string): DetailField => ({
      id,
      label: id,
      value: 'a',
      editable: true,
      editType: 'select',
      options: [{ value: 'a', label: 'A' }],
      ...(rowGroup ? { rowGroup } : {})
    })

    it('wraps consecutive same-rowGroup fields in one paired row', () => {
      const wrapper = mountList([
        select('managerSecurityLevel', 'manager'),
        select('managerNetworkMode', 'manager'),
        select('launchMode')
      ])
      const rows = wrapper.findAll('.settings-v2-field-row')
      expect(rows.length).toBe(2)
      const paired = rows[0]!
      expect(paired.classes()).toContain('is-paired')
      expect(paired.findAll('.settings-v2-field').length).toBe(2)
      expect(rows[1]!.classes()).not.toContain('is-paired')
      expect(rows[1]!.findAll('.settings-v2-field').length).toBe(1)
    })

    it('does not pair non-adjacent fields even when they share a rowGroup', () => {
      const wrapper = mountList([select('first', 'g'), select('between'), select('second', 'g')])
      expect(wrapper.findAll('.settings-v2-field-row.is-paired').length).toBe(0)
      expect(wrapper.findAll('.settings-v2-field-row').length).toBe(3)
    })

    it('renders every field in its own row when no rowGroup is set', () => {
      const wrapper = mountList([select('one'), select('two')])
      const rows = wrapper.findAll('.settings-v2-field-row')
      expect(rows.length).toBe(2)
      for (const row of rows) expect(row.classes()).not.toContain('is-paired')
    })
  })

  // Readonly path values render as a clickable open-folder button, keeping the
  // copy button, and only fire `open-path` for real filesystem paths.
  describe('readonly path rows', () => {
    it('renders a clickable button that emits open-path for a path value', async () => {
      const wrapper = mountReadonly([
        { id: 'location', label: 'Location', value: '/home/user/ComfyUI', editType: 'path' }
      ])
      const btn = wrapper.find('button.settings-v2-field-readonly-open')
      expect(btn.exists()).toBe(true)
      expect(btn.text()).toBe('/home/user/ComfyUI')
      await btn.trigger('click')
      expect(wrapper.emitted('open-path')?.[0]).toEqual(['/home/user/ComfyUI'])
    })

    it('keeps the copy button alongside the path', () => {
      const wrapper = mountReadonly([
        { id: 'location', label: 'Location', value: '/home/user/ComfyUI', editType: 'path' }
      ])
      expect(wrapper.find('.settings-v2-readonly-path').exists()).toBe(true)
      // BaseCopyButton renders a button; together with the open button there are two.
      expect(wrapper.findAll('.settings-v2-readonly-path button').length).toBe(2)
    })

    it('does not make a URL value clickable', () => {
      const wrapper = mountReadonly([
        { id: 'repo', label: 'Repository', value: 'https://github.com/comfyanonymous/ComfyUI' }
      ])
      expect(wrapper.find('button.settings-v2-field-readonly-open').exists()).toBe(false)
    })

    it('does not make a date value clickable', () => {
      const wrapper = mountReadonly([{ id: 'updated', label: 'Last updated', value: '2024/01/02' }])
      expect(wrapper.find('button.settings-v2-field-readonly-open').exists()).toBe(false)
    })
  })

  // The Update tab's version table renders the section's actions itself, so the
  // generic footer must stand down (or the button appears twice), and the button
  // is the only place the update action can be fired.
  describe('version-stats section', () => {
    const vsSection = (enabled: boolean): DetailSection => ({
      fields: [
        {
          id: 'vs',
          label: 'Distribution version',
          editType: 'version-stats',
          editable: false,
          value: { headline: 'v1', rows: [{ id: 'installed', label: 'Installed', value: 'v1' }] }
        }
      ],
      actions: [{ id: 'update-distribution', label: 'Update', enabled }]
    })

    function mountSection(enabled: boolean) {
      return mount(SettingsSectionList, {
        props: { sections: [vsSection(enabled)] },
        global: { plugins: [makeI18n()] }
      })
    }

    it('docks the action inside the panel and suppresses the generic footer', () => {
      const wrapper = mountSection(true)
      expect(wrapper.findAll('.version-stat-action')).toHaveLength(1)
      expect(wrapper.find('.settings-v2-actions').exists()).toBe(false)
    })

    it('emits run-action from an enabled update button', async () => {
      const wrapper = mountSection(true)
      await wrapper.find('.version-stat-action').trigger('click')
      expect(wrapper.emitted('run-action')).toBeTruthy()
    })

    it('disables the update button when the action is not ready', () => {
      const wrapper = mountSection(false)
      expect(wrapper.find('.version-stat-action').attributes('disabled')).toBeDefined()
    })
  })
})
