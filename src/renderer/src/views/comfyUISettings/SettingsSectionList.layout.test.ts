import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

import '../../assets/main.css'
import SettingsSectionList from './SettingsSectionList.vue'
import { SECTION_TITLE_CLASS } from '../../lib/sectionTitle'

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('SettingsSectionList layout', () => {
  it('draws a field note in the muted text colour with no blue icon, aligned with its label', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const reference = document.createElement('div')
    reference.className = 'text-text-muted'
    document.body.appendChild(reference)

    wrapper = mount(SettingsSectionList, {
      props: {
        sections: [
          {
            fields: [
              {
                id: 'hardwareAcceleration',
                label: 'Use hardware acceleration',
                value: true,
                editable: true,
                editType: 'boolean',
                description:
                  'Uses the GPU to render Comfy Desktop. Restart Comfy Desktop for changes to take effect.'
              }
            ]
          }
        ]
      },
      attachTo: document.body
    })

    const note = document.querySelector<HTMLElement>('.settings-v2-field-description')!
    expect(note.querySelector('svg')).toBeNull()
    expect(getComputedStyle(note).color).toBe(getComputedStyle(reference).color)
    const info = document.createElement('div')
    info.style.color = 'var(--info)'
    document.body.appendChild(info)
    expect(getComputedStyle(note).color).not.toBe(getComputedStyle(info).color)
    const label = document.querySelector<HTMLElement>(
      '.settings-v2-field label, .settings-v2-field span'
    )!
    expect(note.getBoundingClientRect().left).toBe(label.getBoundingClientRect().left)
  })

  it('writes the readonly collapsible toggle title in the shared section title style', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const reference = document.createElement('div')
    reference.className = SECTION_TITLE_CLASS
    reference.textContent = 'Reference'
    document.body.appendChild(reference)

    wrapper = mount(SettingsSectionList, {
      props: {
        readonly: true,
        sections: [
          { title: 'General', fields: [] },
          { title: 'Advanced', collapsed: false, fields: [] }
        ]
      },
      attachTo: document.body
    })

    const toggle = document.querySelector<HTMLElement>(
      'button.settings-v2-section-title.is-toggle'
    )!
    const plainTitle = document.querySelector<HTMLElement>('.settings-v2-section-title--readonly')!
    const want = getComputedStyle(reference)
    for (const title of [toggle, plainTitle]) {
      const got = getComputedStyle(title)
      for (const prop of [
        'fontSize',
        'fontWeight',
        'letterSpacing',
        'lineHeight',
        'textTransform',
        'color'
      ] as const) {
        expect(got[prop], `${title.className} ${prop}`).toBe(want[prop])
      }
    }
  })
})
