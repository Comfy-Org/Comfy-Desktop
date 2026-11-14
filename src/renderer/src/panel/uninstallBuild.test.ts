import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import PanelApp from './PanelApp.vue'
import { __resetLauncherPrefsForTest } from '../composables/useLauncherPrefs'
import { useOverlay } from '../composables/useOverlay'
import { en } from '../lib/i18nMessages'
import { TID } from '../../../shared/testIds'
import type {
  ActionResult,
  DetailSection,
  ErrorDetailData,
  Installation,
  ProgressData
} from '../types/ipc'

const BUILD: Installation = {
  id: 'video-lab',
  name: 'Video Lab',
  sourceId: 'standalone',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  status: 'installed',
  version: 'v0.38.0',
  installPath: '/Users/ada/ComfyUI/video-lab'
}

const OTHER_BUILD: Installation = {
  ...BUILD,
  id: 'sketchbook',
  name: 'Sketchbook',
  installPath: '/Users/ada/ComfyUI/sketchbook'
}

const LOCKED_FILE_REASON =
  'A file could not be deleted because it is in use by another program.\n/Users/ada/ComfyUI/video-lab/python.exe'

const UNINSTALL_ACTION_SECTIONS: DetailSection[] = [
  { tab: 'update', title: 'Update', fields: [] },
  { tab: 'status', title: 'Details', fields: [] },
  {
    pinBottom: true,
    actions: [
      {
        id: 'delete',
        label: 'Uninstall',
        style: 'danger',
        enabled: true,
        showProgress: true,
        progressTitle: 'Deleting',
        cancellable: true,
        confirm: { title: 'Uninstall', message: 'This permanently removes this build.' }
      }
    ]
  }
]

interface PendingUninstall {
  finish: (result: ActionResult) => void
}

interface Desktop {
  installations: Installation[]
  uninstalls: PendingUninstall[]
  cancelled: string[]
  reportProgress: (data: ProgressData) => Promise<void>
  reportErrorDetail: (data: ErrorDetailData) => Promise<void>
  removeBuild: (id: string) => Promise<void>
}

function openDesktop(installations: Installation[]): Desktop {
  const progressListeners = new Set<(data: ProgressData) => void>()
  const errorDetailListeners = new Set<(data: ErrorDetailData) => void>()
  const installationListeners = new Set<() => void>()
  const desktop: Desktop = {
    installations,
    uninstalls: [],
    cancelled: [],
    async reportProgress(data) {
      progressListeners.forEach((listener) => listener(data))
      await flushPromises()
    },
    async reportErrorDetail(data) {
      errorDetailListeners.forEach((listener) => listener(data))
      await flushPromises()
    },
    async removeBuild(id) {
      desktop.installations = desktop.installations.filter((build) => build.id !== id)
      installationListeners.forEach((listener) => listener())
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
    getCloudFreeRunsEnabled: async () => false,
    getCloudUserTier: async () => 'unknown',
    getDetailSections: async () => UNINSTALL_ACTION_SECTIONS,
    getDiskSpace: async () => null,
    getInstallationSize: async () => ({ sizeBytes: 0 }),
    getFirstUseState: async () => ({ skipPick: false, hasLegacyDesktop: false }),
    onInstallationsChanged: subscribe(installationListeners),
    onInstallProgress: subscribe(progressListeners),
    onErrorDetail: subscribe(errorDetailListeners),
    runAction: (_id: string, actionId: string) => {
      if (actionId !== 'delete') return Promise.resolve({ ok: true })
      return new Promise<ActionResult>((finish) => {
        desktop.uninstalls.push({ finish })
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

async function uninstallFromTheBuildsList(): Promise<void> {
  await press(TID.dashboardTileKebab(BUILD.id))
  await press(TID.contextMenuItem('delete'))
  await vi.waitFor(() => expect(onPage(TID.baseAlertAction)).not.toBeNull())
  await press(TID.baseAlertAction)
}

async function openBuildPage(): Promise<void> {
  await press(TID.dashboardTile(BUILD.id))
  await vi.waitFor(() => expect(onPage(TID.pickerMoreTrigger)).not.toBeNull())
  await vi.waitFor(() =>
    expect(onPage<HTMLButtonElement>(TID.pickerMoreTrigger)!.disabled).toBe(false)
  )
}

async function uninstallFromTheBuildPage(): Promise<void> {
  await press(TID.pickerMoreTrigger)
  await vi.waitFor(() => expect(onPage(TID.pinBottomAction('delete'))).not.toBeNull())
  await press(TID.pinBottomAction('delete'))
  await vi.waitFor(() => expect(onPage(TID.baseAlertAction)).not.toBeNull())
  await press(TID.baseAlertAction)
  await vi.waitFor(() => expect(onPage(TID.pickerMoreTrigger)).toBeNull())
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

describe('uninstalling a build', () => {
  let desktop: Desktop

  beforeEach(() => {
    setActivePinia(createPinia())
    __resetLauncherPrefsForTest()
    useOverlay().current.value = null
    window.history.replaceState({}, '', '/?panel=chooser&firstUseCompleted=true')
    desktop = openDesktop([BUILD, OTHER_BUILD])
  })

  it('from the builds list, shows progress on the build and removes it when done', async () => {
    await openBuildsList()

    await uninstallFromTheBuildsList()

    expect(desktop.uninstalls).toHaveLength(1)
    expect(fullScreenProgress()).toBeNull()
    expect(buildTile()!.textContent).toContain('Uninstalling')
    expect(onPage(TID.dashboardTileKebab(BUILD.id))).toBeNull()
    expect(onPage(`chooser-tile-view-logs-${BUILD.id}`)).toBeNull()

    await desktop.reportProgress({
      installationId: BUILD.id,
      phase: 'delete',
      percent: 42,
      status: 'Deleting… 42 / 100 items'
    })

    expect(buildTile()!.textContent).toContain('Uninstalling · 42%')
    expect(progressBarIn(buildTile())).toBe('42')
    expect(onPage(TID.dashboardTile(OTHER_BUILD.id))!.textContent).not.toContain('Uninstalling')

    desktop.uninstalls[0]!.finish({ ok: true, navigate: 'list' })
    await desktop.removeBuild(BUILD.id)

    await vi.waitFor(() => expect(buildTile()).toBeNull())
    expect(onPage(TID.dashboardTile(OTHER_BUILD.id))).not.toBeNull()
    expect(fullScreenProgress()).toBeNull()
  })

  it('keeps the uninstall in view in the sidebar and on Home', async () => {
    await openBuildsList()
    await uninstallFromTheBuildsList()
    await desktop.reportProgress({
      installationId: BUILD.id,
      phase: 'delete',
      percent: 18,
      status: 'Deleting… 18 / 100 items'
    })

    expect(onPage(`app-sidebar-build-${BUILD.id}`)!.textContent).toContain('18%')

    await press('app-sidebar-home')

    const card = onPage('home-build-uninstalling')
    expect(card!.getAttribute('data-build-id')).toBe(BUILD.id)
    expect(card!.textContent).toContain('Removing files · 18%')
    expect(progressBarIn(card)).toBe('18')
    expect(card!.querySelector('[data-testid="home-build-view-logs"]')).toBeNull()
    expect(fullScreenProgress()).toBeNull()
  })

  it('from the build page, shows progress on that page and returns to the list when done', async () => {
    await openBuildsList()
    await openBuildPage()

    await uninstallFromTheBuildPage()

    expect(desktop.uninstalls).toHaveLength(1)
    expect(fullScreenProgress()).toBeNull()
    await vi.waitFor(() => expect(onPage('home-build-uninstalling')).not.toBeNull())
    expect(buildPage()!.querySelector('h1')!.textContent).toContain('Video Lab')
    expect(buildPage()!.querySelector('.build-details-status')!.textContent).toContain(
      'Uninstalling'
    )
    expect(onPage(TID.pickerMoreTrigger)).toBeNull()

    await desktop.reportProgress({
      installationId: BUILD.id,
      phase: 'delete',
      percent: 63,
      status: 'Deleting… 63 / 100 items'
    })

    expect(onPage('home-build-uninstalling')!.textContent).toContain('Removing files · 63%')
    expect(progressBarIn(buildPage())).toBe('63')

    desktop.uninstalls[0]!.finish({ ok: true, navigate: 'list' })
    await desktop.removeBuild(BUILD.id)

    await vi.waitFor(() => expect(buildPage()).toBeNull())
    expect(buildTile()).toBeNull()
    expect(onPage(TID.dashboardTile(OTHER_BUILD.id))!.checkVisibility()).toBe(true)
    expect(fullScreenProgress()).toBeNull()
  })

  it('says why on the build page when the uninstall fails, and can try again', async () => {
    await openBuildsList()
    await openBuildPage()
    await uninstallFromTheBuildPage()

    desktop.uninstalls[0]!.finish({ ok: false, message: 'A file is in use.' })
    await flushPromises()

    expect(onPage('home-build-uninstalling')).toBeNull()
    expect(onPage('build-uninstall-failed-reason')!.textContent).toContain('A file is in use.')

    await desktop.reportErrorDetail({ installationId: BUILD.id, message: LOCKED_FILE_REASON })

    expect(onPage('build-uninstall-failed-reason')!.textContent).toContain('python.exe')
    expect(fullScreenProgress()).toBeNull()

    await press('build-uninstall-retry')

    expect(desktop.uninstalls).toHaveLength(2)
    expect(onPage('build-uninstall-failed')).toBeNull()
    expect(onPage('home-build-uninstalling')).not.toBeNull()

    desktop.uninstalls[1]!.finish({ ok: true, navigate: 'list' })
    await desktop.removeBuild(BUILD.id)

    await vi.waitFor(() => expect(buildPage()).toBeNull())
    expect(buildTile()).toBeNull()
  })

  it('brings the build page back when a failed uninstall is dismissed', async () => {
    await openBuildsList()
    await openBuildPage()
    await uninstallFromTheBuildPage()
    desktop.uninstalls[0]!.finish({ ok: false, message: 'A file is in use.' })
    await flushPromises()

    await press('build-uninstall-dismiss')

    expect(onPage('build-uninstall-failed')).toBeNull()
    await vi.waitFor(() => expect(onPage(TID.pickerMoreTrigger)).not.toBeNull())
    expect(buildPage()!.querySelector('.build-details-status')).toBeNull()
  })

  it('marks the build on the list when the uninstall fails, and its page says why', async () => {
    await openBuildsList()
    await uninstallFromTheBuildsList()

    desktop.uninstalls[0]!.finish({ ok: false, message: LOCKED_FILE_REASON })
    await flushPromises()

    expect(fullScreenProgress()).toBeNull()
    expect(buildTile()!.textContent).not.toContain('Uninstalling')
    expect(buildTile()!.querySelector('.chooser-tile-error-badge')).not.toBeNull()

    await press(TID.dashboardTile(BUILD.id))

    await vi.waitFor(() =>
      expect(onPage('build-uninstall-failed-reason')!.textContent).toContain('python.exe')
    )
  })

  it('stops an uninstall from the build on the list, and keeps the build', async () => {
    await openBuildsList()
    await uninstallFromTheBuildsList()

    await press(`chooser-tile-cancel-${BUILD.id}`)
    await vi.waitFor(() => expect(onPage(TID.baseAlertAction)).not.toBeNull())
    expect(document.body.textContent).toContain('Stop uninstalling?')
    await press(TID.baseAlertAction)

    expect(desktop.cancelled).toEqual([BUILD.id])

    desktop.uninstalls[0]!.finish({ ok: false, cancelled: true, message: 'Cancelled.' })
    await flushPromises()

    expect(buildTile()!.textContent).not.toContain('Uninstalling')
    expect(buildTile()!.querySelector('.chooser-tile-error-badge')).toBeNull()
    expect(onPage(TID.dashboardTileKebab(BUILD.id))).not.toBeNull()
  })
})
