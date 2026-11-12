import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

vi.mock('../lib/telemetry', () => ({ emit: vi.fn() }))

vi.mock('../lib/ipc/registerSettingsHandlers', async () => ({
  ...(await vi.importActual('../lib/ipc/registerSettingsHandlers')),
  applySettingSet: vi.fn()
}))

import {
  _test_buildGlobalSettingsSnapshot,
  _test_deleteTitlePopupEntry,
  _test_setTitlePopupEntry,
  activateTitlePopupMenuItem,
  buildInstancePickerSnapshot,
  resolvePickerSelectedInstallId,
  scopeInstancePicker,
  buildTitlePopupMenuItems,
  computePopupHeight,
  decideFlowMenuItemTarget,
  isFlowMenuItemId,
  parseGlobalSettingsTarget,
  registerTitlePopupIpc,
  requiresPerOpenConfigSync,
  syncTitlePopupConfig,
  type FlowMenuItemId,
  type InstancePickerInstall,
  type TitlePopupEntry,
  type TitlePopupHostBindings
} from './titlePopup'
import { comfyWindows, nextWindowKey, type ComfyWindowEntry } from '../host/registry'
import { applySettingSet } from '../lib/ipc/registerSettingsHandlers'
import * as settings from '../settings'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  comfyWindows.clear()
})

interface FakeComfyWebContents {
  destroyed: boolean
  zoomLevel: number
  isDestroyed: () => boolean
  getZoomLevel: () => number
}

function makeEntry(
  opts: {
    installationId?: string | null
    activePanel?: ComfyWindowEntry['activePanel']
    firstUseMode?: ComfyWindowEntry['firstUseMode']
    comfyDestroyed?: boolean
    zoomLevel?: number
  } = {}
): ComfyWindowEntry {
  const wc: FakeComfyWebContents = {
    destroyed: opts.comfyDestroyed ?? false,
    zoomLevel: opts.zoomLevel ?? 0,
    isDestroyed: () => wc.destroyed,
    getZoomLevel: () => wc.zoomLevel
  }
  return {
    windowKey: nextWindowKey(),
    window: {} as ComfyWindowEntry['window'],
    comfyView: {
      webContents: wc as unknown
    } as unknown as ComfyWindowEntry['comfyView'],
    titleBarView: { webContents: {} } as unknown as ComfyWindowEntry['titleBarView'],
    panelView: null,
    activePanel: opts.activePanel ?? 'comfy',
    lastTheme: { bg: '#000', text: '#fff' },
    layoutViews: () => {},
    comfyUrl: '',
    installationId: opts.installationId ?? null,
    constructedPartition: null,
    firstUseMode: opts.firstUseMode ?? 'none',
    titleBarText: '',
    sourceCategory: null,
    previewInstallationId: null,
    coldStartPendingReveal: false,
    _installCleanup: null,
    detachInstall: () => {}
  }
}

describe('computePopupHeight', () => {
  it('counts items at 32px and separators at 9px plus the 10px chrome budget', () => {
    const h = computePopupHeight([
      { id: 'a', label: 'A' },
      { kind: 'separator' },
      { id: 'b', label: 'B' },
      { kind: 'separator' },
      { id: 'c', label: 'C' }
    ])
    expect(h).toBe(124)
  })

  it('returns chrome-only height for an empty item list', () => {
    expect(computePopupHeight([])).toBe(10)
  })

  it('handles a single item', () => {
    expect(computePopupHeight([{ id: 'a', label: 'A' }])).toBe(42)
  })

  it('handles a single separator', () => {
    expect(computePopupHeight([{ kind: 'separator' }])).toBe(19)
  })
})

describe('buildTitlePopupMenuItems', () => {
  it('returns only Skip Onboarding during post-consent first-use', () => {
    const entry = makeEntry({ firstUseMode: 'post-consent' })
    const items = buildTitlePopupMenuItems(entry)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'skip-onboarding' })
  })

  it.each([null, 'inst-1'] as const)(
    'keeps settings and window actions without duplicate dashboard shortcuts on host %s',
    (installationId) => {
      const items = buildTitlePopupMenuItems(makeEntry({ installationId }))
      expect(items.map((item) => item.id ?? 'separator')).toEqual([
        'new-window',
        'separator',
        'settings',
        'separator',
        'exit-window',
        'close-all-windows'
      ])
    }
  )

  it('install host lists Reset Zoom after Settings when zoomed', () => {
    const items = buildTitlePopupMenuItems(makeEntry({ installationId: 'inst-1', zoomLevel: 2 }))
    const ids = items.map((i) => i.id ?? null).filter((id) => id !== null)
    expect(ids).toEqual([
      'new-window',
      'settings',
      'reset-zoom',
      'exit-window',
      'close-all-windows'
    ])
  })

  it('keeps the post-consent menu to Skip Onboarding', () => {
    const items = buildTitlePopupMenuItems(makeEntry({ firstUseMode: 'post-consent' }))
    expect(items.map((i) => i.id ?? null)).toEqual(['skip-onboarding'])
  })

  it('install host omits Return to Dashboard — picker Home is the canonical dashboard escape', () => {
    const items = buildTitlePopupMenuItems(makeEntry({ installationId: 'inst-1' }))
    const ids = items.map((i) => i.id ?? null)
    expect(ids).not.toContain('return-to-dashboard')
  })

  it('omits Reset Zoom on chooser hosts even if the dummy comfy view has a zoom level', () => {
    const items = buildTitlePopupMenuItems(makeEntry({ installationId: null, zoomLevel: 2 }))
    expect(items.find((i) => i.id === 'reset-zoom')).toBeUndefined()
  })

  it('exposes Reset Zoom on install host when comfy zoom is non-zero', () => {
    const zoomed = buildTitlePopupMenuItems(makeEntry({ installationId: 'inst-1', zoomLevel: 2 }))
    const resetZoom = zoomed.find((i) => i.id === 'reset-zoom')
    expect(resetZoom).toBeDefined()
    expect(resetZoom?.label).toBe('Reset Zoom (144%)')
  })

  it('omits Reset Zoom from the install host menu when the comfy webContents has been destroyed', () => {
    const items = buildTitlePopupMenuItems(
      makeEntry({ installationId: 'inst-1', comfyDestroyed: true, zoomLevel: 2 })
    )
    expect(items.find((i) => i.id === 'reset-zoom')).toBeUndefined()
  })

  it('places New Window first and Quit Desktop last on a chooser host', () => {
    const items = buildTitlePopupMenuItems(makeEntry({ installationId: null }))
    const ids = items.map((i) => i.id ?? null)
    expect(ids[0]).toBe('new-window')
    expect(ids[ids.length - 1]).toBe('close-all-windows')
  })

  it('returns the same item set during loading-lockdown as in normal mode', () => {
    for (const installationId of [null, 'inst-1'] as const) {
      const normal = buildTitlePopupMenuItems(makeEntry({ installationId }))
      const locked = buildTitlePopupMenuItems(
        makeEntry({ installationId, firstUseMode: 'loading-lockdown' })
      )
      expect(locked.map((i) => i.id ?? null)).toEqual(normal.map((i) => i.id ?? null))
    }
  })
})

describe('activateTitlePopupMenuItem', () => {
  function makePopupEntry(parentEntryId: number) {
    return {
      kind: 'menu',
      parentEntryId,
      view: { isOpen: false, pendingShowTimer: null, hide: vi.fn() }
    } as unknown as Parameters<typeof activateTitlePopupMenuItem>[0]
  }

  it.each([null, 'inst-1'] as const)(
    'opens Performance Test in a new host when installationId is %s',
    (installationId) => {
      const host = makeEntry({ installationId })
      comfyWindows.set(host.windowKey, host)
      const bindings = {
        openChooserHostWindow: vi.fn(),
        setActivePanel: vi.fn()
      } as unknown as TitlePopupHostBindings

      activateTitlePopupMenuItem(makePopupEntry(host.windowKey), 'performance-test', bindings)

      expect(bindings.openChooserHostWindow).toHaveBeenCalledExactlyOnceWith('performance-test')
      expect(bindings.setActivePanel).not.toHaveBeenCalled()
    }
  )

  it.each([null, 'inst-1'] as const)(
    'opens Benchmarks in a new host when installationId is %s',
    (installationId) => {
      const host = makeEntry({ installationId })
      comfyWindows.set(host.windowKey, host)
      const bindings = {
        openChooserHostWindow: vi.fn(),
        setActivePanel: vi.fn()
      } as unknown as TitlePopupHostBindings

      activateTitlePopupMenuItem(makePopupEntry(host.windowKey), 'benchmarks', bindings)

      expect(bindings.openChooserHostWindow).toHaveBeenCalledExactlyOnceWith('benchmarks')
      expect(bindings.setActivePanel).not.toHaveBeenCalled()
    }
  )

  it('routes Reset Zoom through resetComfyZoom with the host installation id', () => {
    const host = makeEntry({ installationId: 'inst-1', zoomLevel: 3 })
    comfyWindows.set(host.windowKey, host)
    const bindings = { resetComfyZoom: vi.fn() } as unknown as TitlePopupHostBindings

    activateTitlePopupMenuItem(makePopupEntry(host.windowKey), 'reset-zoom', bindings)

    expect(bindings.resetComfyZoom).toHaveBeenCalledExactlyOnceWith('inst-1')
  })

  it('defensively ignores Reset Zoom on an install-less host', () => {
    const host = makeEntry({ installationId: null })
    comfyWindows.set(host.windowKey, host)
    const bindings = { resetComfyZoom: vi.fn() } as unknown as TitlePopupHostBindings

    activateTitlePopupMenuItem(makePopupEntry(host.windowKey), 'reset-zoom', bindings)

    expect(bindings.resetComfyZoom).not.toHaveBeenCalled()
  })
})

describe('decideFlowMenuItemTarget', () => {
  const flowIds: FlowMenuItemId[] = ['new-install', 'track', 'load-snapshot', 'quick-install']

  it.each(flowIds)('dashboard host routes %s to in-place takeover', (id) => {
    const target = decideFlowMenuItemTarget(makeEntry({ installationId: null }), id)
    expect(target).toEqual({ kind: 'set-active-panel', panel: id })
  })

  it.each(flowIds)('install host routes %s to a fresh chooser window', (id) => {
    const target = decideFlowMenuItemTarget(makeEntry({ installationId: 'inst-1' }), id)
    expect(target).toEqual({ kind: 'open-chooser-host', panel: id })
  })
})

describe('isFlowMenuItemId', () => {
  it('accepts the four flow ids and rejects everything else', () => {
    expect(isFlowMenuItemId('new-install')).toBe(true)
    expect(isFlowMenuItemId('track')).toBe(true)
    expect(isFlowMenuItemId('load-snapshot')).toBe(true)
    expect(isFlowMenuItemId('quick-install')).toBe(true)
    expect(isFlowMenuItemId('new-window')).toBe(false)
    expect(isFlowMenuItemId('settings')).toBe(false)
    expect(isFlowMenuItemId('feedback')).toBe(false)
    expect(isFlowMenuItemId('')).toBe(false)
  })
})

describe('requiresPerOpenConfigSync', () => {
  it('forces a config re-send for a global-settings open with a requested tab', () => {
    expect(
      requiresPerOpenConfigSync({ kind: 'global-settings', snapshot: { initialTab: 'storage' } })
    ).toBe(true)
  })

  it('keeps the fast path for a global-settings open without a requested tab', () => {
    expect(
      requiresPerOpenConfigSync({ kind: 'global-settings', snapshot: { initialTab: null } })
    ).toBe(false)
  })

  it('keeps the fast path for non-global-settings kinds', () => {
    expect(requiresPerOpenConfigSync({ kind: 'menu' })).toBe(false)
    expect(requiresPerOpenConfigSync({ kind: 'downloads' })).toBe(false)
    expect(
      requiresPerOpenConfigSync({ kind: 'instance-picker', snapshot: { initialTab: 'storage' } })
    ).toBe(false)
  })
})

describe('resolvePickerSelectedInstallId', () => {
  function makeInstall(overrides: Partial<InstancePickerInstall>): InstancePickerInstall {
    return {
      id: 'x',
      name: 'X',
      sourceLabel: 'Standalone',
      sourceCategory: 'local',
      ...overrides
    } as InstancePickerInstall
  }

  it('prefers an explicit selection over the host install', () => {
    const installs = [makeInstall({ id: 'a' }), makeInstall({ id: 'b' })]
    expect(resolvePickerSelectedInstallId('b', 'a', installs)).toBe('b')
  })

  it('falls back to the host install when no explicit selection', () => {
    const installs = [makeInstall({ id: 'a' }), makeInstall({ id: 'b' })]
    expect(resolvePickerSelectedInstallId(null, 'b', installs)).toBe('b')
  })

  it('defaults to the most-recently-launched install on an install-less host', () => {
    const installs = [
      makeInstall({ id: 'a', lastLaunchedAt: 1000 }),
      makeInstall({ id: 'b', lastLaunchedAt: 5000 }),
      makeInstall({ id: 'c', lastLaunchedAt: 2000 })
    ]
    expect(resolvePickerSelectedInstallId(null, null, installs)).toBe('b')
  })

  it('falls back to the first install on an install-less host when none have been launched', () => {
    const installs = [makeInstall({ id: 'a' }), makeInstall({ id: 'b' })]
    expect(resolvePickerSelectedInstallId(null, null, installs)).toBe('a')
  })

  it('does not default to the seeded cloud entry just because it sorts first', () => {
    const installs = [
      makeInstall({ id: 'cloud', sourceCategory: 'cloud' }),
      makeInstall({ id: 'local-a', sourceCategory: 'local' }),
      makeInstall({ id: 'local-b', sourceCategory: 'local' })
    ]
    expect(resolvePickerSelectedInstallId(null, null, installs)).toBe('local-a')
  })

  it('still defaults to cloud when it was genuinely launched most-recently', () => {
    const installs = [
      makeInstall({ id: 'local-a', sourceCategory: 'local', lastLaunchedAt: 1000 }),
      makeInstall({ id: 'cloud', sourceCategory: 'cloud', lastLaunchedAt: 5000 })
    ]
    expect(resolvePickerSelectedInstallId(null, null, installs)).toBe('cloud')
  })

  it('falls back to cloud when it is the only install', () => {
    const installs = [makeInstall({ id: 'cloud', sourceCategory: 'cloud' })]
    expect(resolvePickerSelectedInstallId(null, null, installs)).toBe('cloud')
  })

  it('returns null when there are no installs to select', () => {
    expect(resolvePickerSelectedInstallId(null, null, [])).toBeNull()
  })
})

describe('scopeInstancePicker', () => {
  function makeInstall(overrides: Partial<InstancePickerInstall>): InstancePickerInstall {
    return {
      id: 'x',
      name: 'X',
      sourceLabel: 'Standalone',
      sourceCategory: 'local',
      ...overrides
    } as InstancePickerInstall
  }

  function mockSettings(values: Record<string, unknown>): void {
    vi.spyOn(settings, 'get').mockImplementation(
      ((key: string) => values[key]) as typeof settings.get
    )
  }

  const workspaceInstalls = [
    makeInstall({ id: 'legacy', lastLaunchedAt: 900 }),
    makeInstall({ id: 'personal', workspaceId: 'personal' }),
    makeInstall({ id: 'team-a', workspaceId: 'team-a' }),
    makeInstall({ id: 'team-b', workspaceId: 'team-b' })
  ]

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['personal', null, ['legacy', 'personal']],
    ['team-a', null, ['team-a']],
    ['team-b', null, ['team-b']],
    ['empty-team', null, []],
    ['team-a', 'personal', ['legacy', 'personal']],
    ['personal', 'team-a', ['team-a']],
    ['personal', 'team-b', ['team-b']]
  ] as const)(
    'scopes dashboard workspace %s with host %s',
    (workspaceId, hostInstallationId, expectedIds) => {
      mockSettings({ dashboardWorkspaceId: workspaceId })
      const scope = scopeInstancePicker(workspaceInstalls, hostInstallationId, 'legacy', null)
      expect(scope.installs.map((install) => install.id)).toEqual(expectedIds)
      expect(scope.selectedInstallationId).toBe(expectedIds[0] ?? null)
    }
  )

  it('scopes to the requested build workspace when the saved dashboard workspace is stale', () => {
    mockSettings({ dashboardWorkspaceId: 'personal' })
    const scope = scopeInstancePicker(workspaceInstalls, null, 'team-a', 'team-a')
    expect(scope.installs.map((install) => install.id)).toEqual(['team-a'])
    expect(scope.selectedInstallationId).toBe('team-a')
  })

  it('lets the host workspace win over the requested build', () => {
    mockSettings({ dashboardWorkspaceId: 'personal' })
    const scope = scopeInstancePicker(workspaceInstalls, 'team-b', 'team-a', 'team-a')
    expect(scope.installs.map((install) => install.id)).toEqual(['team-b'])
    expect(scope.selectedInstallationId).toBe('team-b')
  })

  it('applies the cloud visibility preference within the selected workspace', () => {
    mockSettings({ dashboardWorkspaceId: 'team', hideCloudFromPicker: true })
    const scope = scopeInstancePicker(
      [
        makeInstall({ id: 'cloud', workspaceId: 'team', sourceCategory: 'cloud' }),
        makeInstall({ id: 'local', workspaceId: 'team' })
      ],
      null,
      'cloud',
      'cloud'
    )
    expect(scope.installs.map((install) => install.id)).toEqual(['local'])
    expect(scope.selectedInstallationId).toBe('local')
  })

  it('keeps a hidden cloud host visible and selected', () => {
    mockSettings({ hideCloudFromPicker: true })
    const scope = scopeInstancePicker(
      [
        makeInstall({ id: 'local', lastLaunchedAt: 900 }),
        makeInstall({ id: 'cloud', sourceCategory: 'cloud' })
      ],
      'cloud',
      null,
      null
    )
    expect(scope.installs.map((install) => install.id)).toEqual(['local', 'cloud'])
    expect(scope.selectedInstallationId).toBe('cloud')
  })
})

describe('buildInstancePickerSnapshot', () => {
  function makeInstall(overrides: Partial<InstancePickerInstall>): InstancePickerInstall {
    return {
      id: 'x',
      name: 'X',
      sourceLabel: 'Standalone',
      sourceCategory: 'local',
      ...overrides
    } as InstancePickerInstall
  }

  const EMPTY_STORAGE = {
    sharedDirectoriesFields: [],
    modelsDirs: [],
    modelsSystemDefault: ''
  }

  it('forwards the install array verbatim under `installs`', () => {
    const installs = [makeInstall({ id: 'a', name: 'A' }), makeInstall({ id: 'b', name: 'B' })]
    const snap = buildInstancePickerSnapshot({
      installs,
      hostInstallationId: null,
      runningInstallationIds: [],
      launchingInstallationIds: [],
      storage: EMPTY_STORAGE
    })
    expect(snap.installs).toEqual(installs)
  })

  it('opens the full picker unless asked for the plain build list', () => {
    const args = {
      installs: [makeInstall({ id: 'a' })],
      hostInstallationId: 'a',
      runningInstallationIds: [],
      launchingInstallationIds: [],
      storage: EMPTY_STORAGE
    }
    expect(buildInstancePickerSnapshot(args).layout).toBe('full')
    expect(buildInstancePickerSnapshot({ ...args, layout: 'list' }).layout).toBe('list')
  })

  it('echoes the host installation id under `activeInstallationId`', () => {
    const snap = buildInstancePickerSnapshot({
      installs: [makeInstall({ id: 'a' })],
      hostInstallationId: 'a',
      runningInstallationIds: [],
      launchingInstallationIds: [],
      storage: EMPTY_STORAGE
    })
    expect(snap.activeInstallationId).toBe('a')
  })

  it('sets `activeInstallationId` to null on an install-less host', () => {
    const snap = buildInstancePickerSnapshot({
      installs: [],
      hostInstallationId: null,
      runningInstallationIds: [],
      launchingInstallationIds: [],
      storage: EMPTY_STORAGE
    })
    expect(snap.activeInstallationId).toBeNull()
  })

  it("carries each running session's start time, defaulting to none", () => {
    const withStarts = buildInstancePickerSnapshot({
      installs: [],
      hostInstallationId: null,
      runningInstallationIds: ['a'],
      runningSessionStartedAt: { a: 123 },
      launchingInstallationIds: [],
      storage: EMPTY_STORAGE
    })
    expect(withStarts.runningSessionStartedAt).toEqual({ a: 123 })
    const without = buildInstancePickerSnapshot({
      installs: [],
      hostInstallationId: null,
      runningInstallationIds: [],
      launchingInstallationIds: [],
      storage: EMPTY_STORAGE
    })
    expect(without.runningSessionStartedAt).toEqual({})
  })

  it('flattens running ids into a stable string array', () => {
    const snap = buildInstancePickerSnapshot({
      installs: [],
      hostInstallationId: null,
      runningInstallationIds: ['b', 'a', 'c'],
      launchingInstallationIds: [],
      storage: EMPTY_STORAGE
    })
    expect(snap.runningInstallationIds).toEqual(['b', 'a', 'c'])
  })

  it('returns an empty runningInstallationIds when nothing is running', () => {
    const snap = buildInstancePickerSnapshot({
      installs: [makeInstall({ id: 'a' })],
      hostInstallationId: null,
      runningInstallationIds: [],
      launchingInstallationIds: [],
      storage: EMPTY_STORAGE
    })
    expect(snap.runningInstallationIds).toEqual([])
  })

  it('falls back to previewInstallationId when no real attach yet', () => {
    const snap = buildInstancePickerSnapshot({
      installs: [makeInstall({ id: 'a' })],
      hostInstallationId: null,
      previewInstallationId: 'a',
      runningInstallationIds: [],
      launchingInstallationIds: ['a'],
      storage: EMPTY_STORAGE
    })
    expect(snap.activeInstallationId).toBe('a')
  })

  it('prefers the real hostInstallationId over previewInstallationId', () => {
    const snap = buildInstancePickerSnapshot({
      installs: [makeInstall({ id: 'a' }), makeInstall({ id: 'b' })],
      hostInstallationId: 'a',
      previewInstallationId: 'b',
      runningInstallationIds: ['a'],
      launchingInstallationIds: [],
      storage: EMPTY_STORAGE
    })
    expect(snap.activeInstallationId).toBe('a')
  })

  it('surfaces launchingInstallationIds verbatim for popup hydration', () => {
    const snap = buildInstancePickerSnapshot({
      installs: [makeInstall({ id: 'a' })],
      hostInstallationId: null,
      runningInstallationIds: [],
      launchingInstallationIds: ['a', 'b'],
      storage: EMPTY_STORAGE
    })
    expect(snap.launchingInstallationIds).toEqual(['a', 'b'])
  })

  it('defaults pickerSelectionEpoch to 0 when not provided', () => {
    const snap = buildInstancePickerSnapshot({
      installs: [],
      hostInstallationId: null,
      runningInstallationIds: [],
      launchingInstallationIds: [],
      storage: EMPTY_STORAGE
    })
    expect(snap.pickerSelectionEpoch).toBe(0)
  })

  it('preserves pickerSelectionEpoch verbatim when provided', () => {
    const snap = buildInstancePickerSnapshot({
      installs: [],
      hostInstallationId: null,
      runningInstallationIds: [],
      launchingInstallationIds: [],
      pickerSelectionEpoch: 7,
      storage: EMPTY_STORAGE
    })
    expect(snap.pickerSelectionEpoch).toBe(7)
  })
})

describe('parseGlobalSettingsTarget', () => {
  it.each(['general', 'updates', 'storage', 'advanced', 'logs'])('accepts the %s tab', (tab) => {
    expect(parseGlobalSettingsTarget({ tab }).initialTab).toBe(tab)
  })

  it.each([undefined, 'beta', 7, null])('drops an unknown tab %j', (tab) => {
    expect(parseGlobalSettingsTarget({ tab }).initialTab).toBeNull()
  })

  it('forwards a non-empty highlight field id as-is', () => {
    expect(
      parseGlobalSettingsTarget({ tab: 'general', highlightField: 'betaFeaturesEnabled' })
    ).toEqual({ initialTab: 'general', highlightFieldId: 'betaFeaturesEnabled' })
  })

  it.each(['', 3, undefined])('drops an unusable highlight field %j', (highlightField) => {
    expect(parseGlobalSettingsTarget({ highlightField }).highlightFieldId).toBeNull()
  })

  it('tolerates a missing payload', () => {
    expect(parseGlobalSettingsTarget(undefined)).toEqual({
      initialTab: null,
      highlightFieldId: null
    })
  })
})

describe('title popup renderer readiness', () => {
  type IpcListener = (event: Electron.IpcMainEvent) => void
  let ready: IpcListener

  beforeAll(async () => {
    const { ipcMain } = await import('electron')
    registerTitlePopupIpc({} as TitlePopupHostBindings)
    const call = vi
      .mocked(ipcMain.on)
      .mock.calls.find(([channel]) => channel === 'comfy-titlepopup:ready')
    if (!call) throw new Error('IPC listener not registered: comfy-titlepopup:ready')
    ready = call[1] as IpcListener
  })

  afterAll(() => {
    _test_deleteTitlePopupEntry(404)
  })

  it('replays the last config when the cached popup renderer reloads', () => {
    const config = {
      kind: 'menu' as const,
      items: [{ id: 'settings', label: 'Desktop Settings' }],
      theme: { bg: '#111111', text: '#eeeeee' }
    }
    const send = vi.fn()
    const entry = {
      view: {
        rendererReady: false,
        popup: { webContents: { isDestroyed: () => false, send } }
      },
      pendingConfig: null,
      lastConfigJson: JSON.stringify(config),
      lastSyncedConfigJson: JSON.stringify(config)
    } as unknown as TitlePopupEntry
    _test_setTitlePopupEntry(404, entry)

    ready({ sender: { id: 404 } } as Electron.IpcMainEvent)

    expect(entry.view.rendererReady).toBe(true)
    expect(entry.lastSyncedConfigJson).toBeNull()
    expect(send).toHaveBeenCalledExactlyOnceWith('comfy-titlepopup:set-config', config)
  })
})

describe('title popup config sync', () => {
  type IpcListener = (event: Electron.IpcMainEvent) => void
  type PopupConfig = Parameters<typeof syncTitlePopupConfig>[1]

  const POPUP_WEB_CONTENTS_ID = 405
  const theme = { bg: '#111111', text: '#eeeeee' }
  const menuConfig: PopupConfig = {
    kind: 'menu',
    items: [{ id: 'settings', label: 'Desktop Settings' }],
    theme
  }
  const downloadsConfig: PopupConfig = { kind: 'downloads', theme }
  const rendererAck = { sender: { id: POPUP_WEB_CONTENTS_ID } } as Electron.IpcMainEvent

  let rendered: IpcListener

  function registerEntrySyncedTo(config: PopupConfig): {
    entry: TitlePopupEntry
    send: ReturnType<typeof vi.fn>
  } {
    const send = vi.fn()
    const entry = {
      view: {
        rendererReady: true,
        pendingShowTimer: null,
        popup: { webContents: { isDestroyed: () => false, send } }
      },
      pendingConfig: null,
      lastConfigJson: JSON.stringify(config),
      lastSyncedConfigJson: JSON.stringify(config)
    } as unknown as TitlePopupEntry
    _test_setTitlePopupEntry(POPUP_WEB_CONTENTS_ID, entry)
    return { entry, send }
  }

  beforeAll(async () => {
    const { ipcMain } = await import('electron')
    registerTitlePopupIpc({} as TitlePopupHostBindings)
    const call = vi
      .mocked(ipcMain.on)
      .mock.calls.find(([channel]) => channel === 'comfy-titlepopup:rendered')
    if (!call) throw new Error('IPC listener not registered: comfy-titlepopup:rendered')
    rendered = call[1] as IpcListener
  })

  afterEach(() => {
    _test_deleteTitlePopupEntry(POPUP_WEB_CONTENTS_ID)
  })

  it('skips the resend while the renderer holds the acknowledged config', () => {
    const { entry, send } = registerEntrySyncedTo(menuConfig)

    syncTitlePopupConfig(entry, menuConfig, false)

    expect(send).not.toHaveBeenCalled()
  })

  it('resends an acknowledged config when every open must sync', () => {
    const { entry, send } = registerEntrySyncedTo(menuConfig)

    syncTitlePopupConfig(entry, menuConfig, true)

    expect(send).toHaveBeenCalledExactlyOnceWith('comfy-titlepopup:set-config', menuConfig)
  })

  it('resends the earlier config after a replacement the renderer never acknowledged', () => {
    const { entry, send } = registerEntrySyncedTo(menuConfig)

    syncTitlePopupConfig(entry, downloadsConfig, false)
    syncTitlePopupConfig(entry, menuConfig, false)

    expect(send.mock.calls).toEqual([
      ['comfy-titlepopup:set-config', downloadsConfig],
      ['comfy-titlepopup:set-config', menuConfig]
    ])
  })

  it('skips the resend again once the renderer acknowledges the replacement', () => {
    const { entry, send } = registerEntrySyncedTo(menuConfig)

    syncTitlePopupConfig(entry, downloadsConfig, false)
    rendered(rendererAck)
    syncTitlePopupConfig(entry, downloadsConfig, false)

    expect(send).toHaveBeenCalledExactlyOnceWith('comfy-titlepopup:set-config', downloadsConfig)
  })

  it('queues the config until the popup renderer is ready', () => {
    const { entry, send } = registerEntrySyncedTo(menuConfig)
    entry.view.rendererReady = false

    syncTitlePopupConfig(entry, downloadsConfig, false)

    expect(send).not.toHaveBeenCalled()
    expect(entry.pendingConfig).toEqual(downloadsConfig)
  })
})

describe('global settings IPC handlers', () => {
  type IpcHandler = (
    event: Electron.IpcMainInvokeEvent,
    payload?: Record<string, unknown>
  ) => unknown

  let updateField: IpcHandler
  let setModelsDirs: IpcHandler

  const eventFor = (id: number): Electron.IpcMainInvokeEvent =>
    ({ sender: { id } }) as unknown as Electron.IpcMainInvokeEvent

  beforeAll(async () => {
    const { ipcMain } = await import('electron')
    registerTitlePopupIpc({} as TitlePopupHostBindings)
    const handlerFor = (channel: string): IpcHandler => {
      const call = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
      if (!call) throw new Error(`IPC handler not registered: ${channel}`)
      return call[1] as IpcHandler
    }
    updateField = handlerFor('comfy-titlepopup:global-settings-update-field')
    setModelsDirs = handlerFor('comfy-titlepopup:global-settings-set-models-dirs')
    _test_setTitlePopupEntry(101, { kind: 'global-settings' } as TitlePopupEntry)
    _test_setTitlePopupEntry(102, { kind: 'instance-picker' } as TitlePopupEntry)
    _test_setTitlePopupEntry(103, { kind: 'downloads' } as TitlePopupEntry)
  })

  beforeEach(() => {
    vi.mocked(applySettingSet).mockReset()
  })

  afterAll(() => {
    _test_deleteTitlePopupEntry(101)
    _test_deleteTitlePopupEntry(102)
    _test_deleteTitlePopupEntry(103)
  })

  it('updates a field for a global-settings sender', () => {
    expect(updateField(eventFor(101), { fieldId: 'inputDir', value: '/shared/in' })).toEqual({
      ok: true
    })
    expect(applySettingSet).toHaveBeenCalledExactlyOnceWith('inputDir', '/shared/in')
  })

  it('updates a field for an instance-picker sender', () => {
    expect(updateField(eventFor(102), { fieldId: 'theme', value: 'dark' })).toEqual({ ok: true })
    expect(applySettingSet).toHaveBeenCalledExactlyOnceWith('theme', 'dark')
  })

  it('rejects an unknown sender updating a field', () => {
    expect(updateField(eventFor(999), { fieldId: 'inputDir', value: '/shared/in' })).toEqual({
      ok: false,
      message: 'Global Settings popup not active.'
    })
    expect(applySettingSet).not.toHaveBeenCalled()
  })

  it('rejects a non-settings popup updating a field', () => {
    expect(updateField(eventFor(103), { fieldId: 'inputDir', value: '/shared/in' })).toEqual({
      ok: false,
      message: 'Global Settings popup not active.'
    })
    expect(applySettingSet).not.toHaveBeenCalled()
  })

  it.each([undefined, ''])('rejects invalid field id %j', (fieldId) => {
    expect(updateField(eventFor(101), { fieldId })).toEqual({
      ok: false,
      message: 'Invalid field id.'
    })
    expect(applySettingSet).not.toHaveBeenCalled()
  })

  it('returns an applySettingSet error when updating a field', () => {
    vi.mocked(applySettingSet).mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(updateField(eventFor(101), { fieldId: 'inputDir', value: '/shared/in' })).toEqual({
      ok: false,
      message: 'boom'
    })
  })

  it('sets models directories for a settings sender', () => {
    const dirs = ['/a', '/b']
    expect(setModelsDirs(eventFor(101), { dirs })).toEqual({ ok: true })
    expect(applySettingSet).toHaveBeenCalledExactlyOnceWith('modelsDirs', dirs)
  })

  it.each(['/a', undefined])('rejects non-array models directories %j', (dirs) => {
    expect(setModelsDirs(eventFor(101), { dirs })).toEqual({ ok: false })
    expect(applySettingSet).not.toHaveBeenCalled()
  })

  it('rejects models directories containing a non-string', () => {
    expect(setModelsDirs(eventFor(101), { dirs: ['/a', 5] })).toEqual({ ok: false })
    expect(applySettingSet).not.toHaveBeenCalled()
  })

  it('rejects an unknown sender setting models directories', () => {
    expect(setModelsDirs(eventFor(999), { dirs: ['/a'] })).toEqual({ ok: false })
    expect(applySettingSet).not.toHaveBeenCalled()
  })
})

describe('buildGlobalSettingsSnapshot telemetry grant', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function snapshotWithConsent(consent: unknown): { telemetryGranted: boolean } {
    const actualGet = settings.get
    vi.spyOn(settings, 'get').mockImplementation(((key: string) =>
      key === 'telemetryEnabled' ? consent : actualGet(key)) as typeof settings.get)
    vi.spyOn(settings, 'resolveBetaFeaturesEnabled').mockReturnValue(false)
    return _test_buildGlobalSettingsSnapshot()
  }

  it('grants only on an explicit opt-in', () => {
    expect(snapshotWithConsent(true).telemetryGranted).toBe(true)
  })

  it('does not grant when consent was never recorded', () => {
    expect(snapshotWithConsent(undefined).telemetryGranted).toBe(false)
  })

  it('does not grant on an explicit opt-out', () => {
    expect(snapshotWithConsent(false).telemetryGranted).toBe(false)
  })
})

describe('build page open-in-new-window IPC', () => {
  type IpcListener = (event: Electron.IpcMainEvent, installationId: unknown) => void
  const panelContents = {}
  const openInstallInNewWindow = vi.fn(async () => {})
  let open: IpcListener

  beforeAll(async () => {
    const { ipcMain } = await import('electron')
    vi.mocked(ipcMain.on).mockClear()
    registerTitlePopupIpc({ openInstallInNewWindow } as unknown as TitlePopupHostBindings)
    const call = vi
      .mocked(ipcMain.on)
      .mock.calls.find(([channel]) => channel === 'comfy-window:open-install-new-window')
    if (!call) throw new Error('IPC listener not registered')
    open = call[1] as IpcListener
  })

  beforeEach(() => {
    openInstallInNewWindow.mockClear()
    comfyWindows.set(nextWindowKey(), {
      panelView: { webContents: panelContents }
    } as unknown as ComfyWindowEntry)
  })

  it('opens the build for a window panel', () => {
    open({ sender: panelContents } as Electron.IpcMainEvent, 'inst-a')

    expect(openInstallInNewWindow).toHaveBeenCalledExactlyOnceWith('inst-a')
  })

  it.each([
    ['a sender that is not a panel', {}, 'inst-a'],
    ['a missing installation id', panelContents, undefined]
  ])('ignores %s', (_label, sender, installationId) => {
    open({ sender } as Electron.IpcMainEvent, installationId)

    expect(openInstallInNewWindow).not.toHaveBeenCalled()
  })
})
