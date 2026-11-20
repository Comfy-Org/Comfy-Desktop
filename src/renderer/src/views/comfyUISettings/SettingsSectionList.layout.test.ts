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
