import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import BrandTakeoverLayout from './BrandTakeoverLayout.vue'
import BasePrompt from './ui/BasePrompt.vue'

const wrappers: VueWrapper[] = []

async function settle(): Promise<void> {
  await flushPromises()
  await vi.runAllTimersAsync()
  await flushPromises()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(async () => {
  while (wrappers.length) wrappers.pop()?.unmount()
  await settle()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('BrandTakeoverLayout shared dialog behavior', () => {
  it('focuses an opted-in first-use field and keeps binding flows open on Escape', async () => {
    const wrapper = mount(BrandTakeoverLayout, {
      props: { ariaLabel: 'Set up ComfyUI' },
      slots: { default: '<input id="setup-name" autofocus aria-label="Install name" />' },
      attachTo: document.body
    })
    wrappers.push(wrapper)
    await settle()
    const input = document.getElementById('setup-name')!
    expect(document.activeElement).toBe(input)
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
    await settle()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(document.querySelector('.brand-takeover-root')).not.toBeNull()
  })

  it('allows cancellable takeovers to opt into Escape dismissal', async () => {
    const wrapper = mount(BrandTakeoverLayout, {
      props: { ariaLabel: 'Track installation', dismissible: true },
      slots: { default: '<input id="track-name" autofocus aria-label="Install name" />' },
      attachTo: document.body
    })
    wrappers.push(wrapper)
    await settle()
    document
      .getElementById('track-name')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      )
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('focuses a prompt above a takeover and returns to the takeover when the prompt closes', async () => {
    const promptOpen = ref(false)
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(
            BrandTakeoverLayout,
            { ariaLabel: 'First use' },
            {
              default: () => [
                h(
                  'button',
                  { id: 'name-snapshot', onClick: () => (promptOpen.value = true) },
                  'Name'
                ),
                h(BasePrompt, {
                  open: promptOpen.value,
                  title: 'Name snapshot',
                  defaultValue: 'Snapshot',
                  'onUpdate:open': (open: boolean) => (promptOpen.value = open)
                })
              ]
            }
          )
      }),
      { attachTo: document.body }
    )
    wrappers.push(wrapper)
    await settle()
    const trigger = document.getElementById('name-snapshot')!
    trigger.focus()
    trigger.click()
    await settle()
    const promptInput = document.querySelector<HTMLInputElement>('.base-prompt-input')!
    expect(document.activeElement).toBe(promptInput)
    expect(promptInput.selectionStart).toBe(0)
    expect(promptInput.selectionEnd).toBe('Snapshot'.length)
    promptInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
    await settle()
    expect(promptOpen.value).toBe(false)
    expect(document.querySelector('.brand-takeover-root')).not.toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
