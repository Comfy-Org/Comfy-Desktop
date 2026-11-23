import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import StorageDirRow from './StorageDirRow.vue'

const FOLDER_OPEN_ICON = 'svg[class*="lucide-folder-open"]'
const mounted: VueWrapper[] = []

function mountRow(props: Record<string, unknown>) {
  const wrapper = mount(StorageDirRow, {
    props: { path: '/data/input', ...props },
    attachTo: document.body
  })
  mounted.push(wrapper)
  return wrapper
}

function menuItems() {
  return [...document.querySelectorAll<HTMLElement>('.storage-dir-menu [role="menuitem"]')].map(
    (el) => new DOMWrapper(el)
  )
}

beforeEach(() => {
  ;(window as unknown as { api: Record<string, unknown> }).api = { platform: 'win32' }
})

afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
})

describe.each([
  ['panel row', false],
  ['list-aligned row', true]
])('StorageDirRow as a %s', (_name, listAligned) => {
  it('shows the path as plain text, not a button', () => {
    const wrapper = mountRow({ listAligned })
    const name = wrapper.get('.storage-dir-name')
    expect(name.element.tagName).toBe('SPAN')
    expect(name.element.closest('button')).toBeNull()
    expect(name.text()).toBe('/data/input')
    expect(name.attributes('title')).toBe('/data/input')
  })

  it('does not open the folder when the path text is clicked', async () => {
    const wrapper = mountRow({ listAligned })
    await wrapper.get('.storage-dir-name').trigger('click')
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('opens the folder from the reveal button in the actions area', async () => {
    const wrapper = mountRow({ listAligned })
    const reveal = wrapper.get('.storage-dir-actions .reveal-folder-button')
    expect(reveal.find(FOLDER_OPEN_ICON).exists()).toBe(true)
    expect(reveal.attributes('aria-label')).toBe('Show in Explorer: /data/input')
    await reveal.trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
    expect(wrapper.emitted('browse')).toBeUndefined()
  })

  it('shows FolderOpen only on the reveal button', () => {
    const wrapper = mountRow({ listAligned, resettable: true })
    const icons = wrapper.findAll(FOLDER_OPEN_ICON)
    expect(icons).toHaveLength(1)
    expect(icons[0]!.element.closest('.reveal-folder-button')).not.toBeNull()
  })

  it('offers no reveal button without a path', () => {
    const wrapper = mountRow({ listAligned, path: '' })
    expect(wrapper.find('.reveal-folder-button').exists()).toBe(false)
  })
})

describe('StorageDirRow choosing a folder', () => {
  it('chooses from a text Browse button in a panel row', async () => {
    const wrapper = mountRow({})
    const browse = wrapper.get('.storage-dir-browse')
    expect(browse.text()).toBe('Browse')
    expect(browse.find('svg').exists()).toBe(false)
    await browse.trigger('click')
    expect(wrapper.emitted('browse')).toHaveLength(1)
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('hides Browse when the row is not browsable', () => {
    const wrapper = mountRow({ browsable: false })
    expect(wrapper.find('.storage-dir-browse').exists()).toBe(false)
  })

  it('chooses from the Change folder menu item in a list-aligned row', async () => {
    const wrapper = mountRow({ listAligned: true })
    expect(wrapper.find('.storage-dir-browse').exists()).toBe(false)
    await wrapper.get('[aria-label="More actions"]').trigger('click')
    await nextTick()
    await flushPromises()
    const change = menuItems().find((item) => item.text() === 'Change folder')
    expect(change, 'the menu offers Change folder').toBeTruthy()
    expect(change!.find('svg').exists()).toBe(false)
    await change!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('browse')).toHaveLength(1)
  })
})
