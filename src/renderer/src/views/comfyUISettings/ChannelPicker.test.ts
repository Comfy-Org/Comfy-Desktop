import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

import { en } from '../../lib/i18nMessages.ts'
import ChannelPicker from './ChannelPicker.vue'
import type { DetailField } from '../../types/ipc'

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

function mountPicker(field: DetailField) {
  return mount(ChannelPicker, {
    props: { field },
    global: {
      plugins: [makeI18n()],
      stubs: {
        // Teleports its listbox to <body>; the headline under test doesn't need it.
        BaseSelect: true,
        InfoTooltip: true
      }
    }
  })
}

function field(options: DetailField['options'], value = 'stable'): DetailField {
  return {
    id: 'updateChannel',
    label: 'Update channel',
    value,
    editable: true,
    editType: 'channel-cards',
    options
  } as DetailField
}

describe('ChannelPicker — headline product + version', () => {
  it('shows the product name and the target version when an update is available', () => {
    const wrapper = mountPicker(
      field([
        {
          value: 'stable',
          label: 'Stable',
          data: {
            productName: 'ComfyUI',
            installedVersion: 'v0.3.75',
            latestVersion: 'v0.28.3',
            updateAvailable: true
          }
        }
      ])
    )
    expect(wrapper.find('.channel-picker-headline-product').text()).toBe('ComfyUI')
    const version = wrapper.find('.channel-picker-headline-version')
    expect(version.text()).toBe('v0.28.3')
    expect(version.classes()).toContain('is-update-available')
  })

  it('preserves the torch local tag (+cu130) in the PyTorch headline', () => {
    const wrapper = mountPicker(
      field(
        [
          {
            value: 'stack-cu130',
            label: 'PyTorch 2.10.0+cu130',
            data: {
              productName: 'PyTorch',
              installedVersion: '2.9.0+cu130',
              latestVersion: '2.10.0+cu130',
              updateAvailable: true
            }
          }
        ],
        'stack-cu130'
      )
    )
    expect(wrapper.find('.channel-picker-headline-product').text()).toBe('PyTorch')
    const version = wrapper.find('.channel-picker-headline-version')
    expect(version.text()).toBe('v2.10.0+cu130')
    expect(version.classes()).toContain('is-update-available')
  })

  it('shows the installed version without update emphasis when up to date', () => {
    const wrapper = mountPicker(
      field([
        {
          value: 'stable',
          label: 'Stable',
          data: {
            productName: 'PyTorch',
            installedVersion: '2.9.0+cu130',
            updateAvailable: false
          }
        }
      ])
    )
    expect(wrapper.find('.channel-picker-headline-product').text()).toBe('PyTorch')
    const version = wrapper.find('.channel-picker-headline-version')
    expect(version.text()).toBe('v2.9.0+cu130')
    expect(version.classes()).not.toContain('is-update-available')
  })

  it('renders no product span when the card data carries no productName', () => {
    const wrapper = mountPicker(
      field([
        {
          value: 'stable',
          label: 'Stable',
          data: {
            installedVersion: 'v0.3.75',
            latestVersion: 'v0.3.75',
            updateAvailable: false
          }
        }
      ])
    )
    expect(wrapper.find('.channel-picker-headline-product').exists()).toBe(false)
    expect(wrapper.find('.channel-picker-headline-version').text()).toBe('v0.3.75')
  })
})
