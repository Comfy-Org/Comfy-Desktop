import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import en from '@locales/en.json'

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
    props: { activePage },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] }
  })
  await flushPromises()
  return wrapper
}

describe('AppSidebar', () => {
  it('lists Builds, Performance Tests, then Benchmarks', async () => {
    const wrapper = await mountSidebar()

    expect(wrapper.findAll('nav button').map((row) => row.text())).toEqual([
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
})
