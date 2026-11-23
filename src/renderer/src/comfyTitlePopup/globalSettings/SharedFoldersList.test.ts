import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import '../../assets/main.css'
import SharedFoldersList, { type SharedFolderRow } from './SharedFoldersList.vue'

const REVEAL_ICON = 'svg[class*="lucide-folder-search"]'
const MODELS: SharedFolderRow = {
  key: 'models-0',
  kind: 'models',
  path: '/shared/models',
  isDownloads: true
}
const EXTRA: SharedFolderRow = {
  key: 'models-1',
  kind: 'models',
  path: '/mnt/extra/models',
  removable: true
}
const mounted: VueWrapper[] = []

function mountList(rows: SharedFolderRow[] = [MODELS, EXTRA]) {
  const wrapper = mount(SharedFoldersList, { props: { rows }, attachTo: document.body })
  mounted.push(wrapper)
  return wrapper
}

function menuItems() {
  return [...document.querySelectorAll<HTMLElement>('.shared-folder-menu [role="menuitem"]')].map(
    (el) => new DOMWrapper(el)
  )
}

async function openMenu(row: DOMWrapper<Element>): Promise<void> {
  await row.get('.shared-folder-more').trigger('click')
  await nextTick()
  await flushPromises()
}

beforeEach(() => {
  ;(window as unknown as { api: Record<string, unknown> }).api = { platform: 'darwin' }
})

afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
})

describe('SharedFoldersList', () => {
  it('shows each path as plain text with its full path as the title', () => {
    const wrapper = mountList()
    const path = wrapper.findAll('.shared-folder-row')[1]!.get('.shared-folder-path')
    expect(path.element.tagName).toBe('SPAN')
    expect(path.element.closest('button')).toBeNull()
    expect(path.text()).toBe('/mnt/extra/models')
    expect(path.attributes('title')).toBe('/mnt/extra/models')
  })

  it('does not open the folder when the path text is clicked', async () => {
    const wrapper = mountList()
    await wrapper.get('.shared-folder-path').trigger('click')
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('opens the folder from the reveal button', async () => {
    const wrapper = mountList()
    const reveal = wrapper.findAll('.shared-folder-row')[1]!.get('.reveal-folder-button')
    expect(reveal.find(REVEAL_ICON).exists()).toBe(true)
    expect(reveal.attributes('title')).toBe('Show in Finder')
    await reveal.trigger('click')
    expect(wrapper.emitted('open')).toEqual([[EXTRA]])
    expect(wrapper.emitted('browse')).toBeUndefined()
  })

  it('shows the reveal icon only on reveal buttons', () => {
    const wrapper = mountList()
    const icons = wrapper.findAll(REVEAL_ICON)
    expect(icons).toHaveLength(2)
    for (const icon of icons) {
      expect(icon.element.closest('.reveal-folder-button')).not.toBeNull()
    }
  })

  it('chooses a new folder from Change folder in the row menu, even when the row cannot be removed', async () => {
    const wrapper = mountList()
    const row = wrapper.findAll('.shared-folder-row')[0]!
    await openMenu(row)
    expect(menuItems().map((item) => item.text())).toEqual(['Change folder'])
    await menuItems()[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('browse')).toEqual([[MODELS]])
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('offers Change folder and Remove for a removable row', async () => {
    const wrapper = mountList()
    await openMenu(wrapper.findAll('.shared-folder-row')[1]!)
    expect(menuItems().map((item) => item.text())).toEqual(['Change folder', 'Remove'])
    await menuItems()[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('remove')).toEqual([[EXTRA]])
    expect(wrapper.emitted('browse')).toBeUndefined()
  })

  it('keeps the reveal and more buttons inside the row', () => {
    const wrapper = mountList()
    for (const row of wrapper.findAll<HTMLElement>('.shared-folder-row')) {
      const box = row.element.getBoundingClientRect()
      const actions = row.get('.shared-folder-actions').element
      for (const button of actions.querySelectorAll('button')) {
        expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(Math.ceil(box.right))
      }
      expect(actions.scrollWidth).toBeLessThanOrEqual(actions.clientWidth)
    }
  })
})
