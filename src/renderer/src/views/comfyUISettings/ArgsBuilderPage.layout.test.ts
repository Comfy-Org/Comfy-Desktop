import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import '../../assets/main.css'
import ArgsBuilderPage from './ArgsBuilderPage.vue'
import type { ComfyArgDef } from '../../types/ipc'

const SCHEMA: ComfyArgDef[] = ['cpu', 'gpu-only', 'lowvram'].map((name) => ({
  name,
  flag: `--${name}`,
  help: `${name} help.`,
  type: 'boolean' as const,
  exclusiveGroup: 'group_0',
  category: 'gpuVram'
}))

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('ArgsBuilderPage layout', () => {
  it('starts the exclusive group title text on the same edge as its section title and dropdown', async () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    ;(window as unknown as { api: unknown }).api = {
      getComfyArgs: vi.fn().mockResolvedValue({ args: SCHEMA })
    }
    wrapper = mount(ArgsBuilderPage, {
      props: { installationId: 'inst-1', initialValue: '', pendingRestart: false },
      attachTo: document.body
    })
    await flushPromises()

    const left = (selector: string): number => {
      const text = [...document.querySelector(selector)!.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim()
      )!
      const range = document.createRange()
      range.selectNodeContents(text)
      return range.getBoundingClientRect().left
    }
    const sectionTitle = left('.args-page-category-title')
    const clusterTitle = left('.args-page-cluster-label')
    const dropdown = document
      .querySelector('.args-page-cluster [role="combobox"]')!
      .getBoundingClientRect().left

    expect(Math.abs(clusterTitle - sectionTitle)).toBeLessThanOrEqual(1)
    expect(Math.abs(clusterTitle - dropdown)).toBeLessThanOrEqual(1)
  })
})
