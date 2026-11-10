import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AppSidebar from './AppSidebar.vue'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { DashboardPage, Installation } from '../types/ipc'

const navigatePanel = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  ;(window as unknown as { api: unknown }).api = {
    navigatePanel,
    getSetting: vi.fn().mockResolvedValue(undefined),
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {}),
    getInstallations: vi.fn().mockResolvedValue([]),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
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

  it('lists the builds under Builds and opens a build page without launching it', async () => {
    useInstallationStore().installations = [
      { id: 'a', name: 'Alpha', sourceCategory: 'local' },
      { id: 'b', name: 'Beta', sourceCategory: 'cloud' }
    ] as Installation[]
    const wrapper = await mountSidebar()

    expect(wrapper.findAll('nav button').map((row) => row.text())).toEqual([
      'Builds',
      'Alpha',
      'Beta',
      'Performance Tests',
      'Benchmarks'
    ])

    await wrapper.get('[data-testid="app-sidebar-build-b"]').trigger('click')

    expect(wrapper.emitted('open-details')).toEqual([[expect.objectContaining({ id: 'b' })]])
    expect(navigatePanel).not.toHaveBeenCalled()
  })

  it('marks a running build and hides the builds when collapsed', async () => {
    useInstallationStore().installations = [
      { id: 'a', name: 'Alpha', sourceCategory: 'local' }
    ] as Installation[]
    const wrapper = await mountSidebar()
    const build = wrapper.get('[data-testid="app-sidebar-build-a"]')
    expect(build.find('.bg-success').exists()).toBe(false)

    useSessionStore().runningInstances.set('a', { installationId: 'a' } as never)
    await flushPromises()
    expect(build.find('.bg-success').exists()).toBe(true)

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="app-sidebar-build-a"]').exists()).toBe(false)
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
