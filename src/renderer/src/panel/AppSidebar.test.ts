import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import AppSidebar from './AppSidebar.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import { appPageShown, sidebarHovered } from './appPageCover'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import { TELEMETRY_ACTION_EVENT_NAME, type TelemetryActionEventDetail } from '../lib/telemetry'
import type { CreditBalanceState, DashboardPage, Installation } from '../types/ipc'

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
const openGlobalSettings = vi.fn()
const openPageInNewWindow = vi.fn()
const getAppsEnabled = vi.fn<() => Promise<boolean>>()
const refreshCreditBalance = vi.fn<() => Promise<CreditBalanceState>>()

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  getAppsEnabled.mockResolvedValue(false)
  refreshCreditBalance.mockResolvedValue({ status: 'signed_out' })
  ;(window as unknown as { api: unknown }).api = {
    navigatePanel,
    openGlobalSettings,
    openPageInNewWindow,
    getAppsEnabled,
    getAppUpdateState: vi.fn().mockResolvedValue({ kind: null, version: null, autoUpdate: true }),
    onAppUpdateStateChanged: vi.fn(() => () => {}),
    getInstallations: vi.fn().mockResolvedValue([]),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    getSetting: vi.fn().mockResolvedValue(undefined),
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {}),
    refreshCreditBalance,
    onCreditBalanceChanged: vi.fn(() => () => {}),
    onAppPageClosed: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {})
    }
  }
  setActivePinia(createPinia())
  appPageShown.value = false
  sidebarHovered.value = false
})

afterEach(() => {
  vi.useRealTimers()
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

function tooltipOf(
  wrapper: Awaited<ReturnType<typeof mountSidebar>>,
  testId: string
): string | undefined {
  return wrapper.get(`[data-testid="${testId}"]`).findComponent(Tooltip).props('text')
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

  it('adds Apps between Home and Assets once Apps is switched on', async () => {
    getAppsEnabled.mockResolvedValue(true)
    const wrapper = await mountSidebar('apps')

    expect(wrapper.findAll('nav button').map((row) => row.text())).toEqual([
      'Home',
      'Apps',
      'Assets',
      'Builds',
      ''
    ])
    expect(wrapper.findAll('[aria-current="page"]').map((row) => row.text())).toEqual(['Apps'])

    await wrapper.get('[data-testid="app-sidebar-apps"]').trigger('click')

    expect(navigatePanel).toHaveBeenCalledExactlyOnceWith('apps')
    expect(wrapper.emitted('navigate')).toEqual([['apps']])
  })

  it('folds to the rail while an app is open, lets the toggle reopen it, and keeps the saved choice', async () => {
    const wrapper = await mountSidebar('apps')
    const sidebar = wrapper.get('[data-testid="app-sidebar"]')
    expect(sidebar.attributes('data-collapsed')).toBe('false')

    await wrapper.setProps({ makeRoom: true })
    expect(sidebar.attributes('data-collapsed')).toBe('true')

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
    expect(sidebar.attributes('data-collapsed')).toBe('false')

    await wrapper.setProps({ makeRoom: false })
    expect(sidebar.attributes('data-collapsed')).toBe('false')
    expect(window.localStorage.getItem('comfy.desktop.sidebar.collapsed')).not.toBe('true')

    await wrapper.setProps({ makeRoom: true })
    expect(sidebar.attributes('data-collapsed')).toBe('true')
  })

  it('leaves Apps out when the switch cannot be read', async () => {
    getAppsEnabled.mockRejectedValue(new Error('main is busy'))
    const wrapper = await mountSidebar()

    expect(wrapper.find('[data-testid="app-sidebar-apps"]').exists()).toBe(false)
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

    const logo = wrapper.get('button[aria-label="Home"]')
    expect(logo.element.closest('nav')).toBeNull()
    expect(logo.findComponent(Tooltip).props('text')).toBe('Home')
    await logo.trigger('click')

    expect(navigatePanel).toHaveBeenCalledExactlyOnceWith('home')
  })

  it('opens Desktop Settings above the account section without changing pages', async () => {
    const wrapper = await mountSidebar('assets')
    const settings = wrapper.get('[data-testid="app-sidebar-settings"]')

    expect(settings.text()).toBe('Desktop Settings')
    expect(settings.attributes('aria-haspopup')).toBe('dialog')
    expect(settings.element.closest('nav')).toBeNull()
    expect(settings.element.nextElementSibling?.classList.contains('sidebar-account')).toBe(true)

    const events: TelemetryActionEventDetail[] = []
    const record: EventListener = (event) => {
      events.push((event as CustomEvent<TelemetryActionEventDetail>).detail)
    }
    window.addEventListener(TELEMETRY_ACTION_EVENT_NAME, record)
    await settings.trigger('click')
    window.removeEventListener(TELEMETRY_ACTION_EVENT_NAME, record)

    expect(openGlobalSettings).toHaveBeenCalledExactlyOnceWith()
    expect(events).toEqual([
      expect.objectContaining({
        actionName: 'comfy.desktop.sidebar.settings_opened',
        context: { from_page: 'assets' }
      })
    ])
    expect(navigatePanel).not.toHaveBeenCalled()
    expect(wrapper.findAll('[aria-current="page"]').map((row) => row.text())).toEqual(['Assets'])
  })

  it('keeps Desktop Settings accessible as an icon when the sidebar is collapsed', async () => {
    const wrapper = await mountSidebar()

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
    const settings = wrapper.get('[data-testid="app-sidebar-settings"]')
    expect(settings.text()).toBe('')
    expect(settings.attributes('aria-label')).toBe('Desktop Settings')
    expect(tooltipOf(wrapper, 'app-sidebar-settings')).toBe('Desktop Settings')

    await settings.trigger('click')

    expect(openGlobalSettings).toHaveBeenCalledExactlyOnceWith()
  })

  it('collapses to icons with tooltips and stays collapsed when reopened', async () => {
    const wrapper = await mountSidebar()
    const home = wrapper.get('[data-testid="app-sidebar-home"]')
    expect(home.text()).toBe('Home')
    expect(tooltipOf(wrapper, 'app-sidebar-home')).toBeUndefined()
    expect(tooltipOf(wrapper, 'app-sidebar-settings')).toBeUndefined()

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
    await flushPromises()

    expect(home.text()).toBe('')
    expect(tooltipOf(wrapper, 'app-sidebar-home')).toBe('Home')
    expect(home.attributes('title')).toBeUndefined()
    expect(wrapper.get('[data-testid="app-sidebar-toggle"]').attributes('aria-expanded')).toBe(
      'false'
    )

    wrapper.unmount()
    const reopened = await mountSidebar()
    expect(reopened.get('[data-testid="app-sidebar"]').attributes('data-collapsed')).toBe('true')
  })

  it('keeps a tooltip on the icon-only buttons whether or not the sidebar is collapsed', async () => {
    const wrapper = await mountSidebar()
    expect(tooltipOf(wrapper, 'app-sidebar-toggle')).toBe('Collapse sidebar')
    expect(tooltipOf(wrapper, 'app-sidebar-new-build')).toBe('New build')

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')

    expect(tooltipOf(wrapper, 'app-sidebar-toggle')).toBe('Expand sidebar')
    expect(wrapper.findAllComponents(Tooltip).every((tip) => tip.props('side') === 'right')).toBe(
      true
    )
    expect(
      wrapper.findAll('[title]').filter((el) => !el.element.closest('.sidebar-account'))
    ).toHaveLength(0)
  })

  it('gives a folded row its tooltip over the whole row, not only the icon', async () => {
    window.localStorage.setItem('comfy.desktop.sidebar.collapsed', 'true')
    useInstallationStore().installations = []
    const wrapper = mount(AppSidebar, { props: { activePage: 'home' }, attachTo: document.body })
    await flushPromises()

    for (const testId of ['app-sidebar-home', 'app-sidebar-settings', 'app-sidebar-toggle']) {
      const row = wrapper.get(`[data-testid="${testId}"]`).element.getBoundingClientRect()
      const trigger = wrapper
        .get(`[data-testid="${testId}"] .tooltip-wrap`)
        .element.getBoundingClientRect()
      expect([trigger.width, trigger.height], testId).toEqual([row.width, row.height])
    }
    wrapper.unmount()
  })

  it('tells the app page the pointer is over the sidebar, and when it leaves', async () => {
    const wrapper = await mountSidebar()
    const sidebar = wrapper.get('[data-testid="app-sidebar"]')

    await sidebar.trigger('pointerenter')
    expect(sidebarHovered.value).toBe(true)

    await sidebar.trigger('pointerleave')
    expect(sidebarHovered.value).toBe(false)
  })

  it('holds a folded row tooltip while an app page is on screen, and opens it once the page is hidden', async () => {
    window.localStorage.setItem('comfy.desktop.sidebar.collapsed', 'true')
    appPageShown.value = true
    vi.useFakeTimers()
    const wrapper = mount(AppSidebar, { props: { activePage: 'apps' }, attachTo: document.body })
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()

    wrapper
      .get('[data-testid="app-sidebar-home"] .tooltip-wrap')
      .element.dispatchEvent(
        new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true })
      )
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()
    expect(document.querySelector('.tooltip-bubble')).toBeNull()

    appPageShown.value = false
    await flushPromises()

    expect(document.querySelector('.tooltip-bubble')?.textContent).toContain('Home')
    wrapper.unmount()
  })

  it('shows Credits between Desktop Settings and the account once signed in', async () => {
    refreshCreditBalance.mockResolvedValue({ status: 'ready', cents: 100 })
    const wrapper = await mountSidebar()

    const credits = wrapper.get('[data-testid="app-sidebar-credits"]')
    const settings = wrapper.get('[data-testid="app-sidebar-settings"]')
    expect(settings.element.nextElementSibling?.contains(credits.element)).toBe(true)
    expect(credits.element.parentElement?.nextElementSibling?.classList).toContain(
      'sidebar-account'
    )
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
      const wrapper = await mountSidebar('home', [OLD, TEAM, CLOUD])

      expect(buildNames(wrapper)).toEqual(['Comfy Cloud', 'Flux Sandbox'])

      useDashboardScopeStore().selectedWorkspaceId = 'ws-team'
      await flushPromises()

      expect(buildNames(wrapper)).toEqual(['Team Build', 'Comfy Cloud'])

      useDashboardScopeStore().selectedWorkspaceId = 'personal'
      await flushPromises()

      expect(buildNames(wrapper)).toEqual(['Comfy Cloud', 'Flux Sandbox'])
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

    it('puts the green dot only on a running build, even with no ComfyUI window open', async () => {
      expect(useSessionStore().activeSessions.size).toBe(0)
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
      expect([live('new'), live('cloud'), live('old')]).toEqual([true, false, false])
    })

    it('marks a build that failed to start and says why on hover', async () => {
      useSessionStore().errorInstances.set(OLD.id, {
        installationName: OLD.name,
        message: 'Port 8188 is in use'
      })
      const wrapper = await mountSidebar('home', [OLD])

      const row = wrapper.get('[data-testid="app-sidebar-build-old"]')
      expect(row.find('[data-testid="app-sidebar-dot-failed"]').exists()).toBe(true)
      expect(tooltipOf(wrapper, 'app-sidebar-build-old')).toBe(
        'Flux Sandbox · Failed to start: Port 8188 is in use'
      )
      expect(row.get('.sr-only').text()).toBe('· Failed to start: Port 8188 is in use')
    })

    it('says a build crashed, with its exit code, rather than that it failed to start', async () => {
      useSessionStore().errorInstances.set(OLD.id, {
        installationName: OLD.name,
        exitCode: 3221225477
      })
      const wrapper = await mountSidebar('home', [OLD])

      const row = wrapper.get('[data-testid="app-sidebar-build-old"]')
      expect(row.find('[data-testid="app-sidebar-dot-failed"]').exists()).toBe(true)
      expect(tooltipOf(wrapper, 'app-sidebar-build-old')).toBe(
        'Flux Sandbox · Crashed (exit code 3221225477)'
      )
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
      expect(tooltipOf(wrapper, 'app-sidebar-chooser')).toBe('Builds')
      expect(builds.attributes('aria-current')).toBe('page')
    })
  })

  describe('page right-click menu', () => {
    const mounted: ReturnType<typeof mount>[] = []

    afterEach(() => {
      for (const wrapper of mounted.splice(0)) wrapper.unmount()
      document.body.innerHTML = ''
    })

    async function mountAttached(builds: Installation[] = []) {
      getAppsEnabled.mockResolvedValue(true)
      useInstallationStore().installations = builds
      const wrapper = mount(AppSidebar, {
        props: { activePage: 'home' },
        attachTo: document.body
      })
      mounted.push(wrapper)
      await flushPromises()
      return wrapper
    }

    async function rightClick(element: Element): Promise<void> {
      element.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })
      )
      await flushPromises()
    }

    function pageMenu(): Element | null {
      return document.querySelector('[data-testid="sidebar-page-menu"]')
    }

    async function shownPageMenu(): Promise<Element> {
      await vi.waitFor(() => expect(pageMenu()).not.toBeNull())
      return pageMenu()!
    }

    it.each([
      ['app-sidebar-home', 'home'],
      ['app-sidebar-apps', 'apps'],
      ['app-sidebar-assets', 'assets'],
      ['app-sidebar-chooser', 'chooser']
    ] as const)('right-clicking %s offers only Open in new window', async (testId, page) => {
      const wrapper = await mountAttached()

      await rightClick(wrapper.get(`[data-testid="${testId}"]`).element)

      const menu = await shownPageMenu()
      expect(menu.getAttribute('data-page')).toBe(page)
      expect(
        [...menu.querySelectorAll('[role="menuitem"]')].map((row) => row.textContent?.trim())
      ).toEqual(['Open in new window'])
      expect(navigatePanel).not.toHaveBeenCalled()
    })

    it('opens the right-clicked page in a new window and closes the menu', async () => {
      const wrapper = await mountAttached()

      await rightClick(wrapper.get('[data-testid="app-sidebar-assets"]').element)
      const item = (await shownPageMenu()).querySelector(
        '[data-testid="sidebar-page-menu-new-window"]'
      ) as HTMLElement
      item.click()
      await flushPromises()

      expect(openPageInNewWindow).toHaveBeenCalledExactlyOnceWith('assets')
      expect(navigatePanel).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(pageMenu()).toBeNull())
    })

    it('leaves a build row to the build menu', async () => {
      const wrapper = await mountAttached([OLD])

      await rightClick(wrapper.get('[data-testid="app-sidebar-build-old"]').element)

      await vi.waitFor(() =>
        expect(document.querySelector('[data-testid="build-menu"]')).not.toBeNull()
      )
      expect(pageMenu()).toBeNull()
    })
  })
})
