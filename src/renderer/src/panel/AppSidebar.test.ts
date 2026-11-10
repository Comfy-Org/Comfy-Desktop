import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AppSidebar from './AppSidebar.vue'
import type { DashboardPage } from '../types/ipc'
import type { SidebarPage } from './dashboardSection'

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

async function mountSidebar(activePage: SidebarPage = 'chooser') {
  const wrapper = mount(AppSidebar, {
    props: { activePage }
  })
  await flushPromises()
  return wrapper
}

describe('AppSidebar', () => {
  it('lists Home, Apps, Builds, Performance Tests, then Benchmarks', async () => {
    const wrapper = await mountSidebar()

    expect(wrapper.findAll('nav button').map((row) => row.text())).toEqual([
      'Home',
      'Apps',
      'Builds',
      'Performance Tests',
      'Benchmarks'
    ])
  })

  it('marks only the current page', async () => {
    const wrapper = await mountSidebar('benchmarks')

    expect(wrapper.findAll('[aria-current="page"]').map((row) => row.text())).toEqual([
      'Benchmarks'
    ])
  })

  it.each<[string, DashboardPage]>([
    ['app-sidebar-chooser', 'chooser'],
    ['app-sidebar-benchmarks', 'benchmarks'],
    ['app-sidebar-performance-test', 'performance-test']
  ])('navigates from %s', async (testId, page) => {
    const wrapper = await mountSidebar()

    await wrapper.get(`[data-testid="${testId}"]`).trigger('click')

    expect(navigatePanel).toHaveBeenCalledExactlyOnceWith(page)
  })

  it.each<SidebarPage>(['home', 'apps'])(
    'opens the %s section inside the dashboard',
    async (section) => {
      const wrapper = await mountSidebar('benchmarks')

      await wrapper.get(`[data-testid="app-sidebar-${section}"]`).trigger('click')

      expect(wrapper.emitted('navigate')).toEqual([[section]])
      expect(navigatePanel).toHaveBeenCalledExactlyOnceWith('chooser')
    }
  )

  it('marks a dashboard section as the current page', async () => {
    const wrapper = await mountSidebar('apps')

    expect(wrapper.findAll('[aria-current="page"]').map((row) => row.text())).toEqual(['Apps'])
  })

  it('returns Home from the Comfy mark', async () => {
    const wrapper = await mountSidebar('benchmarks')

    await wrapper.get('button[title="Home"]').trigger('click')

    expect(navigatePanel).toHaveBeenCalledExactlyOnceWith('chooser')
  })

  it('collapses to icons with tooltips and stays collapsed when reopened', async () => {
    const wrapper = await mountSidebar()
    const benchmarks = wrapper.get('[data-testid="app-sidebar-benchmarks"]')
    expect(benchmarks.text()).toBe('Benchmarks')
    expect(benchmarks.attributes('title')).toBeUndefined()

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
    await flushPromises()

    expect(benchmarks.text()).toBe('')
    expect(benchmarks.attributes('title')).toBe('Benchmarks')
    expect(wrapper.get('[data-testid="app-sidebar-toggle"]').attributes('aria-expanded')).toBe(
      'false'
    )

    wrapper.unmount()
    const reopened = await mountSidebar()
    expect(reopened.get('[data-testid="app-sidebar"]').attributes('data-collapsed')).toBe('true')
  })

  it('folds while an app is open without changing the saved setting', async () => {
    window.localStorage.setItem('comfy.desktop.sidebar.collapsed', 'false')
    const wrapper = await mountSidebar()
    const sidebar = () => wrapper.get('[data-testid="app-sidebar"]')

    await wrapper.setProps({ folded: true })
    expect(sidebar().attributes('data-collapsed')).toBe('true')
    expect(sidebar().attributes('style')).toContain('width: 72px')
    expect(window.localStorage.getItem('comfy.desktop.sidebar.collapsed')).toBe('false')

    await wrapper.setProps({ folded: false })
    expect(sidebar().attributes('data-collapsed')).toBe('false')
    expect(sidebar().attributes('style')).toContain('width: 244px')
  })

  it('expands from the toggle while folded, even when saved as collapsed', async () => {
    window.localStorage.setItem('comfy.desktop.sidebar.collapsed', 'true')
    const wrapper = await mountSidebar()
    await wrapper.setProps({ folded: true })

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="app-sidebar"]').attributes('data-collapsed')).toBe('false')
    expect(window.localStorage.getItem('comfy.desktop.sidebar.collapsed')).toBe('false')
  })
})
