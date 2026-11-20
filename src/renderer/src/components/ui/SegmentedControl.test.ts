import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'

import '../../assets/main.css'
import SegmentedControl from './SegmentedControl.vue'

type Tab = 'all' | 'local' | 'cloud'

const OPTIONS: { value: Tab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'local', label: 'This computer' },
  { value: 'cloud', label: 'Cloud' }
]

const wrappers: VueWrapper[] = []

function mountTabs(modelValue: Tab = 'all') {
  const wrapper = mount(SegmentedControl<Tab>, {
    props: {
      modelValue,
      options: OPTIONS,
      label: 'Builds',
      'onUpdate:modelValue': (next: Tab) => wrapper.setProps({ modelValue: next })
    },
    attachTo: document.body
  })
  wrappers.push(wrapper)
  return wrapper
}

function pillOf(wrapper: VueWrapper): HTMLElement {
  return wrapper.get<HTMLElement>('[data-testid="sliding-pill"]').element
}

function tabNamed(wrapper: VueWrapper, label: string): HTMLElement {
  const tab = wrapper.findAll<HTMLElement>('button').find((t) => t.text() === label)
  if (!tab) throw new Error(`no tab named ${label}`)
  return tab.element
}

function expectPillCovers(pill: HTMLElement, tab: HTMLElement) {
  expect(pill.hidden).toBe(false)
  expect(pill.style.width).toBe(`${tab.offsetWidth}px`)
  expect(pill.style.height).toBe(`${tab.offsetHeight}px`)
  expect(pill.style.transform).toBe(`translate(${tab.offsetLeft}px, ${tab.offsetTop}px)`)
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function settle() {
  await flushPromises()
  await nextTick()
  await document.fonts.ready
  await nextFrame()
  await nextFrame()
}

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
})

describe('SegmentedControl sliding pill', () => {
  it('puts one pill under the picked tab when it mounts', async () => {
    const wrapper = mountTabs('local')
    await settle()

    expect(wrapper.findAll('[data-testid="sliding-pill"]')).toHaveLength(1)
    expectPillCovers(pillOf(wrapper), tabNamed(wrapper, 'This computer'))
  })

  it('moves the same pill to the tab the user picks', async () => {
    const wrapper = mountTabs('all')
    await settle()
    const pill = pillOf(wrapper)

    tabNamed(wrapper, 'Cloud').click()
    await settle()

    expect(pillOf(wrapper)).toBe(pill)
    expectPillCovers(pill, tabNamed(wrapper, 'Cloud'))
  })

  it('slides the pill with transform and width only', async () => {
    const wrapper = mountTabs('all')
    await settle()
    tabNamed(wrapper, 'Cloud').click()
    await settle()

    const { transitionProperty } = getComputedStyle(pillOf(wrapper))
    expect(transitionProperty.split(',').map((p) => p.trim())).toEqual(['transform', 'width'])
  })

  it('lets the pill show the picked colour instead of the tab itself', async () => {
    const wrapper = mountTabs('local')
    await settle()

    expect(getComputedStyle(tabNamed(wrapper, 'This computer')).backgroundColor).toBe(
      'rgba(0, 0, 0, 0)'
    )
    expect(getComputedStyle(pillOf(wrapper)).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })

  it('removes the pill when the tabs unmount', async () => {
    const wrapper = mountTabs('all')
    await settle()
    const pill = pillOf(wrapper)

    wrappers.pop()?.unmount()

    expect(pill.isConnected).toBe(false)
  })
})
