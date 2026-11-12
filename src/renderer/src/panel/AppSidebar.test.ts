import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AppSidebar from './AppSidebar.vue'
import type { DashboardPage } from '../types/ipc'

const navigatePanel = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  ;(window as unknown as { api: unknown }).api = {
    navigatePanel,
    getSetting: vi.fn().mockResolvedValue(undefined),
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {})
    }
  }
  setActivePinia(createPinia())
})

async function mountSidebar(activePage: DashboardPage = 'chooser') {
  const wrapper = mount(AppSidebar, {
    props: { activePage }
  })
  await flushPromises()
  return wrapper
}

describe('AppSidebar', () => {
  it('lists Home then Builds, with the tools left to the menu', async () => {
    const wrapper = await mountSidebar()

    expect(wrapper.findAll('nav button').map((row) => row.text())).toEqual(['Home', 'Builds'])
  })

  it('marks only the current page', async () => {
    const wrapper = await mountSidebar('chooser')

    expect(wrapper.findAll('[aria-current="page"]').map((row) => row.text())).toEqual(['Builds'])
  })

  it('marks no row while a tool page from the menu is open', async () => {
    const wrapper = await mountSidebar('benchmarks')

    expect(wrapper.findAll('[aria-current="page"]')).toHaveLength(0)
  })

  it.each<[string, DashboardPage]>([
    ['app-sidebar-home', 'home'],
    ['app-sidebar-chooser', 'chooser']
  ])('navigates from %s', async (testId, page) => {
    const wrapper = await mountSidebar()

    await wrapper.get(`[data-testid="${testId}"]`).trigger('click')

    expect(navigatePanel).toHaveBeenCalledExactlyOnceWith(page)
  })

  it('returns Home from the Comfy mark', async () => {
    const wrapper = await mountSidebar('benchmarks')

    await wrapper.get('button[title="Home"]').trigger('click')

    expect(navigatePanel).toHaveBeenCalledExactlyOnceWith('home')
  })

  it('collapses to icons with tooltips and stays collapsed when reopened', async () => {
    const wrapper = await mountSidebar()
    const builds = wrapper.get('[data-testid="app-sidebar-chooser"]')
    expect(builds.text()).toBe('Builds')
    expect(builds.attributes('title')).toBeUndefined()

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
    await flushPromises()

    expect(builds.text()).toBe('')
    expect(builds.attributes('title')).toBe('Builds')
    expect(wrapper.get('[data-testid="app-sidebar-toggle"]').attributes('aria-expanded')).toBe(
      'false'
    )

    wrapper.unmount()
    const reopened = await mountSidebar()
    expect(reopened.get('[data-testid="app-sidebar"]').attributes('data-collapsed')).toBe('true')
  })
})
