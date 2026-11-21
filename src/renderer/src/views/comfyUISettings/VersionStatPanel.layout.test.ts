import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { userEvent } from 'vitest/browser'

import '../../assets/main.css'
import VersionStatPanel from './VersionStatPanel.vue'

const wrappers: VueWrapper[] = []

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  document.body.innerHTML = ''
})

function mountPanel(enabled: boolean): HTMLButtonElement {
  const wrapper = mount(VersionStatPanel, {
    attachTo: document.body,
    props: {
      headline: 'v0.3.40',
      actions: [{ id: 'update-comfyui', label: 'Update', style: 'primary', enabled }]
    }
  })
  wrappers.push(wrapper)
  return document.querySelector<HTMLButtonElement>('.version-stat-action')!
}

function background(el: Element): string {
  return getComputedStyle(el).backgroundColor
}

describe('VersionStatPanel primary action', () => {
  it('keeps a disabled primary action white on hover', async () => {
    const button = mountPanel(false)
    expect(button.disabled).toBe(true)
    const resting = background(button)

    await userEvent.hover(button)

    expect(background(button)).toBe(resting)
  })

  it('dims an enabled primary action on hover', async () => {
    const button = mountPanel(true)
    const resting = background(button)

    await userEvent.hover(button)

    expect(background(button)).not.toBe(resting)
  })
})

describe('VersionStatPanel secondary action', () => {
  it('keeps a disabled secondary action on its surface on hover', async () => {
    const wrapper = mount(VersionStatPanel, {
      attachTo: document.body,
      props: {
        headline: 'v0.3.40',
        actions: [{ id: 'switch-channel', label: 'Switch', enabled: false }]
      }
    })
    wrappers.push(wrapper)
    const button = document.querySelector<HTMLButtonElement>('.version-stat-action')!
    const resting = background(button)

    await userEvent.hover(button)

    expect(background(button)).toBe(resting)
  })
})
