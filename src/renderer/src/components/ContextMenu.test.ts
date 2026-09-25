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

    info.parentElement?.dispatchEvent(new Event('mouseenter'))
    await vi.advanceTimersByTimeAsync(100)
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
})
