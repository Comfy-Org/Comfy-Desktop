import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AppSidebar from '../AppSidebar.vue'
import HomeBuildCard from './HomeBuildCard.vue'
import ChooserInstallTile from '../../views/chooser/ChooserInstallTile.vue'
import Tooltip from '../../components/ui/Tooltip.vue'
import { provideBuildMenuHost, type BuildMenuHost } from './useBuildMenu'
import { homeBuildStatus } from './homeBuild'
import { provideBuildLogs } from '../../composables/useBuildProgress'
import { useAuthStore } from '../../stores/authStore'
import { useInstallationStore } from '../../stores/installationStore'
import { useProgressStore, type Operation } from '../../stores/progressStore'
import { useSessionStore } from '../../stores/sessionStore'
import type { Installation } from '../../types/ipc'

const BUILD: Installation = {
  id: 'flux',
  name: 'Flux Sandbox',
  sourceId: 'standalone',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  status: 'installed',
  version: 'v0.42.4',
  installPath: '/Users/someone/ComfyUI/Flux Sandbox'
}

type State = 'ready' | 'starting' | 'installing' | 'running' | 'uninstalling'

const REST = ['|', 'manage', 'copy-install', 'reveal-in-folder', '|', 'share', 'restore-snapshot']
const EXPECTED: Record<State, string[]> = {
  ready: ['launch', '|', 'auto-start', ...REST, '|', 'delete'],
  starting: ['view-logs', 'cancel', '|', 'auto-start', ...REST, '|', 'delete'],
  installing: ['view-logs', 'cancel', '|', 'auto-start', ...REST, '|', 'delete'],
  running: ['view-logs', 'restart', 'stop', '|', 'auto-start', ...REST, '|', 'delete'],
  uninstalling: ['cancel', '|', 'auto-start', ...REST, '|', 'delete']
}
const OPERATIONS: Partial<Record<State, Partial<Operation>>> = {
  starting: { opKind: 'launch', flatPercent: 5 },
  installing: { opKind: 'install', flatPercent: 40 },
  uninstalling: { opKind: 'destructive', flatPercent: 18 }
}

let host: BuildMenuHost & { [K in keyof BuildMenuHost]: ReturnType<typeof vi.fn> }
const mounted: VueWrapper[] = []
const viewLogs = vi.fn()
const OTHER_BUILD_ID = 'other'
let saved: unknown

beforeEach(() => {
  saved = 'none'
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  ;(window as unknown as { api: unknown }).api = {
    platform: 'darwin',
    navigatePanel: vi.fn(),
    getAppsEnabled: vi.fn().mockResolvedValue(false),
    getInstallations: vi.fn().mockResolvedValue([]),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    getSetting: vi.fn(async (key: string) => (key === 'autoLaunchOnStartup' ? saved : undefined)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      if (key === 'autoLaunchOnStartup') saved = value
    }),
    onSettingsChanged: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {}),
      promoteLocalInstance: vi.fn()
    }
  }
  host = { launch: vi.fn(), openDetails: vi.fn(), showProgress: vi.fn() }
  viewLogs.mockReset()
  setActivePinia(createPinia())
  useInstallationStore().installations = [BUILD]
})

function withHost(render: () => ReturnType<typeof h>) {
  return defineComponent({
    setup() {
      provideBuildMenuHost(host)
      provideBuildLogs(viewLogs)
      return render
    }
  })
}

function putIn(state: State): void {
  const operation = OPERATIONS[state]
  if (operation) {
    useProgressStore().operations.set(BUILD.id, {
      finished: false,
      cancelRequested: false,
      ...operation
    } as Operation)
  }
  if (state === 'running') {
    useSessionStore().runningInstances.set(BUILD.id, {
      installationId: BUILD.id
    } as never)
  }
}

async function mountTile(state: State): Promise<VueWrapper> {
  const wrapper = mount(
    withHost(() =>
      h(HomeBuildCard, {
        build: BUILD,
        status: homeBuildStatus(BUILD, useSessionStore()),
        tone: 'ember'
      })
    ),
    { attachTo: document.body }
  )
  mounted.push(wrapper)
  putIn(state)
  await flushPromises()
  return wrapper
}

async function mountBuildsTile(state: State): Promise<VueWrapper> {
  const wrapper = mount(
    withHost(() => h(ChooserInstallTile, { installation: BUILD })),
    { attachTo: document.body }
  )
  mounted.push(wrapper)
  putIn(state)
  await flushPromises()
  return wrapper
}

const BUILDS_TILE = `[data-testid="dashboard-tile-${BUILD.id}"]`

async function mountSidebar(state: State): Promise<VueWrapper> {
  const wrapper = mount(
    withHost(() => h(AppSidebar, { activePage: 'home' })),
    { attachTo: document.body }
  )
  mounted.push(wrapper)
  putIn(state)
  await flushPromises()
  return wrapper
}

async function shownMenu(): Promise<string[]> {
  await flushPromises()
  await vi.waitFor(() => {
    expect(document.querySelector('[data-testid="build-menu"]')).not.toBeNull()
  })
  const menu = document.querySelector('[data-testid="build-menu"]')!
  return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
    row.getAttribute('role') === 'separator'
      ? '|'
      : row.getAttribute('data-testid')!.replace('build-menu-', '')
  )
}

async function closeMenu(): Promise<void> {
  document
    .querySelector('[data-testid="build-menu"]')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await flushPromises()
  await vi.waitFor(() => {
    expect(document.querySelector('[data-testid="build-menu"]')).toBeNull()
  })
}

async function press(element: Element): Promise<void> {
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
  await new Promise((resolve) => setTimeout(resolve, 100))
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
  await flushPromises()
}

async function rightClick(element: Element): Promise<void> {
  element.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })
  )
  await flushPromises()
}

describe('Build menu', () => {
  it.each(Object.keys(EXPECTED) as State[])(
    'lists what a %s build can do now first, Uninstall last',
    async (state) => {
      const tile = await mountTile(state)

      await tile.get('[data-testid="home-build-more"]').trigger('click')

      expect(await shownMenu()).toEqual(EXPECTED[state])
    }
  )

  it.each(Object.keys(EXPECTED) as State[])(
    'opens the same items from the tile ⋯, a right-click on the tile and on the sidebar row for a %s build',
    async (state) => {
      const tile = await mountTile(state)
      await tile.get('[data-testid="home-build-more"]').trigger('click')
      const fromMore = await shownMenu()
      await closeMenu()

      await rightClick(tile.get(`[data-build-id="${BUILD.id}"]`).element)
      const fromTile = await shownMenu()
      await closeMenu()

      const sidebar = await mountSidebar(state)
      await rightClick(sidebar.get(`[data-testid="app-sidebar-build-${BUILD.id}"]`).element)
      const fromSidebar = await shownMenu()
      await closeMenu()

      const buildsTile = await mountBuildsTile(state)
      await buildsTile.get('.chooser-tile-kebab').trigger('click')
      const fromBuildsMore = await shownMenu()
      await closeMenu()

      await rightClick(buildsTile.get(BUILDS_TILE).element)
      const fromBuildsTile = await shownMenu()

      expect(fromTile).toEqual(fromMore)
      expect(fromSidebar).toEqual(fromMore)
      expect(fromBuildsMore).toEqual(fromMore)
      expect(fromBuildsTile).toEqual(fromMore)
    }
  )

  it.each([
    ['a build whose install failed', { ...BUILD, id: 'broken', status: 'failed' }],
    [
      'Comfy Cloud',
      { ...BUILD, id: 'cloud', sourceId: 'cloud', sourceCategory: 'cloud', installPath: undefined }
    ]
  ] satisfies [string, Installation][])('offers no Auto start for %s', async (_name, build) => {
    const wrapper = mount(
      withHost(() => h(HomeBuildCard, { build, status: 'ready', tone: 'ember' })),
      { attachTo: document.body }
    )
    mounted.push(wrapper)
    await flushPromises()

    await wrapper.get('[data-testid="home-build-more"]').trigger('click')

    expect(await shownMenu()).not.toContain('auto-start')
  })

  it('shows the update beside the version and keeps the whole tile as the primary button', async () => {
    const build: Installation = {
      ...BUILD,
      statusTag: { label: 'Update available', style: 'update' }
    }
    const wrapper = mount(
      withHost(() => h(HomeBuildCard, { build, status: 'update', tone: 'ember' })),
      { attachTo: document.body }
    )
    mounted.push(wrapper)
    await flushPromises()

    expect(wrapper.get('[data-testid="home-build-detail"]').text()).toBe('v0.42.4 · Update')
    const buttons = [...wrapper.element.querySelectorAll('button')].map((b) =>
      b.getAttribute('data-testid')
    )
    expect(buttons).toEqual(['home-build-open', 'home-build-more'])
  })

  it('shows upload progress on Home and holds the tile and menu launch actions until it finishes', async () => {
    const signedIn = { signedIn: true, workspaceId: 'ws-1' }
    vi.mocked(window.api.comfybuilder.getAuthStatus).mockResolvedValue(signedIn)
    useAuthStore().status = signedIn
    const upload = Promise.withResolvers<{ ok: true }>()
    vi.mocked(window.api.comfybuilder.promoteLocalInstance).mockReturnValue(upload.promise)
    const tile = await mountTile('ready')
    const more = tile.get('[data-testid="home-build-more"]')
    await more.trigger('click')
    expect(await shownMenu()).toContain('promote-to-workspace')
    document.querySelector<HTMLElement>('[data-testid="build-menu-promote-to-workspace"]')!.click()

    try {
      await flushPromises()
      expect(tile.get('[data-testid="home-build-status"]').text()).toBe('Creating...')
      expect(tile.find('[data-testid="home-build-open"]').exists()).toBe(false)
      await more.trigger('click')
      expect(await shownMenu()).not.toContain('launch')
    } finally {
      upload.resolve({ ok: true })
      await flushPromises()
    }

    expect(tile.get('[data-testid="home-build-status"]').text()).toBe('Ready')
    expect(tile.find('[data-testid="home-build-open"]').exists()).toBe(true)
  })

  it('offers Upload build after Restore snapshot when signed in to a workspace, from the ⋯ and a right-click', async () => {
    const signedIn = { signedIn: true, workspaceId: 'ws-1' }
    vi.mocked(window.api.comfybuilder.getAuthStatus).mockResolvedValue(signedIn)
    useAuthStore().status = signedIn
    const tile = await mountTile('ready')
    await tile.get('[data-testid="home-build-more"]').trigger('click')
    const fromTile = await shownMenu()
    await closeMenu()

    await rightClick(tile.get(`[data-build-id="${BUILD.id}"]`).element)
    const fromRightClick = await shownMenu()

    expect(fromTile).toEqual([
      'launch',
      '|',
      'auto-start',
      ...REST,
      'promote-to-workspace',
      '|',
      'delete'
    ])
    expect(fromRightClick).toEqual(fromTile)
  })

  it('leaves Upload build out when signed out', async () => {
    const tile = await mountTile('ready')
    await tile.get('[data-testid="home-build-more"]').trigger('click')

    expect(await shownMenu()).not.toContain('promote-to-workspace')
  })

  it('asks inside the menu before it uninstalls, then uninstalls without another dialog', async () => {
    const tile = await mountTile('ready')
    await tile.get('[data-testid="home-build-more"]').trigger('click')
    await shownMenu()

    document.querySelector<HTMLElement>('[data-testid="build-menu-delete"]')!.click()
    await flushPromises()

    const question = document.querySelector('[data-testid="build-menu-uninstall-question"]')
    expect(question?.textContent).toContain('Flux Sandbox')
    expect(host.showProgress).not.toHaveBeenCalled()

    document.querySelector<HTMLElement>('[data-testid="build-menu-confirm-uninstall"]')!.click()
    await flushPromises()

    expect(host.showProgress).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ installationId: BUILD.id, actionId: 'delete' })
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('puts focus on the Uninstall answer when it asks', async () => {
    const tile = await mountTile('ready')
    await tile.get('[data-testid="home-build-more"]').trigger('click')
    await shownMenu()

    document.querySelector<HTMLElement>('[data-testid="build-menu-delete"]')!.click()
    await flushPromises()

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector('[data-testid="build-menu-confirm-uninstall"]')
      )
    )
  })

  it('closes the menu when the ⋯ button is pressed again', async () => {
    const tile = await mountTile('ready')
    const more = tile.get<HTMLElement>('[data-testid="home-build-more"]').element
    await press(more)
    await shownMenu()

    await press(more)

    await vi.waitFor(() => expect(document.querySelector('[data-testid="build-menu"]')).toBeNull())
  })

  it('updates the sidebar menu when the build changes while it is open', async () => {
    const sidebar = await mountSidebar('ready')
    await rightClick(sidebar.get(`[data-testid="app-sidebar-build-${BUILD.id}"]`).element)
    expect(await shownMenu()).toContain('auto-start')

    useInstallationStore().installations = [{ ...BUILD, status: 'failed' }]
    await flushPromises()

    expect(await shownMenu()).not.toContain('auto-start')
  })

  it('drops the uninstall question when the build starts running, and never uninstalls it', async () => {
    const tile = await mountTile('ready')
    await tile.get('[data-testid="home-build-more"]').trigger('click')
    await shownMenu()
    document.querySelector<HTMLElement>('[data-testid="build-menu-delete"]')!.click()
    await flushPromises()
    expect(document.querySelector('[data-testid="build-menu-uninstall-question"]')).not.toBeNull()

    putIn('running')
    await flushPromises()

    expect(document.querySelector('[data-testid="build-menu-uninstall-question"]')).toBeNull()
    expect(document.querySelector('[data-testid="build-menu-confirm-uninstall"]')).toBeNull()
    expect(host.showProgress).not.toHaveBeenCalled()
  })

  it('returns focus to the ⋯ button when the menu closes', async () => {
    const tile = await mountTile('ready')
    const more = tile.get<HTMLElement>('[data-testid="home-build-more"]')
    more.element.focus()
    await more.trigger('click')
    await shownMenu()

    await closeMenu()

    await vi.waitFor(() => expect(document.activeElement).toBe(more.element))
  })

  it('returns focus to the sidebar build when its menu closes', async () => {
    const sidebar = await mountSidebar('ready')
    const row = sidebar.get<HTMLElement>(`[data-testid="app-sidebar-build-${BUILD.id}"]`)
    row.element.focus()
    await rightClick(row.element)
    await shownMenu()

    await closeMenu()

    await vi.waitFor(() => expect(document.activeElement).toBe(row.element))
  })

  it('opens the logs when a starting build is clicked, and launches a ready one from the menu', async () => {
    const tile = await mountTile('starting')

    await tile.get('[data-testid="home-build-starting"]').trigger('click')
    expect(viewLogs).toHaveBeenCalledExactlyOnceWith(BUILD.id)
    expect(host.launch).not.toHaveBeenCalled()

    useProgressStore().operations.clear()
    await flushPromises()
    await tile.get('[data-testid="home-build-more"]').trigger('click')
    await shownMenu()
    document.querySelector<HTMLElement>('[data-testid="build-menu-launch"]')!.click()
    await flushPromises()

    expect(host.launch).toHaveBeenCalledExactlyOnceWith(BUILD)
  })

  it.each([
    ['ready', 'pick'],
    ['running', 'pick'],
    ['starting', 'logs'],
    ['installing', 'logs'],
    ['uninstalling', 'nothing']
  ] as const)(
    'clicking a %s build card does the same on Home and on the Builds page: %s',
    async (state, outcome) => {
      const home = await mountTile(state)
      await home.get(`[data-build-id="${BUILD.id}"]`).trigger('click')
      const homeCard = home.findComponent(HomeBuildCard)
      expect(homeCard.emitted('open')?.length ?? 0).toBe(outcome === 'pick' ? 1 : 0)
      expect(viewLogs).toHaveBeenCalledTimes(outcome === 'logs' ? 1 : 0)

      const builds = await mountBuildsTile(state)
      await builds.get(BUILDS_TILE).trigger('click')
      const buildsTile = builds.findComponent(ChooserInstallTile)
      expect(buildsTile.emitted('pick')?.length ?? 0).toBe(outcome === 'pick' ? 1 : 0)
      expect(viewLogs).toHaveBeenCalledTimes(outcome === 'logs' ? 2 : 0)
      expect(buildsTile.emitted('open-details')).toBeUndefined()
      expect(host.launch).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['ready', 'Click to start'],
    ['running', 'Click to open'],
    ['starting', 'Click to view logs'],
    ['installing', 'Click to view logs'],
    ['uninstalling', '']
  ] as const)(
    'hints what a click does on a %s build card, on Home and on the Builds page',
    async (state, hint) => {
      const home = await mountTile(state)
      const homeHint = home.findAllComponents(Tooltip)[0]
      if (hint) expect(homeHint?.props('text')).toBe(hint)
      else expect(home.find('[data-testid="home-build-open"]').exists()).toBe(false)

      const builds = await mountBuildsTile(state)
      const open = builds.find('[data-testid="chooser-tile-open"]')
      expect(open.exists()).toBe(Boolean(hint))
      if (hint) expect(builds.findAllComponents(Tooltip)[0]?.props('text')).toBe(hint)
    }
  )

  it('hints Click to open on an idle remote build, on Home and on the Builds page', async () => {
    const remote: Installation = { ...BUILD, sourceCategory: 'remote' }
    const home = mount(
      withHost(() => h(HomeBuildCard, { build: remote, status: 'ready', tone: 'ember' })),
      { attachTo: document.body }
    )
    mounted.push(home)
    const builds = mount(
      withHost(() => h(ChooserInstallTile, { installation: remote })),
      { attachTo: document.body }
    )
    mounted.push(builds)
    await flushPromises()

    expect(home.findAllComponents(Tooltip)[0]?.props('text')).toBe('Click to open')
    expect(builds.findAllComponents(Tooltip)[0]?.props('text')).toBe('Click to open')
  })

  it('names a clipped build in full in the Builds page click hint, and only the action when it fits', async () => {
    const builds = await mountBuildsTile('ready')
    const label = builds.get('.chooser-tile-name .truncated-text').element
    const hint = () => builds.findAllComponents(Tooltip)[0]!.props('text')

    Object.defineProperty(label, 'clientWidth', { configurable: true, value: 120 })
    Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 120 })
    await builds.get(BUILDS_TILE).trigger('pointerenter')
    expect(hint()).toBe('Click to start')

    Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 300 })
    await builds.get(BUILDS_TILE).trigger('pointerenter')
    expect(hint()).toBe(`${BUILD.name} · Click to start`)

    Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 120 })
    await builds.get('[data-testid="chooser-tile-open"]').trigger('focus')
    expect(hint()).toBe('Click to start')
  })

  it('offers Cancel for a start left running by a window that went back to Home, and cancels it', async () => {
    const cancelOperation = vi.fn(async () => {})
    Object.assign(window.api, { cancelOperation, stopComfyUI: vi.fn(async () => {}) })
    useSessionStore().launchingInstances.set(BUILD.id, { installationName: BUILD.name })
    const tile = mount(
      withHost(() => h(HomeBuildCard, { build: BUILD, status: 'starting', tone: 'ember' })),
      { attachTo: document.body }
    )
    mounted.push(tile)
    await flushPromises()

    await tile.get('[data-testid="home-build-more"]').trigger('click')
    expect(await shownMenu()).toEqual(EXPECTED.starting)
    document.querySelector<HTMLElement>('[data-testid="build-menu-cancel"]')!.click()
    await flushPromises()

    expect(cancelOperation).toHaveBeenCalledExactlyOnceWith(BUILD.id)
  })

  it('offers Cancel for a left start still in its checks, before main says it is launching', async () => {
    const cancelOperation = vi.fn(async () => {})
    Object.assign(window.api, { cancelOperation, stopComfyUI: vi.fn(async () => {}) })
    useSessionStore().operationInstances.set(BUILD.id, { actionId: 'launch' })
    const tile = mount(
      withHost(() => h(HomeBuildCard, { build: BUILD, status: 'ready', tone: 'ember' })),
      { attachTo: document.body }
    )
    mounted.push(tile)
    await flushPromises()

    await tile.get('[data-testid="home-build-more"]').trigger('click')
    expect(await shownMenu()).toEqual(EXPECTED.starting)
    document.querySelector<HTMLElement>('[data-testid="build-menu-cancel"]')!.click()
    await flushPromises()

    expect(cancelOperation).toHaveBeenCalledExactlyOnceWith(BUILD.id)
  })

  it('also stops a left start on Cancel, in case it finished starting before the cancel reached it', async () => {
    const calls: string[] = []
    const cancelOperation = vi.fn(async () => {
      calls.push('cancel')
    })
    const stopComfyUI = vi.fn(async () => {
      calls.push('stop')
    })
    Object.assign(window.api, { cancelOperation, stopComfyUI })
    useSessionStore().launchingInstances.set(BUILD.id, { installationName: BUILD.name })
    const tile = mount(
      withHost(() => h(HomeBuildCard, { build: BUILD, status: 'starting', tone: 'ember' })),
      { attachTo: document.body }
    )
    mounted.push(tile)
    await flushPromises()

    await tile.get('[data-testid="home-build-more"]').trigger('click')
    await shownMenu()
    document.querySelector<HTMLElement>('[data-testid="build-menu-cancel"]')!.click()
    await flushPromises()

    expect(cancelOperation).toHaveBeenCalledExactlyOnceWith(BUILD.id)
    expect(stopComfyUI).toHaveBeenCalledExactlyOnceWith(BUILD.id)
    expect(calls).toEqual(['cancel', 'stop'])
  })

  it('shows that a start left running did not start when it failed, not Ready', async () => {
    useSessionStore().errorInstances.set(BUILD.id, {
      installationName: BUILD.name,
      message: 'Process exited with code 1',
      startFailed: true
    })
    const tile = mount(
      withHost(() => h(HomeBuildCard, { build: BUILD, status: 'ready', tone: 'ember' })),
      { attachTo: document.body }
    )
    mounted.push(tile)
    await flushPromises()

    expect(tile.get('[data-testid="home-build"]').text()).toContain("Didn't start")
    expect(tile.get('[data-testid="home-build"]').text()).not.toContain('Ready')
  })

  it('still shows Ready after a running build crashed', async () => {
    useSessionStore().errorInstances.set(BUILD.id, { installationName: BUILD.name, exitCode: 1 })
    const tile = mount(
      withHost(() => h(HomeBuildCard, { build: BUILD, status: 'ready', tone: 'ember' })),
      { attachTo: document.body }
    )
    mounted.push(tile)
    await flushPromises()

    expect(tile.get('[data-testid="home-build"]').text()).toContain('Ready')
  })

  it('keeps the build menu closed on a right-click on a page in the sidebar', async () => {
    const sidebar = await mountSidebar('ready')

    for (const page of ['home', 'assets']) {
      await rightClick(sidebar.get(`[data-testid="app-sidebar-${page}"]`).element)
    }

    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="sidebar-page-menu"]')).not.toBeNull()
    )
    expect(document.querySelector('[data-testid="build-menu"]')).toBeNull()
  })

  it.each([
    ['tile ⋯', 'more'],
    ['sidebar row', 'sidebar']
  ] as const)(
    'from the %s, offers Auto start and saves this build when picked',
    async (_name, from) => {
      saved = OTHER_BUILD_ID
      await openMenuFrom(from)

      const line = autoStartLine()
      expect(line.textContent?.trim()).toBe('Auto start')
      expect(line.querySelector('.lucide-power')).not.toBeNull()
      line.click()
      await flushPromises()

      expect(autoStartWrites()).toEqual([BUILD.id])
      expect(saved).toBe(BUILD.id)
    }
  )

  it('offers Turn off Auto start on the build that starts with Desktop and sets None when picked', async () => {
    saved = BUILD.id
    const tile = await openMenuFrom('more')

    const line = autoStartLine()
    expect(line.textContent?.trim()).toBe('Turn off Auto start')
    expect(line.querySelector('.lucide-power-off')).not.toBeNull()
    line.click()
    await flushPromises()

    expect(autoStartWrites()).toEqual(['none'])
    await vi.waitFor(() => expect(document.querySelector('[data-testid="build-menu"]')).toBeNull())
    await tile.get('[data-testid="home-build-more"]').trigger('click')
    await shownMenu()
    expect(autoStartLine().textContent?.trim()).toBe('Auto start')
  })

  it('keeps the Auto start line, in its own group, while the build installs', async () => {
    const tile = await mountTile('installing')
    await tile.get('[data-testid="home-build-more"]').trigger('click')
    const shown = await shownMenu()

    expect(shown.slice(shown.indexOf('auto-start') - 1, shown.indexOf('auto-start') + 2)).toEqual([
      '|',
      'auto-start',
      '|'
    ])
    autoStartLine().click()
    await flushPromises()

    expect(autoStartWrites()).toEqual([BUILD.id])
  })
})

async function openMenuFrom(from: 'more' | 'sidebar'): Promise<VueWrapper> {
  if (from === 'more') {
    const tile = await mountTile('ready')
    await tile.get('[data-testid="home-build-more"]').trigger('click')
    await shownMenu()
    return tile
  }
  const sidebar = await mountSidebar('ready')
  await rightClick(sidebar.get(`[data-testid="app-sidebar-build-${BUILD.id}"]`).element)
  await shownMenu()
  return sidebar
}

function autoStartWrites(): unknown[] {
  return vi
    .mocked(window.api.setSetting)
    .mock.calls.filter(([key]) => key === 'autoLaunchOnStartup')
    .map(([, value]) => value)
}

function autoStartLine(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-testid="build-menu-auto-start"]')!
}
