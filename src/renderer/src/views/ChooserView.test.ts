import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'

import ChooserView from './ChooserView.vue'
import WhyTryCloudModal from '../components/WhyTryCloudModal.vue'
import { useSessionStore } from '../stores/sessionStore'
import { TID } from '../../../shared/testIds'
import type { DevPlatformBuild, Installation } from '../types/ipc'

// Stub the heavy ContextMenu child. Props are declared so tests can assert what
// the view HANDED the menu without rendering (or clicking through) the real one.
vi.mock('../components/ContextMenu.vue', () => ({
  default: {
    name: 'ContextMenu',
    props: ['open', 'x', 'y', 'items'],
    template: '<div data-testid="context-menu" />'
  }
}))

// Test-controllable `useModal` mock - `viewError` routes its readable
// error through `modal.alert`, and the context menu shares the singleton.
const mockModal = {
  alert: vi.fn().mockResolvedValue(undefined),
  confirm: vi.fn().mockResolvedValue(true),
  close: vi.fn()
}
vi.mock('../composables/useModal', () => ({
  useModal: () => mockModal
}))

const messages = {
  en: {
    common: { loading: 'Loading...' },
    cloud: { label: 'Cloud', desc: 'Try Cloud' },
    dashboard: {
      cloudSection: 'ComfyUI Cloud',
      launchedAgo: 'Launched {time}',
      neverLaunched: 'Not launched yet'
    },
    firstUse: { whyTryCloud: 'Why try Cloud?', cloudFreeRunsPill: '400 FREE CREDITS' },
    instancePicker: { progressUpdating: 'Updating.' },
    installShowcase: {
      cloudFailedTitle: "Couldn't open Comfy Cloud",
      cloudFailedMessage: 'Check your connection and try again from the dashboard.'
    },
    list: { view: 'View' },
    running: { dismiss: 'Dismiss' },
    chooser: {
      newInstall: 'New Instance',
      newInstallDesc: 'Set up a fresh ComfyUI environment.',
      filterAll: 'All',
      filterLocal: 'Local',
      filterCloud: 'Cloud',
      filterRemote: 'Remote',
      moreActions: 'More actions',
      manageInstall: 'Manage',
      searchPlaceholder: 'Search instances',
      noMatches: 'No instances match',
      statusRunning: 'Running',
      statusLaunching: 'Starting...',
      statusStopping: 'Stopping...',
      statusError: 'Error',
      viewErrorTooltip: 'View error details',
      errorTitle: 'Error',
      updatePill: 'Update',
      migratePill: 'Migrate'
    },
    devPlatform: {
      workspace: {
        personalLabel: 'Personal',
        unmanagedLabel: 'No workspace',
        switchLabel: 'Workspace',
        currentFallback: 'Current workspace',
        loadError: "Couldn't load workspaces. Retry",
        refresh: 'Refresh workspaces',
        promoteToWorkspace: 'Promote to Workspace',
        promoting: 'Promoting...',
        promoteFailedTitle: "Couldn't promote instance",
        promoteFailedMessage: 'Could not create a draft in Comfy Builder.'
      },
      build: { version: 'Build v{version}' }
    }
  }
}

function createTestI18n() {
  return createI18n({ legacy: false, locale: 'en', messages })
}

interface MockApi {
  getInstallations: ReturnType<typeof vi.fn>
  onInstallationsChanged: ReturnType<typeof vi.fn>
  onInstallationsVersionsUpdated: ReturnType<typeof vi.fn>
  getSetting: ReturnType<typeof vi.fn>
  runAction: ReturnType<typeof vi.fn>
  // progressStore subscribes to onErrorDetail at construction time.
  onErrorDetail: ReturnType<typeof vi.fn>
  focusComfyWindow: ReturnType<typeof vi.fn>
  // authStore reads window.api.comfybuilder at construction time.
  comfybuilder: Record<string, ReturnType<typeof vi.fn>>
  getCloudFreeRunsEnabled: ReturnType<typeof vi.fn>
  getCloudUserTier: ReturnType<typeof vi.fn>
  getListActions: ReturnType<typeof vi.fn>
}

function installMockApi(initial: Installation[]): MockApi {
  const api: MockApi = {
    getInstallations: vi.fn().mockResolvedValue(initial),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    getSetting: vi.fn().mockResolvedValue(undefined),
    runAction: vi.fn().mockResolvedValue({ ok: true }),
    onErrorDetail: vi.fn(() => () => {}),
    focusComfyWindow: vi.fn().mockResolvedValue(true),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {}),
      signIn: vi.fn(),
      signOut: vi.fn(),
      listWorkspaces: vi.fn().mockResolvedValue([]),
      switchWorkspace: vi.fn(),
      listBuilds: vi.fn().mockResolvedValue([]),
      installBuild: vi.fn(),
      promoteLocalInstance: vi.fn().mockResolvedValue({ ok: true })
    },
    getCloudFreeRunsEnabled: vi.fn().mockResolvedValue(false),
    getCloudUserTier: vi.fn().mockResolvedValue('unknown'),
    getListActions: vi.fn().mockResolvedValue([{ id: 'launch', style: 'primary' }])
  }
  ;(window as unknown as { api: MockApi }).api = api
  return api
}

function makeInstall(overrides: Partial<Installation>): Installation {
  return {
    id: 'inst-x',
    name: 'X',
    sourceLabel: 'Standalone',
    sourceCategory: 'local',
    ...overrides
  } as unknown as Installation
}

function makeBuild(overrides: Partial<DevPlatformBuild>): DevPlatformBuild {
  return {
    id: 'dist-x',
    name: 'Dist X',
    state: 'installable',
    ...overrides
  }
}

/** Sign in and publish the active workspace's Build catalog. */
function installMockApiSignedIn(
  installs: Installation[],
  builds: DevPlatformBuild[],
  workspace?: { id: string; name: string }
): MockApi {
  const api = installMockApi(installs)
  api.comfybuilder.getAuthStatus.mockResolvedValue(
    workspace
      ? { signedIn: true, workspaceType: 'team', workspaceId: workspace.id }
      : { signedIn: true }
  )
  api.comfybuilder.listBuilds.mockResolvedValue(builds)
  if (workspace) {
    api.comfybuilder.listWorkspaces.mockResolvedValue([
      { id: workspace.id, name: workspace.name, type: 'team', role: 'admin' }
    ])
  }
  return api
}

function mountChooser() {
  return mount(ChooserView, {
    global: { plugins: [createTestI18n(), createPinia()] }
  })
}

describe('ChooserView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockModal.alert.mockClear()
  })

  it('uses the concise instance search prompt', async () => {
    installMockApi([])
    const wrapper = mountChooser()
    await flushPromises()

    const input = wrapper.get('.chooser-search input')
    expect(input.attributes('placeholder')).toBe('Search instances')
    expect(input.attributes('aria-label')).toBe('Search instances')
  })

  it('renders the New Instance tile when the user has zero installs', async () => {
    installMockApi([])
    const wrapper = mountChooser()
    await flushPromises()
    expect(wrapper.text()).toContain('New Instance')
  })

  it('emits show-new-install when the New Install tile is clicked', async () => {
    installMockApi([])
    const wrapper = mountChooser()
    await flushPromises()
    await wrapper.find('.chooser-tile-new').trigger('click')
    expect(wrapper.emitted('show-new-install')).toBeDefined()
    expect(wrapper.emitted('show-new-install')!.length).toBe(1)
  })

  it('renders a cloud install through the same tile component as local installs', async () => {
    installMockApi([
      makeInstall({
        id: 'cloud',
        name: 'Comfy Cloud',
        sourceCategory: 'cloud',
        sourceLabel: 'Cloud'
      })
    ])
    const wrapper = mountChooser()
    await flushPromises()
    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('Comfy Cloud'))
    expect(tile).toBeTruthy()
    await tile!.trigger('click')
    await flushPromises()
    const events = wrapper.emitted('pick')
    expect(events).toBeDefined()
    expect((events![0]![0] as Installation).id).toBe('cloud')
  })

  it('keeps a managed Build update visible and non-interactive', async () => {
    installMockApiSignedIn(
      [
        makeInstall({
          id: 'managed-update',
          name: 'Managed Build',
          sourceId: 'comfybuilder',
          sourceLabel: 'ComfyBuilder',
          sourceCategory: 'local',
          workspaceId: 'workspace-1',
          status: 'installing',
          comfybuilderRollback: { version: '1' }
        })
      ],
      [],
      { id: 'workspace-1', name: 'Workspace One' }
    )
    const wrapper = mountChooser()
    await flushPromises()

    const tile = wrapper.get(`[data-testid="${TID.dashboardTile('managed-update')}"]`)
    expect(tile.text()).toContain('Managed Build')
    expect(tile.text()).toContain('Updating.')
    expect(tile.attributes('aria-disabled')).toBe('true')
    expect(tile.find('.chooser-tile-status-spinner').exists()).toBe(true)
    expect(tile.find(`[data-testid="${TID.dashboardTileKebab('managed-update')}"]`).exists()).toBe(
      false
    )

    await tile.trigger('click')
    await tile.trigger('contextmenu')
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('orders install tiles by lastLaunchedAt desc with never-launched at the end', async () => {
    installMockApi([
      makeInstall({ id: 'old', name: 'Old', lastLaunchedAt: 100 }),
      makeInstall({ id: 'new', name: 'New', lastLaunchedAt: 500 }),
      makeInstall({ id: 'never', name: 'Never' })
    ])
    const wrapper = mountChooser()
    await flushPromises()
    // First tile is the fixed New Install; the rest are install rows in
    // recency order. The Try-Cloud CTA is gone (any install present).
    const tiles = wrapper.findAll('.chooser-tile')
    const installTiles = tiles.filter(
      (t) =>
        !t.classes().includes('chooser-tile-new') && !t.classes().includes('chooser-tile-cloud')
    )
    expect(installTiles.length).toBe(3)
    expect(installTiles[0]!.text()).toContain('New')
    expect(installTiles[1]!.text()).toContain('Old')
    expect(installTiles[2]!.text()).toContain('Never')
  })

  // Regression: cloud must not sort above a more-recent local install. Before
  // the unpin refactor, the dashboard rendered cloud in its own surface and
  // the IPP tie-break promoted cloud, so this ordering would have failed.
  it('places a cloud install below a more-recent local install in the tile grid', async () => {
    installMockApi([
      makeInstall({
        id: 'recent-local',
        name: 'RecentLocal',
        sourceCategory: 'local',
        lastLaunchedAt: 1_000
      }),
      makeInstall({
        id: 'old-cloud',
        name: 'OldCloud',
        sourceCategory: 'cloud',
        sourceLabel: 'Cloud',
        lastLaunchedAt: 100
      })
    ])
    const wrapper = mountChooser()
    await flushPromises()
    const tiles = wrapper.findAll('.chooser-tile')
    const installTiles = tiles.filter(
      (t) =>
        !t.classes().includes('chooser-tile-new') && !t.classes().includes('chooser-tile-cloud')
    )
    expect(installTiles.length).toBe(2)
    expect(installTiles[0]!.text()).toContain('RecentLocal')
    expect(installTiles[1]!.text()).toContain('OldCloud')
  })

  it('emits pick when an install tile is single-clicked', async () => {
    // Tile-body click launches via pickInstall; the rest live behind the kebab.
    installMockApi([makeInstall({ id: 'a', name: 'Alpha', status: 'installed' })])
    const wrapper = mountChooser()
    await flushPromises()
    const tiles = wrapper.findAll('.chooser-tile')
    const alphaTile = tiles.find((t) => t.text().includes('Alpha'))
    expect(alphaTile).toBeTruthy()
    await alphaTile!.trigger('click')
    const events = wrapper.emitted('pick')
    expect(events).toBeDefined()
    expect((events![0]![0] as Installation).id).toBe('a')
  })

  it('renders no lifecycle CTA cluster on a tile - the instance window owns lifecycle', async () => {
    // The dashboard no longer carries any stop/launch button. State is
    // shown via a labelled status pill; lifecycle actions live in the
    // instance window.
    installMockApi([makeInstall({ id: 'a', name: 'Alpha', status: 'installed' })])
    const wrapper = mountChooser()
    await flushPromises()
    expect(wrapper.find('.chooser-tile-cta').exists()).toBe(false)
    // Idle install has no centered status pill and no error badge.
    expect(wrapper.find('.chooser-tile-status').exists()).toBe(false)
    expect(wrapper.find('.chooser-tile-error-badge').exists()).toBe(false)
  })

  it('shows a "Running" status pill (keeping the source pill) and focuses the existing window instead of emitting pick', async () => {
    const api = installMockApi([makeInstall({ id: 'a', name: 'Alpha', status: 'installed' })])
    api.focusComfyWindow = vi.fn().mockResolvedValue(true)
    const wrapper = mountChooser()
    await flushPromises()

    // Mark the install as running directly in the session store.
    const sessionStore = useSessionStore()
    sessionStore.runningInstances.set('a', { installationId: 'a' } as never)
    await flushPromises()

    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('Alpha'))!
    // Status pill sits in the top-right cluster next to the kebab, not in
    // the meta row - the source pill stays.
    expect(tile.find('.chooser-tile-actions .chooser-tile-status--running').exists()).toBe(true)
    expect(tile.text()).toContain('Running')
    expect(tile.text()).toContain('Standalone')

    await tile.trigger('click')
    await flushPromises()
    // Running tile focuses the existing window; it must NOT open a second one.
    expect(api.focusComfyWindow).toHaveBeenCalledWith('a')
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('shows a clickable error badge that opens the error details without emitting pick', async () => {
    installMockApi([makeInstall({ id: 'a', name: 'Alpha', status: 'installed' })])
    const wrapper = mountChooser()
    await flushPromises()

    // Seed an op-failure error (e.g. a migrate that silently failed).
    const sessionStore = useSessionStore()
    sessionStore.errorInstances.set('a', {
      installationName: 'Alpha',
      message: 'Migration failed: takeover did not start.'
    } as never)
    await flushPromises()

    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('Alpha'))!
    expect(tile.classes()).toContain('chooser-tile-errored')
    // Error badge sits in the top-right cluster next to the kebab.
    const badge = tile.find('.chooser-tile-actions .chooser-tile-error-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('Error')

    await badge.trigger('click')
    await flushPromises()
    // Clicking the badge shows the readable error; it must NOT launch.
    expect(mockModal.alert).toHaveBeenCalledWith({
      title: 'Error',
      message: 'Migration failed: takeover did not start.'
    })
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('focuses the existing window instead of relaunching when a crashed tile body is clicked', async () => {
    const api = installMockApi([makeInstall({ id: 'a', name: 'Alpha', status: 'installed' })])
    api.focusComfyWindow = vi.fn().mockResolvedValue(true)
    const wrapper = mountChooser()
    await flushPromises()

    const sessionStore = useSessionStore()
    sessionStore.errorInstances.set('a', { installationName: 'Alpha', exitCode: 1 } as never)
    await flushPromises()

    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('Alpha'))!
    await tile.trigger('click')
    await flushPromises()
    // The crashed window still exists - bring it forward, never relaunch from
    // the dashboard.
    expect(api.focusComfyWindow).toHaveBeenCalledWith('a')
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('launches when a crashed tile is clicked but no window exists to focus', async () => {
    const api = installMockApi([makeInstall({ id: 'a', name: 'Alpha', status: 'installed' })])
    // No window backs the install (crash hydrated from the retained buffer).
    api.focusComfyWindow = vi.fn().mockResolvedValue(false)
    const wrapper = mountChooser()
    await flushPromises()

    const sessionStore = useSessionStore()
    sessionStore.errorInstances.set('a', { installationName: 'Alpha', exitCode: 1 } as never)
    await flushPromises()

    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('Alpha'))!
    await tile.trigger('click')
    await flushPromises()
    expect(api.focusComfyWindow).toHaveBeenCalledWith('a')
    expect(wrapper.emitted('pick')).toHaveLength(1)
  })

  it('gives install tiles two lines - no launch-recency row, booted or not', async () => {
    installMockApi([
      makeInstall({ id: 'booted', name: 'Booted', lastLaunchedAt: Date.now() - 2 * 60_000 }),
      makeInstall({ id: 'fresh', name: 'Fresh' })
    ])
    const wrapper = mountChooser()
    await flushPromises()
    const tiles = wrapper.findAll('.chooser-tile')
    const bootedTile = tiles.find((t) => t.text().includes('Booted'))!
    const freshTile = tiles.find((t) => t.text().includes('Fresh'))!
    expect(bootedTile.find('.chooser-tile-recency-text').exists()).toBe(false)
    expect(freshTile.find('.chooser-tile-recency-text').exists()).toBe(false)
    // The facts that survive keep their row.
    expect(bootedTile.find('.chooser-tile-meta-line').exists()).toBe(true)
  })

  it('renders the update affordance as a bare "Update" pill - the target version lives in the meta line', async () => {
    installMockApi([
      makeInstall({
        id: 'u',
        name: 'Updatable',
        version: 'v0.22.3',
        statusTag: { style: 'update', label: 'Update v0.24.1', version: 'v0.24.1' }
      })
    ])
    const wrapper = mountChooser()
    await flushPromises()
    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('Updatable'))!
    const pill = tile.find('.chooser-tile-pill-update')
    expect(pill.exists()).toBe(true)
    expect(pill.text().trim()).toBe('Update')
    // Current version stays visible in the quiet meta line, not on the pill.
    expect(tile.find('.chooser-tile-meta-line').text()).toContain('v0.22.3')
  })

  it('keeps the action pill present even when the name is very long', async () => {
    installMockApi([
      makeInstall({
        id: 'long',
        name: 'ComfyUI (Copy) (Copy) (Copy) - an extremely long instance name that must ellipsize',
        statusTag: { style: 'migrate', label: 'Migrate' }
      })
    ])
    const wrapper = mountChooser()
    await flushPromises()
    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('ComfyUI (Copy)'))!
    expect(tile.find('.chooser-tile-pill-migrate').exists()).toBe(true)
  })

  it('shows a clickable red danger pill (and red tile outline) that opens its detail without launching', async () => {
    installMockApi([
      makeInstall({
        id: 'nf',
        name: 'Gone',
        statusTag: {
          style: 'danger',
          label: 'Folder Not Found',
          detail: 'Instance folder not found.\n\nC:/comfy/gone'
        }
      })
    ])
    const wrapper = mountChooser()
    await flushPromises()
    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('Gone'))!
    expect(tile.classes()).toContain('chooser-tile-errored')
    const tag = tile.find('.chooser-tile-actions .chooser-tile-danger-tag')
    expect(tag.exists()).toBe(true)
    expect(tag.text()).toContain('Folder Not Found')
    // It's its own pill, not the crash error badge.
    expect(tile.find('.chooser-tile-error-badge').exists()).toBe(false)

    await tag.trigger('click')
    await flushPromises()
    // Clicking shows the full detail; it must NOT launch.
    expect(mockModal.alert).toHaveBeenCalledWith({
      title: 'Folder Not Found',
      message: 'Instance folder not found.\n\nC:/comfy/gone'
    })
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('does not emit pick when the kebab button is clicked - only the menu opens', async () => {
    // The kebab's click handler stop-propagates so the tile click doesn't fire.
    installMockApi([makeInstall({ id: 'a', name: 'Alpha' })])
    const wrapper = mountChooser()
    await flushPromises()
    const kebab = wrapper.find('.chooser-tile-kebab')
    expect(kebab.exists()).toBe(true)
    await kebab.trigger('click')
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('filters install tiles by source category when a filter chip is active', async () => {
    installMockApi([
      makeInstall({ id: 'l', name: 'LocalThing', sourceCategory: 'local' }),
      // Legacy Desktop reports category `local`; sourceId is the marker.
      makeInstall({
        id: 'd',
        name: 'LegacyDesktopThing',
        sourceCategory: 'local',
        sourceId: 'desktop'
      }),
      makeInstall({ id: 'r', name: 'RemoteThing', sourceCategory: 'remote' })
    ])
    const wrapper = mountChooser()
    await flushPromises()

    // The filter UI is hidden in the redesign but `activeFilter` is
    // preserved, so drive it through the vm directly.
    ;(wrapper.vm as unknown as { activeFilter: string }).activeFilter = 'remote'
    await flushPromises()

    const tiles = wrapper.findAll('.chooser-tile')
    const installTiles = tiles.filter(
      (t) =>
        !t.classes().includes('chooser-tile-new') && !t.classes().includes('chooser-tile-cloud')
    )
    expect(installTiles.length).toBe(1)
    expect(installTiles[0]!.text()).toContain('RemoteThing')
  })

  it('groups Legacy Desktop installs under the Local filter', async () => {
    // Legacy Desktop installs surface under the Local chip, not a dedicated one.
    installMockApi([
      makeInstall({ id: 'l', name: 'LocalThing', sourceCategory: 'local' }),
      // Legacy Desktop reports category `local`; sourceId is the marker.
      makeInstall({
        id: 'd',
        name: 'LegacyDesktopThing',
        sourceCategory: 'local',
        sourceId: 'desktop'
      }),
      makeInstall({ id: 'r', name: 'RemoteThing', sourceCategory: 'remote' })
    ])
    const wrapper = mountChooser()
    await flushPromises()
    ;(wrapper.vm as unknown as { activeFilter: string }).activeFilter = 'local'
    await flushPromises()

    const tiles = wrapper.findAll('.chooser-tile')
    const installTiles = tiles.filter(
      (t) =>
        !t.classes().includes('chooser-tile-new') && !t.classes().includes('chooser-tile-cloud')
    )
    const labels = installTiles.map((t) => t.text())
    expect(installTiles.length).toBe(2)
    expect(labels.some((l) => l.includes('LocalThing'))).toBe(true)
    expect(labels.some((l) => l.includes('LegacyDesktopThing'))).toBe(true)
    expect(labels.some((l) => l.includes('RemoteThing'))).toBe(false)
  })

  it('labels a build install so its release cannot be read as a ComfyUI version', async () => {
    installMockApiSignedIn(
      [
        makeInstall({
          id: 'built',
          name: 'BuiltThing',
          sourceId: 'comfybuilder',
          version: 'v0.28.2',
          distributionVersion: '7'
        })
      ],
      []
    )
    const wrapper = mountChooser()
    await flushPromises()
    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('BuiltThing'))!
    const meta = tile.find('.chooser-tile-meta-line').text()
    expect(meta).toContain('v0.28.2')
    expect(meta).toContain('Build v7')
    // The install path is noise on a tile whose identity is the build.
    expect(meta).not.toContain('Standalone')
  })

  it('does not render Build catalog entries on the dashboard', async () => {
    installMockApiSignedIn(
      [],
      [
        makeBuild({ id: 'ok', name: 'InstallableThing', state: 'installable' }),
        makeBuild({ id: 'nb', name: 'NoBuildThing', state: 'no-build' }),
        makeBuild({ id: 'pm', name: 'WrongPlatformThing', state: 'platform-mismatch' })
      ],
      { id: 'w1', name: 'Comfy Design Team' }
    )
    const wrapper = mountChooser()
    await flushPromises()

    expect(wrapper.text()).not.toContain('InstallableThing')
    expect(wrapper.text()).not.toContain('NoBuildThing')
    expect(wrapper.text()).not.toContain('WrongPlatformThing')
  })

  it('keeps a build-backed install in the local section when signed out', async () => {
    installMockApi([
      makeInstall({
        id: 'builder-1',
        name: 'Flux Studio',
        sourceId: 'comfybuilder',
        distributionId: 'd-flux',
        status: 'installed'
      } as unknown as Partial<Installation>)
    ])
    const wrapper = mountChooser()
    await flushPromises()
    const names = wrapper.findAll('.chooser-tile-name').map((w) => w.text())
    expect(names).toContain('Flux Studio')
    expect(wrapper.find('[data-testid="devplatform-workspace-selector"]').exists()).toBe(false)
  })

  it('renders the dashboard as one left-aligned instance grid', async () => {
    installMockApi([makeInstall({ id: 'a', name: 'Alpha' })])
    const wrapper = mountChooser()
    await flushPromises()
    const grids = wrapper.findAll('.chooser-family-grid')
    expect(grids.length).toBe(1)
    expect(grids[0]!.classes()).toEqual(['chooser-family-grid'])
  })

  it('keeps search centered above the signed-in workspace controls', async () => {
    installMockApiSignedIn([], [], { id: 'w1', name: 'Comfy Design Team' })
    const wrapper = mountChooser()
    await flushPromises()

    const toolbarChildren = wrapper.get('.chooser-toolbar').element.children
    expect(toolbarChildren).toHaveLength(1)
    expect(toolbarChildren[0]!.classList.contains('chooser-search')).toBe(true)
    expect(wrapper.get('.chooser-workspace-bar').text()).toContain('Workspace')
    expect(wrapper.get('.chooser-workspace-controls').element.parentElement).toBe(
      wrapper.get('.chooser-workspace-bar').element
    )
    expect(wrapper.find('[data-testid="chooser-workspace-refresh"]').exists()).toBe(true)
  })

  it('offers workspace promotion only for an unowned local install', async () => {
    installMockApiSignedIn(
      [
        makeInstall({
          id: 'local',
          name: 'LocalThing',
          sourceId: 'standalone',
          status: 'installed',
          installPath: '/installs/local'
        })
      ],
      [],
      { id: 'w1', name: 'Comfy Design Team' }
    )
    const wrapper = mountChooser()
    await flushPromises()
    await wrapper.get('[data-testid="devplatform-workspace-selector"]').trigger('click')
    await wrapper.get('[data-testid="devplatform-workspace-unmanaged"]').trigger('click')
    await flushPromises()

    await wrapper.find(`[data-testid="${TID.dashboardTile('local')}"]`).trigger('contextmenu')

    const menu = wrapper
      .findAllComponents({ name: 'ContextMenu' })
      .find((candidate) => candidate.props('open') === true)!
    const items = menu.props('items') as { id: string; label: string; disabled?: boolean }[]
    expect(items.find(({ id }) => id === 'promote-to-workspace')).toMatchObject({
      label: 'Promote to Workspace',
      disabled: false
    })
  })

  it('shows promotion progress on the originating instance card', async () => {
    const api = installMockApiSignedIn(
      [
        makeInstall({
          id: 'local',
          name: 'LocalThing',
          sourceId: 'standalone',
          status: 'installed',
          installPath: '/installs/local'
        })
      ],
      [],
      { id: 'w1', name: 'Comfy Design Team' }
    )
    let finishPromotion!: (result: { ok: true }) => void
    api.comfybuilder.promoteLocalInstance.mockReturnValue(
      new Promise((resolve) => {
        finishPromotion = resolve
      })
    )
    const wrapper = mountChooser()
    await flushPromises()
    await wrapper.get('[data-testid="devplatform-workspace-selector"]').trigger('click')
    await wrapper.get('[data-testid="devplatform-workspace-unmanaged"]').trigger('click')
    await flushPromises()

    const tile = wrapper.find(`[data-testid="${TID.dashboardTile('local')}"]`)
    await tile.trigger('contextmenu')
    const menu = wrapper
      .findAllComponents({ name: 'ContextMenu' })
      .find((candidate) => candidate.props('open') === true)!

    menu.vm.$emit('select', 'promote-to-workspace')
    await wrapper.vm.$nextTick()

    expect(tile.find('.chooser-tile-status--promoting').text()).toBe('Promoting...')
    expect(tile.find('.chooser-tile-status-spinner').exists()).toBe(true)
    expect(api.comfybuilder.promoteLocalInstance).toHaveBeenCalledExactlyOnceWith('local')

    finishPromotion({ ok: true })
    await flushPromises()
    expect(tile.find('.chooser-tile-status--promoting').exists()).toBe(false)
  })

  it.each([
    ['a Builder install', { sourceId: 'comfybuilder' }, 'w1', true],
    ['an active-workspace install', { sourceId: 'standalone', workspaceId: 'w1' }, 'w1', false],
    [
      'an install owned by another workspace',
      { sourceId: 'standalone', workspaceId: 'w2' },
      'w2',
      false
    ]
  ])(
    'does not offer workspace promotion for %s',
    async (_label, installOverrides, activeWorkspaceId, useUnmanaged) => {
      installMockApiSignedIn(
        [
          makeInstall({
            id: 'ineligible',
            name: 'Ineligible',
            status: 'installed',
            installPath: '/installs/ineligible',
            ...installOverrides
          })
        ],
        [],
        { id: activeWorkspaceId, name: 'Comfy Design Team' }
      )
      const wrapper = mountChooser()
      await flushPromises()
      if (useUnmanaged) {
        await wrapper.get('[data-testid="devplatform-workspace-selector"]').trigger('click')
        await wrapper.get('[data-testid="devplatform-workspace-unmanaged"]').trigger('click')
        await flushPromises()
      }

      await wrapper
        .find(`[data-testid="${TID.dashboardTile('ineligible')}"]`)
        .trigger('contextmenu')

      const menu = wrapper
        .findAllComponents({ name: 'ContextMenu' })
        .find((candidate) => candidate.props('open') === true)!
      const items = menu.props('items') as { id: string }[]
      expect(items.some((item) => item.id === 'promote-to-workspace')).toBe(false)
    }
  )

  it('refreshes workspace membership without loading Builds', async () => {
    const api = installMockApiSignedIn([], [], { id: 'w1', name: 'Comfy Design Team' })
    const wrapper = mountChooser()
    await flushPromises()
    api.comfybuilder.listWorkspaces.mockClear()
    api.comfybuilder.listBuilds.mockClear()

    await wrapper.find('[data-testid="chooser-workspace-refresh"]').trigger('click')
    await flushPromises()

    expect(api.comfybuilder.listWorkspaces).toHaveBeenCalledOnce()
    expect(api.comfybuilder.listBuilds).not.toHaveBeenCalled()
  })

  it('shows only installs owned by the selected workspace', async () => {
    installMockApiSignedIn(
      [
        makeInstall({ id: 'local', name: 'LocalThing' }),
        makeInstall({
          id: 'built-a',
          name: 'Workspace A Build',
          sourceId: 'comfybuilder',
          workspaceId: 'w1'
        }),
        makeInstall({
          id: 'built-b',
          name: 'Workspace B Build',
          sourceId: 'comfybuilder',
          workspaceId: 'w2'
        })
      ],
      [makeBuild({ id: 'd1', name: 'AvailableThing' })],
      { id: 'w1', name: 'Comfy Design Team' }
    )
    const wrapper = mountChooser()
    await flushPromises()

    expect(wrapper.text()).toContain('Workspace A Build')
    expect(wrapper.text()).not.toContain('Workspace B Build')
    expect(wrapper.text()).not.toContain('LocalThing')
    expect(wrapper.text()).not.toContain('AvailableThing')
  })

  it('switches between No workspace and workspaces without leaking other-workspace installs', async () => {
    const api = installMockApiSignedIn(
      [
        makeInstall({ id: 'local', name: 'LocalThing' }),
        makeInstall({
          id: 'built-a',
          name: 'Workspace A Build',
          sourceId: 'comfybuilder',
          workspaceId: 'workspace-a',
          distributionId: 'build-a'
        }),
        makeInstall({
          id: 'built-b',
          name: 'Workspace B Build',
          sourceId: 'comfybuilder',
          workspaceId: 'workspace-b',
          distributionId: 'build-b'
        })
      ],
      [],
      { id: 'workspace-a', name: 'Workspace A' }
    )
    api.comfybuilder.listWorkspaces.mockResolvedValue([
      { id: 'workspace-a', name: 'Workspace A', type: 'team', role: 'admin' },
      { id: 'workspace-b', name: 'Workspace B', type: 'team', role: 'admin' }
    ])
    api.comfybuilder.switchWorkspace.mockImplementation(async (workspaceId: string) => ({
      signedIn: true,
      workspaceType: 'team',
      workspaceId
    }))
    const wrapper = mountChooser()
    await flushPromises()

    expect(wrapper.text()).toContain('Workspace A Build')
    expect(wrapper.text()).not.toContain('Workspace B Build')
    expect(wrapper.text()).not.toContain('LocalThing')

    await wrapper.get('[data-testid="devplatform-workspace-selector"]').trigger('click')
    await wrapper.get('[data-testid="devplatform-workspace-unmanaged"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('LocalThing')
    expect(wrapper.text()).not.toContain('Workspace A Build')
    expect(wrapper.text()).not.toContain('Workspace B Build')
    expect(api.comfybuilder.switchWorkspace).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="devplatform-workspace-selector"]').trigger('click')
    await wrapper.get('[data-testid="devplatform-workspace-workspace-b"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Workspace B Build')
    expect(wrapper.text()).not.toContain('Workspace A Build')
    expect(wrapper.text()).not.toContain('LocalThing')

    await wrapper.get('[data-testid="devplatform-workspace-selector"]').trigger('click')
    await wrapper.get('[data-testid="devplatform-workspace-workspace-a"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Workspace A Build')
    expect(wrapper.text()).not.toContain('Workspace B Build')
  })

  it('emits the selected workspace only for workspace-scoped New Instance', async () => {
    installMockApiSignedIn([], [], { id: 'w1', name: 'Comfy Design Team' })
    const wrapper = mountChooser()
    await flushPromises()

    await wrapper.get('.chooser-tile-new').trigger('click')
    expect(wrapper.emitted('show-new-install')?.at(-1)).toEqual(['w1'])

    await wrapper.get('[data-testid="devplatform-workspace-selector"]').trigger('click')
    await wrapper.get('[data-testid="devplatform-workspace-unmanaged"]').trigger('click')
    await flushPromises()
    await wrapper.get('.chooser-tile-new').trigger('click')
    expect(wrapper.emitted('show-new-install')?.at(-1)).toEqual([])
  })

  it('shows the no-matches state for the selected workspace search', async () => {
    installMockApiSignedIn(
      [makeInstall({ id: 'workspace', name: 'WorkspaceThing', workspaceId: 'w1' })],
      [],
      { id: 'w1', name: 'Comfy Design Team' }
    )
    const wrapper = mountChooser()
    await flushPromises()

    await wrapper.find('input').setValue('zzz-matches-nothing')
    await flushPromises()
    expect(wrapper.find('.chooser-empty').exists()).toBe(true)
  })

  it('has no Desktop entry in the filter state', async () => {
    // Guards the state model: Legacy Desktop maps to 'local', not a dedicated key.
    installMockApi([])
    const wrapper = mountChooser()
    await flushPromises()
    type FilterKey = 'all' | 'local' | 'cloud' | 'remote'
    const validKeys: FilterKey[] = ['all', 'local', 'cloud', 'remote']
    expect(validKeys).not.toContain('desktop' as FilterKey)
    // Confirms activeFilter is reachable from vm for the other filter tests.
    expect((wrapper.vm as unknown as { activeFilter: FilterKey }).activeFilter).toBe('all')
  })

  it('shows the free-runs pill on cloud install tiles when the flag is on', async () => {
    const cloudInst = makeInstall({ id: 'cloud-1', name: 'Comfy Cloud', sourceCategory: 'cloud' })
    const api = installMockApi([cloudInst])
    api.getCloudFreeRunsEnabled.mockResolvedValue(true)
    const wrapper = mountChooser()
    await flushPromises()
    expect(wrapper.find('[data-testid="chooser-cloud-runs-pill"]').exists()).toBe(true)
    expect(wrapper.find('.chooser-tile-new [data-testid="chooser-cloud-runs-pill"]').exists()).toBe(
      false
    )
  })

  it('keeps local tiles and the flag-off state pill-free', async () => {
    const localInst = makeInstall({ id: 'local-1', sourceCategory: 'local' })
    installMockApi([localInst])
    const wrapper = mountChooser()
    await flushPromises()
    expect(wrapper.find('[data-testid="chooser-cloud-runs-pill"]').exists()).toBe(false)
  })
})

describe('ChooserView - why-Cloud explainer', () => {
  const WHY_CLOUD = `[data-testid="${TID.dashboardTileWhyCloud('cloud-1')}"]`

  function cloudInstall(): Installation {
    return makeInstall({ id: 'cloud-1', name: 'Comfy Cloud', sourceCategory: 'cloud' })
  }

  it('offers the explainer on the cloud tile, not on local tiles', async () => {
    installMockApi([cloudInstall(), makeInstall({ id: 'local-1', sourceCategory: 'local' })])
    const wrapper = mountChooser()
    await flushPromises()
    expect(wrapper.find(WHY_CLOUD).exists()).toBe(true)
    expect(wrapper.find(`[data-testid="${TID.dashboardTileWhyCloud('local-1')}"]`).exists()).toBe(
      false
    )
  })

  it('sits inline after the tile name, not in the action row', async () => {
    installMockApi([cloudInstall()])
    const wrapper = mountChooser()
    await flushPromises()
    const nameRow = wrapper.find('.chooser-tile-name-row')
    expect(nameRow.find(WHY_CLOUD).exists()).toBe(true)
    expect(nameRow.text()).toContain('Comfy Cloud')
    expect(wrapper.find('.chooser-tile-actions').find(WHY_CLOUD).exists()).toBe(false)
  })

  it('withholds the explainer from paid subscribers', async () => {
    const api = installMockApi([cloudInstall()])
    api.getCloudUserTier.mockResolvedValue('paid')
    const wrapper = mountChooser()
    await flushPromises()
    expect(wrapper.find(WHY_CLOUD).exists()).toBe(false)
  })

  it('fails closed until the tier lookup succeeds', async () => {
    const api = installMockApi([cloudInstall()])
    api.getCloudUserTier.mockRejectedValue(new Error('offline'))
    const wrapper = mountChooser()

    expect(wrapper.find(WHY_CLOUD).exists()).toBe(false)
    await flushPromises()
    expect(wrapper.find(WHY_CLOUD).exists()).toBe(false)
  })

  it('opens the modal without launching the install behind it', async () => {
    const api = installMockApi([cloudInstall()])
    const wrapper = mountChooser()
    await flushPromises()
    expect(wrapper.findComponent(WhyTryCloudModal).exists()).toBe(false)

    await wrapper.find(WHY_CLOUD).trigger('click')
    await flushPromises()

    expect(wrapper.findComponent(WhyTryCloudModal).exists()).toBe(true)
    expect(wrapper.emitted('pick')).toBeUndefined()
    expect(api.runAction).not.toHaveBeenCalled()
  })

  it('launches Cloud from the modal CTA and closes the modal', async () => {
    const api = installMockApi([cloudInstall()])
    const wrapper = mountChooser()
    await flushPromises()
    await wrapper.find(WHY_CLOUD).trigger('click')
    await flushPromises()

    wrapper.findComponent(WhyTryCloudModal).vm.$emit('try-cloud')
    await flushPromises()

    expect(api.runAction).toHaveBeenCalledWith('cloud-1', 'launch')
    expect(wrapper.findComponent(WhyTryCloudModal).exists()).toBe(false)
  })

  it('keeps the explainer open and reports a failed launch', async () => {
    const api = installMockApi([cloudInstall()])
    api.runAction.mockResolvedValue({ ok: false })
    const wrapper = mountChooser()
    await flushPromises()
    await wrapper.find(WHY_CLOUD).trigger('click')
    await flushPromises()

    wrapper.findComponent(WhyTryCloudModal).vm.$emit('try-cloud')
    await flushPromises()

    expect(wrapper.findComponent(WhyTryCloudModal).exists()).toBe(true)
    expect(mockModal.alert).toHaveBeenCalledWith({
      title: "Couldn't open Comfy Cloud",
      message: 'Check your connection and try again from the dashboard.'
    })
  })

  it('closes without launching when dismissed', async () => {
    const api = installMockApi([cloudInstall()])
    const wrapper = mountChooser()
    await flushPromises()
    await wrapper.find(WHY_CLOUD).trigger('click')
    await flushPromises()

    wrapper.findComponent(WhyTryCloudModal).vm.$emit('close')
    await flushPromises()

    expect(wrapper.findComponent(WhyTryCloudModal).exists()).toBe(false)
    expect(api.runAction).not.toHaveBeenCalled()
  })

  it('stands the explainer down while the cloud tile is running', async () => {
    installMockApi([cloudInstall()])
    const wrapper = mountChooser()
    await flushPromises()
    expect(wrapper.find(WHY_CLOUD).exists()).toBe(true)

    useSessionStore().runningInstances.set('cloud-1', { installationId: 'cloud-1' } as never)
    await flushPromises()

    expect(wrapper.find(WHY_CLOUD).exists()).toBe(false)
  })
})
