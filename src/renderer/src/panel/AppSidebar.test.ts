import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AppSidebar from './AppSidebar.vue'
import type { DashboardPage } from '../types/ipc'

const navigatePanel = vi.fn()
const getAppsEnabled = vi.fn()
let pushAppsSwitch: (info: { enabled: boolean }) => void = () => {}
const stopAppsSwitch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  getAppsEnabled.mockResolvedValue(true)
  ;(window as unknown as { api: unknown }).api = {
    navigatePanel,
    getAppsEnabled,
    onAppsEnabledChanged: vi.fn((callback: (info: { enabled: boolean }) => void) => {
      pushAppsSwitch = callback
      return stopAppsSwitch
    }),
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
  it('lists Home, Apps, Assets, Builds, Performance Tests, then Benchmarks', async () => {
    const wrapper = await mountSidebar()

    expect(wrapper.findAll('nav button').map((row) => row.text())).toEqual([
      'Home',
      'Apps',
      'Assets',
      'Builds',
      'Performance Tests',
      'Benchmarks'
    ])
  })

  it('hides the Apps row while the remote switch is off', async () => {
    getAppsEnabled.mockResolvedValue(false)
    const wrapper = await mountSidebar()

    expect(wrapper.findAll('nav button').map((row) => row.text())).toEqual([
      'Home',
      'Assets',
      'Builds',
      'Performance Tests',
      'Benchmarks'
    ])
    expect(wrapper.find('[data-testid="app-sidebar-apps"]').exists()).toBe(false)
  })

  it('hides the Apps row when Desktop cannot say whether the switch is on', async () => {
    getAppsEnabled.mockRejectedValue(new Error('no answer'))
    const wrapper = await mountSidebar()

    expect(wrapper.find('[data-testid="app-sidebar-apps"]').exists()).toBe(false)
  })

  it('shows the Apps row when the remote switch turns on after start-up', async () => {
    getAppsEnabled.mockResolvedValue(false)
    const wrapper = await mountSidebar()

    pushAppsSwitch({ enabled: true })
    await flushPromises()

    expect(wrapper.find('[data-testid="app-sidebar-apps"]').exists()).toBe(true)
  })

  it('leaves the Apps page for Home when the remote switch turns off', async () => {
    const wrapper = await mountSidebar('apps')

    pushAppsSwitch({ enabled: false })
    await flushPromises()

    expect(wrapper.find('[data-testid="app-sidebar-apps"]').exists()).toBe(false)
    expect(wrapper.emitted('navigate')).toEqual([['home']])
    expect(navigatePanel).toHaveBeenCalledWith('home')
  })

  it('keeps a pushed switch over a slower first read', async () => {
    let firstRead: (on: boolean) => void = () => {}
    getAppsEnabled.mockReturnValue(new Promise((resolve) => (firstRead = resolve)))
    const wrapper = await mountSidebar()

    pushAppsSwitch({ enabled: true })
    firstRead(false)
    await flushPromises()

    expect(wrapper.find('[data-testid="app-sidebar-apps"]').exists()).toBe(true)
  })

  it('stops following the switch when it unmounts', async () => {
    const wrapper = await mountSidebar()

    wrapper.unmount()

    expect(stopAppsSwitch).toHaveBeenCalled()
  })

  it('marks only the current page', async () => {
    const wrapper = await mountSidebar('benchmarks')

    expect(wrapper.findAll('[aria-current="page"]').map((row) => row.text())).toEqual([
      'Benchmarks'
    ])
  })

  it.each<[string, DashboardPage]>([
    ['app-sidebar-home', 'home'],
    ['app-sidebar-apps', 'apps'],
    ['app-sidebar-assets', 'assets'],
    ['app-sidebar-chooser', 'chooser'],
    ['app-sidebar-benchmarks', 'benchmarks'],
    ['app-sidebar-performance-test', 'performance-test']
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
