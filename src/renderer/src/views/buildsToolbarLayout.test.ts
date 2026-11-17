import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import ChooserView from './ChooserView.vue'
import type { Installation } from '../types/ipc'

const FRAME_AND_EXPANDED_SIDEBAR_WIDTH = 16 + 8 + 244
const BUILDS_PAGE_WIDTH = (windowWidth: number): number =>
  windowWidth - FRAME_AND_EXPANDED_SIDEBAR_WIDTH

const BUILDS: Installation[] = [
  { id: 'a', name: 'My ComfyUI Build', sourceLabel: 'Standalone', sourceCategory: 'local' },
  { id: 'b', name: 'Flux Sandbox', sourceLabel: 'Standalone', sourceCategory: 'local' },
  { id: 'c', name: 'Comfy Cloud', sourceLabel: 'Cloud', sourceCategory: 'cloud' }
] as Installation[]

let host: HTMLElement
let wrapper: VueWrapper | undefined

beforeAll(() => browserPage.viewport(1400, 900))

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    getInstallations: vi.fn().mockResolvedValue(BUILDS),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    getSetting: vi.fn().mockResolvedValue(undefined),
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {}),
    onErrorDetail: vi.fn(() => () => {}),
    getListActions: vi.fn().mockResolvedValue([]),
    getCloudFreeRunsEnabled: vi.fn().mockResolvedValue(false),
    getCloudUserTier: vi.fn().mockResolvedValue('unknown'),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {}),
      listWorkspaces: vi.fn().mockResolvedValue([]),
      listBuilds: vi.fn().mockResolvedValue([])
    }
  }
  setActivePinia(createPinia())
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  host.remove()
})

async function mountAt(pageWidth: number): Promise<HTMLElement> {
  host.style.cssText = `position: absolute; left: 0; top: 0; width: ${pageWidth}px; height: 900px`
  wrapper = mount(ChooserView, { attachTo: host, global: { plugins: [createPinia()] } })
  await flushPromises()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return wrapper.get('.chooser-toolbar').element as HTMLElement
}

function rowsOf(toolbar: HTMLElement): number {
  const boxes = [...toolbar.children]
    .filter((child) => (child as HTMLElement).offsetParent !== null)
    .map((child) => child.getBoundingClientRect())
    .sort((a, b) => a.top - b.top)
  let rows = 0
  let rowBottom = Number.NEGATIVE_INFINITY
  for (const box of boxes) {
    if (box.top >= rowBottom) {
      rows++
      rowBottom = box.bottom
    } else {
      rowBottom = Math.max(rowBottom, box.bottom)
    }
  }
  return rows
}

function insideToolbar(toolbar: HTMLElement): boolean {
  const box = toolbar.getBoundingClientRect()
  return [...toolbar.querySelectorAll('*')].every((element) => {
    const rect = element.getBoundingClientRect()
    return rect.width === 0 || (rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5)
  })
}

describe('Builds toolbar', () => {
  it('keeps tabs, sort and the full search on one line in a wide window', async () => {
    const toolbar = await mountAt(BUILDS_PAGE_WIDTH(1280))
    expect(toolbar.dataset.layout).toBe('full')
    expect(rowsOf(toolbar)).toBe(1)
    expect(toolbar.querySelector('.chooser-search input')).not.toBeNull()
    expect(insideToolbar(toolbar)).toBe(true)
  })

  it('folds search into an icon to keep one line in the smallest window', async () => {
    const toolbar = await mountAt(BUILDS_PAGE_WIDTH(800))
    expect(toolbar.dataset.layout).toBe('icon')
    expect(rowsOf(toolbar)).toBe(1)
    expect(toolbar.querySelector('.chooser-search')).toBeNull()
    expect(insideToolbar(toolbar)).toBe(true)
  })

  it('opens the search in place of the sort, on the same line and at the same height', async () => {
    const toolbar = await mountAt(BUILDS_PAGE_WIDTH(800))
    const height = toolbar.getBoundingClientRect().height
    await wrapper!.get('[data-testid="chooser-search-toggle"]').trigger('click')
    await flushPromises()

    const input = toolbar.querySelector<HTMLInputElement>('.chooser-search input')!
    expect(document.activeElement).toBe(input)
    expect(rowsOf(toolbar)).toBe(1)
    expect(toolbar.getBoundingClientRect().height).toBe(height)
    expect(insideToolbar(toolbar)).toBe(true)

    await wrapper!.get('.chooser-search').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(toolbar.querySelector('[data-testid="chooser-search-toggle"]')).not.toBeNull()
  })

  it('keeps a typed search visible when the window narrows to the icon layout', async () => {
    const toolbar = await mountAt(BUILDS_PAGE_WIDTH(1280))
    await wrapper!.get('.chooser-search input').setValue('studio')
    host.style.width = `${BUILDS_PAGE_WIDTH(800)}px`
    await vi.waitFor(() => expect(toolbar.dataset.layout).toBe('icon'))
    await flushPromises()
    expect(toolbar.querySelector<HTMLInputElement>('.chooser-search input')?.value).toBe('studio')
    expect(rowsOf(toolbar)).toBe(1)
  })

  it('gives the sort and the search the same text and height', async () => {
    const toolbar = await mountAt(BUILDS_PAGE_WIDTH(1280))
    const label = getComputedStyle(toolbar.querySelector('.ui-select-label')!)
    const input = getComputedStyle(toolbar.querySelector('.chooser-search input')!)
    expect(input.fontSize).toBe(label.fontSize)
    expect(input.fontWeight).toBe(label.fontWeight)
    expect(input.fontFamily).toBe(label.fontFamily)
    const trigger = toolbar.querySelector('.ui-select-trigger')!.getBoundingClientRect()
    const field = toolbar.querySelector('.chooser-search .ui-input')!.getBoundingClientRect()
    expect(field.height).toBe(trigger.height)
  })

  it('puts the tabs on top and sort and search across the full width when one line does not fit', async () => {
    const toolbar = await mountAt(360)
    expect(toolbar.dataset.layout).toBe('stacked')
    expect(rowsOf(toolbar)).toBe(2)
    const controls = toolbar.children[1] as HTMLElement
    expect(Math.round(controls.getBoundingClientRect().width)).toBe(
      Math.round(toolbar.getBoundingClientRect().width)
    )
    expect(toolbar.querySelector('.chooser-search input')).not.toBeNull()
    expect(insideToolbar(toolbar)).toBe(true)
  })
})
