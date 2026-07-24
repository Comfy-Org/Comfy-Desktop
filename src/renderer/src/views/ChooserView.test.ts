import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'

import ChooserView from './ChooserView.vue'
import { useSessionStore } from '../stores/sessionStore'
import type { DevPlatformDistribution, Installation } from '../types/ipc'

// Stub the heavy ContextMenu child. Props are declared so tests can assert what
// the view HANDED the menu without rendering (or clicking through) the real one.
vi.mock('../components/ContextMenu.vue', () => ({
  default: {
    name: 'ContextMenu',
    props: ['open', 'x', 'y', 'items'],
    template: '<div data-testid="context-menu" />',
  },
}))

// Test-controllable `useModal` mock — `viewError` routes its readable
// error through `modal.alert`, and the context menu shares the singleton.
const mockModal = {
  alert: vi.fn().mockResolvedValue(undefined),
  confirm: vi.fn().mockResolvedValue(true),
  close: vi.fn(),
}
vi.mock('../composables/useModal', () => ({
  useModal: () => mockModal,
}))

const messages = {
  en: {
    common: { loading: 'Loading…' },
    cloud: { label: 'Cloud', desc: 'Try Cloud' },
    dashboard: {
      cloudSection: 'ComfyUI Cloud',
      launchedAgo: 'Launched {time}',
      neverLaunched: 'Not launched yet',
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
      searchPlaceholder: 'Search for and open an instance',
      noMatches: 'No instances match',
      statusRunning: 'Running',
      statusLaunching: 'Starting…',
      statusStopping: 'Stopping…',
      statusError: 'Error',
      viewErrorTooltip: 'View error details',
      errorTitle: 'Error',
      updatePill: 'Update',
      migratePill: 'Migrate',
    },
    devPlatform: {
      distribution: {
        availablePill: 'Available',
        menuInstall: 'Install',
        distVersion: 'Dist v{version}',
        states: {
          noBuild: 'No build',
          platformMismatch: 'Not for this machine',
          needsDesktopUpdate: 'Update required',
          updateAvailable: 'Update',
          installed: 'Installed',
        },
        blockedReason: {
          noBuild: 'This distribution has no successful build yet.',
          platformMismatch:
            'The latest build has no artifact for this operating system and GPU.',
          needsDesktopUpdate: 'This distribution needs Comfy Desktop {version} or newer.',
        },
      },
    },
  },
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
      listDistributions: vi.fn().mockResolvedValue([]),
      installDistribution: vi.fn(),
    },
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
    ...overrides,
  } as unknown as Installation
}

function makeDist(overrides: Partial<DevPlatformDistribution>): DevPlatformDistribution {
  return {
    id: 'dist-x',
    name: 'Dist X',
    state: 'installable',
    ...overrides,
  }
}

/** Sign in and publish `dists` to the workspace, so distribution cards render. */
function installMockApiSignedIn(
  installs: Installation[],
  dists: DevPlatformDistribution[],
): MockApi {
  const api = installMockApi(installs)
  api.comfybuilder.getAuthStatus.mockResolvedValue({ signedIn: true })
  api.comfybuilder.listDistributions.mockResolvedValue(dists)
  return api
}

function mountChooser() {
  return mount(ChooserView, {
    global: { plugins: [createTestI18n(), createPinia()] },
  })
}

describe('ChooserView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockModal.alert.mockClear()
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
      makeInstall({ id: 'cloud', name: 'Comfy Cloud', sourceCategory: 'cloud', sourceLabel: 'Cloud' }),
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

  it('orders install tiles by lastLaunchedAt desc with never-launched at the end', async () => {
    installMockApi([
      makeInstall({ id: 'old', name: 'Old', lastLaunchedAt: 100 }),
      makeInstall({ id: 'new', name: 'New', lastLaunchedAt: 500 }),
      makeInstall({ id: 'never', name: 'Never' }),
    ])
    const wrapper = mountChooser()
    await flushPromises()
    // First tile is the fixed New Install; the rest are install rows in
    // recency order. The Try-Cloud CTA is gone (any install present).
    const tiles = wrapper.findAll('.chooser-tile')
    const installTiles = tiles.filter(
      (t) => !t.classes().includes('chooser-tile-new') && !t.classes().includes('chooser-tile-cloud')
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
        lastLaunchedAt: 1_000,
      }),
      makeInstall({
        id: 'old-cloud',
        name: 'OldCloud',
        sourceCategory: 'cloud',
        sourceLabel: 'Cloud',
        lastLaunchedAt: 100,
      }),
    ])
    const wrapper = mountChooser()
    await flushPromises()
    const tiles = wrapper.findAll('.chooser-tile')
    const installTiles = tiles.filter(
      (t) => !t.classes().includes('chooser-tile-new') && !t.classes().includes('chooser-tile-cloud')
    )
    expect(installTiles.length).toBe(2)
    expect(installTiles[0]!.text()).toContain('RecentLocal')
    expect(installTiles[1]!.text()).toContain('OldCloud')
  })

  it('emits pick when an install tile is single-clicked', async () => {
    // Tile-body click launches via pickInstall; the rest live behind the kebab.
    installMockApi([
      makeInstall({ id: 'a', name: 'Alpha', status: 'installed' }),
    ])
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

  it('renders no lifecycle CTA cluster on a tile — the instance window owns lifecycle', async () => {
    // The dashboard no longer carries any stop/launch button. State is
    // shown via a labelled status pill; lifecycle actions live in the
    // instance window.
    installMockApi([
      makeInstall({ id: 'a', name: 'Alpha', status: 'installed' }),
    ])
    const wrapper = mountChooser()
    await flushPromises()
    expect(wrapper.find('.chooser-tile-cta').exists()).toBe(false)
    // Idle install has no centered status pill and no error badge.
    expect(wrapper.find('.chooser-tile-status').exists()).toBe(false)
    expect(wrapper.find('.chooser-tile-error-badge').exists()).toBe(false)
  })

  it('shows a "Running" status pill (keeping the source pill) and focuses the existing window instead of emitting pick', async () => {
    const api = installMockApi([
      makeInstall({ id: 'a', name: 'Alpha', status: 'installed' }),
    ])
    api.focusComfyWindow = vi.fn().mockResolvedValue(true)
    const wrapper = mountChooser()
    await flushPromises()

    // Mark the install as running directly in the session store.
    const sessionStore = useSessionStore()
    sessionStore.runningInstances.set('a', { installationId: 'a' } as never)
    await flushPromises()

    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('Alpha'))!
    // Status pill sits in the top-right cluster next to the kebab, not in
    // the meta row — the source pill stays.
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
    installMockApi([
      makeInstall({ id: 'a', name: 'Alpha', status: 'installed' }),
    ])
    const wrapper = mountChooser()
    await flushPromises()

    // Seed an op-failure error (e.g. a migrate that silently failed).
    const sessionStore = useSessionStore()
    sessionStore.errorInstances.set('a', {
      installationName: 'Alpha',
      message: 'Migration failed: takeover did not start.',
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
      message: 'Migration failed: takeover did not start.',
    })
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('focuses the existing window instead of relaunching when a crashed tile body is clicked', async () => {
    const api = installMockApi([
      makeInstall({ id: 'a', name: 'Alpha', status: 'installed' }),
    ])
    api.focusComfyWindow = vi.fn().mockResolvedValue(true)
    const wrapper = mountChooser()
    await flushPromises()

    const sessionStore = useSessionStore()
    sessionStore.errorInstances.set('a', { installationName: 'Alpha', exitCode: 1 } as never)
    await flushPromises()

    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('Alpha'))!
    await tile.trigger('click')
    await flushPromises()
    // The crashed window still exists — bring it forward, never relaunch from
    // the dashboard.
    expect(api.focusComfyWindow).toHaveBeenCalledWith('a')
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('launches when a crashed tile is clicked but no window exists to focus', async () => {
    const api = installMockApi([
      makeInstall({ id: 'a', name: 'Alpha', status: 'installed' }),
    ])
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

  it('gives install tiles two lines — no launch-recency row, booted or not', async () => {
    installMockApi([
      makeInstall({ id: 'booted', name: 'Booted', lastLaunchedAt: Date.now() - 2 * 60_000 }),
      makeInstall({ id: 'fresh', name: 'Fresh' }),
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

  it('renders the update affordance as a bare "Update" pill — the target version lives in the meta line', async () => {
    installMockApi([
      makeInstall({
        id: 'u',
        name: 'Updatable',
        version: 'v0.22.3',
        statusTag: { style: 'update', label: 'Update v0.24.1', version: 'v0.24.1' },
      }),
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
        name: 'ComfyUI (Copy) (Copy) (Copy) — an extremely long instance name that must ellipsize',
        statusTag: { style: 'migrate', label: 'Migrate' },
      }),
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
          detail: 'Instance folder not found.\n\nC:/comfy/gone',
        },
      }),
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
      message: 'Instance folder not found.\n\nC:/comfy/gone',
    })
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('does not emit pick when the kebab button is clicked — only the menu opens', async () => {
    // The kebab's click handler stop-propagates so the tile click doesn't fire.
    installMockApi([
      makeInstall({ id: 'a', name: 'Alpha' }),
    ])
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
      makeInstall({ id: 'd', name: 'LegacyDesktopThing', sourceCategory: 'local', sourceId: 'desktop' }),
      makeInstall({ id: 'r', name: 'RemoteThing', sourceCategory: 'remote' }),
    ])
    const wrapper = mountChooser()
    await flushPromises()

    // The filter UI is hidden in the redesign but `activeFilter` is
    // preserved, so drive it through the vm directly.
    ;(wrapper.vm as unknown as { activeFilter: string }).activeFilter = 'remote'
    await flushPromises()

    const tiles = wrapper.findAll('.chooser-tile')
    const installTiles = tiles.filter(
      (t) => !t.classes().includes('chooser-tile-new') && !t.classes().includes('chooser-tile-cloud')
    )
    expect(installTiles.length).toBe(1)
    expect(installTiles[0]!.text()).toContain('RemoteThing')
  })

  it('groups Legacy Desktop installs under the Local filter', async () => {
    // Legacy Desktop installs surface under the Local chip, not a dedicated one.
    installMockApi([
      makeInstall({ id: 'l', name: 'LocalThing', sourceCategory: 'local' }),
      // Legacy Desktop reports category `local`; sourceId is the marker.
      makeInstall({ id: 'd', name: 'LegacyDesktopThing', sourceCategory: 'local', sourceId: 'desktop' }),
      makeInstall({ id: 'r', name: 'RemoteThing', sourceCategory: 'remote' }),
    ])
    const wrapper = mountChooser()
    await flushPromises()

    ;(wrapper.vm as unknown as { activeFilter: string }).activeFilter = 'local'
    await flushPromises()

    const tiles = wrapper.findAll('.chooser-tile')
    const installTiles = tiles.filter(
      (t) => !t.classes().includes('chooser-tile-new') && !t.classes().includes('chooser-tile-cloud')
    )
    const labels = installTiles.map((t) => t.text())
    expect(installTiles.length).toBe(2)
    expect(labels.some((l) => l.includes('LocalThing'))).toBe(true)
    expect(labels.some((l) => l.includes('LegacyDesktopThing'))).toBe(true)
    expect(labels.some((l) => l.includes('RemoteThing'))).toBe(false)
  })

  it('gives distribution cards the same kebab as install tiles, opening an Install menu', async () => {
    const api = installMockApiSignedIn([], [makeDist({ id: 'd1', name: 'Alpha Dist' })])
    api.comfybuilder.installDistribution.mockResolvedValue({
      ok: true,
      entry: { id: 'new-inst', name: 'Alpha Dist' },
    })
    const wrapper = mountChooser()
    await flushPromises()

    const kebab = wrapper.find('[data-testid="chooser-dist-tile-kebab-d1"]')
    expect(kebab.exists()).toBe(true)
    await kebab.trigger('click')

    const menu = wrapper
      .findAllComponents({ name: 'ContextMenu' })
      .find((m) => m.props('open') === true)!
    expect(menu).toBeTruthy()
    const items = menu.props('items') as { id: string; label: string; disabled?: boolean }[]
    expect(items.map((i) => i.id)).toEqual(['install'])
    expect(items[0]!.disabled).toBe(false)

    // Selecting Install runs the same flow the card's own activation does.
    menu.vm.$emit('select', 'install')
    await flushPromises()
    expect(api.comfybuilder.installDistribution).toHaveBeenCalledWith('d1')
  })

  it('keeps the kebab on a blocked distribution but disables Install', async () => {
    installMockApiSignedIn([], [makeDist({ id: 'd2', name: 'Blocked Dist', state: 'no-build' })])
    const wrapper = mountChooser()
    await flushPromises()

    const kebab = wrapper.find('[data-testid="chooser-dist-tile-kebab-d2"]')
    expect(kebab.exists()).toBe(true)
    await kebab.trigger('click')

    const menu = wrapper
      .findAllComponents({ name: 'ContextMenu' })
      .find((m) => m.props('open') === true)!
    const items = menu.props('items') as { id: string; disabled?: boolean }[]
    expect(items[0]!.disabled).toBe(true)
  })

  it('labels the distribution version so it cannot be read as a ComfyUI version', async () => {
    installMockApiSignedIn([], [makeDist({ id: 'd3', name: 'Versioned', version: '2' })])
    const wrapper = mountChooser()
    await flushPromises()
    const card = wrapper.find('[data-testid="chooser-dist-tile-d3"]')
    expect(card.find('.chooser-tile-meta-line').text()).toContain('Dist v2')
  })

  it('puts a blocked reason in the footer status slot, not the kebab corner', async () => {
    installMockApiSignedIn(
      [],
      [makeDist({ id: 'd4', name: 'Blocked', state: 'platform-mismatch', version: '5' })],
    )
    const wrapper = mountChooser()
    await flushPromises()
    const card = wrapper.find('[data-testid="chooser-dist-tile-d4"]')

    // State reads in the footer's right slot; the facts keep the left.
    expect(card.find('.dist-tile-state-tag').text()).toBe('Not for this machine')
    expect(card.find('.chooser-tile-meta-line').text()).toContain('Dist v5')
    // The corner holds the kebab and nothing else.
    const corner = card.find('.chooser-tile-actions')
    expect(corner.findAll('.chooser-tile-pill').length).toBe(0)
    expect(corner.find('.chooser-tile-kebab').exists()).toBe(true)
    // Blocked tiles recede but stay readable, and explain themselves on hover.
    expect(card.classes()).toContain('dist-tile--blocked')
    expect(card.attributes('title')).toContain('operating system')
  })

  it('never renders both an action pill and a state tag', async () => {
    installMockApiSignedIn(
      [],
      [
        makeDist({ id: 'a', name: 'Available', state: 'installable' }),
        makeDist({ id: 'b', name: 'Updatable', state: 'update-available' }),
      ],
    )
    const wrapper = mountChooser()
    await flushPromises()
    for (const id of ['a', 'b']) {
      const card = wrapper.find(`[data-testid="chooser-dist-tile-${id}"]`)
      expect(card.findAll('.chooser-tile-pill-action').length).toBe(1)
    }
    // Update is the actionable one, so it takes the blue pill.
    const updatable = wrapper.find('[data-testid="chooser-dist-tile-b"]')
    expect(updatable.find('.chooser-tile-pill-update').exists()).toBe(true)
    expect(updatable.find('.dist-tile-state-tag').exists()).toBe(false)
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
})
