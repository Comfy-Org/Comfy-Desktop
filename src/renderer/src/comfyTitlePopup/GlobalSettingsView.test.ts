import { describe, expect, it, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'

import { en } from '../lib/i18nMessages.ts'
import { useModal } from '../composables/useModal'
import GlobalSettingsView from './GlobalSettingsView.vue'

interface BridgeState {
  updateFieldCalls: Array<{ id: string; value: unknown }>
  setModelsDirsCalls: string[][]
  openPathCalls: string[]
  openExternalCalls: string[]
  openLogsFolderCalls: number
  browseFolderReturn: string | null
  checkForUpdateCalls: number
  downloadUpdateCalls: number
  installUpdateCalls: number
  closeCalls: number
}

function installMockBridge(): BridgeState {
  const state: BridgeState = {
    updateFieldCalls: [],
    setModelsDirsCalls: [],
    openPathCalls: [],
    openExternalCalls: [],
    openLogsFolderCalls: 0,
    browseFolderReturn: null,
    checkForUpdateCalls: 0,
    downloadUpdateCalls: 0,
    installUpdateCalls: 0,
    closeCalls: 0
  }
  const bridge = {
    close: () => {
      state.closeCalls += 1
    },
    globalSettingsUpdateField: async (id: string, value: unknown) => {
      state.updateFieldCalls.push({ id, value })
      return { ok: true }
    },
    globalSettingsBrowseFolder: async () => state.browseFolderReturn,
    globalSettingsOpenPath: (path: string) => {
      state.openPathCalls.push(path)
    },
    globalSettingsOpenExternal: (url: string) => {
      state.openExternalCalls.push(url)
    },
    globalSettingsOpenLogsFolder: () => {
      state.openLogsFolderCalls += 1
    },
    globalSettingsSetModelsDirs: async (dirs: string[]) => {
      state.setModelsDirsCalls.push([...dirs])
      return { ok: true }
    },
    globalSettingsCheckForUpdate: async () => {
      state.checkForUpdateCalls += 1
      return { available: false }
    },
    globalSettingsDownloadUpdate: async () => {
      state.downloadUpdateCalls += 1
    },
    globalSettingsInstallUpdate: () => {
      state.installUpdateCalls += 1
    },
    globalSettingsSetLastCheckedAt: () => {}
  }
  ;(window as unknown as { __comfyTitlePopup: typeof bridge }).__comfyTitlePopup = bridge
  return state
}

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

function makeSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    generalFields: [
      {
        id: 'language',
        label: 'Language',
        value: 'en',
        editable: true,
        editType: 'select',
        options: [
          { value: 'en', label: 'English' },
          { value: 'zh', label: '中文' }
        ]
      }
    ],
    telemetryFields: [
      {
        id: 'telemetryEnabled',
        label: 'Send anonymous telemetry',
        value: true,
        editable: true,
        editType: 'boolean'
      },
      // Built main-side by `buildSettingsSections` off
      // `resolveBetaFeaturesEnabled()`, so it always carries a real boolean —
      // a legacy install with nothing stored arrives seeded, never blank.
      {
        id: 'betaFeaturesEnabled',
        label: 'Opt in to beta features',
        value: true,
        editable: true,
        editType: 'boolean'
      }
    ],
    // Explicit telemetry consent; gates the OFF -> ON direction of the row above.
    telemetryGranted: true,
    desktopUpdateFields: [
      {
        id: 'autoInstallUpdates',
        label: 'Auto install updates',
        value: true,
        editable: true,
        editType: 'boolean'
      }
    ],
    cacheFields: [],
    advancedFields: [],
    sharedDirectoriesFields: [],
    installLocationFields: [
      {
        id: 'installDir',
        label: 'Install Location',
        value: '/home/u/ComfyUI-Installs',
        editable: true,
        editType: 'path',
        openable: true,
        browseOnly: true
      }
    ],
    modelsDirs: [
      { path: '/home/u/ComfyUI/models', isPrimary: true },
      { path: '/mnt/extra/models', isPrimary: false }
    ],
    modelsSystemDefault: '/home/u/ComfyUI/models',
    appUpdate: {
      state: { kind: null, version: null, autoUpdate: true },
      progress: null,
      isDownloading: false,
      capabilities: { systemManaged: false, canSelfUpdate: true },
      installedVersion: '1.2.3',
      platform: 'darwin',
      lastCheckedAt: null
    },
    githubUrl: 'https://github.com/comfyanonymous/ComfyUI',
    githubStars: 12345,
    i18n: {
      overview: 'General',
      updates: 'Updates',
      storage: 'Storage',
      models: 'Models',
      advanced: 'Advanced',
      logs: 'Logs',
      sharedDirectories: 'Shared directories'
    }
  }
  return { ...base, ...overrides }
}

function mountView(snapshot = makeSnapshot()) {
  return mount(GlobalSettingsView, {
    props: { snapshot: snapshot as never },
    global: { plugins: [makeI18n()] },
    attachTo: document.body
  })
}

describe('GlobalSettingsView', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders all five tabs and the general tab is active by default', () => {
    installMockBridge()
    const wrapper = mountView()
    const tabLabels = wrapper.findAll('.gs-tab').map((t) => t.text())
    expect(tabLabels).toEqual(['General', 'Updates', 'Storage', 'Advanced', 'Logs'])
    expect(wrapper.find('.gs-tab.active').text()).toBe('General')
  })

  it('moves focus with arrow-key tab navigation', async () => {
    installMockBridge()
    const wrapper = mountView()
    const generalTab = wrapper.findAll('.gs-tab')[0]!
    generalTab.element.focus()
    await generalTab.trigger('keydown', { key: 'ArrowDown' })
    await nextTick()

    const updatesTab = wrapper.findAll('.gs-tab')[1]!
    expect(wrapper.find('.gs-tab.active').text()).toBe('Updates')
    expect(document.activeElement).toBe(updatesTab.element)
  })

  it('lands on the tab named by snapshot.initialTab', () => {
    // The instance pane's "Manage Shared Directories" deep-link opens this
    // popup with initialTab 'storage' so the user lands on the Storage tab.
    installMockBridge()
    const wrapper = mountView(makeSnapshot({ initialTab: 'storage' }))
    expect(wrapper.find('.gs-tab.active').text()).toBe('Storage')
  })

  it('keeps the user-selected tab across a null-initialTab rebroadcast', async () => {
    // Live snapshot rebroadcasts (star count, settings changed) carry
    // initialTab null and must not yank the user back to the opener's tab.
    installMockBridge()
    const wrapper = mountView(makeSnapshot({ initialTab: 'storage' }))
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Updates')!
      .trigger('click')
    await nextTick()
    await wrapper.setProps({ snapshot: makeSnapshot({ initialTab: null }) as never })
    expect(wrapper.find('.gs-tab.active').text()).toBe('Updates')
  })

  it('re-applies the requested tab when a reopen pushes a new snapshot', async () => {
    // The popup view is cached across opens, so a second deep-link open
    // pushes a fresh snapshot object with the same initialTab value; the
    // identity-watch must still retarget the tab.
    installMockBridge()
    const wrapper = mountView(makeSnapshot({ initialTab: 'storage' }))
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'General')!
      .trigger('click')
    await nextTick()
    await wrapper.setProps({ snapshot: makeSnapshot({ initialTab: 'storage' }) as never })
    expect(wrapper.find('.gs-tab.active').text()).toBe('Storage')
  })

  it('GitHub link card click routes through the bridge', async () => {
    const bridge = installMockBridge()
    const wrapper = mountView()
    const link = wrapper.findComponent({ name: 'GitHubLinkCard' })
    expect(link.exists()).toBe(true)
    await link.trigger('click')
    expect(bridge.openExternalCalls).toEqual(['https://github.com/comfyanonymous/ComfyUI'])
  })

  // Storage tab shares `GlobalStorageSections`; rendering is covered by StoragePane.test.ts.
  it('Storage tab routes a make-primary click through the bridge', async () => {
    const bridge = installMockBridge()
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    const toggles = wrapper.findAll('.models-dir-menu-wrap > button')
    expect(toggles).toHaveLength(1)
    await toggles[0]!.trigger('click')
    await nextTick()
    await flushPromises()
    const makePrimary = wrapper.find('.models-dir-menu button[role="menuitem"]')
    await makePrimary.trigger('click')
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([['/mnt/extra/models', '/home/u/ComfyUI/models']])
  })

  it('Storage tab browses and re-points a models dir through the bridge', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/mnt/new/models'
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    const browseBtns = wrapper.findAll('.models-dir-row .models-dir-action')
    await browseBtns[0]!.trigger('click')
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([['/mnt/new/models', '/mnt/extra/models']])
  })

  it('Storage tab labels the add button "Add Shared Directory"', async () => {
    installMockBridge()
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    expect(wrapper.find('.models-dir-add').text()).toBe('Add Shared Directory')
  })

  it('Storage tab adds a shared models directory through the bridge', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/new/models'
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    await wrapper.find('.models-dir-add').trigger('click')
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([
      ['/home/u/ComfyUI/models', '/mnt/extra/models', '/new/models']
    ])
  })

  it('Storage tab does not add a shared models directory when browsing is cancelled', async () => {
    const bridge = installMockBridge()
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    await wrapper.find('.models-dir-add').trigger('click')
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([])
  })

  it('Storage tab ignores adding a directory that is already listed', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/mnt/extra/models'
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    await wrapper.find('.models-dir-add').trigger('click')
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([])
  })

  it('Storage tab ignores adding a listed directory with different separators or trailing slash', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/mnt/extra/models/'
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    await wrapper.find('.models-dir-add').trigger('click')
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([])
  })

  it('Storage tab ignores re-pointing a models dir at another listed directory', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/mnt/extra/models'
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    const browseBtns = wrapper.findAll('.models-dir-row .models-dir-action')
    await browseBtns[0]!.trigger('click')
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([])
  })

  it('Storage tab removes a non-primary shared models directory after confirmation', async () => {
    const bridge = installMockBridge()
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    await wrapper.find('.models-dir-menu-wrap > button').trigger('click')
    await nextTick()
    const remove = wrapper
      .findAll('.models-dir-menu button[role="menuitem"]')
      .find((item) => item.text().includes('Remove'))!
    await remove.trigger('click')
    await flushPromises()
    const modal = useModal()
    expect(modal.state.visible).toBe(true)
    modal.close(true)
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([['/home/u/ComfyUI/models']])
  })

  it('Storage tab keeps a shared models directory when removal is declined', async () => {
    const bridge = installMockBridge()
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    await wrapper.find('.models-dir-menu-wrap > button').trigger('click')
    await nextTick()
    const remove = wrapper
      .findAll('.models-dir-menu button[role="menuitem"]')
      .find((item) => item.text().includes('Remove'))!
    await remove.trigger('click')
    await flushPromises()
    const modal = useModal()
    expect(modal.state.visible).toBe(true)
    modal.close(false)
    await flushPromises()
    expect(bridge.setModelsDirsCalls).toEqual([])
  })

  it('Storage tab offers no Remove action for the primary Downloads row', async () => {
    installMockBridge()
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    const primaryRow = wrapper.findAll('.models-dir-row')[0]!
    expect(primaryRow.find('.tag-primary').text()).toContain('Downloads')
    expect(primaryRow.find('.models-dir-menu-wrap').exists()).toBe(false)
  })

  // Covers the Shared Directories field-write path, not just the model-dir actions.
  it('Storage tab routes a Shared Directories browse through the bridge', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/picked/in'
    const snapshot = makeSnapshot({
      sharedDirectoriesFields: [
        { id: 'inputDir', label: 'Input Directory', value: '/shared/in', type: 'path' },
        { id: 'outputDir', label: 'Output Directory', value: '/shared/out', type: 'path' }
      ]
    })
    const wrapper = mountView(snapshot)
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    const rows = wrapper.findAll('.storage-dir-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.find('.storage-dir-name').text()).toBe('/shared/in')
    await rows[0]!.find('.storage-dir-action').trigger('click')
    await flushPromises()
    expect(bridge.updateFieldCalls).toEqual([{ id: 'inputDir', value: '/picked/in' }])
  })

  it('Storage tab browses the shared output directory through the bridge', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/picked/out'
    const snapshot = makeSnapshot({
      sharedDirectoriesFields: [
        { id: 'inputDir', label: 'Input Directory', value: '/shared/in', type: 'path' },
        { id: 'outputDir', label: 'Output Directory', value: '/shared/out', type: 'path' }
      ]
    })
    const wrapper = mountView(snapshot)
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    const outputRow = wrapper.findAll('.storage-dir-row')[1]!
    expect(outputRow.find('.storage-dir-name').text()).toBe('/shared/out')
    await outputRow.find('.storage-dir-action').trigger('click')
    await flushPromises()
    expect(bridge.updateFieldCalls).toEqual([{ id: 'outputDir', value: '/picked/out' }])
  })

  // Every dir in the global Storage tab is shared, so all rows carry the shared
  // glyph — matching the per-instance Storage tab (StoragePane.vue).
  it('Storage tab marks shared models and input/output dirs with the shared glyph', async () => {
    installMockBridge()
    const snapshot = makeSnapshot({
      sharedDirectoriesFields: [
        { id: 'inputDir', label: 'Input Directory', value: '/shared/in', type: 'path' },
        { id: 'outputDir', label: 'Output Directory', value: '/shared/out', type: 'path' }
      ]
    })
    const wrapper = mountView(snapshot)
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    const modelRows = wrapper.findAll('.models-dir-row')
    expect(modelRows.length).toBeGreaterThan(0)
    expect(modelRows.every((r) => r.find('.storage-item-icon.is-shared').exists())).toBe(true)
    const dirRows = wrapper.findAll('.storage-dir-row')
    expect(dirRows).toHaveLength(2)
    expect(dirRows.every((r) => r.find('.storage-item-icon.is-shared').exists())).toBe(true)
  })

  // The global Storage tab explains its scope: shared model dirs are included
  // by every instance (which can add its own dirs in its Storage tab), and
  // each instance opts into the shared input/output folders independently.
  it('Storage tab section tooltips state the global-vs-instance scope', async () => {
    installMockBridge()
    const snapshot = makeSnapshot({
      sharedDirectoriesFields: [
        { id: 'inputDir', label: 'Input Directory', value: '/shared/in', type: 'path' },
        { id: 'outputDir', label: 'Output Directory', value: '/shared/out', type: 'path' }
      ]
    })
    const wrapper = mountView(snapshot)
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    const tooltips = wrapper
      .findAll('.gs-micro-title .info-tooltip-trigger')
      .map((el) => el.attributes('aria-label') ?? '')
    expect(
      tooltips.some((text) => text.includes('an instance can add directories just for itself'))
    ).toBe(true)
    expect(tooltips.some((text) => text.includes('Each instance independently chooses'))).toBe(true)
  })

  it('Storage tab opens a Shared Directory in the OS file manager when clicked', async () => {
    const bridge = installMockBridge()
    const snapshot = makeSnapshot({
      sharedDirectoriesFields: [
        { id: 'inputDir', label: 'Input Directory', value: '/shared/in', type: 'path' },
        { id: 'outputDir', label: 'Output Directory', value: '/shared/out', type: 'path' }
      ]
    })
    const wrapper = mountView(snapshot)
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    await wrapper.findAll('.storage-dir-row')[1]!.find('.storage-dir-name').trigger('click')
    expect(bridge.openPathCalls).toEqual(['/shared/out'])
  })

  it('Advanced tab renders the global Default Install Location as a readonly path row', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/picked/installs'
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Advanced')!
      .trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain('Default Install Location')
    // The install dir is the first path row in the Advanced tab.
    const row = wrapper.find('.storage-dir-row')
    expect(row.exists()).toBe(true)
    expect(row.find('.storage-dir-name').text()).toBe('/home/u/ComfyUI-Installs')
    // Clicking the path opens it; browsing routes the pick through the bridge.
    await row.find('.storage-dir-name').trigger('click')
    expect(bridge.openPathCalls).toEqual(['/home/u/ComfyUI-Installs'])
    await row.find('.storage-dir-action').trigger('click')
    await flushPromises()
    expect(bridge.updateFieldCalls).toEqual([{ id: 'installDir', value: '/picked/installs' }])
  })

  it('Advanced tab renders the cache dir as a readonly path row that browses + opens', async () => {
    const bridge = installMockBridge()
    bridge.browseFolderReturn = '/picked/cache'
    const snapshot = makeSnapshot({
      cacheFields: [
        {
          id: 'cacheDir',
          label: 'Cache Directory',
          value: '/home/u/cache',
          type: 'path',
          openable: true
        }
      ]
    })
    const wrapper = mountView(snapshot)
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Advanced')!
      .trigger('click')
    await nextTick()
    // Path rows in Advanced: [0] install location, [1] cache dir.
    const row = wrapper.findAll('.storage-dir-row')[1]!
    expect(row.exists()).toBe(true)
    expect(row.find('.storage-dir-name').text()).toBe('/home/u/cache')
    // Clicking the path opens it in the OS file manager.
    await row.find('.storage-dir-name').trigger('click')
    expect(bridge.openPathCalls).toEqual(['/home/u/cache'])
    // Browse routes the picked dir through the bridge.
    await row.find('.storage-dir-action').trigger('click')
    await flushPromises()
    expect(bridge.updateFieldCalls).toEqual([{ id: 'cacheDir', value: '/picked/cache' }])
  })

  it('renders diagnostics only in the Logs tab', async () => {
    const bridge = installMockBridge()
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((tab) => tab.text() === 'Advanced')!
      .trigger('click')
    await nextTick()
    expect(wrapper.text()).not.toContain('Diagnostics')

    await wrapper
      .findAll('.gs-tab')
      .find((tab) => tab.text() === 'Logs')!
      .trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain('Diagnostics')
    expect(wrapper.find('.gs-logs-btn').text()).toContain('Open logs folder')
    await wrapper.find('.gs-logs-btn').trigger('click')
    expect(bridge.openLogsFolderCalls).toBe(1)
  })

  it('does not render the Install Location section in the Storage tab', async () => {
    installMockBridge()
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Storage')!
      .trigger('click')
    await nextTick()
    expect(wrapper.text()).not.toContain('Install Location')
  })

  it('close button routes to bridge.close', async () => {
    const bridge = installMockBridge()
    const wrapper = mountView()
    await wrapper.find('.gs-close').trigger('click')
    expect(bridge.closeCalls).toBe(1)
  })

  it('Updates tab routes Check for updates click through the bridge', async () => {
    const bridge = installMockBridge()
    const wrapper = mountView()
    await wrapper
      .findAll('.gs-tab')
      .find((t) => t.text() === 'Updates')!
      .trigger('click')
    await nextTick()
    const buttons = wrapper.findAll('button')
    const checkBtn = buttons.find((b) => /check/i.test(b.text()))
    expect(checkBtn, 'expected a "Check" CTA on idle state').toBeDefined()
    await checkBtn!.trigger('click')
    await flushPromises()
    expect(bridge.checkForUpdateCalls).toBeGreaterThanOrEqual(1)
  })

  describe('beta features opt-in row', () => {
    const BETA_LABEL = 'Opt in to beta features'
    const TELEMETRY_LABEL = 'Send anonymous telemetry'

    function toggleFor(wrapper: ReturnType<typeof mountView>, label: string) {
      return wrapper.find(`button[role="switch"][aria-label="${label}"]`)
    }

    function snapshotWith(granted: boolean, beta: boolean) {
      const snap = makeSnapshot({ telemetryGranted: granted })
      const fields = snap.telemetryFields as Record<string, unknown>[]
      fields.find((f) => f['id'] === 'betaFeaturesEnabled')!['value'] = beta
      return snap
    }

    it('renders the seeded value from the snapshot and persists a change through the bridge', async () => {
      const bridge = installMockBridge()
      const wrapper = mountView(snapshotWith(true, true))
      const toggle = toggleFor(wrapper, BETA_LABEL)
      expect(toggle.exists()).toBe(true)
      expect(toggle.attributes('aria-checked')).toBe('true')

      await toggle.trigger('click')
      await flushPromises()
      expect(bridge.updateFieldCalls).toEqual([{ id: 'betaFeaturesEnabled', value: false }])
    })

    it('blocks the off -> on transition and explains why when telemetry consent is absent', async () => {
      const bridge = installMockBridge()
      const wrapper = mountView(snapshotWith(false, false))
      const toggle = toggleFor(wrapper, BETA_LABEL)
      expect(toggle.attributes('disabled')).toBeDefined()
      expect(toggle.attributes('title')).toBe(en.tooltips.betaFeaturesNeedTelemetry)

      await toggle.trigger('click')
      await flushPromises()
      expect(bridge.updateFieldCalls).toEqual([])
    })

    it('leaves the telemetry row itself untouched when consent is absent', () => {
      installMockBridge()
      const wrapper = mountView(snapshotWith(false, false))
      const toggle = toggleFor(wrapper, TELEMETRY_LABEL)
      expect(toggle.attributes('disabled')).toBeUndefined()
      expect(toggle.attributes('title')).toBeUndefined()
    })

    it('still allows leaving the beta programme while telemetry consent is absent, then blocks re-entry', async () => {
      const bridge = installMockBridge()
      const wrapper = mountView(snapshotWith(false, true))
      const toggle = toggleFor(wrapper, BETA_LABEL)
      expect(toggle.attributes('disabled')).toBeUndefined()

      await toggle.trigger('click')
      await flushPromises()
      expect(bridge.updateFieldCalls).toEqual([{ id: 'betaFeaturesEnabled', value: false }])

      await wrapper.setProps({ snapshot: snapshotWith(false, false) as never })
      const after = toggleFor(wrapper, BETA_LABEL)
      expect(after.attributes('disabled')).toBeDefined()
      await after.trigger('click')
      await flushPromises()
      expect(bridge.updateFieldCalls).toHaveLength(1)
    })

    it('enables both directions once telemetry consent is granted', () => {
      installMockBridge()
      const wrapper = mountView(snapshotWith(true, false))
      const toggle = toggleFor(wrapper, BETA_LABEL)
      expect(toggle.attributes('disabled')).toBeUndefined()
      expect(toggle.attributes('title')).toBeUndefined()
    })
  })
})
