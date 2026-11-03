import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import ContextMenu from './ContextMenu.vue'
import { TID } from '../../../shared/testIds'

let wrapper: VueWrapper | undefined
const originalApi = Object.getOwnPropertyDescriptor(window, 'api')

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
  if (originalApi) Object.defineProperty(window, 'api', originalApi)
  else delete (window as unknown as { api?: unknown }).api
})

describe('ContextMenu', () => {
  it('shows a linked explanation from an info icon beside an enabled action', async () => {
    vi.useFakeTimers()
    wrapper = mount(ContextMenu, {
      props: {
        open: true,
        x: 0,
        y: 0,
        items: [
          {
            id: 'promote-to-workspace',
            label: 'Create Build',
            hint: 'Create a Build from this instance in Comfy Developer Platform.',
            hintUrl: 'https://platform.comfy.org/profile/deploy',
            hintLinkLabel: 'Read more'
          }
        ]
      }
    })

    await flushPromises()
    await vi.advanceTimersByTimeAsync(1)
    const item = document.body.querySelector(
      `[data-testid="${TID.contextMenuItem('promote-to-workspace')}"]`
    )
    expect(item?.textContent?.trim()).toBe('Create Build')
    const row = item?.parentElement
    const info = row?.querySelector('.info-tooltip-trigger') as HTMLElement
    expect(row?.classList.contains('context-menu-item')).toBe(true)
    expect(row?.contains(item)).toBe(true)
    expect(row?.contains(info)).toBe(true)
    expect(info.dataset.icon).toBe('info')
    expect(info.getAttribute('tabindex')).toBe('0')
    expect(document.querySelector('.tooltip-bubble')).toBeNull()

    info.parentElement!.dispatchEvent(
      new PointerEvent('pointerenter', { pointerType: 'mouse', buttons: 0 })
    )
    await vi.advanceTimersByTimeAsync(101)
    await flushPromises()

    const bubble = document.querySelector('.tooltip-bubble')
    expect(bubble?.textContent).toContain(
      'Create a Build from this instance in Comfy Developer Platform.'
    )
    const link = bubble?.querySelector('.info-tooltip-link') as HTMLAnchorElement
    expect(link.textContent?.trim()).toBe('Read more')
    expect(link.href).toBe('https://platform.comfy.org/profile/deploy')
    expect(item?.getAttribute('title')).toBeNull()

    const openExternal = vi.fn()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { openExternal }
    })
    link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(openExternal).toHaveBeenCalledWith('https://platform.comfy.org/profile/deploy')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('keeps a disabled action with a help link inert', async () => {
    wrapper = mount(ContextMenu, {
      props: {
        open: true,
        x: 40,
        y: 40,
        items: [
          { id: 'disabled', label: 'Unavailable', disabled: true, hint: 'Why it is unavailable' }
        ]
      },
      attachTo: document.body
    })
    await flushPromises()
    const item = document.querySelector<HTMLElement>('[role="menuitem"]')!
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('select')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(item.getAttribute('aria-disabled')).toBe('true')
  })

  it('emits the action id and closes after keyboard selection', async () => {
    wrapper = mount(ContextMenu, {
      props: { open: true, x: 40, y: 40, items: [{ id: 'manage', label: 'Manage' }] },
      attachTo: document.body
    })
    await flushPromises()
    document
      .querySelector<HTMLElement>('[role="menuitem"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('select')).toEqual([['manage']])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('closes on window focus loss and contains Escape inside the menu', async () => {
    wrapper = mount(ContextMenu, {
      props: { open: true, x: 40, y: 40, items: [{ id: 'manage', label: 'Manage' }] },
      attachTo: document.body
    })
    await flushPromises()
    const listener = vi.fn()
    window.addEventListener('keydown', listener)
    try {
      document
        .querySelector('.context-menu')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(listener).not.toHaveBeenCalled()
      expect(wrapper.emitted('close')).toHaveLength(1)
      window.dispatchEvent(new Event('blur'))
      expect(wrapper.emitted('close')).toHaveLength(2)
    } finally {
      window.removeEventListener('keydown', listener)
    }
  })
})
