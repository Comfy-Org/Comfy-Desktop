import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TruncatedText from './TruncatedText.vue'

const wrappers: VueWrapper[] = []
function mountText(): VueWrapper {
  const wrapper = mount(TruncatedText, {
    props: { text: 'A very long model name' },
    attachTo: document.body
  })
  wrappers.push(wrapper)
  return wrapper
}
function setWidths(wrapper: VueWrapper, scrollWidth: number, clientWidth: number): void {
  const label = wrapper.get('.truncated-text').element
  Object.defineProperty(label, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(label, 'clientWidth', { value: clientWidth, configurable: true })
}
async function pointerArrives(wrapper: VueWrapper): Promise<void> {
  wrapper
    .get('.tooltip-wrap')
    .element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', buttons: 0 }))
  await vi.advanceTimersByTimeAsync(100)
  await flushPromises()
}

describe('TruncatedText', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    while (wrappers.length) wrappers.pop()?.unmount()
    vi.useRealTimers()
  })

  it('renders the text', () => {
    expect(mountText().text()).toContain('A very long model name')
  })

  it('shows no tooltip when the text fits', async () => {
    const wrapper = mountText()
    setWidths(wrapper, 100, 100)
    await pointerArrives(wrapper)
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
  })

  it('shows the full text the first time the pointer arrives on clipped text', async () => {
    const wrapper = mountText()
    setWidths(wrapper, 200, 100)
    await pointerArrives(wrapper)
    expect(document.querySelector('.tooltip-bubble')?.textContent).toContain(
      'A very long model name'
    )
  })
})
