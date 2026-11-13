import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AppSidebar from './AppSidebar.vue'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { DashboardPage, Installation } from '../types/ipc'

function build(over: Partial<Installation> & { id: string; name: string }): Installation {
  return { sourceLabel: 'Standalone', sourceCategory: 'local', ...over }
}

const OLD = build({ id: 'old', name: 'Flux Sandbox', lastLaunchedAt: 100 })
const CLOUD = build({
  id: 'cloud',
  name: 'Comfy Cloud',
  sourceId: 'cloud',
  sourceLabel: 'Cloud',
  sourceCategory: 'cloud',
  lastLaunchedAt: 200
})
const NEW = build({ id: 'new', name: 'Video Lab', lastLaunchedAt: 300 })
const TEAM = build({ id: 'team', name: 'Team Build', lastLaunchedAt: 400, workspaceId: 'ws-team' })

const navigatePanel = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  ;(window as unknown as { api: unknown }).api = {
    navigatePanel,
    getInstallations: vi.fn().mockResolvedValue([]),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
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

async function mountSidebar(
  activePage: DashboardPage = 'chooser',
  builds: Installation[] = [],
  activeBuildId: string | null = null
) {
  useInstallationStore().installations = builds
  const wrapper = mount(AppSidebar, {
    props: { activePage, activeBuildId }
  })
  await flushPromises()
  return wrapper
}

describe('AppSidebar', () => {
  it('lists Home, Assets, then the Builds group, with the tools left to the menu', async () => {
    const wrapper = await mountSidebar()

    expect(wrapper.findAll('nav button').map((row) => row.text())).toEqual([
      'Home',
      'Assets',
      'Builds',
      ''
    ])
    expect(wrapper.get('[data-testid="app-sidebar-new-build"]').attributes('aria-label')).toBe(
      'New build'
    )
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
    ['app-sidebar-assets', 'assets'],
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
    const home = wrapper.get('[data-testid="app-sidebar-home"]')
    expect(home.text()).toBe('Home')
    expect(home.attributes('title')).toBeUndefined()

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
    await flushPromises()

    expect(home.text()).toBe('')
    expect(home.attributes('title')).toBe('Home')
    expect(wrapper.get('[data-testid="app-sidebar-toggle"]').attributes('aria-expanded')).toBe(
      'false'
    )

    wrapper.unmount()
    const reopened = await mountSidebar()
    expect(reopened.get('[data-testid="app-sidebar"]').attributes('data-collapsed')).toBe('true')
  })

  describe('Builds group', () => {
    function buildNames(wrapper: Awaited<ReturnType<typeof mountSidebar>>): string[] {
      return wrapper.findAll('[data-testid^="app-sidebar-build-"]').map((row) => row.text())
    }

    it('lists the builds of the selected workspace, most recently used first', async () => {
      const wrapper = await mountSidebar('home', [OLD, TEAM, CLOUD, NEW])

      expect(buildNames(wrapper)).toEqual(['Video Lab', 'Comfy Cloud', 'Flux Sandbox'])
    })

    it('follows the workspace picked in the sidebar', async () => {
      const wrapper = await mountSidebar('home', [OLD, TEAM])

      useDashboardScopeStore().selectedWorkspaceId = 'ws-team'
      await flushPromises()

      expect(buildNames(wrapper)).toEqual(['Team Build'])
    })

    it('marks only the open build, not the Builds title', async () => {
      const wrapper = await mountSidebar('chooser', [OLD, NEW], 'old')

      expect(wrapper.findAll('[aria-current="page"]').map((row) => row.text())).toEqual([
        'Flux Sandbox'
      ])
    })

    it('marks the Builds title on the Builds page', async () => {
      const wrapper = await mountSidebar('chooser', [OLD])

      expect(wrapper.findAll('[aria-current="page"]').map((row) => row.text())).toEqual(['Builds'])
    })

    it('puts the green dot on running and always-on builds only', async () => {
      useSessionStore().runningInstances.set(NEW.id, {
        installationId: NEW.id,
        installationName: NEW.name,
        mode: 'window'
      })
      const wrapper = await mountSidebar('home', [OLD, CLOUD, NEW])

      const live = (id: string) =>
        wrapper
          .get(`[data-testid="app-sidebar-build-${id}"]`)
          .find('[data-testid="app-sidebar-dot-live"]')
          .exists()
      expect([live('new'), live('cloud'), live('old')]).toEqual([true, true, false])
    })

    it('marks a build that failed to start and says why on hover', async () => {
      useSessionStore().errorInstances.set(OLD.id, {
        installationName: OLD.name,
        message: 'Port 8188 is in use'
      })
      const wrapper = await mountSidebar('home', [OLD])

      const row = wrapper.get('[data-testid="app-sidebar-build-old"]')
      expect(row.find('[data-testid="app-sidebar-dot-failed"]').exists()).toBe(true)
      expect(row.attributes('title')).toBe('Flux Sandbox · Failed to start: Port 8188 is in use')
    })

    it('says a build crashed, with its exit code, rather than that it failed to start', async () => {
      useSessionStore().errorInstances.set(OLD.id, {
        installationName: OLD.name,
        exitCode: 3221225477
      })
      const wrapper = await mountSidebar('home', [OLD])

      const row = wrapper.get('[data-testid="app-sidebar-build-old"]')
      expect(row.find('[data-testid="app-sidebar-dot-failed"]').exists()).toBe(true)
      expect(row.attributes('title')).toBe('Flux Sandbox · Crashed (exit code 3221225477)')
    })

    it('opens a build without launching or navigating', async () => {
      const wrapper = await mountSidebar('home', [OLD])

      await wrapper.get('[data-testid="app-sidebar-build-old"]').trigger('click')

      expect(wrapper.emitted('open-build')).toEqual([[OLD]])
      expect(navigatePanel).not.toHaveBeenCalled()
    })

    it('starts a new build from the + on the title', async () => {
      const wrapper = await mountSidebar('home')

      await wrapper.get('[data-testid="app-sidebar-new-build"]').trigger('click')

      expect(wrapper.emitted('new-build')).toHaveLength(1)
      expect(navigatePanel).not.toHaveBeenCalled()
    })

    it('says there are no builds yet when the workspace has none', async () => {
      const wrapper = await mountSidebar('home', [TEAM])

      expect(buildNames(wrapper)).toEqual([])
      expect(wrapper.get('[data-testid="app-sidebar-no-builds"]').text()).toBe('No builds yet')
    })

    it('keeps only the Builds icon on the rail', async () => {
      window.localStorage.setItem('comfy.desktop.sidebar.collapsed', 'true')
      const wrapper = await mountSidebar('chooser', [OLD], 'old')

      expect(wrapper.find('[data-testid="app-sidebar-builds"]').exists()).toBe(false)
      const builds = wrapper.get('[data-testid="app-sidebar-chooser"]')
      expect(builds.attributes('title')).toBe('Builds')
      expect(builds.attributes('aria-current')).toBe('page')
    })
  })
})
