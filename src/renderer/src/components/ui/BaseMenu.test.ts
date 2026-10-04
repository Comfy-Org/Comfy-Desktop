import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import BaseMenu, { type BaseMenuItem } from './BaseMenu.vue'

const wrappers: VueWrapper[] = []

async function openMenu(props: {
  items: BaseMenuItem[]
  heading?: string
  listClass?: string
}): Promise<VueWrapper> {
  const wrapper = mount(BaseMenu, { props, slots: { default: 'Open' }, attachTo: document.body })
  wrappers.push(wrapper)
  await wrapper.get('button').trigger('click')
  await flushPromises()
  return wrapper
}

const list = (): HTMLElement => document.body.querySelector<HTMLElement>('.ui-menu-list')!

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
})

describe('BaseMenu', () => {
  it('shows a heading above the items, outside the menu items', async () => {
    await openMenu({ items: [{ id: 'a', label: 'A' }], heading: 'Pick one' })
    const heading = list().querySelector('.ui-menu-heading')
    expect(heading?.textContent).toBe('Pick one')
    expect(heading?.getAttribute('role')).toBe('presentation')
    expect(list().querySelectorAll('[role="menuitem"]')).toHaveLength(1)
  })

  it("renders an item's detail beside its label", async () => {
    await openMenu({ items: [{ id: 'a', label: '--enable-assets', detail: 'Asset library' }] })
    expect(list().querySelector('.ui-menu-item-label')?.textContent).toBe('--enable-assets')
    expect(list().querySelector('.ui-menu-item-detail')?.textContent).toBe('Asset library')
  })

  it('puts the list class on the teleported list', async () => {
    await openMenu({ items: [{ id: 'a', label: 'A' }], listClass: 'my-menu' })
    expect(list().classList).toContain('my-menu')
  })

  it('keeps Escape from reaching a window listener, so a host popup stays open', async () => {
    let reachedWindow = false
    const onWindow = (): void => {
      reachedWindow = true
    }
    window.addEventListener('keydown', onWindow)
    try {
      await openMenu({ items: [{ id: 'a', label: 'A' }] })
      list().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flushPromises()
      expect(document.body.querySelector('.ui-menu-list')).toBeNull()
      expect(reachedWindow).toBe(false)
    } finally {
      window.removeEventListener('keydown', onWindow)
    }
  })

  it('starts on the first enabled item, past disabled ones', async () => {
    await openMenu({
      items: [
        { id: 'a', label: 'A', disabled: true },
        { id: 'b', label: 'B', disabled: true },
        { id: 'manage', label: 'Manage' }
      ]
    })
    expect(list().querySelector('[data-active]')?.textContent).toBe('Manage')
  })
})
