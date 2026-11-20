import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

import '../assets/main.css'
import SnapshotDisclosure from './SnapshotDisclosure.vue'
import { SECTION_TITLE_CLASS } from '../lib/sectionTitle'

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('SnapshotDisclosure layout', () => {
  it('writes its title in the shared section title style and keeps a 28px summary row', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const reference = document.createElement('div')
    reference.className = SECTION_TITLE_CLASS
    reference.textContent = 'Reference'
    document.body.appendChild(reference)

    wrapper = mount(SnapshotDisclosure, {
      props: { label: 'Custom nodes', open: false },
      attachTo: document.body
    })

    const summary = document.querySelector<HTMLElement>('.load-snapshot-disclosure__summary')!
    const title = summary.querySelector('span')!
    const got = getComputedStyle(title)
    const want = getComputedStyle(reference)
    for (const prop of [
      'fontSize',
      'fontWeight',
      'letterSpacing',
      'lineHeight',
      'textTransform',
      'color'
    ] as const) {
      expect(got[prop], prop).toBe(want[prop])
    }
    expect(got.textTransform).toBe('uppercase')
    expect(summary.getBoundingClientRect().height).toBe(28)
  })
})
