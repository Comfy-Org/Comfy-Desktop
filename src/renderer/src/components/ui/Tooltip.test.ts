import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import Tooltip from './Tooltip.vue'

const wrappers: VueWrapper[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  vi.useRealTimers()
})
function mountTooltip(props: Record<string, unknown> = {}, content?: string) {
  const wrapper = mount(Tooltip, {
    props: { text: 'Hello tooltip', delayMs: 0, ...props },
    slots: {
      default: '<button data-testid="trigger">trigger</button>',
      ...(content ? { content } : {})
    },
    attachTo: document.body
  })
  wrappers.push(wrapper)
  return wrapper
}
async function hover(wrapper: VueWrapper) {
  wrapper
    .get('.tooltip-wrap')
    .element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', buttons: 0 }))
  await vi.advanceTimersByTimeAsync(1)
  await flushPromises()
}

describe('Tooltip shared adapter', () => {
  it('opens on hover outside the trigger tree with its text', async () => {
    const wrapper = mountTooltip()
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
    await hover(wrapper)
    const bubble = document.querySelector('.tooltip-bubble')!
    expect(bubble.textContent).toContain('Hello tooltip')
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1)
    expect(wrapper.element.contains(bubble)).toBe(false)
  })

  it('closes a noninteractive tooltip on pointer leave', async () => {
    const wrapper = mountTooltip()
    await hover(wrapper)
    await wrapper.get('.tooltip-wrap').trigger('pointerleave', { pointerType: 'mouse' })
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
  })

  it('closes a noninteractive tooltip when its trigger is clicked', async () => {
    const wrapper = mountTooltip()
    await hover(wrapper)
    await wrapper.get('.tooltip-wrap').trigger('click')
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
  })

  it('stays open when clicked if asked to, for triggers that only explain something', async () => {
    const wrapper = mountTooltip({ keepOpenOnClick: true })
    await hover(wrapper)
    await wrapper.get('.tooltip-wrap').trigger('pointerdown')
    await wrapper.get('.tooltip-wrap').trigger('click')
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).not.toBeNull()
  })

  it('lets the pointer travel from the trigger onto linked content, then closes once it leaves', async () => {
    const wrapper = mountTooltip(
      { interactive: true },
      '<a href="https://example.com">Read more</a>'
    )
    await hover(wrapper)
    const trigger = wrapper.get('.tooltip-wrap').element
    trigger.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse', clientX: 5 }))
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).not.toBeNull()
    document.body.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerType: 'mouse',
        bubbles: true,
        clientX: 900,
        clientY: 900
      })
    )
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
  })

  it('names a linked tooltip by its text', async () => {
    const wrapper = mountTooltip(
      { interactive: true, text: 'Why this matters' },
      '<a href="https://example.com">Read more</a>'
    )
    await hover(wrapper)
    const labelId = document.querySelector('.tooltip-bubble')!.getAttribute('aria-labelledby')!
    expect(document.getElementById(labelId)?.textContent).toBe('Why this matters')
  })

  it('asks shouldOpen when opening and stays closed if it says no', async () => {
    const shouldOpen = vi.fn(() => false)
    const wrapper = mountTooltip({ shouldOpen, delayMs: 100 })
    await hover(wrapper)
    expect(shouldOpen).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()
    expect(shouldOpen).toHaveBeenCalled()
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
  })

  it('keeps linked content interactive and focusable', async () => {
    const wrapper = mountTooltip(
      { interactive: true },
      '<a href="https://example.com">Read more</a>'
    )
    await hover(wrapper)
    const bubble = document.querySelector<HTMLElement>('.tooltip-bubble')!
    expect(bubble.classList).toContain('pointer-events-auto')
    expect(bubble.getAttribute('role')).toBe('dialog')
    const link = bubble.querySelector('a')!
    link.focus()
    await flushPromises()
    expect(document.activeElement).toBe(link)
    expect(document.querySelector('.tooltip-bubble')).not.toBeNull()
  })

  it('keeps a help link open when focus moves from its focusable wrapper, then closes on exit', async () => {
    const wrapper = mountTooltip(
      { interactive: true, tabindex: 0 },
      '<a href="https://example.com">Read more</a>'
    )
    ;(wrapper.get('.tooltip-wrap').element as HTMLElement).focus()
    await flushPromises()
    const link = document.querySelector<HTMLAnchorElement>('.tooltip-bubble a')!
    link.focus()
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).not.toBeNull()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    try {
      outside.focus()
      await flushPromises()
      expect(document.querySelector('.tooltip-bubble')).toBeNull()
    } finally {
      outside.remove()
    }
  })

  it.each([
    { focus: 'the trigger', target: () => document.querySelector('[data-testid="trigger"]')! },
    { focus: 'the bubble', target: () => document.querySelector('.tooltip-bubble a')! }
  ])('closes on Escape from $focus without closing the host', async ({ target }) => {
    const wrapper = mountTooltip(
      { interactive: true },
      '<a href="https://example.com">Read more</a>'
    )
    wrapper.get('button').element.focus()
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).not.toBeNull()
    const hostListener = vi.fn()
    window.addEventListener('keydown', hostListener)
    document.addEventListener('keydown', hostListener)
    try {
      target().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flushPromises()
      expect(hostListener).not.toHaveBeenCalled()
      expect(document.querySelector('.tooltip-bubble')).toBeNull()
    } finally {
      window.removeEventListener('keydown', hostListener)
      document.removeEventListener('keydown', hostListener)
    }
  })

  it('lets Escape reach the host when the tooltip is closed', async () => {
    const wrapper = mountTooltip()
    const hostListener = vi.fn()
    window.addEventListener('keydown', hostListener)
    try {
      wrapper
        .get('button')
        .element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(hostListener).toHaveBeenCalledOnce()
    } finally {
      window.removeEventListener('keydown', hostListener)
    }
  })

  it('hides when disabled and cannot open without text or content', async () => {
    const wrapper = mountTooltip()
    await hover(wrapper)
    await wrapper.setProps({ disabled: true })
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
    await hover(wrapper)
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
    await wrapper.setProps({ disabled: false, text: '' })
    await hover(wrapper)
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
  })

  it('cancels a pending open when disabled during the delay', async () => {
    vi.useFakeTimers()
    const wrapper = mountTooltip({ delayMs: 100 })
    await hover(wrapper)
    await wrapper.setProps({ disabled: true })
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
  })

  it('closes when focus leaves the Electron window', async () => {
    const wrapper = mountTooltip()
    await hover(wrapper)
    window.dispatchEvent(new Event('blur'))
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
  })
})
