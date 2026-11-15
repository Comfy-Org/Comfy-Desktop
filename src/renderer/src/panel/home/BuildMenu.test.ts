import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AppSidebar from '../AppSidebar.vue'
import HomeBuildCard from './HomeBuildCard.vue'
import { provideBuildMenuHost, type BuildMenuHost } from './useBuildMenu'
import { provideBuildLogs } from '../../composables/useBuildProgress'
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
  ready: ['launch', '|', 'open-new-window', ...REST, '|', 'delete'],
  starting: ['view-logs', 'cancel', ...REST, '|', 'delete'],
  installing: ['view-logs', 'cancel', ...REST, '|', 'delete'],
  running: ['view-logs', 'restart', 'stop', '|', 'open-new-window', ...REST, '|', 'delete'],
  uninstalling: ['cancel', ...REST, '|', 'delete']
}
const OPERATIONS: Partial<Record<State, Partial<Operation>>> = {
  starting: { opKind: 'launch', flatPercent: 5 },
  installing: { opKind: 'install', flatPercent: 40 },
  uninstalling: { opKind: 'destructive', flatPercent: 18 }
}

let host: BuildMenuHost & { [K in keyof BuildMenuHost]: ReturnType<typeof vi.fn> }
const mounted: VueWrapper[] = []
const viewLogs = vi.fn()

beforeEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  ;(window as unknown as { api: unknown }).api = {
    platform: 'darwin',
    navigatePanel: vi.fn(),
    getAppsEnabled: vi.fn().mockResolvedValue(false),
    getInstallations: vi.fn().mockResolvedValue([]),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    getSetting: vi.fn().mockResolvedValue(undefined),
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {}),
    openInstallInNewWindow: vi.fn(),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {})
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
    withHost(() => h(HomeBuildCard, { build: BUILD, status: 'ready', tone: 'ember' })),
    { attachTo: document.body }
  )
  mounted.push(wrapper)
  putIn(state)
  await flushPromises()
  return wrapper
}

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

      expect(fromTile).toEqual(fromMore)
      expect(fromSidebar).toEqual(fromMore)
    }
  )

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

  it('opens no menu on a right-click on a page in the sidebar', async () => {
    const sidebar = await mountSidebar('ready')

    for (const page of ['home', 'assets']) {
      await rightClick(sidebar.get(`[data-testid="app-sidebar-${page}"]`).element)
    }

    expect(document.querySelector('[data-reka-menu-content]')).toBeNull()
  })
})
