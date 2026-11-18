import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import PanelApp from './PanelApp.vue'
import { __resetLauncherPrefsForTest } from '../composables/useLauncherPrefs'
import { useOverlay } from '../composables/useOverlay'
import { en } from '../lib/i18nMessages'
import { TID } from '../../../shared/testIds'
import type { ActionResult, DetailSection, Installation, ProgressData } from '../types/ipc'

const BUILD: Installation = {
  id: 'video-lab',
  name: 'Video Lab',
  sourceId: 'standalone',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  status: 'installed',
  version: 'v0.38.0',
  installPath: '/Users/ada/ComfyUI/video-lab',
  statusTag: { label: 'Update', style: 'update' }
}

const OTHER_BUILD: Installation = {
  ...BUILD,
  id: 'sketchbook',
  name: 'Sketchbook',
  installPath: '/Users/ada/ComfyUI/sketchbook',
  statusTag: undefined
}

const UPDATE_ACTION_SECTIONS: DetailSection[] = [
  {
    tab: 'update',
    title: 'Update',
    fields: [],
    actions: [
      {
        id: 'update-comfyui',
        label: 'Update ComfyUI',
        style: 'primary',
        enabled: true,
        showProgress: true,
        progressTitle: 'Updating',
        cancellable: true
      }
    ]
  },
  { tab: 'status', title: 'Details', fields: [] }
]

interface PendingUpdate {
  finish: (result: ActionResult) => void
}

interface Desktop {
  installations: Installation[]
  updates: PendingUpdate[]
  cancelled: string[]
  startPickerUpdate: (id: string) => Promise<void>
  reportProgress: (data: ProgressData) => Promise<void>
}

function openDesktop(installations: Installation[]): Desktop {
  const panelListeners = new Set<Parameters<typeof window.api.onPanelSwitch>[0]>()
  const overlayListeners = new Set<Parameters<typeof window.api.onPanelTriggerOverlay>[0]>()
  const progressListeners = new Set<(data: ProgressData) => void>()
  const desktop: Desktop = {
    installations,
    updates: [],
    cancelled: [],
    async startPickerUpdate(id) {
      const build = desktop.installations.find((installation) => installation.id === id)!
      panelListeners.forEach((listener) => listener({ panel: 'progress' }))
      overlayListeners.forEach((listener) =>
        listener({
          kind: 'picker-show-progress',
          installationId: id,
          actionId: 'update-comfyui',
          title: `Updating ${build.name}`,
          opKind: 'update',
          cancellable: true
        })
      )
      await flushPromises()
    },
    async reportProgress(data) {
      progressListeners.forEach((listener) => listener(data))
      await flushPromises()
    }
  }
  const subscribe =
    <T>(listeners: Set<T>) =>
    (listener: T) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  const answered: Record<string, unknown> = {
    platform: 'darwin',
    comfybuilder: {
      getAuthStatus: async () => ({ signedIn: false }),
      onAuthChanged: () => () => {},
      listWorkspaces: async () => [],
      listBuilds: async () => []
    },
    getLocale: async () => 'en',
    getLocaleMessages: async () => en,
    getSetting: async (key: string) => (key === 'firstUseCompleted' ? true : undefined),
    getInstallations: async () => desktop.installations,
    getRunningInstances: async () => [],
    getListActions: async () => [],
    getFieldOptions: async () => [],
    listHomeWorkflows: async () => [],
    listApps: async () => [],
    getAppsEnabled: async () => false,
    getAppUpdateState: async () => ({ kind: null, version: null, autoUpdate: true }),
    getCloudFreeRunsEnabled: async () => false,
    getCloudUserTier: async () => 'unknown',
    refreshCreditBalance: async () => ({ status: 'signed_out' }),
    getDetailSections: async () => UPDATE_ACTION_SECTIONS,
    getDiskSpace: async () => null,
    getInstallationSize: async () => ({ sizeBytes: 0 }),
    getFirstUseState: async () => ({ skipPick: false, hasLegacyDesktop: false }),
    closeCurrentPanel: () => panelListeners.forEach((listener) => listener({ panel: 'chooser' })),
    onPanelSwitch: subscribe(panelListeners),
    onPanelTriggerOverlay: subscribe(overlayListeners),
    onInstallProgress: subscribe(progressListeners),
    runAction: (_id: string, actionId: string) => {
      if (actionId !== 'update-comfyui') return Promise.resolve({ ok: true })
      return new Promise<ActionResult>((finish) => {
        desktop.updates.push({ finish })
      })
    },
    cancelOperation: async (id: string) => {
      desktop.cancelled.push(id)
    }
  }
  ;(window as unknown as { api: unknown }).api = new Proxy(answered, {
    get(known, key) {
      if (typeof key !== 'string') return undefined
      if (key in known) return known[key]
      if (key.startsWith('on')) return () => () => {}
      return async () => undefined
    }
  })
  return desktop
}

type Panel = ReturnType<typeof mount<typeof PanelApp>>

function onPage<T extends Element = HTMLElement>(testId: string): T | null {
  return document.body.querySelector<T>(`[data-testid="${testId}"]`)
}

async function press(testId: string): Promise<void> {
  const control = onPage(testId)
  expect(control, `${testId} is on the page`).not.toBeNull()
  control!.click()
  await flushPromises()
}

async function openBuildsList(): Promise<Panel> {
  const panel = mount(PanelApp, { attachTo: document.body, global: { plugins: [createPinia()] } })
  await flushPromises()
  await press('app-sidebar-chooser')
  await vi.waitFor(() => expect(onPage(TID.dashboardTile(BUILD.id))).not.toBeNull())
  return panel
}

async function openTileMenu(): Promise<void> {
  await press(TID.dashboardTileKebab(BUILD.id))
  await vi.waitFor(() => expect(onPage('build-menu')).not.toBeNull())
}

async function chooseOnTileMenu(item: string): Promise<void> {
  await openTileMenu()
  await press(`build-menu-${item}`)
}

async function tileMenuItems(): Promise<string[]> {
  await openTileMenu()
  const items = [...onPage('build-menu')!.querySelectorAll('[role="menuitem"]')].map((row) =>
    row.getAttribute('data-testid')!.replace('build-menu-', '')
  )
  onPage('build-menu')!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  )
  await vi.waitFor(() => expect(onPage('build-menu')).toBeNull())
  return items
}

async function openBuildPage(): Promise<void> {
  await chooseOnTileMenu('manage')
  await vi.waitFor(() => expect(onPage(TID.pickerMoreTrigger)).not.toBeNull())
  await vi.waitFor(() =>
    expect(onPage<HTMLButtonElement>(TID.pickerMoreTrigger)!.disabled).toBe(false)
  )
}

function fullScreenProgress(): Element | null {
  return document.body.querySelector('.brand-progress')
}

function buildTile(): HTMLElement | null {
  return onPage(TID.dashboardTile(BUILD.id))
}

function buildPage(): HTMLElement | null {
  return onPage('build-details')
}

function progressBarIn(scope: Element | null): string | null {
  return scope?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') ?? null
}

describe('updating a build', () => {
  let desktop: Desktop

  beforeEach(() => {
    setActivePinia(createPinia())
    __resetLauncherPrefsForTest()
    useOverlay().current.value = null
    window.history.replaceState({}, '', '/?panel=chooser&firstUseCompleted=true')
    desktop = openDesktop([BUILD, OTHER_BUILD])
  })

  it('from the builds list menu, shows progress on the build instead of the full-screen loader', async () => {
    await openBuildsList()

    await chooseOnTileMenu('update')
    await vi.waitFor(() => expect(desktop.updates).toHaveLength(1))

    expect(fullScreenProgress()).toBeNull()
    expect(onPage('app-sidebar')).not.toBeNull()
    expect(buildTile()!.checkVisibility()).toBe(true)
    expect(buildTile()!.textContent).toContain('Updating')
    const whileUpdating = await tileMenuItems()
    expect(whileUpdating.slice(0, 2)).toEqual(['view-logs', 'cancel'])
    expect(whileUpdating).not.toContain('launch')

    await desktop.reportProgress({
      installationId: BUILD.id,
      phase: 'update',
      percent: 40,
      status: 'Pulling latest ComfyUI'
    })

    expect(buildTile()!.textContent).toContain('Updating · 40%')
    expect(progressBarIn(buildTile())).toBe('40')
    expect(onPage(TID.dashboardTile(OTHER_BUILD.id))!.textContent).not.toContain('Updating')

    desktop.updates[0]!.finish({ ok: true })
    await flushPromises()

    expect(buildTile()!.textContent).not.toContain('Updating')
    expect(progressBarIn(buildTile())).toBeNull()
    expect(fullScreenProgress()).toBeNull()
  })

  it('keeps the update in view in the sidebar and on Home', async () => {
    await openBuildsList()
    await chooseOnTileMenu('update')
    await vi.waitFor(() => expect(desktop.updates).toHaveLength(1))
    await desktop.reportProgress({
      installationId: BUILD.id,
      phase: 'update',
      percent: 18,
      status: 'Pulling latest ComfyUI'
    })

    expect(onPage(`app-sidebar-build-${BUILD.id}`)!.textContent).toContain('18%')

    await press('app-sidebar-home')

    const card = onPage('home-build-updating')
    expect(card!.getAttribute('data-build-id')).toBe(BUILD.id)
    expect(card!.textContent).toContain('Updating · 18%')
    expect(progressBarIn(card)).toBe('18')
    expect(fullScreenProgress()).toBeNull()
  })

  it('from the title-bar picker, keeps the builds list visible during the update', async () => {
    await openBuildsList()

    await desktop.startPickerUpdate(BUILD.id)

    expect(desktop.updates).toHaveLength(1)
    expect(fullScreenProgress()).toBeNull()
    expect(onPage('app-sidebar')).not.toBeNull()
    expect(buildTile()!.checkVisibility()).toBe(true)
    expect(buildTile()!.textContent).toContain('Updating')

    desktop.updates[0]!.finish({ ok: true })
    await flushPromises()

    expect(buildTile()!.textContent).not.toContain('Updating')
    expect(fullScreenProgress()).toBeNull()
  })

  it('shows the update on the build page in place of its settings', async () => {
    await openBuildsList()
    await chooseOnTileMenu('update')
    await vi.waitFor(() => expect(desktop.updates).toHaveLength(1))

    await chooseOnTileMenu('manage')
    await vi.waitFor(() => expect(buildPage()).not.toBeNull())

    expect(onPage('home-build-updating')).not.toBeNull()
    expect(buildPage()!.querySelector('h1')!.textContent).toContain('Video Lab')
    expect(buildPage()!.querySelector('.build-details-status')!.textContent).toContain('Updating')
    expect(onPage(TID.pickerMoreTrigger)).toBeNull()

    desktop.updates[0]!.finish({ ok: true })
    await flushPromises()

    expect(onPage('home-build-updating')).toBeNull()
    await vi.waitFor(() => expect(onPage(TID.pickerMoreTrigger)).not.toBeNull())
    expect(fullScreenProgress()).toBeNull()
  })

  it('cancels the update from the build menu after asking', async () => {
    await openBuildsList()
    await chooseOnTileMenu('update')
    await vi.waitFor(() => expect(desktop.updates).toHaveLength(1))

    await chooseOnTileMenu('cancel')
    await vi.waitFor(() => expect(onPage(TID.baseAlertAction)).not.toBeNull())
    expect(document.body.textContent).toContain('Stop updating?')
    await press(TID.baseAlertAction)

    expect(desktop.cancelled).toEqual([BUILD.id])
  })

  it('marks the build on the list when the update fails, without the full-screen loader', async () => {
    await openBuildsList()
    await chooseOnTileMenu('update')
    await vi.waitFor(() => expect(desktop.updates).toHaveLength(1))

    desktop.updates[0]!.finish({ ok: false, message: 'git pull failed' })
    await flushPromises()

    expect(fullScreenProgress()).toBeNull()
    expect(buildTile()!.textContent).not.toContain('Updating')
    expect(buildTile()!.querySelector('.chooser-tile-error-badge')).not.toBeNull()
  })
})
