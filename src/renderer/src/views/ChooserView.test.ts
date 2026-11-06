import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import ChooserView from './ChooserView.vue'
import BaseSelect from '../components/ui/BaseSelect.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import WhyTryCloudModal from '../components/WhyTryCloudModal.vue'
import { useSessionStore } from '../stores/sessionStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { TID } from '../../../shared/testIds'
import type { DevPlatformBuild, Installation } from '../types/ipc'

vi.mock('../components/ContextMenu.vue', () => ({
  default: {
    name: 'ContextMenu',
    props: ['open', 'x', 'y', 'items'],
    template: '<div data-testid="context-menu" />'
  }
}))

const mockModal = {
  alert: vi.fn().mockResolvedValue(undefined),
  confirm: vi.fn().mockResolvedValue(true),
  close: vi.fn()
}
vi.mock('../composables/useModal', () => ({
  useModal: () => mockModal
}))

interface MockApi {
  getInstallations: ReturnType<typeof vi.fn>
  onInstallationsChanged: ReturnType<typeof vi.fn>
  onInstallationsVersionsUpdated: ReturnType<typeof vi.fn>
  getSetting: ReturnType<typeof vi.fn>
  setSetting: ReturnType<typeof vi.fn>
  onSettingsChanged: ReturnType<typeof vi.fn>
  runAction: ReturnType<typeof vi.fn>
  onErrorDetail: ReturnType<typeof vi.fn>
  focusComfyWindow: ReturnType<typeof vi.fn>
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
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {}),
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

async function selectWorkspace(workspaceId: string): Promise<void> {
  useDashboardScopeStore().selectWorkspace(workspaceId)
  await flushPromises()
}

function tabButtons(wrapper: ReturnType<typeof mountChooser>) {
  return wrapper.findComponent(SegmentedControl).findAll('button')
}

function mountChooser() {
  return mount(ChooserView, {
    attachTo: document.body,
    global: { plugins: [createPinia()] }
  })
}

describe('ChooserView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockModal.alert.mockClear()
  })

  it('names the search after builds', async () => {
    installMockApi([])
    const wrapper = mountChooser()
    await flushPromises()

    const input = wrapper.get('.chooser-search input')
    expect(input.attributes('placeholder')).toBe('Search builds')
    expect(input.attributes('aria-label')).toBe('Search builds')
  })

  it('invites a first build when the user has zero installs', async () => {
    installMockApi([])
    const wrapper = mountChooser()
    await flushPromises()

    const invitation = wrapper.get('.chooser-no-builds')
    expect(invitation.text()).toContain('Set up where your work runs')

    await invitation.get('button').trigger('click')
    expect(wrapper.emitted('show-new-install')).toEqual([[]])
  })

  it('emits show-new-install from the page header', async () => {
    installMockApi([makeInstall({ id: 'a', name: 'Alpha' })])
    const wrapper = mountChooser()
    await flushPromises()
    await wrapper.get('.chooser-header .chooser-tile-new').trigger('click')
    expect(wrapper.emitted('show-new-install')).toEqual([[]])
  })

  it('filters by where a build runs, counting each tab and hiding empty ones', async () => {
    installMockApi([
      makeInstall({ id: 'a', name: 'Alpha' }),
      makeInstall({ id: 'b', name: 'Beta' }),
      makeInstall({ id: 'c', name: 'Comfy Cloud', sourceCategory: 'cloud' })
    ])
    const wrapper = mountChooser()
    await flushPromises()
    const tabs = (): string[] => tabButtons(wrapper).map((tab) => tab.text())
    expect(tabs()).toEqual(['All3', 'This computer2', 'Cloud1'])

    await tabButtons(wrapper)[2]!.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.chooser-tile-name').map((name) => name.text())).toEqual([
      'Comfy Cloud'
    ])
  })

  it('sorts by name on request', async () => {
    const newest = { lastLaunchedAt: 2000 }
    const oldest = { lastLaunchedAt: 1000 }
    installMockApi([
      makeInstall({ id: 'z', name: 'Zeta', ...newest }),
      makeInstall({ id: 'a', name: 'Alpha', ...oldest })
    ])
    const wrapper = mountChooser()
    await flushPromises()
    const names = (): string[] => wrapper.findAll('.chooser-tile-name').map((name) => name.text())
    expect(names()).toEqual(['Zeta', 'Alpha'])

    wrapper.findComponent(BaseSelect).vm.$emit('update:modelValue', 'name')
    await flushPromises()

    expect(names()).toEqual(['Alpha', 'Zeta'])
  })

  it('offers to clear filters when nothing matches', async () => {
    installMockApi([makeInstall({ id: 'a', name: 'Alpha' })])
    const wrapper = mountChooser()
    await flushPromises()
    await wrapper.get('.chooser-search input').setValue('zzzz')
    await flushPromises()

    const empty = wrapper.get('.chooser-empty')
    expect(empty.text()).toContain('Nothing matches')
    await empty.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.chooser-tile-name').map((name) => name.text())).toEqual(['Alpha'])
  })

  it("opens a build's details from its card without launching it", async () => {
    installMockApi([makeInstall({ id: 'a', name: 'Alpha' })])
    const wrapper = mountChooser()
    await flushPromises()

    await wrapper.get('.chooser-tile--install').trigger('click')

    expect(wrapper.emitted('open-details')?.[0]?.[0]).toMatchObject({ id: 'a' })
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('starts an idle build from its button without opening its details', async () => {
    installMockApi([makeInstall({ id: 'a', name: 'Alpha' })])
    const wrapper = mountChooser()
    await flushPromises()

    const start = wrapper.get('.chooser-tile-launch')
    expect(start.text()).toBe('Start')
    await start.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('pick')).toHaveLength(1)
    expect(wrapper.emitted('open-details')).toBeUndefined()
  })

  it('leads with Update and keeps starting as a named icon', async () => {
    installMockApi([
      makeInstall({
        id: 'a',
        name: 'Alpha',
        statusTag: { style: 'update', label: 'Update to v2' }
      })
    ])
    const wrapper = mountChooser()
    await flushPromises()

    expect(wrapper.get('.chooser-tile-pill-update').text()).toBe('Update')
    const start = wrapper.get('.chooser-tile-launch')
    expect(start.text()).toBe('')
    expect(start.attributes('aria-label')).toBe('Start')
    expect(wrapper.get('.chooser-tile-footer').text()).toContain('Update available')
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
    await tile!.get('.chooser-tile-launch').trigger('click')
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
          status: 'updating',
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
    expect(tile.text()).toContain('Updating…')
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

  it("emits pick from a tile's launch button", async () => {
    installMockApi([makeInstall({ id: 'a', name: 'Alpha', status: 'installed' })])
    const wrapper = mountChooser()
    await flushPromises()
    const tiles = wrapper.findAll('.chooser-tile')
    const alphaTile = tiles.find((t) => t.text().includes('Alpha'))
    expect(alphaTile).toBeTruthy()
    await alphaTile!.get('.chooser-tile-launch').trigger('click')
    const events = wrapper.emitted('pick')
    expect(events).toBeDefined()
    expect((events![0]![0] as Installation).id).toBe('a')
  })

  it('renders no lifecycle CTA cluster on a tile - the instance window owns lifecycle', async () => {
    installMockApi([makeInstall({ id: 'a', name: 'Alpha', status: 'installed' })])
    const wrapper = mountChooser()
    await flushPromises()
    expect(wrapper.find('.chooser-tile-cta').exists()).toBe(false)
    expect(wrapper.find('.chooser-tile-status').exists()).toBe(false)
    expect(wrapper.find('.chooser-tile-error-badge').exists()).toBe(false)
  })

  it('shows a "Running" status pill (keeping the source pill) and focuses the existing window instead of emitting pick', async () => {
    const api = installMockApi([makeInstall({ id: 'a', name: 'Alpha', status: 'installed' })])
    api.focusComfyWindow = vi.fn().mockResolvedValue(true)
    const wrapper = mountChooser()
    await flushPromises()

    const sessionStore = useSessionStore()
    sessionStore.runningInstances.set('a', { installationId: 'a' } as never)
    await flushPromises()

    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('Alpha'))!
    expect(tile.find('.chooser-tile-status--running').exists()).toBe(true)
    expect(tile.text()).toContain('Running')
    expect(tile.text()).toContain('Standalone')

    await tile.get('.chooser-tile-launch').trigger('click')
    await flushPromises()
    expect(api.focusComfyWindow).toHaveBeenCalledWith('a')
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('shows a clickable error badge that opens the error details without emitting pick', async () => {
    installMockApi([makeInstall({ id: 'a', name: 'Alpha', status: 'installed' })])
    const wrapper = mountChooser()
    await flushPromises()

    const sessionStore = useSessionStore()
    sessionStore.errorInstances.set('a', {
      installationName: 'Alpha',
      message: 'Migration failed: takeover did not start.'
    } as never)
    await flushPromises()

    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('Alpha'))!
    expect(tile.classes()).toContain('chooser-tile-errored')
    const badge = tile.find('.chooser-tile-error-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('Error')

    await badge.trigger('click')
    await flushPromises()
    expect(mockModal.alert).toHaveBeenCalledWith({
      title: 'Error',
      message: 'Migration failed: takeover did not start.'
    })
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('focuses the existing window instead of relaunching a crashed build', async () => {
    const api = installMockApi([makeInstall({ id: 'a', name: 'Alpha', status: 'installed' })])
    api.focusComfyWindow = vi.fn().mockResolvedValue(true)
    const wrapper = mountChooser()
    await flushPromises()

    const sessionStore = useSessionStore()
    sessionStore.errorInstances.set('a', { installationName: 'Alpha', exitCode: 1 } as never)
    await flushPromises()

    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('Alpha'))!
    await tile.get('.chooser-tile-launch').trigger('click')
    await flushPromises()
    expect(api.focusComfyWindow).toHaveBeenCalledWith('a')
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('launches a crashed build when no window exists to focus', async () => {
    const api = installMockApi([makeInstall({ id: 'a', name: 'Alpha', status: 'installed' })])
    api.focusComfyWindow = vi.fn().mockResolvedValue(false)
    const wrapper = mountChooser()
    await flushPromises()

    const sessionStore = useSessionStore()
    sessionStore.errorInstances.set('a', { installationName: 'Alpha', exitCode: 1 } as never)
    await flushPromises()

    const tile = wrapper.findAll('.chooser-tile').find((t) => t.text().includes('Alpha'))!
    await tile.get('.chooser-tile-launch').trigger('click')
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

  it('shows a clickable red danger pill that opens its detail without launching', async () => {
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
    const tag = tile.find('.chooser-tile-danger-tag')
    expect(tag.exists()).toBe(true)
    expect(tag.text()).toContain('Folder Not Found')
    expect(tile.find('.chooser-tile-error-badge').exists()).toBe(false)

    await tag.trigger('click')
    await flushPromises()
    expect(mockModal.alert).toHaveBeenCalledWith({
      title: 'Folder Not Found',
      message: 'Instance folder not found.\n\nC:/comfy/gone'
    })
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('does not emit pick when the kebab button is clicked - only the menu opens', async () => {
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
    installMockApi([
      makeInstall({ id: 'l', name: 'LocalThing', sourceCategory: 'local' }),
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

  it('shows the Personal workspace and its legacy and canonical installs when signed out', async () => {
    installMockApi([
      makeInstall({
        id: 'builder-1',
        name: 'Unassigned Studio',
        sourceId: 'comfybuilder',
        distributionId: 'd-unassigned',
        status: 'installed'
      } as unknown as Partial<Installation>),
      makeInstall({
        id: 'personal-1',
        name: 'Personal Studio',
        workspaceId: 'personal',
        status: 'installed'
      }),
      makeInstall({
        id: 'builder-2',
        name: 'Workspace Studio',
        sourceId: 'comfybuilder',
        distributionId: 'd-workspace',
        workspaceId: 'workspace-a',
        status: 'installed'
      } as unknown as Partial<Installation>)
    ])
    const wrapper = mountChooser()
    await flushPromises()
    const names = wrapper.findAll('.chooser-tile-name').map((w) => w.text())
    expect(names).toContain('Unassigned Studio')
    expect(names).toContain('Personal Studio')
    expect(names).not.toContain('Workspace Studio')
    expect(wrapper.find('[data-testid="chooser-workspace-refresh"]').exists()).toBe(false)
  })

  it('renders the dashboard as one instance grid', async () => {
    installMockApi([makeInstall({ id: 'a', name: 'Alpha' })])
    const wrapper = mountChooser()
    await flushPromises()
    const grids = wrapper.findAll('.chooser-family-grid')
    expect(grids.length).toBe(1)
  })

  it('offers a workspace refresh in the toolbar only when signed in', async () => {
    installMockApiSignedIn([], [], { id: 'w1', name: 'Comfy Design Team' })
    const wrapper = mountChooser()
    await flushPromises()

    const toolbar = wrapper.get('.chooser-toolbar')
    expect(toolbar.find('.chooser-search').exists()).toBe(true)
    expect(toolbar.find('[data-testid="chooser-workspace-refresh"]').exists()).toBe(true)
  })

  it('offers Upload Build for an instance owned by the selected workspace', async () => {
    installMockApiSignedIn(
      [
        makeInstall({
          id: 'local',
          name: 'LocalThing',
          sourceId: 'comfybuilder',
          workspaceId: 'w1',
          status: 'installed',
          installPath: '/installs/local'
        })
      ],
      [],
      { id: 'w1', name: 'Comfy Design Team' }
    )
    const wrapper = mountChooser()
    await flushPromises()

    await wrapper.find(`[data-testid="${TID.dashboardTile('local')}"]`).trigger('contextmenu')

    const menu = wrapper
      .findAllComponents({ name: 'ContextMenu' })
      .find((candidate) => candidate.props('open') === true)!
    const items = menu.props('items') as {
      id: string
      label: string
      hint?: string
      hintUrl?: string
      hintLinkLabel?: string
      disabled?: boolean
    }[]
    expect(items.find(({ id }) => id === 'promote-to-workspace')).toMatchObject({
      label: 'Upload Build',
      hint: 'Upload this build to Comfy Developer Platform.',
      hintUrl: 'https://platform.comfy.org/profile/deploy',
      hintLinkLabel: 'Read more',
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
    await selectWorkspace('personal')

    const tile = wrapper.find(`[data-testid="${TID.dashboardTile('local')}"]`)
    await tile.trigger('contextmenu')
    const menu = wrapper
      .findAllComponents({ name: 'ContextMenu' })
      .find((candidate) => candidate.props('open') === true)!

    menu.vm.$emit('select', 'promote-to-workspace')
    await wrapper.vm.$nextTick()

    expect(tile.find('.chooser-tile-status--promoting').text()).toBe('Creating...')
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
    'offers Upload Build for %s',
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
        await selectWorkspace('personal')
      }

      await wrapper
        .find(`[data-testid="${TID.dashboardTile('ineligible')}"]`)
        .trigger('contextmenu')

      const menu = wrapper
        .findAllComponents({ name: 'ContextMenu' })
        .find((candidate) => candidate.props('open') === true)!
      const items = menu.props('items') as { id: string }[]
      expect(items.some((item) => item.id === 'promote-to-workspace')).toBe(true)
    }
  )

  it('loads Builds when an authenticated workspace dashboard mounts', async () => {
    const api = installMockApiSignedIn([], [], { id: 'w1', name: 'Comfy Design Team' })

    mountChooser()
    await flushPromises()

    expect(api.comfybuilder.listBuilds).toHaveBeenCalledOnce()
  })

  it('prefetches Builds when the selected workspace changes', async () => {
    const api = installMockApiSignedIn([], [], { id: 'w1', name: 'Workspace A' })
    api.comfybuilder.listWorkspaces.mockResolvedValue([
      { id: 'w1', name: 'Workspace A', type: 'team', role: 'admin' },
      { id: 'w2', name: 'Workspace B', type: 'team', role: 'admin' }
    ])
    api.comfybuilder.switchWorkspace.mockImplementation(async (workspaceId: string) => ({
      signedIn: true,
      workspaceType: 'team',
      workspaceId
    }))
    const wrapper = mountChooser()
    await flushPromises()
    api.comfybuilder.listBuilds.mockClear()

    await selectWorkspace('w2')

    expect(api.comfybuilder.switchWorkspace).toHaveBeenCalledExactlyOnceWith('w2')
    expect(api.comfybuilder.listBuilds).toHaveBeenCalledOnce()
  })

  it('refreshes workspace membership and Builds', async () => {
    const api = installMockApiSignedIn([], [], { id: 'w1', name: 'Comfy Design Team' })
    const wrapper = mountChooser()
    await flushPromises()
    api.comfybuilder.listWorkspaces.mockClear()
    api.comfybuilder.listBuilds.mockClear()

    await wrapper.find('[data-testid="chooser-workspace-refresh"]').trigger('click')
    await flushPromises()

    expect(api.comfybuilder.listWorkspaces).toHaveBeenCalledOnce()
    expect(api.comfybuilder.listBuilds).toHaveBeenCalledOnce()
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

  it('restores the saved scope and reconciles its grid after membership changes', async () => {
    const api = installMockApiSignedIn(
      [
        makeInstall({ id: 'a', name: 'A instance', workspaceId: 'w1' }),
        makeInstall({ id: 'b', name: 'B instance', workspaceId: 'w2' })
      ],
      [],
      { id: 'w1', name: 'Workspace A' }
    )
    api.getSetting.mockResolvedValue('w2')
    api.comfybuilder.listWorkspaces.mockResolvedValue([
      { id: 'w1', name: 'Workspace A', type: 'team', role: 'owner' },
      { id: 'w2', name: 'Workspace B', type: 'team', role: 'owner' }
    ])
    const wrapper = mountChooser()
    await flushPromises()
    expect(wrapper.text()).toContain('B instance')
    expect(wrapper.text()).not.toContain('A instance')
    expect(useDashboardScopeStore().selectedWorkspaceId).toBe('w2')
    expect(api.setSetting).not.toHaveBeenCalled()

    api.comfybuilder.listWorkspaces.mockResolvedValue([
      { id: 'w1', name: 'Workspace A', type: 'team', role: 'owner' }
    ])
    await wrapper.get('[data-testid="chooser-workspace-refresh"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('A instance')
    expect(wrapper.text()).not.toContain('B instance')
    expect(useDashboardScopeStore().selectedWorkspaceId).toBe('w1')
    expect(api.setSetting).toHaveBeenCalledWith('dashboardWorkspaceId', 'w1')
    wrapper.unmount()
  })

  it('switches between Personal and team workspaces without leaking other-workspace installs', async () => {
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

    await selectWorkspace('personal')
    expect(wrapper.text()).toContain('LocalThing')
    expect(wrapper.text()).not.toContain('Workspace A Build')
    expect(wrapper.text()).not.toContain('Workspace B Build')
    expect(api.comfybuilder.switchWorkspace).not.toHaveBeenCalled()

    await selectWorkspace('workspace-b')
    expect(wrapper.text()).toContain('Workspace B Build')
    expect(wrapper.text()).not.toContain('Workspace A Build')
    expect(wrapper.text()).not.toContain('LocalThing')

    await selectWorkspace('workspace-a')
    expect(wrapper.text()).toContain('Workspace A Build')
    expect(wrapper.text()).not.toContain('Workspace B Build')
  })

  it('keeps the shared New Instance scope in sync with the selected workspace', async () => {
    installMockApiSignedIn([], [], { id: 'w1', name: 'Comfy Design Team' })
    const wrapper = mountChooser()
    await flushPromises()

    await wrapper.get('.chooser-tile-new').trigger('click')
    expect(useDashboardScopeStore().selectedWorkspaceId).toBe('w1')
    expect(wrapper.emitted('show-new-install')?.at(-1)).toEqual([])

    await selectWorkspace('personal')
    await wrapper.get('.chooser-tile-new').trigger('click')
    expect(useDashboardScopeStore().selectedWorkspaceId).toBe('personal')
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
    installMockApi([])
    const wrapper = mountChooser()
    await flushPromises()
    type FilterKey = 'all' | 'local' | 'cloud' | 'remote'
    const validKeys: FilterKey[] = ['all', 'local', 'cloud', 'remote']
    expect(validKeys).not.toContain('desktop' as FilterKey)
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
