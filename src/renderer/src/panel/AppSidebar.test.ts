import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { cdp, userEvent } from 'vitest/browser'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import AppSidebar from './AppSidebar.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import { appPageShown, sidebarFocused, sidebarHovered } from './appPageCover'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import { useProgressStore, type Operation } from '../stores/progressStore'
import { __resetHomeTourForTest } from './home/useHomeTour'
import { TELEMETRY_ACTION_EVENT_NAME, type TelemetryActionEventDetail } from '../lib/telemetry'
import type { AppCard, CreditBalanceState, DashboardPage, Installation } from '../types/ipc'

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

const CHARACTER_SWAP: AppCard = {
  id: 'character-swap',
  title: 'Character Swap',
  description: 'Put another character in a video.',
  covers: []
}

const navigatePanel = vi.fn()
const openGlobalSettings = vi.fn()
const openPageInNewWindow = vi.fn()
const refreshCreditBalance = vi.fn<() => Promise<CreditBalanceState>>()

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  refreshCreditBalance.mockResolvedValue({ status: 'signed_out' })
  ;(window as unknown as { api: unknown }).api = {
    navigatePanel,
    openGlobalSettings,
    openPageInNewWindow,
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
    onAppBackToListAsked: vi.fn(() => () => {}),
    onAppsListChanged: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {})
    }
  }
  setActivePinia(createPinia())
  __resetHomeTourForTest()
  appPageShown.value = false
  sidebarHovered.value = false
  sidebarFocused.value = false
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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
  const inner = wrapper.get(`[data-testid="${testId}"]`).findComponent(Tooltip)
  if (inner.exists()) return inner.props('text')
  return wrapper
    .findAllComponents(Tooltip)
    .find((tooltip) => tooltip.find(`[data-testid="${testId}"]`).exists())
    ?.props('text')
}

describe('AppSidebar', () => {
  it('lists Home, Workflows, Apps, Assets, then the Builds group, with the tools left to the menu', async () => {
    const wrapper = await mountSidebar()

    expect(wrapper.findAll('nav button').map((row) => row.text())).toEqual([
      'Home',
      'Workflows',
      'Apps',
      'Assets',
      'Builds',
      ''
    ])
    expect(wrapper.get('[data-testid="app-sidebar-new-build"]').attributes('aria-label')).toBe(
      'New build'
    )
  })

  it('marks Apps as the current page and opens it from its row', async () => {
    const wrapper = await mountSidebar('apps')

    expect(wrapper.findAll('[aria-current="page"]').map((row) => row.text())).toEqual(['Apps'])

    await wrapper.get('[data-testid="app-sidebar-apps"]').trigger('click')

    expect(navigatePanel).toHaveBeenCalledExactlyOnceWith('apps')
    expect(wrapper.emitted('navigate')).toEqual([['apps']])
  })

  it('marks Workflows as the current page and opens it from its row', async () => {
    const wrapper = await mountSidebar('workflows')

    expect(wrapper.findAll('[aria-current="page"]').map((row) => row.text())).toEqual(['Workflows'])
    expect(wrapper.get('[data-testid="app-sidebar-workflows"]').attributes('aria-label')).toBe(
      'Workflows'
    )

    await wrapper.get('[data-testid="app-sidebar-workflows"]').trigger('click')

    expect(navigatePanel).toHaveBeenCalledExactlyOnceWith('workflows')
    expect(wrapper.emitted('navigate')).toEqual([['workflows']])
  })

  it('keeps Apps marked while an app is open over Apps, not Workflows', async () => {
    const wrapper = mount(AppSidebar, {
      props: { activePage: 'apps', appInProgress: CHARACTER_SWAP }
    })
    await flushPromises()

    expect(wrapper.findAll('[aria-current="page"]').map((row) => row.text())).toEqual(['Apps'])
    expect(wrapper.find('[data-testid="app-sidebar-app-in-progress"]').exists()).toBe(false)
  })

  it('shows no Development row unless the staff list is shown', async () => {
    const wrapper = await mountSidebar('home')

    expect(wrapper.find('[data-testid="app-sidebar-staff-apps"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Development')
  })

  it('lists Development after Assets for staff, marks it current and opens it from its row', async () => {
    const wrapper = mount(AppSidebar, { props: { activePage: 'staff-apps', showStaffApps: true } })
    await flushPromises()

    expect(wrapper.findAll('nav button').map((row) => row.text())).toEqual([
      'Home',
      'Workflows',
      'Apps',
      'Assets',
      'Development',
      'Builds',
      ''
    ])
    expect(wrapper.findAll('[aria-current="page"]').map((row) => row.text())).toEqual([
      'Development'
    ])

    await wrapper.get('[data-testid="app-sidebar-staff-apps"]').trigger('click')

    expect(navigatePanel).toHaveBeenCalledExactlyOnceWith('staff-apps')
    expect(wrapper.emitted('navigate')).toEqual([['staff-apps']])
  })

  it('names the app left open under Apps, and opens Apps on it', async () => {
    const wrapper = mount(AppSidebar, {
      props: { activePage: 'home', appInProgress: CHARACTER_SWAP }
    })
    await flushPromises()

    expect(wrapper.findAll('nav button').map((row) => row.text())).toEqual([
      'Home',
      'Workflows',
      'Apps',
      'Character Swap',
      'Assets',
      'Builds',
      ''
    ])
    const row = wrapper.get('[data-testid="app-sidebar-app-in-progress"]')
    expect(row.attributes('aria-label')).toBe('Back to Character Swap')
    expect(row.attributes('aria-current')).toBeUndefined()

    await row.trigger('click')

    expect(wrapper.emitted('open-app')).toEqual([[CHARACTER_SWAP]])
    expect(wrapper.emitted('navigate')).toBeUndefined()
    expect(navigatePanel).toHaveBeenCalledExactlyOnceWith('apps')
  })

  it('names an app left open from Development under Development, not Apps', async () => {
    const wrapper = mount(AppSidebar, {
      props: {
        activePage: 'home',
        appInProgress: CHARACTER_SWAP,
        appHome: 'staff-apps',
        showStaffApps: true
      }
    })
    await flushPromises()

    expect(wrapper.findAll('nav button').map((row) => row.text())).toEqual([
      'Home',
      'Workflows',
      'Apps',
      'Assets',
      'Development',
      'Character Swap',
      'Builds',
      ''
    ])
  })

  it('leaves out the row for an app left open from Development while Development is shown', async () => {
    const wrapper = mount(AppSidebar, {
      props: {
        activePage: 'staff-apps',
        appInProgress: CHARACTER_SWAP,
        appHome: 'staff-apps',
        showStaffApps: true
      }
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="app-sidebar-app-in-progress"]').exists()).toBe(false)
  })

  it('marks Development on the rail while an app opened from Development is open', async () => {
    const wrapper = mount(AppSidebar, {
      props: {
        activePage: 'staff-apps',
        makeRoom: true,
        appInProgress: CHARACTER_SWAP,
        appHome: 'staff-apps',
        showStaffApps: true
      }
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="app-sidebar"]').attributes('data-collapsed')).toBe('true')
    expect(wrapper.get('[data-testid="app-sidebar-staff-apps"]').attributes('aria-current')).toBe(
      'page'
    )
    expect(
      wrapper.get('[data-testid="app-sidebar-apps"]').attributes('aria-current')
    ).toBeUndefined()
  })

  it('leaves out the row for the app left open while Apps itself is shown', async () => {
    const wrapper = mount(AppSidebar, {
      props: { activePage: 'apps', appInProgress: CHARACTER_SWAP }
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="app-sidebar-app-in-progress"]').exists()).toBe(false)
  })

  it('names the app left open in the tooltip of its row on the folded rail', async () => {
    const wrapper = mount(AppSidebar, {
      props: { activePage: 'assets', appInProgress: CHARACTER_SWAP }
    })
    await flushPromises()
    expect(tooltipOf(wrapper, 'app-sidebar-app-in-progress')).toBeUndefined()

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="app-sidebar-app-in-progress"]').text()).toBe('')
    expect(tooltipOf(wrapper, 'app-sidebar-app-in-progress')).toBe('Back to Character Swap')
  })

  it('shows no app row with no app left open', async () => {
    const none = await mountSidebar('home')
    expect(none.find('[data-testid="app-sidebar-app-in-progress"]').exists()).toBe(false)
  })

  it('folds to the rail while an app is open, lets the toggle reopen it, and keeps the saved choice', async () => {
    const wrapper = await mountSidebar('apps')
    const sidebar = wrapper.get('[data-testid="app-sidebar"]')
    expect(sidebar.attributes('data-collapsed')).toBe('false')

    await wrapper.setProps({ makeRoom: true, appInProgress: CHARACTER_SWAP })
    expect(sidebar.attributes('data-collapsed')).toBe('true')

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
    expect(sidebar.attributes('data-collapsed')).toBe('false')

    await wrapper.setProps({ makeRoom: false, appInProgress: null })
    expect(sidebar.attributes('data-collapsed')).toBe('false')
    expect(window.localStorage.getItem('comfy.desktop.sidebar.collapsed')).not.toBe('true')

    await wrapper.setProps({ makeRoom: true, appInProgress: CHARACTER_SWAP })
    expect(sidebar.attributes('data-collapsed')).toBe('true')
  })

  it('keeps the Desktop menu on the rail while an app is open', async () => {
    const wrapper = mount(AppSidebar, {
      props: { activePage: 'apps', makeRoom: true, appInProgress: CHARACTER_SWAP }
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="app-sidebar"]').attributes('data-collapsed')).toBe('true')
    expect(wrapper.find('[data-testid="app-sidebar-header"]').exists()).toBe(true)
    for (const page of ['home', 'apps', 'assets', 'chooser']) {
      expect(wrapper.find(`nav [data-testid="app-sidebar-${page}"]`).exists()).toBe(true)
    }
    expect(wrapper.find('[data-testid="app-sidebar-settings"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="app-sidebar-app-character-swap"]').exists()).toBe(false)
  })

  it('marks the sidebar as in use while the keyboard is in it, but not for a mouse click', async () => {
    const wrapper = mount(AppSidebar, {
      props: { activePage: 'apps', makeRoom: true, appInProgress: CHARACTER_SWAP },
      attachTo: document.body
    })
    await flushPromises()

    await userEvent.click(wrapper.get('[data-testid="app-sidebar-home"]').element)
    expect(sidebarFocused.value).toBe(false)

    await userEvent.keyboard('{Tab}')
    expect(
      wrapper.get('[data-testid="app-sidebar"]').element.contains(document.activeElement)
    ).toBe(true)
    expect(sidebarFocused.value).toBe(true)

    ;(document.activeElement as HTMLElement).blur()
    await flushPromises()
    expect(sidebarFocused.value).toBe(false)
    wrapper.unmount()
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

  it('returns Home from the Comfy wordmark, which shows no tooltip', async () => {
    const wrapper = await mountSidebar('benchmarks')

    const logo = wrapper.get('button[aria-label="Home"]')
    expect(logo.element.closest('nav')).toBeNull()
    expect(logo.findComponent(Tooltip).exists()).toBe(false)
    await logo.trigger('click')

    expect(navigatePanel).toHaveBeenCalledExactlyOnceWith('home')
  })

  it('opens Desktop Settings above the account section without changing pages', async () => {
    const wrapper = await mountSidebar('assets')
    const settings = wrapper.get('[data-testid="app-sidebar-settings"]')

    expect(settings.text()).toBe('Desktop settings')
    expect(settings.attributes('aria-haspopup')).toBe('dialog')
    expect(settings.element.closest('nav')).toBeNull()
    expect(
      settings.element
        .closest('.tooltip-wrap')
        ?.nextElementSibling?.classList.contains('sidebar-account')
    ).toBe(true)

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
    expect(settings.attributes('aria-label')).toBe('Desktop settings')
    expect(tooltipOf(wrapper, 'app-sidebar-settings')).toBe('Desktop settings')

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

  it('folds to the Comfy mark on the same top row, which turns into the expand button on hover or keyboard focus', async () => {
    useInstallationStore().installations = []
    const wrapper = mount(AppSidebar, { props: { activePage: 'home' }, attachTo: document.body })
    await flushPromises()
    const sidebar = wrapper.get('[data-testid="app-sidebar"]').element
    const toggle = () => wrapper.get('[data-testid="app-sidebar-toggle"]').element
    const offsetFromTop = (el: Element) =>
      el.getBoundingClientRect().top - sidebar.getBoundingClientRect().top
    const homeRowTop = () => offsetFromTop(wrapper.get('[data-testid="app-sidebar-home"]').element)

    const expandedToggleTop = offsetFromTop(toggle())
    const expandedHomeRowTop = homeRowTop()
    expect(
      wrapper.find('[data-testid="app-sidebar-header"] button[aria-label="Home"]').exists()
    ).toBe(true)

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
    await flushPromises()

    expect(sidebar.getAttribute('data-collapsed')).toBe('true')
    expect(offsetFromTop(toggle()), 'toggle top').toBe(expandedToggleTop)
    expect(homeRowTop(), 'first row top').toBe(expandedHomeRowTop)
    expect(
      wrapper
        .get('[data-testid="app-sidebar-header"]')
        .findAll('button')
        .filter((button) => button.isVisible())
    ).toHaveLength(1)
    expect(toggle().getAttribute('aria-label')).toBe('Expand sidebar')

    const faceOpacity = (face: 'logo' | 'expand') =>
      getComputedStyle(wrapper.get(`[data-testid="app-sidebar-${face}-face"]`).element).opacity
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 260))
    }
    expect([faceOpacity('logo'), faceOpacity('expand')], 'at rest').toEqual(['1', '0'])

    await userEvent.hover(toggle())
    await settle()
    expect([faceOpacity('logo'), faceOpacity('expand')], 'on hover').toEqual(['0', '1'])

    await userEvent.unhover(toggle())
    await settle()
    expect([faceOpacity('logo'), faceOpacity('expand')], 'after hover').toEqual(['1', '0'])

    ;(toggle() as HTMLElement).focus()
    await settle()
    expect([faceOpacity('logo'), faceOpacity('expand')], 'on keyboard focus').toEqual(['0', '1'])

    await userEvent.click(toggle())
    await flushPromises()
    expect(sidebar.getAttribute('data-collapsed')).toBe('false')
    await userEvent.unhover(sidebar)
    wrapper.unmount()
  })

  it('keeps every row icon at the same left edge when the sidebar folds, so only the labels go', async () => {
    useInstallationStore().installations = []
    const wrapper = mount(AppSidebar, { props: { activePage: 'home' }, attachTo: document.body })
    await flushPromises()
    const sidebarLeft = () =>
      wrapper.get('[data-testid="app-sidebar"]').element.getBoundingClientRect().left
    const iconLeft = (testId: string) =>
      wrapper.get(`[data-testid="${testId}"] svg`).element.getBoundingClientRect().left -
      sidebarLeft()
    const rows = ['app-sidebar-home', 'app-sidebar-assets', 'app-sidebar-settings']
    const expanded = rows.map(iconLeft)
    const signInCardWidth = () =>
      wrapper
        .get('[data-testid="sidebar-signin-card"] .group\\/signin')
        .element.getBoundingClientRect().width
    expect(signInCardWidth(), 'log-in card width when open').toBe(220)

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
    await flushPromises()

    expect(rows.map(iconLeft)).toEqual(expanded)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(rows.map(iconLeft), 'after the width settles').toEqual(expanded)
    expect(signInCardWidth(), 'log-in card width when folded').toBe(220)
    const rail = wrapper.get('[data-testid="app-sidebar"]').element.getBoundingClientRect().width
    const homeIcon = wrapper.get('[data-testid="app-sidebar-home"] svg').element
    const iconCentre = iconLeft('app-sidebar-home') + homeIcon.getBoundingClientRect().width / 2
    expect(Math.abs(iconCentre - rail / 2), 'icon centred in the rail').toBeLessThanOrEqual(1)
    wrapper.unmount()
  })

  it('keeps a tooltip on the icon-only buttons but none on the fold toggle, whose icon says it', async () => {
    const wrapper = await mountSidebar()
    expect(wrapper.get('[data-testid="app-sidebar-toggle"]').findComponent(Tooltip).exists()).toBe(
      false
    )
    expect(tooltipOf(wrapper, 'app-sidebar-new-build')).toBe('New build')

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')

    expect(wrapper.get('[data-testid="app-sidebar-toggle"]').findComponent(Tooltip).exists()).toBe(
      false
    )
    expect(wrapper.findAllComponents(Tooltip).every((tip) => tip.props('side') === 'right')).toBe(
      true
    )
    expect(
      wrapper.findAll('[title]').filter((el) => !el.element.closest('.sidebar-account'))
    ).toHaveLength(0)
  })

  it('keeps keyboard focus on the toggle when Enter folds and unfolds the sidebar', async () => {
    useInstallationStore().installations = []
    const wrapper = mount(AppSidebar, { props: { activePage: 'home' }, attachTo: document.body })
    await flushPromises()
    const toggle = () => wrapper.get('[data-testid="app-sidebar-toggle"]').element as HTMLElement

    toggle().focus()
    await userEvent.keyboard('{Enter}')
    await flushPromises()
    expect(document.activeElement, 'focus after folding').toBe(toggle())
    expect(toggle().getAttribute('aria-label')).toBe('Expand sidebar')

    await userEvent.keyboard('{Enter}')
    await flushPromises()
    expect(document.activeElement, 'focus after unfolding').toBe(toggle())
    expect(toggle().getAttribute('aria-label')).toBe('Collapse sidebar')
    wrapper.unmount()
  })

  it('leaves a 4px gap between rows so two filled rows never touch', async () => {
    useInstallationStore().installations = []
    const wrapper = mount(AppSidebar, { props: { activePage: 'home' }, attachTo: document.body })
    await flushPromises()

    const home = wrapper.get('[data-testid="app-sidebar-home"]').element.getBoundingClientRect()
    const workflows = wrapper
      .get('[data-testid="app-sidebar-workflows"]')
      .element.getBoundingClientRect()
    expect(workflows.top - home.bottom).toBe(4)
    wrapper.unmount()
  })

  it('turns every folded row into a square centred in the rail without moving its icon', async () => {
    useInstallationStore().installations = []
    const wrapper = mount(AppSidebar, { props: { activePage: 'home' }, attachTo: document.body })
    await flushPromises()
    const sidebar = wrapper.get('[data-testid="app-sidebar"]').element
    const iconSpot = (testId: string) => {
      const icon = wrapper.get(`[data-testid="${testId}"] svg`).element.getBoundingClientRect()
      return [icon.left - sidebar.getBoundingClientRect().left, icon.top]
    }
    const openSpots = ['app-sidebar-home', 'app-sidebar-assets'].map(iconSpot)

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(['app-sidebar-home', 'app-sidebar-assets'].map(iconSpot)).toEqual(openSpots)
    const rail = sidebar.getBoundingClientRect()
    for (const testId of ['app-sidebar-home', 'app-sidebar-assets', 'app-sidebar-settings']) {
      const row = wrapper.get(`[data-testid="${testId}"]`).element.getBoundingClientRect()
      expect([row.width, row.height], testId).toEqual([32, 32])
      expect(row.left + row.width / 2 - rail.left, testId).toBe(rail.width / 2)
    }
    wrapper.unmount()
  })

  it('gives a folded row its tooltip over the whole row, not only the icon', async () => {
    window.localStorage.setItem('comfy.desktop.sidebar.collapsed', 'true')
    useInstallationStore().installations = []
    const wrapper = mount(AppSidebar, { props: { activePage: 'home' }, attachTo: document.body })
    await flushPromises()

    for (const testId of ['app-sidebar-home', 'app-sidebar-settings']) {
      const row = wrapper.get(`[data-testid="${testId}"]`).element.getBoundingClientRect()
      const trigger = wrapper
        .get(`[data-testid="${testId}"]`)
        .element.closest('.tooltip-wrap')!
        .getBoundingClientRect()
      expect([trigger.width, trigger.height], testId).toEqual([row.width, row.height])
    }
    wrapper.unmount()
  })

  it('shows the tooltip of a folded row when Tab moves onto it while an app is open', async () => {
    const wrapper = mount(AppSidebar, {
      props: { activePage: 'apps', makeRoom: true, appInProgress: CHARACTER_SWAP },
      attachTo: document.body
    })
    await flushPromises()
    const shownTooltips = (): string[] =>
      Array.from(document.querySelectorAll('[role="tooltip"]'), (el) => el.textContent ?? '')

    wrapper.get<HTMLElement>('[data-testid="app-sidebar-toggle"]').element.focus()
    const tooltipsOnTheWay: string[][] = []
    for (const testId of ['app-sidebar-home', 'app-sidebar-workflows', 'app-sidebar-apps']) {
      await userEvent.keyboard('{Tab}')
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(wrapper.get(`[data-testid="${testId}"]`).element)
      )
      await vi.waitFor(() => expect(shownTooltips()).not.toHaveLength(0))
      tooltipsOnTheWay.push(shownTooltips())
    }
    expect(tooltipsOnTheWay).toEqual([['Home'], ['Workflows'], ['Apps']])
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
      .get('[data-testid="app-sidebar-home"]')
      .element.closest('.tooltip-wrap')!
      .dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true }))
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
    expect(
      settings.element.closest('.tooltip-wrap')?.nextElementSibling?.contains(credits.element)
    ).toBe(true)
    expect(credits.element.parentElement?.nextElementSibling?.classList).toContain(
      'sidebar-account'
    )
  })

  it('keeps the credits coin and the workspace avatar in place when the signed-in sidebar folds', async () => {
    refreshCreditBalance.mockResolvedValue({ status: 'ready', cents: 100 })
    ;(
      window.api as unknown as { comfybuilder: { getAuthStatus: ReturnType<typeof vi.fn> } }
    ).comfybuilder.getAuthStatus = vi.fn().mockResolvedValue({
      signedIn: true,
      email: 'someone@comfy.org',
      workspaceId: 'w1',
      workspaceName: 'Silverside',
      workspaceType: 'team'
    })
    useInstallationStore().installations = []
    const wrapper = mount(AppSidebar, { props: { activePage: 'home' }, attachTo: document.body })
    await flushPromises()
    const sidebar = wrapper.get('[data-testid="app-sidebar"]').element
    const leftOf = (selector: string) =>
      wrapper.get(selector).element.getBoundingClientRect().left -
      sidebar.getBoundingClientRect().left
    const coin = '[data-testid="app-sidebar-credits"] svg'
    const avatar = '[data-testid="workspace-switcher-trigger"] > :first-child'
    const creditsHeight = () =>
      wrapper.get('[data-testid="app-sidebar-credits"]').element.getBoundingClientRect().height
    const open = [leftOf(coin), leftOf(avatar)]
    expect(creditsHeight(), 'credits row open').toBe(32)

    await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect([leftOf(coin), leftOf(avatar)], 'coin and avatar folded').toEqual(open)
    expect(creditsHeight(), 'credits row folded').toBe(44)
    const short = wrapper.get('[data-testid="app-sidebar-credits-short"]').element
    expect(short.textContent?.trim()).toBe('211')
    expect(getComputedStyle(short).opacity, 'short count visible').toBe('1')
    const shortBox = short.getBoundingClientRect()
    const creditsBox = wrapper
      .get('[data-testid="app-sidebar-credits"]')
      .element.getBoundingClientRect()
    expect(
      shortBox.left >= creditsBox.left &&
        shortBox.right <= creditsBox.right &&
        shortBox.top >= creditsBox.top &&
        shortBox.bottom <= creditsBox.bottom,
      'short count fits inside the folded credits button'
    ).toBe(true)
    wrapper.unmount()
  })

  describe('Builds group', () => {
    function buildNames(wrapper: Awaited<ReturnType<typeof mountSidebar>>): string[] {
      return wrapper.findAll('[data-testid^="app-sidebar-build-"]').map((row) => row.text())
    }

    function newBuildShown(wrapper: Awaited<ReturnType<typeof mountSidebar>>): boolean {
      return wrapper.get('[data-testid="app-sidebar-new-build"]').classes('opacity-100')
    }

    it('makes Builds a row like Home, marked when the Builds page is open', async () => {
      const wrapper = await mountSidebar('chooser', [OLD])

      const builds = wrapper.get('[data-testid="app-sidebar-chooser"]')
      expect(builds.text()).toBe('Builds')
      expect(builds.find('svg').exists(), 'Builds has an icon like the other rows').toBe(true)
      expect(builds.attributes('aria-current')).toBe('page')
      expect([...builds.element.parentElement!.classList]).toEqual(
        expect.arrayContaining(['bg-accent', 'text-foreground'])
      )
      expect(builds.element.parentElement!.classList).not.toContain('text-muted-foreground')
    })

    it('keeps New build out of sight until the Builds row is pointed at', async () => {
      const wrapper = await mountSidebar('home', [OLD])

      expect(newBuildShown(wrapper)).toBe(false)
      expect(wrapper.get('[data-testid="app-sidebar-new-build"]').classes()).toContain(
        'group-hover/builds:opacity-100'
      )
    })

    it('shows New build on the Builds page', async () => {
      const wrapper = await mountSidebar('chooser', [OLD])

      expect(newBuildShown(wrapper)).toBe(true)
    })

    it('shows New build while the Home tour runs, so its step can point at it', async () => {
      ;(window.api as unknown as { getSetting: ReturnType<typeof vi.fn> }).getSetting = vi.fn(
        async (key: string) => (key === 'homeTourAudience' ? 'new' : false)
      )
      const wrapper = await mountSidebar('home', [OLD])

      expect(newBuildShown(wrapper)).toBe(true)
    })

    it('shows a build name on hover only when it is cut off', async () => {
      const long = build({ id: 'long', name: 'A build with a name far too long to fit the row' })
      const wrapper = await mountSidebar('home', [OLD, long])
      document.body.appendChild(wrapper.element)

      const opens = (id: string) =>
        (
          wrapper
            .get(`[data-testid="app-sidebar-build-${id}"]`)
            .findComponent(Tooltip)
            .props('shouldOpen') as () => boolean
        )()
      expect(opens('old')).toBe(false)
      expect(opens('long')).toBe(true)
      wrapper.unmount()
    })

    it('still says on hover why a build failed, even when its name fits', async () => {
      useSessionStore().errorInstances.set(OLD.id, {
        installationName: OLD.name,
        message: 'Port 8188 is in use',
        startFailed: true
      })
      const wrapper = await mountSidebar('home', [OLD])

      const tooltip = wrapper.get('[data-testid="app-sidebar-build-old"]').findComponent(Tooltip)
      expect((tooltip.props('shouldOpen') as () => boolean)()).toBe(true)
    })

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

    it('puts the green dot on every open build, Comfy Cloud too, even with no ComfyUI window open', async () => {
      expect(useSessionStore().activeSessions.size).toBe(0)
      useSessionStore().runningInstances.set(NEW.id, {
        installationId: NEW.id,
        installationName: NEW.name,
        mode: 'window'
      })
      useSessionStore().runningInstances.set(CLOUD.id, {
        installationId: CLOUD.id,
        installationName: CLOUD.name,
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

    it('marks a starting build with a pulsing amber dot the size and place of the green dot, which turns green once it runs', async () => {
      useSessionStore().launchingInstances.set(NEW.id, { installationName: NEW.name })
      useInstallationStore().installations = [OLD, NEW]
      const wrapper = mount(AppSidebar, {
        props: { activePage: 'home', activeBuildId: null },
        attachTo: document.body
      })
      await flushPromises()
      const row = () => wrapper.get(`[data-testid="app-sidebar-build-${NEW.id}"]`)
      const startingDot = () => row().find('[data-testid="app-sidebar-dot-starting"]')
      const liveDot = () => row().find('[data-testid="app-sidebar-dot-live"]')

      expect(startingDot().exists()).toBe(true)
      const startingElement = startingDot().element as HTMLElement
      const startingBox = startingElement.getBoundingClientRect()
      const startingStyle = getComputedStyle(startingElement)
      const startingCutOut = startingStyle.boxShadow
      expect(startingStyle.backgroundColor).toBe('rgb(245, 158, 11)')
      expect(startingStyle.animationName).toBe('status-starting')
      expect(startingStyle.animationDuration).toBe('1.2s')
      expect(row().findAll('svg').length).toBe(1)
      expect(row().find('.animate-spin').exists()).toBe(false)
      expect(row().text()).toBe(`${NEW.name}· Starting…`)
      expect(row().get('[role="status"]').classes()).toContain('sr-only')
      expect(liveDot().exists()).toBe(false)
      expect(
        wrapper
          .get(`[data-testid="app-sidebar-build-${OLD.id}"]`)
          .find('[data-testid="app-sidebar-dot-starting"]')
          .exists()
      ).toBe(false)

      await cdp().send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      })
      expect(getComputedStyle(startingElement).animationName).toBe('none')
      expect(getComputedStyle(startingElement).opacity).toBe('1')
      await cdp().send('Emulation.setEmulatedMedia', { features: [] })

      useSessionStore().launchingInstances.delete(NEW.id)
      useSessionStore().runningInstances.set(NEW.id, {
        installationId: NEW.id,
        installationName: NEW.name,
        mode: 'console'
      })
      await flushPromises()

      expect(startingDot().exists()).toBe(false)
      expect(liveDot().exists()).toBe(true)
      const liveBox = liveDot().element.getBoundingClientRect()
      expect([startingBox.left, startingBox.top, startingBox.width, startingBox.height]).toEqual([
        liveBox.left,
        liveBox.top,
        liveBox.width,
        liveBox.height
      ])
      expect(getComputedStyle(liveDot().element).boxShadow).toBe(startingCutOut)
      expect(getComputedStyle(liveDot().element).animationName).toBe('none')
      expect(row().text()).toBe(NEW.name)
      wrapper.unmount()
    })

    it('shows a build started from Desktop the same way, not as a big spinner in place of its icon', async () => {
      const wrapper = await mountSidebar('home', [OLD, NEW])
      useProgressStore().operations.set(NEW.id, {
        opKind: 'launch',
        flatPercent: -1,
        finished: false,
        cancelRequested: false,
        _globalFloor: 0
      } as Operation)
      await flushPromises()
      const row = wrapper.get(`[data-testid="app-sidebar-build-${NEW.id}"]`)

      expect(row.find('[data-testid="app-sidebar-dot-starting"]').exists()).toBe(true)
      expect(row.find('[data-testid="app-sidebar-build-installing"]').exists()).toBe(false)
      expect(row.findAll('svg').length).toBe(1)
      expect(row.find('.animate-spin').exists()).toBe(false)
    })

    it('puts the same pulsing amber dot on the Builds icon in the collapsed sidebar while a build starts', async () => {
      window.localStorage.setItem('comfy.desktop.sidebar.collapsed', 'true')
      useSessionStore().launchingInstances.set(NEW.id, { installationName: NEW.name })
      const wrapper = await mountSidebar('home', [OLD, NEW])
      const rail = () => wrapper.get('[data-testid="app-sidebar-chooser"]')
      const railDot = () => rail().find('[data-testid="app-sidebar-rail-starting"]')

      expect(wrapper.get('[data-testid="app-sidebar"]').attributes('data-collapsed')).toBe('true')
      expect(railDot().exists()).toBe(true)
      expect(railDot().classes()).toEqual(
        expect.arrayContaining([
          'absolute',
          '-right-0.5',
          '-bottom-0.5',
          'size-2',
          'rounded-full',
          'ring-2',
          'bg-status-starting',
          'animate-status-starting',
          'motion-reduce:animate-none'
        ])
      )
      expect(rail().findAll('svg').length).toBe(1)
      expect(wrapper.find('.animate-spin').exists()).toBe(false)

      useSessionStore().launchingInstances.delete(NEW.id)
      useSessionStore().runningInstances.set(NEW.id, {
        installationId: NEW.id,
        installationName: NEW.name,
        mode: 'console'
      })
      await flushPromises()

      expect(railDot().exists()).toBe(false)
      expect(rail().findAll('svg').length).toBe(1)
    })

    it('marks a build that failed to start and says why on hover', async () => {
      useSessionStore().errorInstances.set(OLD.id, {
        installationName: OLD.name,
        message: 'Port 8188 is in use',
        startFailed: true
      })
      const wrapper = await mountSidebar('home', [OLD])

      const row = wrapper.get('[data-testid="app-sidebar-build-old"]')
      expect(row.find('[data-testid="app-sidebar-dot-failed"]').exists()).toBe(true)
      expect(tooltipOf(wrapper, 'app-sidebar-build-old')).toBe(
        "Flux Sandbox · Didn't start: Port 8188 is in use"
      )
      expect(row.get('.sr-only').text()).toBe("· Didn't start: Port 8188 is in use")
    })

    it("says Didn't start, not Crashed, for a failed start with an exit code and no reason", async () => {
      useSessionStore().errorInstances.set(OLD.id, {
        installationName: OLD.name,
        exitCode: 1,
        startFailed: true
      })
      const wrapper = await mountSidebar('home', [OLD])

      expect(tooltipOf(wrapper, 'app-sidebar-build-old')).toBe("Flux Sandbox · Didn't start")
    })

    it('does not say a build failed to start when only its update failed', async () => {
      useSessionStore().errorInstances.set(OLD.id, {
        installationName: OLD.name,
        message: 'Could not install the new dependencies'
      })
      const wrapper = await mountSidebar('home', [OLD])

      expect(tooltipOf(wrapper, 'app-sidebar-build-old')).toBe(
        'Flux Sandbox · Error: Could not install the new dependencies'
      )
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

    it('unmounts the build rows once the rail has folded, and brings them back on unfold', async () => {
      useInstallationStore().installations = [OLD]
      const wrapper = mount(AppSidebar, { props: { activePage: 'home' }, attachTo: document.body })
      await flushPromises()
      expect(buildNames(wrapper)).toEqual(['Flux Sandbox'])

      await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
      await flushPromises()
      expect(buildNames(wrapper), 'kept during the fold').toEqual(['Flux Sandbox'])
      await new Promise((resolve) => setTimeout(resolve, 350))
      expect(buildNames(wrapper), 'gone once folded').toEqual([])

      await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
      await flushPromises()
      expect(buildNames(wrapper), 'back on unfold').toEqual(['Flux Sandbox'])
      wrapper.unmount()
    })

    it('keeps the build rows when the sidebar reopens before the fold ends', async () => {
      useInstallationStore().installations = [OLD]
      const wrapper = mount(AppSidebar, { props: { activePage: 'home' }, attachTo: document.body })
      await flushPromises()

      await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
      await new Promise((resolve) => setTimeout(resolve, 80))
      await wrapper.get('[data-testid="app-sidebar-toggle"]').trigger('click')
      await new Promise((resolve) => setTimeout(resolve, 450))

      expect(buildNames(wrapper)).toEqual(['Flux Sandbox'])
      wrapper.unmount()
    })

    it('does not mount the build rows when the sidebar starts folded', async () => {
      window.localStorage.setItem('comfy.desktop.sidebar.collapsed', 'true')
      const wrapper = await mountSidebar('home', [OLD])

      expect(buildNames(wrapper)).toEqual([])
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
      expect(wrapper.findAll('[data-testid="app-sidebar-chooser"]')).toHaveLength(1)
      expect(wrapper.find('nav [inert]').exists(), 'folded Builds list is out of reach').toBe(true)
      const builds = wrapper.get('[data-testid="app-sidebar-chooser"]')
      expect(tooltipOf(wrapper, 'app-sidebar-chooser')).toBe('Builds')
      expect(builds.attributes('aria-current')).toBe('page')
    })
  })

  describe('Create', () => {
    function buildOptions(): HTMLElement[] {
      return [...document.querySelectorAll<HTMLElement>('[data-testid="home-open-build-option"]')]
    }

    it('sits above the nav as a full-width Create button, outside the page list', async () => {
      const wrapper = await mountSidebar('home', [OLD, NEW])

      const create = wrapper.get('[data-testid="sidebar-create"]')
      expect(create.text()).toBe('Create')
      expect(create.attributes('aria-label')).toBe('Create')
      expect(create.attributes('aria-current')).toBeUndefined()
      expect(create.element.closest('nav')).toBeNull()
      expect(
        create.element.compareDocumentPosition(wrapper.get('nav').element) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(create.find('svg').exists()).toBe(true)
      expect(wrapper.get('nav button').attributes('data-testid')).toBe('app-sidebar-home')
      expect(wrapper.findAll('[aria-current="page"]').map((row) => row.text())).toEqual(['Home'])
    })

    it('fills the width of the open sidebar in the inverted fill, rounded like a control', async () => {
      const wrapper = mount(AppSidebar, {
        props: { activePage: 'home', activeBuildId: null },
        attachTo: document.body
      })
      useInstallationStore().installations = [NEW]
      await flushPromises()

      const create = wrapper.get('[data-testid="sidebar-create"]').element
      const home = wrapper.get('[data-testid="app-sidebar-home"]').element
      expect(create.getBoundingClientRect().width).toBe(home.getBoundingClientRect().width)
      expect(create.getBoundingClientRect().height).toBe(32)
      expect(create.classList).toContain('bg-foreground')
      expect(create.classList).toContain('rounded-control')
      wrapper.unmount()
    })

    it('puts Create on the left when the chevron sits beside it, and centres it alone', async () => {
      const alone = mount(AppSidebar, {
        props: { activePage: 'home', activeBuildId: null },
        attachTo: document.body
      })
      useInstallationStore().installations = [NEW]
      await flushPromises()
      expect(
        getComputedStyle(alone.get('[data-testid="sidebar-create"]').element).justifyContent
      ).toBe('center')
      alone.unmount()

      const withMenu = mount(AppSidebar, {
        props: { activePage: 'home', activeBuildId: null },
        attachTo: document.body
      })
      useInstallationStore().installations = [OLD, NEW]
      await flushPromises()
      expect(withMenu.find('[data-testid="sidebar-create-menu"]').exists()).toBe(true)
      expect(
        getComputedStyle(withMenu.get('[data-testid="sidebar-create"]').element).justifyContent
      ).toBe('flow-start')
      withMenu.unmount()
    })

    it('opens the build Open ComfyUI opens: the most recently used one', async () => {
      const wrapper = await mountSidebar('apps', [OLD, NEW])

      expect(wrapper.get('[data-testid="sidebar-create"]').attributes('aria-description')).toBe(
        'Opens in Video Lab'
      )
      await wrapper.get('[data-testid="sidebar-create"]').trigger('click')

      expect(wrapper.emitted('create')).toEqual([[NEW]])
      expect(wrapper.emitted('navigate')).toBeUndefined()
      expect(navigatePanel).not.toHaveBeenCalled()
    })

    it('leaves Create out while there is no build to open', async () => {
      const wrapper = await mountSidebar('home', [])

      expect(wrapper.find('[data-testid="sidebar-create"]').exists()).toBe(false)
    })

    it('opens the Open ComfyUI build menu from its chevron, opens the build picked, and keeps it for the next Create', async () => {
      const wrapper = await mountSidebar('home', [OLD, NEW], null)
      const chevron = wrapper.get('[data-testid="sidebar-create-menu"]')
      expect(chevron.attributes('aria-haspopup')).toBe('menu')
      expect(chevron.attributes('aria-expanded')).toBe('false')
      expect(chevron.attributes('aria-label')).toBe('Choose the build to open')

      await chevron.trigger('keydown', { key: 'ArrowDown' })
      await flushPromises()

      expect(chevron.attributes('aria-expanded')).toBe('true')
      expect(buildOptions().map((option) => option.textContent?.trim())).toEqual([
        'Video Lab',
        'Flux Sandbox'
      ])
      buildOptions()[1]!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      )
      await flushPromises()

      expect(wrapper.emitted('create')).toEqual([[OLD]])
      expect(wrapper.get('[data-testid="sidebar-create"]').attributes('aria-description')).toBe(
        'Opens in Flux Sandbox'
      )
      await wrapper.get('[data-testid="sidebar-create"]').trigger('click')
      expect(wrapper.emitted('create')).toEqual([[OLD], [OLD]])
    })

    async function openCreateMenu(wrapper: Awaited<ReturnType<typeof mountSidebar>>) {
      await wrapper
        .get('[data-testid="sidebar-create-menu"]')
        .trigger('keydown', { key: 'ArrowDown' })
      await flushPromises()
    }

    function running(build: Installation): void {
      useSessionStore().runningInstances.set(build.id, {
        installationId: build.id,
        installationName: build.name,
        mode: 'window'
      })
    }

    it('opens the latest build of the workspace picked in the sidebar', async () => {
      const wrapper = await mountSidebar('home', [OLD, NEW, TEAM])

      useDashboardScopeStore().selectedWorkspaceId = 'ws-team'
      await flushPromises()
      await wrapper.get('[data-testid="sidebar-create"]').trigger('click')

      expect(wrapper.emitted('create')).toEqual([[TEAM]])
    })

    it('lists every build of the workspace in the menu, with a dot on each open build, Comfy Cloud too', async () => {
      const wrapper = await mountSidebar('home', [OLD, CLOUD, NEW])
      running(CLOUD)
      running(OLD)
      await openCreateMenu(wrapper)

      expect(buildOptions().map((option) => option.textContent?.trim())).toEqual([
        'Video Lab',
        'Comfy Cloud',
        'Flux Sandbox'
      ])
      expect(buildOptions().map((option) => option.getAttribute('aria-checked'))).toEqual([
        'true',
        'false',
        'false'
      ])
      expect(
        buildOptions().map(
          (option) =>
            option
              .querySelector('[data-testid="home-open-build-status-dot"]')
              ?.getAttribute('data-tone') ?? null
        )
      ).toEqual([null, 'live', 'live'])
    })

    it('marks a broken build red and keeps it from opening, with the reason on hover', async () => {
      const broken = build({
        id: 'broken',
        name: 'Broken Build',
        lastLaunchedAt: 50,
        statusTag: { style: 'danger', label: 'Install failed' }
      })
      const wrapper = await mountSidebar('home', [NEW, broken])
      await openCreateMenu(wrapper)

      const option = buildOptions()[1]!
      expect(
        option
          .querySelector('[data-testid="home-open-build-status-dot"]')
          ?.getAttribute('data-tone')
      ).toBe('danger')
      expect(option.hasAttribute('data-disabled')).toBe(true)

      option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await flushPromises()
      expect(wrapper.emitted('create')).toBeUndefined()

      option
        .closest('.tooltip-wrap')!
        .dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', buttons: 0 }))
      await vi.waitFor(() =>
        expect(document.querySelector('.tooltip-bubble')?.textContent).toContain('Install failed')
      )
    })

    it('marks a build that did not start red, and still opens it when picked', async () => {
      const wrapper = await mountSidebar('home', [OLD, NEW])
      useSessionStore().errorInstances.set(OLD.id, { installationName: OLD.name })
      await openCreateMenu(wrapper)

      const failed = buildOptions()[1]!
      expect(
        failed
          .querySelector('[data-testid="home-open-build-status-dot"]')
          ?.getAttribute('data-tone')
      ).toBe('danger')
      failed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await flushPromises()

      expect(wrapper.emitted('create')).toEqual([[OLD]])
    })

    it('fills the picked build in the menu, with no check mark', async () => {
      const wrapper = await mountSidebar('home', [OLD, CLOUD, NEW])
      await openCreateMenu(wrapper)
      buildOptions()[2]!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      )
      await flushPromises()

      await openCreateMenu(wrapper)

      expect(buildOptions().map((option) => option.getAttribute('aria-checked'))).toEqual([
        'false',
        'false',
        'true'
      ])
      expect(buildOptions()[2]!.className).toContain('data-[state=checked]:bg-muted')
      expect(document.querySelector('[data-testid="menu-radio-item-check"]')).toBeNull()
    })

    it('opens its build once it is ready when pressed while it starts, and only once', async () => {
      useSessionStore().launchingInstances.set(NEW.id, { installationName: NEW.name })
      const wrapper = await mountSidebar('home', [NEW])

      await wrapper.get('[data-testid="sidebar-create"]').trigger('click')
      await flushPromises()
      expect(wrapper.emitted('create')).toBeUndefined()

      useSessionStore().launchingInstances.delete(NEW.id)
      running(NEW)
      await flushPromises()
      expect(wrapper.emitted('create')).toEqual([[NEW]])

      useSessionStore().runningInstances.delete(NEW.id)
      useSessionStore().launchingInstances.set(NEW.id, { installationName: NEW.name })
      await flushPromises()
      useSessionStore().launchingInstances.delete(NEW.id)
      running(NEW)
      await flushPromises()
      expect(wrapper.emitted('create')).toHaveLength(1)
    })

    it('opens nothing when the start fails after it was pressed', async () => {
      useSessionStore().launchingInstances.set(NEW.id, { installationName: NEW.name })
      const wrapper = await mountSidebar('home', [NEW])

      await wrapper.get('[data-testid="sidebar-create"]').trigger('click')
      await flushPromises()
      useSessionStore().launchingInstances.delete(NEW.id)
      await flushPromises()
      running(NEW)
      await flushPromises()

      expect(wrapper.emitted('create')).toBeUndefined()
    })

    it.each([
      ['stops', 'stop'],
      ['updates', 'update']
    ] as const)(
      'leaves Create out while its only build %s, and brings it back after',
      async (_, action) => {
        const session = useSessionStore()
        if (action === 'stop') {
          running(NEW)
          session.stoppingInstances.add(NEW.id)
        } else {
          session.operationInstances.set(NEW.id, { actionId: 'update-comfyui' })
        }
        const wrapper = await mountSidebar('home', [NEW])
        expect(wrapper.find('[data-testid="sidebar-create"]').exists()).toBe(false)

        session.runningInstances.delete(NEW.id)
        session.stoppingInstances.delete(NEW.id)
        session.operationInstances.delete(NEW.id)
        await flushPromises()

        expect(wrapper.find('[data-testid="sidebar-create"]').exists()).toBe(true)
      }
    )

    it('offers no build menu with a single build', async () => {
      const wrapper = await mountSidebar('home', [NEW])

      expect(wrapper.find('[data-testid="sidebar-create"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="sidebar-create-menu"]').exists()).toBe(false)
    })

    it('on the folded rail, opens the build menu to the right from the square Plus button, and opens the build picked', async () => {
      window.localStorage.setItem('comfy.desktop.sidebar.collapsed', 'true')
      const wrapper = mount(AppSidebar, {
        props: { activePage: 'home', activeBuildId: null },
        attachTo: document.body
      })
      useInstallationStore().installations = [OLD, NEW]
      await flushPromises()
      const create = wrapper.get('[data-testid="sidebar-create"]')

      expect(create.text()).toBe('')
      expect(create.classes()).toContain('size-8')
      expect(wrapper.find('[data-testid="sidebar-create-menu"]').exists()).toBe(false)
      expect(tooltipOf(wrapper, 'sidebar-create')).toBe('Create')
      expect(create.attributes('aria-haspopup')).toBe('menu')
      expect(create.attributes('aria-expanded')).toBe('false')

      await userEvent.click(create.element)
      await flushPromises()

      expect(create.attributes('aria-expanded')).toBe('true')
      expect(tooltipOf(wrapper, 'sidebar-create')).toBeUndefined()
      expect(wrapper.emitted('create')).toBeUndefined()
      const menu = document.querySelector<HTMLElement>('[role="menu"]')!
      expect(menu.getBoundingClientRect().left).toBeGreaterThanOrEqual(
        create.element.getBoundingClientRect().right
      )
      expect(buildOptions().map((option) => option.textContent?.trim())).toEqual([
        'Video Lab',
        'Flux Sandbox'
      ])

      buildOptions()[1]!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      )
      await flushPromises()

      expect(wrapper.emitted('create')).toEqual([[OLD]])
      expect(create.attributes('aria-description')).toBe('Opens in Flux Sandbox')
      wrapper.unmount()
    })

    it('on the folded rail with one build, opens it straight from the square Plus button', async () => {
      window.localStorage.setItem('comfy.desktop.sidebar.collapsed', 'true')
      const wrapper = await mountSidebar('home', [NEW])
      const create = wrapper.get('[data-testid="sidebar-create"]')
      expect(create.attributes('aria-haspopup')).toBeUndefined()
      expect(tooltipOf(wrapper, 'sidebar-create')).toBe('Create')

      await create.trigger('click')

      expect(wrapper.emitted('create')).toEqual([[NEW]])
    })

    it('shows no hover tooltip on the open button, keeping where it opens for screen readers', async () => {
      const wrapper = await mountSidebar('home', [OLD, NEW])

      expect(tooltipOf(wrapper, 'sidebar-create')).toBeUndefined()
      expect(wrapper.get('[data-testid="sidebar-create"]').attributes('aria-description')).toBe(
        'Opens in Video Lab'
      )
    })

    it('opens a build picked while it starts once it is ready', async () => {
      useSessionStore().launchingInstances.set(OLD.id, { installationName: OLD.name })
      const wrapper = await mountSidebar('home', [OLD, NEW])
      await wrapper
        .get('[data-testid="sidebar-create-menu"]')
        .trigger('keydown', { key: 'ArrowDown' })
      await flushPromises()

      buildOptions()
        .find((option) => option.textContent?.trim() === OLD.name)!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await flushPromises()
      expect(wrapper.emitted('create')).toBeUndefined()

      useSessionStore().launchingInstances.delete(OLD.id)
      useSessionStore().runningInstances.set(OLD.id, {
        installationId: OLD.id,
        installationName: OLD.name,
        mode: 'console'
      })
      await flushPromises()

      expect(wrapper.emitted('create')).toEqual([[OLD]])
    })

    it('says it opens once ready, with a spinner, while its build starts', async () => {
      useSessionStore().launchingInstances.set(NEW.id, { installationName: NEW.name })
      const wrapper = await mountSidebar('home', [OLD, NEW])

      expect(wrapper.get('[data-testid="sidebar-create"]').attributes('aria-description')).toBe(
        "Starting… opens when it's ready"
      )
      expect(wrapper.find('[data-testid="sidebar-create-spinner"]').exists()).toBe(true)
    })
  })

  describe('page right-click menu', () => {
    const mounted: ReturnType<typeof mount>[] = []

    afterEach(() => {
      for (const wrapper of mounted.splice(0)) wrapper.unmount()
      document.body.innerHTML = ''
    })

    async function mountAttached(builds: Installation[] = []) {
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

    it('offers no new window for Development', async () => {
      useInstallationStore().installations = []
      const wrapper = mount(AppSidebar, {
        props: { activePage: 'home', showStaffApps: true },
        attachTo: document.body
      })
      mounted.push(wrapper)
      await flushPromises()

      await rightClick(wrapper.get('[data-testid="app-sidebar-staff-apps"]').element)

      expect(pageMenu()).toBeNull()
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
