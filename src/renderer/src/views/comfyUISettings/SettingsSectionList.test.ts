import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import SettingsSectionList from './SettingsSectionList.vue'
import BooleanToggle from './BooleanToggle.vue'
import type { DetailField, DetailSection } from '../../types/ipc'

function mountList(fields: DetailField[]) {
  return mount(SettingsSectionList, {
    props: { sections: [{ fields }] }
  })
}

function mountReadonly(fields: DetailField[]) {
  return mount(SettingsSectionList, {
    props: { sections: [{ fields }], readonly: true }
  })
}

describe('SettingsSectionList', () => {
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
        props: { sections: [vsSection(enabled)] }
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

    it('disables the update button and makes its explanation focusable', () => {
      const section = vsSection(false)
      section.actions![0]!.disabledMessage = 'Finish the current update first.'
      const wrapper = mount(SettingsSectionList, {
        props: { sections: [section] }
      })
      expect(wrapper.find('.version-stat-action').attributes('disabled')).toBeDefined()
      const tooltip = wrapper.find('.version-stat-action-tooltip')
      expect(tooltip.attributes('tabindex')).toBe('0')
      expect(tooltip.attributes('title')).toBeUndefined()
    })
  })

  describe('turn-on-only disabled boolean rows', () => {
    function betaField(value: boolean, turnOnDisabled: boolean): DetailField {
      return {
        id: 'betaFeaturesEnabled',
        label: 'Opt-in to beta features',
        value,
        editable: true,
        editType: 'boolean',
        turnOnDisabled,
        turnOnDisabledTooltipKey: 'tooltips.betaFeaturesNeedTelemetry'
      }
    }

    it('forwards the directional-disable contract to the toggle', () => {
      const wrapper = mountList([betaField(false, true)])
      const toggle = wrapper.findComponent(BooleanToggle)
      expect(toggle.props('turnOnDisabled')).toBe(true)
      expect(toggle.props('turnOnDisabledTooltipKey')).toBe('tooltips.betaFeaturesNeedTelemetry')
    })

    it('blocks an off row and resolves the tooltip key against the catalog', async () => {
      const wrapper = mountList([betaField(false, true)])
      const button = wrapper.find('button[role="switch"]')
      expect(button.attributes('aria-disabled')).toBe('true')
      expect(button.attributes('title')).toBe(
        'Beta features require confirming data sharing in Settings, even if telemetry is currently on.'
      )
      expect(button.attributes('title')).not.toBe('tooltips.betaFeaturesNeedTelemetry')

      await button.trigger('click')
      expect(wrapper.emitted('update-field')).toBeFalsy()
      expect(button.attributes('aria-checked')).toBe('false')
    })

    it('keeps a blocked switch in the tab order', () => {
      const wrapper = mountList([betaField(false, true)])
      const button = wrapper.find('button[role="switch"]')
      expect(button.attributes('disabled')).toBeUndefined()
      expect(button.attributes('tabindex')).not.toBe('-1')
    })

    it('marks a blocked switch aria-disabled rather than disabled', async () => {
      const wrapper = mountList([betaField(false, true)])
      const button = wrapper.find('button[role="switch"]')
      expect(button.attributes('aria-disabled')).toBe('true')

      await button.trigger('click')
      expect(wrapper.emitted('update-field')).toBeFalsy()
      expect(button.attributes('aria-checked')).toBe('false')
    })

    it('points aria-describedby at the blocked explanation text', () => {
      const wrapper = mountList([betaField(false, true)])
      const button = wrapper.find('button[role="switch"]')
      const describedBy = button.attributes('aria-describedby')
      expect(describedBy).toBeTruthy()

      const description = wrapper.find(`#${describedBy}`)
      expect(description.exists()).toBe(true)
      expect(description.text()).toBe(
        'Beta features require confirming data sharing in Settings, even if telemetry is currently on.'
      )
    })

    it('keeps the blocked styling hook after dropping the disabled attribute', () => {
      const wrapper = mountList([betaField(false, true)])
      expect(wrapper.find('button[role="switch"][aria-disabled="true"]').exists()).toBe(true)
    })

    it('gives each blocked switch its own description id', () => {
      const wrapper = mountList([betaField(false, true), betaField(false, true)])
      const ids = wrapper
        .findAll('button[role="switch"]')
        .map((button) => button.attributes('aria-describedby'))

      expect(ids).toHaveLength(2)
      expect(ids[0]).toBeTruthy()
      expect(ids[0]).not.toBe(ids[1])
    })

    it('leaves an on row fully operable so turning it off always works', async () => {
      const wrapper = mountList([betaField(true, true)])
      const button = wrapper.find('button[role="switch"]')
      expect(button.attributes('disabled')).toBeUndefined()
      expect(button.attributes('aria-disabled')).toBe('false')
      expect(button.attributes('title')).toBeUndefined()

      await button.trigger('click')
      const emitted = wrapper.emitted('update-field')
      expect(emitted).toBeTruthy()
      expect(emitted![0]![1]).toBe(false)
    })

    it('leaves an off row operable when the directional disable is not set', async () => {
      const wrapper = mountList([betaField(false, false)])
      const button = wrapper.find('button[role="switch"]')
      expect(button.attributes('disabled')).toBeUndefined()
      await button.trigger('click')
      expect(wrapper.emitted('update-field')![0]![1]).toBe(true)
    })
  })

  describe('two-column layout', () => {
    const TWO_COLUMN_GRID = '@2xl/build-settings:grid'
    const launchField: DetailField = {
      id: 'launchArgs',
      label: 'Startup arguments',
      value: '--listen',
      editable: true,
      editType: 'text'
    }

    function mountSections(sections: DetailSection[], columns: boolean) {
      return mount(SettingsSectionList, { props: { sections, columns } })
    }

    it('shows a titled section as a heading beside its fields', () => {
      const wrapper = mountSections(
        [{ title: 'Launch Settings', description: 'How the build starts.', fields: [launchField] }],
        true
      )
      expect(wrapper.find('h3').text()).toBe('Launch Settings')
      expect(wrapper.find('.settings-v2-section').classes()).toContain(TWO_COLUMN_GRID)
      expect(wrapper.find('.settings-v2-section-body').classes()).toContain('max-w-xl')
      expect(wrapper.find('.settings-v2-section-body').text()).toContain('Startup arguments')
    })

    it('shows the section description once, under the heading', () => {
      const wrapper = mountSections(
        [{ title: 'Launch Settings', description: 'How the build starts.', fields: [launchField] }],
        true
      )
      const descriptions = wrapper.findAll('.settings-v2-section-desc')
      expect(descriptions).toHaveLength(1)
      expect(descriptions[0]!.element.closest('header')).not.toBeNull()
    })

    it('leaves the layout unchanged when columns is off', () => {
      const wrapper = mountSections(
        [{ title: 'Launch Settings', description: 'How the build starts.', fields: [launchField] }],
        false
      )
      expect(wrapper.find('h3').exists()).toBe(false)
      expect(wrapper.find('.settings-v2-section').classes()).not.toContain(TWO_COLUMN_GRID)
      expect(wrapper.find('.settings-v2-section-body').classes()).toContain('contents')
      expect(wrapper.find('.settings-v2-section-desc').text()).toBe('How the build starts.')
    })

    it('keeps an untitled section stacked so its rows do not split across columns', () => {
      const wrapper = mountSections([{ fields: [launchField, { ...launchField, id: 'b' }] }], true)
      expect(wrapper.find('.settings-v2-section').classes()).not.toContain(TWO_COLUMN_GRID)
      expect(wrapper.find('.settings-v2-section-body').classes()).toContain('contents')
    })

    it('keeps a collapsible section stacked with its toggle and description', () => {
      const wrapper = mountSections(
        [
          {
            title: 'Advanced',
            description: 'Rarely needed flags.',
            collapsed: false,
            fields: [launchField]
          }
        ],
        true
      )
      expect(wrapper.find('h3').exists()).toBe(false)
      expect(wrapper.find('.settings-v2-section').classes()).not.toContain(TWO_COLUMN_GRID)
      expect(wrapper.find('button[aria-expanded]').text()).toContain('Advanced')
      expect(wrapper.find('.settings-v2-section-desc').text()).toBe('Rarely needed flags.')
    })
  })
})
